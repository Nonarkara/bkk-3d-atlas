// BKKx 3D Atlas — MapLibre viewer with toggleable data layers.
// No build step. Layers are declared in the LAYERS registry below;
// each entry owns its source(s), paint, and toggle behavior.
//
// Sharp edges only. No rounded corners on the chrome.
// Signal yellow `#c9ff38` is reserved for the primary buildings layer
// when in monochrome mode. The "type colors" mode pulls from the
// BUILDING_COLOR_BY_TYPE expression (cultural / civic / commercial /
// residential / industrial palettes).

const OPENFREEMAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const ESRI_IMAGERY_TILES = [
  "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
const ESRI_ATTRIBUTION =
  "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const BUILDING_SOURCE_CANDIDATES = ["openfreemap", "openmaptiles", "bkkx-pmtiles-buildings"];

// BKKx 3D buildings PMTiles. 432,077 OSM building footprints for the
// Bangkok metro (100.30–100.95 E, 13.45–14.10 N). The Worker serves
// the file from R2 with HTTP Range support.
const BKKX_BUILDINGS_PMTILES_URL = "/bkk-buildings.pmtiles";
const BKKX_BUILDINGS_PMTILES_LAYER = "bkkx-pmtiles-buildings";
// Metro tippecanoe tiles stop at z15 (--simplification=20). Past that,
// MapLibre overscales the simplified footprints into sawtooth roofs.
// Hand off to OpenFreeMap planet building tiles at street zoom.
const BKKX_BUILDINGS_LAYER = "bkkx-3d-buildings";
const BKKX_BUILDINGS_HI_LAYER = "bkkx-3d-buildings-hi";
const BKKX_BUILDINGS_HANDOFF_ZOOM = 15;

// Rattanakosin / Grand Palace detail — full unsimplified OSM footprints
// (GeoJSON) with heritage heights baked in. Replaces the tippecanoe
// PMTiles path for Old Town so chedis, throne halls, and shophouse
// rows keep sharp footprints past metro maxzoom 15.
// Fallback PMTiles kept if the GeoJSON fails to load.
const HERITAGE_DETAIL_URL = "/bkk-heritage-detail.geojson";
const HERITAGE_DETAIL_SOURCE = "bkkx-heritage-detail";
const BKKX_RATTANAKOSIN_PMTILES_URL = "/bkk-buildings-rattanakosin.pmtiles";
const BKKX_RATTANAKOSIN_PMTILES_LAYER = "bkkx-pmtiles-rattanakosin";
const RATTANAKOSIN_BUILDINGS_LAYER = "bkkx-rattanakosin-buildings";

// Curated landmark extrusions — Victory Monument 50 m shaft, Democracy
// Monument, Golden Mount (~60 m), plus named heritage overrides.
// OSM tags Victory/Democracy as historic=monument (not building), so
// the building pipeline never extruded them.
const LANDMARKS_URL = "/bkk-landmarks.geojson";
const LANDMARKS_SOURCE = "bkkx-landmarks";
const LANDMARKS_LAYER = "bkkx-landmarks-extrusion";

// Building height — clamp to a sane range. OSM data occasionally
// has corrupt building:levels tags (e.g. "12345678910111212") that
// would otherwise produce 50-petrometre sky-pillars. Anything below
// 0 or above 500 m falls back to the building-type default.
//
// Pure `case` form (no `let`) — simpler and harder to get wrong.
// The `let` form bit me once (a 3-element return renders as 0/1),
// so the structure here is intentionally minimal.
const HEIGHT_GET = [
  "case",
  ["all",
    [">=", ["coalesce", ["get", "render_height"], ["get", "height"], 0], 1],
    ["<=", ["coalesce", ["get", "render_height"], ["get", "height"], 0], 500],
  ],
  ["coalesce", ["get", "render_height"], ["get", "height"], 9],
  9,
];
// Base must stay strictly below height — base >= height makes MapLibre
// emit degenerate roof triangles that read as sawteeth.
const MIN_HEIGHT_RAW = [
  "coalesce",
  ["get", "render_min_height"],
  ["get", "min_height"],
  ["get", "base_height"],
  0,
];
const MIN_HEIGHT_GET = [
  "case",
  [">=", MIN_HEIGHT_RAW, HEIGHT_GET],
  0,
  ["max", 0, MIN_HEIGHT_RAW],
];

const BUILDING_HEIGHT_EXPRESSION = HEIGHT_GET;
const BUILDING_MIN_HEIGHT_EXPRESSION = MIN_HEIGHT_GET;

// Old Town: when OSM has no real height (stuck on the 9 m default),
// lift temples / shophouse fabric so Rattanakosin reads as a city
// of wats and 2–3 storey rows, not a flat plate. Real tagged heights
// still win. Landmark overlays add the tall chedis / Victory Monument.
const RATTANAKOSIN_HEIGHT_EXPRESSION = [
  "case",
  ["!=", HEIGHT_GET, 9], HEIGHT_GET,
  ["match", ["coalesce", ["get", "building"], ["get", "building_type"], ""],
    "temple", 18,
    "pagoda", 36,
    "shrine", 14,
    "chapel", 14,
    "monastery", 16,
    "commercial", 12,
    "retail", 12,
    "terrace", 12,
    "house", 10,
    "residential", 10,
    9,
  ],
];
const RATTANAKOSIN_MIN_HEIGHT_EXPRESSION = [
  "case",
  [">=", MIN_HEIGHT_RAW, RATTANAKOSIN_HEIGHT_EXPRESSION],
  0,
  ["max", 0, MIN_HEIGHT_RAW],
];

// Skip non-3D / collapsed footprints that otherwise fang the skyline.
const BUILDING_EXTRUSION_FILTER = [
  "all",
  ["!=", ["get", "hide_3d"], true],
  [">", HEIGHT_GET, 0],
];

// Opacity hits 1.0 by street zoom — translucent fill-extrusion on
// Chrome/macOS z-fights into glittery roof shards.
const BUILDING_OPACITY_BY_ZOOM = [
  "interpolate", ["linear"], ["zoom"],
  11, 0.5,
  13, 0.82,
  14.5, 1,
  17, 1,
];
const BUILDING_OPACITY_WEATHER = [
  "interpolate", ["linear"], ["zoom"],
  11, 0.4,
  13, 0.7,
  15, 0.9,
  17, 0.95,
];

// 3D buildings — monochrome (signal yellow) for the default atlas mode.
const BUILDING_PAINT_MONOCHROME = {
  "fill-extrusion-color": "#c9ff38",
  "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
  "fill-extrusion-base": BUILDING_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": BUILDING_OPACITY_BY_ZOOM,
  "fill-extrusion-vertical-gradient": true,
};

// 3D buildings — by OSM type. Cultural / civic / commercial /
// residential / industrial / hospitality each get their own swatch
// (high-saturation, BKKx-adjacent). Falls back to signal yellow for
// the 333K untagged "yes" buildings so the city silhouette still
// reads at city scale. This is the default paint (see `state.buildingPaint`
// = "type") — the monochrome signal-yellow look is the alt.
const BUILDING_COLOR_BY_TYPE = [
  "match", ["get", "building"],
  // cultural / religious — gold + warm bronze
  "temple", "#f5b800",
  "pagoda", "#f5b800",
  "shrine", "#e9a91a",
  "wayside_shrine", "#e9a91a",
  "monastery", "#b08c1f",
  "mosque", "#a8c84a",
  "church", "#c89b3c",
  "cathedral", "#c89b3c",
  "chapel", "#c89b3c",
  "synagogue", "#5b9cb8",
  // civic / public
  "civic", "#b8b8b8",
  "public", "#b8b8b8",
  "government", "#888888",
  "fire_station", "#ef4444",
  "police", "#3b5cdb",
  "townhall", "#b8b8b8",
  // hospitality / tourism
  "hotel", "#ec4899",
  "motel", "#ec4899",
  "guest_house", "#d946a0",
  "hostel", "#d946a0",
  "museum", "#a855f7",
  // education — clear blues
  "school", "#3b82f6",
  "kindergarten", "#60a5fa",
  "university", "#1e40af",
  "college", "#1e40af",
  // healthcare
  "hospital", "#10b981",
  "clinic", "#10b981",
  // commercial / retail — warm paper
  "commercial", "#fef3c7",
  "retail", "#fef3c7",
  "office", "#e5e5e5",
  "supermarket", "#e5e5e5",
  "mall", "#e5e5e5",
  "marketplace", "#e5e5e5",
  "market", "#e5e5e5",
  "shophouse", "#e5e5e5",
  "kiosk", "#e5e5e5",
  // industrial
  "industrial", "#6b7280",
  "warehouse", "#6b7280",
  "factory", "#6b7280",
  "manufacture", "#6b7280",
  "data_center", "#52525b",
  // residential variants
  "house", "#d4ff5b",
  "residential", "#d4ff5b",
  "detached", "#d4ff5b",
  "terrace", "#d4ff5b",
  "semidetached_house", "#d4ff5b",
  "townhouse", "#d4ff5b",
  "bungalow", "#d4ff5b",
  "hut", "#d4ff5b",
  "apartments", "#fb923c",
  "dormitory", "#fb923c",
  "condominium", "#fb923c",
  // transport
  "train_station", "#f1efe8",
  "transportation", "#f5b800",
  "parking", "#525252",
  "garage", "#525252",
  "garages", "#525252",
  "carport", "#525252",
  "fuel", "#a3a3a3",
  // storage / outbuildings
  "shed", "#c9ff38",
  "roof", "#c9ff38",
  "stilt_house", "#d4ff5b",
  "construction", "#c9ff38",
  // default
  "#c9ff38",
];

const BUILDING_PAINT_BY_TYPE = {
  "fill-extrusion-color": BUILDING_COLOR_BY_TYPE,
  "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
  "fill-extrusion-base": BUILDING_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": BUILDING_OPACITY_BY_ZOOM,
  "fill-extrusion-vertical-gradient": true,
};

// Rattanakosin Old Town — type colors + heritage-aware height defaults.
// Opacity stays 1 (layer only paints at z14+).
const RATTANAKOSIN_BUILDING_PAINT_BY_TYPE = {
  "fill-extrusion-color": BUILDING_COLOR_BY_TYPE,
  "fill-extrusion-height": RATTANAKOSIN_HEIGHT_EXPRESSION,
  "fill-extrusion-base": RATTANAKOSIN_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": 1,
  "fill-extrusion-vertical-gradient": true,
};
const RATTANAKOSIN_BUILDING_PAINT_MONOCHROME = {
  "fill-extrusion-color": "#c9ff38",
  "fill-extrusion-height": RATTANAKOSIN_HEIGHT_EXPRESSION,
  "fill-extrusion-base": RATTANAKOSIN_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": 1,
  "fill-extrusion-vertical-gradient": true,
};

// Landmark paint — gold for wats / monument, warmer for Golden Mount.
const LANDMARK_COLOR = [
  "match", ["get", "kind"],
  "monument", "#e8d5a3",
  "chedi", "#f5b800",
  "golden_mount", "#f0c24a",
  "prasat", "#f0c24a",
  "mondop", "#f0c24a",
  "throne", "#e9a91a",
  "ubosot", "#f5b800",
  "viharn", "#d4a017",
  "heritage", "#f5b800",
  "#f5b800",
];
const LANDMARK_PAINT = {
  "fill-extrusion-color": LANDMARK_COLOR,
  "fill-extrusion-height": ["coalesce", ["get", "height"], 12],
  "fill-extrusion-base": ["coalesce", ["get", "base_height"], 0],
  "fill-extrusion-opacity": 1,
  "fill-extrusion-vertical-gradient": true,
};

// 3D terrain — AWS Terrarium DEM, free, no key. MapLibre's setTerrain
// uses the terrarium encoding: elevation_m = (R*256 + G + B/256) - 32768
const TERRAIN_SOURCE = "bkkx-terrain";
const TERRAIN_TILES = [
  "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
];
const TERRAIN_ATTRIBUTION =
  "Terrain © Mapzen / Tilezen · AWS Open Data · SRTM, ASTER, GMTED2010";

const TRAFFIC_SOURCE = "bkkx-traffic";
const TRAFFIC_LAYER = "bkkx-traffic-line";
const TRAFFIC_SAMPLE_URL = "/bkk-traffic-sample.geojson";
const TRAFFIC_LIVE_URL = "/api/traffic";

// Public traffic CCTV from iTIC / Longdo (same family as the traffic feed).
// Catalog: https://camera.longdo.com/feed/?command=json
// Playback: HLS on camerai1.iticfoundation.org (JPEG snapshots often empty).
const CCTV_SOURCE = "bkkx-cctv";
const CCTV_LAYER = "bkkx-cctv-dots";
const CCTV_HALO_LAYER = "bkkx-cctv-halo";
const CCTV_SAMPLE_URL = "/bkk-cctv.geojson";
const CCTV_LIVE_URL = "/api/cctv";

// Hand-curated points (see bkk-live-cams.geojson for sourcing notes per
// point): public YouTube livestreams embedded via <iframe>, plus the
// occasional link-out bookmark (kind: "link") to a login-gated system
// this atlas doesn't have open access to proxy. Distinct from the CCTV
// layer above, which is BMA-adjacent public traffic infrastructure.
const LIVE_CAM_SOURCE = "bkkx-live-cams";
const LIVE_CAM_LAYER = "bkkx-live-cam-dots";
const LIVE_CAM_HALO_LAYER = "bkkx-live-cam-halo";
const LIVE_CAM_DATA_URL = "/bkk-live-cams.geojson";

const TRAFFIC_COLOR_EXPRESSION = [
  "match", ["get", "level"],
  "heavy", "#E3252C",
  "medium", "#F2A63B",
  "light", "#54C00C",
  "#888888",
];
const TRAFFIC_WIDTH_EXPRESSION = [
  "interpolate", ["linear"], ["zoom"],
  10, 1.2, 13, 2.4, 15, 4.0, 17, 5.6,
];

const RAIL_SOURCE = "bkkx-rail";
const RAIL_LAYER = "bkkx-rail-line";
const RAIL_DATA_URL = "/bkk-rail.geojson";

const RAIL_COLOR_EXPRESSION = [
  "match", ["get", "line"],
  "BTS-Sukhumvit", "#00853F",
  "BTS-Silom",     "#00853F",
  "BTS-Gold",      "#8B6914",
  "MRT-Blue",      "#0033A0",
  "MRT-Purple",   "#6F1F7A",
  "MRT-Orange",    "#F58220",
  "MRT-Pink",      "#E94B97",
  "MRT-Yellow",    "#FFC815",
  "ARL",           "#C8102E",
  "SRT",           "#7B3F00",
  "#888888",
];
const RAIL_WIDTH_EXPRESSION = [
  "interpolate", ["linear"], ["zoom"],
  9, 0.8, 12, 2.0, 14, 3.2, 16, 4.4, 18, 5.6,
];

const KHLONG_SOURCE = "bkkx-khlongs";
const KHLONG_RIVER_LAYER = "bkkx-khlongs-river";
const KHLONG_CANAL_LAYER = "bkkx-khlongs-canal";
const KHLONG_DATA_URL = "/bkk-khlongs.geojson";

// Bangkok's 50 khet, OSM relation 92277's admin_level=6 members.
const DISTRICT_SOURCE = "bkkx-districts";
const DISTRICT_LAYER = "bkkx-district-lines";
const DISTRICT_DATA_URL = "/bkk-districts.geojson";

// Land price by district group — road-level Treasury draft prices from a
// media summary (see bkk-land-price-districts.geojson for full sourcing),
// joined onto the real district polygons above. Each district's fill is
// its group's single highest priced road, not "the district's price" —
// the source itself only gives per-road figures grouped by district
// cluster, so a uniform per-district number doesn't exist to report.
const LAND_PRICE_SOURCE = "bkkx-land-price-districts";
const LAND_PRICE_FILL_LAYER = "bkkx-land-price-fill";
const LAND_PRICE_LINE_LAYER = "bkkx-land-price-outline";
const LAND_PRICE_DATA_URL = "/bkk-land-price-districts.geojson";
const LAND_PRICE_FILL_COLOR = [
  "step", ["get", "peakNewPrice"],
  "#fef9c3",
  50000, "#fde047",
  100000, "#fbbf24",
  200000, "#f97316",
  350000, "#dc2626",
  600000, "#7f1d1d",
];

// Civic POIs — real, D1-backed (CIVIC_DB), not fetched live per request.
// See db/schema.sql + scripts/ingest-bma-open-data.py: schools, sports
// grounds, car parks, museums and waterway landmarks ingested from
// data.go.th / data.bangkok.go.th, one D1 table, one API. Colors reuse
// the same category convention as BUILDING_COLOR_BY_TYPE above (school
// blue, museum purple, parking gray) rather than inventing a new palette.
const CIVIC_POI_SOURCE = "bkkx-civic-pois";
const CIVIC_POI_LAYER = "bkkx-civic-poi-dots";
const CIVIC_POI_HALO_LAYER = "bkkx-civic-poi-halo";
const CIVIC_POI_LIVE_URL = "/api/civic-pois";
const CIVIC_POI_SAMPLE_URL = "/bkk-civic-pois.geojson";

// God Mode — live breaking incidents as red "!" pins. Source is the
// Longdo/iTIC event feed via /api/city-events (see src/index.ts): real
// reporter-supplied coordinates, D1-backed so a pin survives the
// upstream feed's rolling 20-item window, and self-expiring after an
// hour. Red is used ONLY here — it is the one alarm colour on the map,
// deliberately outside the civic/land-price palettes.
const CITY_EVENT_SOURCE = "bkkx-city-events";
const CITY_EVENT_LAYER = "bkkx-city-event-marks";
const CITY_EVENT_PULSE_LAYER = "bkkx-city-event-pulse";
const CITY_EVENT_DATA_URL = "/api/city-events";
const CITY_EVENT_REFRESH_MS = 120000;
const CITY_EVENT_LABEL = {
  accident: "Accident",
  flood: "Flooding",
  fire: "Fire",
  trafficjam: "Heavy traffic",
  roadclosed: "Road closed",
  rain: "Heavy rain",
  earthquake: "Earthquake",
  protest: "Protest",
};

// Buzz — geolocated news via /api/news-events. Deliberately amber, never
// red: red means "happening now, get out of the way", amber means "the
// city is talking about this place". Marker size carries mention count,
// so a venue with six stories reads louder than one with a single
// mention — that IS the trending signal, not a separate widget.
const NEWS_EVENT_SOURCE = "bkkx-news-events";
const NEWS_EVENT_LAYER = "bkkx-news-event-dots";
const NEWS_EVENT_GLOW_LAYER = "bkkx-news-event-glow";
const NEWS_EVENT_COUNT_LAYER = "bkkx-news-event-count";
const NEWS_EVENT_DATA_URL = "/api/news-events";
const NEWS_EVENT_REFRESH_MS = 300000;

const CIVIC_POI_CATEGORY_COLOR = [
  "match", ["get", "category"],
  "school", "#3b82f6",
  "sportsground", "#10b981",
  "carpark", "#6b7280",
  "museum", "#a855f7",
  "waterway", "#38bdf8",
  "#c9ff38",
];
const CIVIC_POI_CATEGORY_LABEL = {
  school: "School",
  sportsground: "Sports ground",
  carpark: "Car park",
  museum: "Local museum",
  waterway: "Waterway landmark",
};

// Civic density choropleth — same district polygons as the land-price
// layer, joined client-side against the live /api/civic-pois/analysis
// aggregate (computed server-side from the same D1 rows the point layer
// serves) rather than a pre-baked static file, since the whole point of
// storing this in D1 is that the analysis stays live as the store grows.
const CIVIC_DENSITY_SOURCE = "bkkx-civic-density";
const CIVIC_DENSITY_FILL_LAYER = "bkkx-civic-density-fill";
const CIVIC_DENSITY_LINE_LAYER = "bkkx-civic-density-outline";
const CIVIC_DENSITY_ANALYSIS_URL = "/api/civic-pois/analysis";
// Steps match the real distribution's quintiles (checked against the live
// analysis endpoint: 50 districts, range 11-115, median 31) — not round
// numbers picked in advance, which put nearly every district in the same
// bright mid-tier and made the choropleth unreadable.
const CIVIC_DENSITY_FILL_COLOR = [
  "step", ["get", "civicTotal"],
  "#1a1c14",
  20, "#2c3a1f",
  30, "#3f5c22",
  38, "#5f8a26",
  46, "#8fc22c",
  60, "#c9ff38",
];

const KHLONG_RIVER_WIDTH = [
  "interpolate", ["linear"], ["zoom"],
  9, 1.6, 12, 3.0, 14, 4.0, 16, 5.0,
];
const KHLONG_CANAL_WIDTH = [
  "interpolate", ["linear"], ["zoom"],
  11, 0.6, 13, 1.0, 15, 1.4, 17, 1.8,
];

// Air quality (Open-Meteo Air Quality API, free, no key). Grid
// resolution is ~5km; we sample 8×8 = 64 points across the Bangkok
// bbox and render circles + heatmap with a US-EPA-style colour ramp.
const AQI_SOURCE = "bkkx-aqi";
const AQI_LAYER = "bkkx-aqi-heat";
const AQI_CIRCLE_LAYER = "bkkx-aqi-circles";
const AQI_API = "https://air-quality-api.open-meteo.com/v1/air-quality";

// Rain radar (RainViewer, free, no key). The /public/weather-maps.json
// manifest returns a list of past + forecast tile URLs. We pick the
// most-recent past frame.
const RAIN_SOURCE = "bkkx-rain";
const RAIN_LAYER = "bkkx-rain-tiles";
const RAIN_MANIFEST = "https://api.rainviewer.com/public/weather-maps.json";
// RainViewer radar tiles only exist through z7. Above that the CDN
// returns a "Zoom Level Not Supported" placeholder PNG. Our map
// minZoom is 10, so the source MUST declare maxzoom 7 and let
// MapLibre overzoom from there.
const RAIN_MAX_ZOOM = 7;
// FloodDash cycles its last 7 past frames every 900ms to read as a live
// storm-motion loop rather than one static (often-transparent) tile.
const RAIN_FRAME_COUNT = 7;
const RAIN_FRAME_INTERVAL_MS = 900;

// Heat (Open-Meteo forecast temperature_2m). Same 8×8 grid pattern as AQI.
const HEAT_SOURCE = "bkkx-heat";
const HEAT_LAYER = "bkkx-heat-heat";
const HEAT_CIRCLE_LAYER = "bkkx-heat-circles";
const HEAT_API = "https://api.open-meteo.com/v1/forecast";

// Schematic flood envelopes (Labs sandbox). NOT official DDPM/BMA
// flood lines — generalized 2011-style corridors + monsoon pockets.
const FLOOD_SOURCE = "bkkx-flood";
const FLOOD_FILL = "bkkx-flood-fill";
const FLOOD_LINE = "bkkx-flood-line";
const FLOOD_DATA_URL = "/bkk-flood-envelope.geojson";
const FLOOD_FILL_COLOR = [
  "match", ["get", "severity"],
  "high", "#1d4ed8",
  "medium", "#3b82f6",
  "low", "#93c5fd",
  "#3b82f6",
];

// Live HII/ThaiWater water-level gauges — see /api/flood-sensors
// (src/index.ts). Circle color comes straight from the feature's
// `levelColor` property, set server-side from HII's situation_level.
const FLOOD_SENSOR_SOURCE = "bkkx-flood-sensors";
const FLOOD_SENSOR_LAYER = "bkkx-flood-sensor-dots";
const FLOOD_SENSOR_HALO_LAYER = "bkkx-flood-sensor-halo";
const FLOOD_SENSOR_LIVE_URL = "/api/flood-sensors";

const ROAD_FILTERS = {
  motorway: ["==", "class", "motorway"],
  major: ["in", "class", "trunk", "primary", "secondary"],
  minor: ["in", "class", "tertiary", "minor", "service"],
};

function lineWidth(base, top) {
  return ["interpolate", ["linear"], ["zoom"], 10, base, 18, top];
}

const state = {
  areas: [],
  activeId: null,
  map: null,
  buildingPaint: "type", // "type" (default) or "monochrome"
  rainFrames: [],
  rainIdx: 0,
  rainLastFetch: 0,
  rainTimer: null,
  inspectMarker: null,
  trafficSource: null, // "live" | "sample" | null
  cctvSource: null, // "live" | "sample" | null
  cctvPopup: null,
  cctvHls: null,
  floodSensorPopup: null,
  liveCamPopup: null,
  landPricePopup: null,
  civicPoiPopup: null,
  civicDensityPopup: null,
  cityEventPopup: null,
  cityEventTimer: null,
  newsEventPopup: null,
  newsEventTimer: null,
  // Per-category visibility for Civic amenities (legend toggles).
  civicPoiCategories: {
    school: true,
    sportsground: true,
    carpark: true,
    museum: true,
    waterway: true,
  },
  floodFeatures: null, // cached flood envelopes for point-in-polygon
  overlayOpacity: 0.45, // rain + AQI share this so the city still reads
  floodOpacity: 0.38,
  nightMode: false,
  layerOn: Object.create(null), // id → boolean, source of truth for presets
};

// Bottom → top paint order. Weather overlays sit above the city so you
// can read rain / pollution without losing the 3D silhouette.
const LAYER_STACK = [
  "bkkx-satellite",
  BKKX_BUILDINGS_LAYER,
  BKKX_BUILDINGS_HI_LAYER,
  RATTANAKOSIN_BUILDINGS_LAYER,
  LANDMARKS_LAYER,
  "bkkx-roads-minor",
  "bkkx-roads-major",
  "bkkx-roads-motorway",
  LAND_PRICE_FILL_LAYER,
  LAND_PRICE_LINE_LAYER,
  CIVIC_DENSITY_FILL_LAYER,
  CIVIC_DENSITY_LINE_LAYER,
  DISTRICT_LAYER,
  KHLONG_RIVER_LAYER,
  KHLONG_CANAL_LAYER,
  RAIL_LAYER,
  TRAFFIC_LAYER,
  FLOOD_FILL,
  FLOOD_LINE,
  FLOOD_SENSOR_HALO_LAYER,
  FLOOD_SENSOR_LAYER,
  HEAT_LAYER,
  HEAT_CIRCLE_LAYER,
  AQI_LAYER,
  AQI_CIRCLE_LAYER,
  RAIN_LAYER,
  CCTV_HALO_LAYER,
  CCTV_LAYER,
  LIVE_CAM_HALO_LAYER,
  LIVE_CAM_LAYER,
  CIVIC_POI_HALO_LAYER,
  CIVIC_POI_LAYER,
  NEWS_EVENT_GLOW_LAYER,
  NEWS_EVENT_LAYER,
  NEWS_EVENT_COUNT_LAYER,
  CITY_EVENT_PULSE_LAYER,
  CITY_EVENT_LAYER,
];

function ensureStackOrder(map) {
  if (!map) return;
  for (const id of LAYER_STACK) {
    if (map.getLayer(id)) {
      try { map.moveLayer(id); } catch { /* layer may be mid-add */ }
    }
  }
  applyOverlayCompositing(map);
}

function setLayersVisible(map, layerIds, visible) {
  const value = visible ? "visible" : "none";
  for (const id of layerIds) {
    if (map.getLayer(id)) {
      try { map.setLayoutProperty(id, "visibility", value); } catch {}
    }
  }
}

/** Keep city readable under rain + AQI + flood + heat. Softens buildings when overlays are on. */
function applyOverlayCompositing(map) {
  if (!map) return;
  // Night mode sets colours first; opacity softens after.
  applyNightMode(map);

  const weatherOn = !!(state.layerOn.rain || state.layerOn.aqi || state.layerOn.flood || state.layerOn.heat);
  const rainOpacity = state.overlayOpacity;
  const aqiOpacity = Math.min(0.72, state.overlayOpacity + 0.12);
  const heatOpacity = Math.min(0.68, state.overlayOpacity + 0.08);

  if (map.getLayer(RAIN_LAYER)) {
    try { map.setPaintProperty(RAIN_LAYER, "raster-opacity", rainOpacity); } catch {}
  }
  if (map.getLayer(AQI_LAYER)) {
    try { map.setPaintProperty(AQI_LAYER, "heatmap-opacity", aqiOpacity); } catch {}
  }
  if (map.getLayer(HEAT_LAYER)) {
    try { map.setPaintProperty(HEAT_LAYER, "heatmap-opacity", heatOpacity); } catch {}
  }
  if (map.getLayer(FLOOD_FILL)) {
    try { map.setPaintProperty(FLOOD_FILL, "fill-opacity", state.floodOpacity); } catch {}
  }

  if (!state.nightMode) {
    const buildingOpacity = weatherOn
      ? BUILDING_OPACITY_WEATHER
      : (state.buildingPaint === "type"
        ? BUILDING_PAINT_BY_TYPE["fill-extrusion-opacity"]
        : BUILDING_PAINT_MONOCHROME["fill-extrusion-opacity"]);
    for (const id of [BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER]) {
      if (map.getLayer(id)) {
        try { map.setPaintProperty(id, "fill-extrusion-opacity", buildingOpacity); } catch {}
      }
    }
    if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
      try {
        map.setPaintProperty(
          RATTANAKOSIN_BUILDINGS_LAYER,
          "fill-extrusion-opacity",
          weatherOn ? 0.92 : 1,
        );
      } catch {}
    }
  }
  updateStackChips();
}

function applyNightMode(map) {
  if (!map) return;
  document.documentElement.classList.toggle("is-night", state.nightMode);
  document.body.classList.toggle("is-night", state.nightMode);

  if (map.getLayer("bkkx-satellite")) {
    try {
      map.setPaintProperty("bkkx-satellite", "raster-opacity", state.nightMode ? 0.38 : 0.78);
      map.setPaintProperty("bkkx-satellite", "raster-saturation", state.nightMode ? -0.85 : -0.45);
      map.setPaintProperty("bkkx-satellite", "raster-brightness-min", state.nightMode ? 0 : 0.04);
      map.setPaintProperty("bkkx-satellite", "raster-brightness-max", state.nightMode ? 0.55 : 0.96);
      map.setPaintProperty("bkkx-satellite", "raster-contrast", state.nightMode ? 0.22 : 0.08);
    } catch {}
  }

  // Emissive night buildings — warm amber wash over type colours.
  if (state.nightMode) {
    for (const id of [BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER]) {
      if (!map.getLayer(id)) continue;
      try {
        map.setPaintProperty(id, "fill-extrusion-color", [
          "interpolate", ["linear"], ["zoom"],
          11, "#c9ff38",
          14, "#ffb84d",
          17, "#ffe08a",
        ]);
        map.setPaintProperty(id, "fill-extrusion-opacity", [
          "interpolate", ["linear"], ["zoom"],
          11, 0.55, 13, 0.82, 15, 1, 17, 1,
        ]);
      } catch {}
    }
  } else {
    applyBuildingPaint(map);
  }

  if (state.nightMode && map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    try {
      map.setPaintProperty(RATTANAKOSIN_BUILDINGS_LAYER, "fill-extrusion-color", "#ffe08a");
      map.setPaintProperty(RATTANAKOSIN_BUILDINGS_LAYER, "fill-extrusion-opacity", 1);
    } catch {}
  } else if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    applyRattanakosinPaint(map);
  }
  if (state.nightMode && map.getLayer(LANDMARKS_LAYER)) {
    try {
      map.setPaintProperty(LANDMARKS_LAYER, "fill-extrusion-color", "#ffe8a0");
      map.setPaintProperty(LANDMARKS_LAYER, "fill-extrusion-opacity", 1);
    } catch {}
  } else if (map.getLayer(LANDMARKS_LAYER)) {
    for (const [key, value] of Object.entries(LANDMARK_PAINT)) {
      try { map.setPaintProperty(LANDMARKS_LAYER, key, value); } catch {}
    }
  }

  const nightToggle = document.getElementById("toggle-night");
  if (nightToggle) nightToggle.checked = state.nightMode;
  const nightState = document.getElementById("toggle-night-state");
  if (nightState) nightState.textContent = state.nightMode ? "on" : "off";
}

function updateStackChips() {
  const el = document.getElementById("atlas-stack-chips");
  if (!el) return;
  const labels = {
    buildings: "City",
    rail: "Rail",
    traffic: "Traffic",
    cctv: "CCTV",
    "live-cams": "Live",
    khlongs: "Khlongs",
    districts: "Districts",
    terrain: "Terrain",
    "land-price": "Land ฿",
    "civic-pois": "Civic",
    "civic-density": "Density",
    "city-events": "Live !",
    "news-events": "Buzz",
    flood: "Flood",
    "flood-sensors": "Gauges",
    heat: "Heat",
    aqi: "AQI",
    rain: "Rain",
  };
  const on = Object.keys(labels).filter((id) => state.layerOn[id]);
  el.innerHTML = "";
  if (on.length === 0 && !state.nightMode) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  if (state.nightMode) {
    const chip = document.createElement("span");
    chip.className = "atlas-stack-chip is-night";
    chip.textContent = "Night";
    el.appendChild(chip);
  }
  for (const id of on) {
    const chip = document.createElement("span");
    chip.className = "atlas-stack-chip";
    if (id === "rain" || id === "aqi" || id === "flood" || id === "heat") chip.classList.add("is-weather");
    chip.textContent = labels[id];
    el.appendChild(chip);
  }
}

// ─────────────────────────────────────────────────────────────────
// Layer registry — declarative. Each entry describes how to install,
// uninstall, and toggle a layer. UI is built from this list.
// ─────────────────────────────────────────────────────────────────

const LAYERS = [
  {
    id: "buildings",
    name: "3D buildings",
    description: "OSM heights · 432,077 features",
    defaultOn: true,
    softUninstall: true,
    layers: [BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER, RATTANAKOSIN_BUILDINGS_LAYER, LANDMARKS_LAYER, "bkkx-satellite", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway"],
    install: async (map) => {
      installBuildings(map);
      await installRattanakosin(map);
      await installLandmarks(map);
      ensureStackOrder(map);
    },
    uninstall: (map) => {
      setLayersVisible(map, [
        BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER, RATTANAKOSIN_BUILDINGS_LAYER, LANDMARKS_LAYER,
        "bkkx-satellite", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway",
      ], false);
    },
    legend: [
      { color: "#f5b800", label: "temple / pagoda / chedi" },
      { color: "#e8d5a3", label: "Victory Monument" },
      { color: "#a8c84a", label: "mosque" },
      { color: "#c89b3c", label: "church / cathedral" },
      { color: "#3b82f6", label: "school" },
      { color: "#1e40af", label: "university" },
      { color: "#10b981", label: "hospital" },
      { color: "#ec4899", label: "hotel" },
      { color: "#a855f7", label: "museum" },
      { color: "#fef3c7", label: "commercial / shophouse" },
      { color: "#d4ff5b", label: "house" },
      { color: "#fb923c", label: "apartments" },
      { color: "#6b7280", label: "industrial" },
      { color: "#c9ff38", label: "untagged" },
    ],
  },
  {
    id: "rail",
    name: "Rail lines",
    description: "BTS / MRT / ARL · 9 lines",
    defaultOn: true,
    softUninstall: true,
    layers: [RAIL_LAYER],
    install: async (map) => { await loadRailData(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [RAIL_LAYER], false),
  },
  {
    id: "traffic",
    name: "Live traffic",
    description: "iTIC / Longdo · expressways",
    defaultOn: true,
    softUninstall: true,
    layers: [TRAFFIC_LAYER],
    install: async (map) => { await loadTrafficData(map, { preferLive: true }); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [TRAFFIC_LAYER], false),
  },
  {
    id: "cctv",
    name: "Traffic CCTV",
    description: "iTIC / Longdo · public road cameras",
    defaultOn: false,
    softUninstall: true,
    layers: [CCTV_HALO_LAYER, CCTV_LAYER],
    install: async (map) => { await loadCctvData(map, { preferLive: true }); ensureStackOrder(map); },
    uninstall: (map) => {
      closeCctvPopup();
      setLayersVisible(map, [CCTV_HALO_LAYER, CCTV_LAYER], false);
    },
  },
  {
    id: "live-cams",
    name: "Live views",
    description: "YouTube streams + 1 bookmark",
    defaultOn: false,
    softUninstall: true,
    layers: [LIVE_CAM_HALO_LAYER, LIVE_CAM_LAYER],
    install: async (map) => { await installLiveCams(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeLiveCamPopup();
      setLayersVisible(map, [LIVE_CAM_HALO_LAYER, LIVE_CAM_LAYER], false);
    },
  },
  {
    id: "khlongs",
    name: "Canals & rivers",
    description: "Chao Phraya + 3,026 khlongs",
    defaultOn: true,
    softUninstall: true,
    layers: [KHLONG_RIVER_LAYER, KHLONG_CANAL_LAYER],
    install: async (map) => { await loadKhlongData(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [KHLONG_RIVER_LAYER, KHLONG_CANAL_LAYER], false),
  },
  {
    id: "terrain",
    name: "3D terrain",
    description: "AWS Terrarium DEM · 30m grid",
    defaultOn: false,
    softUninstall: false,
    layers: [],
    install: async (map) => { installTerrain(map); },
    uninstall: (map) => uninstallTerrain(map),
  },
  {
    id: "heat",
    name: "Heat",
    description: "Open-Meteo · temperature °C",
    defaultOn: false,
    softUninstall: true,
    layers: [HEAT_LAYER, HEAT_CIRCLE_LAYER],
    install: async (map) => { await installHeat(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [HEAT_LAYER, HEAT_CIRCLE_LAYER], false),
    legend: [
      { color: "#38bdf8", label: "< 28°C" },
      { color: "#facc15", label: "28–32°C" },
      { color: "#fb923c", label: "32–35°C" },
      { color: "#ef4444", label: "35–38°C" },
      { color: "#9f1239", label: "38°C+" },
    ],
  },
  {
    id: "aqi",
    name: "Air quality",
    description: "Open-Meteo CAMS · PM2.5 heatmap",
    defaultOn: false,
    softUninstall: true,
    layers: [AQI_LAYER, AQI_CIRCLE_LAYER],
    install: async (map) => { await installAqi(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [AQI_LAYER, AQI_CIRCLE_LAYER], false),
    legend: [
      { color: "#10b981", label: "good (0–12)" },
      { color: "#84cc16", label: "moderate (12–35)" },
      { color: "#eab308", label: "unhealthy for sensitive (35–55)" },
      { color: "#f97316", label: "unhealthy (55–150)" },
      { color: "#dc2626", label: "very unhealthy (150+)" },
    ],
  },
  {
    id: "rain",
    name: "Rain radar",
    description: "RainViewer · animated loop",
    defaultOn: false,
    softUninstall: true,
    layers: [RAIN_LAYER],
    install: async (map) => { await installRain(map); ensureStackOrder(map); },
    uninstall: (map) => {
      stopRainLoop();
      setLayersVisible(map, [RAIN_LAYER], false);
    },
  },
  {
    id: "flood",
    name: "Flood envelope",
    description: "Schematic 2011-style corridors",
    defaultOn: false,
    softUninstall: true,
    layers: [FLOOD_FILL, FLOOD_LINE],
    install: async (map) => { await installFlood(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [FLOOD_FILL, FLOOD_LINE], false),
    legend: [
      { color: "#1d4ed8", label: "high severity corridor" },
      { color: "#3b82f6", label: "medium" },
      { color: "#93c5fd", label: "low / drain pocket" },
    ],
  },
  {
    id: "flood-sensors",
    name: "Flood sensors",
    description: "HII/ThaiWater · water level gauges",
    defaultOn: false,
    softUninstall: true,
    layers: [FLOOD_SENSOR_HALO_LAYER, FLOOD_SENSOR_LAYER],
    install: async (map) => { await installFloodSensors(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeFloodSensorPopup();
      setLayersVisible(map, [FLOOD_SENSOR_HALO_LAYER, FLOOD_SENSOR_LAYER], false);
    },
    legend: [
      { color: "#B7AFA3", label: "critically low" },
      { color: "#948C7F", label: "low" },
      { color: "#00933C", label: "normal" },
      { color: "#E86A10", label: "high" },
      { color: "#A51931", label: "overflowing" },
    ],
  },
  {
    id: "districts",
    name: "District lines",
    description: "OSM · 50 khet boundaries",
    defaultOn: false,
    softUninstall: true,
    layers: [DISTRICT_LAYER],
    install: async (map) => { await installDistricts(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [DISTRICT_LAYER], false),
  },
  {
    id: "land-price",
    name: "Land price by district",
    description: "Home Buyers analysis · road-level",
    defaultOn: false,
    softUninstall: true,
    layers: [LAND_PRICE_FILL_LAYER, LAND_PRICE_LINE_LAYER],
    install: async (map) => { await installLandPriceDistricts(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeLandPricePopup();
      setLayersVisible(map, [LAND_PRICE_FILL_LAYER, LAND_PRICE_LINE_LAYER], false);
    },
    legend: [
      { color: "#fef9c3", label: "< 50,000 ฿" },
      { color: "#fde047", label: "50k–100k ฿" },
      { color: "#fbbf24", label: "100k–200k ฿" },
      { color: "#f97316", label: "200k–350k ฿" },
      { color: "#dc2626", label: "350k–600k ฿" },
      { color: "#7f1d1d", label: "600k+ ฿" },
    ],
  },
  {
    id: "civic-pois",
    name: "Civic amenities",
    description: "BMA open data · D1",
    defaultOn: false,
    softUninstall: true,
    layers: [CIVIC_POI_HALO_LAYER, CIVIC_POI_LAYER],
    install: async (map) => { await installCivicPois(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeCivicPoiPopup();
      setLayersVisible(map, [CIVIC_POI_HALO_LAYER, CIVIC_POI_LAYER], false);
    },
    legend: [
      { color: "#3b82f6", label: "School", category: "school" },
      { color: "#10b981", label: "Sports ground", category: "sportsground" },
      { color: "#6b7280", label: "Car park", category: "carpark" },
      { color: "#a855f7", label: "Local museum", category: "museum" },
      { color: "#38bdf8", label: "Waterway landmark", category: "waterway" },
    ],
    legendInteractive: true,
  },
  {
    id: "civic-density",
    name: "Civic density by district",
    description: "Live from D1 · amenity counts",
    defaultOn: false,
    softUninstall: true,
    layers: [CIVIC_DENSITY_FILL_LAYER, CIVIC_DENSITY_LINE_LAYER],
    install: async (map) => { await installCivicDensity(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeCivicDensityPopup();
      setLayersVisible(map, [CIVIC_DENSITY_FILL_LAYER, CIVIC_DENSITY_LINE_LAYER], false);
    },
    legend: [
      { color: "#1a1c14", label: "< 20" },
      { color: "#2c3a1f", label: "20–30" },
      { color: "#3f5c22", label: "30–38" },
      { color: "#5f8a26", label: "38–46" },
      { color: "#8fc22c", label: "46–60" },
      { color: "#c9ff38", label: "60+" },
    ],
  },
  {
    id: "news-events",
    name: "Buzz — what the city is talking about",
    description: "News matched to real places · 14d",
    defaultOn: false,
    softUninstall: true,
    layers: [NEWS_EVENT_GLOW_LAYER, NEWS_EVENT_LAYER, NEWS_EVENT_COUNT_LAYER],
    install: async (map) => { await installNewsEvents(map); ensureStackOrder(map); },
    uninstall: (map) => {
      stopNewsEventPolling();
      closeNewsEventPopup();
      setLayersVisible(map, [NEWS_EVENT_GLOW_LAYER, NEWS_EVENT_LAYER, NEWS_EVENT_COUNT_LAYER], false);
    },
  },
  {
    id: "city-events",
    name: "Live incidents",
    description: "iTIC · breaking, self-clears in 1h",
    defaultOn: false,
    softUninstall: true,
    layers: [CITY_EVENT_PULSE_LAYER, CITY_EVENT_LAYER],
    install: async (map) => { await installCityEvents(map); ensureStackOrder(map); },
    uninstall: (map) => {
      stopCityEventPolling();
      closeCityEventPopup();
      setLayersVisible(map, [CITY_EVENT_PULSE_LAYER, CITY_EVENT_LAYER], false);
    },
  },
];

// ─────────────────────────────────────────────────────────────────
// Map setup
// ─────────────────────────────────────────────────────────────────

async function fetchAreas() {
  const response = await fetch("/bkk-areas.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load bkk-areas.json: ${response.status}`);
  const data = await response.json();
  if (!data.areas || !Array.isArray(data.areas)) {
    throw new Error("bkk-areas.json is missing the `areas` array");
  }
  return data;
}

function renderQuickJump(areas) {
  const grid = document.getElementById("atlas-area-grid");
  grid.innerHTML = "";
  for (const [index, area] of areas.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "atlas-area-btn";
    button.dataset.id = area.id;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `Jump to ${area.name}`);
    button.innerHTML = `
      <span class="atlas-area-num">${String(index + 1).padStart(2, "0")}</span>
      <span>${area.name}</span>
    `;
    button.addEventListener("click", () => flyToArea(area.id, { updateHash: true, instant: false }));
    grid.appendChild(button);
  }
}

function setActiveArea(id) {
  state.activeId = id;
  for (const btn of document.querySelectorAll(".atlas-area-btn")) {
    btn.classList.toggle("is-active", btn.dataset.id === id);
  }
  const area = state.areas.find((a) => a.id === id);
  if (!area) return;

  const section = document.getElementById("atlas-active");
  section.hidden = false;

  document.getElementById("atlas-active-category").textContent = area.category ?? "area";
  document.getElementById("atlas-active-name").textContent = area.name;
  document.getElementById("atlas-active-thai").textContent = area.thai ?? "";
  document.getElementById("atlas-active-chapter").textContent = area.chapter ?? "";
  document.getElementById("atlas-active-desc").textContent = area.description ?? "";

  const statsEl = document.getElementById("atlas-active-stats");
  statsEl.innerHTML = "";
  if (area.keyStats) {
    for (const [key, value] of Object.entries(area.keyStats)) {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = humanize(key);
      const dd = document.createElement("dd");
      dd.textContent = String(value);
      wrap.append(dt, dd);
      statsEl.appendChild(wrap);
    }
  }

  const tagsEl = document.getElementById("atlas-active-tags");
  tagsEl.innerHTML = "";
  for (const tag of area.tags ?? []) {
    const li = document.createElement("li");
    li.textContent = tag;
    tagsEl.appendChild(li);
  }
}

function humanize(snake) {
  return snake.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function flyToArea(id, { updateHash = true, instant = false } = {}) {
  const area = state.areas.find((a) => a.id === id);
  if (!area || !state.map) return;
  state.map.flyTo({
    center: area.center,
    zoom: area.zoom ?? 15,
    pitch: area.pitch ?? 55,
    bearing: area.bearing ?? 0,
    duration: instant ? 0 : 1600,
    essential: true,
  });
  setActiveArea(id);
  if (updateHash) {
    history.replaceState(null, "", `#${area.id}`);
  }
}

function parseHashId() {
  if (typeof location === "undefined") return null;
  const raw = (location.hash || "").replace(/^#/, "").trim();
  // Reserved for the About drawer / in-drawer anchors — not area ids.
  if (!raw || raw === "about" || raw.startsWith("about-")) return null;
  return raw;
}

/** External fly-to: ?at=lng,lat,zoom. Used by bkk.nonarkara.org's quarter
 *  quick-jump chips, which target coordinates that don't match any of
 *  the 16 atlas areas. Lower priority than #hash (so a hash still wins
 *  when both are set — the hash is the in-app share link). */
function parseAtQuery() {
  if (typeof location === "undefined") return null;
  const at = new URL(location.href).searchParams.get("at");
  if (!at) return null;
  const m = at.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  const zoom = Number(m[3]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;
  return { center: [lng, lat], zoom };
}

function copyDeepLink() {
  const url = new URL(location.href);
  if (state.activeId) url.hash = state.activeId;
  const text = url.toString();
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => flashShareButton("Copied"),
      () => fallbackCopy(text),
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); flashShareButton("Copied"); }
  catch { flashShareButton("Copy failed"); }
  document.body.removeChild(ta);
}

function flashShareButton(message) {
  const btn = document.getElementById("atlas-share");
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1500);
}

// ─────────────────────────────────────────────────────────────────
// Building source
// ─────────────────────────────────────────────────────────────────

function findBuildingSource(map) {
  const style = map.getStyle();
  if (!style.sources) return null;
  if (style.sources[BKKX_BUILDINGS_PMTILES_LAYER]) {
    return {
      name: BKKX_BUILDINGS_PMTILES_LAYER,
      isPmtiles: true,
      sourceLayer: "buildings",
    };
  }
  for (const [name] of Object.entries(style.sources)) {
    if (BUILDING_SOURCE_CANDIDATES.includes(name)) {
      return { name, isPmtiles: false, sourceLayer: "building" };
    }
  }
  return null;
}

function registerPmtilesProtocol() {
  if (typeof pmtiles === "undefined") return;
  if (registerPmtilesProtocol._done) return;
  registerPmtilesProtocol._done = true;
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
}

/** Flat OFM building fills under translucent extrusions look like roof shards. */
function hideBaseBuildingFills(map) {
  const layers = map.getStyle()?.layers || [];
  for (const layer of layers) {
    if (layer.id === BKKX_BUILDINGS_LAYER || layer.id === BKKX_BUILDINGS_HI_LAYER) continue;
    if (layer.id === RATTANAKOSIN_BUILDINGS_LAYER || layer.id === LANDMARKS_LAYER) continue;
    const sourceLayer = layer["source-layer"];
    const isBuildingFill =
      layer.type === "fill" &&
      (sourceLayer === "building" || sourceLayer === "buildings" || /building/i.test(layer.id));
    const isForeignExtrusion = layer.type === "fill-extrusion";
    if (isBuildingFill || isForeignExtrusion) {
      try { map.setLayoutProperty(layer.id, "visibility", "none"); } catch {}
    }
  }
}

function findOpenMapTilesSource(map) {
  const sources = map.getStyle()?.sources || {};
  for (const name of ["openmaptiles", "openfreemap"]) {
    if (sources[name]) return name;
  }
  for (const [name, src] of Object.entries(sources)) {
    if (src?.type === "vector" && !String(name).startsWith("bkkx-")) return name;
  }
  return null;
}

function installBuildings(map) {
  registerPmtilesProtocol();
  hideBaseBuildingFills(map);

  if (!map.getSource(BKKX_BUILDINGS_PMTILES_LAYER)) {
    try {
      map.addSource(BKKX_BUILDINGS_PMTILES_LAYER, {
        type: "vector",
        url: "pmtiles://" + BKKX_BUILDINGS_PMTILES_URL,
        attribution: "© OpenStreetMap contributors (ODbL-1.0) · BKKx 3D buildings",
        maxzoom: BKKX_BUILDINGS_HANDOFF_ZOOM,
      });
    } catch (error) {
      console.warn("BKKx PMTiles source failed to register:", error);
    }
  }

  // Esri satellite base (re-applied here so toggle on/off works
  // when the user disabled the buildings layer first).
  if (!map.getSource("bkkx-esri-imagery")) {
    try {
      map.addSource("bkkx-esri-imagery", {
        type: "raster",
        tiles: ESRI_IMAGERY_TILES,
        tileSize: 256,
        attribution: ESRI_ATTRIBUTION,
        maxzoom: 19,
      });
      map.addLayer({
        id: "bkkx-satellite",
        type: "raster",
        source: "bkkx-esri-imagery",
        paint: {
          "raster-opacity": 0.78,
          "raster-saturation": -0.45,
          "raster-contrast": 0.08,
          "raster-brightness-min": 0.04,
          "raster-brightness-max": 0.96,
        },
      });
    } catch { /* fall back to dark style */ }
  }

  const source = findBuildingSource(map);
  if (!source) return;
  const sourceName = source.name;
  const sourceLayer = source.sourceLayer;

  // Tiered roads on top of the OpenFreeMap fallback (the PMTiles
  // source is buildings-only, so road layers stay on the OFM
  // source when present).
  const roadSource = findOpenMapTilesSource(map) || (!source.isPmtiles ? sourceName : null);
  if (roadSource && !map.getLayer("bkkx-roads-minor")) {
    const addLine = (id, filter, color, width, opacity) => {
      try {
        map.addLayer({
          id,
          type: "line",
          source: roadSource,
          "source-layer": "transportation",
          filter,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": color, "line-width": width, "line-opacity": opacity },
        });
      } catch { /* style schema may omit transportation */ }
    };
    addLine("bkkx-roads-minor", ROAD_FILTERS.minor, "#2c2d28", lineWidth(0.3, 2.4), 0.7);
    addLine("bkkx-roads-major", ROAD_FILTERS.major, "#5e6157", lineWidth(0.4, 3.6), 0.9);
    addLine("bkkx-roads-motorway", ROAD_FILTERS.motorway, "#c9ff38", lineWidth(0.6, 5.2), 1.0);
  }

  const paint = state.buildingPaint === "type" ? BUILDING_PAINT_BY_TYPE : BUILDING_PAINT_MONOCHROME;

  if (!map.getLayer(BKKX_BUILDINGS_LAYER)) {
    try {
      map.addLayer({
        id: BKKX_BUILDINGS_LAYER,
        type: "fill-extrusion",
        source: sourceName,
        "source-layer": sourceLayer,
        minzoom: 11,
        // Stop painting overscaled tippecanoe footprints past native z15.
        maxzoom: BKKX_BUILDINGS_HANDOFF_ZOOM,
        filter: BUILDING_EXTRUSION_FILTER,
        paint,
      });
    } catch {
      // ignore — style schema may omit extrusion; the layer just won't render
    }
  }

  // Street-zoom handoff: OpenFreeMap planet tiles keep sharp footprints
  // where metro PMTiles would overscale into sawteeth.
  const ofmSource = findOpenMapTilesSource(map);
  if (ofmSource && !map.getLayer(BKKX_BUILDINGS_HI_LAYER)) {
    try {
      map.addLayer({
        id: BKKX_BUILDINGS_HI_LAYER,
        type: "fill-extrusion",
        source: ofmSource,
        "source-layer": "building",
        minzoom: BKKX_BUILDINGS_HANDOFF_ZOOM,
        filter: BUILDING_EXTRUSION_FILTER,
        paint,
      });
    } catch (error) {
      console.warn("High-zoom OFM buildings layer failed:", error);
    }
  }

  applyBuildingPaint(map);
}

function applyBuildingPaint(map) {
  const paint = state.buildingPaint === "type" ? BUILDING_PAINT_BY_TYPE : BUILDING_PAINT_MONOCHROME;
  for (const id of [BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER]) {
    if (!map.getLayer(id)) continue;
    for (const [key, value] of Object.entries(paint)) {
      try { map.setPaintProperty(id, key, value); } catch {}
    }
    try { map.setFilter(id, BUILDING_EXTRUSION_FILTER); } catch {}
  }
  if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    applyRattanakosinPaint(map);
  }
}

function uninstallBuildings(map) {
  for (const id of [BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER, "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway", "bkkx-satellite"]) {
    if (map.getLayer(id)) try { map.removeLayer(id); } catch {}
  }
  for (const id of ["bkkx-esri-imagery", BKKX_BUILDINGS_PMTILES_LAYER]) {
    if (map.getSource(id)) try { map.removeSource(id); } catch {}
  }
}

// Rattanakosin / Grand Palace detail. Prefer the enriched GeoJSON
// (full footprints + baked heritage heights). Fall back to the older
// PMTiles if the GeoJSON is missing.
async function installRattanakosin(map) {
  const paint = state.buildingPaint === "type"
    ? RATTANAKOSIN_BUILDING_PAINT_BY_TYPE
    : RATTANAKOSIN_BUILDING_PAINT_MONOCHROME;

  let usedGeoJson = false;
  if (!map.getSource(HERITAGE_DETAIL_SOURCE)) {
    try {
      const res = await fetch(HERITAGE_DETAIL_URL);
      if (!res.ok) throw new Error(`heritage detail HTTP ${res.status}`);
      const data = await res.json();
      map.addSource(HERITAGE_DETAIL_SOURCE, {
        type: "geojson",
        data,
        attribution: "© OpenStreetMap contributors (ODbL-1.0) · BKKx heritage detail",
      });
      usedGeoJson = true;
    } catch (error) {
      console.warn("Heritage detail GeoJSON failed, falling back to PMTiles:", error);
    }
  } else {
    usedGeoJson = true;
  }

  if (!usedGeoJson && !map.getSource(BKKX_RATTANAKOSIN_PMTILES_LAYER)) {
    try {
      map.addSource(BKKX_RATTANAKOSIN_PMTILES_LAYER, {
        type: "vector",
        url: "pmtiles://" + BKKX_RATTANAKOSIN_PMTILES_URL,
        attribution: "© OpenStreetMap contributors (ODbL-1.0) · BKKx Rattanakosin",
      });
    } catch (error) {
      console.warn("Rattanakosin PMTiles source failed:", error);
    }
  }

  if (!map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    try {
      if (usedGeoJson) {
        map.addLayer({
          id: RATTANAKOSIN_BUILDINGS_LAYER,
          type: "fill-extrusion",
          source: HERITAGE_DETAIL_SOURCE,
          minzoom: 13.5,
          filter: BUILDING_EXTRUSION_FILTER,
          paint,
        });
      } else {
        map.addLayer({
          id: RATTANAKOSIN_BUILDINGS_LAYER,
          type: "fill-extrusion",
          source: BKKX_RATTANAKOSIN_PMTILES_LAYER,
          "source-layer": "buildings",
          minzoom: 14,
          filter: BUILDING_EXTRUSION_FILTER,
          paint,
        });
      }
    } catch (error) {
      console.warn("Rattanakosin buildings layer failed:", error);
    }
  } else {
    applyRattanakosinPaint(map);
  }
}

function applyRattanakosinPaint(map) {
  if (!map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) return;
  const paint = state.buildingPaint === "type"
    ? RATTANAKOSIN_BUILDING_PAINT_BY_TYPE
    : RATTANAKOSIN_BUILDING_PAINT_MONOCHROME;
  for (const [key, value] of Object.entries(paint)) {
    try { map.setPaintProperty(RATTANAKOSIN_BUILDINGS_LAYER, key, value); } catch {}
  }
}

function uninstallRattanakosin(map) {
  if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) try { map.removeLayer(RATTANAKOSIN_BUILDINGS_LAYER); } catch {}
  if (map.getSource(HERITAGE_DETAIL_SOURCE)) try { map.removeSource(HERITAGE_DETAIL_SOURCE); } catch {}
  if (map.getSource(BKKX_RATTANAKOSIN_PMTILES_LAYER)) try { map.removeSource(BKKX_RATTANAKOSIN_PMTILES_LAYER); } catch {}
}

// Landmark extrusions — Victory Monument + Rattanakosin heritage
// height overrides. Loaded as GeoJSON so we don't need a PMTiles
// re-bake / R2 upload to correct OSM's flat 9 m defaults.
async function installLandmarks(map) {
  if (!map.getSource(LANDMARKS_SOURCE)) {
    try {
      const res = await fetch(LANDMARKS_URL);
      if (!res.ok) throw new Error(`landmarks HTTP ${res.status}`);
      const data = await res.json();
      map.addSource(LANDMARKS_SOURCE, { type: "geojson", data });
    } catch (error) {
      console.warn("Landmarks source failed:", error);
      return;
    }
  }
  if (!map.getLayer(LANDMARKS_LAYER)) {
    try {
      map.addLayer({
        id: LANDMARKS_LAYER,
        type: "fill-extrusion",
        source: LANDMARKS_SOURCE,
        minzoom: 13,
        paint: LANDMARK_PAINT,
      });
    } catch (error) {
      console.warn("Landmarks layer failed:", error);
    }
  } else {
    try { map.setLayoutProperty(LANDMARKS_LAYER, "visibility", "visible"); } catch {}
  }
}

function uninstallLandmarks(map) {
  if (map.getLayer(LANDMARKS_LAYER)) try { map.removeLayer(LANDMARKS_LAYER); } catch {}
  if (map.getSource(LANDMARKS_SOURCE)) try { map.removeSource(LANDMARKS_SOURCE); } catch {}
}

// ─────────────────────────────────────────────────────────────────
// 3D terrain (AWS Terrarium DEM)
// ─────────────────────────────────────────────────────────────────

function installTerrain(map) {
  if (!map.getSource(TERRAIN_SOURCE)) {
    try {
      map.addSource(TERRAIN_SOURCE, {
        type: "raster-dem",
        tiles: TERRAIN_TILES,
        tileSize: 256,
        encoding: "terrarium",
        minzoom: 0,
        maxzoom: 15,
        attribution: TERRAIN_ATTRIBUTION,
      });
    } catch (error) {
      console.warn("Terrain DEM source failed:", error);
      return;
    }
  }
  try {
    // Bangkok is mostly flat, but Khao San Road / old town sit on a
    // ~5m ridge and there are a few real hills in neighbouring
    // provinces. exaggeration 1.5 is enough to feel the relief
    // without distorting the silhouette.
    map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1.5 });
  } catch (error) {
    console.warn("setTerrain failed:", error);
  }
}

function uninstallTerrain(map) {
  try { map.setTerrain(null); } catch {}
  if (map.getSource(TERRAIN_SOURCE)) try { map.removeSource(TERRAIN_SOURCE); } catch {}
}

// ─────────────────────────────────────────────────────────────────
// Heat heatmap (Open-Meteo forecast temperature_2m)
// ─────────────────────────────────────────────────────────────────

async function fetchOpenMeteoGrid({ apiBase, hourlyKey, propKey, extraParams = "" }) {
  // Open-Meteo multi-location pairs latitude[i] with longitude[i].
  // To get a full 8×8 grid we must expand the cartesian product into
  // 64 lat/lon pairs — NOT pass 8 lats + 8 lons (that only yields the
  // diagonal).
  const latAxis = [];
  const lonAxis = [];
  for (let i = 0; i < 8; i++) latAxis.push((13.49 + (14.10 - 13.49) * (i / 7)).toFixed(3));
  for (let j = 0; j < 8; j++) lonAxis.push((100.30 + (100.95 - 100.30) * (j / 7)).toFixed(3));
  const lats = [];
  const lons = [];
  for (let i = 0; i < latAxis.length; i++) {
    for (let j = 0; j < lonAxis.length; j++) {
      lats.push(latAxis[i]);
      lons.push(lonAxis[j]);
    }
  }
  const url = `${apiBase}?latitude=${lats.join(",")}&longitude=${lons.join(",")}&hourly=${hourlyKey}&forecast_days=1${extraParams}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const locations = Array.isArray(data) ? data : data ? [data] : [];
  if (locations.length === 0) return null;

  const features = [];
  let capturedAt = null;
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const times = loc?.hourly?.time;
    const values = loc?.hourly?.[hourlyKey];
    if (!times?.length || !values?.length) continue;
    // Prefer "now" (closest to current UTC hour); fall back to latest non-null.
    const nowIso = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    let idx = times.findIndex((t) => String(t).startsWith(nowIso));
    if (idx < 0) idx = times.length - 1;
    while (idx > 0 && (values[idx] == null || Number.isNaN(values[idx]))) idx--;
    const v = values[idx];
    if (v == null || Number.isNaN(v)) continue;
    if (!capturedAt) capturedAt = times[idx];
    const lat = Number(loc.latitude ?? lats[i]);
    const lon = Number(loc.longitude ?? lons[i]);
    features.push({
      type: "Feature",
      properties: { [propKey]: v },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }
  if (features.length === 0) return null;
  return { type: "FeatureCollection", features, _capturedAt: capturedAt };
}

async function fetchHeatGrid() {
  return fetchOpenMeteoGrid({
    apiBase: HEAT_API,
    hourlyKey: "temperature_2m",
    propKey: "tempC",
  });
}

async function installHeat(map) {
  if (map.getLayer(HEAT_CIRCLE_LAYER) && map.getLayer(HEAT_LAYER)) {
    setLayersVisible(map, [HEAT_LAYER, HEAT_CIRCLE_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  // Rebuild if an older heatmap-only install is present.
  if (map.getLayer(HEAT_LAYER) && !map.getLayer(HEAT_CIRCLE_LAYER)) {
    try { map.removeLayer(HEAT_LAYER); } catch {}
    if (map.getSource(HEAT_SOURCE)) try { map.removeSource(HEAT_SOURCE); } catch {}
  }
  const geojson = await fetchHeatGrid();
  if (!geojson || geojson.features.length === 0) {
    setLayerStatus("heat", "unavailable · Open-Meteo failed");
    console.warn("Heat fetch returned no data");
    return;
  }
  if (!map.getSource(HEAT_SOURCE)) {
    try {
      map.addSource(HEAT_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Heat source failed:", error);
      setLayerStatus("heat", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(HEAT_SOURCE).setData(geojson); } catch {}
  }
  try {
    map.addLayer({
      id: HEAT_LAYER,
      type: "heatmap",
      source: HEAT_SOURCE,
      maxzoom: 15,
      paint: {
        "heatmap-weight": [
          "interpolate", ["linear"], ["get", "tempC"],
          26, 0.15,
          30, 0.4,
          33, 0.65,
          36, 0.85,
          40, 1.0,
        ],
        "heatmap-intensity": [
          "interpolate", ["linear"], ["zoom"],
          10, 1.4, 14, 2.6,
        ],
        "heatmap-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, 28, 14, 56,
        ],
        "heatmap-opacity": Math.min(0.68, state.overlayOpacity + 0.08),
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0,    "rgba(56, 189, 248, 0)",
          0.2,  "rgba(56, 189, 248, 0.45)",
          0.4,  "rgba(250, 204, 21, 0.55)",
          0.6,  "rgba(251, 146, 60, 0.7)",
          0.8,  "rgba(239, 68, 68, 0.82)",
          1,    "rgba(159, 18, 57, 0.9)",
        ],
      },
    });
    map.addLayer({
      id: HEAT_CIRCLE_LAYER,
      type: "circle",
      source: HEAT_SOURCE,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, 10, 13, 14, 16, 20,
        ],
        "circle-color": [
          "interpolate", ["linear"], ["get", "tempC"],
          26, "#38bdf8",
          30, "#facc15",
          33, "#fb923c",
          36, "#ef4444",
          40, "#9f1239",
        ],
        "circle-opacity": 0.78,
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 0.7,
      },
    });
    const when = geojson._capturedAt ? ` · ${geojson._capturedAt.replace("T", " ").slice(0, 16)} UTC` : "";
    setLayerStatus("heat", `Open-Meteo · ${geojson.features.length} cells · °C${when}`);
  } catch (error) {
    console.warn("Heat layer failed:", error);
    setLayerStatus("heat", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// AQI heatmap (Open-Meteo CAMS)
// ─────────────────────────────────────────────────────────────────

async function fetchAqiGrid() {
  return fetchOpenMeteoGrid({
    apiBase: AQI_API,
    hourlyKey: "pm2_5",
    propKey: "pm25",
    extraParams: "&domains=cams_global",
  });
}

async function installAqi(map) {
  if (map.getLayer(AQI_CIRCLE_LAYER) && map.getLayer(AQI_LAYER)) {
    setLayersVisible(map, [AQI_LAYER, AQI_CIRCLE_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  // Rebuild if an older heatmap-only / diagonal-grid install is present.
  if (map.getLayer(AQI_LAYER) && !map.getLayer(AQI_CIRCLE_LAYER)) {
    try { map.removeLayer(AQI_LAYER); } catch {}
    if (map.getSource(AQI_SOURCE)) try { map.removeSource(AQI_SOURCE); } catch {}
  }
  const geojson = await fetchAqiGrid();
  if (!geojson || geojson.features.length === 0) {
    setLayerStatus("aqi", "unavailable · Open-Meteo failed");
    console.warn("AQI fetch returned no data");
    return;
  }
  if (!map.getSource(AQI_SOURCE)) {
    try {
      map.addSource(AQI_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("AQI source failed:", error);
      setLayerStatus("aqi", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(AQI_SOURCE).setData(geojson); } catch {}
  }
  try {
    // Heatmap alone is nearly invisible when PM2.5 is "good" (today
    // ~3–14 µg/m³) because density stays near the transparent stop.
    // Circles always show the grid; heatmap adds bloom when dirty.
    map.addLayer({
      id: AQI_LAYER,
      type: "heatmap",
      source: AQI_SOURCE,
      maxzoom: 15,
      paint: {
        "heatmap-weight": [
          "interpolate", ["linear"], ["get", "pm25"],
          0, 0.2,
          12, 0.45,
          35, 0.7,
          55, 0.85,
          150, 1.0,
        ],
        "heatmap-intensity": [
          "interpolate", ["linear"], ["zoom"],
          10, 1.6, 14, 3.0,
        ],
        "heatmap-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, 28, 14, 58,
        ],
        "heatmap-opacity": Math.min(0.72, state.overlayOpacity + 0.12),
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0,    "rgba(16, 185, 129, 0)",
          0.12, "rgba(16, 185, 129, 0.45)",
          0.25, "rgba(132, 204, 22, 0.55)",
          0.4,  "rgba(234, 179, 8, 0.65)",
          0.6,  "rgba(249, 115, 22, 0.75)",
          0.8,  "rgba(239, 68, 68, 0.85)",
          1,    "rgba(127, 29, 29, 0.92)",
        ],
      },
    });
    map.addLayer({
      id: AQI_CIRCLE_LAYER,
      type: "circle",
      source: AQI_SOURCE,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, 11, 13, 15, 16, 22,
        ],
        "circle-color": [
          "interpolate", ["linear"], ["get", "pm25"],
          0, "#10b981",
          12, "#84cc16",
          35, "#eab308",
          55, "#f97316",
          150, "#dc2626",
        ],
        "circle-opacity": 0.82,
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 0.7,
      },
    });
    const vals = geojson.features.map((f) => f.properties.pm25).filter((v) => v != null);
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "?";
    const when = geojson._capturedAt ? ` · ${geojson._capturedAt.replace("T", " ").slice(0, 16)} UTC` : "";
    setLayerStatus("aqi", `Open-Meteo · ${geojson.features.length} cells · avg ${avg} µg/m³${when}`);
  } catch (error) {
    console.warn("AQI layer failed:", error);
    setLayerStatus("aqi", "unavailable · layer failed");
  }
}

function setLayerStatus(layerId, text) {
  const detail = document.querySelector(`#toggle-${layerId} ~ .atlas-layer-name small, label:has(#toggle-${layerId}) .atlas-layer-name small`);
  // Prefer explicit detail ids when present
  const byId = document.getElementById(`toggle-${layerId}-detail`);
  const el = byId || detail;
  if (el) {
    el.textContent = text;
    // Civic legend filters append "· N/5 types" onto this base string.
    if (layerId === "civic-pois") el.dataset.baseStatus = text;
  }
}

// ─────────────────────────────────────────────────────────────────
// Rain radar (RainViewer)
// ─────────────────────────────────────────────────────────────────

async function fetchRainManifest() {
  const res = await fetch(RAIN_MANIFEST, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

function bangkokClock(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Keep the last RAIN_FRAME_COUNT past frames (+ any nowcast) so the loop
 * reads as a short storm-motion replay, same as a normal radar app —
 * not a single static tile that looks dead when Bangkok is dry. */
async function refreshRainFrames() {
  const manifest = await fetchRainManifest();
  const past = manifest?.radar?.past ?? [];
  const nowcast = manifest?.radar?.nowcast ?? [];
  const frames = [...past.slice(-RAIN_FRAME_COUNT), ...nowcast];
  if (!frames.length) return false;
  state.rainFrames = frames;
  state.rainLastFetch = Date.now();
  if (state.rainIdx >= frames.length) state.rainIdx = 0;
  return true;
}

async function installRain(map) {
  setLayersVisible(map, [RAIN_LAYER], true);
  const stale = Date.now() - state.rainLastFetch >= 5 * 60_000;
  if (!state.rainFrames.length || stale) {
    const ok = await refreshRainFrames();
    if (!ok && !state.rainFrames.length) {
      setLayerStatus("rain", "unavailable · RainViewer failed");
      console.warn("RainViewer manifest returned no frames");
      return;
    }
  }
  const frame = state.rainFrames[state.rainIdx];
  setRainTiles(map, frame.path);
  setLayerStatus("rain", `RainViewer · ${bangkokClock(frame.time)} · ${state.rainFrames.length} frames`);
  startRainLoop(map);
}

/** The "blink" is frame-cycling, not a CSS effect — same trick every
 * live radar app uses: swap the raster source's tile URL every tick and
 * let the browser's normal image load read as motion. Ported from
 * FloodDash's Leaflet radar.layer.setUrl loop (public/js/map.js). */
function startRainLoop(map) {
  if (state.rainTimer) return;
  state.rainTimer = setInterval(() => {
    if (!state.layerOn.rain || document.hidden || !state.rainFrames.length) return;
    state.rainIdx = (state.rainIdx + 1) % state.rainFrames.length;
    const frame = state.rainFrames[state.rainIdx];
    setRainTiles(map, frame.path);
    setLayerStatus("rain", `RainViewer · ${bangkokClock(frame.time)} · ${state.rainFrames.length} frames`);
    if (Date.now() - state.rainLastFetch >= 5 * 60_000) {
      refreshRainFrames().catch(() => {});
    }
  }, RAIN_FRAME_INTERVAL_MS);
}

function stopRainLoop() {
  if (state.rainTimer) {
    clearInterval(state.rainTimer);
    state.rainTimer = null;
  }
}

function setRainTiles(map, path) {
  const tiles = [
    `https://tilecache.rainviewer.com${path}/256/{z}/{x}/{y}/2/1_1.png`,
  ];
  const existing = map.getSource(RAIN_SOURCE);
  if (existing) {
    // Older sessions may have created this source with maxzoom 12,
    // which requests unsupported zooms and paints "Zoom Level Not
    // Supported" tiles across the city. Tear down and rebuild.
    const maxzoom = existing.maxzoom ?? existing._options?.maxzoom;
    if (maxzoom != null && maxzoom > RAIN_MAX_ZOOM) {
      if (map.getLayer(RAIN_LAYER)) {
        try { map.removeLayer(RAIN_LAYER); } catch {}
      }
      try { map.removeSource(RAIN_SOURCE); } catch {}
    } else {
      try { existing.setTiles(tiles); } catch {}
      if (!map.getLayer(RAIN_LAYER)) {
        addRainLayer(map);
      } else {
        setLayersVisible(map, [RAIN_LAYER], true);
        applyOverlayCompositing(map);
      }
      return;
    }
  }
  try {
    map.addSource(RAIN_SOURCE, {
      type: "raster",
      tiles,
      tileSize: 256,
      maxzoom: RAIN_MAX_ZOOM,
      attribution: "Radar © RainViewer",
    });
  } catch (error) {
    console.warn("Rain source failed:", error);
    setLayerStatus("rain", "unavailable · source failed");
    return;
  }
  addRainLayer(map);
}

function addRainLayer(map) {
  if (map.getLayer(RAIN_LAYER)) {
    setLayersVisible(map, [RAIN_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  try {
    map.addLayer({
      id: RAIN_LAYER,
      type: "raster",
      source: RAIN_SOURCE,
      paint: {
        "raster-opacity": state.overlayOpacity,
        "raster-saturation": -0.15,
        "raster-fade-duration": 250,
      },
    });
  } catch (error) {
    console.warn("Rain layer failed:", error);
    setLayerStatus("rain", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// District lines (OSM admin_level=6, relation 92277's 50 khet)
// ─────────────────────────────────────────────────────────────────

async function installDistricts(map) {
  if (map.getLayer(DISTRICT_LAYER)) {
    setLayersVisible(map, [DISTRICT_LAYER], true);
    return;
  }
  const geojson = await fetchJson(DISTRICT_DATA_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("districts", "unavailable · geojson failed");
    return;
  }
  if (!map.getSource(DISTRICT_SOURCE)) {
    try {
      map.addSource(DISTRICT_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("District source failed:", error);
      setLayerStatus("districts", "unavailable · source failed");
      return;
    }
  }
  try {
    map.addLayer({
      id: DISTRICT_LAYER,
      type: "line",
      source: DISTRICT_SOURCE,
      minzoom: 9,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#c9ff38",
        "line-width": lineWidth(0.6, 1.6),
        "line-opacity": 0.55,
        "line-dasharray": [2, 1.5],
      },
    });
    setLayerStatus("districts", `OSM · ${geojson.features.length} khet boundaries`);
  } catch (error) {
    console.warn("District layer failed:", error);
    setLayerStatus("districts", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Land price by district (road-level Treasury draft data, media
// summary — see bkk-land-price-districts.geojson for full sourcing)
// ─────────────────────────────────────────────────────────────────

function closeLandPricePopup() {
  if (state.landPricePopup) {
    try { state.landPricePopup.remove(); } catch {}
    state.landPricePopup = null;
  }
}

function formatBahtPerWah(n) {
  return `${Number(n).toLocaleString("en-US")} ฿`;
}

/** MapLibre stringifies non-primitive GeoJSON properties (arrays/objects)
 * when they pass through its tile pipeline — parse them back out. */
function parseJsonProp(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

function openLandPricePopup(map, feature) {
  const p = feature.properties || {};
  closeLandPricePopup();
  const roads = parseJsonProp(p.roads, []).slice().sort((a, b) => b.newMax - a.newMax);
  const groupDistricts = parseJsonProp(p.groupDistricts, []);
  const rows = roads.map((r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${formatBahtPerWah(r.oldMin)}${r.oldMax !== r.oldMin ? "–" + formatBahtPerWah(r.oldMax) : ""}</td>
      <td>${formatBahtPerWah(r.newMin)}${r.newMax !== r.newMin ? "–" + formatBahtPerWah(r.newMax) : ""}</td>
    </tr>
  `).join("");
  const html = `
    <div class="atlas-landprice-card">
      <p class="atlas-cctv-kicker">Land price · district group</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name_en)} (${escapeHtml(p.name_th)})</strong>
      <p class="atlas-cctv-status">
        Grouped with ${escapeHtml(groupDistricts.filter((d) => d !== p.name_en).join(", ") || "no other districts")}
        · peak new price ${formatBahtPerWah(p.peakNewPrice)}/wah
      </p>
      <div class="atlas-landprice-table-wrap">
        <table class="atlas-landprice-table">
          <thead><tr><th>Road</th><th>Old (2559–62)</th><th>New (draft)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="atlas-cctv-actions">
        <a href="https://www.home.co.th/hometips/new-land-appraisal-price-53898" target="_blank" rel="noreferrer">Source ↗</a>
        <span>฿/sq.wah</span>
      </div>
    </div>
  `;
  // No setLngLat here — this is a polygon fill, not a point; the caller
  // positions the popup at the actual click location.
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "360px",
    className: "atlas-cctv-popup",
  }).setHTML(html);
  state.landPricePopup = popup;
  return popup;
}

function wireLandPriceInteractions(map) {
  if (map.__bkkxLandPriceWired) return;
  map.__bkkxLandPriceWired = true;
  map.on("click", LAND_PRICE_FILL_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    const popup = openLandPricePopup(map, feature);
    popup.setLngLat(event.lngLat).addTo(map);
  });
  map.on("mouseenter", LAND_PRICE_FILL_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", LAND_PRICE_FILL_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installLandPriceDistricts(map) {
  if (map.getLayer(LAND_PRICE_FILL_LAYER)) {
    setLayersVisible(map, [LAND_PRICE_FILL_LAYER, LAND_PRICE_LINE_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(LAND_PRICE_DATA_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("land-price", "unavailable · geojson failed");
    return;
  }
  if (!map.getSource(LAND_PRICE_SOURCE)) {
    try {
      map.addSource(LAND_PRICE_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Land price source failed:", error);
      setLayerStatus("land-price", "unavailable · source failed");
      return;
    }
  }
  try {
    map.addLayer({
      id: LAND_PRICE_FILL_LAYER,
      type: "fill",
      source: LAND_PRICE_SOURCE,
      paint: {
        "fill-color": LAND_PRICE_FILL_COLOR,
        "fill-opacity": 0.5,
      },
    });
    map.addLayer({
      id: LAND_PRICE_LINE_LAYER,
      type: "line",
      source: LAND_PRICE_SOURCE,
      paint: {
        "line-color": "#11120f",
        "line-width": 0.6,
        "line-opacity": 0.5,
      },
    });
    wireLandPriceInteractions(map);
    setLayerStatus("land-price", `${geojson.features.length} districts · Home Buyers analysis`);
  } catch (error) {
    console.warn("Land price layer failed:", error);
    setLayerStatus("land-price", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Civic POIs — D1-backed (/api/civic-pois), see CIVIC_POI_* consts
// ─────────────────────────────────────────────────────────────────

function closeCivicPoiPopup() {
  if (state.civicPoiPopup) {
    try { state.civicPoiPopup.remove(); } catch {}
    state.civicPoiPopup = null;
  }
}

const CIVIC_POI_EXTRA_FIELDS = {
  school: [["tel", "Tel"], ["class_open", "Grades"]],
  sportsground: [["area", "Area"], ["type", "Type"]],
  carpark: [["num_car", "Car spaces"], ["num_motorc", "Motorbike spaces"]],
  museum: [["tel", "Tel"]],
  waterway: [["added", "Added"]],
};

function openCivicPoiPopup(map, feature) {
  const p = feature.properties || {};
  closeCivicPoiPopup();
  const extraRows = (CIVIC_POI_EXTRA_FIELDS[p.category] || [])
    .filter(([key]) => p[key] != null && p[key] !== "")
    .map(([key, label]) => `<p class="atlas-cctv-status">${escapeHtml(label)}: ${escapeHtml(String(p[key]))}</p>`)
    .join("");
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">${escapeHtml(CIVIC_POI_CATEGORY_LABEL[p.category] || p.category)} · ${escapeHtml(p.districtNameEn || "Bangkok")}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name)}</strong>
      ${p.address ? `<p class="atlas-cctv-status">${escapeHtml(p.address)}</p>` : ""}
      ${extraRows}
      <div class="atlas-cctv-actions">
        <span>BMA open data</span>
        <span>${feature.geometry.coordinates[1].toFixed(4)}, ${feature.geometry.coordinates[0].toFixed(4)}</span>
      </div>
    </div>
  `;
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "300px",
    className: "atlas-cctv-popup",
    anchor: "bottom",
    offset: 14,
  })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(html)
    .addTo(map);
  state.civicPoiPopup = popup;
}

function wireCivicPoiInteractions(map) {
  if (map.__bkkxCivicPoiWired) return;
  map.__bkkxCivicPoiWired = true;
  map.on("click", CIVIC_POI_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openCivicPoiPopup(map, feature);
  });
  map.on("mouseenter", CIVIC_POI_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", CIVIC_POI_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

/** MapLibre filter for currently-enabled civic categories. */
function civicPoiCategoryFilter() {
  const on = Object.entries(state.civicPoiCategories)
    .filter(([, enabled]) => enabled)
    .map(([category]) => category);
  if (on.length === 0) {
    // Match nothing — keeps layers mounted so toggles stay instant.
    return ["==", ["get", "category"], "__none__"];
  }
  return ["in", ["get", "category"], ["literal", on]];
}

function applyCivicPoiFilter(map) {
  if (!map?.getLayer(CIVIC_POI_LAYER)) return;
  const filter = civicPoiCategoryFilter();
  try {
    map.setFilter(CIVIC_POI_LAYER, filter);
    if (map.getLayer(CIVIC_POI_HALO_LAYER)) map.setFilter(CIVIC_POI_HALO_LAYER, filter);
  } catch (error) {
    console.warn("Civic POI filter failed:", error);
  }
  const visible = Object.values(state.civicPoiCategories).filter(Boolean).length;
  const total = Object.keys(state.civicPoiCategories).length;
  const detail = document.getElementById("toggle-civic-pois-detail");
  if (detail && state.layerOn["civic-pois"]) {
    const base = detail.dataset.baseStatus || detail.textContent;
    if (!detail.dataset.baseStatus) detail.dataset.baseStatus = base;
    detail.textContent = visible === total
      ? detail.dataset.baseStatus
      : `${detail.dataset.baseStatus} · ${visible}/${total} types`;
  }
}

function setCivicPoiCategory(map, category, enabled) {
  if (!(category in state.civicPoiCategories)) return;
  state.civicPoiCategories[category] = !!enabled;
  applyCivicPoiFilter(map);
  const legendEl = document.getElementById("legend-civic-pois");
  legendEl?.querySelectorAll("[data-civic-category]").forEach((btn) => {
    const cat = btn.getAttribute("data-civic-category");
    const on = !!state.civicPoiCategories[cat];
    btn.classList.toggle("is-off", !on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

async function fetchLiveCivicPois() {
  try {
    const response = await fetch(CIVIC_POI_LIVE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.features?.length) return null;
    return data;
  } catch {
    return null;
  }
}

async function loadCivicPoiGeoJson() {
  const live = await fetchLiveCivicPois();
  if (live) return { geojson: live, origin: "D1" };
  const sample = await fetchJson(CIVIC_POI_SAMPLE_URL);
  if (sample?.features?.length) return { geojson: sample, origin: "sample" };
  return null;
}

async function installCivicPois(map) {
  if (map.getLayer(CIVIC_POI_LAYER)) {
    setLayersVisible(map, [CIVIC_POI_HALO_LAYER, CIVIC_POI_LAYER], true);
    applyCivicPoiFilter(map);
    applyOverlayCompositing(map);
    return;
  }
  const loaded = await loadCivicPoiGeoJson();
  if (!loaded) {
    setLayerStatus("civic-pois", "unavailable · D1 fetch failed");
    return;
  }
  const { geojson, origin } = loaded;
  if (!map.getSource(CIVIC_POI_SOURCE)) {
    try {
      map.addSource(CIVIC_POI_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Civic POI source failed:", error);
      setLayerStatus("civic-pois", "unavailable · source failed");
      return;
    }
  }
  try {
    // minzoom 9 — city overview ("Bangkok from above" ≈ 10.6) must show
    // dots. Old minzoom 11 hid the entire layer at the default bookmark.
    const filter = civicPoiCategoryFilter();
    map.addLayer({
      id: CIVIC_POI_HALO_LAYER,
      type: "circle",
      source: CIVIC_POI_SOURCE,
      minzoom: 9,
      filter,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 11, 8, 14, 13, 17, 18],
        "circle-color": CIVIC_POI_CATEGORY_COLOR,
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.12, 12, 0.2, 16, 0.28],
        "circle-stroke-width": 0,
      },
    });
    map.addLayer({
      id: CIVIC_POI_LAYER,
      type: "circle",
      source: CIVIC_POI_SOURCE,
      minzoom: 9,
      filter,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 11, 4, 14, 5.5, 17, 7.5],
        "circle-color": CIVIC_POI_CATEGORY_COLOR,
        "circle-stroke-color": "#f1efe8",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 1.2],
        "circle-opacity": 0.95,
      },
    });
    wireCivicPoiInteractions(map);
    applyCivicPoiFilter(map);
    setLayerStatus(
      "civic-pois",
      `${geojson.count ?? geojson.features.length} POIs · ${origin}`,
    );
    // If we booted from the static snapshot, quietly upgrade to live D1.
    if (origin === "sample") {
      fetchLiveCivicPois().then((live) => {
        if (!live || !map.getSource(CIVIC_POI_SOURCE)) return;
        try {
          map.getSource(CIVIC_POI_SOURCE).setData(live);
          setLayerStatus("civic-pois", `${live.count ?? live.features.length} POIs · D1`);
          applyCivicPoiFilter(map);
        } catch {}
      });
    }
  } catch (error) {
    console.warn("Civic POI layer failed:", error);
    setLayerStatus("civic-pois", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Civic density choropleth — joins the live /api/civic-pois/analysis
// aggregate onto the same district polygons as the land-price layer,
// client-side. Not a static file: the join happens against whatever
// the D1 store currently holds, so it stays live as ingestion grows.
// ─────────────────────────────────────────────────────────────────

function closeCivicDensityPopup() {
  if (state.civicDensityPopup) {
    try { state.civicDensityPopup.remove(); } catch {}
    state.civicDensityPopup = null;
  }
}

function openCivicDensityPopup(map, feature, event) {
  const p = feature.properties || {};
  closeCivicDensityPopup();
  const counts = parseJsonProp(p.counts, {});
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `<p class="atlas-cctv-status">${escapeHtml(CIVIC_POI_CATEGORY_LABEL[cat] || cat)}: ${n}</p>`)
    .join("");
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">Civic density</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name_en)} (${escapeHtml(p.name_th)})</strong>
      <p class="atlas-cctv-status">${p.civicTotal} civic amenities on record</p>
      ${rows}
    </div>
  `;
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "280px",
    className: "atlas-cctv-popup",
  }).setHTML(html);
  state.civicDensityPopup = popup;
  popup.setLngLat(event.lngLat).addTo(map);
}

function wireCivicDensityInteractions(map) {
  if (map.__bkkxCivicDensityWired) return;
  map.__bkkxCivicDensityWired = true;
  map.on("click", CIVIC_DENSITY_FILL_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openCivicDensityPopup(map, feature, event);
  });
  map.on("mouseenter", CIVIC_DENSITY_FILL_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", CIVIC_DENSITY_FILL_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

// ─────────────────────────────────────────────────────────────────
// God Mode — live breaking incidents ("!" pins)
// ─────────────────────────────────────────────────────────────────

function closeCityEventPopup() {
  if (state.cityEventPopup) {
    try { state.cityEventPopup.remove(); } catch {}
    state.cityEventPopup = null;
  }
}

function formatEventAge(minutes) {
  if (minutes == null) return "just now";
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

function openCityEventPopup(map, feature) {
  const p = feature.properties || {};
  closeCityEventPopup();
  // Thai title is the source's primary field; English is often empty.
  const title = p.titleEn || p.titleTh || "Incident";
  const detail = p.descriptionEn || p.descriptionTh || "";
  const kind = CITY_EVENT_LABEL[p.icon] || p.icon || "Incident";
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-event-kicker">${escapeHtml(kind)} · ${escapeHtml(p.districtNameEn || "Bangkok")}</p>
      <strong class="atlas-cctv-title">${escapeHtml(title)}</strong>
      ${detail ? `<p class="atlas-cctv-status">${escapeHtml(detail)}</p>` : ""}
      <div class="atlas-cctv-actions">
        <span>Reported ${escapeHtml(formatEventAge(p.ageMinutes))}</span>
        <span>${escapeHtml(p.contributor || "iTIC")}</span>
      </div>
    </div>
  `;
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "atlas-cctv-popup",
    anchor: "bottom",
    offset: 16,
  })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(html)
    .addTo(map);
  state.cityEventPopup = popup;
}

function wireCityEventInteractions(map) {
  if (map.__bkkxCityEventWired) return;
  map.__bkkxCityEventWired = true;
  map.on("click", CITY_EVENT_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openCityEventPopup(map, feature);
  });
  map.on("mouseenter", CITY_EVENT_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", CITY_EVENT_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

function setCityEventStatus(geojson) {
  const n = geojson?.count ?? geojson?.features?.length ?? 0;
  setLayerStatus(
    "city-events",
    n === 0
      ? "clear · no live incidents right now"
      : `${n} live · iTIC · self-clears after ${geojson?.ttlMinutes ?? 60} min`,
  );
}

async function refreshCityEvents(map) {
  const geojson = await fetchJson(CITY_EVENT_DATA_URL);
  if (!geojson?.features) return null;
  const source = map.getSource(CITY_EVENT_SOURCE);
  if (source) source.setData(geojson);
  setCityEventStatus(geojson);
  return geojson;
}

function stopCityEventPolling() {
  if (state.cityEventTimer) {
    clearInterval(state.cityEventTimer);
    state.cityEventTimer = null;
  }
}

/** Poll while the layer is on. "Breaking" is only true if it keeps up —
 * a static snapshot from page load would quietly go stale. */
function startCityEventPolling(map) {
  if (state.cityEventTimer) return;
  state.cityEventTimer = setInterval(() => {
    if (!state.layerOn["city-events"] || document.hidden) return;
    refreshCityEvents(map).catch(() => {});
  }, CITY_EVENT_REFRESH_MS);
}

async function installCityEvents(map) {
  if (map.getLayer(CITY_EVENT_LAYER)) {
    setLayersVisible(map, [CITY_EVENT_PULSE_LAYER, CITY_EVENT_LAYER], true);
    await refreshCityEvents(map);
    startCityEventPolling(map);
    return;
  }
  const geojson = await fetchJson(CITY_EVENT_DATA_URL);
  if (!geojson?.features) {
    setLayerStatus("city-events", "unavailable · feed failed");
    return;
  }
  if (!map.getSource(CITY_EVENT_SOURCE)) {
    try {
      map.addSource(CITY_EVENT_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("City event source failed:", error);
      setLayerStatus("city-events", "unavailable · source failed");
      return;
    }
  }
  try {
    // Soft alarm halo underneath, so a pin reads as urgent at city zoom
    // without the glyph itself having to get big enough to cover blocks.
    map.addLayer({
      id: CITY_EVENT_PULSE_LAYER,
      type: "circle",
      source: CITY_EVENT_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 13, 14, 22, 17, 30],
        "circle-color": "#ff2d2d",
        "circle-opacity": 0.16,
        "circle-stroke-color": "#ff2d2d",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.45,
      },
    });
    // The "!" itself. text-field with a literal glyph keeps it sharp at
    // every zoom and needs no sprite image.
    map.addLayer({
      id: CITY_EVENT_LAYER,
      type: "symbol",
      source: CITY_EVENT_SOURCE,
      layout: {
        "text-field": "!",
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 18, 14, 26, 17, 32],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#ff2d2d",
        "text-halo-color": "#11120f",
        "text-halo-width": 2,
      },
    });
    wireCityEventInteractions(map);
    setCityEventStatus(geojson);
    startCityEventPolling(map);
  } catch (error) {
    console.warn("City event layer failed:", error);
    setLayerStatus("city-events", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Buzz — geolocated news (/api/news-events)
// ─────────────────────────────────────────────────────────────────

function closeNewsEventPopup() {
  if (state.newsEventPopup) {
    try { state.newsEventPopup.remove(); } catch {}
    state.newsEventPopup = null;
  }
}

function openNewsEventPopup(map, feature) {
  const p = feature.properties || {};
  closeNewsEventPopup();
  const articles = parseJsonProp(p.articles, []);
  const items = articles.map((a) => `
    <li>
      <a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.title)}</a>
      <span class="atlas-news-src">${escapeHtml(a.source || "")} · matched “${escapeHtml(a.matchPhrase || "")}”</span>
    </li>
  `).join("");
  // Say plainly when a pin is a neighbourhood anchor rather than an
  // address — the same rule the land-price layer learned the hard way.
  const precisionNote = p.precision === "area"
    ? "Area anchor — the story names this neighbourhood, not a specific address."
    : "Venue named directly in the coverage.";
  const html = `
    <div class="atlas-news-card">
      <p class="atlas-news-kicker">Buzz · ${escapeHtml(p.districtNameEn || "Bangkok")}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.venueName)}</strong>
      <p class="atlas-cctv-status">${p.mentions} ${p.mentions === 1 ? "story" : "stories"} · ${escapeHtml(precisionNote)}</p>
      <ul class="atlas-news-list">${items}</ul>
    </div>
  `;
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "340px",
    className: "atlas-cctv-popup",
    anchor: "bottom",
    offset: 14,
  })
    .setLngLat(feature.geometry.coordinates)
    .setHTML(html)
    .addTo(map);
  state.newsEventPopup = popup;
}

function wireNewsEventInteractions(map) {
  if (map.__bkkxNewsEventWired) return;
  map.__bkkxNewsEventWired = true;
  map.on("click", NEWS_EVENT_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openNewsEventPopup(map, feature);
  });
  map.on("mouseenter", NEWS_EVENT_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", NEWS_EVENT_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

function setNewsEventStatus(geojson) {
  const venues = geojson?.count ?? 0;
  const arts = geojson?.articleCount ?? 0;
  setLayerStatus(
    "news-events",
    venues === 0
      // Honest empty state: nothing matched is a real answer, not an error.
      ? "no located stories in the last 14 days"
      : `${venues} ${venues === 1 ? "place" : "places"} · ${arts} ${arts === 1 ? "story" : "stories"} · 14d`,
  );
}

async function refreshNewsEvents(map) {
  const geojson = await fetchJson(NEWS_EVENT_DATA_URL);
  if (!geojson?.features) return null;
  const src = map.getSource(NEWS_EVENT_SOURCE);
  if (src) src.setData(geojson);
  setNewsEventStatus(geojson);
  return geojson;
}

function stopNewsEventPolling() {
  if (state.newsEventTimer) {
    clearInterval(state.newsEventTimer);
    state.newsEventTimer = null;
  }
}

function startNewsEventPolling(map) {
  if (state.newsEventTimer) return;
  state.newsEventTimer = setInterval(() => {
    if (!state.layerOn["news-events"] || document.hidden) return;
    refreshNewsEvents(map).catch(() => {});
  }, NEWS_EVENT_REFRESH_MS);
}

// Radius scales with mention count — the trending signal IS the size,
// rather than a separate chart the operator has to go find.
const NEWS_SIZE_BY_MENTIONS = [
  "interpolate", ["linear"], ["get", "mentions"],
  1, 7,
  3, 12,
  6, 18,
  12, 26,
];

async function installNewsEvents(map) {
  if (map.getLayer(NEWS_EVENT_LAYER)) {
    setLayersVisible(map, [NEWS_EVENT_GLOW_LAYER, NEWS_EVENT_LAYER, NEWS_EVENT_COUNT_LAYER], true);
    await refreshNewsEvents(map);
    startNewsEventPolling(map);
    return;
  }
  const geojson = await fetchJson(NEWS_EVENT_DATA_URL);
  if (!geojson?.features) {
    setLayerStatus("news-events", "unavailable · feed failed");
    return;
  }
  if (!map.getSource(NEWS_EVENT_SOURCE)) {
    try {
      map.addSource(NEWS_EVENT_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("News event source failed:", error);
      setLayerStatus("news-events", "unavailable · source failed");
      return;
    }
  }
  try {
    map.addLayer({
      id: NEWS_EVENT_GLOW_LAYER,
      type: "circle",
      source: NEWS_EVENT_SOURCE,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["get", "mentions"],
          1, 14, 3, 23, 6, 34, 12, 48,
        ],
        "circle-color": "#f5a524",
        "circle-opacity": 0.14,
        "circle-stroke-width": 0,
      },
    });
    map.addLayer({
      id: NEWS_EVENT_LAYER,
      type: "circle",
      source: NEWS_EVENT_SOURCE,
      paint: {
        "circle-radius": NEWS_SIZE_BY_MENTIONS,
        "circle-color": "#f5a524",
        "circle-opacity": 0.82,
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.2,
      },
    });
    map.addLayer({
      id: NEWS_EVENT_COUNT_LAYER,
      type: "symbol",
      source: NEWS_EVENT_SOURCE,
      // Only print the number once a place is actually trending.
      filter: [">=", ["get", "mentions"], 2],
      layout: {
        "text-field": ["to-string", ["get", "mentions"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#11120f",
        "text-halo-color": "#f5a524",
        "text-halo-width": 1,
      },
    });
    wireNewsEventInteractions(map);
    setNewsEventStatus(geojson);
    startNewsEventPolling(map);
  } catch (error) {
    console.warn("News event layer failed:", error);
    setLayerStatus("news-events", "unavailable · layer failed");
  }
}

async function installCivicDensity(map) {
  if (map.getLayer(CIVIC_DENSITY_FILL_LAYER)) {
    setLayersVisible(map, [CIVIC_DENSITY_FILL_LAYER, CIVIC_DENSITY_LINE_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const [districts, analysis] = await Promise.all([
    fetchJson(DISTRICT_DATA_URL),
    fetchJson(CIVIC_DENSITY_ANALYSIS_URL),
  ]);
  if (!districts?.features?.length || !analysis?.districts?.length) {
    setLayerStatus("civic-density", "unavailable · fetch failed");
    return;
  }
  const byId = new Map(analysis.districts.map((d) => [d.districtId, d]));
  const features = districts.features.map((feat) => {
    const stats = byId.get(feat.properties.id);
    return {
      type: "Feature",
      geometry: feat.geometry,
      properties: {
        name_en: feat.properties.name_en.replace(" District", ""),
        name_th: feat.properties.name_th,
        civicTotal: stats?.total ?? 0,
        counts: JSON.stringify(stats?.counts ?? {}),
      },
    };
  });
  const geojson = { type: "FeatureCollection", features };
  if (!map.getSource(CIVIC_DENSITY_SOURCE)) {
    try {
      map.addSource(CIVIC_DENSITY_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Civic density source failed:", error);
      setLayerStatus("civic-density", "unavailable · source failed");
      return;
    }
  }
  try {
    map.addLayer({
      id: CIVIC_DENSITY_FILL_LAYER,
      type: "fill",
      source: CIVIC_DENSITY_SOURCE,
      paint: { "fill-color": CIVIC_DENSITY_FILL_COLOR, "fill-opacity": 0.55 },
    });
    map.addLayer({
      id: CIVIC_DENSITY_LINE_LAYER,
      type: "line",
      source: CIVIC_DENSITY_SOURCE,
      paint: { "line-color": "#11120f", "line-width": 0.6, "line-opacity": 0.5 },
    });
    wireCivicDensityInteractions(map);
    setLayerStatus("civic-density", `${analysis.districts.length} districts · live from D1`);
  } catch (error) {
    console.warn("Civic density layer failed:", error);
    setLayerStatus("civic-density", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Flood envelope (schematic Labs sandbox)
// ─────────────────────────────────────────────────────────────────

async function installFlood(map) {
  if (map.getLayer(FLOOD_FILL)) {
    setLayersVisible(map, [FLOOD_FILL, FLOOD_LINE], true);
    applyOverlayCompositing(map);
    return;
  }
  let geojson;
  try {
    const res = await fetch(FLOOD_DATA_URL, { cache: "force-cache" });
    if (!res.ok) {
      setLayerStatus("flood", "unavailable · geojson failed");
      return;
    }
    geojson = await res.json();
    if (geojson?.features) state.floodFeatures = geojson.features;
  } catch (error) {
    console.warn("Flood envelope fetch failed:", error);
    setLayerStatus("flood", "unavailable · fetch failed");
    return;
  }
  if (!map.getSource(FLOOD_SOURCE)) {
    try {
      map.addSource(FLOOD_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Flood source failed:", error);
      return;
    }
  }
  try {
    map.addLayer({
      id: FLOOD_FILL,
      type: "fill",
      source: FLOOD_SOURCE,
      paint: {
        "fill-color": FLOOD_FILL_COLOR,
        "fill-opacity": state.floodOpacity,
      },
    });
    map.addLayer({
      id: FLOOD_LINE,
      type: "line",
      source: FLOOD_SOURCE,
      paint: {
        "line-color": "#93c5fd",
        "line-width": 1.2,
        "line-opacity": 0.85,
      },
    });
    setLayerStatus("flood", "schematic · not an official flood map");
  } catch (error) {
    console.warn("Flood layer failed:", error);
  }
}

async function ensureFloodFeatures() {
  if (state.floodFeatures?.length) return state.floodFeatures;
  try {
    const res = await fetch(FLOOD_DATA_URL, { cache: "force-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    state.floodFeatures = data.features ?? [];
    return state.floodFeatures;
  } catch {
    return null;
  }
}

/** Ray-cast point-in-polygon for GeoJSON Polygon / MultiPolygon. */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFloodFeature(lng, lat, feature) {
  const g = feature.geometry;
  if (!g) return false;
  if (g.type === "Polygon") {
    if (!pointInRing(lng, lat, g.coordinates[0])) return false;
    for (let h = 1; h < g.coordinates.length; h++) {
      if (pointInRing(lng, lat, g.coordinates[h])) return false;
    }
    return true;
  }
  if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      if (!pointInRing(lng, lat, poly[0])) continue;
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lng, lat, poly[h])) { inHole = true; break; }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

async function floodHitAt(lng, lat) {
  const features = await ensureFloodFeatures();
  if (!features?.length) return null;
  const hits = [];
  for (const feature of features) {
    if (pointInFloodFeature(lng, lat, feature)) hits.push(feature.properties ?? {});
  }
  if (hits.length === 0) return { inside: false, envelopes: [] };
  const rank = { high: 3, medium: 2, low: 1 };
  hits.sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0));
  return { inside: true, envelopes: hits, top: hits[0] };
}

// ─────────────────────────────────────────────────────────────────
// Flood sensors — real-time HII/ThaiWater water-level gauges
// (public/api/flood-sensors, see src/index.ts). Distinct from the
// schematic "Flood envelope" polygons above: this is live telemetry,
// not a modeled extent.
// ─────────────────────────────────────────────────────────────────

function closeFloodSensorPopup() {
  if (state.floodSensorPopup) {
    try { state.floodSensorPopup.remove(); } catch {}
    state.floodSensorPopup = null;
  }
}

function openFloodSensorPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeFloodSensorPopup();
  const wl = p.waterlevelMsl != null ? `${Number(p.waterlevelMsl).toFixed(2)} m MSL` : "—";
  const bank = p.minBank != null ? `${Number(p.minBank).toFixed(2)} m bank level` : null;
  const storage = p.storagePercent != null ? `${Number(p.storagePercent).toFixed(0)}% of bank capacity` : null;
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">Flood sensor · ${escapeHtml(p.levelLabel || "unknown")}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name || "Water level station")}</strong>
      <p class="atlas-cctv-status">${escapeHtml(wl)}${bank ? " · " + escapeHtml(bank) : ""}</p>
      ${storage ? `<p class="atlas-cctv-status">${escapeHtml(storage)}</p>` : ""}
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.basin || p.district || "")}</span>
        <span>${escapeHtml(p.observedAt || "")}</span>
      </div>
    </div>
  `;
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "300px",
    className: "atlas-cctv-popup",
    anchor: "bottom",
    offset: 14,
  })
    .setLngLat([lng, lat])
    .setHTML(html)
    .addTo(map);
  state.floodSensorPopup = popup;
}

function wireFloodSensorInteractions(map) {
  if (map.__bkkxFloodSensorWired) return;
  map.__bkkxFloodSensorWired = true;
  map.on("click", FLOOD_SENSOR_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openFloodSensorPopup(map, feature);
  });
  map.on("mouseenter", FLOOD_SENSOR_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", FLOOD_SENSOR_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installFloodSensors(map) {
  if (map.getLayer(FLOOD_SENSOR_LAYER)) {
    setLayersVisible(map, [FLOOD_SENSOR_HALO_LAYER, FLOOD_SENSOR_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(FLOOD_SENSOR_LIVE_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("flood-sensors", "unavailable · ThaiWater feed failed");
    return;
  }
  if (!map.getSource(FLOOD_SENSOR_SOURCE)) {
    try {
      map.addSource(FLOOD_SENSOR_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Flood sensor source failed:", error);
      setLayerStatus("flood-sensors", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(FLOOD_SENSOR_SOURCE).setData(geojson); } catch {}
  }
  try {
    map.addLayer({
      id: FLOOD_SENSOR_HALO_LAYER,
      type: "circle",
      source: FLOOD_SENSOR_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 9, 13, 15, 16, 20],
        "circle-color": ["get", "levelColor"],
        "circle-opacity": 0.2,
        "circle-stroke-width": 0,
      },
    });
    map.addLayer({
      id: FLOOD_SENSOR_LAYER,
      type: "circle",
      source: FLOOD_SENSOR_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6, 16, 8],
        "circle-color": ["get", "levelColor"],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.2,
        "circle-opacity": 0.95,
      },
    });
    wireFloodSensorInteractions(map);
    setLayerStatus("flood-sensors", `HII/ThaiWater · ${geojson.count ?? geojson.features.length} live gauges`);
  } catch (error) {
    console.warn("Flood sensor layer failed:", error);
    setLayerStatus("flood-sensors", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Traffic / rail / khlongs (unchanged from before)
// ─────────────────────────────────────────────────────────────────

async function fetchLiveTraffic() {
  try {
    const response = await fetch(TRAFFIC_LIVE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body || !body.features || body.features.length === 0) return null;
    return body;
  } catch { return null; }
}

async function fetchSampleTraffic() {
  try {
    const response = await fetch(TRAFFIC_SAMPLE_URL, { cache: "force-cache" });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

function addTrafficLayer(map, geojson) {
  if (map.getSource(TRAFFIC_SOURCE)) {
    const src = map.getSource(TRAFFIC_SOURCE);
    if (src && "setData" in src) src.setData(geojson);
    if (map.getLayer(TRAFFIC_LAYER)) {
      setLayersVisible(map, [TRAFFIC_LAYER], true);
      return;
    }
  } else {
    try {
      map.addSource(TRAFFIC_SOURCE, { type: "geojson", data: geojson });
    } catch {
      return;
    }
  }
  if (map.getLayer(TRAFFIC_LAYER)) {
    setLayersVisible(map, [TRAFFIC_LAYER], true);
    return;
  }
  try {
    map.addLayer({
      id: TRAFFIC_LAYER,
      type: "line",
      source: TRAFFIC_SOURCE,
      minzoom: 10,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": TRAFFIC_COLOR_EXPRESSION,
        "line-width": TRAFFIC_WIDTH_EXPRESSION,
        "line-opacity": 0.9,
      },
    });
  } catch (error) {
    console.warn("Traffic layer failed:", error);
  }
}

async function loadTrafficData(map, { preferLive = false } = {}) {
  let geojson = null;
  let source = "sample";
  if (preferLive) {
    geojson = await fetchLiveTraffic();
    if (geojson) source = "live";
  }
  if (!geojson) {
    geojson = await fetchSampleTraffic();
    source = "sample";
  }
  if (!geojson) return;
  addTrafficLayer(map, geojson);
  setTrafficSourceBadge(source);
  if (preferLive && source === "sample") {
    fetchLiveTraffic().then((live) => {
      if (live && map.getSource(TRAFFIC_SOURCE)) {
        addTrafficLayer(map, live);
        setTrafficSourceBadge("live");
      }
    });
  }
}

function setTrafficSourceBadge(source) {
  state.trafficSource = source;
  const detail = document.getElementById("toggle-traffic-detail");
  if (!detail) return;
  if (source === "live") {
    detail.textContent = "live · iTIC / Longdo";
  } else if (source === "sample") {
    detail.textContent = "sample · mock levels (not live)";
  } else {
    detail.textContent = "iTIC / Longdo · expressways";
  }
}

function destroyCctvHls() {
  if (state.cctvHls) {
    try { state.cctvHls.destroy(); } catch {}
    state.cctvHls = null;
  }
}

function closeCctvPopup() {
  destroyCctvHls();
  if (state.cctvPopup) {
    try { state.cctvPopup.remove(); } catch {}
    state.cctvPopup = null;
  }
}

function setCctvSourceBadge(source, count) {
  state.cctvSource = source;
  const detail = document.getElementById("toggle-cctv-detail");
  if (!detail) return;
  const n = Number.isFinite(count) ? ` · ${count} cams` : "";
  if (source === "live") detail.textContent = `live · iTIC / Longdo${n}`;
  else if (source === "sample") detail.textContent = `cached catalog${n}`;
  else detail.textContent = "iTIC / Longdo · public road cameras";
}

function addCctvLayer(map, geojson) {
  if (map.getSource(CCTV_SOURCE)) {
    map.getSource(CCTV_SOURCE).setData(geojson);
    setLayersVisible(map, [CCTV_HALO_LAYER, CCTV_LAYER], true);
    return;
  }
  map.addSource(CCTV_SOURCE, { type: "geojson", data: geojson });
  map.addLayer({
    id: CCTV_HALO_LAYER,
    type: "circle",
    source: CCTV_SOURCE,
    minzoom: 10,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 14, 14, 16, 18],
      "circle-color": "#c9ff38",
      "circle-opacity": 0.18,
      "circle-stroke-width": 0,
    },
  });
  map.addLayer({
    id: CCTV_LAYER,
    type: "circle",
    source: CCTV_SOURCE,
    minzoom: 10,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 5.5, 16, 7],
      "circle-color": "#11120f",
      "circle-stroke-color": "#c9ff38",
      "circle-stroke-width": 1.6,
      "circle-opacity": 0.95,
    },
  });
}

async function fetchLiveCctv() {
  try {
    const response = await fetch(CCTV_LIVE_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.features?.length) return null;
    return data;
  } catch {
    return null;
  }
}

async function loadCctvData(map, { preferLive = false } = {}) {
  let geojson = null;
  let source = "sample";
  if (preferLive) {
    geojson = await fetchLiveCctv();
    if (geojson) source = "live";
  }
  if (!geojson) {
    geojson = await fetchJson(CCTV_SAMPLE_URL);
    source = "sample";
  }
  if (!geojson) return;
  addCctvLayer(map, geojson);
  setCctvSourceBadge(source, geojson.features?.length ?? geojson.count);
  wireCctvInteractions(map);
  if (preferLive && source === "sample") {
    fetchLiveCctv().then((live) => {
      if (live && map.getSource(CCTV_SOURCE)) {
        addCctvLayer(map, live);
        setCctvSourceBadge("live", live.features?.length ?? live.count);
      }
    });
  }
}

function playCctvStream(video, hlsUrl) {
  destroyCctvHls();
  if (!video || !hlsUrl) return;
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = hlsUrl;
    video.play().catch(() => {});
    return;
  }
  const Hls = window.Hls;
  if (Hls && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 12,
    });
    state.cctvHls = hls;
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data?.fatal) {
        const status = video.parentElement?.querySelector(".atlas-cctv-status");
        if (status) status.textContent = "Stream dropped — try another camera or open on iTIC.";
      }
    });
    return;
  }
  const status = video.parentElement?.querySelector(".atlas-cctv-status");
  if (status) status.textContent = "This browser cannot play HLS. Open the camera on iTIC.";
}

function openCctvPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const props = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  const title = props.title || "Traffic camera";
  const org = props.org || "iTIC";
  const hls = props.hls || "";
  const iticUrl = `https://live.iticfoundation.org/?lat=${lat}&lon=${lng}&zoom=16`;

  closeCctvPopup();

  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">Traffic CCTV · ${escapeHtml(org)}</p>
      <strong class="atlas-cctv-title">${escapeHtml(title)}</strong>
      <video class="atlas-cctv-video" playsinline muted autoplay controls></video>
      <p class="atlas-cctv-status">Connecting live stream…</p>
      <div class="atlas-cctv-actions">
        <a href="${escapeHtml(iticUrl)}" target="_blank" rel="noreferrer">Open on iTIC ↗</a>
        <span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
      </div>
    </div>
  `;

  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "atlas-cctv-popup",
    anchor: "bottom",
    offset: 14,
  })
    .setLngLat([lng, lat])
    .setHTML(html)
    .addTo(map);

  state.cctvPopup = popup;
  popup.on("close", () => {
    destroyCctvHls();
    if (state.cctvPopup === popup) state.cctvPopup = null;
  });

  const video = popup.getElement()?.querySelector(".atlas-cctv-video");
  const status = popup.getElement()?.querySelector(".atlas-cctv-status");
  if (!hls) {
    if (status) status.textContent = "No HLS URL for this camera.";
    return;
  }
  if (status) status.textContent = "Live · iTIC / Longdo";
  playCctvStream(video, hls);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function wireCctvInteractions(map) {
  if (map.__bkkxCctvWired) return;
  map.__bkkxCctvWired = true;

  map.on("click", CCTV_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openCctvPopup(map, feature);
  });

  map.on("mouseenter", CCTV_LAYER, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", CCTV_LAYER, () => {
    map.getCanvas().style.cursor = "";
  });
}

// ─────────────────────────────────────────────────────────────────
// Live cams — third-party public YouTube livestreams (hand-curated,
// bkk-live-cams.geojson). Embedded via YouTube's own <iframe> player,
// the only ToS-compliant way to show someone else's livestream — no
// stream URLs are scraped or hotlinked.
// ─────────────────────────────────────────────────────────────────

function closeLiveCamPopup() {
  if (state.liveCamPopup) {
    try { state.liveCamPopup.remove(); } catch {}
    state.liveCamPopup = null;
  }
}

function openLiveCamPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeLiveCamPopup();

  let html;
  if (p.kind === "link") {
    // Bookmark to a login-gated system (e.g. BMA's own traffic CCTV
    // dashboard). No stream to embed — this just opens the operator's
    // own site in a new tab. Visitors without an account there will
    // hit BMA's login wall; that's expected, not a bug.
    html = `
      <div class="atlas-cctv-card">
        <p class="atlas-cctv-kicker">Bookmark · ${escapeHtml(p.precision || "")}</p>
        <strong class="atlas-cctv-title">${escapeHtml(p.title || "External camera")}</strong>
        <p class="atlas-cctv-status">${escapeHtml(p.note || "")}</p>
        <div class="atlas-cctv-actions">
          <a href="${escapeHtml(p.url || "")}" target="_blank" rel="noreferrer">Open ↗ (login required)</a>
          <span>${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
        </div>
      </div>
    `;
  } else {
    const embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(p.youtubeId)}?autoplay=1&mute=1&playsinline=1`;
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(p.youtubeId)}`;
    html = `
      <div class="atlas-cctv-card">
        <p class="atlas-cctv-kicker">Live cam · ${escapeHtml(p.precision || "")}</p>
        <strong class="atlas-cctv-title">${escapeHtml(p.title || "Bangkok live cam")}</strong>
        <iframe class="atlas-live-cam-frame" src="${escapeHtml(embedUrl)}"
          title="${escapeHtml(p.title || "Bangkok live cam")}" frameborder="0"
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>
        <p class="atlas-cctv-status">${escapeHtml(p.note || "")}</p>
        <div class="atlas-cctv-actions">
          <a href="${escapeHtml(watchUrl)}" target="_blank" rel="noreferrer">Open on YouTube ↗</a>
          <span>${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
        </div>
      </div>
    `;
  }
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "320px",
    className: "atlas-cctv-popup",
    anchor: "bottom",
    offset: 14,
  })
    .setLngLat([lng, lat])
    .setHTML(html)
    .addTo(map);
  state.liveCamPopup = popup;
}

function wireLiveCamInteractions(map) {
  if (map.__bkkxLiveCamWired) return;
  map.__bkkxLiveCamWired = true;
  map.on("click", LIVE_CAM_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openLiveCamPopup(map, feature);
  });
  map.on("mouseenter", LIVE_CAM_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", LIVE_CAM_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installLiveCams(map) {
  if (map.getLayer(LIVE_CAM_LAYER)) {
    setLayersVisible(map, [LIVE_CAM_HALO_LAYER, LIVE_CAM_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(LIVE_CAM_DATA_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("live-cams", "unavailable · geojson failed");
    return;
  }
  if (!map.getSource(LIVE_CAM_SOURCE)) {
    try {
      map.addSource(LIVE_CAM_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Live cam source failed:", error);
      setLayerStatus("live-cams", "unavailable · source failed");
      return;
    }
  }
  try {
    map.addLayer({
      id: LIVE_CAM_HALO_LAYER,
      type: "circle",
      source: LIVE_CAM_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 9, 13, 15, 16, 20],
        "circle-color": "#c9ff38",
        "circle-opacity": 0.18,
        "circle-stroke-width": 0,
      },
    });
    map.addLayer({
      id: LIVE_CAM_LAYER,
      type: "circle",
      source: LIVE_CAM_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6, 16, 8],
        "circle-color": "#11120f",
        "circle-stroke-color": "#c9ff38",
        "circle-stroke-width": 1.6,
        "circle-opacity": 0.95,
      },
    });
    wireLiveCamInteractions(map);
    setLayerStatus("live-cams", `${geojson.features.length} curated views (streams + bookmarks)`);
  } catch (error) {
    console.warn("Live cam layer failed:", error);
    setLayerStatus("live-cams", "unavailable · layer failed");
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

async function loadRailData(map) {
  if (map.getLayer(RAIL_LAYER)) {
    setLayersVisible(map, [RAIL_LAYER], true);
    return;
  }
  const geojson = await fetchJson(RAIL_DATA_URL);
  if (!geojson) return;
  try {
    if (!map.getSource(RAIL_SOURCE)) {
      map.addSource(RAIL_SOURCE, { type: "geojson", data: geojson });
    }
    map.addLayer({
      id: RAIL_LAYER,
      type: "line",
      source: RAIL_SOURCE,
      minzoom: 9,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": RAIL_COLOR_EXPRESSION,
        "line-width": RAIL_WIDTH_EXPRESSION,
        "line-opacity": 0.95,
      },
    });
  } catch (error) {
    console.warn("Rail layer failed:", error);
  }
}

async function loadKhlongData(map) {
  if (map.getLayer(KHLONG_RIVER_LAYER) || map.getLayer(KHLONG_CANAL_LAYER)) {
    setLayersVisible(map, [KHLONG_RIVER_LAYER, KHLONG_CANAL_LAYER], true);
    return;
  }
  const geojson = await fetchJson(KHLONG_DATA_URL);
  if (!geojson) return;
  try {
    if (!map.getSource(KHLONG_SOURCE)) {
      map.addSource(KHLONG_SOURCE, { type: "geojson", data: geojson });
    }
    if (!map.getLayer(KHLONG_RIVER_LAYER)) {
      map.addLayer({
        id: KHLONG_RIVER_LAYER,
        type: "line",
        source: KHLONG_SOURCE,
        minzoom: 9,
        filter: ["==", ["get", "waterway"], "river"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#3FA7E0", "line-width": KHLONG_RIVER_WIDTH, "line-opacity": 0.85 },
      });
    }
    if (!map.getLayer(KHLONG_CANAL_LAYER)) {
      map.addLayer({
        id: KHLONG_CANAL_LAYER,
        type: "line",
        source: KHLONG_SOURCE,
        minzoom: 11,
        filter: ["==", ["get", "waterway"], "canal"],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#2C7FB8", "line-width": KHLONG_CANAL_WIDTH, "line-opacity": 0.7 },
      });
    }
  } catch (error) {
    console.warn("Khlong layer failed:", error);
  }
}

// ─────────────────────────────────────────────────────────────────
// Inspect — click building + flood/risk at that point
// ─────────────────────────────────────────────────────────────────

const INSPECT_BUILDING_LAYERS = [
  LANDMARKS_LAYER,
  RATTANAKOSIN_BUILDINGS_LAYER,
  BKKX_BUILDINGS_LAYER,
  BKKX_BUILDINGS_HI_LAYER,
];

function fillInspectDl(el, rows) {
  if (!el) return;
  el.innerHTML = "";
  for (const [dt, dd] of rows) {
    const term = document.createElement("dt");
    term.textContent = dt;
    const def = document.createElement("dd");
    def.textContent = dd;
    el.append(term, def);
  }
}

function pickBuildingFeature(map, point) {
  const layerIds = INSPECT_BUILDING_LAYERS.filter((id) => map.getLayer(id));
  if (layerIds.length === 0) return null;
  const hits = map.queryRenderedFeatures(point, { layers: layerIds });
  return hits[0] ?? null;
}

function buildingRowsFromFeature(feature) {
  if (!feature) {
    return [
      ["Type", "No building under click"],
      ["Height", "—"],
      ["Base", "—"],
    ];
  }
  const p = feature.properties ?? {};
  const type = p.kind ?? p.building ?? p.building_type ?? p.class ?? "yes";
  const height = p.render_height ?? p.height ?? null;
  const minH = p.render_min_height ?? p.min_height ?? p.base_height ?? null;
  const name = p.name_en || p.name || p["name:en"] || null;
  const osmId = p.osm_id ?? p.id ?? p["@id"] ?? null;
  const rows = [];
  if (name) rows.push(["Name", String(name)]);
  rows.push(
    ["Type", String(type)],
    ["Height", height != null ? `${height} m` : "—"],
    ["Base", minH != null && Number(minH) > 0 ? `${minH} m` : "0 m"],
  );
  if (osmId != null) rows.push(["OSM id", String(osmId)]);
  return rows;
}

function setInspectMarker(map, lngLat) {
  if (state.inspectMarker) {
    state.inspectMarker.setLngLat(lngLat);
    return;
  }
  const el = document.createElement("div");
  el.className = "atlas-inspect-pin";
  el.setAttribute("aria-hidden", "true");
  state.inspectMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat(lngLat)
    .addTo(map);
}

function clearInspect(map) {
  const card = document.getElementById("atlas-inspect-card");
  const hint = document.getElementById("atlas-inspect-hint");
  if (card) card.hidden = true;
  if (hint) hint.hidden = false;
  if (state.inspectMarker) {
    state.inspectMarker.remove();
    state.inspectMarker = null;
  }
  if (map.getCanvas()) map.getCanvas().style.cursor = "";
}

async function runInspect(map, event) {
  const { lng, lat } = event.lngLat;
  const feature = pickBuildingFeature(map, event.point);
  setInspectMarker(map, [lng, lat]);

  const card = document.getElementById("atlas-inspect-card");
  const hint = document.getElementById("atlas-inspect-hint");
  const coordsEl = document.getElementById("atlas-inspect-coords");
  const buildingEl = document.getElementById("atlas-inspect-building");
  const floodEl = document.getElementById("atlas-inspect-flood");
  const noteEl = document.getElementById("atlas-inspect-note");
  const apiLink = document.getElementById("atlas-inspect-api");

  if (hint) hint.hidden = true;
  if (card) card.hidden = false;
  if (coordsEl) {
    coordsEl.textContent = `${lng.toFixed(5)}° E, ${lat.toFixed(5)}° N`;
  }
  fillInspectDl(buildingEl, buildingRowsFromFeature(feature));
  fillInspectDl(floodEl, [["Envelope", "Loading…"], ["Risk", "…"]]);
  if (noteEl) noteEl.textContent = "";
  if (apiLink) {
    apiLink.href = `/api/risk?lng=${lng.toFixed(5)}&lat=${lat.toFixed(5)}`;
  }

  const [flood, risk] = await Promise.all([
    floodHitAt(lng, lat),
    fetchRisk(lng.toFixed(5), lat.toFixed(5)),
  ]);
  fillInspectDl(floodEl, floodRiskRows(flood, risk, feature));
  if (noteEl) {
    noteEl.textContent = "Flood envelopes are schematic civic demos — not official DDPM/BMA maps.";
  }

  const section = document.getElementById("atlas-inspect");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function fetchRisk(lng, lat) {
  try {
    const res = await fetch(`/api/risk?lng=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`, {
      cache: "no-store",
    });
    if (res.ok) return await res.json();
  } catch { /* client compose below */ }
  return composeRiskClient(Number(lng), Number(lat));
}

async function composeRiskClient(lng, lat) {
  const [flood, pm25] = await Promise.all([
    floodHitAt(lng, lat),
    fetchPointPm25Client(lat, lng),
  ]);
  return buildRiskPayload(lng, lat, flood, pm25);
}

async function fetchPointPm25Client(lat, lng) {
  try {
    const url =
      `${AQI_API}?latitude=${lat}&longitude=${lng}&hourly=pm2_5&forecast_days=1&domains=cams_global`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const values = data?.hourly?.pm2_5;
    if (!values?.length) return null;
    let idx = values.length - 1;
    while (idx > 0 && (values[idx] == null || Number.isNaN(values[idx]))) idx--;
    return values[idx] ?? null;
  } catch {
    return null;
  }
}

function buildRiskPayload(lng, lat, flood, pm25 = null) {
  const severity = flood?.inside ? (flood.top?.severity ?? "medium") : "none";
  const severityWeight = { none: 0, low: 0.35, medium: 0.65, high: 1 }[severity] ?? 0;
  const aqiFactor =
    pm25 == null || Number.isNaN(Number(pm25))
      ? 0
      : Math.min(1, Math.max(0, (Number(pm25) - 12) / 138));
  const score = Math.round(100 * (0.6 * severityWeight + 0.4 * aqiFactor));
  return {
    tool: "risk",
    version: 3,
    query: { lng, lat },
    score,
    band: score >= 70 ? "high" : score >= 40 ? "elevated" : "moderate",
    factors: {
      floodInside: !!flood?.inside,
      floodSeverity: severity,
      floodEnvelope: flood?.top?.name ?? null,
      pm25: pm25 ?? null,
      aqiFactor: Math.round(aqiFactor * 100) / 100,
    },
    disclaimer: "Schematic civic score (flood × PM2.5) — not for insurance underwriting.",
  };
}

function floodRiskRows(flood, risk, buildingFeature) {
  const height = buildingFeature?.properties?.render_height
    ?? buildingFeature?.properties?.height
    ?? null;
  const rows = [
    ["Inside envelope", flood?.inside ? "Yes" : "No"],
  ];
  if (flood?.inside && flood.top) {
    rows.push(["Corridor", String(flood.top.name ?? flood.top.id ?? "—")]);
    rows.push(["Severity", String(flood.top.severity ?? "—")]);
    if (flood.top.depthHintM != null) rows.push(["Depth hint", `${flood.top.depthHintM} m`]);
  }
  if (risk?.score != null) {
    rows.push(["Risk score", `${risk.score} · ${risk.band ?? "—"}`]);
  }
  if (risk?.factors?.pm25 != null) {
    rows.push(["PM2.5", `${risk.factors.pm25} µg/m³`]);
  }
  if (height != null) rows.push(["Building height", `${height} m`]);
  return rows;
}

function pointLayersOwningClick(map, point) {
  const owners = [
    CCTV_LAYER,
    LIVE_CAM_LAYER,
    CIVIC_POI_LAYER,
    FLOOD_SENSOR_LAYER,
  ].filter((id) => map.getLayer(id));
  if (owners.length === 0) return [];
  return map.queryRenderedFeatures(point, { layers: owners });
}

function wireInspect(map) {
  map.on("click", (event) => {
    // Point layers (CCTV, civic POIs, live cams, flood sensors) own the click.
    if (pointLayersOwningClick(map, event.point).length) return;
    runInspect(map, event);
  });

  map.on("mousemove", (event) => {
    if (pointLayersOwningClick(map, event.point).length) {
      map.getCanvas().style.cursor = "pointer";
      return;
    }
    const layerIds = INSPECT_BUILDING_LAYERS.filter((id) => map.getLayer(id));
    if (layerIds.length === 0) {
      map.getCanvas().style.cursor = "";
      return;
    }
    const hits = map.queryRenderedFeatures(event.point, { layers: layerIds });
    map.getCanvas().style.cursor = hits.length ? "pointer" : "";
  });

  const clearBtn = document.getElementById("atlas-inspect-clear");
  if (clearBtn) clearBtn.addEventListener("click", () => clearInspect(map));
}

// ─────────────────────────────────────────────────────────────────
// Toggle wiring (data-driven from LAYERS registry)
// ─────────────────────────────────────────────────────────────────

function renderLegend(legendEl, items, { interactive = false, map = null } = {}) {
  if (!legendEl || !items) return;
  legendEl.innerHTML = "";
  legendEl.classList.toggle("atlas-legend-interactive", interactive);
  for (const item of items) {
    const category = item.category;
    const isToggle = interactive && category;
    const row = document.createElement(isToggle ? "button" : "div");
    row.className = "atlas-legend-row";
    row.type = isToggle ? "button" : undefined;
    const swatch = document.createElement("span");
    swatch.className = "atlas-legend-swatch";
    swatch.style.background = item.color;
    const label = document.createElement("span");
    label.textContent = item.label;
    row.append(swatch, label);
    if (isToggle) {
      const on = state.civicPoiCategories[category] !== false;
      row.dataset.civicCategory = category;
      row.setAttribute("aria-pressed", on ? "true" : "false");
      row.classList.toggle("is-off", !on);
      row.title = on ? `Hide ${item.label}` : `Show ${item.label}`;
      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !(state.civicPoiCategories[category] !== false);
        setCivicPoiCategory(map || state.map, category, next);
        row.title = next ? `Hide ${item.label}` : `Show ${item.label}`;
      });
    }
    legendEl.appendChild(row);
  }
  legendEl.hidden = false;
}

function hideLegend(legendEl) {
  if (legendEl) {
    legendEl.hidden = true;
    legendEl.classList.remove("atlas-legend-interactive");
  }
}

function showLayerLegend(map, layer, legendEl) {
  if (!legendEl || !layer?.legend) return;
  renderLegend(legendEl, layer.legend, {
    interactive: !!layer.legendInteractive,
    map,
  });
}

function wireLayerToggles(map) {
  for (const layer of LAYERS) {
    const toggle = document.getElementById(`toggle-${layer.id}`);
    const stateEl = document.getElementById(`toggle-${layer.id}-state`);
    if (!toggle) continue;
    toggle.checked = layer.defaultOn;
    state.layerOn[layer.id] = layer.defaultOn;
    const legendEl = document.getElementById(`legend-${layer.id}`);
    const apply = async () => {
      const on = toggle.checked;
      state.layerOn[layer.id] = on;
      if (on) {
        try { await layer.install(map); } catch (error) { console.warn(`${layer.id} install failed:`, error); }
        if (layer.layers.length > 0) setLayersVisible(map, layer.layers, true);
        showLayerLegend(map, layer, legendEl);
      } else {
        try { layer.uninstall(map); } catch {}
        if (layer.layers.length > 0) setLayersVisible(map, layer.layers, false);
        if (legendEl) hideLegend(legendEl);
      }
      ensureStackOrder(map);
      if (stateEl) stateEl.textContent = on ? "on" : "off";
    };
    toggle.addEventListener("change", apply);
    // Stagger heavy GeoJSON so the city paints first on a laptop.
    if (layer.defaultOn) {
      if (layer.id === "khlongs" || layer.id === "traffic") {
        const delay = layer.id === "traffic" ? 80 : 220;
        setTimeout(() => { apply(); }, delay);
      } else {
        apply();
      }
    } else if (stateEl) {
      stateEl.textContent = "off";
    }
  }

  const colorToggle = document.getElementById("toggle-building-color");
  const colorLegend = document.getElementById("legend-buildings");
  if (colorToggle) {
    const applyColor = () => {
      state.buildingPaint = colorToggle.checked ? "type" : "monochrome";
      applyBuildingPaint(map);
      applyOverlayCompositing(map);
      if (colorToggle.checked) {
        const layerDef = LAYERS.find((l) => l.id === "buildings");
        if (layerDef?.legend) renderLegend(colorLegend, layerDef.legend);
      } else {
        hideLegend(colorLegend);
      }
    };
    colorToggle.addEventListener("change", applyColor);
  }

  wireOverlayOpacity(map);
  wireNightMode(map);
  wireStackPresets(map);
  updateStackChips();
}

function wireNightMode(map) {
  const toggle = document.getElementById("toggle-night");
  if (!toggle) return;
  toggle.checked = state.nightMode;
  toggle.addEventListener("change", () => {
    state.nightMode = toggle.checked;
    applyNightMode(map);
    updateStackChips();
  });
  applyNightMode(map);
}

function wireOverlayOpacity(map) {
  const slider = document.getElementById("overlay-opacity");
  const label = document.getElementById("overlay-opacity-value");
  if (slider) {
    const sync = () => {
      state.overlayOpacity = Number(slider.value) / 100;
      if (label) label.textContent = `${Math.round(state.overlayOpacity * 100)}%`;
      applyOverlayCompositing(map);
    };
    slider.value = String(Math.round(state.overlayOpacity * 100));
    slider.addEventListener("input", sync);
    sync();
  }

  const floodSlider = document.getElementById("flood-opacity");
  const floodLabel = document.getElementById("flood-opacity-value");
  if (floodSlider) {
    const syncFlood = () => {
      state.floodOpacity = Number(floodSlider.value) / 100;
      if (floodLabel) floodLabel.textContent = `${Math.round(state.floodOpacity * 100)}%`;
      applyOverlayCompositing(map);
    };
    floodSlider.value = String(Math.round(state.floodOpacity * 100));
    floodSlider.addEventListener("input", syncFlood);
    syncFlood();
  }
}

async function setLayerToggle(map, layerId, on) {
  const layer = LAYERS.find((l) => l.id === layerId);
  const toggle = document.getElementById(`toggle-${layerId}`);
  const stateEl = document.getElementById(`toggle-${layerId}-state`);
  const legendEl = document.getElementById(`legend-${layerId}`);
  if (!layer || !toggle) return;

  toggle.checked = on;
  state.layerOn[layerId] = on;

  if (on) {
    try { await layer.install(map); } catch (error) { console.warn(`${layerId} install failed:`, error); }
    if (layer.layers.length > 0) setLayersVisible(map, layer.layers, true);
    showLayerLegend(map, layer, legendEl);
  } else {
    try { layer.uninstall(map); } catch {}
    if (layer.layers.length > 0) setLayersVisible(map, layer.layers, false);
    if (legendEl) hideLegend(legendEl);
  }
  if (stateEl) stateEl.textContent = on ? "on" : "off";
  ensureStackOrder(map);
  updateStackChips();
}

function wireStackPresets(map) {
  const root = document.getElementById("atlas-stack-presets");
  if (!root) return;
  root.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-preset]");
    if (!btn) return;
    const preset = btn.dataset.preset;
    root.querySelectorAll("[data-preset]").forEach((el) => {
      el.classList.toggle("is-active", el === btn);
    });
    const wants = {
      city: { buildings: true, rail: true, traffic: true, cctv: false, khlongs: true, rain: false, aqi: false, heat: false, flood: false, terrain: false, night: false },
      rain: { buildings: true, rail: true, traffic: false, cctv: false, khlongs: false, rain: true, aqi: false, heat: false, flood: false, terrain: false, night: false },
      aqi: { buildings: true, rail: true, traffic: false, cctv: false, khlongs: false, rain: false, aqi: true, heat: false, flood: false, terrain: false, night: false },
      heat: { buildings: true, rail: true, traffic: false, cctv: false, khlongs: true, rain: false, aqi: false, heat: true, flood: false, terrain: false, night: false },
      flood: { buildings: true, rail: true, traffic: false, cctv: false, khlongs: true, rain: true, aqi: false, heat: false, flood: true, terrain: true, night: false },
      night: { buildings: true, rail: true, traffic: false, cctv: false, khlongs: false, rain: false, aqi: false, heat: false, flood: false, terrain: false, night: true },
      pulse: { buildings: true, rail: true, traffic: true, cctv: true, khlongs: false, rain: true, aqi: true, heat: false, flood: true, terrain: false, night: false },
    }[preset];
    if (!wants) return;
    state.nightMode = !!wants.night;
    applyNightMode(map);
    if (wants.buildings) await setLayerToggle(map, "buildings", true);
    for (const [id, on] of Object.entries(wants)) {
      if (id === "buildings" || id === "night") continue;
      await setLayerToggle(map, id, on);
    }
    ensureStackOrder(map);
    updateStackChips();
  });
}

// ─────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────

function defaultCenter(areas) {
  if (areas.length === 0) return [100.5018, 13.7563];
  const [lng, lat] = areas[0].center;
  return [lng, lat];
}

function defaultZoom(areas) {
  return areas[0]?.zoom ?? 14;
}


function wireAboutDrawer() {
  const root = document.getElementById("atlas-about");
  const sheet = root?.querySelector(".atlas-about-sheet");
  if (!root || !(sheet instanceof HTMLElement)) return;

  // Quiet film still — hide the frame if the asset isn't shipped yet.
  const film = root.querySelector(".atlas-about-film");
  const filmImg = film?.querySelector("img");
  if (film instanceof HTMLElement && filmImg instanceof HTMLImageElement) {
    const hideFilm = () => { film.hidden = true; };
    filmImg.addEventListener("error", hideFilm, { once: true });
    if (filmImg.complete && filmImg.naturalWidth === 0) hideFilm();
  }

  let lastFocus = null;

  const isOpen = () => !root.hasAttribute("hidden");

  const setHashAbout = (open) => {
    const url = new URL(window.location.href);
    if (open) {
      if (url.hash !== "#about") {
        url.hash = "about";
        history.replaceState(null, "", url.toString());
      }
      return;
    }
    if (url.hash === "#about") {
      url.hash = "";
      history.replaceState(null, "", url.pathname + url.search);
    }
  };

  const openAbout = () => {
    if (isOpen()) return;
    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    document.body.classList.add("atlas-about-open");
    setHashAbout(true);
    window.requestAnimationFrame(() => sheet.focus({ preventScroll: true }));
  };

  const closeAbout = () => {
    if (!isOpen()) return;
    root.hidden = true;
    document.body.classList.remove("atlas-about-open");
    setHashAbout(false);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  };

  document.querySelectorAll("[data-about-open]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      openAbout();
    });
  });
  document.querySelectorAll("[data-about-close]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      closeAbout();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      closeAbout();
    }
  });

  root.querySelectorAll(".atlas-about-toc a").forEach((anchor) => {
    anchor.addEventListener("click", (event) => {
      // preventDefault so the browser never sets location.hash to the
      // section id (e.g. "#about-thesis") — the global hashchange
      // listener below treats any hash other than "#about" as "close
      // the drawer", so without this every TOC click closed the sheet
      // it was supposed to scroll. Jump inside the sheet manually instead.
      event.preventDefault();
      const targetId = anchor.getAttribute("href")?.slice(1);
      const target = targetId ? document.getElementById(targetId) : null;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (window.location.hash === "#about") openAbout();
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#about") openAbout();
    else if (isOpen() && window.location.hash !== "#about") closeAbout();
  });
}

async function init() {
  const data = await fetchAreas();
  state.areas = data.areas;

  renderQuickJump(state.areas);
  wireAboutDrawer();
  document.getElementById("atlas-share").addEventListener("click", copyDeepLink);

  const initialId = parseHashId();
  const initialArea = initialId ? state.areas.find((a) => a.id === initialId) : state.areas[0];
  const externalAt = parseAtQuery();

  const map = new maplibregl.Map({
    container: "atlas-map",
    style: OPENFREEMAP_DARK_STYLE,
    center: initialArea ? initialArea.center : defaultCenter(state.areas),
    zoom: initialArea ? initialArea.zoom : defaultZoom(state.areas),
    pitch: initialArea ? initialArea.pitch ?? 55 : 55,
    bearing: initialArea ? initialArea.bearing ?? 0 : 0,
    minZoom: 10,
    maxZoom: 19,
    maxPitch: 75,
    antialias: true,
    hash: false,
    attributionControl: { compact: true },
  });

  // External fly-to (e.g. bkk's quarter chip loaded the atlas with
  // ?at=lng,lat,zoom). Fires after the map is built so the camera
  // override is the last word.
  if (externalAt && !initialId) {
    map.once("load", () => {
      map.flyTo({ center: externalAt.center, zoom: externalAt.zoom, pitch: 60, bearing: 0, speed: 1.1, essential: true });
    });
  }

  state.map = map;

  // The OpenFreeMap dark style references a "wood-pattern" sprite image
  // it doesn't ship — MapLibre warned about it on every single page load.
  // Supply a 1×1 transparent stand-in for any missing style image so the
  // console stays clean without touching the upstream style.
  map.on("styleimagemissing", (event) => {
    if (map.hasImage(event.id)) return;
    map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

  // MapLibre's compact attribution starts EXPANDED — a two-line white bar
  // covering the bottom fifth of the map on a phone. It expands async
  // (once attribution data arrives), so a load-time removal misses it;
  // watch for the class, strip it exactly once, then disconnect so the
  // user's own ⓘ toggle works normally. Every credit stays one tap away
  // (ODbL/Esri compliance intact), the map stops wearing a banner.
  const attribEl = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
  if (attribEl) {
    const collapseOnce = new MutationObserver(() => {
      if (attribEl.classList.contains("maplibregl-compact-show")) {
        attribEl.classList.remove("maplibregl-compact-show");
        collapseOnce.disconnect();
      }
    });
    if (attribEl.classList.contains("maplibregl-compact-show")) {
      attribEl.classList.remove("maplibregl-compact-show");
    } else {
      collapseOnce.observe(attribEl, { attributes: true, attributeFilter: ["class"] });
    }
  }

  map.on("load", () => {
    wireLayerToggles(map);
    wireInspect(map);
    if (initialArea) setActiveArea(initialArea.id);
  });

  window.addEventListener("hashchange", () => {
    const id = parseHashId();
    if (id && id !== state.activeId) flyToArea(id, { updateHash: false });
  });
}

init().catch((error) => {
  console.error("Atlas init failed:", error);
  const panel = document.querySelector(".atlas-panel");
  if (panel) {
    const note = document.createElement("pre");
    note.style.color = "#ff6b35";
    note.style.padding = "20px";
    note.textContent = `Atlas failed to load:\n${String(error?.message ?? error)}`;
    panel.prepend(note);
  }
});
