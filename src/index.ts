// Cloudflare Worker entry. The atlas itself is a static SPA in public/;
// this worker exists so we can run on a custom domain (atlas.nonarkara.org)
// and so server-side logic (analytics ingest, geocoding, the
// iTIC/Longdo traffic proxy, and the 3D buildings PMTiles Range proxy)
// has a place to land. Today it:
//   (1) proxies /api/traffic to the iTIC/Longdo feed using a secret key
//   (2) serves /bkk-buildings.pmtiles from R2 with HTTP Range passthrough
//   (3) serves /api/land-price nearest-zone lookup (property-tech lite)
//   (4) serves /api/risk land × flood schematic score
//   (5) falls back to the static asset binding for everything else
//
// Why R2 for PMTiles: the Workers [assets] binding does NOT honor HTTP
// Range requests — every GET returns the full 17 MB. The pmtiles
// client lib streams by issuing Range requests for the directory and
// individual tiles, so we proxy through R2 which supports Range natively.

export interface Env {
  ASSETS: Fetcher;
  BKK_TILES: R2Bucket;
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
const LAND_PRICE_ASSET = "/bkk-land-price.geojson";
const FLOOD_ASSET = "/bkk-flood-envelope.geojson";

const LONGDO_TRAFFIC_FEED = "https://traffic.longdo.com/api/feed/itsth";
const TRAFFIC_CACHE_TTL_SECONDS = 90;
const LAND_PRICE_CACHE_TTL_SECONDS = 3600;

type LandPriceProps = {
  zone_id: string;
  price_per_wah: number;
  min_price: number;
  max_price: number;
  parcel_count: number;
};

type LandPriceFeature = {
  type: "Feature";
  properties: LandPriceProps;
  geometry: { type: "Point"; coordinates: [number, number] };
};

type LandPriceCollection = {
  type: "FeatureCollection";
  features: LandPriceFeature[];
  notes?: string;
  license?: string;
  source?: string;
  version?: string;
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

let landPriceCache: LandPriceCollection | null = null;
let floodCache: FloodCollection | null = null;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", `public, max-age=${TRAFFIC_CACHE_TTL_SECONDS}`);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
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

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function loadLandPriceCollection(env: Env, request: Request): Promise<LandPriceCollection | null> {
  if (landPriceCache) return landPriceCache;
  const assetUrl = new URL(LAND_PRICE_ASSET, request.url);
  const res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
  if (!res.ok) return null;
  const body = (await res.json()) as LandPriceCollection;
  if (!body?.features?.length) return null;
  landPriceCache = body;
  return body;
}

function nearestLandPrice(
  collection: LandPriceCollection,
  lng: number,
  lat: number,
): { zone: LandPriceProps; lng: number; lat: number; distanceM: number } | null {
  let best: { zone: LandPriceProps; lng: number; lat: number; distanceM: number } | null = null;
  for (const feature of collection.features) {
    if (feature.geometry?.type !== "Point") continue;
    const [zLng, zLat] = feature.geometry.coordinates;
    if (!Number.isFinite(zLng) || !Number.isFinite(zLat)) continue;
    const distanceM = haversineMeters(lng, lat, zLng, zLat);
    if (!best || distanceM < best.distanceM) {
      best = { zone: feature.properties, lng: zLng, lat: zLat, distanceM };
    }
  }
  return best;
}

/** Property-tech lite: nearest Treasury land-price zone for a lng/lat. */
async function lookupLandPrice(request: Request, env: Env): Promise<Response> {
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

  const collection = await loadLandPriceCollection(env, request);
  if (!collection) {
    return jsonResponse(
      { error: "land_price_unavailable", message: "Could not load bkk-land-price.geojson from assets." },
      { status: 503 },
    );
  }

  const nearest = nearestLandPrice(collection, lng, lat);
  if (!nearest) {
    return jsonResponse({ error: "no_zones", message: "Land-price collection has no point features." }, { status: 404 });
  }

  return jsonResponse(
    {
      tool: "land-price",
      query: { lng, lat },
      nearestZone: {
        zone_id: nearest.zone.zone_id,
        price_per_wah: nearest.zone.price_per_wah,
        min_price: nearest.zone.min_price,
        max_price: nearest.zone.max_price,
        parcel_count: nearest.zone.parcel_count,
        displayLng: nearest.lng,
        displayLat: nearest.lat,
        distanceM: Math.round(nearest.distanceM),
      },
      notes:
        collection.notes ??
        "Display positions are grid-layout approximations of UTMMAP3 zones, not exact cadastral centroids.",
      license: collection.license ?? null,
      source: collection.source ?? null,
      version: collection.version ?? null,
      assessment: "Treasury Department ราคาประเมินที่ดิน 2024–2028",
    },
    {
      headers: {
        "cache-control": `public, max-age=${LAND_PRICE_CACHE_TTL_SECONDS}`,
        "access-control-allow-origin": "*",
      },
    },
  );
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

/** Risk lite: land price × schematic flood severity → 0–100 civic score. */
async function lookupRisk(request: Request, env: Env): Promise<Response> {
  const parsed = parseBangkokLngLat(request);
  if (parsed instanceof Response) return parsed;
  const { lng, lat } = parsed;

  const [landCollection, floodCollection] = await Promise.all([
    loadLandPriceCollection(env, request),
    loadFloodCollection(env, request),
  ]);

  const nearest = landCollection ? nearestLandPrice(landCollection, lng, lat) : null;
  const flood = floodCollection
    ? floodHit(floodCollection, lng, lat)
    : { inside: false as const, envelopes: [] as FloodProps[], top: null };

  const severity = flood.inside ? (flood.top?.severity ?? "medium") : "none";
  const severityWeight = ({ none: 0, low: 0.35, medium: 0.65, high: 1 } as Record<string, number>)[severity] ?? 0;
  const price = nearest?.zone.price_per_wah ?? 0;
  const landFactor = price > 0 ? Math.min(1, Math.log10(price + 10) / 6) : 0;
  const score = Math.round(100 * (0.45 * landFactor + 0.55 * severityWeight));

  return jsonResponse(
    {
      tool: "risk",
      query: { lng, lat },
      score,
      band: score >= 70 ? "high" : score >= 40 ? "elevated" : "moderate",
      factors: {
        landPricePerWah: price || null,
        zone_id: nearest?.zone.zone_id ?? null,
        floodInside: flood.inside,
        floodSeverity: severity,
        floodEnvelope: flood.top?.name ?? null,
        depthHintM: flood.top?.depthHintM ?? null,
      },
      nearestZone: nearest
        ? {
            zone_id: nearest.zone.zone_id,
            price_per_wah: nearest.zone.price_per_wah,
            distanceM: Math.round(nearest.distanceM),
          }
        : null,
      disclaimer:
        floodCollection?.disclaimer ??
        "Schematic civic score — not for insurance underwriting or official planning.",
    },
    {
      headers: {
        "cache-control": `public, max-age=${LAND_PRICE_CACHE_TTL_SECONDS}`,
        "access-control-allow-origin": "*",
      },
    },
  );
}

async function proxyTraffic(request: Request, env: Env): Promise<Response> {
  if (!env.LONGDO_KEY) {
    return jsonResponse(
      {
        error: "longdo_key_not_configured",
        message:
          "LONGDO_KEY is not set on the worker. Run: npx wrangler secret put LONGDO_KEY. " +
          "For now, the static sample at /bkk-traffic-sample.geojson is used.",
        dataOrigin: "https://itic.longdo.com/opendata/",
      },
      { status: 503 },
    );
  }
  const url = new URL(LONGDO_TRAFFIC_FEED);
  url.searchParams.set("key", env.LONGDO_KEY);
  try {
    const upstream = await fetch(url.toString(), {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/traffic") {
      return proxyTraffic(request, env);
    }
    if (url.pathname === "/api/land-price") {
      return lookupLandPrice(request, env);
    }
    if (url.pathname === "/api/risk") {
      return lookupRisk(request, env);
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
};
