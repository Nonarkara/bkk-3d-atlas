// Cloudflare Worker entry. The atlas itself is a static SPA in public/;
// this worker exists so we can run on a custom domain (atlas.nonarkara.org)
// and so server-side logic (analytics ingest, geocoding, the
// iTIC/Longdo traffic proxy, and the 3D buildings PMTiles Range proxy)
// has a place to land. Today it:
//   (1) proxies /api/traffic to the iTIC/Longdo feed using a secret key
//   (2) serves /bkk-buildings.pmtiles from R2 with HTTP Range passthrough
//   (3) serves /api/risk flood × PM2.5 civic score
//   (4) serves /api/cctv — public iTIC/Longdo traffic cameras (Bangkok metro)
//   (5) serves /api/flood-sensors — HII/ThaiWater water-level gauges (Bangkok metro)
//   (6) falls back to the static asset binding for everything else
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
const FLOOD_ASSET = "/bkk-flood-envelope.geojson";

const LONGDO_TRAFFIC_FEED = "https://traffic.longdo.com/api/feed/itsth";
const LONGDO_CCTV_FEED = "https://camera.longdo.com/feed/?command=json";
const THAIWATER_LEVEL_FEED = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load";
const TRAFFIC_CACHE_TTL_SECONDS = 90;
const CCTV_CACHE_TTL_SECONDS = 300;
const RISK_CACHE_TTL_SECONDS = 3600;
const FLOOD_SENSOR_CACHE_TTL_SECONDS = 300;

/** HII situation_level → label/color. 1 critically-low ... 5 overflowing. */
const FLOOD_LEVEL_INFO: Record<number, { label: string; color: string }> = {
  1: { label: "critically low", color: "#B7AFA3" },
  2: { label: "low", color: "#948C7F" },
  3: { label: "normal", color: "#00933C" },
  4: { label: "high", color: "#E86A10" },
  5: { label: "overflowing", color: "#A51931" },
};

/** Bangkok + immediate metro ring used for CCTV filtering. */
const CCTV_BBOX = {
  minLat: 13.4,
  maxLat: 14.2,
  minLon: 100.2,
  maxLon: 101.1,
};

type ThaiWaterStation = {
  waterlevel_datetime?: string;
  waterlevel_msl?: string | number;
  storage_percent?: string | number;
  situation_level?: number | null;
  basin?: { basin_name?: { th?: string; en?: string } };
  station?: {
    id?: number;
    tele_station_name?: { th?: string; en?: string };
    tele_station_lat?: number;
    tele_station_long?: number;
    min_bank?: number;
    ground_level?: number;
  };
  geocode?: { area_name?: { th?: string; en?: string }; amphoe_name?: { th?: string; en?: string } };
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

/** Risk: land price × schematic flood × live PM2.5 → 0–100 civic score. */
async function lookupRisk(request: Request, env: Env): Promise<Response> {
  const parsed = parseBangkokLngLat(request);
  if (parsed instanceof Response) return parsed;
  const { lng, lat } = parsed;
  const url = new URL(request.url);
  const pm25Override = Number.parseFloat(url.searchParams.get("pm25") ?? "");

  const [floodCollection, pm25Live] = await Promise.all([
    loadFloodCollection(env, request),
    Number.isFinite(pm25Override) ? Promise.resolve(pm25Override) : fetchPointPm25(lat, lng),
  ]);

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
    const res = await fetch(aqUrl, {
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
    const upstream = await fetch(LONGDO_CCTV_FEED, {
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

function waterStationsToGeoJson(rows: ThaiWaterStation[]) {
  const features = [];
  for (const row of rows) {
    const station = row.station;
    const lat = station?.tele_station_lat;
    const lon = station?.tele_station_long;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!inCctvBbox(lat as number, lon as number)) continue;
    const level = typeof row.situation_level === "number" ? row.situation_level : null;
    const info = level != null ? FLOOD_LEVEL_INFO[level] : null;
    const name = station?.tele_station_name;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        id: station?.id ?? `${lat},${lon}`,
        name: name?.en || name?.th || "Water level station",
        level,
        levelLabel: info?.label ?? "unknown",
        levelColor: info?.color ?? "#6b7280",
        waterlevelMsl: row.waterlevel_msl != null ? Number(row.waterlevel_msl) : null,
        storagePercent: row.storage_percent != null ? Number(row.storage_percent) : null,
        minBank: station?.min_bank ?? null,
        basin: row.basin?.basin_name?.en || row.basin?.basin_name?.th || null,
        district: row.geocode?.amphoe_name?.en || row.geocode?.amphoe_name?.th || null,
        observedAt: row.waterlevel_datetime ?? null,
      },
    });
  }
  return {
    type: "FeatureCollection",
    name: "bkk-flood-sensors",
    source: THAIWATER_LEVEL_FEED,
    attribution: "Hydro-Informatics Institute (HII) / ThaiWater · public telemetry",
    disclaimer:
      "Real-time water-level gauges, not a flood forecast. situation_level is HII's own bank-relative scale (1 critically low – 5 overflowing).",
    bbox: CCTV_BBOX,
    count: features.length,
    features,
  };
}

async function proxyFloodSensors(_request: Request, _env: Env): Promise<Response> {
  try {
    const upstream = await fetch(THAIWATER_LEVEL_FEED, {
      headers: { "user-agent": "BKKx-3D-Atlas/1.0 (+https://atlas.nonarkara.org)" },
    });
    if (!upstream.ok) {
      return jsonResponse(
        {
          error: "flood_sensor_upstream_error",
          status: upstream.status,
          message: `ThaiWater feed returned ${upstream.status}.`,
        },
        { status: 502 },
      );
    }
    const payload = (await upstream.json()) as { waterlevel_data?: { data?: ThaiWaterStation[] } };
    const rows = payload?.waterlevel_data?.data;
    if (!Array.isArray(rows)) {
      return jsonResponse(
        { error: "flood_sensor_bad_payload", message: "ThaiWater feed did not return waterlevel_data.data." },
        { status: 502 },
      );
    }
    const geojson = waterStationsToGeoJson(rows);
    return new Response(JSON.stringify(geojson), {
      status: 200,
      headers: {
        "content-type": "application/geo+json; charset=utf-8",
        "cache-control": `public, max-age=${FLOOD_SENSOR_CACHE_TTL_SECONDS}`,
        "x-bkkx-source": "HII/ThaiWater water-level feed",
        "access-control-allow-origin": "*",
      },
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "flood_sensor_fetch_failed",
        message: String(error),
      },
      { status: 502 },
    );
  }
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
    if (url.pathname === "/api/cctv") {
      return proxyCctv(request, env);
    }
    if (url.pathname === "/api/flood-sensors") {
      return proxyFloodSensors(request, env);
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
