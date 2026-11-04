import {
  parseLocation,
  complaintSummary,
  nearbyCivic,
  sourceState,
  type CivicRow,
} from "./location-evidence";
import { hitLimit } from "./edge-guard";
interface Env {
  CIVIC_DB: D1Database;
}
const hits = new Map();
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "cache-control": status === 200 ? "public, max-age=300" : "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
        },
      });
    if (request.method !== "GET") return json({ error: "GET only" }, 405);
    if (url.pathname !== "/api/location/evidence")
      return json({ error: "Not found" }, 404);
    const point = parseLocation(url);
    if (!point)
      return json({ error: "Valid lat/lng in Bangkok metro required." }, 400);
    if (
      hitLimit(
        hits,
        request.headers.get("cf-connecting-ip") ?? "local",
        30,
        60000,
      )
    )
      return new Response(
        JSON.stringify({ error: "Please try again in one minute." }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "60",
            "access-control-allow-origin": "*",
          },
        },
      );
    const now = new Date().toISOString();
    const sourceUrl = `https://traffy.longdo.com/api.php?action=near&lat=${point.lat}&lon=${point.lng}&radius=800&months=12&limit=0`;
    const cache = await caches.open("location-evidence-v1");
    const key = new Request(
      `https://atlas.nonarkara.org/__location-cache/${point.lat}/${point.lng}`,
    );
    const complaints = async () => {
      let saved: {
        fetchedAt: string;
        value: ReturnType<typeof complaintSummary>;
      } | null = null;
      try {
        const old = await cache.match(key);
        if (old) saved = await old.json();
      } catch {
        /* Cache unavailable: attempt the source. */
      }
      if (saved && sourceState(saved.fetchedAt) === "available")
        return { status: "available", ...saved, sourceUrl };
      try {
        const r = await fetch(sourceUrl, {
          signal: AbortSignal.timeout(7000),
          headers: { "user-agent": "BKKx-place-evidence/1.0" },
        });
        if (!r.ok) throw new Error(`Source HTTP ${r.status}`);
        const value = complaintSummary(await r.json());
        const record = { fetchedAt: now, value };
        ctx.waitUntil(
          cache.put(
            key,
            new Response(JSON.stringify(record), {
              headers: { "cache-control": "public, max-age=604800" },
            }),
          ),
        );
        return { status: "available", ...record, sourceUrl };
      } catch {
        return {
          status: saved ? "stale" : "unavailable",
          fetchedAt: saved?.fetchedAt ?? null,
          value: saved?.value ?? null,
          sourceUrl,
        };
      }
    };
    const civic = async () => {
      try {
        const result = await env.CIVIC_DB.prepare(
          "SELECT id,name,category,lat,lng,source_url,source_dataset,ingested_at FROM civic_pois WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
        )
          .bind(
            point.lat - 0.008,
            point.lat + 0.008,
            point.lng - 0.008,
            point.lng + 0.008,
          )
          .all<CivicRow>();
        const all = nearbyCivic(result.results ?? [], point);
        return {
          status: "reference",
          fetchedAt: now,
          observedAt: null,
          count: all.length,
          counts: all.reduce<Record<string, number>>((out, r) => {
            out[r.category] = (out[r.category] ?? 0) + 1;
            return out;
          }, {}),
          places: all.slice(0, 30),
          sourceUrl: "https://atlas.nonarkara.org/api/civic-pois",
          limits:
            "Catalogued schools, sports grounds, car parks, museums and waterway places only. Not a complete amenity survey. Distance is straight-line; opening hours and public access are unverified. ingested_at is import time, not observation time.",
        };
      } catch {
        return {
          status: "unavailable",
          fetchedAt: null,
          observedAt: null,
          count: null,
          counts: null,
          places: [],
          sourceUrl: "https://atlas.nonarkara.org/api/civic-pois",
          limits:
            "Civic catalog could not be read. Missing data does not mean no services.",
        };
      }
    };
    const [reports, amenities] = await Promise.all([complaints(), civic()]);
    return json({
      version: 1,
      build: "location-pilot-1",
      query: { ...point, radiusM: 800 },
      fetchedAt: now,
      complaints: {
        ...reports,
        observedAt: null,
        period:
          "Recent: preceding 12 months. Open and resolved: all-time records in radius.",
        limits:
          "Reports reflect participation and source coverage, not crime, safety, property risk or the incidence of problems. Zero reports does not establish no problems.",
      },
      civic: amenities,
      unknown: [
        "Actual rent and availability",
        "Pedestrian access and gate hours",
        "Door-to-door commute",
        "Property-level flood risk",
        "Measured customer demand",
      ],
    });
  },
};
