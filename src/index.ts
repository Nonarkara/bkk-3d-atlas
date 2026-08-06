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
//   (6) serves /api/civic-pois(/analysis) from CIVIC_DB (D1) — schools,
//       sports grounds, car parks, museums, waterway landmarks ingested
//       from data.go.th / data.bangkok.go.th by scripts/ingest-bma-open-data.py
//   (7) falls back to the static asset binding for everything else
//
// Why R2 for PMTiles: the Workers [assets] binding does NOT honor HTTP
// Range requests — every GET returns the full 17 MB. The pmtiles
// client lib streams by issuing Range requests for the directory and
// individual tiles, so we proxy through R2 which supports Range natively.

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
//   GET /api/atlas/transit?lng=&lat=&radius=    — N nearest rail segments
//   GET /api/atlas/buildings?bbox=&limit=       — PMTiles pointer (honest)
//   GET /api/atlas/scoreboard                   — single object: live health
// ─────────────────────────────────────────────────────────────────────────────

const ATLAS_API_VERSION = 1;
const ATLAS_AREAS_ASSET = "/bkk-areas.json";
const ATLAS_DISTRICTS_ASSET = "/bkk-districts.geojson";
const ATLAS_LAND_PRICE_ASSET = "/bkk-land-price-districts.geojson";
const ATLAS_RAIL_ASSET = "/bkk-rail.geojson";
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

  const [districts, landPrice, rail, floodCollection] = await Promise.all([
    getDistrictsGeoJson(env, request),
    getLandPriceGeoJson(env, request),
    getRailGeoJson(env, request),
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

  // Summary band — a one-line read the agent can use directly.
  const landPriceBand =
    landPriceRow?.peakNewPrice == null
      ? "unknown"
      : landPriceRow.peakNewPrice >= 350000
        ? "premium"
        : landPriceRow.peakNewPrice >= 100000
          ? "mid"
          : "value";
  const transitBand =
    nearestTransit == null
      ? "unknown"
      : nearestTransit.distanceM <= 600
        ? "walkable"
        : nearestTransit.distanceM <= 1500
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

  const rail = await getRailGeoJson(env, request);
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

  return jsonResponse(
    {
      tool: "atlas-transit",
      version: ATLAS_API_VERSION,
      source: ATLAS_RAIL_ASSET,
      query: { lng, lat, radiusM: radius, limit },
      count: trimmed.length,
      totalInRadius: hits.length,
      segments: trimmed,
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

async function atlasScoreboard(_request: Request, env: Env): Promise<Response> {
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

  return jsonResponse(
    {
      tool: "atlas-scoreboard",
      version: ATLAS_API_VERSION,
      buildings: { totalMetro: ATLAS_BUILDINGS_COUNT, totalRattanakosin: ATLAS_BUILDINGS_RATTANAKOSIN_COUNT, regeneratedAt: ATLAS_BUILDINGS_PMTILES_REGEN },
      districts: 50,
      rail: { lines: 9, segments: 126 },
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
        floodSensors: { source: "HII / ThaiWater", live: true },
        rain: { source: "RainViewer", live: true },
        aqi: { source: "Open-Meteo CAMS", live: true },
        heat: { source: "Open-Meteo", live: true },
      },
      copyright: "© OpenStreetMap contributors under ODbL 1.0. Esri imagery © Esri, Maxar, Earthstar Geographics (non-commercial use).",
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
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
        { path: "/api/flood-sensors", method: "GET", description: "HII/ThaiWater water-level gauges in Bangkok metro.", cacheSeconds: FLOOD_SENSOR_CACHE_TTL_SECONDS },
        { path: "/api/civic-pois", method: "GET", description: "BMA open-data civic amenities from D1.", query: ["category?", "district?", "limit?"] },
        { path: "/api/civic-pois/analysis", method: "GET", description: "Amenity counts aggregated by district for choropleths." },
        { path: "/api/risk", method: "GET", description: "Point risk: schematic flood envelope × live PM2.5.", query: ["lng", "lat"], example: "/api/risk?lng=100.5321&lat=13.7367", cacheSeconds: RISK_CACHE_TTL_SECONDS },
        { path: "/api/atlas/areas", method: "GET", description: "16 curated atlas areas (AI-readable mirror)." },
        { path: "/api/atlas/districts", method: "GET", description: "50 khet + merged land-price summary." },
        { path: "/api/atlas/at-this-point", method: "GET", description: "District + land + flood + nearest transit at a point.", query: ["lng", "lat"] },
        { path: "/api/atlas/transit", method: "GET", description: "Nearest rail segments.", query: ["lng", "lat", "radius?", "limit?"] },
        { path: "/api/atlas/buildings", method: "GET", description: "PMTiles pointers for 432K buildings." },
        { path: "/api/atlas/scoreboard", method: "GET", description: "Single-object live health / inventory." },
        { path: "/bkk-buildings.pmtiles", method: "GET", description: "432,077 OSM buildings — HTTP Range from R2." },
        { path: "/bkk-buildings-rattanakosin.pmtiles", method: "GET", description: "Rattanakosin detail buildings PMTiles (zoom 14–18)." },
      ],
      staticGeojson: [
        "/bkk-areas.json",
        "/bkk-rail.geojson",
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return proxyFloodSensors(request, env);
    }
    if (url.pathname === "/api/civic-pois") {
      return listCivicPois(request, env);
    }
    if (url.pathname === "/api/civic-pois/analysis") {
      return civicPoiAnalysis(request, env);
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
};
