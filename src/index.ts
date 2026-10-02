// Cloudflare Worker entry. The atlas itself is a static SPA in public/;
// this worker exists so we can run on a custom domain (atlas.nonarkara.org)
// and so server-side logic (analytics ingest, geocoding, the
// iTIC/Longdo traffic proxy, and the 3D buildings PMTiles Range proxy)
// has a place to land. Today it:
//   (1) proxies /api/traffic to the iTIC/Longdo feed using a secret key
//   (2) serves /bkk-buildings.pmtiles from R2 with HTTP Range passthrough
//   (3) serves /api/risk flood × PM2.5 civic score
//   (4) serves /api/cctv — public iTIC/Longdo traffic cameras (Bangkok metro)
//   (5) relays FloodDash (flood.nonarkara.org) — /api/flood/bkk verdict,
//       gauges, waterway status, DDS road reports; /api/flood-sensors is
//       its gauge layer. Refreshed by the cron into D1 (src/flooddash.ts)
//   (6) serves /api/civic-pois(/analysis) from CIVIC_DB (D1) — schools,
//       sports grounds, car parks, museums, waterway landmarks ingested
//       from data.go.th / data.bangkok.go.th by scripts/ingest-bma-open-data.py
//   (7) falls back to the static asset binding for everything else
//
// Why R2 for PMTiles: the Workers [assets] binding does NOT honor HTTP
// Range requests — every GET returns the full 17 MB. The pmtiles
// client lib streams by issuing Range requests for the directory and
// individual tiles, so we proxy through R2 which supports Range natively.

import {
  floodBkkResponse,
  floodSensorsResponse,
  FLOODDASH_ORIGIN,
  liveAt,
  loadFloodState,
  refreshFloodDash,
  type RefreshDeps,
} from "./flooddash";

import { floodRoadsResponse, loadFloodRoads, refreshFloodRoads, type RoadDeps } from "./floodroads";

import { roadsXrefResponse } from "./roads-xref";

export interface Env {
  ASSETS: Fetcher;
  BKK_TILES: R2Bucket;
  CIVIC_DB: D1Database;
  LONGDO_KEY?: string;
}

const SPA_FALLBACK_PATHS = new Set<string>([
  "/atlas",
  "/atlas/",
]);
const PMTILES_PATH = "/bkk-buildings.pmtiles";
const PMTILES_R2_KEY = "buildings/bangkok.pmtiles";
const RATTANAKOSIN_PMTILES_PATH = "/bkk-buildings-rattanakosin.pmtiles";
const RATTANAKOSIN_PMTILES_R2_KEY = "buildings/bangkok-rattanakosin.pmtiles";
const FLOOD_ASSET = "/bkk-flood-envelope.geojson";

const LONGDO_TRAFFIC_FEED = "https://traffic.longdo.com/api/feed/itsth";
const LONGDO_CCTV_FEED = "https://camera.longdo.com/feed/?command=json";
const TRAFFIC_CACHE_TTL_SECONDS = 90;
const CCTV_CACHE_TTL_SECONDS = 300;
// Short: /api/risk now carries FloodDash's live reading, which moves every ~10 min.
const RISK_CACHE_TTL_SECONDS = 300;
const FLOOD_SENSOR_CACHE_TTL_SECONDS = 60;

// Bangkok provincial water feeds — HII ThaiWater v3 (api-v3.thaiwater.net).
// province_code=10 is Bangkok. The /api/water/bkk/* route family proxies
// these so the atlas, war room, and any future page can consume the same
// upstream under one Cache-Control contract. Stolen from
// bangkok.thaiwater.net/dashboard.
const THAIWATER_V3 = "https://api-v3.thaiwater.net/api/v1/thaiwater30";
const BKK_RAIN24_URL = `${THAIWATER_V3}/provinces/rain24?include_zero=1&province_code=10`;
const BKK_RAIN1D_URL = `${THAIWATER_V3}/provinces/rain1d?province_code=10`;
const BKK_RAIN3D_URL = `${THAIWATER_V3}/provinces/rain3d?province_code=10`;
const BKK_RAIN7D_URL = `${THAIWATER_V3}/provinces/rain7d?province_code=10`;
const BKK_TEMP_URL = `${THAIWATER_V3}/provinces/temperature_maxmin_thisweek?province_code=10`;
const BKK_RADAR_URL = `${THAIWATER_V3}/provinces/radar?province_code=10`;
const BKK_WATER_CACHE_TTL_SECONDS = 300;
const BKK_INCIDENTS_CACHE_TTL_SECONDS = 120;

/** Bangkok + immediate metro ring used for CCTV filtering. */
const CCTV_BBOX = {
  minLat: 13.4,
  maxLat: 14.2,
  minLon: 100.2,
  maxLon: 101.1,
};

type LongdoCamera = {
  title?: string;
  link?: string;
  camid?: string;
  latitude?: string | number;
  longitude?: string | number;
  organization?: string;
  motion?: string;
  vdourl?: string;
  imgurl?: string;
  hls_url?: string;
};

type FloodProps = {
  id?: string;
  name?: string;
  severity?: string;
  depthHintM?: number;
};

type FloodFeature = {
  type: "Feature";
  properties: FloodProps;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
};

type FloodCollection = {
  type: "FeatureCollection";
  features: FloodFeature[];
  disclaimer?: string;
};

let floodCache: FloodCollection | null = null;

// Live presence — anonymous, per-tab ID, pinged every 60 s. Pattern
// stolen from JK World (world.tehx.dyndns.info/flood, presence.js).
// Module-scoped state survives inside one isolate; resets on cold
// start, which is honest. We do not log IPs, sessions, or referrers.
const PRESENCE_TTL_MS = 5 * 60_000;
const presenceMap = new Map<string, number>();
let presencePeakToday = 0;
let presencePeakDay = new Date().toISOString().slice(0, 10);

function presenceSnapshot(now: number = Date.now()): { online: number; peak: number } {
  const cutoff = now - PRESENCE_TTL_MS;
  for (const [id, t] of presenceMap) if (t < cutoff) presenceMap.delete(id);
  const online = presenceMap.size;
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== presencePeakDay) { presencePeakDay = today; presencePeakToday = online; }
  if (online > presencePeakToday) presencePeakToday = online;
  return { online, peak: presencePeakToday };
}

function handlePresence(request: Request): Response {
  if (request.method === "POST" && new URL(request.url).pathname === "/api/presence/ping") {
    const sessionId =
      request.headers.get("x-atlas-session") ||
      crypto.randomUUID();
    presenceMap.set(sessionId, Date.now());
    const snap = presenceSnapshot();
    return jsonResponse({ ok: true, sessionId, online: snap.online, peak: snap.peak }, {
      headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
    });
  }
  if (request.method === "GET" && new URL(request.url).pathname === "/api/presence") {
    const snap = presenceSnapshot();
    return jsonResponse({ online: snap.online, peak: snap.peak }, {
      headers: { "cache-control": "no-store", "access-control-allow-origin": "*" },
    });
  }
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, POST" } });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", `public, max-age=${TRAFFIC_CACHE_TTL_SECONDS}`);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

const UPSTREAM_TIMEOUT_MS = 20_000;

// Shared upstream fetch with a hard timeout. A hung FloodDash tunnel (one
// Mac behind a tunnel) used to stall the water proxies until the Workers
// fetch limit; now every boundary fetch fails fast and the handler's
// existing `!upstream.ok` branch returns an honest 5xx JSON.
async function fetchUpstream(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_unreachable_or_timeout" }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// D1-cached proxy helper for the 8 BKK water endpoints
// (`/api/water/bkk/{dams,alerts,canal-gates,roads-flooded,…}`).
//
// Why: each Worker request was a fresh fetchUpstream to FloodDash.
// Smoke checks + live traffic = hundreds of upstream hits a day,
// even though the upstream payload itself moves every 5–10 min. Now:
//   1. Read `flood_state` for `key = "water-cache:<key>"`.
//   2. If the row exists and is younger than ttlSeconds, return it.
//   3. Otherwise call `producer()`, store the JSON-encoded result
//      + now() into D1, and return it.
//
// Atlas house rule: never fabricate. If the producer returns null,
// we forward that failure to the next caller instead of "warming" a
// stale row. The cache lives in the same `flood_state` table the
// relay already uses; the schema needs no migration.
// ─────────────────────────────────────────────────────────────────
async function withD1Cache<T>(
  env: Env,
  key: string,
  ttlSeconds: number,
  producer: () => Promise<{ payload: T; upstreamFetchedAt: string } | null>,
): Promise<{ payload: T; fromCache: boolean; fetchedAt: string } | null> {
  const cacheKey = `water-cache:${key}`;
  // Cheap read; index lookup on PK. We check `fetched_at` (string ISO)
  // against now() so a clock skew won't be worse than upstream's own
  // tolerance.
  const row = await env.CIVIC_DB.prepare(
    "SELECT payload, fetched_at FROM flood_state WHERE key = ?",
  ).bind(cacheKey).first<{ payload: string; fetched_at: string }>();
  const ageSec = row ? (Date.now() - Date.parse(row.fetched_at)) / 1000 : null;
  if (row && Number.isFinite(ageSec) && ageSec != null && ageSec >= 0 && ageSec < ttlSeconds) {
    try {
      return { payload: JSON.parse(row.payload) as T, fromCache: true, fetchedAt: row.fetched_at };
    } catch {
      // Corrupted row; fall through to refresh.
    }
  }
  const fresh = await producer();
  if (!fresh) return null;
  const fetchedAt = fresh.upstreamFetchedAt || new Date().toISOString();
  try {
    await env.CIVIC_DB.prepare(
      `INSERT INTO flood_state (key, payload, fetched_at, attempted_at, error)
       VALUES (?1, ?2, ?3, ?4, NULL)
       ON CONFLICT(key) DO UPDATE SET
         payload = excluded.payload,
         fetched_at = excluded.fetched_at,
         attempted_at = excluded.attempted_at,
         error = NULL`,
    ).bind(cacheKey, JSON.stringify(fresh.payload), fetchedAt, new Date().toISOString()).run();
  } catch (e) {
    // D1 write failed — log but don't fail the request. We still have
    // the fresh payload; the next caller will pay the upstream cost.
    console.warn(`withD1Cache(${key}): write failed`, String(e));
  }
  return { payload: fresh.payload, fromCache: false, fetchedAt };
}

// Parse a single-range HTTP Range header. Supports three shapes:
//   `bytes=<start>-`        → open-ended: from start to EOF
//   `bytes=<start>-<end>`   → closed range: from start to end inclusive
//   `bytes=-<suffix>`       → suffix range: last N bytes
// The pmtiles lib uses shape #2; the others are for correctness so
// other clients (curl, Range-aware browsers, etc.) work too.
function parseRange(header: string | null): { offset: number; length?: number } | null {
  if (!header) return null;
  const match = /^bytes=(-)?(\d+)(?:-(\d*))?$/.exec(header.trim());
  if (!match) return null;
  if (match[1] === "-") {
    // Suffix range: `bytes=-N` → last N bytes.
    const suffix = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { offset: 0, length: suffix, suffix: true } as { offset: number; length: number; suffix: true };
  }
  const offset = Number.parseInt(match[2], 10);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (match[3] === undefined || match[3] === "") {
    return { offset }; // open-ended
  }
  const end = Number.parseInt(match[3], 10);
  if (!Number.isFinite(end) || end < offset) return null;
  return { offset, length: end - offset + 1 };
}

async function serveBuildingsPmtiles(request: Request, env: Env): Promise<Response> {
  return servePmtilesFromR2(request, env, PMTILES_R2_KEY, PMTILES_PATH);
}

async function serveRattanakosinPmtiles(request: Request, env: Env): Promise<Response> {
  return servePmtilesFromR2(request, env, RATTANAKOSIN_PMTILES_R2_KEY, RATTANAKOSIN_PMTILES_PATH);
}

async function servePmtilesFromR2(request: Request, env: Env, key: string, _logicalPath: string): Promise<Response> {
  const range = parseRange(request.headers.get("range"));
  // For a suffix range we first read the metadata to know the total
  // size, then issue a ranged get for the trailing N bytes.
  if (range && "suffix" in range && range.suffix) {
    const head = await env.BKK_TILES.head(key);
    if (head === null) return new Response("not found", { status: 404 });
    const suffixLen = range.length ?? 0;
    const length = Math.min(suffixLen, head.size);
    const offset = head.size - length;
    const obj = await env.BKK_TILES.get(key, { range: { offset, length } });
    if (obj === null || !("body" in obj) || obj.body === null) {
      return new Response(null, { status: 304 });
    }
    const headers = new Headers();
    headers.set("content-type", "application/octet-stream");
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "public, max-age=31536000, immutable");
    if (obj.httpEtag) headers.set("etag", obj.httpEtag);
    headers.set("x-bkkx-source", "R2 bkk-tiles/" + key);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${head.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  const obj = await env.BKK_TILES.get(key, {
    range: range ?? undefined,
    onlyIf: {
      etagMatches: request.headers.get("if-match") ?? undefined,
      etagDoesNotMatch: request.headers.get("if-none-match") ?? undefined,
    },
  });

  if (obj === null) {
    return new Response("not found", { status: 404 });
  }
  if (!("body" in obj) || obj.body === null) {
    // R2Object (metadata only) is only returned when range is requested
    // and the result is a 304/412 conditional. The conditional headers
    // above would have produced that, so surface it cleanly.
    return new Response(null, { status: 304 });
  }

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);
  headers.set("x-bkkx-source", "R2 bkk-tiles/" + key);

  if (range) {
    const length = range.length ?? obj.size - range.offset;
    const end = range.offset + length - 1;
    headers.set("content-range", `bytes ${range.offset}-${end}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

async function loadFloodCollection(env: Env, request: Request): Promise<FloodCollection | null> {
  if (floodCache) return floodCache;
  const assetUrl = new URL(FLOOD_ASSET, request.url);
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  if (!res.ok) return null;
  const body = (await res.json()) as FloodCollection;
  if (!body?.features?.length) return null;
  floodCache = body;
  return body;
}

let landmarksCountCache: number | null = null;

async function loadLandmarksCount(env: Env, request: Request): Promise<number | null> {
  if (landmarksCountCache !== null) return landmarksCountCache;
  try {
    const assetUrl = new URL("/bkk-landmarks.geojson", request.url);
    const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    if (res.ok) {
      const body = (await res.json()) as { features?: unknown[] };
      if (Array.isArray(body?.features) && body.features.length > 0) {
        landmarksCountCache = body.features.length;
        return landmarksCountCache;
      }
    }
  } catch {}
  // No fabricated fallback: an unknown count is served as null, never a
  // magic 100 stamped as inventory (law #3 — silently faked fallback).
  return null;
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFloodFeature(lng: number, lat: number, feature: FloodFeature): boolean {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") {
    const rings = g.coordinates as number[][][];
    if (!pointInRing(lng, lat, rings[0])) return false;
    for (let h = 1; h < rings.length; h++) {
      if (pointInRing(lng, lat, rings[h])) return false;
    }
    return true;
  }
  if (g.type === "MultiPolygon") {
    const polys = g.coordinates as number[][][][];
    for (const poly of polys) {
      if (!pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lng, lat, poly[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

function floodHit(collection: FloodCollection, lng: number, lat: number) {
  const hits: FloodProps[] = [];
  for (const feature of collection.features) {
    if (pointInFloodFeature(lng, lat, feature)) hits.push(feature.properties ?? {});
  }
  if (hits.length === 0) return { inside: false as const, envelopes: [] as FloodProps[], top: null };
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  hits.sort((a, b) => (rank[b.severity ?? ""] ?? 0) - (rank[a.severity ?? ""] ?? 0));
  return { inside: true as const, envelopes: hits, top: hits[0] };
}

function parseBangkokLngLat(request: Request): { lng: number; lat: number } | Response {
  const url = new URL(request.url);
  const lng = Number.parseFloat(url.searchParams.get("lng") ?? "");
  const lat = Number.parseFloat(url.searchParams.get("lat") ?? "");
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return jsonResponse(
      {
        error: "invalid_coordinates",
        message: "Pass ?lng=&lat= as WGS84 decimals (Bangkok ≈ 100.5, 13.75).",
      },
      { status: 400 },
    );
  }
  if (lng < 100.2 || lng > 101.0 || lat < 13.4 || lat > 14.2) {
    return jsonResponse(
      {
        error: "out_of_bangkok_bbox",
        message: "Coordinates fall outside the Bangkok metro bbox used by this atlas.",
        lng,
        lat,
      },
      { status: 400 },
    );
  }
  return { lng, lat };
}

/** Risk: land price × schematic flood × live PM2.5 → 0–100 civic score. */
async function lookupRisk(request: Request, env: Env): Promise<Response> {
  const parsed = parseBangkokLngLat(request);
  if (parsed instanceof Response) return parsed;
  const { lng, lat } = parsed;
  const url = new URL(request.url);
  const pm25Override = Number.parseFloat(url.searchParams.get("pm25") ?? "");

  const [floodCollection, pm25Live, floodState, districts] = await Promise.all([
    loadFloodCollection(env, request),
    Number.isFinite(pm25Override) ? Promise.resolve(pm25Override) : fetchPointPm25(lat, lng),
    loadFloodState(env, () => floodDeps(env, request)).catch(() => null),
    getDistrictsGeoJson(env, request).catch(() => null),
  ]);
  const district = districts ? findDistrictForPoint(districts, lng, lat) : { id: null, name: null };

  const flood = floodCollection
    ? floodHit(floodCollection, lng, lat)
    : { inside: false as const, envelopes: [] as FloodProps[], top: null };

  const severity = flood.inside ? (flood.top?.severity ?? "medium") : "none";
  const severityWeight = ({ none: 0, low: 0.35, medium: 0.65, high: 1 } as Record<string, number>)[severity] ?? 0;
  const pm25 = pm25Live;
  const aqiFactor =
    pm25 == null || !Number.isFinite(pm25)
      ? 0
      : Math.min(1, Math.max(0, (pm25 - 12) / 138)); // 12 → 0, 150 → 1
  const score = Math.round(100 * (0.6 * severityWeight + 0.4 * aqiFactor));

  return jsonResponse(
    {
      tool: "risk",
      version: 3,
      query: { lng, lat },
      score,
      band: score >= 70 ? "high" : score >= 40 ? "elevated" : "moderate",
      factors: {
        floodInside: flood.inside,
        floodSeverity: severity,
        floodEnvelope: flood.top?.name ?? null,
        depthHintM: flood.top?.depthHintM ?? null,
        pm25: pm25 ?? null,
        aqiFactor: Math.round(aqiFactor * 100) / 100,
      },
      // The live answer. `score` above is the schematic envelope × PM2.5
      // composite; FloodDash's verdict is the one a person acts on.
      live: liveAt(floodState, lng, lat, district),
      disclaimer:
        floodCollection?.disclaimer ??
        "Schematic civic score (flood × PM2.5) — not for insurance underwriting or official planning.",
    },
    {
      headers: {
        "cache-control": `public, max-age=${RISK_CACHE_TTL_SECONDS}`,
        "access-control-allow-origin": "*",
      },
    },
  );
}

async function fetchPointPm25(lat: number, lng: number): Promise<number | null> {
  try {
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lng}&hourly=pm2_5&forecast_days=1&domains=cams_global`;
    const res = await fetchUpstream(aqUrl, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { hourly?: { pm2_5?: Array<number | null>; time?: string[] } };
    const values = data?.hourly?.pm2_5;
    if (!values?.length) return null;
    let idx = values.length - 1;
    while (idx > 0 && (values[idx] == null || Number.isNaN(Number(values[idx])))) idx--;
    const v = values[idx];
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}

function inCctvBbox(lat: number, lon: number): boolean {
  return (
    lat >= CCTV_BBOX.minLat &&
    lat <= CCTV_BBOX.maxLat &&
    lon >= CCTV_BBOX.minLon &&
    lon <= CCTV_BBOX.maxLon
  );
}

function camerasToGeoJson(cameras: LongdoCamera[]) {
  const features = [];
  for (const cam of cameras) {
    const lat = Number(cam.latitude);
    const lon = Number(cam.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!inCctvBbox(lat, lon)) continue;
    const hls = typeof cam.hls_url === "string" ? cam.hls_url.trim() : "";
    const imgurl = typeof cam.imgurl === "string" ? cam.imgurl.trim() : "";
    // Prefer cameras with a playable HLS URL. JPEG endpoints often
    // return empty bodies; HLS is what live.iticfoundation.org uses.
    if (!hls) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        id: cam.camid ?? `${lon},${lat}`,
        title: cam.title ?? "Traffic camera",
        org: cam.organization ?? "iTIC",
        hls,
        imgurl: imgurl || null,
        vdourl: cam.vdourl ?? null,
        link: cam.link ?? null,
        motion: cam.motion ?? null,
      },
    });
  }
  return {
    type: "FeatureCollection",
    name: "bkk-cctv-itic",
    source: LONGDO_CCTV_FEED,
    attribution: "iTIC Foundation / Longdo · public traffic cameras",
    disclaimer:
      "Public traffic CCTV only (roads / intersections). Not the full BMA security camera network. Feeds can drop without notice.",
    bbox: CCTV_BBOX,
    count: features.length,
    features,
  };
}

async function proxyCctv(_request: Request, _env: Env): Promise<Response> {
  try {
    const upstream = await fetchUpstream(LONGDO_CCTV_FEED, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!upstream.ok) {
      return jsonResponse(
        {
          error: "cctv_upstream_error",
          status: upstream.status,
          message: `iTIC camera feed returned ${upstream.status}. Client will fall back to /bkk-cctv.geojson.`,
        },
        { status: 502 },
      );
    }
    const cameras = (await upstream.json()) as LongdoCamera[];
    if (!Array.isArray(cameras)) {
      return jsonResponse(
        { error: "cctv_bad_payload", message: "Camera feed was not a JSON array." },
        { status: 502 },
      );
    }
    const geojson = camerasToGeoJson(cameras);
    return new Response(JSON.stringify(geojson), {
      status: 200,
      headers: {
        "content-type": "application/geo+json; charset=utf-8",
        "cache-control": `public, max-age=${CCTV_CACHE_TTL_SECONDS}`,
        "x-bkkx-source": "iTIC/Longdo camera feed",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "cctv_fetch_failed",
        message: String(error),
      },
      { status: 502 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// BKK provincial rain gauge network (HII/ThaiWater v3)
// Steals the gauge list that powers bangkok.thaiwater.net/dashboard
// so the atlas, war room, and any future page can render it under one
// Cache-Control contract. Province code 10 = Bangkok.
// ─────────────────────────────────────────────────────────────────

type BkkRainStation = {
  id: number;
  rain_24h: number | null;
  rain_1h: number | null;
  rainfall_datetime: string;
  station_type: string;
  agency: { agency_name?: { en?: string; th?: string }; agency_shortname?: { en?: string; th?: string } };
  geocode: {
    warning_zone?: string;
    area_code?: string;
    area_name?: { en?: string; th?: string };
    amphoe_name?: { en?: string; th?: string };
    tumbon_name?: { en?: string; th?: string };
    province_code?: string;
    province_name?: { en?: string; th?: string };
  };
  station: {
    id: number;
    tele_station_name?: { th?: string; en?: string };
    tele_station_lat: number;
    tele_station_long: number;
    tele_station_oldcode?: string;
    sub_basin_id?: string | number;
  };
  basin?: { basin_code?: number; basin_name?: { en?: string; th?: string } };
};

function severityOf(mm: number | null | undefined): string {
  if (mm == null) return "unknown";
  if (mm === 0) return "none";
  if (mm < 10) return "light";
  if (mm < 35) return "moderate";
  if (mm < 90) return "heavy";
  return "very-heavy";
}

function bkkRainStationsToGeoJson(rows: BkkRainStation[]) {
  const features = [];
  for (const r of rows) {
    const st = r.station || ({} as BkkRainStation["station"]);
    const geo = r.geocode || ({} as BkkRainStation["geocode"]);
    const ag = r.agency || {};
    const ag_name = ag.agency_name || {};
    const ag_short = ag.agency_shortname || {};
    const lat = Number(st.tele_station_lat);
    const lng = Number(st.tele_station_long);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const stName = st.tele_station_name || {};
    const rain24 = r.rain_24h == null ? null : Number(r.rain_24h);
    const rain1 = r.rain_1h == null ? null : Number(r.rain_1h);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))] },
      properties: {
        id: `bkk-rain-${st.id ?? r.id}`,
        station_id: st.id,
        station_oldcode: st.tele_station_oldcode,
        name: stName.th || stName.en || "(unnamed)",
        name_en: stName.en || "",
        agency: ag_name.en || ag_short.en || "HII",
        agency_th: ag_name.th || "",
        amphoe: geo.amphoe_name?.th || "",
        amphoe_en: geo.amphoe_name?.en || "",
        tumbon: geo.tumbon_name?.th || "",
        tumbon_en: geo.tumbon_name?.en || "",
        basin: r.basin?.basin_name?.en || r.basin?.basin_name?.th || "",
        rain_24h_mm: rain24,
        rain_1h_mm: rain1,
        severity: severityOf(rain24),
        observed_at: r.rainfall_datetime,
        station_type: r.station_type,
        sub_basin_id: st.sub_basin_id,
        warning_zone: geo.warning_zone,
        source: "ThaiWater v3 API · provinces/rain24?province_code=10",
      },
    });
  }
  return {
    type: "FeatureCollection",
    name: "bkk-rain-stations",
    featureCount: features.length,
    attribution:
      "Data: Hydro-Informatics Institute (สสน.) / ThaiWater v3 API · " +
      "Royal Irrigation Department · Department of Drainage, Bangkok (BMA).",
    features,
  };
}

async function fetchThaiwaterJson(url: string): Promise<{ ok: true; data: any } | { ok: false; status: number; message: string }> {
  try {
    const upstream = await fetchUpstream(url, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!upstream.ok) {
      return { ok: false, status: upstream.status, message: `ThaiWater returned ${upstream.status}.` };
    }
    return { ok: true, data: await upstream.json() };
  } catch (err) {
    return { ok: false, status: 502, message: String(err) };
  }
}

async function proxyBkkRainStations(_request: Request): Promise<Response> {
  const fetched = await fetchThaiwaterJson(BKK_RAIN24_URL);
  if (!fetched.ok) {
    return jsonResponse({ error: "bkk_rain_upstream_error", ...fetched }, { status: fetched.status });
  }
  const rows = fetched.data?.data;
  if (!Array.isArray(rows)) {
    return jsonResponse({ error: "bkk_rain_bad_payload", message: "ThaiWater did not return rain24.data." }, { status: 502 });
  }
  const geojson = bkkRainStationsToGeoJson(rows);
  return new Response(JSON.stringify(geojson), {
    status: 200,
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": `public, max-age=${BKK_WATER_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": "ThaiWater v3 · provinces/rain24?province_code=10",
      "access-control-allow-origin": "*",
    },
  });
}

// Derived top KPIs — the same 5-card strip the ThaiWater dashboard
// shows at the top of bangkok.thaiwater.net/dashboard:
//   24h rain | 3-day rain | 7-day rain | temp high / temp low
// Returns the single worst station per period as the "where" attribution
// the dashboard prints under each value.
async function proxyBkkRainKpi(_request: Request): Promise<Response> {
  const [rain1dRes, rain3dRes, rain7dRes, tempRes] = await Promise.all([
    fetchThaiwaterJson(BKK_RAIN1D_URL),
    fetchThaiwaterJson(BKK_RAIN3D_URL),
    fetchThaiwaterJson(BKK_RAIN7D_URL),
    fetchThaiwaterJson(BKK_TEMP_URL),
  ]);

  const fail = (name: string, res: { status: number; message: string }) => ({
    name, ...res,
  });
  if (!rain1dRes.ok) return jsonResponse({ error: "bkk_kpi_upstream_error", fail: fail("rain1d", rain1dRes) }, { status: rain1dRes.status });
  if (!rain3dRes.ok) return jsonResponse({ error: "bkk_kpi_upstream_error", fail: fail("rain3d", rain3dRes) }, { status: rain3dRes.status });
  if (!rain7dRes.ok) return jsonResponse({ error: "bkk_kpi_upstream_error", fail: fail("rain7d", rain7dRes) }, { status: rain7dRes.status });
  if (!tempRes.ok)  return jsonResponse({ error: "bkk_kpi_upstream_error", fail: fail("temperature", tempRes) }, { status: tempRes.status });

  const pickWorst = (rows: any[]): { mm: number | null; station?: { name: string; amphoe: string; lat: number; lng: number } } => {
    let worst: { mm: number | null; station?: any } = { mm: null };
    for (const r of rows || []) {
      const mm = Number(r.rain_1d ?? r.rain_3d ?? r.rain_7d ?? null);
      if (worst.mm == null || (Number.isFinite(mm) && mm > worst.mm)) {
        worst = {
          mm: Number.isFinite(mm) ? mm : worst.mm,
          station: r.station && r.geocode
            ? {
                name: r.station.tele_station_name?.th || r.station.tele_station_name?.en || "(unnamed)",
                amphoe: r.geocode.amphoe_name?.th || "",
                lat: r.station.tele_station_lat,
                lng: r.station.tele_station_long,
              }
            : worst.station,
        };
      }
    }
    return worst;
  };

  const tempRow = Array.isArray(tempRes.data?.data) && tempRes.data.data[0];
  const temp = tempRow
    ? {
        max_c: Number(tempRow.max_temperature),
        min_c: Number(tempRow.min_temperature),
        station: tempRow.station?.tele_station_name?.th || tempRow.station?.tele_station_name?.en || "",
        start_date: tempRow.start_date,
      }
    : null;

  const body = {
    tool: "bkk-water-kpi",
    version: 1,
    fetchedAt: new Date().toISOString(),
    province: { code: 10, name_en: "Bangkok", name_th: "กรุงเทพมหานคร" },
    rain: {
      "1d": pickWorst(rain1dRes.data?.data || []),
      "3d": pickWorst(rain3dRes.data?.data || []),
      "7d": pickWorst(rain7dRes.data?.data || []),
    },
    temperature: temp,
    attribution: "ThaiWater v3 API · provinces/rain{1,3,7}d + temperature_maxmin_thisweek · province_code=10",
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${BKK_WATER_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": "ThaiWater v3 · BKK provincial KPI strip",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// BKK incident heat — aggregates three incident streams so the atlas
// can render "where are the bad roads" as a single heat map.
//
// Sources:
//   1. city-events (Longdo/iTIC)  → per-point road incident reports
//      filtered to flood / roadclosed / rain / trafficjam. Each is
//      weighted 1.0 (flood, roadclosed) or 0.6 (rain, trafficjam).
//   2. news-events (Bangkok Post + Khaosod RSS)  → per-point venue
//      mentions of flood-related terms. Weight by mention count so a
//      venue talked about 6 times reads hotter than one mentioned once.
//   3. flood/bkk.roads.byDistrict (BMA DDS) → per-district flood
//      reports. Joined to bkk-districts.geojson on name_en to get a
//      centroid. Weight by report count / 5 (saturates at 1.0).
//
// All three streams are CORS-open + already serving, so this endpoint
// just fans out, joins, and emits one FeatureCollection. 2-min cache
// (faster than the upstream cache windows) since this is the read
// path for the atlas flood preset.
//
// Bounding box is hard-coded to Bangkok + 30 km halo to match the
// atlas `presets.flood` view.
// ─────────────────────────────────────────────────────────────────

const BKK_INCIDENT_BBOX = { minLat: 13.40, maxLat: 14.20, minLng: 100.20, maxLng: 100.95 };
const BKK_INCIDENT_HALO_BBOX = { minLat: 13.25, maxLat: 14.35, minLng: 100.05, maxLng: 101.10 };

// Weight table — single source of truth so the heat map reads the same
// in every source's contribution.
const INCIDENT_WEIGHTS: Record<string, number> = {
  flood: 1.0,
  roadclosed: 1.0,
  flood_warning: 1.0,
  rain: 0.6,
  trafficjam: 0.6,
  heavy_rain: 0.8,
  news_flood: 0.8,
  dds_road: 1.0,
  sensor_band: 0.8,
};

function pointInBbox(lng: number, lat: number, b: typeof BKK_INCIDENT_BBOX): boolean {
  return b.minLat <= lat && lat <= b.maxLat && b.minLng <= lng && lng <= b.maxLng;
}

function lonLatFromGeom(geom: any): [number, number] | null {
  if (!geom) return null;
  if (geom.type === "Point" && Array.isArray(geom.coordinates)) {
    const [lng, lat] = geom.coordinates;
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  return null;
}

function severityRank(b: string | undefined | null): number {
  // Higher = more urgent. Matches FloodDash band names verbatim
  // (server/indicator.js). Higher-rank bands paint hotter on the heat.
  const r: Record<string, number> = {
    safe: 1,
    watch: 2,
    prepare: 3,
    evacuate: 4,
    "overflow-imminent": 5,
    "observed-overflow": 6,
  };
  return r[b ?? ""] ?? 0;
}

async function proxyBkkIncidents(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Calls the upstream functions directly instead of self-fetching
  // (Worker → Worker self-fetch isn't reliable without a SELF binding).
  // Failures on individual sources fall back to whatever landed; the
  // endpoint never 502s on a partial failure.
  const [cityRes, newsRes, floodState] = await Promise.allSettled([
    listCityEvents(request, env, ctx),
    listNewsEvents(request, env, ctx),
    loadFloodState(env, () => floodDeps(env, request)),
  ]);

  const features: Array<{ type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: Record<string, unknown> }> = [];
  const sourceCounts: Record<string, number> = { city: 0, news: 0, dds: 0, sensor: 0 };

  // --- Source 1: city-events filtered to flood/roadclosed/rain/trafficjam ---
  if (cityRes.status === "fulfilled") {
    try {
      const data = await cityRes.value.json() as { features?: any[] };
      for (const f of data.features ?? []) {
        const p = f?.properties ?? {};
        const icon = String(p.icon ?? "").toLowerCase();
        if (!["flood", "roadclosed", "rain", "trafficjam"].includes(icon)) continue;
        const ll = lonLatFromGeom(f.geometry);
        if (!ll) continue;
        if (!pointInBbox(ll[0], ll[1], BKK_INCIDENT_HALO_BBOX)) continue;
        const weight = INCIDENT_WEIGHTS[icon] ?? 0.6;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: ll },
          properties: {
            source: "city-events",
            kind: icon,
            weight,
            title: p.titleEn ?? p.titleTh ?? null,
            // Reporters' names ("Report by …") identify residents — cut, never forwarded.
            description: String(p.descriptionEn ?? p.descriptionTh ?? "").split(/Report by|รายงานโดย/i)[0].trim() || null,
            age_min: p.ageMinutes ?? null,
            district_id: p.districtId ?? null,
            district_name_en: p.districtNameEn ?? null,
            observed_at: p.startsAt ?? null,
          },
        });
        sourceCounts.city++;
      }
    } catch { /* ignore per-stream parse failures */ }
  }

  // --- Source 2: news-events (any Bangkok venue mention — weight by mentions) ---
  if (newsRes.status === "fulfilled") {
    try {
      const data = await newsRes.value.json() as { features?: any[] };
      for (const f of data.features ?? []) {
        const p = f?.properties ?? {};
        const ll = lonLatFromGeom(f.geometry);
        if (!ll) continue;
        if (!pointInBbox(ll[0], ll[1], BKK_INCIDENT_HALO_BBOX)) continue;
        const mentions = Number(p.mentions ?? 1);
        const weight = INCIDENT_WEIGHTS.news_flood * Math.min(mentions / 3, 1.0);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: ll },
          properties: {
            source: "news-events",
            kind: "news_flood",
            weight,
            title: p.venueName ?? null,
            mentions,
            precision: p.precision ?? null,
            district_name_en: p.districtNameEn ?? null,
            latest_at: p.latestAt ?? null,
            article_count: Array.isArray(p.articles) ? p.articles.length : 0,
          },
        });
        sourceCounts.news++;
      }
    } catch { /* ignore */ }
  }

  // --- Source 3: BMA DDS road reports by district (centroid join) ---
  if (floodState.status === "fulfilled" && floodState.value) {
    try {
      const roads = floodState.value.roads;
      if (roads?.byDistrict?.length) {
        // Load district polygons once for the centroid join
        const districtsByName: Map<string, [number, number]> = new Map();
        try {
          const districtUrl = new URL("/bkk-districts.geojson", request.url);
          const districtsRes = await env.ASSETS.fetch(new Request(districtUrl.toString(), request));
          if (districtsRes.ok) {
            const dGeo = await districtsRes.json() as { features?: any[] };
            for (const f of dGeo.features ?? []) {
              const p = f?.properties ?? {};
              const nameEn = String(p.name_en ?? "").trim();
              if (!nameEn) continue;
              const ring = (f.geometry?.coordinates?.[0]) as number[][] | undefined;
              if (Array.isArray(ring) && ring.length > 0) {
                let sx = 0, sy = 0, n = 0;
                for (const [lng, lat] of ring) {
                  if (Number.isFinite(lng) && Number.isFinite(lat)) { sx += lng; sy += lat; n++; }
                }
                if (n > 0) districtsByName.set(nameEn, [sy / n, sx / n]);
              }
            }
          }
        } catch { /* ignore district load */ }

        for (const r of roads.byDistrict) {
          const nameEn = String(r.nameEn ?? "").trim();
          const reports = Number(r.reports ?? 0);
          if (!nameEn || reports === 0) continue;
          let centroid = districtsByName.get(nameEn);
          if (!centroid) centroid = [13.7563, 100.5018];
          const [lat, lng] = centroid;
          if (!pointInBbox(lng, lat, BKK_INCIDENT_HALO_BBOX)) continue;
          const weight = INCIDENT_WEIGHTS.dds_road * Math.min(reports / 5, 1.0);
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              source: "dds",
              kind: "dds_road",
              weight,
              title: nameEn,
              reports,
              max_depth_cm: r.maxDepthCm ?? null,
              unrecorded: r.clearanceUnrecorded ?? null,
              district_id: r.districtId ?? null,
              latest_flooded_at: r.latestFloodedAt ?? null,
            },
          });
          sourceCounts.dds++;
        }
      }
    } catch { /* ignore */ }
  }

  // --- Source 4: flood sensors in prepare/evacuate bands (only the loudest) ---
  if (floodState.status === "fulfilled" && floodState.value) {
    try {
      for (const g of floodState.value.gauges ?? []) {
        const ll: [number, number] | null = (g.lng != null && g.lat != null) ? [g.lng, g.lat] : null;
        if (!ll) continue;
        const band = String(g.band ?? "");
        if (!["prepare", "evacuate", "overflow-imminent", "observed-overflow"].includes(band)) continue;
        if (!pointInBbox(ll[0], ll[1], BKK_INCIDENT_HALO_BBOX)) continue;
        const weight = INCIDENT_WEIGHTS.sensor_band * (severityRank(band) / 4);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: ll },
          properties: {
            source: "flood-sensors",
            kind: "sensor_band",
            weight,
            title: g.name ?? null,
            band,
            band_label_en: g.bandEn ?? null,
            waterlevel_msl: g.waterlevelMsl ?? null,
            freeboard_m: g.freeboardM ?? null,
          },
        });
        sourceCounts.sensor++;
      }
    } catch { /* ignore */ }
  }

  // The envelope must not claim "just fetched" — derive fetchedAt from
  // the newest observation actually in the payload (2026-09-03 lesson:
  // honest data in the payload is not honest data on the envelope).
  // Sensor features carry no timestamp of their own, so the FloodDash
  // snapshot's fetchedAt stands in for them, and only when they exist.
  const stateFetchedAt = floodState.status === "fulfilled" && floodState.value && sourceCounts.sensor > 0
    ? floodState.value.fetchedAt ?? null
    : null;
  let newestObservedMs: number | null = stateFetchedAt ? Date.parse(stateFetchedAt) : null;
  if (newestObservedMs != null && !Number.isFinite(newestObservedMs)) newestObservedMs = null;
  for (const f of features) {
    for (const key of ["observed_at", "latest_at", "latest_flooded_at"]) {
      const raw = f.properties[key];
      if (typeof raw !== "string") continue;
      const ms = Date.parse(raw);
      if (Number.isFinite(ms) && (newestObservedMs == null || ms > newestObservedMs)) newestObservedMs = ms;
    }
  }

  return new Response(JSON.stringify({
    tool: "bkk-incidents",
    version: 1,
    fetchedAt: newestObservedMs != null ? new Date(newestObservedMs).toISOString() : new Date().toISOString(),
    bbox: BKK_INCIDENT_HALO_BBOX,
    counts: { total: features.length, bySource: sourceCounts },
    attribution: "Longdo/iTIC live incident feed · Bangkok Post + Khaosod RSS · BMA DDS road reports (via FloodDash relay)",
    features,
  }), {
    status: 200,
    headers: {
      "content-type": "application/geo+json; charset=utf-8",
      "cache-control": `public, max-age=${BKK_INCIDENTS_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": "city-events + news-events + BMA DDS road reports + flood-sensors (incident heat)",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// BKK flood prevention infrastructure — three new endpoints that
// surface the data inside FloodDash the atlas can act on:
//
//   /api/water/bkk/canal-gates      — BMA Drainage bulletin: 10 canal-gate
//     stations with current water level vs critical level. Points are
//     anchored at the gate name's centroid match (best-effort geocoded
//     against the existing bkk-khlongs.geojson + bkk-districts.geojson)
//     so the map can mark "the canal gate that is critical right now".
//
//   /api/water/bkk/roads-flooded   — BMA DDS dated road reports for
//     Bangkok: 66 road segments with depth, lanes, floodedAt /
//     clearedAt / status. District-anchored since the DDS feed does
//     not yet carry road coordinates.
//
//   /api/water/bkk/emergency-points — FloodDash confirmed emergency
//     points filtered to the Bangkok + 30 km halo. Each point carries
//     lat/lng + impact area + news count + max depth.
//
// All three are CORS-open, 5-min cache, with attribution.
// ─────────────────────────────────────────────────────────────────

// Lightweight Thai-name → coordinates anchor built from the khlongs
// and districts GeoJSON. Cached at module level. Used to place canal
// gates + flooded roads on the map even though the upstream feeds
// carry no coordinates.
let bkkAnchorCache: { khlongs: Map<string, [number, number]>; districts: Map<string, [number, number]>; builtAt: number } | null = null;
const BKK_ANCHOR_TTL_MS = 6 * 60 * 60 * 1000;

async function buildBkkAnchor(env: Env, request: Request): Promise<NonNullable<typeof bkkAnchorCache>> {
  if (bkkAnchorCache && Date.now() - bkkAnchorCache.builtAt < BKK_ANCHOR_TTL_MS) {
    return bkkAnchorCache;
  }
  const khlongs: Map<string, [number, number]> = new Map();
  const districts: Map<string, [number, number]> = new Map();
  try {
    const khlongsUrl = new URL("/bkk-khlongs.geojson", request.url);
    const kRes = await env.ASSETS.fetch(new Request(khlongsUrl.toString(), request));
    if (kRes.ok) {
      const k = await kRes.json() as { features?: any[] };
      for (const f of k.features ?? []) {
        const name = String(f.properties?.name ?? "").trim();
        if (!name) continue;
        const geom = f.geometry;
        let centroid: [number, number] | null = null;
        if (geom?.type === "LineString" && Array.isArray(geom.coordinates)) {
          let sx = 0, sy = 0, n = 0;
          for (const [lng, lat] of geom.coordinates) {
            if (Number.isFinite(lng) && Number.isFinite(lat)) { sx += lng; sy += lat; n++; }
          }
          if (n > 0) centroid = [sy / n, sx / n];
        } else if (geom?.type === "MultiLineString") {
          let sx = 0, sy = 0, n = 0;
          for (const line of geom.coordinates) for (const [lng, lat] of line) {
            if (Number.isFinite(lng) && Number.isFinite(lat)) { sx += lng; sy += lat; n++; }
          }
          if (n > 0) centroid = [sy / n, sx / n];
        }
        if (centroid) khlongs.set(name.toLowerCase(), centroid);
        // Also key by a stripped name (drop "คลอง" prefix, drop dashes, drop spaces)
        const stripped = name.replace(/^คลอง\s*/, "").replace(/[\s\-_]/g, "").toLowerCase();
        if (centroid && stripped && !khlongs.has(stripped)) khlongs.set(stripped, centroid);
      }
    }
  } catch { /* ignore */ }
  try {
    const distUrl = new URL("/bkk-districts.geojson", request.url);
    const dRes = await env.ASSETS.fetch(new Request(distUrl.toString(), request));
    if (dRes.ok) {
      const d = await dRes.json() as { features?: any[] };
      for (const f of d.features ?? []) {
        const name = String(f.properties?.name_en ?? f.properties?.name_th ?? "").trim();
        if (!name) continue;
        const ring = (f.geometry?.coordinates?.[0]) as number[][] | undefined;
        if (Array.isArray(ring) && ring.length > 0) {
          let sx = 0, sy = 0, n = 0;
          for (const [lng, lat] of ring) {
            if (Number.isFinite(lng) && Number.isFinite(lat)) { sx += lng; sy += lat; n++; }
          }
          if (n > 0) districts.set(name.toLowerCase(), [sy / n, sx / n]);
          // also by Thai
          const nameTh = String(f.properties?.name_th ?? "").trim();
          if (nameTh) districts.set(nameTh.toLowerCase(), [sy / n, sx / n]);
          const stripped = nameTh.replace(/^เขต/, "").trim();
          if (stripped) districts.set(stripped.toLowerCase(), [sy / n, sx / n]);
        }
      }
    }
  } catch { /* ignore */ }
  bkkAnchorCache = { khlongs, districts, builtAt: Date.now() };
  return bkkAnchorCache;
}

function pickAnchor(anchors: NonNullable<typeof bkkAnchorCache>, districtTh: string, nameTh: string): [number, number] | null {
  // Priority 1: khlongs name match (most precise for canal gates)
  if (nameTh) {
    const k1 = anchors.khlongs.get(nameTh.toLowerCase());
    if (k1) return k1;
    const stripped = nameTh.replace(/^ปตร\.?คลอง\s*/, "").replace(/^คลอง\s*/, "").trim();
    const k2 = anchors.khlongs.get(stripped.toLowerCase());
    if (k2) return k2;
    const k3 = anchors.khlongs.get(stripped.replace(/[\s\-_]/g, "").toLowerCase());
    if (k3) return k3;
  }
  // Priority 2: district centroid
  if (districtTh) {
    const d1 = anchors.districts.get(districtTh.toLowerCase());
    if (d1) return d1;
    const stripped = districtTh.replace(/^เขต/, "").trim();
    const d2 = anchors.districts.get(stripped.toLowerCase());
    if (d2) return d2;
  }
  return null;
}

async function proxyBkkCanalGates(request: Request, env: Env): Promise<Response> {
  const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/dds/briefing`, {
    headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
  });
  if (!direct.ok) {
    return jsonResponse({ error: "bkk_canal_gates_upstream_error", status: direct.status }, { status: 502 });
  }
  const data = await direct.json() as { bulletin?: { stations?: any[]; date?: string; stale?: boolean; fetchedAt?: string; source?: string } };
  const stations = data.bulletin?.stations ?? [];
  const anchors = await buildBkkAnchor(env, request);

  const features = [];
  for (const s of stations) {
    const name = String(s.name ?? "").trim();
    const level = Number(s.levelMsl);
    const critical = Number(s.criticalMsl);
    const yesterdayMax = Number(s.yesterdayMaxMsl);
    const status = String(s.statusTh ?? "");
    const side = String(s.side ?? "");
    let ll: [number, number] | null = pickAnchor(anchors, name, name);
    if (!ll) continue;  // skip stations we can't anchor
    const ratio = Number.isFinite(level) && Number.isFinite(critical) && critical > 0 ? level / critical : 0;
    let severity: string;
    let weight: number;
    if (status.includes("วิกฤติ")) { severity = "critical"; weight = 1.0; }
    else if (status.includes("เตือนภัย")) { severity = "warning"; weight = 0.7; }
    else { severity = "normal"; weight = 0.2; }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ll[1], ll[0]] },
      properties: {
        source: "bma-dds-bulletin",
        kind: "canal-gate",
        name,
        side,
        level_msl: Number.isFinite(level) ? level : null,
        critical_msl: Number.isFinite(critical) ? critical : null,
        yesterday_max_msl: Number.isFinite(yesterdayMax) ? yesterdayMax : null,
        ratio: Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null,
        status_th: status,
        severity,
        weight,
        observed_at: s.observedAt ?? null,
      },
    });
  }

  return jsonResponse({
    // MapLibre rejects a source without it ("not a valid GeoJSON object").
    type: "FeatureCollection",
    tool: "bkk-canal-gates",
    version: 1,
    fetchedAt: data.bulletin?.fetchedAt ?? null,
    bulletin_date: data.bulletin?.date ?? null,
    stale: data.bulletin?.stale ?? false,
    counts: { total: features.length, critical: features.filter(f => f.properties.severity === "critical").length, warning: features.filter(f => f.properties.severity === "warning").length, normal: features.filter(f => f.properties.severity === "normal").length },
    attribution: "BMA Drainage bulletin via FloodDash relay (flood.nonarkara.org/api/dds/briefing)",
    features,
  }, {
    headers: {
      "cache-control": `public, max-age=${BKK_WATER_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": "BMA Drainage bulletin · canal-gate water levels",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// /api/snap/<id> — Maholan community-CCTV snapshot proxy.
//
// Why this exists: cctv.maholan.net returns a real JPEG with
// `cache-control: public, max-age=14400` but no
// Access-Control-Allow-Origin header. The atlas popup renders the
// image inline; without ACAO the browser refuses to paint. We proxy,
// add ACAO *, pass through X-Image-Time so the popup can show
// "snapshot from 5 min ago", and surface an honest 502 if upstream
// is down.
//
// Atlas house rule: never fake a missing preview — if upstream
// returns non-image or fails, the proxy returns a tiny inline SVG
// that says "snapshot unavailable" so the popup never shows a
// broken-image glyph.
//
// Path shape: /api/snap/<id>[?w=<width>]   width is optional, capped
// at 1280 so the popup can't pull a 4K frame and OOM a phone.
// ─────────────────────────────────────────────────────────────────
const MAHOLAN_SNAP_BASE = "https://cctv.maholan.net/api/snap";
const MAHOLAN_SNAP_MAX_WIDTH = 1280;
async function proxyCctvSnapshot(request: Request, url: URL): Promise<Response> {
  const id = decodeURIComponent(url.pathname.slice("/api/snap/".length)).trim();
  if (!id || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
    return new Response("invalid camera id", { status: 400 });
  }
  const upstreamUrl = `${MAHOLAN_SNAP_BASE}/${encodeURIComponent(id)}`;
  const wParam = Number(url.searchParams.get("w"));
  const width = Number.isFinite(wParam) && wParam > 0
    ? Math.min(MAHOLAN_SNAP_MAX_WIDTH, Math.floor(wParam))
    : 0;
  const finalUrl = width > 0 ? `${upstreamUrl}?w=${width}` : upstreamUrl;

  // Maholan upstream returns `cache-control: public, max-age=14400`
  // and `access-control-expose-headers: X-Image-Time`. We mirror
  // those (without ACAO on the upstream, so we MUST add it on the
  // proxy response, not just rely on the upstream cache).
  const upstream = await fetchUpstream(finalUrl, {
    headers: {
      "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)",
      "accept": "image/jpeg,image/png,image/webp,image/*",
    },
  });
  if (!upstream.ok) {
    return placeholderImage(`Upstream ${upstream.status}`, 480, 270);
  }
  const ctype = upstream.headers.get("content-type") ?? "image/jpeg";
  if (!ctype.startsWith("image/")) {
    return placeholderImage("Maholan returned non-image", 480, 270);
  }
  // Edge cache: respect upstream's max-age if present, else 1 h.
  const upstreamCache = upstream.headers.get("cache-control") ?? "";
  const cacheHeader = upstreamCache.includes("max-age")
    ? upstreamCache
    : "public, max-age=600";
  const imageTime = upstream.headers.get("x-image-time");
  const headers = new Headers();
  headers.set("content-type", ctype);
  headers.set("cache-control", cacheHeader);
  headers.set("access-control-allow-origin", "*");
  if (imageTime) headers.set("x-image-time", imageTime);
  return new Response(upstream.body, { status: 200, headers });
}

// A 1-pixel-honest placeholder: a real SVG so the popup never shows
// a broken-image glyph. Tells the user WHY the preview is gone.
function placeholderImage(reason: string, w = 480, h = 270): Response {
  const safe = reason.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]!));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="100%" height="100%" fill="#11120f"/>
    <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="#3a3d36" stroke-width="1"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
      font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#c0bdb1">
      📷 snapshot unavailable
    </text>
    <text x="50%" y="${h - 16}" text-anchor="middle"
      font-family="ui-monospace,Menlo,Consolas,monospace" font-size="10" fill="#6b6d63">
      ${safe} · maholan community cctv
    </text>
  </svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=60",
      "access-control-allow-origin": "*",
    },
  });
}

async function proxyBkkRoadsFlooded(request: Request, env: Env): Promise<Response> {
  const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/dds/briefing`, {
    headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
  });
  if (!direct.ok) {
    return jsonResponse({ error: "bkk_roads_flooded_upstream_error", status: direct.status }, { status: 502 });
  }
  const data = await direct.json() as { roads?: { records?: any[]; days?: string[]; stale?: boolean; fetchedAt?: string; source?: string } };
  const records = data.roads?.records ?? [];
  const anchors = await buildBkkAnchor(env, request);

  const features = [];
  for (const r of records) {
    const district = String(r.district ?? "").trim();
    const road = String(r.road ?? "").trim();
    const location = String(r.location ?? "").trim();
    const depthCm = Number(r.depthCm);
    const lengthM = Number(r.lengthM);
    const floodedAt = r.floodedAt ?? null;
    const clearedAt = r.clearedAt ?? null;
    const status = String(r.status ?? "");
    const lanes = String(r.lanes ?? "");
    const id = String(r.id ?? `${district}/${road}/${floodedAt}`);

    let ll = pickAnchor(anchors, district, road);
    // District fallback if road-name lookup didn't match
    if (!ll) ll = pickAnchor(anchors, district, district);
    if (!ll) continue;

    let severity: string;
    let weight: number;
    if (status === "reported-cleared") { severity = "cleared"; weight = 0.15; }
    else if (status === "clearance-unrecorded") { severity = "unknown"; weight = 0.55; }
    else if (Number.isFinite(depthCm)) {
      if (depthCm >= 30) { severity = "severe"; weight = 1.0; }
      else if (depthCm >= 15) { severity = "moderate"; weight = 0.75; }
      else { severity = "shallow"; weight = 0.45; }
    } else {
      severity = "unknown"; weight = 0.4;
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ll[1], ll[0]] },
      properties: {
        source: "bma-dds-roads",
        kind: "road-flooded",
        name: road,
        district,
        location,
        depth_cm: Number.isFinite(depthCm) ? depthCm : null,
        length_m: Number.isFinite(lengthM) ? lengthM : null,
        lanes,
        status,
        severity,
        weight,
        flooded_at: floodedAt,
        cleared_at: clearedAt,
        date: r.date ?? null,
        id,
      },
    });
  }

  return jsonResponse({
    type: "FeatureCollection",
    tool: "bkk-roads-flooded",
    version: 1,
    fetchedAt: data.roads?.fetchedAt ?? null,
    days: data.roads?.days ?? [],
    stale: data.roads?.stale ?? false,
    counts: {
      total: features.length,
      byStatus: features.reduce((acc: Record<string, number>, f) => {
        const s = f.properties.status;
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      }, {}),
      bySeverity: features.reduce((acc: Record<string, number>, f) => {
        const s = f.properties.severity;
        acc[s] = (acc[s] ?? 0) + 1;
        return acc;
      }, {}),
    },
    attribution: "BMA DDS dated road reports via FloodDash relay (flood.nonarkara.org/api/dds/briefing)",
    features,
  }, {
    headers: {
      "cache-control": `public, max-age=${BKK_WATER_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": "BMA DDS · dated road reports (district-anchored)",
      "access-control-allow-origin": "*",
    },
  });
}

async function proxyBkkEmergencyPoints(request: Request, env: Env): Promise<Response> {
  const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/snapshot`, {
    headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
  });
  if (!direct.ok) {
    return jsonResponse({ error: "bkk_emergency_upstream_error", status: direct.status }, { status: 502 });
  }
  const data = await direct.json() as { emergency?: { points?: any[]; generated_at?: string; window_hours?: number } };
  const points = data.emergency?.points ?? [];
  const features = [];
  for (const p of points) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!pointInBbox(lng, lat, BKK_INCIDENT_HALO_BBOX)) continue;
    const score = Number(p.score);
    const depth = Number(p.depth_cm);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        source: "flooddash-emergency",
        kind: "emergency",
        name: p.area_en ?? p.area_th ?? p.place_en ?? p.place_th ?? "Emergency",
        province: p.province_en ?? p.province_th ?? null,
        score: Number.isFinite(score) ? score : null,
        band: p.band ?? null,
        severity: p.severity ?? null,
        tier: p.tier ?? null,
        depth_cm: Number.isFinite(depth) ? depth : null,
        news_count: p.news_count ?? null,
        latest_at: p.latest_at ?? null,
        impacts: Array.isArray(p.impacts) ? p.impacts : [],
        news: Array.isArray(p.news) ? p.news.slice(0, 3).map((n: any) => ({ title: n.title, link: n.link, source: n.source })) : [],
      },
    });
  }
  return jsonResponse({
    type: "FeatureCollection",
    tool: "bkk-emergency-points",
    version: 1,
    fetchedAt: data.emergency?.generated_at ?? null,
    window_hours: data.emergency?.window_hours ?? null,
    counts: { total: features.length },
    attribution: "FloodDash emergency aggregator (flood.nonarkara.org) · news-anchored flood-affected locations",
    features,
  }, {
    headers: {
      "cache-control": `public, max-age=${BKK_INCIDENTS_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": "FloodDash confirmed emergency points · BKK + 30km halo",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Dams (2026-09-29) — pulled from FloodDash's snapshot.dams. The Chao
// Phraya basin dams are upstream of Bangkok and their release schedule
// drives the river level the atlas already colours. Surface them as
// map markers so a person can read "Bhumibol is 87% full" without
// leaving the atlas.
// ─────────────────────────────────────────────────────────────────

const DAM_BBOX = { minLat: 12.5, maxLat: 20.5, minLng: 97.0, maxLng: 106.0 };

async function proxyBkkDams(request: Request, env: Env): Promise<Response> {
  const cached = await withD1Cache<unknown>(env, "bkk-dams", BKK_WATER_CACHE_TTL_SECONDS, async () => {
    const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/snapshot`, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!direct.ok) return null;
    const data = await direct.json() as { dams?: any[]; now?: string };
    const features = [];
    for (const d of (data.dams ?? [])) {
      const lat = Number(d.lat);
      const lng = Number(d.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < DAM_BBOX.minLat || lat > DAM_BBOX.maxLat || lng < DAM_BBOX.minLng || lng > DAM_BBOX.maxLng) continue;
      const storagePct = Number(d.dam_storage_pct);
      const storageMcm = Number(d.dam_storage_mcm);
      const inflowMcm = Number(d.dam_inflow_mcm);
      const releasedMcm = Number(d.dam_released_mcm);
      const maxStorage = Number(d.meta?.max_storage_mcm);
      let severity: string;
      if (!Number.isFinite(storagePct)) severity = "unknown";
      else if (storagePct >= 90) severity = "critical";
      else if (storagePct >= 80) severity = "warning";
      else if (storagePct >= 60) severity = "watch";
      else severity = "safe";
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          source: "flooddash-dams",
          kind: "dam",
          key: d.key,
          name_th: d.name_th || "",
          name_en: d.name_en || "",
          basin_th: d.basin_th || "",
          basin_en: d.basin_en || "",
          province_th: d.province_th || "",
          province_en: d.province_en || "",
          storage_pct: Number.isFinite(storagePct) ? Number(storagePct.toFixed(1)) : null,
          storage_mcm: Number.isFinite(storageMcm) ? Number(storageMcm.toFixed(2)) : null,
          inflow_mcm: Number.isFinite(inflowMcm) ? Number(inflowMcm.toFixed(2)) : null,
          released_mcm: Number.isFinite(releasedMcm) ? Number(releasedMcm.toFixed(2)) : null,
          max_storage_mcm: Number.isFinite(maxStorage) ? maxStorage : null,
          obs_time: d.obs_time || null,
          age_min: Number(d.age_min) || null,
          confidence: d.data_confidence || "ok",
          severity,
          weight: Number.isFinite(storagePct) ? storagePct / 100 : 0,
        },
      });
    }
    return {
      payload: {
        type: "FeatureCollection",
        tool: "bkk-dams",
        version: 1,
        fetchedAt: data.now ?? new Date().toISOString(),
        counts: {
          total: features.length,
          critical: features.filter((f: any) => f.properties.severity === "critical").length,
          warning: features.filter((f: any) => f.properties.severity === "warning").length,
          watch: features.filter((f: any) => f.properties.severity === "watch").length,
          safe: features.filter((f: any) => f.properties.severity === "safe").length,
        },
        attribution: "FloodDash dam aggregator (flood.nonarkara.org/api/snapshot) · RID + EGAT via HII",
        features,
      },
      upstreamFetchedAt: data.now ?? new Date().toISOString(),
    };
  });
  if (!cached) {
    return jsonResponse({ error: "bkk_dams_upstream_error" }, { status: 502 });
  }
  return jsonResponse(cached.payload, {
    headers: {
      "cache-control": `public, max-age=${BKK_WATER_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": cached.fromCache
        ? "FloodDash major dams (D1 cache hit)"
        : "FloodDash major dams · Chao Phraya + nearby basins (D1 cache miss → upstream)",
      "x-bkkx-cache": cached.fromCache ? "HIT" : "MISS",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Active flood alerts (2026-09-29) — pulled from FloodDash's
// snapshot.alerts. Each alert has a Thai + English message, the
// upstream source, severity, and station. Filter to Bangkok + 30 km
// halo so the atlas panel doesn't fill with Rayong/Sukhothai noise.
// ─────────────────────────────────────────────────────────────────

const ALERT_HALO_BBOX = { minLat: 13.25, maxLat: 14.50, minLng: 99.80, maxLng: 101.20 };

async function proxyBkkAlerts(request: Request, env: Env): Promise<Response> {
  const cached = await withD1Cache<unknown>(env, "bkk-alerts", BKK_INCIDENTS_CACHE_TTL_SECONDS, async () => {
    const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/snapshot`, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!direct.ok) return null;
    const data = await direct.json() as { alerts?: any[]; now?: string };
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const filtered = [];
    for (const a of alerts) {
      const provinceEn = String(a.province_en || "");
      const upstream = new Set(["Bangkok", "Nonthaburi", "Pathum Thani", "Samut Prakan",
        "Nakhon Pathom", "Samut Sakhon", "Tak", "Nakhon Sawan", "Uthai Thani",
        "Chainat", "Sing Buri", "Ang Thong", "Ayutthaya", "Suphan Buri"]);
      if (!upstream.has(provinceEn)) continue;
      filtered.push(a);
    }
    const severityCounts = filtered.reduce((acc, a) => {
      const s = Number(a.severity) || 0;
      if (s >= 4) acc.critical++;
      else if (s >= 3) acc.high++;
      else if (s >= 2) acc.watch++;
      else acc.info++;
      return acc;
    }, { critical: 0, high: 0, watch: 0, info: 0 });
    return {
      payload: {
        tool: "bkk-alerts",
        version: 1,
        fetchedAt: data.now ?? new Date().toISOString(),
        counts: { total: filtered.length, ...severityCounts },
        attribution: "FloodDash alert engine (flood.nonarkara.org/api/snapshot) · thaiwater_wl + ff_imminent + precursors",
        items: filtered.slice(0, 30).map((a: any) => ({
          id: a.id,
          ts: a.ts,
          rule: a.rule || "",
          source: a.source || "",
          station_key: a.station_key || "",
          province_th: a.province_th || "",
          province_en: a.province_en || "",
          severity: Number(a.severity) || 0,
          value: a.value ?? null,
          prev_value: a.prev_value ?? null,
          message_th: a.message_th || "",
          message_en: a.message_en || "",
        })),
      },
      upstreamFetchedAt: data.now ?? new Date().toISOString(),
    };
  });
  if (!cached) return jsonResponse({ error: "bkk_alerts_upstream_error" }, { status: 502 });
  return jsonResponse(cached.payload, {
    headers: {
      "cache-control": `public, max-age=${BKK_INCIDENTS_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": cached.fromCache
        ? "FloodDash active alerts (D1 cache hit)"
        : "FloodDash active alerts (D1 cache miss → upstream)",
      "x-bkkx-cache": cached.fromCache ? "HIT" : "MISS",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Maholan community CCTV (2026-09-30) — pulls cctv.maholan.net's
// consolidated feed of 2,355 cameras across Thailand (BKK + 30 km
// halo ≈ 1,748 cameras, of which 123 are live right now). The atlas
// already had iTIC/Longdo via /api/cctv (~66 cameras); this fills the
// gap with provincial, DOH and community cameras — Pak Kret water-
// level camera, Pathum Thani river gauge, BKK district cameras, the
// Maholan community submissions — and gives the atlas ~10× the
// coverage when the user turns the new layer on.
//
// The Maholan site bundles YouTube + MJPEG + HLS + snapshot streams
// in one normalised API. We pass each camera's id + region + source
// + type through so the atlas can render different markers per
// type (hls = live, mjpeg = animated, snapshot = static refresh).
// AI flood detections from the same site are exposed via
// /api/water/bkk/ai-flood-detections for a follow-up.
// ─────────────────────────────────────────────────────────────────

const MAHOLAN_BBOX = { minLat: 13.20, maxLat: 14.40, minLng: 99.85, maxLng: 101.15 };

async function proxyMaholanCctv(request: Request, env: Env): Promise<Response> {
  const cached = await withD1Cache<unknown>(env, "maholan-cctv", CCTV_CACHE_TTL_SECONDS, async () => {
    const direct = await fetchUpstream("https://cctv.maholan.net/api/cameras", {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org) · atlas@cctv.maholan" },
    });
    if (!direct.ok) return null;
    const data = await direct.json() as { cameras?: any[]; links?: any; generated_at?: string; updatedAt?: string; fetchedAt?: string };
    const cameras = Array.isArray(data.cameras) ? data.cameras : [];
    const features: any[] = [];
    const liveCount = { hls: 0, mjpeg: 0, snapshot: 0, other: 0 };
    for (const c of cameras) {
      const lat = Number(c.lat);
      const lng = Number(c.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < MAHOLAN_BBOX.minLat || lat > MAHOLAN_BBOX.maxLat || lng < MAHOLAN_BBOX.minLng || lng > MAHOLAN_BBOX.maxLng) continue;
      const type = String(c.type || "other");
      const severity = c.live ? "live" : "stale";
      if (c.live) {
        if (type in liveCount) liveCount[type as keyof typeof liveCount]++;
        else liveCount.other++;
      }
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          source: "maholan-cctv",
          kind: "maholan-cam",
          id: c.id,
          name: c.name || c.id,
          name_en: c.name_en || "",
          region: c.region || "",
          district: c.district || "",
          upstream_source: c.source || "",
          upstream_type: type,
          live: !!c.live,
          configured: c.configured !== false,
          ttl_ms: Number(c.ttlMs) || null,
          viewer_url: `https://cctv.maholan.net/?cam=${encodeURIComponent(c.id)}`,
          snap_url: `https://cctv.maholan.net/api/snap/${encodeURIComponent(c.id)}`,
          severity,
          weight: c.live ? 0.9 : 0.3,
        },
      });
    }
    return {
      payload: {
        type: "FeatureCollection",
        tool: "bkk-maholan-cctv",
        version: 1,
        fetchedAt: data.generated_at ?? data.updatedAt ?? data.fetchedAt ?? new Date().toISOString(),
        note: "live/offline flags are as reported by the upstream aggregator; not independently verified",
        counts: {
          total: features.length,
          live: features.filter((f) => f.properties.live).length,
          ...liveCount,
        },
        attribution: "Maholan community CCTV aggregator (cctv.maholan.net/api/cameras) · 2,355 cameras across Thailand, filtered to BKK + 30 km halo",
        features,
      },
      upstreamFetchedAt: new Date().toISOString(),
    };
  });
  if (!cached) return jsonResponse({ error: "maholan_cctv_upstream_error" }, { status: 502 });
  return jsonResponse(cached.payload, {
    headers: {
      "cache-control": `public, max-age=${CCTV_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": cached.fromCache
        ? "Maholan community CCTV (D1 cache hit)"
        : "Maholan community CCTV (D1 cache miss → upstream)",
      "x-bkkx-cache": cached.fromCache ? "HIT" : "MISS",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// News watch (2026-09-29) — pulls FloodDash's snapshot.news which is
// a curated Thai-language flood news feed (gnews_flood: Google News
// filtered to flood terms, plus the Bangkok Post / Khaosod / Thai PBS
// official outlets via the same relay). This is the "trusted sources
// about flood predictions" surface the user wants at the top of the
// sidebar — the headline answer to "what is Bangkok's newsroom
// saying right now".
//
// Severity is derived from the title: explicit evacuate/urgent/warn
// keywords trigger red; advisories/watches orange; status updates
// yellow; routine coverage neutral. Honest degradation: empty feed is
// still surfaced as "0 items" — not an all-clear on its own.
// ─────────────────────────────────────────────────────────────────

const FLOOD_NEWS_URGENT_KEYWORDS = ["อพยพ", "ด่วน", "ประกาศเตือน", "วิกฤต", "น้ำล้นตลิ่ง", "evacuat", "urgent", "critical"];
const FLOOD_NEWS_WATCH_KEYWORDS = ["เตือน", "ระวัง", "น้ำท่วม", "ท่วม", "น้ำขึ้น", "ฝนตกหนัก", "warn", "flood", "rising"];
const FLOOD_NEWS_ADVISORY_KEYWORDS = ["อัปเดต", "สถานการณ์", "มาตรการ", "ช่วยเหลือ", "ฟื้นฟู", "update", "advisory"];

function deriveNewsSeverity(title: string): string {
  const t = String(title || "").toLowerCase();
  if (FLOOD_NEWS_URGENT_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) return "urgent";
  if (FLOOD_NEWS_WATCH_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) return "watch";
  if (FLOOD_NEWS_ADVISORY_KEYWORDS.some((k) => t.includes(k.toLowerCase()))) return "advisory";
  return "info";
}

function extractSourceDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function proxyNewsWatch(request: Request, env: Env): Promise<Response> {
  const cached = await withD1Cache<unknown>(env, "news-watch", BKK_INCIDENTS_CACHE_TTL_SECONDS, async () => {
    const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/snapshot`, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!direct.ok) return null;
    const data = await direct.json() as { news?: any[]; now?: string };
    const items = Array.isArray(data.news) ? data.news : [];
    const severityCounts: Record<string, number> = { urgent: 0, watch: 0, advisory: 0, info: 0 };
    const cleaned: any[] = [];
    for (const n of items) {
      const title = String(n.title || "");
      const link = String(n.link || "");
      const severity = deriveNewsSeverity(title);
      severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
      cleaned.push({
        feed: n.feed || "flooddash-news",
        title,
        link,
        source_domain: extractSourceDomain(link),
        published_at: n.published_at || null,
        severity,
      });
    }
    cleaned.sort((a, b) => {
      const ta = a.published_at ? Date.parse(a.published_at) : 0;
      const tb = b.published_at ? Date.parse(b.published_at) : 0;
      return tb - ta;
    });
    const TRUSTED_SOURCES = new Set([
      "bangkokpost.com", "khaosodenglish.com", "nationthailand.com", "thaipbs.or.th",
      "thairath.co.th", "dailynews.co.th", "matichon.co.th", "prachachat.net",
      "bbc.com", "bbc.co.uk", "reuters.com", "apnews.com", "theguardian.com",
      "channelnewsasia.com", "straitstimes.com", "tnatoday.com", "workpointtoday.com",
      "news.google.com", "line.me", "thansettakij.com", "mcot.net", "pptvhd36.com",
      "thailandplus.tv", "bangkokinsight.com",
    ]);
    for (const item of cleaned) item.trusted = TRUSTED_SOURCES.has(item.source_domain);
    return {
      payload: {
        tool: "bkk-news-watch",
        version: 1,
        fetchedAt: data.now ?? new Date().toISOString(),
        counts: {
          total: cleaned.length,
          ...severityCounts,
          trusted: cleaned.filter((i: any) => i.trusted).length,
        },
        attribution: "FloodDash gnews_flood relay (flood.nonarkara.org/api/snapshot) · Google News flood filter + Bangkok Post / Khaosod / Thai PBS",
        items: cleaned.slice(0, 12),
      },
      upstreamFetchedAt: data.now ?? new Date().toISOString(),
    };
  });
  if (!cached) return jsonResponse({ error: "news_watch_upstream_error" }, { status: 502 });
  return jsonResponse(cached.payload, {
    headers: {
      "cache-control": `public, max-age=${BKK_INCIDENTS_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": cached.fromCache
        ? "FloodDash flood news (D1 cache hit)"
        : "FloodDash flood news (D1 cache miss → upstream)",
      "x-bkkx-cache": cached.fromCache ? "HIT" : "MISS",
      "access-control-allow-origin": "*",
    },
  });
}

// ─────────────────────────────────────────────────────────────────
// Sources health (2026-09-29) — pulls FloodDash's snapshot.sources
// which lists 40+ upstream feeds (BMA DDS, HII, ThaiWater, RID, GISTDA,
// PCD, Air4Thai, etc.) with last-run / last-OK / failure counts. The
// atlas paints each as a coloured dot so a person reading the
// situation board can see when one of the 40 feeds is dead.
// ─────────────────────────────────────────────────────────────────

async function proxySourcesHealth(request: Request, env: Env): Promise<Response> {
  const cached = await withD1Cache<unknown>(env, "sources-health", BKK_INCIDENTS_CACHE_TTL_SECONDS, async () => {
    const direct = await fetchUpstream(`${FLOODDASH_ORIGIN}/api/snapshot`, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!direct.ok) return null;
    const data = await direct.json() as { sources?: Record<string, any>; now?: string; system_counts?: any };
    const sources = data.sources || {};
    const items: any[] = [];
    let ok = 0, fail = 0, never = 0;
    for (const [key, info] of Object.entries(sources)) {
      const i = info as any;
      const failures = Number(i.failures) || 0;
      const lastError = String(i.lastError || "");
      const lastOk = i.lastOk ? Date.parse(i.lastOk) : NaN;
      const ageMin = Number.isFinite(lastOk) ? Math.max(0, Math.round((Date.now() - lastOk) / 60000)) : null;
      let status: string;
      if (!i.lastRun || lastError.startsWith("skipped")) status = "skipped";
      else if (failures > 0) status = "degraded";
      else if (ageMin == null) status = "stale";
      else if (ageMin > 180) status = "stale";
      else status = "ok";
      if (status === "ok") ok++;
      else if (status === "skipped") never++;
      else fail++;
      items.push({
        key,
        label_th: i.label_th || "",
        label_en: i.label_en || "",
        interval_ms: Number(i.intervalMs) || null,
        failures,
        last_run: i.lastRun || null,
        last_ok: i.lastOk || null,
        last_error: i.lastError || null,
        age_min: ageMin,
        status,
      });
    }
    items.sort((a, b) => {
      const order: Record<string, number> = { degraded: 0, stale: 1, skipped: 2, ok: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.age_min ?? 9999) - (b.age_min ?? 9999);
    });
    return {
      payload: {
        tool: "sources-health",
        version: 1,
        fetchedAt: data.now ?? new Date().toISOString(),
        system_counts: data.system_counts || null,
        counts: { total: items.length, ok, degraded: fail, stale: fail, skipped: never },
        attribution: "FloodDash ingest health (flood.nonarkara.org/api/snapshot) · 40 upstream feeds",
        items,
      },
      upstreamFetchedAt: data.now ?? new Date().toISOString(),
    };
  });
  if (!cached) return jsonResponse({ error: "sources_health_upstream_error" }, { status: 502 });
  return jsonResponse(cached.payload, {
    headers: {
      "cache-control": `public, max-age=${BKK_INCIDENTS_CACHE_TTL_SECONDS}`,
      "x-bkkx-source": cached.fromCache
        ? "FloodDash upstream feed health (D1 cache hit)"
        : "FloodDash upstream feed health (D1 cache miss → upstream)",
      "x-bkkx-cache": cached.fromCache ? "HIT" : "MISS",
      "access-control-allow-origin": "*",
    },
  });
}

const CIVIC_POI_CATEGORIES = new Set(["school", "sportsground", "carpark", "museum", "waterway"]);
const CIVIC_POI_CACHE_TTL_SECONDS = 3600;

type CivicPoiRow = {
  id: string;
  category: string;
  name: string;
  lat: number;
  lng: number;
  district_id: number | null;
  district_name_en: string | null;
  address: string | null;
  properties: string;
};

/** Real, D1-backed civic POIs (schools, sports grounds, car parks, local
 * museums, waterway landmarks) — ingested from data.go.th / data.bangkok.go.th
 * by scripts/ingest-bma-open-data.py, not fetched live per request. See
 * db/schema.sql for the store this reads from. */
async function listCivicPois(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  if (category && !CIVIC_POI_CATEGORIES.has(category)) {
    return jsonResponse(
      {
        error: "invalid_category",
        message: `category must be one of: ${[...CIVIC_POI_CATEGORIES].join(", ")}`,
      },
      { status: 400 },
    );
  }
  const stmt = category
    ? env.CIVIC_DB.prepare("SELECT * FROM civic_pois WHERE category = ?").bind(category)
    : env.CIVIC_DB.prepare("SELECT * FROM civic_pois");
  const { results } = await stmt.all<CivicPoiRow>();
  const features = results.map((row) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [row.lng, row.lat] },
    properties: {
      id: row.id,
      category: row.category,
      name: row.name,
      districtId: row.district_id,
      districtNameEn: row.district_name_en,
      address: row.address,
      ...JSON.parse(row.properties || "{}"),
    },
  }));
  return jsonResponse(
    {
      type: "FeatureCollection",
      count: features.length,
      attribution: "data.go.th / data.bangkok.go.th (Bangkok Metropolitan Administration, CC-licensed)",
      features,
    },
    { headers: { "cache-control": `public, max-age=${CIVIC_POI_CACHE_TTL_SECONDS}` } },
  );
}

/** Per-district civic-amenity counts — the "consistently analyzed" half of
 * the store: aggregated server-side from the same D1 rows listCivicPois
 * serves individually, so the client doesn't recompute this from a full
 * point dump on every load. Districts are matched at ingest time via
 * point-in-polygon against bkk-districts.geojson (see the ETL script), not
 * trusted from the source's own numeric dcode. */
async function civicPoiAnalysis(_request: Request, env: Env): Promise<Response> {
  const { results } = await env.CIVIC_DB.prepare(
    `SELECT district_id, district_name_en, category, COUNT(*) as n
     FROM civic_pois
     WHERE district_id IS NOT NULL
     GROUP BY district_id, category
     ORDER BY district_id`,
  ).all<{ district_id: number; district_name_en: string; category: string; n: number }>();

  const byDistrict = new Map<number, { districtId: number; districtNameEn: string; counts: Record<string, number>; total: number }>();
  for (const row of results) {
    if (!byDistrict.has(row.district_id)) {
      byDistrict.set(row.district_id, {
        districtId: row.district_id,
        districtNameEn: row.district_name_en,
        counts: {},
        total: 0,
      });
    }
    const entry = byDistrict.get(row.district_id)!;
    entry.counts[row.category] = row.n;
    entry.total += row.n;
  }

  return jsonResponse(
    {
      tool: "civic-poi-analysis",
      unit: "count of civic amenities per district (schools, sports grounds, car parks, museums, waterway landmarks)",
      districts: [...byDistrict.values()].sort((a, b) => b.total - a.total),
      disclaimer:
        "Counts reflect what's in the source open-data extracts, not a complete inventory — e.g. car parks (4 citywide) is BMA's own operated lots only, not every parking facility.",
    },
    { headers: { "cache-control": `public, max-age=${CIVIC_POI_CACHE_TTL_SECONDS}` } },
  );
}

// ─────────────────────────────────────────────────────────────────
// City events ("God Mode" breaking-incident layer)
//
// Source: Longdo/iTIC public event feed — live Thai road/city incidents
// with REAL reporter-supplied lat/lng. Nothing here is geocoded by us:
// an event either arrives with coordinates or it is not stored.
//
// Two editorial rules, both grounded in what the feed actually contains:
//
//  1. Only genuinely breaking incident types get a pin. The feed is
//     dominated by `diversion` roadworks that run for MONTHS (observed:
//     a July diversion with a stop date the following January). Those
//     are standing conditions, not breaking events — pinning them would
//     bury the real incidents under permanent clutter.
//  2. A pin lives EVENT_TTL_MINUTES from when we first saw it, or until
//     the source's own stop time, whichever comes first. Accidents in
//     this feed already carry ~1h windows, so this mostly honours the
//     source; the cap just guarantees the map self-clears.
// ─────────────────────────────────────────────────────────────────

const LONGDO_EVENT_FEED = "https://event.longdo.com/feed/json";
const EVENT_TTL_MINUTES = 60;
const CITY_EVENT_CACHE_TTL_SECONDS = 60;

/** An incident whose source-declared window is longer than this is a
 * standing condition, not breaking news — observed in the live feed: a
 * "roadclosed" at Ratchathewi Overpass with a stop date two years out,
 * and diversions running six months. Duration is a better signal than
 * the icon alone, since both long closures and real ones share icons. */
const MAX_BREAKING_DURATION_HOURS = 24;

/** Incident types that count as "breaking". Long-running roadworks
 * (`diversion`) are deliberately excluded — see rule 1 above. */
const BREAKING_EVENT_ICONS = new Set([
  "accident",
  "flood",
  "fire",
  "trafficjam",
  "roadclosed",
  "rain",
  "earthquake",
  "protest",
  // `warning` looked like generic noise until the live feed showed what
  // it actually carries: active MRT lane closures posted minutes earlier
  // with 1-hour windows — textbook breaking. The duration rule below is
  // what keeps the long-running ones out, so the icon can stay inclusive.
  "warning",
]);

type LongdoEvent = {
  eid?: string | number;
  title?: string;
  title_en?: string;
  description?: string;
  description_en?: string;
  latitude?: string | number;
  longitude?: string | number;
  type?: string | number;
  start?: string;
  stop?: string;
  contributor?: string;
  icon?: string;
  severity?: string | number;
};

type CityEventRow = {
  id: string;
  title_th: string | null;
  title_en: string | null;
  description_th: string | null;
  description_en: string | null;
  lat: number;
  lng: number;
  icon: string | null;
  event_type: string | null;
  severity: string | null;
  contributor: string | null;
  starts_at: string | null;
  stops_at: string | null;
  district_id: number | null;
  district_name_en: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

/** The feed reports Asia/Bangkok wall-clock with no offset ("2026-08-09
 * 22:36:00"). Parse it as UTC+7 explicitly rather than letting the
 * runtime guess — a Worker runs in UTC, so a naive parse would put every
 * event 7 hours in the future and nothing would ever look expired. */
function parseBangkokTime(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)) - 7 * 3600 * 1000;
}

function findDistrictForPoint(
  districts: AtlasFeatureCollection | null,
  lng: number,
  lat: number,
): { id: number | null; name: string | null } {
  for (const feature of districts?.features ?? []) {
    const g = feature.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (!g) continue;
    let hit = false;
    if (g.type === "Polygon") {
      const rings = g.coordinates as number[][][];
      hit = pointInRing(lng, lat, rings[0]) && !rings.slice(1).some((h) => pointInRing(lng, lat, h));
    } else if (g.type === "MultiPolygon") {
      const polys = g.coordinates as number[][][][];
      hit = polys.some(
        (poly) => pointInRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => pointInRing(lng, lat, h)),
      );
    }
    if (hit) {
      const p = (feature.properties ?? {}) as { id?: number; name_en?: string };
      return { id: p.id ?? null, name: (p.name_en ?? "").replace(" District", "") || null };
    }
  }
  return { id: null, name: null };
}

/** Poll the upstream feed and upsert Bangkok breaking incidents into D1.
 * Safe to call often — it's an upsert keyed on the source event id, so
 * repeated polls refresh last_seen_at without duplicating pins. */
async function ingestCityEvents(env: Env, request: Request): Promise<{ scanned: number; stored: number; skipped: number }> {
  const upstream = await fetchUpstream(LONGDO_EVENT_FEED, {
    headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
  });
  if (!upstream.ok) throw new Error(`Longdo feed returned ${upstream.status}`);
  const events = (await upstream.json()) as LongdoEvent[];
  if (!Array.isArray(events)) throw new Error("Longdo feed was not a JSON array");

  const districts = await getDistrictsGeoJson(env, request);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let stored = 0;
  let skipped = 0;

  for (const e of events) {
    const lat = Number(e.latitude);
    const lng = Number(e.longitude);
    const id = e.eid == null ? null : String(e.eid);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) { skipped++; continue; }
    if (!inCctvBbox(lat, lng)) { skipped++; continue; }        // Bangkok metro only
    const icon = (e.icon ?? "").toLowerCase();
    if (!BREAKING_EVENT_ICONS.has(icon)) { skipped++; continue; }  // rule 1

    // Rule 1b: drop standing conditions dressed as incidents — a closure
    // scheduled to end in 2028 is roadworks, not something breaking now.
    const startMs = parseBangkokTime(e.start);
    const stopMs = parseBangkokTime(e.stop);
    if (startMs != null && stopMs != null &&
        stopMs - startMs > MAX_BREAKING_DURATION_HOURS * 3600 * 1000) {
      skipped++;
      continue;
    }

    const { id: districtId, name: districtName } = findDistrictForPoint(districts, lng, lat);
    statements.push(
      env.CIVIC_DB.prepare(
        `INSERT INTO city_events
           (id, title_th, title_en, description_th, description_en, lat, lng, icon,
            event_type, severity, contributor, starts_at, stops_at,
            district_id, district_name_en, first_seen_at, last_seen_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = ?16`,
      ).bind(
        id,
        e.title ?? null,
        e.title_en || null,
        e.description ?? null,
        e.description_en || null,
        lat,
        lng,
        icon || null,
        e.type == null ? null : String(e.type),
        e.severity == null || e.severity === "" ? null : String(e.severity),
        e.contributor ?? null,
        e.start ?? null,
        e.stop ?? null,
        districtId,
        districtName,
        now,
      ),
    );
    stored++;
  }

  if (statements.length) await env.CIVIC_DB.batch(statements);
  return { scanned: events.length, stored, skipped };
}

/** Live breaking events as GeoJSON. Ingest runs in the background so the
 * visitor reads D1 immediately; the cron keeps it warm every 5 min. */

// In-isolate throttle for background ingests (resets on cold start). With
// the 60s edge cache on the response this bounds upstream hammering even
// under concurrent visitors.
let lastCityIngestMs = 0;
const CITY_INGEST_EVERY_MS = 120_000;

async function listCityEvents(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  // Ingest in the background (news-events pattern): the visitor reads D1
  // immediately and concurrent visitors no longer parallel-hammer the
  // upstream feed in the request path.
  ctx?.waitUntil((async () => {
    if (Date.now() - lastCityIngestMs < CITY_INGEST_EVERY_MS) return;
    lastCityIngestMs = Date.now();
    await ingestCityEvents(env, request).catch(() => {});
  })());

  const { results } = await env.CIVIC_DB.prepare("SELECT * FROM city_events").all<CityEventRow>();
  const nowMs = Date.now();
  const ttlMs = EVENT_TTL_MINUTES * 60 * 1000;

  const live = results.filter((row) => {
    const firstSeen = Date.parse(row.first_seen_at);
    if (Number.isFinite(firstSeen) && nowMs - firstSeen > ttlMs) return false;   // rule 2: our cap
    const stopMs = parseBangkokTime(row.stops_at);
    if (stopMs != null && nowMs > stopMs) return false;                          // rule 2: source expiry
    return true;
  });

  const features = live
    .sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at))
    .map((row) => {
      const firstSeen = Date.parse(row.first_seen_at);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [row.lng, row.lat] },
        properties: {
          id: row.id,
          icon: row.icon,
          severity: row.severity,
          titleTh: row.title_th,
          titleEn: row.title_en,
          descriptionTh: row.description_th,
          descriptionEn: row.description_en,
          contributor: row.contributor,
          startsAt: row.starts_at,
          stopsAt: row.stops_at,
          districtId: row.district_id,
          districtNameEn: row.district_name_en,
          firstSeenAt: row.first_seen_at,
          ageMinutes: Number.isFinite(firstSeen) ? Math.round((nowMs - firstSeen) / 60000) : null,
        },
      };
    });

  return jsonResponse(
    {
      type: "FeatureCollection",
      count: features.length,
      ttlMinutes: EVENT_TTL_MINUTES,
      attribution: "Longdo / iTIC public event feed — live Thai road & city incidents",
      disclaimer:
        "Live incident reports (accidents, floods, jams, closures) with reporter-supplied coordinates — not a complete record of everything happening in Bangkok, and not verified by BKKx. Long-running roadworks are excluded so genuinely breaking events stay visible.",
      ingestMode: "background · throttled to one per 2 min · cron every 5 min",
      features,
    },
    { headers: { "cache-control": `public, max-age=${CITY_EVENT_CACHE_TTL_SECONDS}` } },
  );
}

// ─────────────────────────────────────────────────────────────────
// Geolocated news ("what the city is talking about, and where")
//
// The honesty problem this solves: news headlines carry no coordinates.
// GDELT's GEO API, which used to supply them, is retired (404). So a pin
// is only created when a REAL place name from public/bkk-venues.geojson
// (built from OpenStreetMap by scripts/build-venue-gazetteer.py) appears
// in the headline or summary. The literal matched phrase is stored on the
// row, so every pin can be audited back to the words that placed it.
// Articles that match nothing get no pin and are not stored — never a
// guess, never a dump at city centre.
// ─────────────────────────────────────────────────────────────────

// Verified live: each of these returns parseable <item>s. Bangkok Post's
// `bangkok.xml`, `general.xml` and `most-viewed.xml` all 404 — these three
// are the ones that actually exist.
const NEWS_FEEDS = [
  { url: "https://www.bangkokpost.com/rss/data/most-recent.xml", source: "bangkokpost.com" },
  { url: "https://www.bangkokpost.com/rss/data/thailand.xml", source: "bangkokpost.com" },
  { url: "https://www.bangkokpost.com/rss/data/news.xml", source: "bangkokpost.com" },
  { url: "https://www.khaosodenglish.com/feed/", source: "khaosodenglish.com" },
];

// GDELT aggregates far more outlets than any single RSS feed, which is what
// turns "trending" into something measurable rather than anecdotal. It rate-
// limits to 1 request/5s — fine for a 5-minute cron. Failures are caught and
// ignored exactly like a dead RSS feed, so the layer degrades to RSS alone.
const GDELT_DOC_API =
  "https://api.gdeltproject.org/api/v2/doc/doc?query=Bangkok%20sourcecountry:TH" +
  "&mode=ArtList&format=json&timespan=3d&maxrecords=75&sort=datedesc";

const VENUES_ASSET = "/bkk-venues.geojson";
const NEWS_WINDOW_DAYS = 14;
const NEWS_CACHE_TTL_SECONDS = 300;
const NEWS_FETCH_TIMEOUT_MS = 4000;

type VenueEntry = {
  name: string;
  aliases: string[];
  kind: string;
  precision: string;
  lat: number;
  lng: number;
};

let venuesCache: VenueEntry[] | null = null;

async function getVenues(env: Env, request: Request): Promise<VenueEntry[]> {
  if (venuesCache) return venuesCache;
  const fc = await loadJsonAsset<AtlasFeatureCollection>(env, request, VENUES_ASSET);
  const list: VenueEntry[] = [];
  for (const f of fc?.features ?? []) {
    const p = (f.properties ?? {}) as {
      name?: string; aliases?: string[]; kind?: string; precision?: string;
    };
    const coords = (f.geometry as { coordinates?: number[] } | undefined)?.coordinates;
    if (!p.name || !coords) continue;
    list.push({
      name: p.name,
      aliases: Array.isArray(p.aliases) ? p.aliases : [],
      kind: p.kind ?? "venue",
      precision: p.precision ?? "venue",
      lng: coords[0],
      lat: coords[1],
    });
  }
  // Longest names first: "IMPACT Challenger" should win over "IMPACT".
  list.sort((a, b) => b.name.length - a.name.length);
  venuesCache = list;
  return list;
}

function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string; description: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; description: string }> = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
      return m ? stripTags(m[1]) : "";
    };
    const title = pick("title");
    const link = pick("link");
    if (!title || !link) continue;
    items.push({ title, link, pubDate: pick("pubDate"), description: pick("description") });
  }
  return items;
}

/** Escape for use inside a RegExp, so venue names with punctuation
 * ("Groove @ CentralWorld") can't corrupt the pattern. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find the most specific gazetteer entry named in the text. Word
 * boundaries only — substring matching would put "Ari" inside "Aria". */
function matchVenue(text: string, venues: VenueEntry[]): { venue: VenueEntry; phrase: string } | null {
  for (const v of venues) {
    for (const candidate of [v.name, ...v.aliases]) {
      if (candidate.length < 4) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(candidate)}($|[^\\p{L}\\p{N}])`, "iu");
      if (re.test(text)) return { venue: v, phrase: candidate };
    }
  }
  return null;
}

/** Stable id from the URL so re-polling the same article is an upsert,
 * not a duplicate pin. */
async function hashId(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function ingestNewsEvents(env: Env, request: Request): Promise<{ scanned: number; matched: number; unmatched: number }> {
  const venues = await getVenues(env, request);
  const districts = await getDistrictsGeoJson(env, request);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let scanned = 0;
  let matched = 0;

  // All sources in parallel. Sequentially this took 11.7s (4 feeds +
  // GDELT, each up to the timeout); concurrently it costs about one
  // slow source, which is what a user-facing endpoint can afford.
  const fetched = await Promise.allSettled(
    NEWS_FEEDS.map(async (feed) => ({
      feed,
      xml: await (await fetch(feed.url, {
        headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
        signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
      }).then((r) => (r.ok ? r : Promise.reject(new Error(String(r.status)))))).text(),
    })),
  );

  for (const settled of fetched) {
    if (settled.status !== "fulfilled") continue; // a dead feed must not stop the others
    const { feed, xml } = settled.value;

    for (const item of parseRssItems(xml)) {
      scanned++;
      const haystack = `${item.title} ${item.description}`;
      const hit = matchVenue(haystack, venues);
      if (!hit) continue;   // no real place named → no pin, not stored
      matched++;

      const { id: districtId, name: districtName } = findDistrictForPoint(districts, hit.venue.lng, hit.venue.lat);
      const id = await hashId(item.link);
      statements.push(
        env.CIVIC_DB.prepare(
          `INSERT INTO news_events
             (id, title, url, source, published_at, summary, venue_name, venue_kind,
              precision, match_phrase, lat, lng, district_id, district_name_en, first_seen_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
           ON CONFLICT(id) DO NOTHING`,
        ).bind(
          id,
          item.title,
          item.link,
          feed.source,
          item.pubDate || null,
          item.description ? item.description.slice(0, 500) : null,
          hit.venue.name,
          hit.venue.kind,
          hit.venue.precision,
          hit.phrase,
          hit.venue.lat,
          hit.venue.lng,
          districtId,
          districtName,
          now,
        ),
      );
    }
  }

  // GDELT last, and entirely optional — same matcher, same honesty rule.
  try {
    const res = await fetch(GDELT_DOC_API, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string }> };
      for (const art of body.articles ?? []) {
        if (!art.title || !art.url) continue;
        scanned++;
        const hit = matchVenue(art.title, venues);
        if (!hit) continue;
        matched++;
        const { id: districtId, name: districtName } = findDistrictForPoint(districts, hit.venue.lng, hit.venue.lat);
        const id = await hashId(art.url);
        statements.push(
          env.CIVIC_DB.prepare(
            `INSERT INTO news_events
               (id, title, url, source, published_at, summary, venue_name, venue_kind,
                precision, match_phrase, lat, lng, district_id, district_name_en, first_seen_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
             ON CONFLICT(id) DO NOTHING`,
          ).bind(
            id, art.title, art.url, art.domain ?? "gdelt", art.seendate ?? null, null,
            hit.venue.name, hit.venue.kind, hit.venue.precision, hit.phrase,
            hit.venue.lat, hit.venue.lng, districtId, districtName, now,
          ),
        );
      }
    }
  } catch {
    // GDELT throttles aggressively; RSS alone is a valid degraded mode.
  }

  if (statements.length) await env.CIVIC_DB.batch(statements);
  return { scanned, matched, unmatched: scanned - matched };
}

/** Geolocated news as GeoJSON, one feature per VENUE (not per article),
 * carrying its mention count — that count is the "trending" signal the
 * client sizes markers by. */
async function listNewsEvents(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  // Do NOT block the response on ingestion. Polling five upstream sources
  // took 6.3s even in parallel, which is unacceptable for a layer toggle.
  // The 5-minute cron is the real ingest path; this just nudges a refresh
  // in the background and serves whatever D1 already holds (~50ms).
  if (ctx) {
    ctx.waitUntil(ingestNewsEvents(env, request).catch(() => {}));
  }

  const since = new Date(Date.now() - NEWS_WINDOW_DAYS * 86400_000).toISOString();
  const { results } = await env.CIVIC_DB.prepare(
    `SELECT * FROM news_events WHERE first_seen_at >= ?1 ORDER BY first_seen_at DESC`,
  ).bind(since).all<{
    id: string; title: string; url: string; source: string | null;
    published_at: string | null; summary: string | null;
    venue_name: string; venue_kind: string | null; precision: string;
    match_phrase: string; lat: number; lng: number;
    district_id: number | null; district_name_en: string | null; first_seen_at: string;
  }>();

  // Group by venue so a venue with 6 stories is one loud pin, not 6 stacked.
  const byVenue = new Map<string, {
    venueName: string; venueKind: string | null; precision: string;
    lat: number; lng: number; districtNameEn: string | null;
    mentions: number; latestAt: string;
    articles: Array<{ title: string; url: string; source: string | null; publishedAt: string | null; matchPhrase: string }>;
  }>();

  for (const r of results) {
    const key = r.venue_name;
    if (!byVenue.has(key)) {
      byVenue.set(key, {
        venueName: r.venue_name,
        venueKind: r.venue_kind,
        precision: r.precision,
        lat: r.lat,
        lng: r.lng,
        districtNameEn: r.district_name_en,
        mentions: 0,
        latestAt: r.first_seen_at,
        articles: [],
      });
    }
    const entry = byVenue.get(key)!;
    entry.mentions++;
    if (r.first_seen_at > entry.latestAt) entry.latestAt = r.first_seen_at;
    if (entry.articles.length < 6) {
      entry.articles.push({
        title: r.title,
        url: r.url,
        source: r.source,
        publishedAt: r.published_at,
        matchPhrase: r.match_phrase,
      });
    }
  }

  const features = [...byVenue.values()]
    .sort((a, b) => b.mentions - a.mentions)
    .map((v) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
      properties: {
        venueName: v.venueName,
        venueKind: v.venueKind,
        precision: v.precision,
        districtNameEn: v.districtNameEn,
        mentions: v.mentions,
        latestAt: v.latestAt,
        articles: v.articles,
      },
    }));

  return jsonResponse(
    {
      type: "FeatureCollection",
      count: features.length,
      articleCount: results.length,
      windowDays: NEWS_WINDOW_DAYS,
      attribution: "Bangkok Post + Khaosod English RSS; places resolved against OpenStreetMap venues",
      disclaimer:
        "A pin exists only where a real place name from the OSM-built gazetteer was found in the headline or summary — the matched phrase is on every article. Stories that name no place are not shown. `precision: area` means a neighbourhood anchor, not a street address. Coverage is limited to the feeds polled, so this is a sample of city conversation, not all of it.",
      features,
    },
    { headers: { "cache-control": `public, max-age=${NEWS_CACHE_TTL_SECONDS}` } },
  );
}

// Production doctrine law #2: no public endpoint fronts a paid API key
// without rate limiting. Every anonymous /api/traffic hit burns the
// LONGDO_KEY quota, so gate it per-IP. In-isolate counters reset on cold
// start — imperfect, but it turns unlimited hammering into a bounded
// 30/min per IP per window.
const TRAFFIC_RATE_LIMIT = 30;
const TRAFFIC_RATE_WINDOW_MS = 60_000;
const trafficHits = new Map<string, { count: number; resetAt: number }>();

function trafficRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = trafficHits.get(ip);
  if (!entry || now > entry.resetAt) {
    if (trafficHits.size > 10_000) trafficHits.clear();
    trafficHits.set(ip, { count: 1, resetAt: now + TRAFFIC_RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > TRAFFIC_RATE_LIMIT;
}

async function proxyTraffic(request: Request, env: Env): Promise<Response> {
  if (!env.LONGDO_KEY) {
    // 200, not 503: no-key is the known steady state until a Longdo key
    // exists, not a service failure — a 503 here printed two console
    // errors on every visitor's page load for years of pageviews. The
    // client treats any body without `features` as "fall back to the
    // static sample", and API consumers still get told exactly why.
    return jsonResponse(
      {
        configured: false,
        error: "longdo_key_not_configured",
        message:
          "LONGDO_KEY is not set on the worker. Run: npx wrangler secret put LONGDO_KEY. " +
          "For now, the static sample at /bkk-traffic-sample.geojson is used.",
        dataOrigin: "https://itic.longdo.com/opendata/",
      },
      { status: 200 },
    );
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (trafficRateLimited(ip)) {
    return jsonResponse(
      { error: "rate_limited", message: "Too many traffic requests. Retry in a minute." },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  const url = new URL(LONGDO_TRAFFIC_FEED);
  url.searchParams.set("key", env.LONGDO_KEY);
  try {
    const upstream = await fetchUpstream(url.toString(), {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!upstream.ok) {
      return jsonResponse(
        {
          error: "longdo_upstream_error",
          status: upstream.status,
          message: `iTIC/Longdo feed returned ${upstream.status}. Falling back to static sample.`,
        },
        { status: 502 },
      );
    }
    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": `public, max-age=${TRAFFIC_CACHE_TTL_SECONDS}`,
        "x-bkkx-source": "iTIC/Longdo live feed",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "longdo_fetch_failed",
        message: String(error),
      },
      { status: 502 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-readable mirror (/api/atlas/*) — six thin GETs that return what an LLM
// agent, a research script, or your future MCP server would actually ask the
// city. Every endpoint is additive: nothing above changes, the existing
// /api/risk /api/traffic /api/cctv /api/flood-sensors /api/civic-pois routes
// are untouched. Cache headers are honest about how often the source data
// actually changes (districts: weekly; live feeds: see TTLs above).
//
// Six endpoints:
//   GET /api/atlas/areas?bbox=&category=        — 16 curated areas, filterable
//   GET /api/atlas/districts                    — 50 khet + merged land-price
//   GET /api/atlas/at-this-point?lng=&lat=      — district+land+flood+nearest
//   GET /api/atlas/transit?lng=&lat=&radius=    — nearest rail + water transit
//   GET /api/atlas/buildings?bbox=&limit=       — PMTiles pointer (honest)
//   GET /api/atlas/scoreboard                   — single object: live health
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_API_VERSION = 1;
const ATLAS_AREAS_ASSET = "/bkk-areas.json";
const ATLAS_DISTRICTS_ASSET = "/bkk-districts.geojson";
const ATLAS_LAND_PRICE_ASSET = "/bkk-land-price-districts.geojson";
const ATLAS_RAIL_ASSET = "/bkk-rail.geojson";
const ATLAS_WATER_TRANSIT_ASSET = "/bkk-water-transit.geojson";
const ATLAS_BUILDINGS_COUNT = 432077;
const ATLAS_BUILDINGS_RATTANAKOSIN_COUNT = 9275;
const ATLAS_BUILDINGS_PMTILES_REGEN = "2026-08-04";

/** Local GeoJSON-lite types — kept inline because @types/geojson isn't in
 *  the dep tree. The shapes are exactly what the upstream files use. */
type AtlasGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Point"; coordinates: number[] };

type AtlasFeature = {
  type: "Feature";
  properties: Record<string, unknown> | null;
  geometry: AtlasGeometry;
};

type AtlasFeatureCollection = {
  type: "FeatureCollection";
  name?: string;
  features: AtlasFeature[];
};

/** Haversine distance in metres between two WGS84 [lng,lat] points. */
function haversineMeters(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Closest point on a LineString to (lng, lat) — planar in degrees is fine
 *  for "which segment am I near" at city scale. Returns [lng, lat] of the
 *  closest vertex (not the perpendicular projection) for simplicity. */
function closestVertexOnLine(
  lng: number,
  lat: number,
  coords: number[][],
): { point: [number, number]; distanceM: number } {
  let best: { point: [number, number]; distanceM: number } | null = null;
  for (const c of coords) {
    const d = haversineMeters(lng, lat, c[0], c[1]);
    if (best === null || d < best.distanceM) {
      best = { point: [c[0], c[1]], distanceM: d };
    }
  }
  return best ?? { point: [lng, lat], distanceM: 0 };
}

/** Polygon centroid (average of outer ring vertices) — good enough for
 *  district-level "where roughly is it" without a real polygon-centroid
 *  library. */
function polygonCentroid(geometry: { type: string; coordinates: unknown }): [number, number] | null {
  const ring = (() => {
    if (geometry.type === "Polygon") {
      return (geometry.coordinates as number[][][])[0];
    }
    if (geometry.type === "MultiPolygon") {
      return (geometry.coordinates as number[][][][])[0]?.[0];
    }
    return null;
  })();
  if (!ring || ring.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return [lng / ring.length, lat / ring.length];
}

async function loadJsonAsset<T>(env: Env, request: Request, asset: string): Promise<T | null> {
  const url = new URL(asset, request.url);
  const res = await env.ASSETS.fetch(new Request(url.toString(), request));
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// Cache the heavy GeoJSON files in module-scope. The Worker is long-lived
// (warm isolates keep the cache), so repeat requests hit memory instead of
// re-fetching the asset binding. Each file is < 400 KB so this is fine.
let areasCache: { name: string; version: string; license?: string; areas: AtlasArea[] } | null = null;
let districtsCache: AtlasFeatureCollection | null = null;
let landPriceCache: AtlasFeatureCollection | null = null;
let railCache: AtlasFeatureCollection | null = null;
let waterTransitCache: AtlasFeatureCollection | null = null;

type AtlasArea = {
  id: string;
  name: string;
  thai?: string;
  category: string;
  chapter?: string;
  description?: string;
  center: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  keyStats?: Record<string, string | number>;
  tags?: string[];
};

async function getAreas(env: Env, request: Request) {
  if (!areasCache) {
    const data = await loadJsonAsset<{ name: string; version: string; license?: string; areas: AtlasArea[] }>(
      env,
      request,
      ATLAS_AREAS_ASSET,
    );
    if (!data?.areas) return null;
    areasCache = data;
  }
  return areasCache;
}

const KHLONGS_ASSET = "/bkk-khlongs.geojson";
let khlongsCache: AtlasFeatureCollection | null = null;

/** Districts (to place DDS road reports) and waterways (to snap gauges). */
async function floodDeps(env: Env, request: Request): Promise<RefreshDeps> {
  if (!khlongsCache) khlongsCache = await loadJsonAsset<AtlasFeatureCollection>(env, request, KHLONGS_ASSET);
  return { districts: await getDistrictsGeoJson(env, request), khlongs: khlongsCache } as RefreshDeps;
}

/** Inputs for the flood-roads engine (src/floodroads.ts). */
async function floodRoadDeps(env: Env, request: Request, ctx?: ExecutionContext): Promise<RoadDeps> {
  const flood = await loadFloodState(env, () => floodDeps(env, request)).catch(() => null);
  return {
    flood,
    districts: (await getDistrictsGeoJson(env, request)) as RoadDeps["districts"],
    news: async () => {
      const res = await listNewsEvents(request, env, ctx);
      const data = (await res.json()) as { features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }[] };
      return (data.features ?? []).flatMap((f) => {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const t = Date.parse(String(f.properties?.latestAt ?? ""));
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
        const mentions = Number(f.properties?.mentions ?? 1);
        return [{ lng, lat, t: Number.isFinite(t) ? t : Date.now(), weight: 0.3 * Math.min(mentions / 3, 1) }];
      });
    },
  };
}

async function getDistrictsGeoJson(env: Env, request: Request) {
  if (!districtsCache) {
    districtsCache = await loadJsonAsset<AtlasFeatureCollection>(env, request, ATLAS_DISTRICTS_ASSET);
  }
  return districtsCache;
}

async function getLandPriceGeoJson(env: Env, request: Request) {
  if (!landPriceCache) {
    landPriceCache = await loadJsonAsset<AtlasFeatureCollection>(env, request, ATLAS_LAND_PRICE_ASSET);
  }
  return landPriceCache;
}

async function getRailGeoJson(env: Env, request: Request) {
  if (!railCache) {
    railCache = await loadJsonAsset<AtlasFeatureCollection>(env, request, ATLAS_RAIL_ASSET);
  }
  return railCache;
}

async function getWaterTransitGeoJson(env: Env, request: Request) {
  if (!waterTransitCache) {
    waterTransitCache = await loadJsonAsset<AtlasFeatureCollection>(env, request, ATLAS_WATER_TRANSIT_ASSET);
  }
  return waterTransitCache;
}

/** Filter areas by category and/or viewport bbox. The bbox test is a quick
 *  point-in-rect against the area's center — good enough for "show me the
 *  Sukhumvit areas, not the riverside ones" without a real polygon check. */
function filterAreas(areas: AtlasArea[], category: string | null, bbox: string | null) {
  let out = areas;
  if (category) {
    const wanted = category.toLowerCase();
    out = out.filter((a) => (a.category ?? "").toLowerCase() === wanted);
  }
  if (bbox) {
    const m = bbox.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (m) {
      const [, minLng, minLat, maxLng, maxLat] = m.map(Number);
      out = out.filter((a) => {
        const [lng, lat] = a.center;
        return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
      });
    }
  }
  return out;
}

async function atlasAreas(request: Request, env: Env): Promise<Response> {
  const data = await getAreas(env, request);
  if (!data) {
    return jsonResponse({ error: "areas_unavailable", message: `Could not load ${ATLAS_AREAS_ASSET}.` }, { status: 502 });
  }
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const bbox = url.searchParams.get("bbox");
  const filtered = filterAreas(data.areas, category, bbox);
  return jsonResponse(
    {
      tool: "atlas-areas",
      version: ATLAS_API_VERSION,
      source: ATLAS_AREAS_ASSET,
      license: data.license ?? "ODbL-1.0 (derived from OpenStreetMap)",
      total: data.areas.length,
      count: filtered.length,
      filter: { category, bbox },
      areas: filtered,
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}

async function atlasDistricts(request: Request, env: Env): Promise<Response> {
  const [districts, landPrice] = await Promise.all([
    getDistrictsGeoJson(env, request),
    getLandPriceGeoJson(env, request),
  ]);
  if (!districts) {
    return jsonResponse({ error: "districts_unavailable", message: `Could not load ${ATLAS_DISTRICTS_ASSET}.` }, { status: 502 });
  }
  const lpById = new Map<number, AtlasFeature>();
  if (landPrice) {
    for (const f of landPrice.features) {
      const id = f.properties?.id;
      if (typeof id === "number") lpById.set(id, f);
    }
  }
  const rows = districts.features.map((f) => {
    const id = f.properties?.id as number | undefined;
    const lp = id != null ? lpById.get(id) : undefined;
    const centroid = polygonCentroid(f.geometry as { type: string; coordinates: unknown });
    return {
      id,
      nameEn: f.properties?.name_en ?? null,
      nameTh: f.properties?.name_th ?? null,
      centroid,
      landPrice: lp
        ? {
            peakNewPrice: lp.properties?.peakNewPrice ?? null,
            groupMinNewPrice: lp.properties?.groupMinNewPrice ?? null,
            groupDistricts: lp.properties?.groupDistricts ?? null,
          }
        : null,
    };
  });
  return jsonResponse(
    {
      tool: "atlas-districts",
      version: ATLAS_API_VERSION,
      source: ATLAS_DISTRICTS_ASSET,
      landPriceSource: ATLAS_LAND_PRICE_ASSET,
      count: rows.length,
      districts: rows,
      disclaimer:
        "Land price is Treasury 2024-2028 road-level assessment, joined on OSM district id. Each district's `peakNewPrice` is its group's single highest priced road — see the full source file for per-road numbers.",
    },
    { headers: { "cache-control": "public, max-age=86400" } },
  );
}

async function atlasAtThisPoint(request: Request, env: Env): Promise<Response> {
  const parsed = parseBangkokLngLat(request);
  if (parsed instanceof Response) return parsed;
  const { lng, lat } = parsed;

  const [districts, landPrice, rail, waterTransit, floodCollection] = await Promise.all([
    getDistrictsGeoJson(env, request),
    getLandPriceGeoJson(env, request),
    getRailGeoJson(env, request),
    getWaterTransitGeoJson(env, request),
    loadFloodCollection(env, request),
  ]);

  // District (point-in-polygon against the outer ring of every district polygon).
  let districtRow: { id: number | null; nameEn: string | null; nameTh: string | null } | null = null;
  if (districts) {
    for (const f of districts.features) {
      const g = f.geometry as { type: string; coordinates: unknown } | null;
      if (!g) continue;
      if (g.type === "Polygon" && pointInFloodFeature(lng, lat, f as unknown as FloodFeature)) {
        districtRow = {
          id: (f.properties?.id as number | undefined) ?? null,
          nameEn: (f.properties?.name_en as string | undefined) ?? null,
          nameTh: (f.properties?.name_th as string | undefined) ?? null,
        };
        break;
      }
      if (g.type === "MultiPolygon" && pointInFloodFeature(lng, lat, f as unknown as FloodFeature)) {
        districtRow = {
          id: (f.properties?.id as number | undefined) ?? null,
          nameEn: (f.properties?.name_en as string | undefined) ?? null,
          nameTh: (f.properties?.name_th as string | undefined) ?? null,
        };
        break;
      }
    }
  }

  // Land price (join on district id).
  let landPriceRow: { peakNewPrice: number | null; groupMinNewPrice: number | null; groupDistricts: string[] | null } | null = null;
  if (districtRow?.id != null && landPrice) {
    const f = landPrice.features.find((x) => x.properties?.id === districtRow!.id);
    if (f) {
      landPriceRow = {
        peakNewPrice: (f.properties?.peakNewPrice as number | undefined) ?? null,
        groupMinNewPrice: (f.properties?.groupMinNewPrice as number | undefined) ?? null,
        groupDistricts: (f.properties?.groupDistricts as string[] | undefined) ?? null,
      };
    }
  }

  // Flood.
  const flood = floodCollection
    ? floodHit(floodCollection, lng, lat)
    : { inside: false as const, envelopes: [] as FloodProps[], top: null };

  // Nearest transit (haversine on every rail LineString vertex).
  let nearestTransit: {
    line: string | null;
    ref: string | null;
    color: string | null;
    distanceM: number;
    closestPoint: [number, number];
  } | null = null;
  if (rail) {
    let best: { line: string | null; ref: string | null; color: string | null; distanceM: number; closestPoint: [number, number] } | null = null;
    for (const f of rail.features) {
      const g = f.geometry as { type: string; coordinates: number[][] } | null;
      if (!g || g.type !== "LineString") continue;
      const r = closestVertexOnLine(lng, lat, g.coordinates);
      if (best === null || r.distanceM < best.distanceM) {
        best = {
          line: (f.properties?.line as string | undefined) ?? null,
          ref: (f.properties?.ref as string | undefined) ?? null,
          color: (f.properties?.color as string | undefined) ?? null,
          distanceM: Math.round(r.distanceM),
          closestPoint: r.point,
        };
      }
    }
    nearestTransit = best;
  }

  let nearestWaterTransit: {
    id: string | null;
    name: string | null;
    mode: string | null;
    featureType: string;
    distanceM: number;
    closestPoint: [number, number];
  } | null = null;
  if (waterTransit) {
    for (const f of waterTransit.features) {
      const featureType = (f.properties?.feature_type as string | undefined) ?? "unknown";
      let result: { point: [number, number]; distanceM: number } | null = null;
      if (f.geometry.type === "LineString") {
        result = closestVertexOnLine(lng, lat, f.geometry.coordinates);
      } else if (f.geometry.type === "Point") {
        const [pointLng, pointLat] = f.geometry.coordinates;
        result = { point: [pointLng, pointLat], distanceM: haversineMeters(lng, lat, pointLng, pointLat) };
      }
      if (result && (nearestWaterTransit === null || result.distanceM < nearestWaterTransit.distanceM)) {
        nearestWaterTransit = {
          id: (f.properties?.id as string | undefined) ?? null,
          name: (f.properties?.name as string | undefined) ?? null,
          mode: (f.properties?.mode as string | undefined) ?? null,
          featureType,
          distanceM: Math.round(result.distanceM),
          closestPoint: result.point,
        };
      }
    }
  }

  // Summary band — a one-line read the agent can use directly.
  const landPriceBand =
    landPriceRow?.peakNewPrice == null
      ? "unknown"
      : landPriceRow.peakNewPrice >= 350000
        ? "premium"
        : landPriceRow.peakNewPrice >= 100000
          ? "mid"
          : "value";
  const nearestTransitDistance = Math.min(
    nearestTransit?.distanceM ?? Number.POSITIVE_INFINITY,
    nearestWaterTransit?.distanceM ?? Number.POSITIVE_INFINITY,
  );
  const transitBand =
    !Number.isFinite(nearestTransitDistance)
      ? "unknown"
      : nearestTransitDistance <= 600
        ? "walkable"
        : nearestTransitDistance <= 1500
          ? "near"
          : "far";
  const floodBand = flood.inside ? (flood.top?.severity ?? "inside") : "clear";

  return jsonResponse(
    {
      tool: "atlas-at-this-point",
      version: ATLAS_API_VERSION,
      query: { lng, lat },
      district: districtRow,
      landPrice: landPriceRow,
      flood: {
        inside: flood.inside,
        severity: flood.inside ? (flood.top?.severity ?? null) : null,
        envelope: flood.top?.name ?? null,
        depthHintM: flood.top?.depthHintM ?? null,
      },
      nearestTransit,
      nearestWaterTransit,
      summary: { landPriceBand, transitBand, floodBand },
      disclaimer:
        "Civic-readout endpoint, not a real-estate or insurance-grade service. Flood is the schematic 2011-style envelope, not an official forecast. Land price is the district group's peak road figure.",
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}

async function atlasTransit(request: Request, env: Env): Promise<Response> {
  const parsed = parseBangkokLngLat(request);
  if (parsed instanceof Response) return parsed;
  const { lng, lat } = parsed;
  const url = new URL(request.url);
  const radiusParam = Number.parseFloat(url.searchParams.get("radius") ?? "1500");
  const radius = Number.isFinite(radiusParam) && radiusParam > 0 ? Math.min(radiusParam, 10000) : 1500;
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "5", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 20) : 5;

  const [rail, waterTransit] = await Promise.all([
    getRailGeoJson(env, request),
    getWaterTransitGeoJson(env, request),
  ]);
  if (!rail) {
    return jsonResponse({ error: "rail_unavailable", message: `Could not load ${ATLAS_RAIL_ASSET}.` }, { status: 502 });
  }

  type Hit = {
    line: string | null;
    ref: string | null;
    color: string | null;
    name: string | null;
    distanceM: number;
    closestPoint: [number, number];
  };
  const hits: Hit[] = [];
  for (const f of rail.features) {
    const g = f.geometry as { type: string; coordinates: number[][] } | null;
    if (!g || g.type !== "LineString") continue;
    const r = closestVertexOnLine(lng, lat, g.coordinates);
    if (r.distanceM > radius) continue;
    hits.push({
      line: (f.properties?.line as string | undefined) ?? null,
      ref: (f.properties?.ref as string | undefined) ?? null,
      color: (f.properties?.color as string | undefined) ?? null,
      name: (f.properties?.name as string | undefined) ?? null,
      distanceM: Math.round(r.distanceM),
      closestPoint: r.point,
    });
  }
  hits.sort((a, b) => a.distanceM - b.distanceM);
  const trimmed = hits.slice(0, limit);

  const waterRoutes: Array<{
    id: string | null;
    name: string | null;
    mode: string | null;
    distanceM: number;
    closestPoint: [number, number];
    sourceUrl: string | null;
  }> = [];
  const piers: Array<{
    id: string | null;
    name: string | null;
    nameTh: string | null;
    mode: string | null;
    services: string | null;
    distanceM: number;
    coordinates: [number, number];
  }> = [];
  if (waterTransit) {
    for (const f of waterTransit.features) {
      if (f.geometry.type === "LineString" && f.properties?.feature_type === "route") {
        const result = closestVertexOnLine(lng, lat, f.geometry.coordinates);
        if (result.distanceM <= radius) {
          waterRoutes.push({
            id: (f.properties?.id as string | undefined) ?? null,
            name: (f.properties?.name as string | undefined) ?? null,
            mode: (f.properties?.mode as string | undefined) ?? null,
            distanceM: Math.round(result.distanceM),
            closestPoint: result.point,
            sourceUrl: (f.properties?.source_url as string | undefined) ?? null,
          });
        }
      } else if (f.geometry.type === "Point" && f.properties?.feature_type === "pier") {
        const [pointLng, pointLat] = f.geometry.coordinates;
        const distanceM = haversineMeters(lng, lat, pointLng, pointLat);
        if (distanceM <= radius) {
          piers.push({
            id: (f.properties?.id as string | undefined) ?? null,
            name: (f.properties?.name as string | undefined) ?? null,
            nameTh: (f.properties?.name_th as string | undefined) ?? null,
            mode: (f.properties?.mode as string | undefined) ?? null,
            services: (f.properties?.services as string | undefined) ?? null,
            distanceM: Math.round(distanceM),
            coordinates: [pointLng, pointLat],
          });
        }
      }
    }
  }
  waterRoutes.sort((a, b) => a.distanceM - b.distanceM);
  piers.sort((a, b) => a.distanceM - b.distanceM);

  return jsonResponse(
    {
      tool: "atlas-transit",
      version: ATLAS_API_VERSION,
      source: ATLAS_RAIL_ASSET,
      waterTransitSource: ATLAS_WATER_TRANSIT_ASSET,
      query: { lng, lat, radiusM: radius, limit },
      count: trimmed.length,
      totalInRadius: hits.length,
      segments: trimmed,
      waterRoutes: waterRoutes.slice(0, limit),
      piers: piers.slice(0, limit),
      disclaimer: "Water routes are maintained service corridors, not live vessel positions or navigational channels. Check the linked operator before travel.",
    },
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    },
  );
}

/** Buildings endpoint is intentionally honest: we do NOT have a server-side
 *  query path into the 432K PMTiles without a per-feature index we haven't
 *  built. The 432K building PMTiles is streamed tile-by-tile via the
 *  `pmtiles://` protocol against the URL we return. The Rattanakosin
 *  detail layer (9,275 features, zoom 14-18) IS small enough to slice
 *  client-side from the same PMTiles, so we also point at that for
 *  high-zoom use cases. */
async function atlasBuildings(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const bbox = url.searchParams.get("bbox");
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 100;

  // Validate bbox if provided.
  let bboxParsed: [number, number, number, number] | null = null;
  if (bbox) {
    const m = bbox.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    if (!m) {
      return jsonResponse(
        { error: "invalid_bbox", message: "bbox must be minLng,minLat,maxLng,maxLat." },
        { status: 400 },
      );
    }
    const [, a, b, c, d] = m.map(Number);
    bboxParsed = [a, b, c, d];
  }

  // Probe the PMTiles URL so callers can see it's live.
  let pmtilesOk = false;
  let pmtilesSize: number | null = null;
  try {
    const head = await env.BKK_TILES.head(PMTILES_R2_KEY);
    if (head) {
      pmtilesOk = true;
      pmtilesSize = head.size;
    }
  } catch {
    // ignore — the protocol layer will surface the error
  }

  return jsonResponse(
    {
      tool: "atlas-buildings",
      version: ATLAS_API_VERSION,
      status: "streamed_via_pmtiles",
      bbox: bboxParsed,
      limit,
      buildings: {
        totalMetro: ATLAS_BUILDINGS_COUNT,
        metroPmtiles: {
          url: PMTILES_PATH,
          sizeBytes: pmtilesSize,
          reachable: pmtilesOk,
          regeneratedAt: ATLAS_BUILDINGS_PMTILES_REGEN,
          zoom: "11-15",
        },
        rattanakosinDetail: {
          url: RATTANAKOSIN_PMTILES_PATH,
          total: ATLAS_BUILDINGS_RATTANAKOSIN_COUNT,
          zoom: "14-18",
        },
      },
      hint:
        "The 432K Bangkok metro buildings are streamed as PMTiles. Use the pmtiles JS lib against the metroPmtiles.url for full-city queries, or the rattanakosinDetail.url for the Old Town (Grand Palace, Wat Pho, Wat Phra Kaew, the royal field).",
      license: "ODbL-1.0 (OpenStreetMap contributors)",
    },
    {
      headers: {
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    },
  );
}

async function atlasScoreboard(request: Request, env: Env): Promise<Response> {
  // Counts that need a D1 round-trip. The ingest script writes to ingestion_runs
  // so we can also surface when the store was last refreshed.
  let civicPoiCount: number | null = null;
  let lastIngestedAt: string | null = null;
  try {
    const { results } = await env.CIVIC_DB.prepare(
      "SELECT (SELECT COUNT(*) FROM civic_pois) AS n, (SELECT MAX(ingested_at) FROM ingestion_runs) AS last",
    ).all<{ n: number; last: string | null }>();
    const row = results?.[0];
    civicPoiCount = row?.n ?? null;
    lastIngestedAt = row?.last ?? null;
  } catch {
    // D1 may not be wired in every environment; surface nulls rather than 500.
  }

  const landmarksCount = await loadLandmarksCount(env, request);

  return jsonResponse(
    {
      tool: "atlas-scoreboard",
      version: ATLAS_API_VERSION,
      buildings: { totalMetro: ATLAS_BUILDINGS_COUNT, totalRattanakosin: ATLAS_BUILDINGS_RATTANAKOSIN_COUNT, regeneratedAt: ATLAS_BUILDINGS_PMTILES_REGEN },
      districts: 50,
      rail: { lines: 9, segments: 126 },
      waterTransit: { routes: 4, piers: 16, source: ATLAS_WATER_TRANSIT_ASSET, livePositions: false },
      khlongs: { total: 4063, river: "Chao Phraya", canals: 3026 },
      landPrice: { districts: 50, parcels: 2281482, source: "Treasury 2024-2028" },
      civicPois: { count: civicPoiCount, lastIngestedAt },
      feeds: {
        traffic: {
          source: "iTIC / Longdo",
          configured: Boolean(env.LONGDO_KEY),
          fallback: "/bkk-traffic-sample.geojson",
        },
        cctv: { source: "iTIC / Longdo", fallback: "/bkk-cctv.geojson" },
        floodSensors: { source: "HII / ThaiWater (relayed via FloodDash)", live: true, endpoint: "/api/flood-sensors" },
        floodBkk: {
          source: "FloodDash (HII / ThaiWater + BMA DDS)",
          live: true,
          endpoint: "/api/flood/bkk",
          ttlMinutes: 10,
        },
        rain: { source: "RainViewer", live: true },
        aqi: { source: "Open-Meteo CAMS", live: true },
        heat: { source: "Open-Meteo", live: true },
        cityEvents: {
          source: "Longdo / iTIC event feed",
          live: true,
          endpoint: "/api/city-events",
          ttlMinutes: 60,
          // Cron-driven ingest, not a straight proxy — the upstream feed
          // is a rolling 20-item window for all of Thailand, so a busy
          // hour would push a Bangkok accident out in minutes while still
          // active. Storing in D1 (city_events) lets an incident hold its
          // full hour and the layer self-clear.
        },
        newsEvents: {
          source: "Bangkok Post + Khaosod English RSS",
          live: true,
          endpoint: "/api/news-events",
          windowDays: 14,
          // Geolocated only via a 599-entry OSM-built gazetteer — no
          // fabricated coordinates. Every pin carries the match phrase
          // that put it there, so the layer is auditable row by row.
        },
        landmarks: {
          // Honest inventory: 73 Rattanakosin heritage masses + curated
          // Bangkok skyline icons with cited heights and verified pins +
          // hand-curated civic/market/shrine silhouettes (post 2026-09-26
          // audit pass restored 15 valid quarantined entries). The Fine
          // Arts Department register (571 monuments) lives on
          // bkk.nonarkara.org/heritage — it is not this GeoJSON.
          source: "OSM footprints + schematic heritage heights + curated skyline icons + civic silhouettes",
          endpoint: "/bkk-landmarks.geojson",
          count: landmarksCount,
          quarantineCount: await loadLandmarksCountFromAsset(env, request, "/bkk-landmarks-quarantine.geojson"),
          // Rendered as 3D fill-extrusions with the buildings stack
          // (Victory Monument 50 m shaft, MahaNakhon 314 m, Baiyoke II 304 m).
          // Not a separate toggle — always on with buildings.
        },
        bkkRainStations: {
          source: "ThaiWater v3 API · provinces/rain24?province_code=10 (BKK provincial gauge network)",
          endpoint: "/bkk-rain-stations.geojson",
          proxy: "/api/water/bkk/rain-stations",
          count: await loadLandmarksCountFromAsset(env, request, "/bkk-rain-stations.geojson"),
          cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS,
        },
      },
      copyright: "© OpenStreetMap contributors under ODbL 1.0. Esri imagery © Esri, Maxar, Earthstar Geographics (non-commercial use).",
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}

async function loadLandmarksCountFromAsset(env: Env, request: Request, assetPath: string): Promise<number> {
  try {
    const url = new URL(assetPath, request.url);
    const res = await env.ASSETS.fetch(new Request(url.toString(), request));
    if (!res.ok) return 0;
    const body = (await res.json()) as { features?: unknown[] };
    return Array.isArray(body?.features) ? body.features.length : 0;
  } catch {
    return 0;
  }
}

function apiCatalog(request: Request): Response {
  const origin = new URL(request.url).origin;
  return jsonResponse(
    {
      name: "BKKx 3D Atlas API",
      version: 1,
      home: origin,
      about: `${origin}/#about`,
      paper: `${origin}/labs/paper`,
      endpoints: [
        { path: "/api", method: "GET", description: "This catalog." },
        { path: "/api/traffic", method: "GET", description: "Live iTIC/Longdo expressway traffic GeoJSON (proxied).", cacheSeconds: TRAFFIC_CACHE_TTL_SECONDS },
        { path: "/api/cctv", method: "GET", description: "Public iTIC/Longdo road cameras for Bangkok metro (HLS/JPEG).", cacheSeconds: CCTV_CACHE_TTL_SECONDS },
        { path: "/api/flood-sensors", method: "GET", description: "Water-level gauges in the Bangkok metro, each judged by FloodDash (band, action, freshness).", cacheSeconds: FLOOD_SENSOR_CACHE_TTL_SECONDS },
        { path: "/api/flood/bkk", method: "GET", description: "FloodDash relay for Bangkok: city verdict, judged gauges, waterway status, BMA DDS canal gates and road reports. Not an official warning — DDPM 1784.", cacheSeconds: 60 },
        { path: "/api/water/bkk/rain-stations", method: "GET", description: "ThaiWater v3 Bangkok provincial rain gauge network (133 stations with rain_24h + rain_1h).", cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/kpi", method: "GET", description: "BKK provincial top KPIs (24h/3d/7d rain, today/tomorrow/day-after forecast, temperature, worst station).", cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/incidents", method: "GET", description: "BKK incident heat — city-events + news-events + BMA DDS road reports + flood-sensors in prepare/evacuate bands, aggregated for flood-preset heat map.", cacheSeconds: BKK_INCIDENTS_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/canal-gates", method: "GET", description: "BMA Drainage bulletin: 10 Bangkok canal-gate stations with current water level vs critical level.", cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/roads-flooded", method: "GET", description: "BMA DDS dated road reports for Bangkok: 66 road segments with depth, lanes, status (reported / cleared / unrecorded).", cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/roads-xref", method: "GET", description: "Honest cross-reference: BMA DDS + Traffy + iTIC road reports cross-checked against FloodDash gauges (within 250 m). Pattern stolen from JK World (world.tehx.dyndns.info/flood).", cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS },
        { path: "/api/presence", method: "GET", description: "Anonymous online counter — how many atlas tabs are open right now and today's peak. Pattern stolen from JK World presence.js.", cacheSeconds: 0 },
        { path: "/api/presence/ping", method: "POST", description: "Heartbeat — register this tab as online for 5 minutes. Send the session id back as `x-atlas-session` on the next ping.", cacheSeconds: 0 },
        { path: "/api/snap/<id>", method: "GET", description: "Maholan community-CCTV snapshot proxy (CCD origin: cctv.maholan.net/api/snap/<id>). Adds Access-Control-Allow-Origin so the atlas popup can render the JPEG inline; mirrors Maholan's cache-control and passes through X-Image-Time for age display. Returns an honest inline-SVG placeholder when upstream is down — never a broken-image glyph.", cacheSeconds: 14400 },
        { path: "/api/water/bkk/emergency-points", method: "GET", description: "FloodDash confirmed emergency points for Bangkok + 30 km halo (news-anchored flood-affected locations with depth + impact).", cacheSeconds: BKK_INCIDENTS_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/dams", method: "GET", description: "FloodDash major dams (Bhumibol, Sirikit, Pasak, Kwae Noi) — storage %, inflow, release. Filtered to Chao Phraya + nearby basins.", cacheSeconds: BKK_WATER_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/alerts", method: "GET", description: "FloodDash active flood alerts (thaiwater_wl level changes + flash-flood precursors) — Bangkok + Chao Phraya upstream provinces.", cacheSeconds: BKK_INCIDENTS_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/sources-health", method: "GET", description: "FloodDash ingest health for 40 upstream feeds (BMA DDS, HII, ThaiWater, RID, GISTDA, PCD, Air4Thai, …) — last-run, failures, status.", cacheSeconds: BKK_INCIDENTS_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/news-watch", method: "GET", description: "FloodDash curated Thai flood-news feed (gnews_flood: Google News flood filter + Bangkok Post / Khaosod / Thai PBS / Reuters). Severity derived from title keywords.", cacheSeconds: BKK_INCIDENTS_CACHE_TTL_SECONDS },
        { path: "/api/water/bkk/maholan-cctv", method: "GET", description: "Maholan community CCTV aggregator (cctv.maholan.net) — 2,355 cameras across Thailand, filtered to BKK + 30 km halo. Includes YouTube + HLS + MJPEG + snapshot streams.", cacheSeconds: CCTV_CACHE_TTL_SECONDS },
        { path: "/api/civic-pois", method: "GET", description: "BMA open-data civic amenities from D1.", query: ["category?", "district?", "limit?"] },
        { path: "/api/civic-pois/analysis", method: "GET", description: "Amenity counts aggregated by district for choropleths." },
        { path: "/api/risk", method: "GET", description: "Point risk: schematic flood envelope × live PM2.5.", query: ["lng", "lat"], example: "/api/risk?lng=100.5321&lat=13.7367", cacheSeconds: RISK_CACHE_TTL_SECONDS },
        { path: "/api/atlas/areas", method: "GET", description: "16 curated atlas areas (AI-readable mirror)." },
        { path: "/api/atlas/districts", method: "GET", description: "50 khet + merged land-price summary." },
        { path: "/api/atlas/at-this-point", method: "GET", description: "District + land + flood + nearest transit at a point.", query: ["lng", "lat"] },
        { path: "/api/atlas/transit", method: "GET", description: "Nearest rail segments, scheduled boat corridors and passenger piers.", query: ["lng", "lat", "radius?", "limit?"] },
        { path: "/api/atlas/buildings", method: "GET", description: "PMTiles pointers for 432K buildings." },
        { path: "/api/atlas/scoreboard", method: "GET", description: "Single-object live health / inventory." },
        { path: "/bkk-buildings.pmtiles", method: "GET", description: "432,077 OSM buildings — HTTP Range from R2." },
        { path: "/bkk-buildings-rattanakosin.pmtiles", method: "GET", description: "Rattanakosin detail buildings PMTiles (zoom 14–18)." },
      ],
      staticGeojson: [
        "/bkk-areas.json",
        "/bkk-rail.geojson",
        "/bkk-water-transit.geojson",
        "/bkk-khlongs.geojson",
        "/bkk-buildings-rattanakosin.geojson",
        "/bkk-traffic-sample.geojson",
        "/bkk-flood-envelope.geojson",
        "/bkk-civic-pois.geojson",
      ],
      note: "Civic demo layers are honest about provenance. Flood envelopes are schematic, not official DDPM/BMA extents. UI About drawer: /#about.",
    },
    {
      headers: {
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname === "/api/") {
      return apiCatalog(request);
    }
    if (url.pathname === "/api/traffic") {
      return proxyTraffic(request, env);
    }
    if (url.pathname === "/api/cctv") {
      return proxyCctv(request, env);
    }
    if (url.pathname === "/api/flood-sensors") {
      return floodSensorsResponse(await loadFloodState(env, () => floodDeps(env, request)).catch(() => null));
    }
    if (url.pathname === "/api/flood/roads") {
      return floodRoadsResponse(await loadFloodRoads(env, () => floodRoadDeps(env, request, ctx)).catch((error) => {
        console.warn("flood-roads load failed:", String(error));
        return null;
      }));
    }
    if (url.pathname === "/api/flood/bkk") {
      return floodBkkResponse(await loadFloodState(env, () => floodDeps(env, request)).catch(() => null));
    }
    if (url.pathname === "/api/water/bkk/rain-stations") {
      return proxyBkkRainStations(request);
    }
    if (url.pathname === "/api/water/bkk/kpi") {
      return proxyBkkRainKpi(request);
    }
    if (url.pathname === "/api/water/bkk/incidents") {
      return proxyBkkIncidents(request, env, ctx);
    }
    if (url.pathname === "/api/water/bkk/canal-gates") {
      return proxyBkkCanalGates(request, env);
    }
    if (url.pathname === "/api/water/bkk/roads-flooded") {
      return proxyBkkRoadsFlooded(request, env);
    }
    if (url.pathname === "/api/water/bkk/roads-xref") {
      // Cross-reference: live road-flooded data × live flood-sensor gauges.
      // Both are cached in D1 from the previous refresh; this stays cheap.
      const [roads, flood] = await Promise.all([
        loadFloodRoads(env, () => floodRoadDeps(env, request, ctx)).catch(() => null),
        loadFloodState(env, () => floodDeps(env, request)).catch(() => null),
      ]);
      return roadsXrefResponse(roads, flood);
    }
    if (url.pathname === "/api/presence" || url.pathname === "/api/presence/ping") {
      return handlePresence(request);
    }
    // /api/snap/<id> — Maholan community-CCTV snapshot proxy.
    // The atlas's Maholan popup needs to render the JPEG inline; the
    // direct Maholan URL does NOT set Access-Control-Allow-Origin, so
    // browsers refuse to paint it. We proxy, add ACAO *, pass through
    // X-Image-Time so the popup can show the snapshot's age, and rely
    // on Cloudflare's edge cache (Maholan itself sends
    // cache-control: public, max-age=14400).
    if (url.pathname.startsWith("/api/snap/")) {
      return proxyCctvSnapshot(request, url);
    }
    if (url.pathname === "/api/water/bkk/emergency-points") {
      return proxyBkkEmergencyPoints(request, env);
    }
    if (url.pathname === "/api/water/bkk/dams") {
      return proxyBkkDams(request, env);
    }
    if (url.pathname === "/api/water/bkk/alerts") {
      return proxyBkkAlerts(request, env);
    }
    if (url.pathname === "/api/water/bkk/sources-health") {
      return proxySourcesHealth(request, env);
    }
    if (url.pathname === "/api/water/bkk/news-watch") {
      return proxyNewsWatch(request, env);
    }
    if (url.pathname === "/api/water/bkk/maholan-cctv") {
      return proxyMaholanCctv(request, env);
    }
    if (url.pathname === "/api/civic-pois") {
      return listCivicPois(request, env);
    }
    if (url.pathname === "/api/civic-pois/analysis") {
      return civicPoiAnalysis(request, env);
    }
    if (url.pathname === "/api/city-events") {
      return listCityEvents(request, env, ctx);
    }
    if (url.pathname === "/api/news-events") {
      return listNewsEvents(request, env, ctx);
    }
    if (url.pathname === "/api/risk") {
      return lookupRisk(request, env);
    }
    if (url.pathname === "/api/atlas/areas") {
      return atlasAreas(request, env);
    }
    if (url.pathname === "/api/atlas/districts") {
      return atlasDistricts(request, env);
    }
    if (url.pathname === "/api/atlas/at-this-point") {
      return atlasAtThisPoint(request, env);
    }
    if (url.pathname === "/api/atlas/transit") {
      return atlasTransit(request, env);
    }
    if (url.pathname === "/api/atlas/buildings") {
      return atlasBuildings(request, env);
    }
    if (url.pathname === "/api/atlas/scoreboard") {
      return atlasScoreboard(request, env);
    }
    if (url.pathname === PMTILES_PATH) {
      return serveBuildingsPmtiles(request, env);
    }
    if (url.pathname === RATTANAKOSIN_PMTILES_PATH) {
      return serveRattanakosinPmtiles(request, env);
    }
    if (url.pathname === "/labs/paper") {
      const paper = new URL("/labs/paper/", url);
      return env.ASSETS.fetch(new Request(paper, request));
    }
    if (SPA_FALLBACK_PATHS.has(url.pathname)) {
      const fallback = new URL("/", url);
      return env.ASSETS.fetch(new Request(fallback, request));
    }
    return env.ASSETS.fetch(request);
  },

  /** Cron-driven ingest. Without this, an incident that appears and drops
   * out of the upstream 20-item window between two visitors would never be
   * captured at all. Polling on a schedule means the map has real history
   * the moment someone opens it. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          // Any absolute origin works — it only resolves the ASSETS binding
          // for the districts GeoJSON used to tag each event's district.
          const req = new Request("https://atlas.nonarkara.org/");
          const result = await ingestCityEvents(env, req);
          console.log("city-events cron ingest", JSON.stringify(result));
          const news = await ingestNewsEvents(env, req);
          console.log("news-events cron ingest", JSON.stringify(news));
        } catch (error) {
          console.warn("city-events cron ingest failed:", String(error));
        }
        try {
          const state = await refreshFloodDash(env, await floodDeps(env, new Request("https://atlas.nonarkara.org/")));
          console.log("flooddash relay", state?.fetchedAt ?? "no state", JSON.stringify(state?.parts ?? null));
        } catch (error) {
          console.warn("flooddash relay failed:", String(error));
        }
        try {
          const req = new Request("https://atlas.nonarkara.org/");
          await refreshFloodRoads(env, await floodRoadDeps(env, req, ctx));
        } catch (error) {
          console.warn("flood-roads refresh failed:", String(error));
        }
      })(),
    );
  },
};
