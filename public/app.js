// BKKx 3D Atlas — MapLibre viewer with toggleable data layers.
// No build step. Layers are declared in the LAYERS registry below;
// each entry owns its source(s), paint, and toggle behavior.
//
// Sharp edges only. No rounded corners on the chrome.
// Signal yellow `#c9ff38` means live signal (2026-10-16, owner's choice):
// ordinary building fabric is warm grey `#9a9a90`, so 432,077 buildings no
// longer compete with flood, rail and camera layers. The "type colors" mode
// (BUILDING_COLOR_BY_TYPE) colours only distinct types; houses, sheds and
// untagged fabric stay grey.

import './maplibre-global.js'; // must stay first: sets window.maplibregl (v6, self-hosted)
import { installHeritageRoofs, uninstallHeritageRoofs, ROOF_LAYER } from './heritage-roofs.js';
import {
  HEIGHT_GET,
  MIN_HEIGHT_GET,
  RATTANAKOSIN_HEIGHT_EXPRESSION,
  RATTANAKOSIN_MIN_HEIGHT_EXPRESSION,
} from './building-heights.js';
import {
  installCityForms,
  uninstallCityForms,
  cityFormsDebugState,
  attachCityFormsRefresh,
  detachCityFormsRefresh,
  CITY_FORMS_LAYER,
} from './city-forms-layer.js';
import { installHeritageForms, uninstallHeritageForms, FORMS_LAYER } from './heritage-forms-layer.js';
import { installWireframeLandmarks, uninstallWireframeLandmarks, WIRE_LAYER_ID } from './wireframe-landmarks.js';
import {
  installBuildingMassing,
  massingFeatureAt,
  massingDebugState,
  MASSING_LAYER,
  reapplyMassingFilters,
  suspendBuildingMassing,
} from './building-massing.js';

import { installHiiHistory, HII_HISTORY_LAYER } from './hii-history.js';
import { placeBriefing, nearestCameras, nearbyRoadReports } from './place-briefing.js';
import { installTrafficPilot } from './traffic-vision.js?v=bkk-atlas-20261021-1792608300-f30c22c';
// Written by scripts/stamp-build-id.mjs at release; "dev" means an unreleased tree.
const ATLAS_BUILD = "bkk-atlas-20261021-1792608300-f30c22c";

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

// Building height — clamp to a sane range. OSM data frequently has
// building:levels, building_levels or levels without an explicit height tag.
// We evaluate in order:
// 1. Explicit tagged render_height / height (between 1 m and 500 m)
// 2. Tagged levels (building:levels, building_levels, levels) * 3.15 m floor height (between 1 and 160 levels)
// 3. Typology-aware height default based on building/building_type
// 4. Default 8.5 m for untagged / generic footprints
// The height rules live in ./building-heights.js, not here. They are shared
// because a roof has to sit on exactly the same number as the wall under it,
// and a second copy of a rule is a second chance to be wrong.
const BUILDING_HEIGHT_EXPRESSION = HEIGHT_GET;
const BUILDING_MIN_HEIGHT_EXPRESSION = MIN_HEIGHT_GET;

// Old Town: when OSM has no real height or levels tag, lift temples and
// shophouse fabric so Rattanakosin reads as a city of wats and 2–3 storey rows,
// not a flat plate. Real tagged heights and levels still win.
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

// 3D buildings — monochrome (warm grey) for the default atlas mode.
const BUILDING_PAINT_MONOCHROME = {
  "fill-extrusion-color": "#9a9a90",
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
  "school", "#3d74c4",
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
  "house", "#a8a89e",
  "residential", "#a8a89e",
  "detached", "#a8a89e",
  "terrace", "#a8a89e",
  "semidetached_house", "#a8a89e",
  "townhouse", "#a8a89e",
  "bungalow", "#a8a89e",
  "hut", "#a8a89e",
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
  "shed", "#9a9a90",
  "roof", "#9a9a90",
  "stilt_house", "#a8a89e",
  "construction", "#9a9a90",
  // default
  "#9a9a90",
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
  "fill-extrusion-color": "#9a9a90",
  "fill-extrusion-height": RATTANAKOSIN_HEIGHT_EXPRESSION,
  "fill-extrusion-base": RATTANAKOSIN_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": 1,
  "fill-extrusion-vertical-gradient": true,
};

// Landmark paint — gold for wats / monument, warmer for Golden Mount.
// New kinds (2026-09-02): modern Bangkok icons — towers, hotels, malls,
// civic, bridge. Color choices follow the atlas house rule: cool steel
// for engineered structures, warm gold for hospitality, neutral for
// retail/civic, silver-blue for crossings.
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
  // ── modern Bangkok icons ──
  "tower", "#9ba3b4",      // steel/cool — modern skyscraper
  "hotel", "#e9a91a",      // warm gold — luxury hospitality (same as throne)
  "mall", "#88a8b8",       // cool neutral — retail podium
  "civic", "#d4c5a8",      // warm cream — government / public
  "bridge", "#7d8a9a",     // silver-blue — river crossing
  "park", "#5a8a3a",       // forest green — public parks (low-rise)
  "shrine", "#e9a91a",     // warm gold — shrines comply with one-amber palette rule
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

const WATER_TRANSIT_SOURCE = "bkkx-water-transit";
const WATER_TRANSIT_ROUTE_LAYER = "bkkx-water-transit-routes";
const WATER_TRANSIT_FERRY_LAYER = "bkkx-water-transit-ferry";
const WATER_TRANSIT_PIER_LAYER = "bkkx-water-transit-piers";
const WATER_TRANSIT_DATA_URL = "/bkk-water-transit.geojson";

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
const KHLONG_FLOW_LAYER = "bkkx-khlongs-flow";

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
  "school", "#3d74c4",
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

// Waterway network. OSM's `width` is a type default, not a measurement, so
// importance comes from how far a named waterway runs across the metro
// (tierWaterways): 4 Chao Phraya · 3 ≥20 km (Saen Saep, Prem Prachakon…)
// · 2 ≥7 km · 1 other named khlong · 0 unnamed ditch (close zoom only).
const WATERWAY_CALM = "#3FA7E0";
const byTier = (t4, t3, t2, t1, t0) => ["match", ["get", "tier"], 4, t4, 3, t3, 2, t2, 1, t1, t0];
const judged = ["!=", ["feature-state", "band"], null];
// A judged stretch also swells, so heat reads by weight as well as colour.
const swell = (tiers) => ["*", ["case", judged, 1.7, 1], tiers];
const WATERWAY_WIDTH = [
  "interpolate", ["exponential", 1.6], ["zoom"],
  10, swell(byTier(3.6, 2.2, 1.4, 0.8, 0.5)),
  13, swell(byTier(9, 5, 3.2, 1.8, 1)),
  16, swell(byTier(18, 9, 6, 3.4, 2)),
];
const WATERWAY_OPACITY = [
  "interpolate", ["linear"], ["zoom"],
  10, ["case", judged, 1, byTier(0.95, 0.9, 0.8, 0.5, 0)],
  13, ["case", judged, 1, byTier(0.9, 0.9, 0.85, 0.75, 0.45)],
  15, ["case", judged, 1, 0.85],
];
const FLOW_WIDTH = [
  "interpolate", ["exponential", 1.6], ["zoom"],
  10, byTier(1.4, 0.9, 0.6, 0.4, 0),
  13, byTier(3.2, 1.8, 1.3, 0.8, 0),
  16, byTier(6, 3.4, 2.4, 1.4, 0),
];
// Mapbox's "animate a line" dash cycle: each step slides the dash forward
// along the line's own direction — in OSM, the direction water drains.
const FLOW_DASH_STEPS = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

// FloodDash gauge bands (server/indicator.js), mirrored from src/flooddash.ts.
// Blue while calm; the tone heats only where a judged gauge says so.
const FLOOD_BAND_COLOR = {
  "no-signal": "#6b6d63",
  untrusted: "#8a8c80",
  safe: WATERWAY_CALM,
  watch: "#E8C547",
  prepare: "#E8A317",
  evacuate: "#E86A10",
  "overflow-imminent": "#DB3A1F",
  "observed-overflow": "#C8102E",
};
const WATERWAY_COLOR = [
  "match", ["to-string", ["coalesce", ["feature-state", "band"], "calm"]],
  "watch", FLOOD_BAND_COLOR.watch,
  "prepare", FLOOD_BAND_COLOR.prepare,
  "evacuate", FLOOD_BAND_COLOR.evacuate,
  "overflow-imminent", FLOOD_BAND_COLOR["overflow-imminent"],
  "observed-overflow", FLOOD_BAND_COLOR["observed-overflow"],
  WATERWAY_CALM,
];
const FLOOD_BKK_URL = "/api/flood/bkk";
const FLOOD_REFRESH_MS = 5 * 60_000;
const FLOOD_DUTY = "Not an official warning · DDPM 1784";

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

// Current 10 m wind from Open-Meteo. A 6×6 Bangkok grid is converted
// client-side into directional arrow shafts + heads, so direction stays
// legible without depending on a webfont glyph or pretending these model
// cells are street-level anemometers.
const WIND_SOURCE = "bkkx-wind";
const WIND_LAYER = "bkkx-wind-arrows";
const WIND_ORIGIN_LAYER = "bkkx-wind-origins";
const WIND_API = "https://api.open-meteo.com/v1/forecast";

// NASA GIBS regional aerosol optical depth (AOD). This is a daily
// MODIS Terra + Aqua observation at roughly 1 km — useful for seeing
// the regional haze field, but deliberately not labelled as ground-level
// PM2.5. GIBS publishes the Web Mercator tiles through zoom 7.
const AEROSOL_SOURCE = "bkkx-aerosol";
const AEROSOL_LAYER = "bkkx-aerosol-tiles";
const AEROSOL_MAX_ZOOM = 7;
const AEROSOL_DATA_LAG_DAYS = 2;

// Schematic flood envelopes (Labs sandbox). NOT official DDPM/BMA
// flood lines — generalized 2011-style corridors + monsoon pockets.
const FLOOD_SOURCE = "bkkx-flood";
const FLOOD_FILL = "bkkx-flood-fill";
const FLOOD_LINE = "bkkx-flood-line";
const FLOOD_DATA_URL = "/bkk-flood-envelope.geojson";
const FLOOD_FILL_COLOR = [
  "match", ["get", "severity"],
  "high", "#1d4ed8",
  "medium", "#3d74c4",
  "low", "#93c5fd",
  "#3d74c4",
];

// Water-level gauges as judged by FloodDash — see /api/flood-sensors
// (src/flooddash.ts). `levelColor` is FloodDash's band colour; `silent`
// gauges draw hollow (no data is not an all-clear), `dim` ones are stale.
const FLOOD_SENSOR_SOURCE = "bkkx-flood-sensors";
const FLOOD_SENSOR_LAYER = "bkkx-flood-sensor-dots";
const FLOOD_SENSOR_HALO_LAYER = "bkkx-flood-sensor-halo";
const FLOOD_SENSOR_LIVE_URL = "/api/flood-sensors";

// Bangkok provincial rain gauge network — 133 stations from ThaiWater v3
// (provinces/rain24?province_code=10). Steals the BKK provincial gauge list
// that powers bangkok.thaiwater.net/dashboard. Static asset for now; the
// upstream feed is fetched by scripts/build-bkk-rain-stations.py and the
// resulting geojson ships in /public.
const RAIN_STATION_SOURCE = "bkkx-bkk-rain-stations";
const RAIN_STATION_LAYER = "bkkx-bkk-rain-stations-dots";
const RAIN_STATION_HALO_LAYER = "bkkx-bkk-rain-stations-halo";
const RAIN_STATION_URL = "/bkk-rain-stations.geojson";

// Bangkok incident heat — aggregated from city-events (Longdo/iTIC),
// news-events (Bangkok Post + Khaosod), BMA DDS road reports, and
// flood-sensors in prepare/evacuate bands. The /api/water/bkk/incidents
// route does the join + weight calculation; this layer paints the
// resulting points as a MapLibre heatmap so the atlas flood edition
// can answer "where are the bad roads right now" without camera colors.
// Canal gauges — BKK FloodWatch (flood2026, MIT) relayed by /api/flood/canals:
// ~220 Bangkok gauges incl. all 199 BMA canal gauges, with backtested forecasts.
const CANAL_SOURCE = "bkkx-canal-gauges";
const CANAL_LAYER = "bkkx-canal-gauge-dots";
const CANAL_URL = "/api/flood/canals";

// Airbnb listings — Inside Airbnb's Bangkok snapshot (scripts/build-airbnb.py).
const AIRBNB_SOURCE = "bkkx-airbnb";
const AIRBNB_HEAT_LAYER = "bkkx-airbnb-heat";
const AIRBNB_LAYER = "bkkx-airbnb-dots";
const AIRBNB_URL = "/bkk-airbnb.geojson";
const AIRBNB_ROOM = { E: "Entire home / apartment", P: "Private room", S: "Shared room", H: "Hotel room" };

const INCIDENT_SOURCE = "bkkx-bkk-incidents";
const INCIDENT_HEAT_LAYER = "bkkx-bkk-incident-heat";
const INCIDENT_DOT_LAYER = "bkkx-bkk-incident-dots";
const INCIDENTS_URL = "/api/water/bkk/incidents";
const INCIDENT_HEAT_MAX_ZOOM = 14;  // beyond this, switch to dots

// Flooded roads now — /api/flood/roads (src/floodroads.ts). Every public
// flood signal put on the street it describes: residents (Traffy Fondue),
// drivers (iTIC), officials (BMA DDS, matched by road name inside the khet)
// and FloodDash gauges. Method stolen from FloodDash's streetReports.js /
// streetFlood.js. A lit stretch = a report within ~100 m on that road.
const FLOOD_ROADS_URL = "/api/flood/roads";
const ROADS_XREF_URL = "/api/water/bkk/roads-xref";
const FLOOD_ROADS_SOURCE = "bkkx-flood-roads";
const FLOOD_HEAT_SOURCE = "bkkx-flood-roads-heat";
const FLOOD_HEAT_LAYER = "bkkx-flood-roads-heat";
const FLOOD_RIPPLE_LAYER = "bkkx-flood-roads-ripple";
const FLOOD_ROAD_CLOSED_LAYER = "bkkx-flood-roads-closed";
const FLOOD_ROAD_LAYER = "bkkx-flood-roads-water";
const FLOOD_ROAD_FLOW_LAYER = "bkkx-flood-roads-flow";
const FLOOD_ROAD_LAYERS = [FLOOD_HEAT_LAYER, FLOOD_RIPPLE_LAYER, FLOOD_ROAD_CLOSED_LAYER, FLOOD_ROAD_LAYER, FLOOD_ROAD_FLOW_LAYER];
// Reported depth (resident's body-reference word, or cm) → water tone.
// Deeper reads darker and more violet; unknown depth reads as plain water.
const FLOOD_DEPTH_COLOR = [
  "match", ["get", "depth"],
  1, "#8fe3ff", 2, "#8fe3ff",
  3, "#45bdff",
  4, "#1f86ff",
  5, "#3a55ff",
  6, "#6a3dff",
  7, "#b026c9",
  "#62c9ff",
];
const FLOOD_CLOSED_COLOR = "#C8102E";

// Drainage infrastructure surfaces — pulled from FloodDash relays so the
// atlas flood edition can answer "where are the bad roads right now"
// through the city's own drainage network, not just camera colours.
// Each layer is a circle/dot set: a halo for the worst band, a dot for
// the clickable marker. The popup carries the upstream metric
// (level vs critical for gates, depth/status for roads, news headlines
// for emergency points).
const CANAL_GATE_SOURCE = "bkkx-bkk-canal-gates";
const CANAL_GATE_HALO_LAYER = "bkkx-bkk-canal-gate-halo";
const CANAL_GATE_LAYER = "bkkx-bkk-canal-gate-dots";
const CANAL_GATES_URL = "/api/water/bkk/canal-gates";

const ROADS_FLOODED_SOURCE = "bkkx-bkk-roads-flooded";
const ROADS_FLOODED_HALO_LAYER = "bkkx-bkk-roads-flooded-halo";
const ROADS_FLOODED_LAYER = "bkkx-bkk-roads-flooded-dots";
const ROADS_FLOODED_URL = "/api/water/bkk/roads-flooded";

const EMERGENCY_SOURCE = "bkkx-bkk-emergency";
const EMERGENCY_HALO_LAYER = "bkkx-bkk-emergency-halo";
const EMERGENCY_LAYER = "bkkx-bkk-emergency-dots";
const EMERGENCY_URL = "/api/water/bkk/emergency-points";

// Dams + alerts + sources-health (2026-09-29) — three more surfaces
// pulled from FloodDash's /api/snapshot. Dams paint upstream-of-BKK
// variables (Bhumibol/Sirikit storage %) so the river the atlas
// already colours has a story upstream. Alerts + sources-health are
// panel-only (text + status grid) — no map layer.
const DAM_SOURCE = "bkkx-bkk-dams";
const DAM_HALO_LAYER = "bkkx-bkk-dams-halo";
const DAM_LAYER = "bkkx-bkk-dams-dots";
const DAMS_URL = "/api/water/bkk/dams";
const ALERTS_URL = "/api/water/bkk/alerts";
const SOURCES_HEALTH_URL = "/api/water/bkk/sources-health";
const NEWS_WATCH_URL = "/api/water/bkk/news-watch";

// Maholan community CCTV (2026-09-30) — proxies cctv.maholan.net's
// consolidated feed of 2,355 cameras across Thailand, filtered to BKK
// + 30 km halo by the Worker. The atlas previously had ~66 iTIC /
// Longdo cameras via /api/cctv; this layer adds ~10× the coverage
// including Pak Kret water-level, Pathum Thani river gauge, BKK
// district, DOH and community submissions. Each click opens a popup
// with a thumbnail + a link to the upstream Maholan viewer.
const MAHOLAN_CCTV_SOURCE = "bkkx-maholan-cctv";
const MAHOLAN_CCTV_HALO_LAYER = "bkkx-maholan-cctv-halo";
const MAHOLAN_CCTV_LAYER = "bkkx-maholan-cctv-dots";
const MAHOLAN_CCTV_URL = "/api/water/bkk/maholan-cctv";

// Rain severity colors — match the ThaiWater dashboard gradient so the
// two visualizations speak the same language. Tuned to be readable on
// a dark satellite base + the #11120f halo from flood sensors.
const RAIN_STATION_COLOR = [
  "match", ["get", "severity"],
  "none",        "#7d8a9a",   // grey — no rain
  "light",       "#7eb6ff",   // pale blue — <10mm/24h
  "moderate",    "#facc15",   // yellow — 10–35mm/24h
  "heavy",       "#f97316",   // orange — 35–90mm/24h
  "very-heavy",  "#dc2626",   // red — ≥90mm/24h
  "#7d8a9a",
];
// Linear gradient fallback: also paint from the absolute mm value so a
// future field-only refresh (no `severity` string) still colors right.
const RAIN_STATION_COLOR_BY_MM = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "rain_24h_mm"]], 0],
  0,    "#7d8a9a",
  5,    "#7eb6ff",
  10,   "#7eb6ff",
  35,   "#facc15",
  90,   "#f97316",
  200,  "#dc2626",
];

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
  flood: null, // FloodDash relay payload (/api/flood/bkk)
  cctvGeojson: null, // last CCTV FeatureCollection (live or sample)
  roadsFloodedGeojson: null, // last /api/water/bkk/roads-flooded FeatureCollection
  floodCamJoin: null, // { byCam: Map<camId,road>, byRoad: Map<roadId,cam> } — CCTV↔flooded-road spatial join (Haversine ≤ 800 m, active roads only)
  flowTimer: null,
  rainStationPopup: null,
  incidentPopup: null,
  canalGatePopup: null,
  roadsFloodedPopup: null,
  emergencyPopup: null,
  damPopup: null,
  maholanCctvPopup: null,
  // Last FloodDash reading time + a per-gauge delta history so the
  // situation board can show "Chao Phraya +5 cm since last reading".
  lastFloodRefreshAt: null,
  gaugeTrend: new Map(), // gaugeId → [{ ts, levelMs }, ...] (cap 4)
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
  ROOF_LAYER,
  CITY_FORMS_LAYER,
  MASSING_LAYER,
  "bkkx-roads-minor",
  "bkkx-roads-major",
  "bkkx-roads-motorway",
  LAND_PRICE_FILL_LAYER,
  LAND_PRICE_LINE_LAYER,
  AIRBNB_HEAT_LAYER,
  AIRBNB_LAYER,
  CANAL_LAYER,
  CIVIC_DENSITY_FILL_LAYER,
  CIVIC_DENSITY_LINE_LAYER,
  DISTRICT_LAYER,
  HII_HISTORY_LAYER,
  KHLONG_RIVER_LAYER,
  KHLONG_CANAL_LAYER,
  KHLONG_FLOW_LAYER,
  RAIL_LAYER,
  WATER_TRANSIT_ROUTE_LAYER,
  WATER_TRANSIT_FERRY_LAYER,
  WATER_TRANSIT_PIER_LAYER,
  TRAFFIC_LAYER,
  FLOOD_FILL,
  FLOOD_LINE,
  FLOOD_SENSOR_HALO_LAYER,
  FLOOD_SENSOR_LAYER,
  RAIN_STATION_HALO_LAYER,
  RAIN_STATION_LAYER,
  HEAT_LAYER,
  HEAT_CIRCLE_LAYER,
  AQI_LAYER,
  AQI_CIRCLE_LAYER,
  AEROSOL_LAYER,
  RAIN_LAYER,
  WIND_ORIGIN_LAYER,
  WIND_LAYER,
  CCTV_HALO_LAYER,
  CCTV_LAYER,
  LIVE_CAM_HALO_LAYER,
  LIVE_CAM_LAYER,
  INCIDENT_HEAT_LAYER,
  INCIDENT_DOT_LAYER,
  FLOOD_HEAT_LAYER,
  FLOOD_RIPPLE_LAYER,
  FLOOD_ROAD_CLOSED_LAYER,
  FLOOD_ROAD_LAYER,
  FLOOD_ROAD_FLOW_LAYER,
  CANAL_GATE_HALO_LAYER,
  CANAL_GATE_LAYER,
  ROADS_FLOODED_HALO_LAYER,
  ROADS_FLOODED_LAYER,
  EMERGENCY_HALO_LAYER,
  EMERGENCY_LAYER,
  DAM_HALO_LAYER,
  DAM_LAYER,
  MAHOLAN_CCTV_HALO_LAYER,
  MAHOLAN_CCTV_LAYER,
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

  const weatherOn = !!(state.layerOn.rain || state.layerOn.wind || state.layerOn.aqi || state.layerOn.aerosol || state.layerOn.flood || state.layerOn.heat);
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
  if (map.getLayer(AEROSOL_LAYER)) {
    try { map.setPaintProperty(AEROSOL_LAYER, "raster-opacity", state.overlayOpacity); } catch {}
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
    "water-transit": "Boats",
    traffic: "Traffic",
    cctv: "CCTV",
    "live-cams": "Live",
    airbnb: "Airbnb",
    khlongs: "Khlongs",
    districts: "Districts",
    terrain: "Terrain",
    "land-price": "Land ฿",
    "civic-pois": "Civic",
    "civic-density": "Density",
    "city-events": "Live !",
    "news-events": "Buzz",
    flood: "Flood",
    "hii-history": "History · not live",
    "flood-sensors": "Gauges",
    heat: "Heat",
    aqi: "AQI",
    aerosol: "Satellite AOD",
    rain: "Rain",
    wind: "Wind",
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
    if (id === "rain" || id === "wind" || id === "aqi" || id === "aerosol" || id === "flood" || id === "heat") chip.classList.add("is-weather");
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
    layers: [BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER, RATTANAKOSIN_BUILDINGS_LAYER, LANDMARKS_LAYER, ROOF_LAYER, FORMS_LAYER, CITY_FORMS_LAYER, MASSING_LAYER, "bkkx-satellite", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway"],
    install: async (map) => {
      installBuildings(map);
      await installRattanakosin(map);
      await installLandmarks(map);
      try { installBuildingMassing(map, BUILDING_EXTRUSION_FILTER); } catch (error) {
        console.warn("Building massing unavailable; extrusions retained:", error);
      }
      // Roofs and rooftop plant. Additive: the extrusions stay, these sit on
      // them. If they fail, the city is still a city of boxes.
      try {
        await installCityForms(map);
        attachCityFormsRefresh(map);
      } catch (error) {
        console.warn("City forms unavailable; original buildings retained:", error);
      }
      ensureStackOrder(map);
    },
    uninstall: (map) => {
      suspendBuildingMassing(map);
      detachCityFormsRefresh(map);
      setLayersVisible(map, [
        BKKX_BUILDINGS_LAYER, BKKX_BUILDINGS_HI_LAYER, RATTANAKOSIN_BUILDINGS_LAYER, LANDMARKS_LAYER, ROOF_LAYER, FORMS_LAYER, CITY_FORMS_LAYER, MASSING_LAYER,
        "bkkx-satellite", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway",
      ], false);
    },
    legend: [
      { color: "#f5b800", label: "temple / pagoda / chedi" },
      { color: "#e8d5a3", label: "Victory Monument" },
      { color: "#a8c84a", label: "mosque" },
      { color: "#c89b3c", label: "church / cathedral" },
      { color: "#3d74c4", label: "school" },
      { color: "#1e40af", label: "university" },
      { color: "#10b981", label: "hospital" },
      { color: "#ec4899", label: "hotel" },
      { color: "#a855f7", label: "museum" },
      { color: "#fef3c7", label: "commercial / shophouse" },
      { color: "#a8a89e", label: "house" },
      { color: "#fb923c", label: "apartments" },
      { color: "#6b7280", label: "industrial" },
      { color: "#9a9a90", label: "untagged" },
    ],
  },
  {
    id: "wireframe-landmarks",
    name: "Monument wireframes",
    description: "Procedural line drawings · 8 landmarks",
    defaultOn: false,
    layers: [WIRE_LAYER_ID],
    install: async (map) => { await installWireframeLandmarks(map); },
    uninstall: (map) => { uninstallWireframeLandmarks(map); },
    legend: [
      { color: "#f5ecc2", label: "Sulpher Yellow ink on black" },
    ],
    note: "Stylised line drawings from procedural geometry — not a survey, and not a reconstruction. Positions are the monument footprints; proportions are illustrative.",
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
    id: "water-transit",
    name: "Boat routes & piers",
    description: "Chao Phraya + Saen Saep · scheduled",
    defaultOn: true,
    softUninstall: true,
    layers: [WATER_TRANSIT_ROUTE_LAYER, WATER_TRANSIT_FERRY_LAYER, WATER_TRANSIT_PIER_LAYER],
    install: async (map) => { await loadWaterTransitData(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [WATER_TRANSIT_ROUTE_LAYER, WATER_TRANSIT_FERRY_LAYER, WATER_TRANSIT_PIER_LAYER], false),
    legend: [
      { color: "#f29b38", label: "Chao Phraya Express" },
      { color: "#54c7ec", label: "Tourist Boat" },
      { color: "#31b7a3", label: "Khlong Saen Saep" },
      { color: "#f5f1e8", label: "cross-river ferry" },
    ],
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
    // Every camera on one switch (2026-10-14): iTIC road cameras, the
    // Maholan list of agency and other cameras, and the curated live views.
    // Off by default — 1,700 dots are a layer you ask for, not a backdrop.
    id: "cctv",
    name: "Cameras",
    description: "iTIC · government agencies · others",
    defaultOn: false,
    softUninstall: true,
    layers: [CCTV_HALO_LAYER, CCTV_LAYER, MAHOLAN_CCTV_HALO_LAYER, MAHOLAN_CCTV_LAYER, LIVE_CAM_HALO_LAYER, LIVE_CAM_LAYER],
    install: async (map) => {
      await Promise.all([loadCctvData(map, { preferLive: true }), installMaholanCctv(map), installLiveCams(map)]);
      // Each loader writes its own status; the switch shows one line for all.
      if (state.maholanCctv) setLayerStatus("cctv", cameraStatus(state.maholanCctv));
      ensureStackOrder(map);
    },
    uninstall: (map) => {
      closeCctvPopup();
      closeMaholanCctvPopup();
      closeLiveCamPopup();
      setLayersVisible(map, [CCTV_HALO_LAYER, CCTV_LAYER, MAHOLAN_CCTV_HALO_LAYER, MAHOLAN_CCTV_LAYER, LIVE_CAM_HALO_LAYER, LIVE_CAM_LAYER], false);
    },
    legend: [
      { color: "#c9ff38", label: "iTIC · official road cameras (live video)" },
      { color: "#5ec8ff", label: "government · BMA, highways, water, disaster, municipal" },
      { color: "#c084fc", label: "other · user-added, relays, YouTube live views" },
      { color: "#4b4d45", label: "faint = sent no picture at last check" },
    ],
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
    layers: [KHLONG_RIVER_LAYER, KHLONG_CANAL_LAYER, KHLONG_FLOW_LAYER],
    install: async (map) => { await loadKhlongData(map); ensureStackOrder(map); },
    uninstall: (map) => {
      stopWaterFlow();
      setLayersVisible(map, [KHLONG_RIVER_LAYER, KHLONG_CANAL_LAYER, KHLONG_FLOW_LAYER], false);
    },
    legend: [
      { color: WATERWAY_CALM, label: "no gauge concern nearby" },
      { color: FLOOD_BAND_COLOR.watch, label: "watch" },
      { color: FLOOD_BAND_COLOR.prepare, label: "prepare" },
      { color: FLOOD_BAND_COLOR.evacuate, label: "near bank" },
      { color: FLOOD_BAND_COLOR["overflow-imminent"], label: "may overtop" },
      { color: FLOOD_BAND_COLOR["observed-overflow"], label: "observed overflow" },
    ],
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
    id: "wind",
    name: "Wind field",
    description: "Open-Meteo · current 10 m model",
    defaultOn: false,
    softUninstall: true,
    layers: [WIND_ORIGIN_LAYER, WIND_LAYER],
    install: async (map) => { await installWind(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [WIND_ORIGIN_LAYER, WIND_LAYER], false),
    legend: [
      { color: "#60a5fa", label: "< 10 km/h" },
      { color: "#22d3ee", label: "10–20 km/h" },
      { color: "#facc15", label: "20–30 km/h" },
      { color: "#fb923c", label: "30–40 km/h" },
      { color: "#ef4444", label: "40 km/h+" },
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
    id: "aerosol",
    name: "Satellite aerosol",
    description: "NASA MODIS · daily regional AOD",
    defaultOn: false,
    softUninstall: true,
    layers: [AEROSOL_LAYER],
    install: async (map) => { installAerosol(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [AEROSOL_LAYER], false),
  },
  {
    id: "flood",
    name: "Labs · schematic flood envelope",
    description: "Schematic 2011-style corridors",
    defaultOn: false,
    softUninstall: true,
    layers: [FLOOD_FILL, FLOOD_LINE],
    install: async (map) => { await installFlood(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [FLOOD_FILL, FLOOD_LINE], false),
    legend: [
      { color: "#1d4ed8", label: "high severity corridor" },
      { color: "#3d74c4", label: "medium" },
      { color: "#93c5fd", label: "low / drain pocket" },
    ],
  },
  {
    id: 'hii-history',
    name: 'HII seasonal flood history',
    description: '2005–2021 satellite history · calendar month · not live',
    defaultOn: false,
    softUninstall: true,
    layers: [HII_HISTORY_LAYER],
    install: async map => {
      try {
        await installHiiHistory(map,setLayerStatus,event=>pointLayersOwningClick(map,event.point).some(f=>f.layer.id!==HII_HISTORY_LAYER));
      } catch(error) {
        setLayerStatus('hii-history','unavailable · historical dataset could not be loaded');
        throw error;
      }
      ensureStackOrder(map);
    },
    uninstall: map => {
      setLayersVisible(map,[HII_HISTORY_LAYER],false);
      document.getElementById('hii-history-controls').hidden=true;
    },
    legend: [
      {color:'#88a9b5',label:'highest reported band: low (1–3 events in 17 years)'},
      {color:'#c8a565',label:'highest reported band: medium (4–8)'},
      {color:'#a95b70',label:'highest reported band: high (9–17)'},
      {color:'#666966',label:'no record for this month — unassessed, not dry'},
    ],
  },
  {
    id: "flood-sensors",
    name: "Flood sensors",
    description: "FloodDash · judged water-level gauges",
    defaultOn: true,
    softUninstall: true,
    layers: [FLOOD_SENSOR_HALO_LAYER, FLOOD_SENSOR_LAYER],
    install: async (map) => { await installFloodSensors(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeFloodSensorPopup();
      setLayersVisible(map, [FLOOD_SENSOR_HALO_LAYER, FLOOD_SENSOR_LAYER], false);
    },
    legend: [
      { color: FLOOD_BAND_COLOR.safe, label: "safe" },
      { color: FLOOD_BAND_COLOR.watch, label: "watch" },
      { color: FLOOD_BAND_COLOR.prepare, label: "prepare" },
      { color: FLOOD_BAND_COLOR.evacuate, label: "near bank" },
      { color: FLOOD_BAND_COLOR["overflow-imminent"], label: "may overtop" },
      { color: FLOOD_BAND_COLOR["observed-overflow"], label: "observed overflow" },
      { color: FLOOD_BAND_COLOR["no-signal"], label: "hollow = silent gauge, no data" },
    ],
  },
  {
    id: "bkk-rain",
    name: "BKK rain gauges",
    description: "ThaiWater · 133 Bangkok gauges · 24h mm",
    defaultOn: false,
    softUninstall: true,
    layers: [RAIN_STATION_HALO_LAYER, RAIN_STATION_LAYER],
    install: async (map) => { await installRainStations(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeRainStationPopup();
      setLayersVisible(map, [RAIN_STATION_HALO_LAYER, RAIN_STATION_LAYER], false);
    },
    legend: [
      { color: "#7d8a9a", label: "0 mm / 24h" },
      { color: "#7eb6ff", label: "light (0–10 mm)" },
      { color: "#facc15", label: "moderate (10–35 mm)" },
      { color: "#f97316", label: "heavy (35–90 mm)" },
      { color: "#dc2626", label: "very heavy (≥90 mm)" },
    ],
  },
  {
    id: "flood-roads",
    name: "Flood reports · last 24 h",
    description: "Residents · iTIC · BMA DDS · gauges — on the street",
    defaultOn: true,
    softUninstall: true,
    layers: FLOOD_ROAD_LAYERS,
    install: async (map) => { await installFloodRoads(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeFloodRoadPopup();
      stopFloodWaterMotion();
      stop72hSimulation();
      setLayersVisible(map, FLOOD_ROAD_LAYERS, false);
    },
    legend: [
      { color: "#38bdf8", label: "water on road (scattered)" },
      { color: "#facc15", label: "concentrated flood (alert)" },
      { color: "#f97316", label: "deep water (knee to waist)" },
      { color: "#dc2626", label: "crisis hotspot (chest / severe)" },
      { color: FLOOD_CLOSED_COLOR, label: "red casing = reported closed / impassable" },
    ],
  },
  {
    id: "flood-incidents",
    name: "Flood incident heat",
    description: "Longdo/iTIC · Bangkok Post · BMA DDS · flood gauges",
    defaultOn: false,
    softUninstall: true,
    layers: [INCIDENT_HEAT_LAYER, INCIDENT_DOT_LAYER],
    install: async (map) => { await installIncidents(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeIncidentPopup();
      setLayersVisible(map, [INCIDENT_HEAT_LAYER, INCIDENT_DOT_LAYER], false);
    },
    legend: [
      { color: "#7eb6ff", label: "low density (citizen reports)" },
      { color: "#facc15", label: "medium (BMA road reports)" },
      { color: "#f97316", label: "high (city-event flood / roadclosed)" },
      { color: "#dc2626", label: "extreme (gauge in prepare+ / overflow)" },
    ],
  },
  {
    id: "canal-gates",
    name: "Canal gates",
    description: "BMA DDS bulletin · gate level vs critical",
    defaultOn: false,
    softUninstall: true,
    layers: [CANAL_GATE_HALO_LAYER, CANAL_GATE_LAYER],
    install: async (map) => { await installCanalGates(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeCanalGatePopup();
      setLayersVisible(map, [CANAL_GATE_HALO_LAYER, CANAL_GATE_LAYER], false);
    },
    legend: [
      { color: "#dc2626", label: "critical (วิกฤติ) · at/over bank" },
      { color: "#f97316", label: "warning (เตือนภัย)" },
      { color: "#facc15", label: "normal · within bounds" },
      { color: "#11120f", label: "hollow = gate we couldn't anchor" },
    ],
  },
  {
    id: "roads-flooded",
    name: "Flooded roads (DDS)",
    description: "BMA DDS dated road reports · district-anchored",
    defaultOn: false,
    softUninstall: true,
    layers: [ROADS_FLOODED_HALO_LAYER, ROADS_FLOODED_LAYER],
    install: async (map) => { await installRoadsFlooded(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeRoadsFloodedPopup();
      setLayersVisible(map, [ROADS_FLOODED_HALO_LAYER, ROADS_FLOODED_LAYER], false);
    },
    legend: [
      { color: "#dc2626", label: "severe · ≥30 cm depth" },
      { color: "#f97316", label: "moderate · 15–30 cm" },
      { color: "#facc15", label: "shallow · <15 cm" },
      { color: "#7d8a9a", label: "clearance not recorded" },
      { color: "#1a1c14", label: "dimmed · reported cleared" },
    ],
  },
  {
    id: "emergency-points",
    name: "Emergency points",
    description: "FloodDash · news-anchored · news headlines in popup",
    defaultOn: false,
    softUninstall: true,
    layers: [EMERGENCY_HALO_LAYER, EMERGENCY_LAYER],
    install: async (map) => { await installEmergency(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeEmergencyPopup();
      setLayersVisible(map, [EMERGENCY_HALO_LAYER, EMERGENCY_LAYER], false);
    },
    legend: [
      { color: "#dc2626", label: "high (news + sensor) · confirmed" },
      { color: "#f97316", label: "watch (sensor only or single mention)" },
      { color: "#facc15", label: "reported · needs confirmation" },
    ],
  },
  {
    id: "dams",
    name: "Major dams (upstream)",
    description: "FloodDash · Chao Phraya + nearby basins · storage %",
    defaultOn: false,
    softUninstall: true,
    layers: [DAM_HALO_LAYER, DAM_LAYER],
    install: async (map) => { await installDams(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeDamPopup();
      setLayersVisible(map, [DAM_HALO_LAYER, DAM_LAYER], false);
    },
    legend: [
      { color: "#dc2626", label: "≥90% · about to spill" },
      { color: "#f97316", label: "80–89% · filling fast" },
      { color: "#facc15", label: "60–79% · normal high" },
      { color: "#7eb6ff", label: "<60% · normal" },
      { color: "#7d8a9a", label: "absent · no recent reading" },
    ],
  },
  {
    // Shown and hidden through the "cctv" Cameras switch; no toggle of its own.
    id: "maholan-cctv",
    name: "More CCTV cameras",
    description: "Maholan aggregator · BKK + 30 km halo · ~1,700 cameras · agency feeds + user-added (unvetted)",
    defaultOn: false,
    softUninstall: true,
    layers: [MAHOLAN_CCTV_HALO_LAYER, MAHOLAN_CCTV_LAYER],
    install: async (map) => { await installMaholanCctv(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeMaholanCctvPopup();
      setLayersVisible(map, [MAHOLAN_CCTV_HALO_LAYER, MAHOLAN_CCTV_LAYER], false);
    },
    legend: [
      { color: "#dc2626", label: "live HLS stream (Pak Kret, Pathum Thani, …)" },
      { color: "#f97316", label: "live MJPEG / animated" },
      { color: "#7d8a9a", label: "offline · snapshot refresh failed" },
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
    id: "canal-gauges",
    name: "Canal gauges",
    description: "BKK FloodWatch · 199 BMA canal gauges + HII · forecasts",
    defaultOn: false,
    softUninstall: true,
    layers: [CANAL_LAYER],
    install: async (map) => { await installCanalGauges(map); ensureStackOrder(map); },
    uninstall: (map) => { closeCanalPopup(); setLayersVisible(map, [CANAL_LAYER], false); },
    legend: [
      { color: FLOOD_BAND_COLOR["observed-overflow"], label: "over the bank (measured)" },
      { color: FLOOD_BAND_COLOR.evacuate, label: "near the bank" },
      { color: FLOOD_BAND_COLOR.watch, label: "watch" },
      { color: WATERWAY_CALM, label: "room to spare" },
      { color: FLOOD_BAND_COLOR["no-signal"], label: "no recent reading" },
    ],
  },
  {
    id: "airbnb",
    name: "Airbnb listings",
    description: "Inside Airbnb · Bangkok snapshot",
    defaultOn: false,
    softUninstall: true,
    layers: [AIRBNB_HEAT_LAYER, AIRBNB_LAYER],
    install: async (map) => { await installAirbnb(map); ensureStackOrder(map); },
    uninstall: (map) => {
      closeAirbnbPopup();
      setLayersVisible(map, [AIRBNB_HEAT_LAYER, AIRBNB_LAYER], false);
    },
    legend: [
      { color: "#f472b6", label: "entire home / apartment" },
      { color: "#fbcfe8", label: "private room" },
      { color: "#a8a29e", label: "shared or hotel room" },
      { color: "#4b4d45", label: "faint = no review in the last 12 months" },
    ],
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
      { color: "#3d74c4", label: "School", category: "school" },
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
    if (layer.id === ROOF_LAYER) continue;
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
  try { reapplyMassingFilters(map); } catch {}
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
      try { installHeritageRoofs(map, data); } catch (error) {
        console.warn('Heritage roofs unavailable; original buildings retained:', error);
      }
      // Real Thai forms for the classified buildings, from the same footprints.
      try { installHeritageForms(map, data.features ?? []); } catch (error) {
        console.warn('Heritage forms unavailable; original buildings retained:', error);
      }
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
  uninstallHeritageForms(map);
  uninstallHeritageRoofs(map);
  if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) try { map.removeLayer(RATTANAKOSIN_BUILDINGS_LAYER); } catch {}
  if (map.getSource(HERITAGE_DETAIL_SOURCE)) try { map.removeSource(HERITAGE_DETAIL_SOURCE); } catch {}
  if (map.getSource(BKKX_RATTANAKOSIN_PMTILES_LAYER)) try { map.removeSource(BKKX_RATTANAKOSIN_PMTILES_LAYER); } catch {}
}

// Landmark extrusions — Victory Monument + Rattanakosin heritage
// height overrides. Loaded as GeoJSON so we don't need a PMTiles
// re-bake / R2 upload to correct OSM's flat 9 m defaults.
// The city forms are rebuilt when the view settles, not on every frame. The
// refresh machinery lives with the layer that owns the state, because it has
// to know whether the buildings have actually arrived yet.
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
        minzoom: 10.5,
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
// Current 10 m wind field (Open-Meteo forecast model)
// ─────────────────────────────────────────────────────────────────

function windOffset(lon, lat, bearingDeg, distanceDeg) {
  const bearing = bearingDeg * Math.PI / 180;
  const latScale = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  return [
    lon + Math.sin(bearing) * distanceDeg / latScale,
    lat + Math.cos(bearing) * distanceDeg,
  ];
}

function windArrowGeometry(lon, lat, speedKmh, directionDeg) {
  // Meteorological direction says where wind comes FROM. The arrow points
  // downwind, hence +180°. Length is deliberately capped: it communicates
  // relative speed without implying an exact trajectory between grid cells.
  const flowBearing = (directionDeg + 180) % 360;
  const length = 0.010 + Math.min(60, Math.max(0, speedKmh)) / 60 * 0.024;
  const end = windOffset(lon, lat, flowBearing, length);
  const headLength = length * 0.30;
  const left = windOffset(end[0], end[1], flowBearing + 150, headLength);
  const right = windOffset(end[0], end[1], flowBearing - 150, headLength);
  return {
    type: "MultiLineString",
    coordinates: [
      [[lon, lat], end],
      [left, end],
      [right, end],
    ],
  };
}

function windCompass(directionDeg) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round((((directionDeg % 360) + 360) % 360) / 22.5) % 16];
}

function weatherNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return NaN;
  if (typeof value === "string" && !value.trim()) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

async function fetchWindGrid() {
  const lats = [];
  const lons = [];
  for (let i = 0; i < 6; i++) {
    const lat = (13.49 + (14.10 - 13.49) * (i / 5)).toFixed(3);
    for (let j = 0; j < 6; j++) {
      lats.push(lat);
      lons.push((100.30 + (100.95 - 100.30) * (j / 5)).toFixed(3));
    }
  }
  const url = `${WIND_API}?latitude=${lats.join(",")}&longitude=${lons.join(",")}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=UTC`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  const locations = Array.isArray(data) ? data : data ? [data] : [];
  const features = [];
  let capturedAt = null;
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const speed = weatherNumber(loc?.current?.wind_speed_10m);
    const direction = weatherNumber(loc?.current?.wind_direction_10m);
    const gust = weatherNumber(loc?.current?.wind_gusts_10m);
    const lat = Number(loc?.latitude ?? lats[i]);
    const lon = Number(loc?.longitude ?? lons[i]);
    if (![speed, direction, lat, lon].every(Number.isFinite)) continue;
    if (speed < 0 || direction < 0 || direction > 360) continue;
    capturedAt ||= loc?.current?.time ?? null;
    features.push({
      type: "Feature",
      properties: {
        speedKmh: speed,
        gustKmh: Number.isFinite(gust) && gust >= 0 ? gust : null,
        directionDeg: direction,
        directionLabel: windCompass(direction),
        flowBearing: (direction + 180) % 360,
        capturedAt: loc?.current?.time ?? null,
        observationLevel: "10 m model field",
      },
      geometry: windArrowGeometry(lon, lat, speed, direction),
    });
  }
  if (!features.length) return null;
  return { type: "FeatureCollection", features, _capturedAt: capturedAt };
}

async function installWind(map) {
  const geojson = await fetchWindGrid();
  if (!geojson) {
    setLayerStatus("wind", "unavailable · Open-Meteo failed");
    return;
  }
  if (!map.getSource(WIND_SOURCE)) {
    map.addSource(WIND_SOURCE, {
      type: "geojson",
      data: geojson,
      attribution: "Wind model © Open-Meteo",
    });
  } else {
    try { map.getSource(WIND_SOURCE).setData(geojson); } catch {}
  }

  if (!map.getLayer(WIND_ORIGIN_LAYER)) {
    map.addLayer({
      id: WIND_ORIGIN_LAYER,
      type: "circle",
      source: WIND_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 3.2],
        "circle-color": "#f8fafc",
        "circle-stroke-color": "#0f172a",
        "circle-stroke-width": 1,
        "circle-opacity": 0.9,
      },
    });
  }
  if (!map.getLayer(WIND_LAYER)) {
    map.addLayer({
      id: WIND_LAYER,
      type: "line",
      source: WIND_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "interpolate", ["linear"], ["get", "speedKmh"],
          0, "#60a5fa",
          10, "#22d3ee",
          20, "#facc15",
          30, "#fb923c",
          40, "#ef4444",
        ],
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          9, ["interpolate", ["linear"], ["get", "speedKmh"], 0, 1, 40, 2.4],
          14, ["interpolate", ["linear"], ["get", "speedKmh"], 0, 2, 40, 4.2],
        ],
        "line-opacity": 0.92,
      },
    });
    map.on("click", WIND_LAYER, (event) => {
      const properties = event.features?.[0]?.properties;
      if (!properties) return;
      const speed = Number(properties.speedKmh).toFixed(1);
      const gust = properties.gustKmh == null ? "—" : Number(properties.gustKmh).toFixed(1);
      const direction = Number(properties.directionDeg).toFixed(0);
      new maplibregl.Popup({ closeButton: true, maxWidth: "250px" })
        .setLngLat(event.lngLat)
        .setHTML(`<strong>10 m wind</strong><br>${speed} km/h from ${properties.directionLabel} (${direction}°)<br>Gust ${gust} km/h<br><small>Open-Meteo model · not a street sensor</small>`)
        .addTo(map);
    });
    map.on("mouseenter", WIND_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", WIND_LAYER, () => { map.getCanvas().style.cursor = ""; });
  } else {
    setLayersVisible(map, [WIND_ORIGIN_LAYER, WIND_LAYER], true);
  }

  const speeds = geojson.features.map((feature) => feature.properties.speedKmh);
  const gusts = geojson.features.map((feature) => feature.properties.gustKmh).filter(Number.isFinite);
  const average = (speeds.reduce((sum, value) => sum + value, 0) / speeds.length).toFixed(1);
  const maxGust = gusts.length ? Math.max(...gusts).toFixed(1) : "—";
  const when = geojson._capturedAt ? ` · ${geojson._capturedAt.replace("T", " ")} UTC` : "";
  setLayerStatus("wind", `Open-Meteo · ${geojson.features.length} cells · avg ${average} · gust ${maxGust} km/h${when}`);
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
// NASA GIBS aerosol optical depth (regional satellite observation)
// ─────────────────────────────────────────────────────────────────

function aerosolObservationDate() {
  const date = new Date(Date.now() - AEROSOL_DATA_LAG_DAYS * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function installAerosol(map) {
  if (map.getLayer(AEROSOL_LAYER)) {
    setLayersVisible(map, [AEROSOL_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const observationDate = aerosolObservationDate();
  const tiles = [
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth/default/${observationDate}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
  ];
  if (!map.getSource(AEROSOL_SOURCE)) {
    try {
      map.addSource(AEROSOL_SOURCE, {
        type: "raster",
        tiles,
        tileSize: 256,
        maxzoom: AEROSOL_MAX_ZOOM,
        attribution: "Aerosol optical depth © NASA EOSDIS GIBS · MODIS MAIAC",
      });
    } catch (error) {
      console.warn("Aerosol source failed:", error);
      setLayerStatus("aerosol", "unavailable · NASA GIBS failed");
      return;
    }
  }
  try {
    map.addLayer({
      id: AEROSOL_LAYER,
      type: "raster",
      source: AEROSOL_SOURCE,
      paint: {
        "raster-opacity": state.overlayOpacity,
        "raster-fade-duration": 180,
      },
    });
    setLayerStatus("aerosol", `NASA MODIS · ${observationDate} · regional AOD, not PM2.5`);
    applyOverlayCompositing(map);
  } catch (error) {
    console.warn("Aerosol layer failed:", error);
    setLayerStatus("aerosol", "unavailable · layer failed");
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
      <a href="${escapeHtml(safeHttpUrl(a.url))}" target="_blank" rel="noreferrer">${escapeHtml(a.title)}</a>
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
    const res = await fetch(FLOOD_DATA_URL, { cache: "force-cache", signal: AbortSignal.timeout(10000) });
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

/** "13 min" · "2.5 h" · "11 days" — age in words a person reads at a glance. */
function ageWords(min) {
  if (min == null || !Number.isFinite(min)) return "unknown age";
  if (min < 90) return `${Math.max(0, Math.round(min))} min`;
  if (min < 48 * 60) return `${(min / 60).toFixed(min < 600 ? 1 : 0)} h`;
  return `${Math.round(min / 1440)} days`;
}

/** Minutes since an ISO time, or null. */
function minutesSince(iso) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? (Date.now() - t) / 60000 : null;
}

function openFloodSensorPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeFloodSensorPopup();
  // FloodDash measured the age when the atlas last relayed it; add the time since.
  const relayAge = minutesSince(state.flood?.fetchedAt) ?? 0;
  const age = p.ageMin != null && p.ageMin !== "null" ? Number(p.ageMin) + relayAge : null;
  const silent = p.silent === true || p.silent === "true";
  const color = p.levelColor || FLOOD_BAND_COLOR["no-signal"];
  const num = (v) => (v == null || v === "null" || v === "" ? null : Number(v));
  const wl = num(p.waterlevelMsl);
  const bank = num(p.minBank);
  const free = num(p.freeboardM);
  const rise = num(p.riseMH);
  const levelLine = wl == null
    ? "No water level reported"
    : `Water ${wl.toFixed(2)} m MSL${bank != null ? ` · bank ${bank.toFixed(2)} m` : ""}`;
  const freeLine = free == null
    ? ""
    : free < 0
      ? `${Math.abs(free).toFixed(2)} m over the bank`
      : `${free.toFixed(2)} m below the bank`;
  const riseLine = rise == null || silent ? "" : `${rise >= 0 ? "rising" : "falling"} ${Math.abs(rise * 100).toFixed(1)} cm/h`;
  const fresh = silent
    ? `Silent for ${ageWords(age)}${p.lastBandEn && p.lastBandEn !== "null" ? ` — last said ${p.lastBandEn}` : ""}`
    : p.confidence === "stale"
      ? `Last reading ${ageWords(age)} ago — stale`
      : `Read ${ageWords(age)} ago`;
  const html = `
    <div class="atlas-cctv-card atlas-gauge-card">
      <p class="atlas-cctv-kicker">Water gauge · FloodDash</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name || "Water level station")}</strong>
      ${p.nameTh && p.nameTh !== p.name ? `<p class="atlas-cctv-status">${escapeHtml(p.nameTh)}</p>` : ""}
      <p class="atlas-gauge-band${silent ? " is-silent" : ""}" style="--band:${escapeHtml(color)}">
        <span class="atlas-gauge-swatch" aria-hidden="true"></span>
        <span>${escapeHtml(p.bandEn || "NO DATA")}${p.bandTh ? ` · ${escapeHtml(p.bandTh)}` : ""}</span>
      </p>
      <p class="atlas-gauge-action">${escapeHtml(p.action || "")}</p>
      ${p.actionTh ? `<p class="atlas-gauge-action" lang="th">${escapeHtml(p.actionTh)}</p>` : ""}
      <p class="atlas-cctv-status">${escapeHtml(levelLine)}</p>
      ${freeLine || riseLine ? `<p class="atlas-cctv-status">${escapeHtml([freeLine, riseLine].filter(Boolean).join(" · "))}</p>` : ""}
      <p class="atlas-cctv-status">${escapeHtml(fresh)}</p>
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.waterwayName || p.river || p.basin || "")}</span>
        <span>${escapeHtml(p.agency || "")}</span>
      </div>
      <p class="atlas-gauge-duty">${escapeHtml(FLOOD_DUTY)}</p>
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

// ─────────────────────────────────────────────────────────────────
// BKK provincial rain stations — 133 ThaiWater v3 gauges
// (provinces/rain24?province_code=10). Static asset served from
// /bkk-rain-stations.geojson; rebuilt by scripts/build-bkk-rain-stations.py.
// Color is driven by the `severity` property when present, falls back
// to a linear mm gradient so a future refresh without severity still
// paints correctly.
// ─────────────────────────────────────────────────────────────────

function closeRainStationPopup() {
  if (state.rainStationPopup) {
    try { state.rainStationPopup.remove(); } catch {}
    state.rainStationPopup = null;
  }
}

function openRainStationPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeRainStationPopup();
  const mm = p.rain_24h_mm != null ? Number(p.rain_24h_mm).toFixed(1) : "—";
  const mm1 = p.rain_1h_mm != null ? Number(p.rain_1h_mm).toFixed(1) : null;
  const sevLabel = {
    none: "no rain",
    light: "light",
    moderate: "moderate",
    heavy: "heavy",
    "very-heavy": "very heavy",
    unknown: "unknown",
  }[p.severity] || "unknown";
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">BKK rain gauge · ${escapeHtml(sevLabel)}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name || "Rain station")}</strong>
      <p class="atlas-cctv-status">24h · <strong>${escapeHtml(mm)} mm</strong>${
        mm1 != null ? " · 1h " + escapeHtml(mm1) + " mm" : ""
      }</p>
      <p class="atlas-cctv-status">${escapeHtml(p.amphoe || "")}${
        p.tumbon ? " · " + escapeHtml(p.tumbon) : ""
      }</p>
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.agency || "HII")}</span>
        <span>${escapeHtml(p.observed_at || "")}</span>
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
  state.rainStationPopup = popup;
}

function wireRainStationInteractions(map) {
  if (map.__bkkxRainStationWired) return;
  map.__bkkxRainStationWired = true;
  map.on("click", RAIN_STATION_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openRainStationPopup(map, feature);
  });
  map.on("mouseenter", RAIN_STATION_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", RAIN_STATION_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installRainStations(map) {
  if (map.getLayer(RAIN_STATION_LAYER)) {
    setLayersVisible(map, [RAIN_STATION_HALO_LAYER, RAIN_STATION_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(RAIN_STATION_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("bkk-rain", "unavailable · rain-station file failed");
    return;
  }
  if (!map.getSource(RAIN_STATION_SOURCE)) {
    try {
      map.addSource(RAIN_STATION_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("BKK rain stations source failed:", error);
      setLayerStatus("bkk-rain", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(RAIN_STATION_SOURCE).setData(geojson); } catch {}
  }
  try {
    map.addLayer({
      id: RAIN_STATION_HALO_LAYER,
      type: "circle",
      source: RAIN_STATION_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 9, 13, 14, 16, 18],
        "circle-color": RAIN_STATION_COLOR,
        "circle-opacity": 0.22,
        "circle-stroke-width": 0,
      },
    });
    map.addLayer({
      id: RAIN_STATION_LAYER,
      type: "circle",
      source: RAIN_STATION_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 13, 5, 16, 7],
        "circle-color": RAIN_STATION_COLOR,
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.2,
        "circle-opacity": 0.95,
      },
    });
    wireRainStationInteractions(map);
    setLayerStatus(
      "bkk-rain",
      `ThaiWater v3 · ${geojson.featureCount ?? geojson.features.length} BKK gauges · 24h mm`,
    );
  } catch (error) {
    console.warn("BKK rain stations layer failed:", error);
    setLayerStatus("bkk-rain", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Flood incident heat — MapLibre heatmap painted from /api/water/bkk/incidents
// (city-events + news-events + BMA DDS road reports + flood-sensors in
// prepare/evacuate bands). The endpoint returns each point with a `weight`
// property in [0, ~1.2]; the heatmap-renderer expression uses that.
// Beyond zoom 14, we fade the heatmap and switch to discrete dots so
// individual reports become clickable.
// ─────────────────────────────────────────────────────────────────

function closeIncidentPopup() {
  if (state.incidentPopup) {
    try { state.incidentPopup.remove(); } catch {}
    state.incidentPopup = null;
  }
}

function openIncidentPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeIncidentPopup();
  const sevBadge = {
    flood: "#dc2626",
    roadclosed: "#dc2626",
    rain: "#7eb6ff",
    trafficjam: "#facc15",
    news_flood: "#facc15",
    dds_road: "#f97316",
    sensor_band: "#dc2626",
  }[p.kind] || "#facc15";
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker" style="color:${sevBadge}">${escapeHtml(String(p.source ?? "").toUpperCase())} · ${escapeHtml(p.kind ?? "")}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.title ?? p.venueName ?? "Incident")}</strong>
      <p class="atlas-cctv-status">weight ${Number(p.weight ?? 0).toFixed(2)} ${
        p.mentions ? "· " + escapeHtml(String(p.mentions)) + " mentions" : ""
      } ${
        p.reports ? "· " + escapeHtml(String(p.reports)) + " reports" : ""
      }</p>
      ${
        p.max_depth_cm ? `<p class="atlas-cctv-status">max depth ${escapeHtml(String(p.max_depth_cm))} cm</p>` : ""
      }
      ${
        p.band_label_en ? `<p class="atlas-cctv-status">band: ${escapeHtml(p.band_label_en)}</p>` : ""
      }
      ${
        p.district_name_en ? `<p class="atlas-cctv-status">${escapeHtml(p.district_name_en)}</p>` : ""
      }
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.reporter ?? "")}</span>
        <span>${escapeHtml(p.observed_at ?? p.latest_at ?? p.latest_flooded_at ?? "")}</span>
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
  state.incidentPopup = popup;
}

function wireIncidentInteractions(map) {
  if (map.__bkkxIncidentWired) return;
  map.__bkkxIncidentWired = true;
  map.on("click", INCIDENT_DOT_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openIncidentPopup(map, feature);
  });
  map.on("mouseenter", INCIDENT_DOT_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", INCIDENT_DOT_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

// ─────────────────────────────────────────────────────────────────
// Flooded roads now — heat of every signal, the streets that carry reports
// drawn as moving water, closures cased in red, fresh reports rippling.
// ─────────────────────────────────────────────────────────────────

function closeFloodRoadPopup() {
  if (state.floodRoadPopup) {
    try { state.floodRoadPopup.remove(); } catch {}
    state.floodRoadPopup = null;
  }
}

function floodRoadsAgeText(payload) {
  const age = minutesSince(payload?.fetchedAt);
  const failed = Object.entries(payload?.sources ?? {}).filter(([, s]) => !s.ok || s.error);
  const relay = age == null ? "relay age unknown" : `relay ${ageWords(age)} ago`;
  return `${relay} · reports in last ${payload?.windowH ?? 24} h${failed.length ? ` · check source: ${failed.map(([name]) => name).join(", ")}` : ""}`;
}

function openFloodRoadPopup(map, event) {
  const f = event.features?.[0];
  if (!f) return;
  const p = f.properties || {};
  const num = (v) => Number(v) || 0;
  const bits = [];
  if (num(p.traffy)) bits.push(`${num(p.traffy)} resident report${num(p.traffy) > 1 ? "s" : ""} (Traffy Fondue)`);
  if (num(p.itic)) bits.push(`${num(p.itic)} road report${num(p.itic) > 1 ? "s" : ""} (iTIC)`);
  if (num(p.dds)) bits.push(`named in BMA DDS's flooded-road list`);
  const closed = p.closed === true || p.closed === "true";
  const depth = p.depthEn && p.depthEn !== "null"
    ? `Deepest reported: ${p.depthEn}${p.depthTh && p.depthTh !== "null" ? ` · ${p.depthTh}` : ""}`
    : "Depth not given";
  const latestAgo = minutesSince(p.latest);
  // The nearest traffic camera, so the report can be checked against a live view.
  let cam = null;
  const liveJoin = p.road ? state.floodCamJoin?.byRoadLive?.get(p.road) : null;
  if (liveJoin) {
    cam = { id: liveJoin.camId, d: liveJoin.distM };
  } else {
    for (const c of state.cctvGeojson?.features ?? []) {
      const d = pointToLineMeters(c.geometry.coordinates, f.geometry.coordinates);
      if (d <= FLOOD_CAM_LIVE_MAX_M && c.properties?.id && (!cam || d < cam.d)) cam = { id: c.properties.id, d: Math.round(d) };
    }
  }
  const html = `
    <div class="atlas-cctv-card atlas-gauge-card">
      <p class="atlas-cctv-kicker">Flooded road · reported</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.road && p.road !== "null" ? p.road : "Unnamed road")}</strong>
      ${closed ? `<p class="atlas-gauge-band" style="--band:${FLOOD_CLOSED_COLOR}"><span class="atlas-gauge-swatch" aria-hidden="true"></span><span>REPORTED CLOSED / IMPASSABLE</span></p>` : ""}
      <p class="atlas-gauge-action">${escapeHtml(depth)}</p>
      <p class="atlas-cctv-status">${escapeHtml(bits.join(" · "))}</p>
      <p class="atlas-cctv-status">Latest ${latestAgo == null ? "time unknown" : `${ageWords(latestAgo)} ago`}</p>
      <p class="atlas-cctv-status">${p.placed === "road-name"
        ? "DDS gives a road name, not a place: the whole named road in this khet is marked."
        : "Marked ~100 m either side of each report — not a surveyed flood extent."}</p>
      ${cam ? `<button type="button" class="atlas-cctv-live-link" data-cam="${escapeHtml(cam.id)}">Live camera ${cam.d} m away →</button>` : ""}
      <p class="atlas-gauge-duty">Depth is the reporter's word, not a measurement · ${escapeHtml(FLOOD_DUTY)}</p>
    </div>`;
  closeFloodRoadPopup();
  state.floodRoadPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "300px", className: "atlas-cctv-popup", offset: 10 })
    .setLngLat(event.lngLat)
    .setHTML(html)
    .addTo(map);
  state.floodRoadPopup.getElement()?.querySelector("[data-cam]")?.addEventListener("click", async () => {
    closeFloodRoadPopup();
    await flyToCctvFromRoad(map, cam.id);
  });
}

async function loadFloodRoadsPayload() {
  const payload = await fetchJson(FLOOD_ROADS_URL);
  if (payload?.tool === "flood-roads") {
    state.floodRoads = payload;
    // The street ↔ camera join needs the iTIC list even with the Cameras
    // switch off; read it quietly, draw nothing.
    if (!state.cctvGeojson) {
      const cams = await fetchLiveCctv();
      if (cams && !state.cctvGeojson) state.cctvGeojson = cams;
    }
    computeFloodCamJoin();
    renderSituation(payload);
  }
  // The honest cross-reference is derived from the same data plus the
  // flood-sensor feed; refresh both at the same cadence so the
  // Nearby-gauge context uses the same report snapshot.
  loadRoadsXref();
  return state.floodRoads;
}

async function installFloodRoads(map) {
  const payload = await loadFloodRoadsPayload();
  if (!payload) {
    setLayerStatus("flood-roads", "unavailable · no reading yet — not an all-clear");
    return;
  }
  for (const [id, data] of [[FLOOD_ROADS_SOURCE, payload.roads], [FLOOD_HEAT_SOURCE, payload.heat]]) {
    const src = map.getSource(id);
    if (src) src.setData(data);
    else map.addSource(id, { type: "geojson", data });
  }
  if (!map.getLayer(FLOOD_HEAT_LAYER)) {
    map.addLayer({
      id: FLOOD_HEAT_LAYER,
      type: "heatmap",
      source: FLOOD_HEAT_SOURCE,
      paint: {
        // Multi-tier crisis ramp: water-blue -> alert-amber -> warning-orange -> crisis-crimson -> white core
        "heatmap-weight": ["interpolate", ["linear"], ["get", "w"], 0, 0, 0.1, 0.25, 0.5, 0.6, 2.0, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1.15, 14, 1.85],
        "heatmap-radius": ["interpolate", ["exponential", 1.6], ["zoom"], 10, 20, 13, 42, 16, 95],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,0,0,0)",
          0.12, "rgba(56,189,248,0.40)",  // water blue (scattered runoff)
          0.32, "rgba(250,204,21,0.65)",  // alert amber (concentrated water)
          0.58, "rgba(249,115,22,0.82)",  // warning orange (deep water)
          0.80, "rgba(220,38,38,0.92)",   // crisis red (waist / chest)
          1.0,  "rgba(255,245,245,0.98)", // hot danger core
        ],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.95, 15, 0.65, 17, 0.4],
      },
    });
  }
  if (!map.getLayer(FLOOD_RIPPLE_LAYER)) {
    map.addLayer({
      id: FLOOD_RIPPLE_LAYER,
      type: "circle",
      source: FLOOD_HEAT_SOURCE,
      filter: ["==", ["get", "fresh"], true],
      paint: {
        "circle-radius": 6,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#bfefff",
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0,
        "circle-pitch-alignment": "map",
      },
    });
  }
  // Zoom must stay the outermost input, so each variant is built whole.
  const width = (k = 1, add = 0) => ["interpolate", ["exponential", 1.6], ["zoom"],
    10, ["+", add, ["*", k, ["+", 2.4, ["*", 3, ["get", "score"]]]]],
    14, ["+", add, ["*", k, ["+", 5, ["*", 6, ["get", "score"]]]]],
    17, ["+", add, ["*", k, ["+", 8, ["*", 10, ["get", "score"]]]]]];
  if (!map.getLayer(FLOOD_ROAD_CLOSED_LAYER)) {
    map.addLayer({
      id: FLOOD_ROAD_CLOSED_LAYER,
      type: "line",
      source: FLOOD_ROADS_SOURCE,
      filter: ["==", ["get", "closed"], true],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": FLOOD_CLOSED_COLOR, "line-width": width(1, 4), "line-opacity": 0.95 },
    });
  }
  if (!map.getLayer(FLOOD_ROAD_LAYER)) {
    map.addLayer({
      id: FLOOD_ROAD_LAYER,
      type: "line",
      source: FLOOD_ROADS_SOURCE,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": FLOOD_DEPTH_COLOR,
        "line-width": width(),
        "line-opacity": ["interpolate", ["linear"], ["get", "score"], 0, 0.45, 0.6, 0.95],
        "line-color-transition": { duration: 1500, delay: 0 },
        "line-width-transition": { duration: 1500, delay: 0 },
        "line-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    map.on("click", FLOOD_ROAD_LAYER, (e) => { e.originalEvent?.stopPropagation?.(); openFloodRoadPopup(map, e); });
    map.on("mouseenter", FLOOD_ROAD_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", FLOOD_ROAD_LAYER, () => { map.getCanvas().style.cursor = ""; });
  }
  if (!map.getLayer(FLOOD_ROAD_FLOW_LAYER)) {
    map.addLayer({
      id: FLOOD_ROAD_FLOW_LAYER,
      type: "line",
      source: FLOOD_ROADS_SOURCE,
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: {
        "line-color": "#e8fbff",
        "line-width": width(0.45),
        "line-opacity": 0.8,
        "line-dasharray": FLOW_DASH_STEPS[0],
      },
    });
  }
  setLayersVisible(map, FLOOD_ROAD_LAYERS, true);
  renderFloodStreets(payload);
  const c = payload.counts;
  setLayerStatus("flood-roads", `${c.stretches} road stretches · ${c.closed} closed · ${floodRoadsAgeText(payload)}`);
  startFloodWaterMotion(map);
  wireSimulationControls(map);
}

function stopFloodWaterMotion() {
  if (state.floodMotion) {
    cancelAnimationFrame(state.floodMotion);
    state.floodMotion = null;
  }
}

/** Water that moves: the heat breathes like water sloshing, dashes run along
 *  flooded streets, fresh reports ripple. Illustrative motion — not a
 *  measured current. Off for reduced motion and while the tab is hidden. */
function startFloodWaterMotion(map) {
  if (state.floodMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  let last = 0;
  let step = 0;
  const tick = (now) => {
    state.floodMotion = requestAnimationFrame(tick);
    // Also paused while the full-screen camera wall covers the map: repainting
    // an unseen map competed with the wall's video decoding.
    if (document.hidden || document.body.classList.contains("atlas-wall-open") || now - last < 70 || !map.getLayer(FLOOD_HEAT_LAYER)) return;
    if (map.getLayoutProperty(FLOOD_HEAT_LAYER, "visibility") === "none") return;
    last = now;
    const slosh = Math.sin(now / 1400);
    const drift = Math.sin(now / 2300 + 1.3);
    map.setPaintProperty(FLOOD_HEAT_LAYER, "heatmap-radius",
      ["interpolate", ["exponential", 1.6], ["zoom"], 10, 20 * (1 + 0.1 * slosh), 13, 42 * (1 + 0.12 * slosh), 16, 95 * (1 + 0.12 * slosh)]);
    map.setPaintProperty(FLOOD_HEAT_LAYER, "heatmap-intensity",
      ["interpolate", ["linear"], ["zoom"], 10, 1.15 * (1 + 0.12 * drift), 14, 1.85 * (1 + 0.12 * drift)]);
    step = (step + 1) % FLOW_DASH_STEPS.length;
    map.setPaintProperty(FLOOD_ROAD_FLOW_LAYER, "line-dasharray", FLOW_DASH_STEPS[step]);
    const phase = (now % 2600) / 2600;
    map.setPaintProperty(FLOOD_RIPPLE_LAYER, "circle-radius", ["interpolate", ["linear"], ["zoom"], 10, 4 + phase * 14, 15, 8 + phase * 40]);
    map.setPaintProperty(FLOOD_RIPPLE_LAYER, "circle-stroke-opacity", 0.85 * (1 - phase));
  };
  state.floodMotion = requestAnimationFrame(tick);
}

/** Fly to where the reported water is — the middle 80% of lit stretches. */
function flyToFloodedRoads() {
  const map = state.map;
  if (!map) return;
  const pts = [];
  for (const f of state.floodRoads?.roads?.features ?? []) {
    if ((f.properties?.score ?? 0) < 0.25) continue;
    const c = f.geometry.coordinates;
    pts.push(c[Math.floor(c.length / 2)]);
  }
  if (pts.length < 3) {
    map.flyTo({ center: [100.6, 13.78], zoom: 11.6, pitch: 45, bearing: -12, essential: true });
    return;
  }
  const q = (arr, t) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(t * (arr.length - 1))))];
  const lngs = pts.map((p) => p[0]).sort((a, b) => a - b);
  const lats = pts.map((p) => p[1]).sort((a, b) => a - b);
  map.fitBounds([[q(lngs, 0.1), q(lats, 0.1)], [q(lngs, 0.9), q(lats, 0.9)]], {
    padding: 50, pitch: 45, bearing: -12, maxZoom: 14, duration: 1600, essential: true,
  });
}

// ─────────────────────────────────────────────────────────────────
// Illustrative 72-hour scenario tour (30-second run). Scripted phases and
// visual heat modulation have no calibrated forecast or road-depth model.
// ─────────────────────────────────────────────────────────────────
const SIM_DURATION_MS = 30_000;
const SIM_HOURS = 72;

const SIM_PHASES = [
  {
    fromH: 0,
    toH: 14,
    phase: "Phase 1 (0h–14h) · Convective rain pulses over Eastern Bangkok",
    detail: "Scenario: intense local rain on saturated ground could increase ponding in eastern Bangkok. This tour has no live rain-to-road forecast.",
    passability: "Unknown",
    electrocution: "Unknown",
    depth: "Not calculated",
    roads: "Not calculated",
    river: "Not calculated",
    heatIntensity: 1.5,
    heatRadius: 1.15,
    camera: { center: [100.65, 13.76], zoom: 11.8, pitch: 45, bearing: -10 },
  },
  {
    fromH: 14,
    toH: 28,
    phase: "Phase 2 (14h–28h) · Illustrative high-tide constraint",
    detail: "Scenario: elevated river levels could constrain gravity drainage. Tide timing, gate operation and pump capacity are not calculated by this tour.",
    passability: "Unknown",
    electrocution: "Unknown",
    depth: "Not calculated",
    roads: "Not calculated",
    river: "Not calculated",
    heatIntensity: 2.0,
    heatRadius: 1.35,
    camera: { center: [100.54, 13.72], zoom: 12.0, pitch: 48, bearing: 15 },
  },
  {
    fromH: 28,
    toH: 52,
    phase: "Phase 3 (28h–52h) · Illustrative northern inflow",
    detail: "Scenario: increased upstream flow could raise pressure on riverside communities. Crest timing, discharge and overtopping are not predicted by this tour; consult the live gauges and FloodDash.",
    passability: "Unknown",
    electrocution: "Unknown",
    depth: "Not calculated",
    roads: "Not calculated",
    river: "Not calculated",
    heatIntensity: 2.3,
    heatRadius: 1.5,
    camera: { center: [100.49, 13.77], zoom: 12.2, pitch: 50, bearing: -25 },
  },
  {
    fromH: 52,
    toH: 72,
    phase: "Phase 4 (52h–72h) · Saturated eastern polder depression ponding",
    detail: "Scenario: low ground could retain runoff after rainfall subsides. Pump operation, local water depths and road clearance are not measured by this tour.",
    passability: "Unknown",
    electrocution: "Unknown",
    depth: "Not calculated",
    roads: "Not calculated",
    river: "Not calculated",
    heatIntensity: 1.75,
    heatRadius: 1.25,
    camera: { center: [100.66, 13.74], zoom: 11.6, pitch: 42, bearing: 5 },
  },
];

function updateSimHud(h, phase, progressPct) {
  const hourEl = document.getElementById("atlas-sim-hour");
  const dateEl = document.getElementById("atlas-sim-date");
  const progEl = document.getElementById("atlas-sim-progress");
  const phaseEl = document.getElementById("atlas-sim-phase");
  const detailEl = document.getElementById("atlas-sim-detail");
  const depthEl = document.getElementById("atlas-sim-metric-depth");
  const roadsEl = document.getElementById("atlas-sim-metric-roads");
  const riverEl = document.getElementById("atlas-sim-metric-river");
  const passEl = document.getElementById("atlas-sim-metric-pass");
  const electEl = document.getElementById("atlas-sim-metric-elect");

  if (hourEl) hourEl.textContent = `+${Math.round(h)}h`;
  if (dateEl) {
    dateEl.textContent = "Scenario time · illustrative";
  }
  document.getElementById("atlas-sim-progressbar")?.setAttribute("aria-valuenow", String(Math.round(h)));
  if (progEl) progEl.style.width = `${Math.min(100, Math.max(0, progressPct * 100))}%`;
  if (phaseEl) phaseEl.textContent = phase.phase;
  if (detailEl) detailEl.textContent = phase.detail;
  if (depthEl) depthEl.textContent = phase.depth;
  if (roadsEl) roadsEl.textContent = phase.roads;
  if (riverEl) riverEl.textContent = phase.river;
  if (passEl && phase.passability) passEl.textContent = phase.passability;
  if (electEl && phase.electrocution) electEl.textContent = phase.electrocution;
}

function start72hSimulation(map) {
  if (!map) map = state.map;
  if (!map) return;

  // Ensure flood preset is active
  if (!state.layerOn?.["flood-roads"]) {
    document.querySelector('#atlas-stack-presets [data-preset="flood"]')?.click();
  }
  document.getElementById("atlas-map")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const hud = document.getElementById("atlas-sim-hud");
  if (hud) hud.hidden = false;

  const toggleBtn = document.getElementById("atlas-sim-toggle");
  if (toggleBtn) toggleBtn.textContent = "Pause";

  stop72hSimulation(false); // Clean up previous loop if running

  state.simRunning = true;
  state.simPaused = false;
  state.simStartTime = performance.now();
  state.simElapsedBeforePause = 0;

  let lastCamIndex = -1;

  const simTick = (now) => {
    if (!state.simRunning) return;
    if (state.simPaused) {
      state.simFrame = requestAnimationFrame(simTick);
      return;
    }

    const elapsed = state.simElapsedBeforePause + (now - state.simStartTime);
    const progress = Math.min(1, elapsed / SIM_DURATION_MS);
    const currentHour = progress * SIM_HOURS;
    const phaseIndex = SIM_PHASES.findIndex((p) => currentHour >= p.fromH && currentHour <= p.toH);
    const phase = SIM_PHASES[phaseIndex >= 0 ? phaseIndex : SIM_PHASES.length - 1];

    updateSimHud(currentHour, phase, progress);

    // Dynamic map modulation for crisis simulation
    if (map.getLayer(FLOOD_HEAT_LAYER)) {
      const pulse = Math.sin((now / 1000) * Math.PI);
      const intensityMod = phase.heatIntensity * (1 + 0.12 * pulse);
      const radiusMod = phase.heatRadius * (1 + 0.08 * pulse);

      map.setPaintProperty(FLOOD_HEAT_LAYER, "heatmap-intensity",
        ["interpolate", ["linear"], ["zoom"], 10, 1.15 * intensityMod, 14, 1.85 * intensityMod]);
      map.setPaintProperty(FLOOD_HEAT_LAYER, "heatmap-radius",
        ["interpolate", ["exponential", 1.6], ["zoom"], 10, 20 * radiusMod, 13, 42 * radiusMod, 16, 95 * radiusMod]);
    }

    // Camera move on phase boundary (smooth glide)
    if (phaseIndex !== lastCamIndex && phase.camera) {
      lastCamIndex = phaseIndex;
      map.flyTo({
        center: phase.camera.center,
        zoom: phase.camera.zoom,
        pitch: phase.camera.pitch,
        bearing: phase.camera.bearing,
        duration: 3500,
        essential: true,
      });
    }

    if (progress >= 1) {
      state.simRunning = false;
      const toggle = document.getElementById("atlas-sim-toggle");
      if (toggle) toggle.textContent = "Replay ▶";
      const phaseEl = document.getElementById("atlas-sim-phase");
      if (phaseEl) phaseEl.textContent = "Illustrative scenario complete";
      return;
    }

    state.simFrame = requestAnimationFrame(simTick);
  };

  state.simFrame = requestAnimationFrame(simTick);
}

function pause72hSimulation() {
  if (!state.simRunning) return;
  state.simPaused = true;
  state.simElapsedBeforePause += (performance.now() - state.simStartTime);
  const toggleBtn = document.getElementById("atlas-sim-toggle");
  if (toggleBtn) toggleBtn.textContent = "Resume ▶";
}

function resume72hSimulation() {
  if (!state.simRunning) return;
  state.simPaused = false;
  state.simStartTime = performance.now();
  const toggleBtn = document.getElementById("atlas-sim-toggle");
  if (toggleBtn) toggleBtn.textContent = "Pause";
}

function toggle72hSimulation(map) {
  if (!state.simRunning) {
    start72hSimulation(map);
  } else if (state.simPaused) {
    resume72hSimulation();
  } else {
    pause72hSimulation();
  }
}

function stop72hSimulation(hideHud = true) {
  if (state.simFrame) {
    cancelAnimationFrame(state.simFrame);
    state.simFrame = null;
  }
  state.simRunning = false;
  state.simPaused = false;
  state.simElapsedBeforePause = 0;
  if (hideHud) {
    const hud = document.getElementById("atlas-sim-hud");
    if (hud) hud.hidden = true;
  }
  // Restore normal live heat intensities
  const map = state.map;
  if (map && map.getLayer(FLOOD_HEAT_LAYER)) {
    try {
      map.setPaintProperty(FLOOD_HEAT_LAYER, "heatmap-intensity",
        ["interpolate", ["linear"], ["zoom"], 10, 1.15, 14, 1.85]);
      map.setPaintProperty(FLOOD_HEAT_LAYER, "heatmap-radius",
        ["interpolate", ["exponential", 1.6], ["zoom"], 10, 20, 13, 42, 16, 95]);
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────
// Chao Phraya Basin Hydraulic Profile & Tidal Lock Cross-Section
// Connects live water levels (m MSL) from Gulf of Thailand to Bang Sai C.29A
// ─────────────────────────────────────────────────────────────────

const BASIN_KEY_STATIONS = [
  {
    key: "paknam",
    name: "Pak Nam · Gulf Datum",
    nameTh: "ปากน้ำ (สมุทรปราการ)",
    km: "km 0",
    x: 65,
    regex: /ปากน้ำ|สมุทรปราการ|C\.53|Pak Nam/i,
    nominalBank: 2.0,
    nominalMsl: 0.85,
  },
  {
    key: "memorial",
    name: "Memorial Bridge",
    nameTh: "สะพานพระพุทธยอดฟ้า (C.4)",
    km: "km 48",
    x: 195,
    regex: /สะพานพระพุทธยอดฟ้า|สะพานพุทธ|Memorial|C\.4\b/i,
    nominalBank: 2.8,
    nominalMsl: 1.45,
  },
  {
    key: "nonthaburi",
    name: "Nonthaburi Pier",
    nameTh: "ท่าน้ำนนทบุรี (C.13)",
    km: "km 65",
    x: 335,
    regex: /ท่าน้ำนนทบุรี|นนทบุรี|Nonthaburi|C\.13\b/i,
    nominalBank: 2.6,
    nominalMsl: 1.75,
  },
  {
    key: "bangsai",
    name: "Bang Sai Gateway",
    nameTh: "บางไทร (C.29A)",
    km: "km 112",
    x: 475,
    regex: /บางไทร|Bang Sai|C\.29A|C\.29\b/i,
    nominalBank: 3.4,
    nominalMsl: 2.30,
  },
];

function renderBasinProfile(featuresOrGauges = []) {
  const hud = document.getElementById("atlas-basin-hud");
  if (!hud) return;
  const list = Array.isArray(featuresOrGauges) ? featuresOrGauges : [];
  
  const stations = BASIN_KEY_STATIONS.map((st) => {
    const match = list.find((item) => {
      const p = item.properties || item;
      const title = `${p.name || ""} ${p.nameTh || ""} ${p.id || ""}`;
      return st.regex.test(title);
    });
    const p = match?.properties || match || {};
    const liveWl = p.waterlevelMsl != null && p.waterlevelMsl !== "null" && p.waterlevelMsl !== "" ? Number(p.waterlevelMsl) : null;
    const liveBank = p.minBank != null && p.minBank !== "null" && p.minBank !== "" ? Number(p.minBank) : null;
    const free = p.freeboardM != null && p.freeboardM !== "null" && p.freeboardM !== "" ? Number(p.freeboardM) : null;
    const rise = p.riseMH != null && p.riseMH !== "null" && p.riseMH !== "" ? Number(p.riseMH) : null;
    const band = p.band || "safe";
    const bandEn = p.bandEn || "SAFE";
    
    return {
      ...st,
      wl: liveWl != null ? liveWl : st.nominalMsl,
      isLive: liveWl != null,
      bank: liveBank != null ? liveBank : st.nominalBank,
      freeboard: free != null ? free : (liveBank != null && liveWl != null ? liveBank - liveWl : st.nominalBank - st.nominalMsl),
      rise,
      band,
      bandEn,
    };
  });

  const getY = (val) => Math.max(15, Math.min(130, 120 - val * 25));

  const pts = stations.map((s) => ({ x: s.x, y: getY(s.wl) }));
  const bankPts = stations.map((s) => ({ x: s.x, y: getY(s.bank) }));

  let waterPath = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cx = (p0.x + p1.x) / 2;
    waterPath += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
  }

  const waterAreaPath = `${waterPath} L ${pts[pts.length - 1].x} 120 L ${pts[0].x} 120 Z`;

  let bankPath = `M ${bankPts[0].x} ${bankPts[0].y}`;
  for (let i = 1; i < bankPts.length; i++) {
    bankPath += ` L ${bankPts[i].x} ${bankPts[i].y}`;
  }

  const waterLineEl = document.getElementById("atlas-basin-water-line");
  const waterAreaEl = document.getElementById("atlas-basin-water-area");
  const bankLineEl = document.getElementById("atlas-basin-bank-line");
  const markersEl = document.getElementById("atlas-basin-markers");
  const badgeEl = document.getElementById("atlas-basin-lock-badge");
  const metricsEl = document.getElementById("atlas-basin-metrics");

  if (waterLineEl) waterLineEl.setAttribute("d", waterPath);
  if (waterAreaEl) waterAreaEl.setAttribute("d", waterAreaPath);
  if (bankLineEl) bankLineEl.setAttribute("d", bankPath);

  const mem = stations.find((s) => s.key === "memorial");
  const pak = stations.find((s) => s.key === "paknam");
  const isLock = (mem?.wl >= 1.50) || (pak?.wl >= 1.40);

  if (badgeEl) {
    if (isLock) {
      badgeEl.textContent = "Tidal Lock · น้ำทะเลหนุน";
      badgeEl.className = "atlas-basin-badge is-lock";
    } else {
      badgeEl.textContent = "Gravity Flow · ระบายน้ำปกติ";
      badgeEl.className = "atlas-basin-badge is-flow";
    }
  }

  if (markersEl) {
    markersEl.innerHTML = stations.map((s, idx) => {
      const p = pts[idx];
      const dotColor = s.wl >= s.bank ? "#ef4444" : s.wl >= 1.8 ? "#f59e0b" : "#38bdf8";
      return `
        <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${dotColor}" stroke="#11120f" stroke-width="1.5" />
        <text x="${p.x}" y="${Math.max(16, p.y - 8)}" text-anchor="middle" fill="${dotColor}" font-family="var(--font-mono)" font-size="9" font-weight="700">
          +${s.wl.toFixed(2)}m
        </text>
        <text x="${p.x}" y="138" text-anchor="middle" fill="#a4a69b" font-family="var(--font-mono)" font-size="8">
          ${s.km}
        </text>
      `;
    }).join("");
  }

  if (metricsEl) {
    metricsEl.innerHTML = stations.map((s) => {
      const freeText = s.freeboard != null
        ? (s.freeboard < 0 ? `${Math.abs(s.freeboard).toFixed(2)}m over bank` : `${s.freeboard.toFixed(2)}m to bank`)
        : "bank crest unknown";
      const isOver = s.freeboard != null && s.freeboard < 0;
      const riseText = s.rise != null ? (s.rise >= 0 ? ` ↑+${(s.rise * 100).toFixed(0)}cm/h` : ` ↓${(s.rise * 100).toFixed(0)}cm/h`) : "";
      return `
        <div class="atlas-basin-card">
          <p class="atlas-basin-card-km">${s.km}${s.isLive ? "" : " · nominal"}</p>
          <strong class="atlas-basin-card-name" title="${escapeHtml(s.nameTh)}">${escapeHtml(s.name)}</strong>
          <p class="atlas-basin-card-val">+${s.wl.toFixed(2)} <small style="font-size:9px">m MSL</small><span style="font-size:10px;color:var(--muted)">${riseText}</span></p>
          <p class="atlas-basin-card-free${isOver ? " is-over" : ""}">${freeText}</p>
        </div>
      `;
    }).join("");
  }
}

function toggleBasinProfile() {
  const hud = document.getElementById("atlas-basin-hud");
  if (!hud) return;
  const isHidden = hud.hidden;
  hud.hidden = !isHidden;
  if (isHidden) {
    if (!hud.querySelector("#atlas-basin-metrics")?.children?.length) {
      renderBasinProfile(state.flood?.gauges || []);
    }
    document.getElementById("atlas-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function closeBasinProfile() {
  const hud = document.getElementById("atlas-basin-hud");
  if (hud) hud.hidden = true;
}

function wireSimulationControls(map) {
  if (map.__bkkxSimWired) return;
  map.__bkkxSimWired = true;

  document.getElementById("atlas-flood-verdict-sim")?.addEventListener("click", () => {
    start72hSimulation(map);
  });
  document.getElementById("atlas-sim-toggle")?.addEventListener("click", () => {
    toggle72hSimulation(map);
  });
  document.getElementById("atlas-sim-close")?.addEventListener("click", () => {
    stop72hSimulation(true);
  });
  document.getElementById("atlas-flood-verdict-profile")?.addEventListener("click", () => {
    toggleBasinProfile();
  });
  document.getElementById("atlas-basin-close")?.addEventListener("click", () => {
    closeBasinProfile();
  });
  document.getElementById("atlas-sim-progressbar")?.addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.simElapsedBeforePause = pct * SIM_DURATION_MS;
    state.simStartTime = performance.now();
    if (!state.simRunning) {
      start72hSimulation(map);
    }
  });
}

/** "Streets with flood reports": named roads, most reported first. */
function renderFloodStreets(payload) {
  const list = document.getElementById("atlas-water-streets");
  if (!list || !payload) return;
  const byRoad = new Map();
  for (const f of payload.roads?.features ?? []) {
    const p = f.properties;
    if (!p.road || p.placed === "road-name") continue;
    const c = f.geometry.coordinates;
    const e = byRoad.get(p.road) ?? { road: p.road, n: 0, depth: 0, depthEn: null, latest: 0, score: 0, at: c[Math.floor(c.length / 2)] };
    e.n += p.n;
    if (p.depth > e.depth) { e.depth = p.depth; e.depthEn = p.depthEn; }
    e.latest = Math.max(e.latest, Date.parse(p.latest) || 0);
    // score is already decayed by age, so the sum ranks what is wet now.
    if (p.score > (e.best ?? 0)) { e.best = p.score; e.at = c[Math.floor(c.length / 2)]; }
    e.score += p.score;
    byRoad.set(p.road, e);
  }
  const top = [...byRoad.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  const head = document.getElementById("atlas-water-streets-head");
  if (head) head.textContent = `Streets with flood reports · ${payload.counts.stretches} stretches · ${floodRoadsAgeText(payload)}`;
  list.innerHTML = top.length
    ? top.map((e) => `
      <li>
        <button type="button" class="atlas-water-row" data-lng="${e.at[0]}" data-lat="${e.at[1]}" style="--band:#45bdff">
          <span class="atlas-gauge-swatch" aria-hidden="true"></span>
          <span class="atlas-water-row-main">
            <strong>${e.n} report${e.n > 1 ? "s" : ""}${e.depthEn ? ` · to ${escapeHtml(e.depthEn)}` : ""}</strong> ${escapeHtml(e.road)}
            <small>latest ${ageWords(minutesSince(new Date(e.latest).toISOString()))} ago</small>
          </span>
        </button>
      </li>`).join("")
    : `<li class="atlas-water-empty">No street reports in the last 24 h — which is not the same as dry streets.</li>`;
}

async function refreshFloodRoadsLayer() {
  const map = state.map;
  if (!map?.getSource(FLOOD_ROADS_SOURCE)) return;
  const payload = await loadFloodRoadsPayload();
  if (!payload) return;
  map.getSource(FLOOD_ROADS_SOURCE).setData(payload.roads);
  map.getSource(FLOOD_HEAT_SOURCE)?.setData(payload.heat);
  renderFloodStreets(payload);
  setLayerStatus("flood-roads", `${payload.counts.stretches} road stretches · ${payload.counts.closed} closed · ${floodRoadsAgeText(payload)}`);
}

function closeAirbnbPopup() {
  if (state.airbnbPopup) {
    try { state.airbnbPopup.remove(); } catch {}
    state.airbnbPopup = null;
  }
}

function openAirbnbPopup(map, event) {
  const f = event.features?.[0];
  if (!f) return;
  const p = f.properties || {};
  const n = (v) => (v == null || v === "null" || v === "" ? null : Number(v));
  const price = n(p.p), mn = n(p.mn), av = n(p.av), h = n(p.h);
  const snapshot = state.airbnbSnapshot ?? "";
  const rows = [
    price != null ? `฿${price.toLocaleString("en-US")} a night (asking price on ${snapshot})` : "Price not listed",
    mn != null ? `Minimum stay ${mn} night${mn > 1 ? "s" : ""}${mn >= 30 ? " · monthly" : ""}` : null,
    `${n(p.n12) ?? 0} review${n(p.n12) === 1 ? "" : "s"} in the last 12 months · ${n(p.n) ?? 0} in all${p.lr && p.lr !== "null" ? ` · last ${escapeHtml(p.lr)}` : ""}`,
    av != null ? `Open ${av} of the next 365 days` : null,
    h != null ? (h > 1 ? `Host runs ${h} listings in Bangkok` : "Host's only listing") : null,
    String(p.lic) === "1" ? "Licence number given" : "No licence number given",
  ].filter(Boolean);
  closeAirbnbPopup();
  state.airbnbPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "300px", className: "atlas-cctv-popup", offset: 8 })
    .setLngLat(f.geometry.coordinates)
    .setHTML(`
      <div class="atlas-cctv-card">
        <p class="atlas-cctv-kicker" style="color:#f472b6">Airbnb listing</p>
        <strong class="atlas-cctv-title">${escapeHtml(AIRBNB_ROOM[p.r] ?? "Listing")}</strong>
        ${rows.map((r) => `<p class="atlas-cctv-status">${escapeHtml(r)}</p>`).join("")}
        <p class="atlas-gauge-duty">Inside Airbnb, ${escapeHtml(snapshot)} · CC BY 4.0 · place shifted up to ~150 m by Airbnb · a listing is not proof the room is let</p>
      </div>`)
    .addTo(map);
}

function closeCanalPopup() {
  if (state.canalPopup) { try { state.canalPopup.remove(); } catch {} state.canalPopup = null; }
}

const CANAL_STATUS = { critical: "OVER THE BANK", warning: "NEAR THE BANK", watch: "WATCH", normal: "ROOM TO SPARE", unknown: "NO RECENT READING" };

/** A forecast row, only as strong as flood2026 says it is. */
function canalForecastLine(label, raw) {
  let c = null;
  try { c = raw && raw !== "null" ? JSON.parse(raw) : null; } catch {}
  if (!c) return null;
  if (c.method === "persistence") return `${label}: no model beats “no change” at this gauge — read the measured trend`;
  const cm = (v) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} cm`;
  const range = c.likely ? ` (likely ${cm(c.likely[0])} to ${cm(c.likely[1])})` : "";
  const tag = c.proven === false ? " · not yet confirmed" : "";
  return `${label}: ${c.dir}${c.median != null ? `, ${cm(c.median)}` : ""}${range}${tag}`;
}

function openCanalPopup(map, e) {
  const f = e.features?.[0];
  if (!f) return;
  const p = f.properties || {};
  const n = (v) => (v == null || v === "null" || v === "" ? null : Number(v));
  const pct = n(p.pctBank), free = n(p.freeboardM), o24 = n(p.observed24Cm), age = n(p.ageMin);
  const lines = [
    pct != null ? `${pct}% of the bank height${free != null ? ` · ${free >= 0 ? `${free.toFixed(2)} m below the bank` : `${Math.abs(free).toFixed(2)} m over it`}` : ""}` : null,
    o24 != null ? `Last 24 h: ${o24 >= 0 ? "rose" : "fell"} ${Math.abs(o24)} cm` : null,
    canalForecastLine("Next 24 h", p.change24),
    canalForecastLine("Next 48 h", p.change48),
    p.bankChance24 && p.bankChance24 !== "null" ? `Chance of reaching the bank: ${p.bankChance24} in 24 h · ${p.bankChance48} in 48 h` : null,
    age != null ? `Read ${ageWords(age + (minutesSince(state.canalFetchedAt) ?? 0))} ago · ${p.agency ?? ""}` : null,
  ].filter(Boolean);
  closeCanalPopup();
  state.canalPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "310px", className: "atlas-cctv-popup", offset: 8 })
    .setLngLat(f.geometry.coordinates)
    .setHTML(`<div class="atlas-cctv-card atlas-gauge-card">
      <p class="atlas-cctv-kicker">Canal gauge · ${escapeHtml(p.code ?? "")}</p>
      <strong class="atlas-cctv-title" lang="th">${escapeHtml(p.nameTh ?? "")}</strong>
      ${p.river && p.river !== "null" ? `<p class="atlas-cctv-status" lang="th">${escapeHtml(p.river)}${p.amphoe && p.amphoe !== "null" ? ` · ${escapeHtml(p.amphoe)}` : ""}</p>` : ""}
      <p class="atlas-gauge-band" style="--band:${escapeHtml(p.color ?? "#6b6d63")}"><span class="atlas-gauge-swatch" aria-hidden="true"></span><span>${escapeHtml(CANAL_STATUS[p.status] ?? p.status ?? "")}</span></p>
      ${lines.map((l) => `<p class="atlas-cctv-status">${escapeHtml(l)}</p>`).join("")}
      <p class="atlas-gauge-duty">A gauge measures the canal against its bank, not a street · BKK FloodWatch (flood.autobahn.bot, MIT) · ${escapeHtml(FLOOD_DUTY)}</p>
    </div>`)
    .addTo(map);
}

async function installCanalGauges(map) {
  const gj = await fetchJson(CANAL_URL);
  if (!gj?.features?.length) { setLayerStatus("canal-gauges", "unavailable · no BKK FloodWatch reading — not an all-clear"); return; }
  state.canalFetchedAt = gj.fetchedAt;
  const src = map.getSource(CANAL_SOURCE);
  if (src) src.setData(gj); else map.addSource(CANAL_SOURCE, { type: "geojson", data: gj });
  if (!map.getLayer(CANAL_LAYER)) {
    map.addLayer({
      id: CANAL_LAYER,
      type: "circle",
      source: CANAL_SOURCE,
      layout: { "circle-sort-key": ["match", ["get", "status"], "critical", 4, "warning", 3, "watch", 2, "normal", 1, 0] },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "status"], "critical", 5, "warning", 4.5, 3.2], 15, ["match", ["get", "status"], "critical", 9, "warning", 8, 6]],
        "circle-color": ["case", ["==", ["get", "status"], "unknown"], "rgba(0,0,0,0)", ["get", "color"]],
        "circle-stroke-color": ["case", ["==", ["get", "status"], "unknown"], "#c8c9c0", "#0d0e0b"],
        "circle-stroke-width": 1.2,
      },
    });
    map.on("click", CANAL_LAYER, (e) => { e.originalEvent?.stopPropagation?.(); openCanalPopup(map, e); });
    map.on("mouseenter", CANAL_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", CANAL_LAYER, () => { map.getCanvas().style.cursor = ""; });
  }
  setLayersVisible(map, [CANAL_LAYER], true);
  const c = {};
  for (const f of gj.features) c[f.properties.status] = (c[f.properties.status] ?? 0) + 1;
  setLayerStatus("canal-gauges", `${gj.count} gauges · ${c.critical ?? 0} over the bank · ${c.warning ?? 0} near it · ${ageWords(gj.ageMin)} ago`);
}

async function installAirbnb(map) {
  if (!map.getSource(AIRBNB_SOURCE)) {
    const gj = await fetchJson(AIRBNB_URL);
    if (!gj?.features?.length) {
      setLayerStatus("airbnb", "unavailable · listing file failed");
      return;
    }
    state.airbnbSnapshot = gj.snapshot;
    map.addSource(AIRBNB_SOURCE, { type: "geojson", data: gj });
    const active = gj.features.filter((f) => f.properties.n12 > 0).length;
    setLayerStatus("airbnb", `${gj.count.toLocaleString("en-US")} listings · ${active.toLocaleString("en-US")} reviewed in the last year · Inside Airbnb ${gj.snapshot}`);
  }
  const recent = [">", ["get", "n12"], 0];
  if (!map.getLayer(AIRBNB_HEAT_LAYER)) {
    map.addLayer({
      id: AIRBNB_HEAT_LAYER,
      type: "heatmap",
      source: AIRBNB_SOURCE,
      maxzoom: 14,
      paint: {
        "heatmap-weight": ["case", recent, 1, 0.3],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.35, 13, 1],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 16],
        "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(0,0,0,0)", 0.2, "rgba(244,114,182,0.2)", 0.5, "rgba(244,114,182,0.45)", 0.8, "rgba(251,207,232,0.7)", 1, "rgba(255,240,248,0.85)"],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0.9, 14, 0],
      },
    });
  }
  if (!map.getLayer(AIRBNB_LAYER)) {
    map.addLayer({
      id: AIRBNB_LAYER,
      type: "circle",
      source: AIRBNB_SOURCE,
      minzoom: 12.5,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12.5, 1.8, 15, 3.5, 17, 5.5],
        "circle-color": ["match", ["get", "r"], "E", "#f472b6", "P", "#fbcfe8", "#a8a29e"],
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, 0, 13.5, ["case", recent, 0.9, 0.28]],
        "circle-stroke-width": 0,
      },
    });
    map.on("click", AIRBNB_LAYER, (e) => { e.originalEvent?.stopPropagation?.(); openAirbnbPopup(map, e); });
    map.on("mouseenter", AIRBNB_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", AIRBNB_LAYER, () => { map.getCanvas().style.cursor = ""; });
  }
  setLayersVisible(map, [AIRBNB_HEAT_LAYER, AIRBNB_LAYER], true);
}

async function installIncidents(map) {
  if (map.getLayer(INCIDENT_HEAT_LAYER)) {
    setLayersVisible(map, [INCIDENT_HEAT_LAYER, INCIDENT_DOT_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(INCIDENTS_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("flood-incidents", "unavailable · incident feed returned 0");
    return;
  }
  if (!map.getSource(INCIDENT_SOURCE)) {
    try {
      map.addSource(INCIDENT_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("BKK incidents source failed:", error);
      setLayerStatus("flood-incidents", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(INCIDENT_SOURCE).setData(geojson); } catch {}
  }
  try {
    map.addLayer({
      id: INCIDENT_HEAT_LAYER,
      type: "heatmap",
      source: INCIDENT_SOURCE,
      maxzoom: INCIDENT_HEAT_MAX_ZOOM,
      paint: {
        "heatmap-weight": ["coalesce", ["to-number", ["get", "weight"]], 0],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 13, 1.4],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 12, 13, 28, 14, 60],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.75, 14, 0.0],
        // Yellow (low density, citizen reports) → orange (medium, BMA) → red (high, gauges)
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0.00, "rgba(0,0,0,0)",
          0.15, "rgba(126,182,255,0.55)",
          0.35, "rgba(250,204,21,0.75)",
          0.60, "rgba(249,115,22,0.85)",
          1.00, "rgba(220,38,38,0.92)",
        ],
      },
    });
    map.addLayer({
      id: INCIDENT_DOT_LAYER,
      type: "circle",
      source: INCIDENT_SOURCE,
      minzoom: INCIDENT_HEAT_MAX_ZOOM,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 17, 9],
        "circle-color": [
          "match", ["get", "kind"],
          "flood", "#dc2626",
          "roadclosed", "#dc2626",
          "sensor_band", "#dc2626",
          "dds_road", "#f97316",
          "news_flood", "#facc15",
          "rain", "#7eb6ff",
          "trafficjam", "#facc15",
          "#facc15",
        ],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1,
        "circle-opacity": 0.95,
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireIncidentInteractions(map);
    const counts = geojson.counts ?? {};
    const total = counts.total ?? geojson.features.length;
    const bySource = counts.bySource ?? {};
    setLayerStatus(
      "flood-incidents",
      `ThaiWater/FloodDash/BMA DDS · ${total} incidents (city ${bySource.city ?? 0} · news ${bySource.news ?? 0} · dds ${bySource.dds ?? 0} · gauge ${bySource.sensor ?? 0})`,
    );
  } catch (error) {
    console.warn("BKK incidents layer failed:", error);
    setLayerStatus("flood-incidents", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Drainage infrastructure surfaces — three sibling layers that share
// the same install pattern (fetch /api/water/bkk/<x> → addSource → addLayer
// → wire popup). Each popup exposes the upstream metric in plain Thai +
// English so the atlas flood edition reads as the city's own briefing,
// not a foreigner's chart.
// ─────────────────────────────────────────────────────────────────

function closeCanalGatePopup() {
  if (state.canalGatePopup) {
    try { state.canalGatePopup.remove(); } catch {}
    state.canalGatePopup = null;
  }
}

function openCanalGatePopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeCanalGatePopup();
  const sevColor = p.severity === "critical" ? "#dc2626" : p.severity === "warning" ? "#f97316" : "#facc15";
  const levelMsl = p.level_msl != null ? `${Number(p.level_msl).toFixed(2)} m MSL` : "—";
  const criticalMsl = p.critical_msl != null ? `${Number(p.critical_msl).toFixed(2)} m MSL` : "—";
  const yesterdayMax = p.yesterday_max_msl != null ? `${Number(p.yesterday_max_msl).toFixed(2)} m MSL` : "—";
  const ratio = p.ratio != null ? `${Number(p.ratio).toFixed(2)}× critical` : "—";
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker" style="color:${sevColor}">BMA DDS BULLETIN · CANAL GATE</p>
      <strong class="atlas-cctv-title" lang="th">${escapeHtml(p.name || "")}</strong>
      <p class="atlas-cctv-status">now <strong>${levelMsl}</strong> · critical ${criticalMsl}</p>
      <p class="atlas-cctv-status">yesterday max ${yesterdayMax} · ${ratio}</p>
      <p class="atlas-cctv-status" lang="th">${escapeHtml(p.status_th || p.severity || "")}</p>
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.side || "")}</span>
        <span>${escapeHtml(p.observed_at || "")}</span>
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
  state.canalGatePopup = popup;
}

function wireCanalGateInteractions(map) {
  if (map.__bkkxCanalGateWired) return;
  map.__bkkxCanalGateWired = true;
  map.on("click", CANAL_GATE_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openCanalGatePopup(map, feature);
  });
  map.on("mouseenter", CANAL_GATE_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", CANAL_GATE_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installCanalGates(map) {
  if (map.getLayer(CANAL_GATE_LAYER)) {
    setLayersVisible(map, [CANAL_GATE_HALO_LAYER, CANAL_GATE_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(CANAL_GATES_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("canal-gates", "unavailable · DDS bulletin empty — not an all-clear");
    return;
  }
  if (!map.getSource(CANAL_GATE_SOURCE)) {
    try {
      map.addSource(CANAL_GATE_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("BKK canal-gates source failed:", error);
      setLayerStatus("canal-gates", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(CANAL_GATE_SOURCE).setData(geojson); } catch {}
  }
  try {
    map.addLayer({
      id: CANAL_GATE_HALO_LAYER,
      type: "circle",
      source: CANAL_GATE_SOURCE,
      minzoom: 9,
      filter: ["==", ["get", "severity"], "critical"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 12, 13, 20, 16, 26],
        "circle-color": "#dc2626",
        "circle-opacity": 0.28,
        "circle-stroke-width": 0,
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    map.addLayer({
      id: CANAL_GATE_LAYER,
      type: "circle",
      source: CANAL_GATE_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 4, 13, 6, 16, 9],
        "circle-color": [
          "match", ["get", "severity"],
          "critical", "#dc2626",
          "warning", "#f97316",
          "normal", "#facc15",
          "#facc15",
        ],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.2,
        "circle-opacity": 0.95,
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireCanalGateInteractions(map);
    const counts = geojson.counts ?? {};
    setLayerStatus(
      "canal-gates",
      `BMA DDS bulletin · ${counts.total ?? geojson.features.length} stations (critical ${counts.critical ?? 0} · warning ${counts.warning ?? 0} · normal ${counts.normal ?? 0})`,
    );
  } catch (error) {
    console.warn("BKK canal-gates layer failed:", error);
    setLayerStatus("canal-gates", "unavailable · layer failed");
  }
}

function closeRoadsFloodedPopup() {
  if (state.roadsFloodedPopup) {
    try { state.roadsFloodedPopup.remove(); } catch {}
    state.roadsFloodedPopup = null;
  }
}

function openRoadsFloodedPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeRoadsFloodedPopup();
  const sevColor = p.severity === "severe" ? "#dc2626"
    : p.severity === "moderate" ? "#f97316"
    : p.severity === "shallow" ? "#facc15"
    : p.severity === "cleared" ? "#1a1c14"
    : "#7d8a9a";
  const depth = p.depth_cm != null ? `${p.depth_cm} cm` : "—";
  const length = p.length_m != null ? `${p.length_m} m` : "—";
  const lanes = p.lanes || "—";
  const clearedAt = p.cleared_at ? `cleared ${escapeHtml(p.cleared_at)}` : "";

  // CCTV ↔ flooded-road join — steal from JK World (2026-09-27): if a
  // public CCTV sits within ~800 m of this road's anchor, surface a
  // "Live view" link. Clicking it flies the camera to the camera and
  // opens its popup (which then shows the live stream + this same
  // flood banner). The join is asymmetric — the camera popup also
  // reads this entry back — so once you know a road has a camera
  // you can navigate either direction.
  const roadKey = p.id ?? `${p.district}/${p.name}`;
  const camEntry = state.floodCamJoin?.byRoad?.get(roadKey) || null;
  const liveLink = camEntry
    ? `<button type="button" class="atlas-cctv-live-link" data-cam-id="${escapeHtml(camEntry.camId || "")}">
        <span aria-hidden="true">📹</span> Live view · ${escapeHtml(camEntry.distM)} m · ${escapeHtml((camEntry.camId || "iTIC").toString().slice(0, 24))}
        <small>opens camera on map</small>
      </button>`
    : "";

  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker" style="color:${sevColor}">BMA DDS · ROAD REPORT</p>
      <strong class="atlas-cctv-title" lang="th">${escapeHtml(p.name || "")}</strong>
      <p class="atlas-cctv-status" lang="th">${escapeHtml(p.district || "")} · ${escapeHtml(p.location || "")}</p>
      <p class="atlas-cctv-status">depth <strong>${depth}</strong> · length ${length} · ${escapeHtml(lanes)}</p>
      <p class="atlas-cctv-status">status: <strong>${escapeHtml(p.status || p.severity || "—")}</strong></p>
      ${liveLink}
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.flooded_at || "")}</span>
        <span>${clearedAt}</span>
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
  state.roadsFloodedPopup = popup;

  // Wire the live-view link after the popup is in the DOM. The link
  // flies to the camera, ensures the CCTV layer is on, waits for the
  // layer to finish installing (sample + live), then opens the CCTV
  // popup at the camera. The CCTV popup re-renders with the flood
  // banner because the join is already cached.
  if (camEntry) {
    const linkEl = popup.getElement()?.querySelector(".atlas-cctv-live-link");
    if (linkEl) {
      linkEl.addEventListener("click", async () => {
        await flyToCctvFromRoad(map, camEntry.camId);
      }, { once: true });
    }
  }
}

async function flyToCctvFromRoad(map, camId) {
  if (!map || !camId) return;
  // Ensure the CCTV layer is on (the user might be on the roads-flooded
  // layer only). loadCctvData installs + caches state.cctvGeojson and
  // recomputes the join — the CCTV popup then sees the flood banner.
  if (!state.layerOn.cctv) {
    await setLayerToggle(map, "cctv", true);
  }
  // Give the (re)install one tick to finish before we search the
  // geojson. setLayerToggle already awaited install, but defensive
  // belt-and-braces in case the live fallback is still pending.
  let tries = 0;
  while ((!state.cctvGeojson?.features?.length || !state.cctvGeojson.features.find((f) => f.properties?.id === camId)) && tries < 12) {
    await new Promise((r) => setTimeout(r, 150));
    tries++;
  }
  const feat = state.cctvGeojson?.features?.find((f) => f.properties?.id === camId);
  if (!feat) return;
  // Close the road popup and fly to the camera.
  closeRoadsFloodedPopup();
  map.flyTo({ center: feat.geometry.coordinates, zoom: 15, pitch: 55, essential: true });
  // Wait for flyTo's moveend so the popup anchors correctly on the
  // freshly settled camera.
  map.once("moveend", () => openCctvPopup(map, feat));
}

async function flyToRoadFromCctv(map, roadName) {
  if (!map || !roadName) return;
  closeCctvPopup();
  if (!state.layerOn["flood-roads"]) {
    await setLayerToggle(map, "flood-roads", true);
  }
  let tries = 0;
  while ((!state.floodRoads?.roads?.features?.length) && tries < 12) {
    await new Promise((r) => setTimeout(r, 150));
    tries++;
  }
  const feat = state.floodRoads?.roads?.features?.find((f) => f.properties?.road === roadName);
  if (!feat?.geometry?.coordinates?.length) return;
  const coords = feat.geometry.coordinates;
  const midPoint = coords[Math.floor(coords.length / 2)] || coords[0];
  map.flyTo({ center: midPoint, zoom: 15.5, pitch: 45, essential: true });
  map.once("moveend", () => {
    openFloodRoadPopup(map, { features: [feat], lngLat: { lng: midPoint[0], lat: midPoint[1] } });
  });
}

async function flyToDdsRoadFromCctv(map, roadKey) {
  if (!map || !roadKey) return;
  closeCctvPopup();
  if (!state.layerOn["roads-flooded"]) {
    await setLayerToggle(map, "roads-flooded", true);
  }
  let tries = 0;
  while ((!state.roadsFloodedGeojson?.features?.length) && tries < 12) {
    await new Promise((r) => setTimeout(r, 150));
    tries++;
  }
  const feat = state.roadsFloodedGeojson?.features?.find((f) => {
    const p = f.properties || {};
    const k = p.id ?? `${p.district}/${p.name}`;
    return k === roadKey || p.name === roadKey;
  });
  if (!feat?.geometry?.coordinates) return;
  const center = feat.geometry.coordinates;
  map.flyTo({ center, zoom: 15.5, pitch: 45, essential: true });
  map.once("moveend", () => {
    openRoadsFloodedPopup(map, feat);
  });
}

function wireRoadsFloodedInteractions(map) {
  if (map.__bkkxRoadsFloodedWired) return;
  map.__bkkxRoadsFloodedWired = true;
  map.on("click", ROADS_FLOODED_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openRoadsFloodedPopup(map, feature);
  });
  map.on("mouseenter", ROADS_FLOODED_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", ROADS_FLOODED_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installRoadsFlooded(map) {
  if (map.getLayer(ROADS_FLOODED_LAYER)) {
    setLayersVisible(map, [ROADS_FLOODED_HALO_LAYER, ROADS_FLOODED_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(ROADS_FLOODED_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("roads-flooded", "unavailable · DDS road feed empty — not an all-clear");
    return;
  }
  state.roadsFloodedGeojson = geojson;
  computeFloodCamJoin();
  if (!map.getSource(ROADS_FLOODED_SOURCE)) {
    try {
      map.addSource(ROADS_FLOODED_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("BKK roads-flooded source failed:", error);
      setLayerStatus("roads-flooded", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(ROADS_FLOODED_SOURCE).setData(geojson); } catch {}
  }
  try {
    // Halo: only the severe band (depth ≥ 30 cm) gets a halo so the eye
    // goes where the water actually blocks traffic.
    map.addLayer({
      id: ROADS_FLOODED_HALO_LAYER,
      type: "circle",
      source: ROADS_FLOODED_SOURCE,
      minzoom: 10,
      filter: ["==", ["get", "severity"], "severe"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 8, 13, 14, 16, 20],
        "circle-color": "#dc2626",
        "circle-opacity": 0.26,
        "circle-stroke-width": 0,
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    map.addLayer({
      id: ROADS_FLOODED_LAYER,
      type: "circle",
      source: ROADS_FLOODED_SOURCE,
      minzoom: 10,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 13, 5, 16, 8],
        "circle-color": [
          "match", ["get", "severity"],
          "severe", "#dc2626",
          "moderate", "#f97316",
          "shallow", "#facc15",
          "cleared", "#7d8a9a",
          "#7eb6ff", // unknown
        ],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.1,
        "circle-opacity": [
          "match", ["get", "severity"],
          "cleared", 0.45,
          0.92,
        ],
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireRoadsFloodedInteractions(map);
    const counts = geojson.counts ?? {};
    const total = counts.total ?? geojson.features.length;
    const byStatus = counts.byStatus ?? {};
    const bySev = counts.bySeverity ?? {};
    setLayerStatus(
      "roads-flooded",
      `BMA DDS · ${total} road reports (severe ${bySev.severe ?? 0} · moderate ${bySev.moderate ?? 0} · shallow ${bySev.shallow ?? 0} · cleared ${byStatus["reported-cleared"] ?? 0})`,
    );
  } catch (error) {
    console.warn("BKK roads-flooded layer failed:", error);
    setLayerStatus("roads-flooded", "unavailable · layer failed");
  }
}

function closeEmergencyPopup() {
  if (state.emergencyPopup) {
    try { state.emergencyPopup.remove(); } catch {}
    state.emergencyPopup = null;
  }
}

function openEmergencyPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeEmergencyPopup();
  const sevColor = p.band === "high" ? "#dc2626"
    : p.band === "watch" ? "#f97316"
    : "#facc15";
  const impacts = Array.isArray(p.impacts) ? p.impacts : [];
  const impactsHtml = impacts.length
    ? `<p class="atlas-cctv-status">Impacts: ${impacts.map((i) => `<span lang="th">${escapeHtml(i.th || "")}</span>${i.en ? ` (${escapeHtml(i.en)})` : ""}`).join(" · ")}</p>`
    : "";
  const news = Array.isArray(p.news) ? p.news : [];
  const newsHtml = news.length
    ? `<ul class="atlas-emergency-news">${news.map((n) => `<li><a href="${escapeHtml(safeHttpUrl(n.link || "#"))}" target="_blank" rel="noreferrer">${escapeHtml(n.title || "")}</a></li>`).join("")}</ul>`
    : `<p class="atlas-cctv-status">No public news yet for this point.</p>`;
  const tierLabel = p.tier === "confirmed" ? "confirmed" : p.tier === "sensor" ? "sensor only" : "reported";
  const html = `
    <div class="atlas-cctv-card atlas-emergency-card">
      <p class="atlas-cctv-kicker" style="color:${sevColor}">FLOODDASH · EMERGENCY · ${escapeHtml(String(tierLabel).toUpperCase())}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name || "Emergency")}</strong>
      <p class="atlas-cctv-status">${escapeHtml(p.province || "")}${p.depth_cm != null ? ` · depth ${p.depth_cm} cm` : ""} · score ${escapeHtml(String(p.score ?? "—"))} · ${escapeHtml(String(p.news_count ?? 0))} news</p>
      ${impactsHtml}
      <p class="atlas-eyebrow atlas-eyebrow-sub">News headlines</p>
      ${newsHtml}
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.latest_at || "")}</span>
      </div>
    </div>
  `;
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: "360px",
    className: "atlas-cctv-popup atlas-emergency-popup",
    anchor: "bottom",
    offset: 14,
  })
    .setLngLat([lng, lat])
    .setHTML(html)
    .addTo(map);
  state.emergencyPopup = popup;
}

function wireEmergencyInteractions(map) {
  if (map.__bkkxEmergencyWired) return;
  map.__bkkxEmergencyWired = true;
  map.on("click", EMERGENCY_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openEmergencyPopup(map, feature);
  });
  map.on("mouseenter", EMERGENCY_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", EMERGENCY_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

// ─────────────────────────────────────────────────────────────────
// CCTV ↔ flooded-road spatial join (2026-09-27) — stolen from JK
// World (world.tehx.dyndns.info), which pairs each BMA DDS flooded
// road card with the nearest live CCTV snapshot. The atlas has both
// pieces — 84 iTIC/Longdo cameras and 66 DDS dated reports — but the
// two layers never spoke. This join fixes that.
//
// Honest limits baked into the design:
//   - DDS road reports carry no per-point coords. The Worker anchors
//     them by road name first, then district centroid as a fallback.
//     Roads that fell back to the centroid will sit far from any
//     camera, so the join silently skips them — the camera list
//     stays short and trustworthy.
//   - Only "active" roads participate (severity ≠ cleared). Cleared
//     reports would mislead a reader into thinking the camera is
//     showing floodwater from yesterday's drain.
//   - 800 m Haversine cutoff: enough to catch a camera pointed at
//     the road, not enough to claim a relationship that doesn't
//     exist on the ground.
//
// Both directions are cached on state.floodCamJoin so popups read
// O(1).
// ─────────────────────────────────────────────────────────────────

const FLOOD_CAM_JOIN_MAX_M = 800;
// Live street reports (/api/flood/roads): a camera within this distance of a
// stretch reported in the last few hours can show what the report describes.
const FLOOD_CAM_LIVE_MAX_M = 300;
const FLOOD_CAM_LIVE_MAX_H = 6;
// A DDS record older than this says nothing about what the camera sees now.
const FLOOD_CAM_DDS_MAX_H = 24;

// Bounding box thresholds (~800 m and ~300 m at Bangkok ~13.75° N)
const BBOX_DEG_LAT = 800 / 110540; // ~0.0072°
const BBOX_DEG_LNG = 800 / 108150; // ~0.0074°
const BBOX_LIVE_LAT = 300 / 110540; // ~0.0027°
const BBOX_LIVE_LNG = 300 / 108150; // ~0.0028°

/** Metres from a point to a LineString (equirectangular; fine at city scale). */
function pointToLineMeters([lng, lat], coords) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - lng) * kx, ay = (coords[i][1] - lat) * ky;
    const bx = (coords[i + 1][0] - lng) * kx, by = (coords[i + 1][1] - lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function computeFloodCamJoin() {
  const byCam = new Map();
  const byRoad = new Map();
  const byCamLive = new Map();
  const byRoadLive = new Map();
  const roads = state.roadsFloodedGeojson?.features ?? [];
  const cams = state.cctvGeojson?.features;
  if (!Array.isArray(cams) || !cams.length) {
    state.floodCamJoin = { byCam, byRoad, byCamLive, byRoadLive, count: 0 };
    return;
  }
  // Live first: residents' and drivers' reports on a street (flood-roads).
  const liveCutoff = Date.now() - FLOOD_CAM_LIVE_MAX_H * 3_600_000;
  const stretches = (state.floodRoads?.roads?.features ?? [])
    .filter((f) => f.properties?.placed === "report" && Date.parse(f.properties.latest) >= liveCutoff);
  for (const cam of cams) {
    const at = cam.geometry?.coordinates;
    const camId = cam.properties?.id;
    if (!Array.isArray(at) || !camId) continue;
    const [cLng, cLat] = at;
    let best = null;
    for (const f of stretches) {
      // Coarse bounding-box prune: skip if camera is not within ~300 m of coordinates
      const coords = f.geometry.coordinates;
      let near = false;
      for (let i = 0; i < coords.length; i++) {
        if (Math.abs(coords[i][1] - cLat) <= BBOX_LIVE_LAT && Math.abs(coords[i][0] - cLng) <= BBOX_LIVE_LNG) {
          near = true;
          break;
        }
      }
      if (!near) continue;

      const d = pointToLineMeters(at, coords);
      if (d <= FLOOD_CAM_LIVE_MAX_M && (!best || d < best.d)) best = { f, d };
    }
    if (best) {
      const roadName = best.f.properties?.road || "";
      byCamLive.set(camId, { ...best.f.properties, distM: Math.round(best.d) });
      if (roadName) {
        const existing = byRoadLive.get(roadName);
        if (!existing || best.d < existing.distM) {
          byRoadLive.set(roadName, { camId, distM: Math.round(best.d), camLngLat: at });
        }
      }
    }
  }
  // Then BMA DDS, but only a record dated within the last day and not
  // cleared — an older "clearance not recorded" says nothing about the
  // stream right now.
  const ddsCutoff = Date.now() - FLOOD_CAM_DDS_MAX_H * 3_600_000;
  const activeRoads = roads.filter((f) => {
    const p = f.properties || {};
    const t = Date.parse(p.flooded_at ?? "");
    return p.status !== "reported-cleared" && p.severity !== "cleared" && Number.isFinite(t) && t >= ddsCutoff;
  });
  if (!activeRoads.length) {
    state.floodCamJoin = { byCam, byRoad, byCamLive, byRoadLive, count: byCamLive.size };
    return;
  }
  let joinCount = 0;
  for (const cam of cams) {
    const camLngLat = cam.geometry?.coordinates;
    if (!Array.isArray(camLngLat)) continue;
    const [cLng, cLat] = camLngLat;
    let best = null;
    for (const road of activeRoads) {
      const roadLngLat = road.geometry?.coordinates;
      if (!Array.isArray(roadLngLat)) continue;
      // Coarse bounding-box prune: skip if camera is not within ~800 m of point
      if (Math.abs(roadLngLat[1] - cLat) > BBOX_DEG_LAT || Math.abs(roadLngLat[0] - cLng) > BBOX_DEG_LNG) {
        continue;
      }
      const dist = haversineMeters(camLngLat, roadLngLat);
      if (dist > FLOOD_CAM_JOIN_MAX_M) continue;
      if (!best || dist < best.dist) {
        best = { road, dist };
      }
    }
    if (best) {
      const camId = cam.properties?.id;
      const roadProps = best.road.properties || {};
      const roadKey = best.road.properties?.id ?? `${roadProps.district}/${roadProps.name}`;
      const entry = {
        camId,
        roadKey,
        roadId: best.road.properties?.id ?? null,
        roadName: roadProps.name || roadProps.road || "ถนน",
        district: roadProps.district || "",
        depthCm: roadProps.depth_cm ?? null,
        status: roadProps.status || "",
        severity: roadProps.severity || "",
        floodedAt: roadProps.flooded_at || null,
        distM: Math.round(best.dist),
      };
      if (camId) byCam.set(camId, entry);
      // If the same road happens to match multiple cameras, keep the
      // closest camera as the canonical "live view" link.
      const existing = byRoad.get(roadKey);
      if (!existing || entry.distM < existing.distM) {
        byRoad.set(roadKey, { ...entry, roadKey });
      }
      joinCount++;
    }
  }
  state.floodCamJoin = { byCam, byRoad, byCamLive, byRoadLive, count: joinCount + byCamLive.size };
}

async function installEmergency(map) {
  if (map.getLayer(EMERGENCY_LAYER)) {
    setLayersVisible(map, [EMERGENCY_HALO_LAYER, EMERGENCY_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(EMERGENCY_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("emergency-points", "unavailable · no FloodDash emergency points — not an all-clear");
    return;
  }
  if (!map.getSource(EMERGENCY_SOURCE)) {
    try {
      map.addSource(EMERGENCY_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("BKK emergency-points source failed:", error);
      setLayerStatus("emergency-points", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(EMERGENCY_SOURCE).setData(geojson); } catch {}
  }
  try {
    // Halo: confirmed + high band only — those are the points a person
    // on the ground must read.
    map.addLayer({
      id: EMERGENCY_HALO_LAYER,
      type: "circle",
      source: EMERGENCY_SOURCE,
      minzoom: 8,
      filter: ["all", ["==", ["get", "band"], "high"]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 14, 12, 22, 15, 32],
        "circle-color": "#dc2626",
        "circle-opacity": 0.30,
        "circle-stroke-width": 0,
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    map.addLayer({
      id: EMERGENCY_LAYER,
      type: "circle",
      source: EMERGENCY_SOURCE,
      minzoom: 8,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 12, 8, 15, 12],
        "circle-color": [
          "match", ["get", "band"],
          "high", "#dc2626",
          "watch", "#f97316",
          "#facc15", // reported or unknown
        ],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.4,
        "circle-opacity": ["match", ["get", "tier"], "reported", 0.78, 0.95],
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireEmergencyInteractions(map);
    const counts = geojson.counts ?? {};
    const total = counts.total ?? geojson.features.length;
    setLayerStatus(
      "emergency-points",
      `FloodDash · ${total} emergency points (BKK + 30 km halo · confirmed + reported)`,
    );
  } catch (error) {
    console.warn("BKK emergency-points layer failed:", error);
    setLayerStatus("emergency-points", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Dams (2026-09-29) — major dams pulled from FloodDash's snapshot.dams,
// filtered to the Chao Phraya + nearby basins that actually drive
// Bangkok's river level. Marker size scales with absolute storage so
// Bhumibol/Sirikit (the two biggest) read as "this is the volume that
// matters", and color follows the gauge-band ladder so a person
// already fluent in flood colours reads dams the same way.
// ─────────────────────────────────────────────────────────────────

function closeDamPopup() {
  if (state.damPopup) {
    try { state.damPopup.remove(); } catch {}
    state.damPopup = null;
  }
}

function openDamPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeDamPopup();
  const sevColor = p.severity === "critical" ? "#ff8a8a"
    : p.severity === "warning" ? "#fb923c"
    : p.severity === "watch" ? "#facc15"
    : p.severity === "unknown" ? "#7d8a9a"
    : "#7eb6ff";
  const storagePct = p.storage_pct != null ? `${p.storage_pct}%` : "—";
  const storageMcm = p.storage_mcm != null ? `${p.storage_mcm} MCM` : "—";
  const maxStorage = p.max_storage_mcm != null ? `${p.max_storage_mcm} MCM` : "—";
  const inflow = p.inflow_mcm != null ? `${p.inflow_mcm} MCM` : "—";
  const released = p.released_mcm != null ? `${p.released_mcm} MCM` : "—";
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker" style="color:${sevColor}">FLOODDASH · MAJOR DAM · ${escapeHtml(p.severity || "safe").toUpperCase()}</p>
      <strong class="atlas-cctv-title">${escapeHtml(p.name_en || p.name_th || "Dam")}</strong>
      <p class="atlas-cctv-status" lang="th">${escapeHtml(p.name_th || "")}${p.basin_en ? ` · ${escapeHtml(p.basin_en)}` : ""}</p>
      <p class="atlas-cctv-status">storage <strong>${storagePct}</strong> · ${storageMcm} of ${maxStorage}</p>
      <p class="atlas-cctv-status">inflow ${inflow} · released ${released}</p>
      <div class="atlas-cctv-actions">
        <span>${escapeHtml(p.province_en || "")}</span>
        <span>${escapeHtml(p.obs_time || "")}</span>
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
  state.damPopup = popup;
}

function wireDamInteractions(map) {
  if (map.__bkkxDamsWired) return;
  map.__bkkxDamsWired = true;
  map.on("click", DAM_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openDamPopup(map, feature);
  });
  map.on("mouseenter", DAM_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", DAM_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installDams(map) {
  if (map.getLayer(DAM_LAYER)) {
    setLayersVisible(map, [DAM_HALO_LAYER, DAM_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(DAMS_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("dams", "unavailable · no FloodDash dam reading — not an all-clear");
    return;
  }
  if (!map.getSource(DAM_SOURCE)) {
    try {
      map.addSource(DAM_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("BKK dams source failed:", error);
      setLayerStatus("dams", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(DAM_SOURCE).setData(geojson); } catch {}
  }
  try {
    map.addLayer({
      id: DAM_HALO_LAYER,
      type: "circle",
      source: DAM_SOURCE,
      minzoom: 6,
      filter: ["any",
        ["==", ["get", "severity"], "critical"],
        ["==", ["get", "severity"], "warning"],
      ],
      paint: {
        // Bigger dams get bigger halos so Bhumibol/Sirikit dominate the
        // BKK flood story and smaller reservoirs stay out of the way.
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"], 6,
          ["+", ["*", 14, ["/", ["coalesce", ["to-number", ["get", "max_storage_mcm"]], 1000], 13000]], 4],
          14,
          ["+", ["*", 22, ["/", ["coalesce", ["to-number", ["get", "max_storage_mcm"]], 1000], 13000]], 8],
        ],
        "circle-color": [
          "match", ["get", "severity"],
          "critical", "#dc2626",
          "warning", "#f97316",
          "#facc15",
        ],
        "circle-opacity": 0.20,
        "circle-stroke-width": 0,
        // Animate the colour transition so a dam rising into the
        // warning band visibly fades from yellow to orange over 1.5s.
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    map.addLayer({
      id: DAM_LAYER,
      type: "circle",
      source: DAM_SOURCE,
      minzoom: 6,
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"], 6,
          ["+", ["*", 5, ["coalesce", ["to-number", ["get", "max_storage_mcm"]], 1000], "/", 13000], 3],
          14,
          ["+", ["*", 8, ["coalesce", ["to-number", ["get", "max_storage_mcm"]], 1000], "/", 13000], 6],
        ],
        "circle-color": [
          "match", ["get", "severity"],
          "critical", "#dc2626",
          "warning", "#f97316",
          "watch", "#facc15",
          "unknown", "#7d8a9a",
          "#7eb6ff",
        ],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1.4,
        "circle-opacity": ["match", ["get", "confidence"], "absent", 0.55, 0.95],
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireDamInteractions(map);
    const counts = geojson.counts ?? {};
    setLayerStatus(
      "dams",
      `FloodDash · ${counts.total ?? geojson.features.length} dams (critical ${counts.critical ?? 0} · warning ${counts.warning ?? 0} · watch ${counts.watch ?? 0} · safe ${counts.safe ?? 0})`,
    );
  } catch (error) {
    console.warn("BKK dams layer failed:", error);
    setLayerStatus("dams", "unavailable · layer failed");
  }
}

// ─────────────────────────────────────────────────────────────────
// Maholan community CCTV (2026-09-30) — ~1,700 cameras in BKK + halo
// pulled from cctv.maholan.net's consolidated feed. Distinct from the
// existing /api/cctv layer (66 iTIC/Longdo cameras) — this gives the
// atlas ~10× the coverage with Pak Kret, Pathum Thani, district and
// community submissions. Each click opens a popup with a thumbnail
// (Maholan's /api/snap/<id>) + a link to the upstream viewer.
// ─────────────────────────────────────────────────────────────────

function closeMaholanCctvPopup() {
  if (state.maholanCctvPopup) {
    try { state.maholanCctvPopup.remove(); } catch {}
    state.maholanCctvPopup = null;
  }
}

function openMaholanCctvPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const p = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  closeMaholanCctvPopup();
  const typeColor = p.picture === "none" ? "#7d8a9a" : p.category === "government" ? "#5ec8ff" : "#c084fc";
  const typeLabel = p.upstream_type === "hls" ? "HLS stream"
    : p.upstream_type === "mjpeg" ? "MJPEG stream"
    : p.upstream_type === "snapshot" ? "Snapshot refresh"
    : "Camera";
  const safeName = escapeHtml(String(p.name || p.id || ""));
  const safeRegion = escapeHtml(String(p.region || ""));
  const safeSource = escapeHtml(String(p.upstream_source || ""));
  const safeViewer = escapeHtml(String(p.viewer_url || "#"));
  // Tier from the payload, read conservatively: anything not explicitly
  // 'operator' labels community/unvetted (old cached payloads carry no
  // tier — an unknown must not read as a vetted operator camera).
  const isCommunity = p.tier !== "operator";
  const tierLabel = p.category === "government" ? "GOVERNMENT CAMERA" : isCommunity ? "COMMUNITY / UNKNOWN · UNVERIFIED" : "RECOGNIZED OPERATOR SOURCE";
  // Maholan's snap endpoint sends no Access-Control-Allow-Origin, so
  // browsers refuse to paint a direct <img>. The atlas proxies it
  // through /api/snap/<id> which adds ACAO + caches at the edge.
  const proxySnap = `/api/snap/${encodeURIComponent(String(p.id || ""))}?w=480`;
  // The Maholan viewer page has its own live stream; we link out for it.
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker" style="color:${typeColor}">${tierLabel} · ${escapeHtml(String(p.upstream_type || "")).toUpperCase()} · ${escapeHtml(String(p.live ? "LIVE" : "OFFLINE"))}</p>
      <strong class="atlas-cctv-title">${safeName}</strong>
      ${p.picture === "none" ? `<p class="atlas-cctv-status atlas-cctv-nopic">No picture from this camera at the last check${p.picture_checked_at ? ` (${escapeHtml(ageWords(minutesSince(p.picture_checked_at)))} ago)` : ""}: the operator's feed sent nothing. The dot stays so the camera's place is known.</p>` : `<img class="atlas-maholan-snap"
           src="${escapeHtml(proxySnap)}"
           alt="Live snapshot · ${safeName}"
           loading="lazy"
           data-snap-loaded-at="${Date.now()}" />`}
      <p class="atlas-cctv-status" lang="th">
        ${safeRegion}${safeSource ? ` · ${safeSource}` : ""} ·
        <a href="#" class="atlas-cctv-snap-refresh" data-snap="${escapeHtml(proxySnap)}">↻ refresh snapshot</a>
        <span class="atlas-cctv-snap-age" data-snap-age></span>
      </p>
      <div class="atlas-cctv-actions">
        ${p.source_url ? `<a href="${escapeHtml(safeHttpUrl(String(p.source_url)))}" target="_blank" rel="noreferrer">Camera source ↗</a>` : ""}
        <a href="${safeViewer}" target="_blank" rel="noreferrer">Open live stream ↗</a>
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

  // After the popup mounts: wire the refresh link and poll the proxy
  // once for the snapshot's X-Image-Time so we can show "from 5 min
  // ago". The atlas never shows "just now" without a real timestamp.
  const el = popup.getElement();
  const img = el?.querySelector(".atlas-maholan-snap");
  const ageEl = el?.querySelector("[data-snap-age]");
  const updateAge = (iso) => {
    if (!ageEl || !iso) return;
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return;
    const min = Math.max(0, Math.round(ms / 60_000));
    ageEl.textContent = `· snapshot ${min < 60 ? min + " min ago" : Math.round(min / 60) + " h ago"}`;
  };
  if (img) {
    img.addEventListener("error", () => {
      img.dataset.snapFailed = "1";
      img.alt = `Snapshot unavailable for ${String(p.name || p.id || "")}`;
    });
    // The proxy passes X-Image-Time on a HEAD-ish fetch. Browser
    // <img> doesn't expose response headers, so we ask for the snap
    // metadata with a tiny fetch + range: 0-0 won't help — instead
    // we use a HEAD which the proxy still answers. If HEAD is blocked,
    // fall back to "unknown age".
    fetch(proxySnap, { method: "HEAD" }).then((r) => {
      const t = r.headers.get("x-image-time");
      if (t) updateAge(t);
      else ageEl && (ageEl.textContent = "· snapshot age unknown");
    }).catch(() => { if (ageEl) ageEl.textContent = "· snapshot age unknown"; });
  }
  el?.querySelector(".atlas-cctv-snap-refresh")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!img) return;
    const fresh = `${proxySnap}&_=${Date.now()}`; // bust edge cache
    img.src = fresh;
    img.dataset.snapLoadedAt = String(Date.now());
    delete img.dataset.snapFailed;
    fetch(fresh, { method: "HEAD" }).then((r) => {
      const t = r.headers.get("x-image-time");
      if (t) updateAge(t);
    }).catch(() => {});
  });

  state.maholanCctvPopup = popup;
}

/** One line for the Cameras switch: how many actually show a picture. */
function cameraStatus(fc) {
  const f = (fc?.features ?? []).filter((x) => x.properties?.category !== "itic");
  const ok = f.filter((x) => x.properties?.picture === "ok").length;
  const none = f.filter((x) => x.properties?.picture === "none").length;
  const itic = state.cctvGeojson?.features?.length ?? 0;
  return `${itic} iTIC + ${f.length} agency & other cameras · ${ok} sending a picture · ${none} silent · ${f.length - ok - none} not yet checked`;
}

function wireMaholanCctvInteractions(map) {
  if (map.__bkkxMaholanCctvWired) return;
  map.__bkkxMaholanCctvWired = true;
  map.on("click", MAHOLAN_CCTV_LAYER, (event) => {
    const feature = event.features?.[0];
    if (!feature) return;
    event.originalEvent?.stopPropagation?.();
    openMaholanCctvPopup(map, feature);
  });
  map.on("mouseenter", MAHOLAN_CCTV_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", MAHOLAN_CCTV_LAYER, () => { map.getCanvas().style.cursor = ""; });
}

async function installMaholanCctv(map) {
  if (map.getLayer(MAHOLAN_CCTV_LAYER)) {
    setLayersVisible(map, [MAHOLAN_CCTV_HALO_LAYER, MAHOLAN_CCTV_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(MAHOLAN_CCTV_URL);
  if (geojson) state.maholanCctv = geojson;
  if (!geojson?.features?.length) {
    setLayerStatus("maholan-cctv", "unavailable · Maholan feed empty — not an all-clear");
    return;
  }
  if (!map.getSource(MAHOLAN_CCTV_SOURCE)) {
    try {
      map.addSource(MAHOLAN_CCTV_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Maholan CCTV source failed:", error);
      setLayerStatus("maholan-cctv", "unavailable · source failed");
      return;
    }
  } else {
    try { map.getSource(MAHOLAN_CCTV_SOURCE).setData(geojson); } catch {}
  }
  try {
    // Halo only on LIVE HLS streams — the most "watch this" surface.
    map.addLayer({
      id: MAHOLAN_CCTV_HALO_LAYER,
      type: "circle",
      source: MAHOLAN_CCTV_SOURCE,
      minzoom: 8,
      filter: ["all",
        ["==", ["get", "picture"], "ok"],
        ["!=", ["get", "category"], "itic"],
      ],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 10, 13, 14, 16, 18],
        "circle-color": ["match", ["get", "category"], "government", "#5ec8ff", "#c084fc"],
        "circle-opacity": 0.18,
        "circle-stroke-width": 0,
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    map.addLayer({
      id: MAHOLAN_CCTV_LAYER,
      type: "circle",
      source: MAHOLAN_CCTV_SOURCE,
      minzoom: 7,
      // iTIC cameras are drawn by the iTIC layer, which plays their video.
      filter: ["!=", ["get", "category"], "itic"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, 3, 11, 4.5, 13, 6, 16, 8],
        // HLS live → red, MJPEG live → orange, snapshot → yellow,
        // offline → grey. Matches the layer's legend so a person can
        // decode it from the chip alone.
        // Who runs it: government blue, other violet. Whether it shows a
        // picture (the cron's check): full, unchecked, or faint.
        "circle-color": ["match", ["get", "category"], "government", "#5ec8ff", "#c084fc"],
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 1,
        "circle-opacity": ["match", ["get", "picture"], "ok", 0.95, "none", 0.22, 0.6],
        "circle-stroke-opacity": ["match", ["get", "picture"], "none", 0.25, 1],
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireMaholanCctvInteractions(map);
    const counts = geojson.counts ?? {};
    const total = counts.total ?? geojson.features.length;
    const live = counts.live ?? 0;
    setLayerStatus("cctv", cameraStatus(geojson));
  } catch (error) {
    console.warn("Maholan CCTV layer failed:", error);
    setLayerStatus("maholan-cctv", "unavailable · layer failed");
  }
}

async function installFloodSensors(map) {
  if (map.getLayer(FLOOD_SENSOR_LAYER)) {
    setLayersVisible(map, [FLOOD_SENSOR_HALO_LAYER, FLOOD_SENSOR_LAYER], true);
    applyOverlayCompositing(map);
    return;
  }
  const geojson = await fetchJson(FLOOD_SENSOR_LIVE_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("flood-sensors", "unavailable · no FloodDash reading — not an all-clear");
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
  const silent = ["==", ["get", "silent"], true];
  const dim = ["==", ["get", "dim"], true];
  try {
    map.addLayer({
      id: FLOOD_SENSOR_HALO_LAYER,
      type: "circle",
      source: FLOOD_SENSOR_SOURCE,
      minzoom: 9,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 10, 13, 18, 16, 24],
        "circle-color": ["get", "levelColor"],
        // Only prepare and worse get a halo — the eye goes where the water is.
        "circle-opacity": ["case", [">=", ["get", "rank"], 3], ["case", dim, 0.14, 0.28], 0],
        "circle-stroke-width": 0,
        // Animate the colour transition (1.5 s) so a sensor going from
        // prepare → safe visibly fades red → yellow → green on the
        // map. The user sees the water going down, not a snap.
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
      },
    });
    map.addLayer({
      id: FLOOD_SENSOR_LAYER,
      type: "circle",
      source: FLOOD_SENSOR_SOURCE,
      minzoom: 9,
      layout: { "circle-sort-key": ["get", "rank"] },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, ["case", [">=", ["get", "rank"], 4], 5.5, 4], 13, ["case", [">=", ["get", "rank"], 4], 8, 6], 16, ["case", [">=", ["get", "rank"], 4], 10, 8]],
        "circle-color": ["case", silent, "rgba(0,0,0,0)", ["get", "levelColor"]],
        "circle-stroke-color": ["case", silent, "#c8c9c0", "#11120f"],
        "circle-stroke-width": ["case", silent, 1.6, 1.2],
        "circle-opacity": ["case", dim, 0.55, 0.95],
        "circle-stroke-opacity": ["case", dim, 0.55, 1],
        "circle-color-transition": { duration: 1500, delay: 0 },
        "circle-radius-transition": { duration: 1500, delay: 0 },
        "circle-opacity-transition": { duration: 1500, delay: 0 },
      },
    });
    wireFloodSensorInteractions(map);
    const reporting = geojson.reporting ?? geojson.features.length;
    const silentCount = geojson.features.length - reporting;
    setLayerStatus(
      "flood-sensors",
      `FloodDash · ${reporting} reporting${silentCount ? ` · ${silentCount} silent` : ""} · ${ageWords(geojson.ageMin)} ago`,
    );
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
  state.cctvGeojson = geojson;
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
  state.cctvGeojson = geojson;
  addCctvLayer(map, geojson);
  setCctvSourceBadge(source, geojson.features?.length ?? geojson.count);
  wireCctvInteractions(map);
  computeFloodCamJoin();
  if (preferLive && source === "sample") {
    fetchLiveCctv().then((live) => {
      if (live && map.getSource(CCTV_SOURCE)) {
        state.cctvGeojson = live;
        addCctvLayer(map, live);
        setCctvSourceBadge("live", live.features?.length ?? live.count);
        computeFloodCamJoin();
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

  // CCTV ↔ flooded-road spatial join (2026-09-27): if this camera sits
  // within ~800 m of an active BMA DDS flooded road, surface that fact
  // right at the top of the popup. A person watching the live stream
  // needs to know "this is what flooding looks like" without leaving
  // the player. Stolen from JK World's flood page, where every road
  // card carries its nearest camera thumbnail.
  const floodEntry = state.floodCamJoin?.byCam?.get(props.id) || null;
  const liveEntry = state.floodCamJoin?.byCamLive?.get(props.id) || null;
  const liveAgo = liveEntry ? minutesSince(liveEntry.latest) : null;
  const liveBits = liveEntry
    ? [
        liveEntry.traffy ? `${liveEntry.traffy} resident report${liveEntry.traffy > 1 ? "s" : ""}` : "",
        liveEntry.itic ? `${liveEntry.itic} iTIC report${liveEntry.itic > 1 ? "s" : ""}` : "",
        liveEntry.depthEn ? `to ${liveEntry.depthEn}` : "",
        liveAgo != null ? `latest ${ageWords(liveAgo)} ago` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const floodBanner = liveEntry
    ? `<div class="atlas-cctv-flood-banner" data-severity="${liveEntry.depth >= 5 ? "severe" : liveEntry.depth >= 3 ? "moderate" : "shallow"}">
        <div class="atlas-cctv-flood-head">
          <span class="atlas-cctv-flood-kicker">🌊 REPORTED FLOODED · ${liveEntry.distM} m</span>
          <button type="button" class="atlas-cctv-road-jump-btn" data-jump-road="${escapeHtml(liveEntry.road || "")}">Show road ↗</button>
        </div>
        <strong class="atlas-cctv-flood-road" lang="th">${escapeHtml(liveEntry.road || "Unnamed road")}</strong>
        <span class="atlas-cctv-flood-meta">${escapeHtml(liveBits)} · depth is the reporter's word</span>
      </div>`
    : floodEntry
    ? `<div class="atlas-cctv-flood-banner" data-severity="${escapeHtml(floodEntry.severity || "unknown")}">
        <div class="atlas-cctv-flood-head">
          <span class="atlas-cctv-flood-kicker">🌊 BMA DDS · FLOODED ROAD · ${Math.round(floodEntry.distM)} m</span>
          <button type="button" class="atlas-cctv-road-jump-btn" data-jump-dds="${escapeHtml(floodEntry.roadKey || "")}">Show road ↗</button>
        </div>
        <strong class="atlas-cctv-flood-road" lang="th">${escapeHtml(floodEntry.roadName)}</strong>
        <span class="atlas-cctv-flood-meta">
          ${escapeHtml(floodEntry.district || "")}${floodEntry.depthCm != null ? ` · depth ${floodEntry.depthCm} cm` : ""}${floodEntry.floodedAt ? ` · since ${escapeHtml(floodEntry.floodedAt)}` : ""}
        </span>
      </div>`
    : "";

  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">Traffic CCTV · ${escapeHtml(org)}</p>
      <strong class="atlas-cctv-title">${escapeHtml(title)}</strong>
      ${floodBanner}
      <video class="atlas-cctv-video" playsinline muted autoplay controls></video>
      <div class="atlas-cctv-stream-error" hidden>
        <span>Stream unavailable in your session — iTIC runs every camera on its own port and a handful are off-air.</span>
      </div>
      <p class="atlas-cctv-status">Connecting live stream…</p>
      <div class="atlas-cctv-actions">
        <a href="${escapeHtml(safeHttpUrl(iticUrl))}" target="_blank" rel="noreferrer">Open on iTIC ↗</a>
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

  const jumpRoadBtn = popup.getElement()?.querySelector("[data-jump-road]");
  if (jumpRoadBtn) {
    jumpRoadBtn.addEventListener("click", () => {
      const roadName = jumpRoadBtn.getAttribute("data-jump-road");
      if (roadName) flyToRoadFromCctv(map, roadName);
    });
  }
  const jumpDdsBtn = popup.getElement()?.querySelector("[data-jump-dds]");
  if (jumpDdsBtn) {
    jumpDdsBtn.addEventListener("click", () => {
      const roadKey = jumpDdsBtn.getAttribute("data-jump-dds");
      if (roadKey) flyToDdsRoadFromCctv(map, roadKey);
    });
  }

  const video = popup.getElement()?.querySelector(".atlas-cctv-video");
  const status = popup.getElement()?.querySelector(".atlas-cctv-status");
  const errBox = popup.getElement()?.querySelector(".atlas-cctv-stream-error");
  if (!hls) {
    if (status) status.textContent = "No HLS URL for this camera.";
    if (errBox) errBox.hidden = false;
    return;
  }
  if (status) {
    // Credit the owning org, not just the platform: a กรมทางหลวง (DOH)
    // camera streamed via iTIC/Longdo must not read "Live · iTIC / Longdo".
    status.textContent = /กรมทางหลวง|DOH/.test(org)
      ? "Live · กรมทางหลวง cam · iTIC / Longdo"
      : "Live · iTIC / Longdo";
  }
  playCctvStream(video, hls);
  // iTIC runs cameras on per-host ports; some are off-air. If the
  // video element errors or stalls without ever playing, show the
  // "stream unavailable" box so the popup doesn't look broken.
  if (video && errBox) {
    let showedError = false;
    const showErr = () => {
      if (showedError) return;
      showedError = true;
      errBox.hidden = false;
      if (status) status.textContent = "Stream not available right now — open on iTIC ↗";
    };
    video.addEventListener("error", showErr, { once: true });
    // 6 s of no playback after source set = treat as broken.
    setTimeout(() => {
      if (video.readyState < 2 && video.networkState !== 0) showErr();
    }, 6000);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Only http(s) URLs may land in an href. escapeHtml stops attribute
// breakout but not a smuggled `javascript:` scheme in an upstream link
// (RSS headline, camera source page). Relative refs resolve against own
// origin; anything else (data:, javascript:, …) falls back to "#".
function safeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("#")) return raw || "#";
  try {
    const u = new URL(raw, location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "#";
  } catch { return "#"; }
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
// Pin a problem, flush it away (2026-10-02). Long-press the map (or
// Ctrl/Cmd-click) to pin a problem spot — a flooded corner, a blocked
// drain. A pin exists until the user flushes it (tap the pin → "Flush
// away": one expanding ring fades out, the inverse of the fresh-report
// ripple) or it ages out at 90 days. Client-side only: these are the
// user's own markers, not civic data — they never reach the API or
// another visitor's map.
// ─────────────────────────────────────────────────────────────────
const PIN_SOURCE = "bkkx-pinned-problems";
const PIN_LAYER = "bkkx-pinned-problems-dots";
const PIN_HALO_LAYER = "bkkx-pinned-problems-halo";
const PIN_FLUSH_RING = "bkkx-pin-flush-ring";
const PIN_STORE_KEY = "bkkx-pinned-problems";
const PIN_LONG_PRESS_MS = 600;
const PIN_MAX_AGE_DAYS = 90;

function loadPins() {
  try {
    const raw = JSON.parse(localStorage.getItem(PIN_STORE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const cutoff = Date.now() - PIN_MAX_AGE_DAYS * 86400000;
    // Aged-out pins flush themselves on load — a pin that stopped being
    // a problem is no longer a pin.
    return raw.filter((p) => p && Number.isFinite(p.lng) && Number.isFinite(p.lat) &&
      (!p.pinnedAt || Date.parse(p.pinnedAt) > cutoff));
  } catch { return []; }
}

function savePins(pins) {
  try { localStorage.setItem(PIN_STORE_KEY, JSON.stringify(pins)); } catch {}
}

function renderPins(map) {
  const src = map.getSource(PIN_SOURCE);
  if (!src) return;
  src.setData({
    type: "FeatureCollection",
    features: loadPins().map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { id: p.id, note: p.note || "", pinnedAt: p.pinnedAt || null },
    })),
  });
}

function pinProblem(map, lng, lat) {
  const pins = loadPins();
  // A second pin within ~30 m is the same problem — move it, don't stack.
  const near = pins.find((p) => haversineMeters([p.lng, p.lat], [lng, lat]) < 30);
  const id = near ? near.id : `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const next = pins.filter((p) => p.id !== id);
  next.push({ id, lng, lat, note: near?.note || "", pinnedAt: near?.pinnedAt || new Date().toISOString() });
  savePins(next);
  renderPins(map);
}

function flushPin(map, id, lngLat) {
  savePins(loadPins().filter((p) => p.id !== id));
  renderPins(map);
  playFlushRing(map, lngLat);
}

// The flush: one expanding ring that fades — the inverse of the
// fresh-report ripple. Off for reduced motion.
function playFlushRing(map, lngLat) {
  const lngNum = Array.isArray(lngLat) ? lngLat[0] : lngLat.lng;
  const latNum = Array.isArray(lngLat) ? lngLat[1] : lngLat.lat;
  if (!Number.isFinite(lngNum) || !Number.isFinite(latNum)) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (!map.getSource(PIN_FLUSH_RING)) {
    map.addSource(PIN_FLUSH_RING, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: PIN_FLUSH_RING,
      type: "circle",
      source: PIN_FLUSH_RING,
      paint: {
        "circle-radius": 0,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#c9ff38",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0,
        "circle-pitch-alignment": "map",
      },
    });
  }
  map.getSource(PIN_FLUSH_RING).setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lngNum, latNum] }, properties: {} }],
  });
  const start = performance.now();
  const DUR = 900;
  const tick = (now) => {
    if (!map.getLayer(PIN_FLUSH_RING)) return;
    const t = Math.min((now - start) / DUR, 1);
    map.setPaintProperty(PIN_FLUSH_RING, "circle-radius", 6 + 26 * t);
    map.setPaintProperty(PIN_FLUSH_RING, "circle-stroke-opacity", 0.9 * (1 - t));
    if (t < 1) requestAnimationFrame(tick);
    else map.getSource(PIN_FLUSH_RING)?.setData({ type: "FeatureCollection", features: [] });
  };
  requestAnimationFrame(tick);
}

function openPinPopup(map, feature) {
  if (!feature?.geometry?.coordinates) return;
  const props = feature.properties || {};
  const [lng, lat] = feature.geometry.coordinates;
  const age = props.pinnedAt ? `${ageWords(minutesSince(props.pinnedAt))} ago` : "";
  closeCctvPopup();
  const html = `
    <div class="atlas-cctv-card">
      <p class="atlas-cctv-kicker">Pinned problem · your marker</p>
      <strong class="atlas-cctv-title">${escapeHtml(props.note || "Problem spot")}</strong>
      <span class="atlas-cctv-meta">${escapeHtml(age)} · ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
      <div class="atlas-cctv-actions">
        <button type="button" class="atlas-pin-flush-btn" data-flush-pin="${escapeHtml(props.id)}">Flush away ↘</button>
      </div>
    </div>
  `;
  const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 18 })
    .setLngLat([lng, lat])
    .setHTML(html)
    .addTo(map);
  popup.getElement()?.querySelector("[data-flush-pin]")?.addEventListener("click", () => {
    flushPin(map, props.id, [lng, lat]);
    popup.remove();
  });
}

function wirePinInteractions(map) {
  if (map.__bkkxPinsWired) return;
  map.__bkkxPinsWired = true;

  map.on("click", PIN_LAYER, (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    e.originalEvent?.stopPropagation?.();
    openPinPopup(map, feature);
  });
  map.on("mouseenter", PIN_LAYER, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", PIN_LAYER, () => { map.getCanvas().style.cursor = ""; });

  // Long-press (600 ms) pins a problem; any drag or release cancels. A
  // pin just created suppresses the inspect click that fires on mouseup.
  let pressTimer = null;
  let suppressNextClick = false;
  const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
  const startPress = (lng, lat) => {
    cancelPress();
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressNextClick = true;
      pinProblem(map, lng, lat);
    }, PIN_LONG_PRESS_MS);
  };
  map.on("mousedown", (e) => { if (e.originalEvent?.button === 0) startPress(e.lngLat.lng, e.lngLat.lat); });
  map.on("touchstart", (e) => { if (e.lngLat) startPress(e.lngLat.lng, e.lngLat.lat); });
  map.on("mouseup", cancelPress);
  map.on("touchend", cancelPress);
  map.on("dragstart", cancelPress);
  map.on("movestart", cancelPress);

  // Ctrl/Cmd-click pins immediately. Registered before wireInspect's
  // generic click so a suppress or a pin wins the event.
  map.on("click", (e) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      e.originalEvent?.stopPropagation?.();
      return;
    }
    if (e.originalEvent?.ctrlKey || e.originalEvent?.metaKey) {
      e.originalEvent?.stopPropagation?.();
      pinProblem(map, e.lngLat.lng, e.lngLat.lat);
    }
  });

  // Right-click pins too — on macOS Ctrl+click IS a right-click
  // (contextmenu), so this is what makes the Ctrl-click affordance real
  // there. A long-press that also fires contextmenu dedupes in
  // pinProblem (within 30 m it moves the existing pin).
  map.on("contextmenu", (e) => {
    e.originalEvent?.preventDefault?.();
    pinProblem(map, e.lngLat.lng, e.lngLat.lat);
  });
  map.getCanvasContainer()?.addEventListener("contextmenu", (e) => e.preventDefault());
}

function addPinLayers(map) {
  if (!map.getSource(PIN_SOURCE)) {
    map.addSource(PIN_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  if (!map.getLayer(PIN_HALO_LAYER)) {
    map.addLayer({
      id: PIN_HALO_LAYER,
      type: "circle",
      source: PIN_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 9, 15, 20],
        "circle-color": "rgba(201, 255, 56, 0.16)",
        "circle-pitch-alignment": "map",
      },
    });
  }
  if (!map.getLayer(PIN_LAYER)) {
    map.addLayer({
      id: PIN_LAYER,
      type: "circle",
      source: PIN_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6],
        "circle-color": "#c9ff38",
        "circle-stroke-color": "rgba(17, 18, 15, 0.9)",
        "circle-stroke-width": 1.5,
        "circle-pitch-alignment": "map",
      },
    });
  }
  renderPins(map);
  wirePinInteractions(map);
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
          <a href="${escapeHtml(safeHttpUrl(p.url || ""))}" target="_blank" rel="noreferrer">Open ↗ (login required)</a>
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
          <a href="${escapeHtml(safeHttpUrl(watchUrl))}" target="_blank" rel="noreferrer">Open on YouTube ↗</a>
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
        "circle-stroke-color": "#c084fc",
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
    // Static GeoJSON may come from the HTTP cache. Live /api/ feeds never:
    // "force-cache" reuses a stored copy however old it is, which left
    // returning visitors reading an hours-old flood picture as current.
    const live = String(url).startsWith("/api/");
    const response = await fetch(url, { cache: live ? "no-store" : "force-cache" });
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

async function loadWaterTransitData(map) {
  const layers = [WATER_TRANSIT_ROUTE_LAYER, WATER_TRANSIT_FERRY_LAYER, WATER_TRANSIT_PIER_LAYER];
  if (layers.every((id) => map.getLayer(id))) {
    setLayersVisible(map, layers, true);
    return;
  }
  const geojson = await fetchJson(WATER_TRANSIT_DATA_URL);
  if (!geojson?.features?.length) {
    setLayerStatus("water-transit", "unavailable · route file failed");
    return;
  }
  try {
    if (!map.getSource(WATER_TRANSIT_SOURCE)) {
      map.addSource(WATER_TRANSIT_SOURCE, { type: "geojson", data: geojson });
    }
    if (!map.getLayer(WATER_TRANSIT_ROUTE_LAYER)) {
      map.addLayer({
        id: WATER_TRANSIT_ROUTE_LAYER,
        type: "line",
        source: WATER_TRANSIT_SOURCE,
        minzoom: 9,
        filter: ["all", ["==", ["get", "feature_type"], "route"], ["!=", ["get", "mode"], "cross-river-ferry"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 14, 4, 17, 6],
          "line-dasharray": [0.4, 2.2],
          "line-opacity": 0.95,
        },
      });
    }
    if (!map.getLayer(WATER_TRANSIT_FERRY_LAYER)) {
      map.addLayer({
        id: WATER_TRANSIT_FERRY_LAYER,
        type: "line",
        source: WATER_TRANSIT_SOURCE,
        minzoom: 11,
        filter: ["all", ["==", ["get", "feature_type"], "route"], ["==", ["get", "mode"], "cross-river-ferry"]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [0.1, 1.5], "line-opacity": 1 },
      });
    }
    if (!map.getLayer(WATER_TRANSIT_PIER_LAYER)) {
      map.addLayer({
        id: WATER_TRANSIT_PIER_LAYER,
        type: "circle",
        source: WATER_TRANSIT_SOURCE,
        minzoom: 11,
        filter: ["==", ["get", "feature_type"], "pier"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 6],
          "circle-color": "#11120f",
          "circle-stroke-color": "#54c7ec",
          "circle-stroke-width": 2,
          "circle-opacity": 0.96,
        },
      });
    }
    wireWaterTransitInteractions(map);
    const routes = geojson.features.filter((feature) => feature.properties?.feature_type === "route").length;
    const piers = geojson.features.filter((feature) => feature.properties?.feature_type === "pier").length;
    setLayerStatus("water-transit", `${routes} scheduled corridors · ${piers} piers · not live positions`);
  } catch (error) {
    console.warn("Water transit layer failed:", error);
    setLayerStatus("water-transit", "unavailable · layer failed");
  }
}

function wireWaterTransitInteractions(map) {
  if (map.__bkkxWaterTransitWired) return;
  map.__bkkxWaterTransitWired = true;
  const routeLayers = [WATER_TRANSIT_ROUTE_LAYER, WATER_TRANSIT_FERRY_LAYER];
  for (const layerId of routeLayers) {
    map.on("click", layerId, (event) => {
      const p = event.features?.[0]?.properties;
      if (!p) return;
      new maplibregl.Popup({ closeButton: true, maxWidth: "310px", className: "atlas-cctv-popup" })
        .setLngLat(event.lngLat)
        .setHTML(`
          <p class="atlas-cctv-kicker">Scheduled water transit · not live tracking</p>
          <strong class="atlas-cctv-title">${escapeHtml(p.name)}</strong>
          <p class="atlas-cctv-status">${escapeHtml(p.name_th || "")} · ${escapeHtml(p.operator || "")}</p>
          <p class="atlas-cctv-status">${escapeHtml(p.service_note || "Check the operator before travel.")}</p>
          <a href="${escapeHtml(safeHttpUrl(p.source_url || WATER_TRANSIT_DATA_URL))}" target="_blank" rel="noreferrer">Check operator ↗</a>
        `)
        .addTo(map);
    });
  }
  map.on("click", WATER_TRANSIT_PIER_LAYER, (event) => {
    const p = event.features?.[0]?.properties;
    if (!p) return;
    new maplibregl.Popup({ closeButton: true, maxWidth: "280px", className: "atlas-cctv-popup" })
      .setLngLat(event.lngLat)
      .setHTML(`
        <p class="atlas-cctv-kicker">Passenger pier</p>
        <strong class="atlas-cctv-title">${escapeHtml(p.name)} · ${escapeHtml(p.name_th || "")}</strong>
        <p class="atlas-cctv-status">${escapeHtml(p.services || "")}</p>
        <p class="atlas-cctv-status">Nearby: ${escapeHtml(p.nearby || "—")}</p>
      `)
      .addTo(map);
  });
  for (const layerId of [...routeLayers, WATER_TRANSIT_PIER_LAYER]) {
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  }
}

/** Rank each segment by how far its named waterway runs (see WATERWAY_WIDTH). */
function tierWaterways(geojson) {
  const unnamed = (n) => !n || n.startsWith("unnamed");
  const km = new Map();
  for (const f of geojson.features) {
    const n = f.properties.nameTh;
    if (!unnamed(n)) km.set(n, (km.get(n) || 0) + (f.properties.lengthKm || 0));
  }
  for (const f of geojson.features) {
    const n = f.properties.nameTh;
    const total = unnamed(n) ? null : km.get(n);
    f.properties.tier = n === "แม่น้ำเจ้าพระยา" ? 4 : total == null ? 0 : total >= 20 ? 3 : total >= 7 ? 2 : 1;
  }
}

async function loadKhlongData(map) {
  if (map.getLayer(KHLONG_RIVER_LAYER) || map.getLayer(KHLONG_CANAL_LAYER)) {
    setLayersVisible(map, [KHLONG_RIVER_LAYER, KHLONG_CANAL_LAYER, KHLONG_FLOW_LAYER], true);
    startWaterFlow(map);
    return;
  }
  const geojson = await fetchJson(KHLONG_DATA_URL);
  if (!geojson) return;
  tierWaterways(geojson);
  try {
    if (!map.getSource(KHLONG_SOURCE)) {
      // promoteId lets FloodDash's per-segment status land as feature-state.
      map.addSource(KHLONG_SOURCE, { type: "geojson", data: geojson, promoteId: "id" });
    }
    const paint = { "line-color": WATERWAY_COLOR, "line-width": WATERWAY_WIDTH, "line-opacity": WATERWAY_OPACITY };
    for (const [id, waterway] of [[KHLONG_RIVER_LAYER, "river"], [KHLONG_CANAL_LAYER, "canal"]]) {
      if (map.getLayer(id)) continue;
      map.addLayer({
        id,
        type: "line",
        source: KHLONG_SOURCE,
        minzoom: 9,
        filter: ["==", ["get", "waterway"], waterway],
        layout: { "line-join": "round", "line-cap": "round" },
        paint,
      });
    }
    if (!map.getLayer(KHLONG_FLOW_LAYER)) {
      map.addLayer({
        id: KHLONG_FLOW_LAYER,
        type: "line",
        source: KHLONG_SOURCE,
        minzoom: 10,
        filter: [">=", ["get", "tier"], 1],
        layout: { "line-join": "round", "line-cap": "butt" },
        paint: {
          "line-color": "#EAF7FF",
          "line-width": FLOW_WIDTH,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.35, 13, 0.7],
          "line-dasharray": FLOW_DASH_STEPS[0],
        },
      });
    }
    applyWaterwayStatus(map);
    startWaterFlow(map);
  } catch (error) {
    console.warn("Khlong layer failed:", error);
  }
}

function stopWaterFlow() {
  if (state.flowTimer) {
    clearInterval(state.flowTimer);
    state.flowTimer = null;
  }
}

/** Slide the flow dashes downstream. Paused while hidden; still for reduced motion. */
function startWaterFlow(map) {
  if (state.flowTimer) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const targetMap = map || state.map;
  if (!targetMap) return;
  let step = 0;
  state.flowTimer = setInterval(() => {
    if (document.hidden || document.body.classList.contains("atlas-wall-open") || !targetMap.getLayer(KHLONG_FLOW_LAYER)) return;
    if (targetMap.getLayoutProperty(KHLONG_FLOW_LAYER, "visibility") === "none") return;
    step = (step + 1) % FLOW_DASH_STEPS.length;
    targetMap.setPaintProperty(KHLONG_FLOW_LAYER, "line-dasharray", FLOW_DASH_STEPS[step]);
  }, 90);
}

/** Colour each waterway segment with the band of the gauge that judged it. */
function applyWaterwayStatus(map) {
  if (!map?.getSource(KHLONG_SOURCE) || !state.flood?.waterways) return;
  map.removeFeatureState({ source: KHLONG_SOURCE });
  for (const [id, w] of Object.entries(state.flood.waterways)) {
    if (w.band === "safe") continue;
    map.setFeatureState({ source: KHLONG_SOURCE, id }, { band: w.band });
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

let inspectSequence = 0;
let currentPlace = null;
function renderPlaceEvidence() {
  if (!currentPlace) return;
  const {point,live,lng,lat,weather} = currentPlace;
  const rows = placeBriefing(point,live,Date.now(),weather);
  const roads = nearbyRoadReports(state.floodRoads?.roads,lng,lat);
  rows.splice(3,0,['Nearby road reports · รายงานน้ำท่วม', roads.length
    ? roads.map(r=>`${r.feature.properties.road || 'Unnamed road'} · ${r.distanceM} m · reported ${r.feature.properties.latest} · Traffy / iTIC via FloodDash`).join('; ')
    : 'No current reports in the loaded data within 500 m. Coverage may be incomplete; unreported roads are unknown, not dry.']);
  fillInspectDl(document.getElementById('atlas-place-briefing'),rows);
}
function clearInspect(map) {
  inspectSequence++;
  currentPlace = null;
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
  const sequence = ++inspectSequence;
  currentPlace = null;
  const { lng, lat } = event.lngLat;
  const feature = massingFeatureAt(event.lngLat) || pickBuildingFeature(map, event.point);
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
  const briefing = document.getElementById('atlas-place-briefing');
  const placeStatus = document.getElementById('atlas-place-status');
  const cameras = document.getElementById('atlas-place-cameras');
  if (placeStatus) placeStatus.textContent = 'Checking nearby evidence… · กำลังตรวจสอบ';
  fillInspectDl(briefing, placeBriefing(null, null));
  if (cameras) cameras.replaceChildren();
  revealTask('atlas-inspect');
  if (coordsEl) {
    coordsEl.textContent = `${lng.toFixed(5)}° E, ${lat.toFixed(5)}° N`;
  }
  fillInspectDl(buildingEl, buildingRowsFromFeature(feature));
  fillInspectDl(floodEl, [["Envelope", "Loading…"], ["Risk", "…"]]);
  if (noteEl) noteEl.textContent = "";
  if (apiLink) {
    apiLink.href = `/api/risk?lng=${lng.toFixed(5)}&lat=${lat.toFixed(5)}`;
  }

  const [flood, risk, point, weather] = await Promise.all([
    floodHitAt(lng, lat),
    fetchRisk(lng.toFixed(5), lat.toFixed(5)),
    fetch(`/api/atlas/at-this-point?lng=${lng}&lat=${lat}`, {signal:AbortSignal.timeout(12000)})
      .then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`/api/weather/google?lng=${lng}&lat=${lat}`, {signal:AbortSignal.timeout(14000)})
      .then(r=>r.ok?r.json():null).catch(()=>null),
  ]);
  if (sequence !== inspectSequence) return;
  currentPlace = {point,live:risk?.live,lng,lat,weather};
  renderPlaceEvidence();
  if (placeStatus) placeStatus.textContent = `Briefing checked ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · source observation times differ.${!point || !risk?.live ? ' Some evidence is unavailable.' : ''}`;
  for (const camera of nearestCameras(state.cctvGeojson, lng, lat)) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'atlas-place-camera';
    button.textContent = `Camera · ${camera.feature.properties?.name || camera.feature.properties?.title || 'Nearby camera'} · ${camera.distanceM} m · catalogue, image freshness unverified`;
    button.addEventListener('click', () => {
      if (window.matchMedia('(max-width:720px)').matches) document.querySelector('[data-close-sheet]')?.click();
      map.easeTo({center:camera.feature.geometry.coordinates,zoom:Math.max(map.getZoom(),15),duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:500});
      openCctvPopup(map, camera.feature);
    });
    cameras?.append(button);
  }
  if (cameras && !cameras.childElementCount) cameras.textContent = 'Nearby cameras not loaded or none in the loaded catalogue within 1.5 km. This is not proof that no cameras exist.';
  fillInspectDl(floodEl, [...liveFloodRows(risk?.live), ...floodRiskRows(flood, risk, feature)]);
  if (noteEl) {
    const floodNote = risk?.live
      ? `Live rows: FloodDash — ${FLOOD_DUTY}. Schematic rows are civic demos, not official DDPM/BMA maps.`
      : "No live FloodDash reading here — not an all-clear. Schematic rows are civic demos, not official DDPM/BMA maps.";
    const modelNote = feature?.properties?.accuracy;
    noteEl.textContent = modelNote ? `${floodNote} ${modelNote}` : floodNote;
  }

  const section = document.getElementById("atlas-inspect");
  if (section) {
    if (section.tagName === "DETAILS") section.open = true;
    section.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: "nearest" });
  }
}

async function fetchRisk(lng, lat) {
  try {
    const res = await fetch(`/api/risk?lng=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
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
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
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

/** Rows from FloodDash's live answer for this point (/api/risk → live). */
function liveFloodRows(live) {
  if (!live) return [];
  const rows = [];
  if (live.city) rows.push(["Bangkok now", `${FLOOD_LEVEL_WORD[live.city.level] || live.city.level} · ${live.city.headEn}`]);
  else rows.push(["Bangkok now", "Current city assessment unavailable — not an all-clear"]);
  const g = live.nearestGauge;
  const gaugeAge = /(?:Z|[+-]\d{2}:\d{2})$/.test(g?.observedAt || '') ? minutesSince(g.observedAt) : null;
  const gaugeCurrent = gaugeAge !== null && gaugeAge >= 0 && gaugeAge <= 120 && g?.confidence !== 'stale';
  rows.push(["Nearest gauge", g
    ? `${gaugeCurrent ? g.bandEn : 'Stale or time unknown'} · ${g.name} · ${g.distanceKm} km · observed ${g.observedAt || 'time unknown'}`
    : "none reporting within 15 km"]);
  if (live.district) {
    const r = live.roadReports;
    rows.push([`Roads · ${live.district}`, r
      ? `${r.reports} DDS report${r.reports > 1 ? "s" : ""}${r.maxDepthCm != null ? `, to ${r.maxDepthCm} cm` : ""} · bulletin dates ${(live.roadReportDays || []).join(', ') || 'unknown'}; not current clearance`
      : "none reported in DDS"]);
  }
  return rows;
}

function floodRiskRows(flood, risk, buildingFeature) {
  const height = buildingFeature?.properties?.render_height
    ?? buildingFeature?.properties?.height
    ?? null;
  const rows = [
    ["Schematic envelope", flood?.inside ? "inside" : "outside"],
  ];
  if (flood?.inside && flood.top) {
    rows.push(["Corridor", String(flood.top.name ?? flood.top.id ?? "—")]);
    rows.push(["Severity", String(flood.top.severity ?? "—")]);
    if (flood.top.depthHintM != null) rows.push(["Depth hint", `${flood.top.depthHintM} m`]);
  }
  if (risk?.score != null) {
    rows.push(["Schematic score", `${risk.score} · ${risk.band ?? "—"}`]);
  }
  if (risk?.factors?.pm25 != null) {
    rows.push(["PM2.5", `${risk.factors.pm25} µg/m³`]);
  }
  if (height != null) rows.push(["Building height", `${height} m`]);
  return rows;
}

function pointLayersOwningClick(map, point) {
  const owners = [
    HII_HISTORY_LAYER,
    ROOF_LAYER,
    CCTV_LAYER,
    LIVE_CAM_LAYER,
    CIVIC_POI_LAYER,
    FLOOD_SENSOR_LAYER,
    FLOOD_ROAD_LAYER,
    AIRBNB_LAYER,
    CANAL_LAYER,
    WATER_TRANSIT_ROUTE_LAYER,
    WATER_TRANSIT_FERRY_LAYER,
    WATER_TRANSIT_PIER_LAYER,
  ].filter((id) => map.getLayer(id));
  if (owners.length === 0) return [];
  return map.queryRenderedFeatures(point, { layers: owners });
}

function wireInspect(map) {
  setInterval(renderPlaceEvidence,30000);
  document.getElementById('atlas-inspect-centre')?.addEventListener('click', () => {
    const lngLat = map.getCenter();
    runInspect(map, {lngLat, point:map.project(lngLat)});
  });
  document.querySelectorAll('[data-task]').forEach(link => { link.disabled = false; link.addEventListener('click', event => {
    event.preventDefault();
    revealTask(link.dataset.task === 'place' ? 'atlas-inspect' : link.dataset.task === 'water' ? 'atlas-water' : 'atlas-areas');
  }); });
  map.on("click", (event) => {
    // Interactive overlays own the click instead of also opening building inspect.
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

function revealTask(id) {
  const section = document.getElementById(id);
  if (!section) return;
  const panel = document.getElementById('atlas-panel');
  if (panel?.contains(section)) panel.setAttribute('aria-hidden','false');
  if (window.matchMedia('(max-width:720px)').matches && panel?.contains(section) && !panel.classList.contains('is-open')) {
    document.getElementById('atlas-panel-toggle')?.click();
  }
  if (section.tagName === 'DETAILS') section.open = true;
  if (id === 'atlas-water') {
    section.hidden = false;
    const details = document.getElementById('atlas-water-details');
    if (details) details.open = true;
  }
  section.scrollIntoView({block:'nearest', behavior:'auto'});
  section.querySelector('summary')?.focus({preventScroll:true});
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

/** A slow install (live fetch) can finish after a preset switched the layer
 *  off. The later answer wins: hide what the install just added. */
function settleIfSwitchedOff(map, layer, toggle) {
  if (toggle.checked) return false;
  try { layer.uninstall(map); } catch {}
  if (layer.layers.length > 0) setLayersVisible(map, layer.layers, false);
  return true;
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
        if (settleIfSwitchedOff(map, layer, toggle)) return;
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
  wireScrollPeek();
  updateStackChips();
}

// A scroll strip that hides its scrollbar gives the reader no way to know
// that four more controls are off the right edge. The lens strip is 542px of
// content in a 320px box on a 360px phone: "Rain now", "Cameras", "Live pulse"
// and "Satellite air" were simply not there, with no cue that they existed.
//
// The fade is driven by real scroll state, not a permanent gradient, so a strip
// that fits shows no fade and a strip at either end shows one edge only.
function wireScrollPeek() {
  const strips = [
    document.querySelector(".atlas-place-tasks"),
    document.getElementById("atlas-stack-presets"),
  ].filter(Boolean);
  for (const el of strips) {
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 2) { el.dataset.peek = "none"; el.style.removeProperty("--peek-fade"); return; }
      const atStart = el.scrollLeft <= 2;
      const atEnd = el.scrollLeft >= max - 2;
      el.dataset.peek = atStart ? "right" : atEnd ? "left" : "both";
      // The fade is sized to the overflow it is signalling. A strip clipped by
      // 11px gets an 11px hint, not the full 28px, so the cue never dims more
      // of the control than the clipping actually hides.
      el.style.setProperty("--peek-fade", Math.round(Math.min(28, Math.max(6, max / 2))) + "px");
    };
    el.addEventListener("scroll", update, { passive: true });
    // Fonts and images land after this runs, so the widths can still change.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(update).observe(el);
    }
    update();
  }
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
    if (settleIfSwitchedOff(map, layer, toggle)) return;
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
  // The panel presets and the lens strip on the map are the same control:
  // either one applies the preset and both show which is active.
  const roots = [document.getElementById("atlas-stack-presets"), document.querySelector(".atlas-place-tasks")].filter(Boolean);
  if (!roots.length) return;
  const onClick = async (event) => {
    const btn = event.target.closest("[data-preset]");
    if (!btn) return;
    const preset = btn.dataset.preset;
    document.querySelectorAll("[data-preset]").forEach((el) => {
      const active = el.dataset.preset === preset;
      el.classList.toggle("is-active", active);
      if (el.classList.contains("atlas-lens")) el.setAttribute("aria-pressed", String(active));
    });
    const presets = {
      city: { buildings: true, rail: true, "water-transit": true, traffic: true, cctv: false, khlongs: true, "flood-sensors": true, rain: false, wind: false, aqi: false, aerosol: false, heat: false, flood: false, terrain: false, night: false },
      rain: { buildings: true, rail: true, "water-transit": false, traffic: false, cctv: false, khlongs: false, "flood-sensors": false, rain: true, wind: true, aqi: false, aerosol: false, heat: false, flood: false, terrain: false, night: false },
      aerosol: { buildings: true, rail: false, "water-transit": false, traffic: false, cctv: false, khlongs: true, "flood-sensors": false, rain: false, wind: true, aqi: false, aerosol: true, heat: false, flood: false, terrain: false, night: false },
      // Flood watch: satellite + the living waterway network + judged gauges +
      // the incident heat map (city-events + news + BMA DDS + flood-sensors) +
      // the drainage infrastructure surfaces (canal gates, flooded roads,
      // FloodDash emergency points). The schematic envelope stays off —
      // it is not today's water.
      flood: { buildings: true, rail: false, "water-transit": false, traffic: false, cctv: false, khlongs: true, "flood-sensors": true, "flood-roads": true, "canal-gauges": true, "flood-incidents": false, "canal-gates": true, "roads-flooded": false, "emergency-points": true, rain: false, wind: false, aqi: false, aerosol: false, heat: false, flood: false, terrain: false, night: false },
      pulse: { buildings: true, rail: true, "water-transit": true, traffic: true, cctv: true, khlongs: true, "flood-sensors": true, rain: true, wind: true, aqi: true, aerosol: false, heat: false, flood: false, terrain: false, night: false },
      cameras: { buildings: true, rail: false, "water-transit": false, traffic: true, cctv: true, khlongs: true, "flood-sensors": false, rain: false, wind: false, aqi: false, aerosol: false, heat: false, flood: false, terrain: false, night: false },
    };
    if (!presets[preset]) return;
    // Lenses are exclusive: a layer any preset manages and this one does not
    // mention is switched off. Before, Flood watch's road and gauge layers
    // stayed on under every lens chosen after it.
    const managed = new Set(Object.values(presets).flatMap(Object.keys));
    const wants = Object.fromEntries([...managed].map((id) => [id, presets[preset][id] ?? false]));
    state.nightMode = !!wants.night;
    applyNightMode(map);
    // Water reads only when the buildings step back to monochrome.
    const colorToggle = document.getElementById("toggle-building-color");
    if (colorToggle && colorToggle.checked === (preset === "flood")) {
      colorToggle.checked = preset !== "flood";
      colorToggle.dispatchEvent(new Event("change"));
    }
    // …and the signal-green motorways, which otherwise read as water.
    if (map.getLayer("bkkx-roads-motorway")) {
      map.setPaintProperty("bkkx-roads-motorway", "line-opacity", preset === "flood" ? 0.25 : 1);
    }
    if (wants.buildings) await setLayerToggle(map, "buildings", true);
    // In parallel: one after another, a lens took the sum of every layer's
    // load (Cameras showed its cameras ~14 s after the tap). Stack order is
    // re-applied below, so finishing order does not matter.
    await Promise.all(Object.entries(wants)
      .filter(([id]) => id !== "buildings" && id !== "night")
      .map(([id, on]) => setLayerToggle(map, id, on)));
    ensureStackOrder(map);
    updateStackChips();
  };
  roots.forEach((root) => root.addEventListener("click", onClick));
  state.presetsWired = true;
  if (state.pendingFloodWatch) showTheWater();
  if (state.pendingFloodSim) start72hSimulation(map);
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

  // Two tabs share the sheet: #about and #research.
  const PANES = ["about", "research"];
  const PANE_HEAD = {
    about: ["About", "My city, not theirs"],
    research: ["Research", "How it’s built, and how sure it is"],
  };
  let pane = "about";
  const isPaneHash = () => PANES.includes(window.location.hash.slice(1));

  const setHashAbout = (open) => {
    const url = new URL(window.location.href);
    if (open) {
      if (url.hash !== `#${pane}`) {
        url.hash = pane;
        history.replaceState(null, "", url.toString());
      }
      return;
    }
    if (isPaneHash()) {
      url.hash = "";
      history.replaceState(null, "", url.pathname + url.search);
    }
  };

  const showPane = (next) => {
    pane = PANES.includes(next) ? next : "about";
    sheet.dataset.pane = pane;
    const head = PANE_HEAD[pane];
    const eyebrow = document.getElementById("atlas-about-eyebrow");
    const title = document.getElementById("atlas-about-title");
    if (eyebrow) eyebrow.textContent = head[0];
    if (title) title.textContent = head[1];
    root.querySelectorAll("[data-about-tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.aboutTab === pane));
    });
    PANES.forEach((id) => {
      const el = document.getElementById(`atlas-pane-${id}`);
      if (el) el.hidden = id !== pane;
    });
    if (isOpen()) setHashAbout(true);
  };

  root.querySelectorAll("[data-about-tab]").forEach((tab) => {
    tab.addEventListener("click", () => showPane(tab.dataset.aboutTab));
  });

  const openAbout = (which = "about") => {
    showPane(which);
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
      openAbout(el.dataset.aboutOpen || "about");
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

  if (isPaneHash()) openAbout(window.location.hash.slice(1));
  window.addEventListener("hashchange", () => {
    if (isPaneHash()) openAbout(window.location.hash.slice(1));
    else if (isOpen()) closeAbout();
  });
}

// ─────────────────────────────────────────────────────────────────
// BKK provincial live strip — ThaiWater steal (2026-09-16)
// Renders the 5-card top KPI strip from /api/water/bkk/kpi (provincial
// rain 1d/3d/7d + temperature). Honest degradation: if the upstream is
// down, the values fade to "—" and the freshness dot turns red. Stays
// "loading…" with a yellow dot during the first fetch.
// ─────────────────────────────────────────────────────────────────

function bkkLiveSeverity(mm) {
  if (mm == null || Number.isNaN(Number(mm))) return null;
  const v = Number(mm);
  if (v === 0) return "none";
  if (v < 10) return "light";
  if (v < 35) return "moderate";
  if (v < 90) return "heavy";
  return "very-heavy";
}

function setBkkCardText(cardId, value, whereText, severity) {
  const card = document.querySelector(`.atlas-bkk-card[data-card="${cardId}"]`);
  const valueEl = document.getElementById(`bkk-card-${cardId}-value`);
  const whereEl = document.getElementById(`bkk-card-${cardId}-where`);
  if (!card || !valueEl) return;
  if (severity != null) {
    card.setAttribute("data-severity", severity);
  }
  card.classList.toggle("is-loading", !value && !whereText);
  if (value != null) valueEl.textContent = String(value);
  if (whereText != null && whereEl) whereEl.textContent = whereText;
}

// ─────────────────────────────────────────────────────────────────
// Situation board — the strip under the map. Reads /api/flood/roads
// (areas, hourly, rainTrend) and the ThaiWater gauges per district.
// ─────────────────────────────────────────────────────────────────

/** Wettest live gauge per district (Thai name without เขต), last 3 h of readings. */
async function loadDistrictRain() {
  const gj = await fetchJson("/api/water/bkk/rain-stations");
  const by = new Map();
  for (const f of gj?.features ?? []) {
    const p = f.properties || {};
    const key = String(p.amphoe ?? "").replace(/^เขต/, "").trim();
    const mm = Number(p.rain_24h_mm);
    if (!key || !Number.isFinite(mm) || mm < 0) continue;
    const t = Date.parse(`${String(p.observed_at ?? "").replace(" ", "T")}:00+07:00`);
    if (!Number.isFinite(t) || Date.now() - t > 3 * 3_600_000) continue; // a stale gauge says nothing about today
    const cur = by.get(key);
    if (!cur || mm > cur.mm) by.set(key, { mm, h1: Number(p.rain_1h_mm), station: p.name });
  }
  state.districtRain = by;
  renderSituation(state.floodRoads);
}

function renderSituation(payload) {
  if (!payload) return;
  // Where it is worst.
  const body = document.getElementById("atlas-sit-areas");
  const meta = document.getElementById("atlas-sit-areas-meta");
  if (body && !Array.isArray(payload.areas)) {
    // An older reading without district tallies: wait, never claim "no reports".
    body.innerHTML = `<tr><td colspan="5" class="atlas-sit-empty">Current district totals unavailable — waiting for a fresh reading. This is not an all-clear.</td></tr>`;
  } else if (body) {
    const top = (payload.areas ?? []).filter((a) => a.n3h > 0).slice(0, 8);
    const rain = state.districtRain ?? new Map();
    body.innerHTML = top.length ? top.map((a, i) => {
      const r = rain.get(a.nameTh);
      const diff = a.n1h - a.nPrev1h;
      const trend = diff > 1 ? ["up", `▲ ${a.n1h}`] : diff < -1 ? ["down", `▼ ${a.n1h}`] : ["flat", `● ${a.n1h}`];
      return `<tr data-lng="${a.center?.[0] ?? ""}" data-lat="${a.center?.[1] ?? ""}" tabindex="0" role="button" aria-label="Go to ${escapeHtml(a.nameEn)}">
        <td><span class="atlas-sit-rank">${i + 1}</span><strong lang="th">${escapeHtml(a.nameTh)}</strong> <small>${escapeHtml(a.nameEn)}</small></td>
        <td class="num"><strong>${a.n3h}</strong></td>
        <td><span class="atlas-sit-trend" data-trend="${trend[0]}">${trend[1]}</span></td>
        <td><span class="atlas-sit-depth" data-depth="${a.deepest}">${escapeHtml(a.deepestEn ?? "—")}</span></td>
        <td class="num">${r ? `${r.mm.toFixed(0)}<small> mm</small>` : "—"}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="5" class="atlas-sit-empty">No district has flood reports in the last 3 hours — that is not the same as dry streets.</td></tr>`;
  }
  if (meta) {
    const age = minutesSince(payload.fetchedAt);
    const affected = (payload.areas ?? []).filter((a) => a.n3h > 0).length;
    meta.textContent = `${Array.isArray(payload.areas) ? `${affected} districts with reports` : "District totals unavailable"} · relay ${age == null ? "age unknown" : `${ageWords(age)} ago`}`;
  }

  // Getting worse?
  const hourly = payload.hourly ?? [];
  const bars = document.getElementById("atlas-sit-pulse-bars");
  if (!Array.isArray(payload.hourly)) {
    if (bars) bars.innerHTML = "";
    const n = document.getElementById("atlas-sit-pulse-n");
    const unit = document.getElementById("atlas-sit-pulse-unit");
    const delta = document.getElementById("atlas-sit-pulse-delta");
    if (n) n.textContent = "—";
    if (unit) unit.textContent = "current hourly totals unavailable";
    if (delta) { delta.textContent = "Waiting for a fresh reading — not zero reports."; delta.dataset.trend = "unknown"; }
    // Mirror into the compact quick-stat bar.
    const qp0 = document.getElementById("atlas-quick-pulse");
    const qpd0 = document.getElementById("atlas-quick-pulse-delta");
    if (qp0) qp0.textContent = "—";
    if (qpd0) { qpd0.dataset.trend = "unknown"; qpd0.textContent = "Waiting for a fresh reading — not zero reports."; }
  }
  if (bars && hourly.length) {
    const tot = hourly.map((h) => h.traffy + h.itic);
    const max = Math.max(1, ...tot);
    bars.innerHTML = tot.map((n, i) => `<span style="--h:${(n / max) * 100}%" ${i === tot.length - 1 ? 'class="is-now"' : ""} title="${n} reports"></span>`).join("");
    // The current hour is partial; compare the last full hour with the one before.
    const last = tot[tot.length - 2] ?? 0, before = tot[tot.length - 3] ?? 0, partial = tot[tot.length - 1] ?? 0;
    const n = document.getElementById("atlas-sit-pulse-n");
    if (n) n.textContent = String(last);
    const unit = document.getElementById("atlas-sit-pulse-unit");
    if (unit) unit.textContent = "flood reports in the last full hour";
    const delta = document.getElementById("atlas-sit-pulse-delta");
    if (delta) {
      const d = last - before;
      delta.dataset.trend = d > 2 ? "up" : d < -2 ? "down" : "flat";
      delta.textContent = `${d > 0 ? "▲" : d < 0 ? "▼" : "●"} ${Math.abs(d)} vs the hour before (${before}) · ${partial} so far this hour`;
      // Mirror into the compact quick-stat bar.
      const qp = document.getElementById("atlas-quick-pulse");
      const qpd = document.getElementById("atlas-quick-pulse-delta");
      if (qp) qp.textContent = String(last);
      if (qpd) { qpd.dataset.trend = delta.dataset.trend; qpd.textContent = delta.textContent; }
    }
  }

  // Rain behind it.
  const rt = payload.rainTrend;
  const rb = document.getElementById("atlas-sit-rain-bars");
  if (rb && rt?.series?.length) {
    const max = Math.max(1, ...rt.series.map((d) => d.mm));
    const lastWeek = rt.series.length - 7;
    rb.innerHTML = rt.series.map((d, i) =>
      `<span style="--h:${(d.mm / max) * 100}%" class="${i >= lastWeek ? "is-week" : ""}${i === rt.series.length - 1 ? " is-now" : ""}" title="${escapeHtml(d.day)} · ${d.mm} mm"></span>`).join("");
    const axis = document.getElementById("atlas-sit-rain-axis");
    const fmt = (day) => new Date(`${day}T00:00:00+07:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
    if (axis) axis.innerHTML = `<span>${fmt(rt.series[0].day)}</span><span>peak ${max.toFixed(0)} mm/day</span><span>today (partial)</span>`;
    const week = document.getElementById("atlas-sit-rain-week");
    if (week && rt.wkNowMm != null && rt.wkPrevMm != null) {
      week.dataset.trend = rt.ratio >= 1.3 ? "up" : rt.ratio <= 0.77 ? "down" : "flat";
      week.textContent = `This week ${rt.wkNowMm} mm · last week ${rt.wkPrevMm} mm${rt.ratio != null ? ` · ×${rt.ratio}` : ""}`;
    }
    const band = document.getElementById("atlas-sit-rain-band");
    if (band) band.textContent = rt.band ? `FloodDash: ${rt.band}` : "";
  }
}

// ─────────────────────────────────────────────────────────────────
// Honest cross-reference: road reports × flood sensors (JK World
// Owner rule 2026-10-01). Gauge proximity is context, not proof of road
// flooding or passability. Reports without a nearby fresh sensor go to a closed
// section. Atlas house rule: sharp edges, signal yellow for the
// positive, no shadows or gradients.
// ─────────────────────────────────────────────────────────────────
function renderRoadsXref(payload) {
  const root = document.getElementById("atlas-sit-xref");
  if (!root) return;
  if (!payload || payload.tool !== "bkk-roads-xref") {
    root.hidden = true;
    return;
  }
  root.hidden = false;

  const counts = payload.counts || {};
  const confirmed = payload.confirmed || [];
  const unconfirmed = payload.unconfirmed || [];
  const sensorOnly = payload.sensorOnly || [];

  // Three headline stats.
  const setStat = (id, value, where) => {
    const v = document.getElementById(id);
    const w = document.getElementById(id.replace("-n", "-where"));
    if (v) v.textContent = String(value);
    if (w) w.textContent = where || "—";
  };
  const fmtAge = (iso) => {
    if (!iso) return "—";
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return "—";
    const min = Math.round(ms / 60_000);
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.round(h / 24)} d ago`;
  };
  const ageWords = fmtAge;

  const topConfirmed = confirmed.slice(0, 6);
  setStat(
    "atlas-xref-confirmed-n",
    counts.confirmed ?? 0,
    counts.confirmed
      ? `top: ${topConfirmed[0]?.road || "—"} · ${ageWords(topConfirmed[0]?.latest)}`
      : counts.unconfirmed_no_sensor
      ? "no nearby sensor — the BMA does not publish road-level flood sensors in this feed"
      : counts.unconfirmed_sensor_dry || counts.unconfirmed_sensor_stale
      ? "nearby gauges have no alert or are stale"
      : "—",
  );
  setStat(
    "atlas-xref-sensoronly-n",
    counts.sensor_only ?? 0,
    counts.sensor_only
      ? `top: ${sensorOnly[0]?.name || "—"} · ${sensorOnly[0]?.band_en || sensorOnly[0]?.band || "wet"}`
      : "no wet gauge ahead of the news",
  );
  setStat(
    "atlas-xref-unconfirmed-n",
    counts.unconfirmed_no_sensor + counts.unconfirmed_sensor_stale + counts.unconfirmed_sensor_dry,
    [
      counts.unconfirmed_no_sensor ? `${counts.unconfirmed_no_sensor} no sensor` : null,
      counts.unconfirmed_sensor_stale ? `${counts.unconfirmed_sensor_stale} stale` : null,
      counts.unconfirmed_sensor_dry ? `${counts.unconfirmed_sensor_dry} gauge without alert` : null,
    ].filter(Boolean).join(" · ") || "—",
  );

  // Mirror into the compact quick-stat bar.
  const qc = document.getElementById("atlas-quick-confirmed");
  if (qc) qc.textContent = String(counts.confirmed ?? 0);

  const meta = document.getElementById("atlas-sit-xref-meta");
  if (meta) {
    const age = minutesSince(payload.fetchedAt);
    meta.textContent = `${counts.total_roads ?? 0} road stretches · ${age == null ? "relay age unknown" : `relay ${fmtAge(payload.fetchedAt)}`} · 250 m nearby context`;
  }

  // Confirmed list — short, only the top movers.
  const list = document.getElementById("atlas-sit-xref-confirmed");
  if (list) {
    if (!confirmed.length) {
      list.innerHTML = `<li class="atlas-xref-empty">No recent road report is paired with a fresh nearby gauge alert. ${unconfirmed.length} road stretches remain listed below. Canal and river readings do not establish road depth or passability.</li>`;
    } else {
      list.innerHTML = topConfirmed.map((r) => {
        const g = r.nearest_gauge || {};
        const where = r.road || "un-named road";
        return `<li class="atlas-xref-row" data-lng="${r.center?.[0]}" data-lat="${r.center?.[1]}">
          <span class="atlas-xref-pill atlas-xref-pill-confirmed">${escapeHtml(r.depth_label || "reported flood")} · nearby gauge alert</span>
          <span class="atlas-xref-where">${escapeHtml(where)}</span>
          <span class="atlas-xref-meta">↔ ${g.distance_m ?? "?"} m to <strong>${escapeHtml(g.name || "gauge")}</strong> · ${escapeHtml(g.band_en || g.band || "")}</span>
          <span class="atlas-xref-time">${escapeHtml(ageWords(r.latest))}</span>
        </li>`;
      }).join("");
    }
  }

  // Unconfirmed list — collapsed by default.
  const ul = document.getElementById("atlas-sit-xref-unconfirmed");
  const sum = document.getElementById("atlas-sit-xref-unconf-summary");
  if (ul) {
    const top = unconfirmed.slice(0, 8);
    if (sum) sum.textContent = `📋 Other road reports (${unconfirmed.length})`;
    if (!unconfirmed.length) {
      ul.innerHTML = `<li class="atlas-xref-empty">No other road reports in this snapshot. Unreported streets remain unknown.</li>`;
    } else {
      ul.innerHTML = top.map((r) => {
        const g = r.nearest_gauge;
        const tag =
          r.q === "no-sensor" ? `<span class="atlas-xref-pill atlas-xref-pill-none">📟 no sensor</span>`
          : r.q === "sensor-stale" ? `<span class="atlas-xref-pill atlas-xref-pill-stale">⚠ stale</span>`
          : `<span class="atlas-xref-pill atlas-xref-pill-dry">○ gauge without alert</span>`;
        return `<li class="atlas-xref-row" data-lng="${r.center?.[0]}" data-lat="${r.center?.[1]}">
          ${tag}
          <span class="atlas-xref-where">${escapeHtml(r.road || "un-named road")}</span>
          <span class="atlas-xref-meta">${g ? `${g.distance_m} m to ${escapeHtml(g.name)} (${escapeHtml(g.band_en || g.band)})` : "no road-level sensor within 250 m"}</span>
          <span class="atlas-xref-time">${escapeHtml(ageWords(r.latest))}</span>
        </li>`;
      }).join("");
    }
  }

  state.roadsXref = payload;
}

async function loadRoadsXref() {
  try {
    const r = await fetchJson(ROADS_XREF_URL);
    if (r?.tool === "bkk-roads-xref") renderRoadsXref(r);
    return r;
  } catch (e) {
    console.warn("roads-xref load failed:", e);
    return null;
  }
}

async function loadBkkLiveStrip() {
  const dot = document.querySelector(".atlas-bkk-live-dot");
  const freshness = document.getElementById("atlas-bkk-live-freshness");
  try {
    const res = await fetch("/api/water/bkk/kpi", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const kpi = await res.json();
    if (!kpi || kpi.tool !== "bkk-water-kpi") throw new Error("bad payload");

    const rain = kpi.rain || {};
    for (const key of ["1d", "3d", "7d"]) {
      const card = key === "1d" ? "rain1d" : key === "3d" ? "rain3d" : "rain7d";
      const slice = rain[key] || {};
      const mm = slice.mm == null ? "—" : Number(slice.mm).toFixed(1);
      const where = slice.station
        ? `${slice.station.name}${slice.station.amphoe ? " · " + slice.station.amphoe : ""}`
        : "—";
      setBkkCardText(card, mm, where, bkkLiveSeverity(slice.mm));
      if (key === "1d") {
        // Mirror into the compact quick-stat bar (wettest gauge · 24 h).
        const qr = document.getElementById("atlas-quick-rain");
        const qrw = document.getElementById("atlas-quick-rain-where");
        if (qr) qr.textContent = mm;
        if (qrw) qrw.textContent = where;
      }
    }
    const temp = kpi.temperature;
    if (temp) {
      document.getElementById("bkk-card-temp-max").textContent = Number.isFinite(weatherNumber(temp.max_c)) ? Number(temp.max_c).toFixed(1) : "—";
      document.getElementById("bkk-card-temp-min").textContent = Number.isFinite(weatherNumber(temp.min_c)) ? Number(temp.min_c).toFixed(1) : "—";
      document.getElementById("bkk-card-temp-where").textContent = `${temp.station || "—"} · week from ${temp.start_date || "date unknown"}`;
    }

    // Freshness — how old is the upstream payload?
    const fetched = new Date(kpi.fetchedAt);
    const ageMin = Math.round((Date.now() - fetched.getTime()) / 60000);
    let freshnessText;
    // "live" is a claim: only print it while the reading actually is.
    // Past 5 min the text states the age; past 60 min the dot goes stale.
    if (!Number.isFinite(ageMin) || ageMin < 0) freshnessText = "KPI fetch age unknown";
    else if (ageMin < 1) freshnessText = "KPI fetched · <1 min";
    else if (ageMin < 5) freshnessText = `KPI fetched · ${ageMin} min`;
    else if (ageMin < 60) freshnessText = `${ageMin} min ago`;
    else freshnessText = `${Math.round(ageMin / 60)} h ago`;
    if (freshness) freshness.textContent = freshnessText;
    if (dot) {
      dot.classList.remove("is-stale", "is-down");
      if (!Number.isFinite(ageMin) || ageMin < 0 || ageMin > 60) dot.classList.add("is-stale");
    }
  } catch (error) {
    if (dot) {
      dot.classList.remove("is-stale");
      dot.classList.add("is-down");
    }
    if (freshness) freshness.textContent = "upstream unavailable";
    // Mark every card as error
    for (const id of ["rain1d", "rain3d", "rain7d", "temp"]) {
      const card = document.querySelector(`.atlas-bkk-card[data-card="${id}"]`);
      if (card) card.classList.add("is-error");
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// FloodDash relay — the city verdict, the "Water now" panel and the
// waterway colours all read /api/flood/bkk (src/flooddash.ts). FloodDash's
// words are shown as given; the atlas adds only placement and age.
// ─────────────────────────────────────────────────────────────────

const FLOOD_LEVEL_WORD = { safe: "Safe", watch: "Watch", prepare: "Prepare", danger: "Danger" };

function isFeatureCollection(data) {
  return !!data && data.type === "FeatureCollection" && Array.isArray(data.features);
}

// ─────────────────────────────────────────────────────────────────
// Alerts panel (2026-09-29) — pulls FloodDash's active alerts (level
// changes + flash-flood precursors) for BKK + Chao Phraya upstream.
// Renders the top 5 in the situation board with Thai + English
// messages so a reader can audit why a gauge alarmed.
// ─────────────────────────────────────────────────────────────────

async function refreshAlertsPanel() {
  const listEl = document.getElementById("atlas-alerts-list");
  const headEl = document.getElementById("atlas-alerts-head");
  if (!listEl) return;
  let payload = null;
  try {
    const res = await fetch(ALERTS_URL, { cache: "no-store" });
    if (res.ok) payload = await res.json();
  } catch { /* rendered as unavailable below */ }
  if (!payload || !Array.isArray(payload.items)) {
    if (headEl) headEl.textContent = "Active alerts · FloodDash · unavailable";
    listEl.innerHTML = `<li class="atlas-water-empty">No FloodDash alerts — not an all-clear.</li>`;
    return;
  }
  const items = payload.items.slice(0, 5);
  if (headEl) {
    headEl.textContent = `Active alerts · FloodDash · ${payload.counts?.total ?? payload.items.length} (critical ${payload.counts?.critical ?? 0} · high ${payload.counts?.high ?? 0} · watch ${payload.counts?.watch ?? 0})${payload.fetchedAt ? ` · ${ageWords(minutesSince(payload.fetchedAt))} ago` : ""}`;
  }
  if (!items.length) {
    listEl.innerHTML = `<li class="atlas-water-empty">No active alerts for BKK + upstream right now.</li>`;
    return;
  }
  listEl.innerHTML = items.map((a) => {
    const sev = Number(a.severity) || 0;
    const color = sev >= 4 ? "#dc2626" : sev >= 3 ? "#f97316" : sev >= 2 ? "#facc15" : "#7eb6ff";
    const msg = a.message_en || a.message_th || "Alert";
    const province = a.province_en || a.province_th || "";
    return `
      <li class="atlas-alert" data-severity="${sev}">
        <span class="atlas-alert-dot" style="--band:${color}" aria-hidden="true"></span>
        <span class="atlas-alert-main">
          <strong>${escapeHtml(province || "Alert")} · ${escapeHtml(a.rule || "")}</strong>
          <small>${escapeHtml(msg)}</small>
          <small class="atlas-alert-meta">${escapeHtml(a.source || "")}${a.age_min != null ? ` · ${a.age_min} min ago` : ""}</small>
        </span>
      </li>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────────
// News watch (2026-09-29) — pulls FloodDash's curated flood-news
// feed (gnews_flood: Google News flood filter + Bangkok Post /
// Khaosod / Thai PBS / Reuters). Sits at the very top of the sidebar
// so a person opening the atlas during a flood sees the headlines
// before anything else.
//
// Each item carries a severity chip:
//   - urgent   (red)    — keywords like อพยพ / ด่วน / evacuate / urgent
//   - watch    (orange) — เตือน / ระวัง / flood / rising
//   - advisory (yellow) — อัปเดต / สถานการณ์ / update / advisory
//   - info     (grey)   — anything else
// Trusted sources (Bangkok Post, Khaosod, Thai PBS, Reuters, BBC, …)
// get a "Trusted" pill so a reader can see provenance at a glance.
// ─────────────────────────────────────────────────────────────────

const NEWS_SEVERITY_COLOR = {
  urgent: "#dc2626",
  watch: "#f97316",
  advisory: "#facc15",
  info: "#7d8a9a",
};

const NEWS_SEVERITY_LABEL = {
  urgent: "URGENT",
  watch: "WATCH",
  advisory: "UPDATE",
  info: "INFO",
};

async function refreshNewsWatch() {
  const listEl = document.getElementById("atlas-news-watch-list");
  const headEl = document.getElementById("atlas-news-watch-meta");
  const noteEl = document.getElementById("atlas-news-watch-note");
  if (!listEl) return;
  let payload = null;
  try {
    const res = await fetch(NEWS_WATCH_URL, { cache: "no-store" });
    if (res.ok) payload = await res.json();
  } catch { /* rendered as unavailable below */ }
  if (!payload || !Array.isArray(payload.items)) {
    if (headEl) headEl.textContent = "FloodDash · unavailable";
    listEl.innerHTML = `<li class="atlas-news-empty">FloodDash news feed unavailable.</li>`;
    if (noteEl) noteEl.textContent = "";
    return;
  }
  const items = payload.items.slice(0, 8);
  const c = payload.counts ?? {};
  if (headEl) {
    const sev = [];
    if (c.urgent) sev.push(`${c.urgent} urgent`);
    if (c.watch) sev.push(`${c.watch} watch`);
    headEl.textContent =
      `FloodDash · ${c.total ?? items.length} · ${sev.join(" · ") || "all routine"}` +
      (payload.fetchedAt ? ` · ${ageWords(minutesSince(payload.fetchedAt))} ago` : "");
  }
  if (!items.length) {
    listEl.innerHTML = `<li class="atlas-news-empty">No headlines returned by this feed. This is not an all-clear.</li>`;
    if (noteEl) noteEl.textContent = payload.attribution || "";
    return;
  }
  listEl.innerHTML = items.map((n) => {
    const sev = n.severity || "info";
    const color = NEWS_SEVERITY_COLOR[sev] || NEWS_SEVERITY_COLOR.info;
    const label = NEWS_SEVERITY_LABEL[sev] || "INFO";
    const ageMin = n.published_at ? minutesSince(n.published_at) : null;
    const ageTxt = ageMin == null ? "feed time unknown" : `feed: ${ageMin < 1 ? "<1 min" : `${Math.round(ageMin)} min`}`;
    const domain = n.source_domain || "link";
    return `
      <li class="atlas-news-item" data-severity="${escapeHtml(sev)}">
        <a class="atlas-news-link" href="${escapeHtml(safeHttpUrl(n.link || "#"))}" target="_blank" rel="noreferrer noopener">
          <span class="atlas-news-chip" style="--band:${color}">${escapeHtml(label)}</span>
          <span class="atlas-news-title" lang="th">${escapeHtml(n.title || "")}</span>
          <span class="atlas-news-meta">
            <span class="atlas-news-domain">${escapeHtml(domain)}</span>
            <span class="atlas-news-age">${ageTxt}</span>
          </span>
        </a>
      </li>`;
  }).join("");
  if (noteEl) {
    noteEl.textContent = `FloodDash news search results. Feed age is not event age; older stories and locations outside Bangkok can appear. Open the publisher to verify date and place. Keyword labels are not official alerts.`;
  }
  // Re-apply phone-only collapsed state (1 headline + "Show all"
  // toggle) every time the list is rebuilt.
  collapseNewsWatch();
}

const SOURCE_STATUS_COLOR = {
  ok: "#10b981",
  degraded: "#f97316",
  stale: "#dc2626",
  skipped: "#7d8a9a",
};

async function refreshSourcesHealthPanel() {
  const gridEl = document.getElementById("atlas-sources-grid");
  const headEl = document.getElementById("atlas-sources-head");
  if (!gridEl) return;
  let payload = null;
  try {
    const res = await fetch(SOURCES_HEALTH_URL, { cache: "no-store" });
    if (res.ok) payload = await res.json();
  } catch { /* rendered as unavailable below */ }
  if (!payload || !Array.isArray(payload.items)) {
    if (headEl) headEl.textContent = "Upstream feeds · FloodDash · unavailable";
    gridEl.innerHTML = `<div class="atlas-water-empty">FloodDash ingest health unavailable.</div>`;
    return;
  }
  if (headEl) {
    const c = payload.counts || {};
    headEl.textContent = `Ingest health · FloodDash · ${c.total ?? payload.items.length} (ok ${c.ok ?? 0} · degraded ${c.degraded ?? 0} · stale ${c.stale ?? 0} · skipped ${c.skipped ?? 0})${payload.fetchedAt ? ` · snapshot ${ageWords(minutesSince(payload.fetchedAt))} ago` : ""} · Not sensor freshness`;
  }
  // Show the worst first (the renderer already sorted them). Cap at
  // 18 for a tight grid; the full list lives in the panel source.
  const items = payload.items.slice(0, 18);
  gridEl.innerHTML = items.map((s) => {
    const color = SOURCE_STATUS_COLOR[s.status] || SOURCE_STATUS_COLOR.skipped;
    return `
      <div class="atlas-source-cell" data-status="${escapeHtml(s.status)}" title="${escapeHtml(s.label_th || s.label_en || s.key)} · ${escapeHtml(s.last_error || s.status)}">
        <span class="atlas-source-dot" style="--band:${color}" aria-hidden="true"></span>
        <span class="atlas-source-label">${escapeHtml(s.label_en || s.label_th || s.key)}</span>
      </div>`;
  }).join("");
}

// ─────────────────────────────────────────────────────────────────
// Life-safety and livelihood decision module (Google Weather + TimesFM)
// ─────────────────────────────────────────────────────────────────
async function fetchBrowserWeather() {
  // Same public model already used by Atlas wind/heat. No key or fabricated data.
  const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=13.76&longitude=100.50&current=temperature_2m&hourly=precipitation,precipitation_probability&forecast_days=2&timezone=UTC", { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Weather unavailable");
  const data = await res.json();
  const raw = data.current?.time;
  const ms = typeof raw === "string" ? Date.parse(raw.endsWith("Z") ? raw : `${raw}Z`) : NaN;
  const age = Date.now() - ms;
  if (!Number.isFinite(age) || age < -300000 || age > 7200000) throw new Error("Model time unavailable");
  const hourlyNowcast = [];
  for (let i = 0; i < (data.hourly?.time?.length ?? 0); i++) {
    const rawTime = data.hourly.time[i];
    if (typeof rawTime !== "string") continue;
    const time = Date.parse(rawTime.endsWith("Z") ? rawTime : `${rawTime}Z`);
    if (!Number.isFinite(time) || time < Date.now() || time > Date.now() + 21600000) continue;
    const mm = data.hourly.precipitation?.[i], p = data.hourly.precipitation_probability?.[i];
    hourlyNowcast.push({ validAtUtc: new Date(time).toISOString(), precipitationMm: typeof mm === "number" && Number.isFinite(mm) && mm >= 0 ? mm : null, precipitationProbabilityPct: typeof p === "number" && p >= 0 && p <= 100 ? p : null });
  }
  return { tier: "model", source: "Open-Meteo model (direct browser fallback)", observationTimeUtc: new Date(ms).toISOString(), hourlyNowcast };
}

async function refreshSafetyModule() {
  const metaEl = document.getElementById("atlas-safety-meta");
  const elecValEl = document.getElementById("safety-electrocution-val");
  const manValEl = document.getElementById("safety-manhole-val");
  const shopValEl = document.getElementById("safety-shophouse-val");

  const motoBadgeEl = document.getElementById("veh-moto-status");
  const sedanBadgeEl = document.getElementById("veh-sedan-status");
  const pickupBadgeEl = document.getElementById("veh-pickup-status");

  try {
    const [weatherRes, timesfmRes] = await Promise.all([
      fetchJson("/api/weather/google").catch(() => fetchBrowserWeather()),
      fetchJson("/api/predict/timesfm").catch(() => ({ configured: false })),
    ]);

    if (weatherRes?.lifeSafety) {
      const ls = weatherRes.lifeSafety;
      if (elecValEl && ls.electrocutionRisk) {
        elecValEl.textContent = String(ls.electrocutionRisk.level).toUpperCase();
      }
      if (manValEl && ls.manholeSuctionHazard) {
        manValEl.textContent = String(ls.manholeSuctionHazard.level).toUpperCase();
      }
      if (ls.vehiclePassability) {
        const vp = ls.vehiclePassability;
        if (motoBadgeEl && vp.motorcycle) {
          motoBadgeEl.textContent = String(vp.motorcycle.status).toUpperCase();
          motoBadgeEl.className = `atlas-veh-badge is-${vp.motorcycle.status}`;
        }
        if (sedanBadgeEl && vp.sedan) {
          sedanBadgeEl.textContent = String(vp.sedan.status).toUpperCase();
          sedanBadgeEl.className = `atlas-veh-badge is-${vp.sedan.status}`;
        }
        if (pickupBadgeEl && vp.highClearancePickup) {
          pickupBadgeEl.textContent = String(vp.highClearancePickup.status).toUpperCase();
          pickupBadgeEl.className = `atlas-veh-badge is-${vp.highClearancePickup.status}`;
        }
      }
    }

    if (shopValEl) shopValEl.textContent = "Not calculated";
    if (timesfmRes?.configured && timesfmRes?.livelihoodSummary) {
      const ls = timesfmRes.livelihoodSummary;
      if (shopValEl && ls.shophouseProtectionWindowHours) {
        shopValEl.textContent = `~${ls.shophouseProtectionWindowHours} h lead`;
      }
    } else if (weatherRes?.livelihood?.shophouseProtection?.leadTimeHours != null) {
      if (shopValEl) {
        shopValEl.textContent = `~${weatherRes.livelihood.shophouseProtection.leadTimeHours} h lead`;
      }
    }

    if (metaEl) {
      metaEl.textContent = ["model", "model-cache"].includes(weatherRes?.tier)
        ? `${weatherRes.source}${weatherRes.tier === "model-cache" ? " (cached)" : ""} · ${weatherRes.observationTimeUtc} · road safety unknown`
        : "Weather unavailable · road safety unknown";
    }
    const hoursEl = document.getElementById("atlas-weather-hours");
    if (hoursEl) hoursEl.textContent = (weatherRes?.hourlyNowcast ?? []).map((h) => `${h.validAtUtc}: ${h.precipitationMm == null ? "unknown" : h.precipitationMm + " mm"} rain · ${h.precipitationProbabilityPct == null ? "probability unknown" : h.precipitationProbabilityPct + "%"}`).join(" | ") || "Hourly forecast unavailable";
  } catch (err) {
    for (const el of [elecValEl, manValEl, motoBadgeEl, sedanBadgeEl, pickupBadgeEl]) if (el) { el.textContent = "UNKNOWN"; el.className = "atlas-veh-badge"; }
    if (shopValEl) shopValEl.textContent = "Not calculated";
    if (metaEl) metaEl.textContent = "Weather unavailable · road safety unknown";
    console.warn("Safety module refresh failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────
// Gauge trend (2026-09-29) — track each FloodDash gauge's last few
// readings on the client so the situation board can show
// "Chao Phraya +5 cm since last reading". Cap at 4 entries per gauge
// so the memory stays bounded.
// ─────────────────────────────────────────────────────────────────

const GAUGE_TREND_CAP = 4;

function recordGaugeTrends(features) {
  if (!Array.isArray(features) || !state.gaugeTrend) return [];
  const movers = [];
  for (const f of features) {
    const p = f.properties || {};
    const id = p.id;
    const level = Number(p.levelMsl ?? p.level_msl);
    if (!id || !Number.isFinite(level)) continue;
    let history = state.gaugeTrend.get(id);
    if (!history) {
      history = [];
      state.gaugeTrend.set(id, history);
    }
    const prev = history.length ? history[history.length - 1] : null;
    history.push({ ts: Date.now(), level });
    if (history.length > GAUGE_TREND_CAP) history.splice(0, history.length - GAUGE_TREND_CAP);
    if (prev && Number.isFinite(prev.level)) {
      const delta = level - prev.level;
      if (Math.abs(delta) >= 0.02) { // >= 2 cm
        movers.push({
          id,
          name: p.nameEn || p.name_en || p.name || id,
          district: p.districtNameEn || p.district_name_en || "",
          band: p.band || p.bandEn || "",
          level,
          delta,
        });
      }
    }
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, 6);
}

function renderGaugeTrendPanel(movers) {
  const el = document.getElementById("atlas-gauge-trend");
  const sectionEl = document.getElementById("atlas-sit-trend");
  const metaEl = document.getElementById("atlas-sit-trend-meta");
  if (!el) return;
  // Auto-hide the whole section when there's nothing to show — a
  // permanent "No recent changes" placeholder takes vertical space
  // and tells the reader nothing new. The section re-appears the
  // moment a gauge moves.
  if (!movers || !movers.length) {
    el.innerHTML = "";
    if (sectionEl) sectionEl.hidden = true;
    return;
  }
  if (sectionEl) sectionEl.hidden = false;
  if (metaEl) metaEl.textContent = `${movers.length} moved ≥2 cm since last reading`;
  el.innerHTML = movers.map((m) => {
    const sign = m.delta > 0 ? "▲" : "▼";
    const cls = m.delta > 0 ? "rising" : "falling";
    const cm = (m.delta * 100).toFixed(0); // level is in metres, convert to cm
    const cmAbs = Math.abs(cm);
    return `
      <li class="atlas-gauge-trend" data-band="${escapeHtml(m.band)}">
        <span class="atlas-trend-arrow ${cls}" aria-hidden="true">${sign}</span>
        <span class="atlas-trend-main">
          <strong>${escapeHtml(m.name)}</strong>
          <small>${escapeHtml(m.district || "")}</small>
        </span>
        <span class="atlas-trend-delta ${cls}">${cmAbs} cm</span>
      </li>`;
  }).join("");
}

// A failed fetch keeps the last picture. A valid empty collection clears it:
// the water going down must leave the map, and an empty feed is still not an all-clear.
async function refreshMountedFloodLayers(map) {
  if (!map) return;
  const apply = async (sourceId, url, onData) => {
    if (!map.getSource(sourceId)) return;
    const data = await fetchJson(url);
    if (!isFeatureCollection(data)) return;
    map.getSource(sourceId).setData(data);
    onData(data);
  };

  await apply(CANAL_GATE_SOURCE, CANAL_GATES_URL, (data) => {
    const counts = data.counts ?? {};
    setLayerStatus(
      "canal-gates",
      data.features.length
        ? `BMA DDS bulletin · ${counts.total ?? data.features.length} stations (critical ${counts.critical ?? 0} · warning ${counts.warning ?? 0} · normal ${counts.normal ?? 0})`
        : "unavailable · DDS bulletin empty — not an all-clear",
    );
  });

  await apply(ROADS_FLOODED_SOURCE, ROADS_FLOODED_URL, (data) => {
    state.roadsFloodedGeojson = data;
    const counts = data.counts ?? {};
    const byStatus = counts.byStatus ?? {};
    const bySev = counts.bySeverity ?? {};
    setLayerStatus(
      "roads-flooded",
      data.features.length
        ? `BMA DDS · ${counts.total ?? data.features.length} road reports (severe ${bySev.severe ?? 0} · moderate ${bySev.moderate ?? 0} · shallow ${bySev.shallow ?? 0} · cleared ${byStatus["reported-cleared"] ?? 0})`
        : "unavailable · DDS road feed empty — not an all-clear",
    );
  });

  await apply(EMERGENCY_SOURCE, EMERGENCY_URL, (data) => {
    const total = data.counts?.total ?? data.features.length;
    setLayerStatus(
      "emergency-points",
      data.features.length
        ? `FloodDash · ${total} emergency points (BKK + 30 km halo · confirmed + reported)`
        : "unavailable · no FloodDash emergency points — not an all-clear",
    );
  });

  await apply(INCIDENT_SOURCE, INCIDENTS_URL, (data) => {
    const counts = data.counts ?? {};
    const bySource = counts.bySource ?? {};
    setLayerStatus(
      "flood-incidents",
      data.features.length
        ? `ThaiWater/FloodDash/BMA DDS · ${counts.total ?? data.features.length} incidents (city ${bySource.city ?? 0} · news ${bySource.news ?? 0} · dds ${bySource.dds ?? 0} · gauge ${bySource.sensor ?? 0})`
        : "unavailable · incident feed returned 0",
    );
  });

  await apply(DAM_SOURCE, DAMS_URL, (data) => {
    const counts = data.counts ?? {};
    setLayerStatus(
      "dams",
      data.features.length
        ? `FloodDash · ${counts.total ?? data.features.length} dams (critical ${counts.critical ?? 0} · warning ${counts.warning ?? 0} · watch ${counts.watch ?? 0} · safe ${counts.safe ?? 0})`
        : "unavailable · no FloodDash dam reading — not an all-clear",
    );
  });

  await apply(MAHOLAN_CCTV_SOURCE, MAHOLAN_CCTV_URL, (data) => {
    const counts = data.counts ?? {};
    const total = counts.total ?? data.features.length;
    const live = counts.live ?? 0;
    setLayerStatus(
      "cctv",
      data.features.length ? cameraStatus(data) : "unavailable · camera list empty — not an all-clear",
    );
  });

  // Side panels — alerts (text) + sources-health (40 upstream feeds).
  // Both are panel-only; the map already has the coloured markers via
  // the layers above. We refresh them here so the situation board
  // tells the truth every 5 minutes, on the same cadence as the map.
  await refreshAlertsPanel();
  await refreshNewsWatch();
  await refreshSourcesHealthPanel();
  await refreshSafetyModule();

  state.lastFloodRefreshAt = new Date().toISOString();
  // Live attribution chip — answers "is the data fresh?" with a real age.
  const freshEl = document.getElementById("atlas-flood-credit-fresh");
  if (freshEl) {
    const ageMin = minutesSince(state.lastFloodRefreshAt);
    freshEl.textContent = "see each layer's source timestamp; refresh completion is not observation time";
  }
}

async function loadFloodRelay() {
  let payload = null;
  try {
    const res = await fetch(FLOOD_BKK_URL, { cache: "no-store" });
    if (res.ok) payload = await res.json();
  } catch { /* rendered as unavailable below */ }
  if (payload?.tool === "flood-bkk") state.flood = payload;
  renderFloodVerdict(payload?.tool === "flood-bkk" ? payload : state.flood);
  renderWaterPanel(state.flood);
  renderBasinProfile(state.flood?.gauges || []);
  applyWaterwayStatus(state.map);
  // Keep the gauge layer on the same reading as the verdict.
  const src = state.map?.getSource(FLOOD_SENSOR_SOURCE);
  if (src && payload?.tool === "flood-bkk") {
    const data = await fetchJson(FLOOD_SENSOR_LIVE_URL);
    if (data?.features) {
      src.setData(data);
      // Record the readings so the situation board can show "Chao
      // Phraya +5 cm since last reading". The trend survives across
      // refreshes; only new readings are added.
      const movers = recordGaugeTrends(data.features);
      renderGaugeTrendPanel(movers);
      renderBasinProfile(data.features);
    }
  }
  // Canal gates, DDS roads, emergency points and incident heat stay mounted
  // after the first toggle. Replace them from the same reading, including a
  // valid empty collection, so a recovery is not left painted on the map.
  await refreshMountedFloodLayers(state.map);
  computeFloodCamJoin();
}

function currentFloodVerdict(flood, now = Date.now()) {
  const v = flood?.verdict;
  const age = (time) => {
    if (typeof time !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(time)) return null;
    const value = (now - Date.parse(time)) / 60000;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  return v && flood.parts?.twin?.ok &&
    [v.updated, flood.fetchedAt, flood.parts.twin.at].every(t => {
      const a = age(t); return a !== null && a <= 30;
    }) ? v : null;
}

function renderFloodVerdict(flood) {
  const root = document.getElementById("atlas-flood-verdict");
  if (!root) return;
  root.hidden = false;
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text || "";
      el.hidden = !text;
    }
  };
  const v = currentFloodVerdict(flood);
  if (!v) {
    const old = flood?.lastKnownVerdict ?? flood?.verdict;
    root.dataset.level = "none";
    root.classList.toggle("is-stale", Boolean(old));
    set("atlas-flood-verdict-level", old ? "Historical warning" : "No current reading");
    set("atlas-flood-verdict-head", "Current conditions unknown · ยังยืนยันสถานการณ์ปัจจุบันไม่ได้ — not an all-clear.");
    set("atlas-flood-verdict-time", old ? `Previous verdict timestamp: ${old.updated || 'unknown'}` : "");
    set("atlas-flood-verdict-reason", old ? `Previous assessment: ${old.headEn || old.level}. ${old.reasonEn || ''}` : "");
    set("atlas-flood-verdict-reason-th", old?.reasonTh ? `ข้อมูลย้อนหลัง: ${old.reasonTh}` : "");
    set("atlas-flood-verdict-meta", `${old ? `Previous verdict timestamp: ${old.updated || 'unknown'} · ` : ''}Follow current official warnings; road passability remains unknown. · ${FLOOD_DUTY}`);
    return;
  }
  const age = minutesSince(v.updated);
  root.dataset.level = v.level;
  root.classList.toggle("is-stale", false);
  set("atlas-flood-verdict-level", FLOOD_LEVEL_WORD[v.level] || v.level);
  set("atlas-flood-verdict-head", `${v.headEn} · ${v.headTh}`);
  set("atlas-flood-verdict-time", `Verdict generated: ${v.updated}`);
  set("atlas-flood-verdict-reason", v.reasonEn);
  set("atlas-flood-verdict-reason-th", v.reasonTh);
  const facts = [];
  if (v.stationsL5) facts.push(`${v.stationsL5} gauge${v.stationsL5 > 1 ? "s" : ""} overflowing`);
  if (v.stationsL4) facts.push(`${v.stationsL4} at high water`);
  if (v.rain24hMm != null) facts.push(`worst 24 h rain ${Math.round(v.rain24hMm)} mm`);
  if (v.etaHours != null) facts.push(`bank may be reached in ~${v.etaHours} h at this rise`);
  facts.push(`FloodDash verdict generated ${ageWords(age)} ago · individual observation ages vary`);
  facts.push(FLOOD_DUTY);
  set("atlas-flood-verdict-meta", facts.join(" · "));
}

function renderWaterPanel(flood) {
  const liveLine = document.getElementById("atlas-research-live");
  if (liveLine && flood) {
    const silent = flood.gauges.filter((g) => !FLOOD_RANK[g.band]).length;
    liveLine.textContent =
      `Stored snapshot: ${flood.gauges.length} gauges in the metro box, ${flood.gauges.length - silent} marked reporting, ` +
      `${silent} silent or untrusted; ${Object.keys(flood.waterways).length} waterway segments judged; ` +
      `Relay fetched ${ageWords(minutesSince(flood.fetchedAt))} ago; check each observation's age.`;
  }
  const root = document.getElementById("atlas-water");
  if (!root || !flood) return;
  root.hidden = false;
  const current = currentFloodVerdict(flood);
  const serious = current && (current.level === "prepare" || current.level === "danger");
  const details = document.getElementById("atlas-water-details");
  if (details && serious && !details.dataset.touched) details.open = true;

  const gaugesEl = document.getElementById("atlas-water-gauges");
  if (gaugesEl) {
    const relayAge = minutesSince(flood.fetchedAt) ?? 0;
    const top = flood.gauges.filter((g) => (FLOOD_RANK[g.band] ?? 0) >= 3);
    gaugesEl.innerHTML = top.length
      ? top.map((g) => `
        <li>
          <button type="button" class="atlas-water-row" data-lng="${g.lng}" data-lat="${g.lat}" style="--band:${FLOOD_BAND_COLOR[g.band] || FLOOD_BAND_COLOR["no-signal"]}">
            <span class="atlas-gauge-swatch" aria-hidden="true"></span>
            <span class="atlas-water-row-main">
              <strong>${escapeHtml(g.bandEn)}</strong> ${escapeHtml(g.name)}
              <small>${escapeHtml(g.waterwayName || g.river || "")}${Number.isFinite(g.riseMH) ? ` · ${g.riseMH >= 0 ? "rising" : "falling"} ${(Math.abs(g.riseMH) * 100).toFixed(1)} cm/h` : ""}${g.confidence === "stale" ? ` · stale, ${ageWords((g.ageMin ?? 0) + relayAge)} old` : ""}</small>
            </span>
          </button>
        </li>`).join("")
      : `<li class="atlas-water-empty">No gauge at prepare or worse. Gauges cover the waterways, not every street.</li>`;
  }

  const roadsEl = document.getElementById("atlas-water-roads");
  if (roadsEl) {
    const r = flood.roads;
    const head = document.getElementById("atlas-water-roads-head");
    if (head) head.textContent = `Roads reported flooded · BMA DDS${r.days?.length ? ` · ${r.days.join(", ")}` : ""}${r.stale ? " · stale" : ""}`;
    roadsEl.innerHTML = r.byDistrict.length
      ? r.byDistrict.map((d) => `
        <li class="atlas-water-road">
          <span>${escapeHtml(d.nameEn)} <small lang="th">${escapeHtml(d.nameTh)}</small></span>
          <span class="atlas-water-road-n">${d.reports} report${d.reports > 1 ? "s" : ""}${d.maxDepthCm != null ? ` · to ${d.maxDepthCm} cm` : ""}${d.clearanceUnrecorded ? ` · ${d.clearanceUnrecorded} clearance not recorded` : ""}</span>
        </li>`).join("")
      : `<li class="atlas-water-empty">No road reports in DDS for these days.</li>`;
  }

  const gatesEl = document.getElementById("atlas-water-gates");
  if (gatesEl) {
    const c = flood.canals;
    const head = document.getElementById("atlas-water-gates-head");
    if (head) head.textContent = `Canal gates · BMA DDS bulletin${c.date ? ` · ${c.date}` : ""}${c.stale ? " · stale" : ""}`;
    gatesEl.innerHTML = c.stations.map((g) => `
      <li class="atlas-water-road" data-status="${escapeHtml(g.status)}">
        <span lang="th">${escapeHtml(g.name)}</span>
        <span class="atlas-water-road-n">${g.levelMsl != null ? `${g.levelMsl.toFixed(2)} m` : "—"}${g.marginM != null ? ` · ${g.marginM >= 0 ? `${g.marginM.toFixed(2)} m under` : `${Math.abs(g.marginM).toFixed(2)} m over`} critical` : ""} · <span lang="th">${escapeHtml(g.statusTh)}</span></span>
      </li>`).join("");
  }

  // Emergency points — fetched separately because they live on the
  // FloodDash emergency feed, not the relay. Surface the headline so a
  // person reading the panel can verify what the system is reacting to.
  renderEmergencyPanel();
}

async function renderEmergencyPanel() {
  const listEl = document.getElementById("atlas-water-emergency");
  const headEl = document.getElementById("atlas-water-emergency-head");
  if (!listEl) return;
  let payload = null;
  try {
    const res = await fetch(EMERGENCY_URL, { cache: "no-store" });
    if (res.ok) payload = await res.json();
  } catch { /* rendered as unavailable below */ }
  if (!payload || !Array.isArray(payload.features) || payload.features.length === 0) {
    if (headEl) headEl.textContent = `Emergency points · FloodDash · unavailable`;
    listEl.innerHTML = `<li class="atlas-water-empty">No FloodDash emergency points for BKK + 30 km halo right now.</li>`;
    return;
  }
  // Pin the BKK-only entries to the top; halo entries below. Each row
  // shows the headline that put the point on the map, so a reader can
  // audit the source.
  const bkkFeatures = payload.features.filter((f) => (f.properties?.province || "").toLowerCase().includes("bangkok"));
  const haloFeatures = payload.features.filter((f) => !bkkFeatures.includes(f));
  const ordered = [...bkkFeatures, ...haloFeatures];
  if (headEl) {
    headEl.textContent = `Emergency points · FloodDash · ${payload.counts?.total ?? payload.features.length} (BKK ${bkkFeatures.length} · 30 km halo ${haloFeatures.length})${payload.stale ? " · stale" : ""}`;
  }
  listEl.innerHTML = ordered.map((f) => {
    const p = f.properties || {};
    const tier = p.tier === "confirmed" ? "confirmed" : p.tier === "sensor" ? "sensor" : "reported";
    const band = p.band === "high" ? "high" : p.band === "watch" ? "watch" : "low";
    const impacts = Array.isArray(p.impacts) ? p.impacts : [];
    const impactsLabel = impacts
      .slice(0, 2)
      .map((i) => `<span lang="th">${escapeHtml(i.th || "")}</span>`)
      .join(" · ");
    const firstNews = Array.isArray(p.news) && p.news.length > 0 ? p.news[0] : null;
    const newsTitle = firstNews?.title || "";
    const newsLink = firstNews?.link || "";
    const newsCount = Number(p.news_count ?? (Array.isArray(p.news) ? p.news.length : 0));
    return `
      <li class="atlas-water-emergency" data-band="${escapeHtml(band)}" data-tier="${escapeHtml(tier)}">
        <button type="button" class="atlas-water-row" data-lng="${f.geometry.coordinates[0]}" data-lat="${f.geometry.coordinates[1]}" style="--band:${band === "high" ? "#dc2626" : band === "watch" ? "#f97316" : "#facc15"}">
          <span class="atlas-gauge-swatch" aria-hidden="true"></span>
          <span class="atlas-water-row-main">
            <strong>${escapeHtml(p.name || "Emergency")}</strong>
            <small>${escapeHtml(p.province || "")}${p.depth_cm != null ? ` · ${p.depth_cm} cm` : ""} · ${tier} · ${newsCount} news</small>
            ${impactsLabel ? `<small>${impactsLabel}</small>` : ""}
            ${newsTitle ? `<small class="atlas-water-emergency-news">${newsLink ? `<a href="${escapeHtml(safeHttpUrl(newsLink))}" target="_blank" rel="noreferrer">${escapeHtml(newsTitle)}</a>` : escapeHtml(newsTitle)}</small>` : ""}
          </span>
        </button>
      </li>`;
  }).join("");
}

// Same order as src/flooddash.ts BAND_RANK.
const FLOOD_RANK = { "no-signal": 0, untrusted: 0, safe: 1, watch: 2, prepare: 3, evacuate: 4, "overflow-imminent": 5, "observed-overflow": 6 };

function wireWaterPanel() {
  const details = document.getElementById("atlas-water-details");
  details?.addEventListener("toggle", () => { details.dataset.touched = "1"; });
  const sitLong = document.getElementById("atlas-sit-long");
  sitLong?.addEventListener("toggle", () => {
    const meta = document.getElementById("atlas-sit-long-meta");
    if (meta) meta.textContent = sitLong.open ? "open" : "collapsed";
  });
  const sitAreas = document.getElementById("atlas-sit-areas");
  const goArea = (event) => {
    const row = event.target.closest("tr[data-lng]");
    if (!row || !row.dataset.lng || !state.map) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!state.layerOn["flood-roads"]) setLayerToggle(state.map, "flood-roads", true);
    state.map.flyTo({ center: [Number(row.dataset.lng), Number(row.dataset.lat)], zoom: 13.5, pitch: 50, essential: true });
    document.getElementById("atlas-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  sitAreas?.addEventListener("click", goArea);
  sitAreas?.addEventListener("keydown", goArea);
  document.getElementById("atlas-water-streets")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-lng]");
    if (!btn || !state.map) return;
    state.map.flyTo({ center: [Number(btn.dataset.lng), Number(btn.dataset.lat)], zoom: 16, pitch: 55, essential: true });
  });
  document.getElementById("atlas-water-gauges")?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-lng]");
    if (!btn || !state.map) return;
    state.map.flyTo({ center: [Number(btn.dataset.lng), Number(btn.dataset.lat)], zoom: 15, pitch: 50, essential: true });
  });
  document.getElementById("atlas-flood-verdict-show")?.addEventListener("click", () => {
    // Tapped before the map finished loading: wireStackPresets runs it later.
    if (!state.presetsWired) {
      state.pendingFloodWatch = true;
      return;
    }
    showTheWater();
  });
  document.getElementById("atlas-flood-verdict-sim")?.addEventListener("click", () => {
    if (!state.presetsWired) {
      state.pendingFloodSim = true;
      return;
    }
    start72hSimulation(state.map);
  });
}

function showTheWater() {
  document.querySelector('#atlas-stack-presets [data-preset="flood"]')?.click();
  // One camera move, to where the water is. (A second, instant fitBounds on
  // moveend used to throw the view out to Chonburi — the "snap back".)
  flyToFloodedRoads();
  // Reveal the Water now panel if folded.
  const waterPanel = document.getElementById("atlas-water");
  if (waterPanel?.hidden) waterPanel.hidden = false;
  const waterDetails = document.getElementById("atlas-water-details");
  if (waterDetails && !waterDetails.open) waterDetails.open = true;
  document.getElementById("atlas-map")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─────────────────────────────────────────────────────────────────
// Phone-only "More" sheet (2026-09-30) — the phone layout hides the
// right-side panel by default (it's a bottom sheet, off-screen
// via transform: translateY(100%)). A floating "More …" button
// toggles the sheet via .is-open. The counter on the button shows
// how many items are inside, so the reader knows whether the sheet
// is worth opening. The sheet itself is the regular `.atlas-panel`
// — no new content, just a different surface on phone.
//
// On phones the news-watch list collapses to the first headline
// with a "Show all N headlines" toggle, so the sheet doesn't
// become a 60-line scroll of khaosod.co.th links.
// ─────────────────────────────────────────────────────────────────

function wirePhonePanelToggle() {
  const btn = document.getElementById("atlas-panel-toggle");
  const panel = document.getElementById("atlas-panel");
  const newsList = document.getElementById("atlas-news-watch-list");
  const moreBtn = document.getElementById("atlas-news-watch-more");
  if (!btn || !panel) return;

  // Phone only — bail early on desktop.
  if (window.matchMedia("(min-width: 721px)").matches) return;

  const isPhone = () => window.matchMedia("(max-width: 720px)").matches;

  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    btn.classList.toggle("is-hidden", open);
    btn.setAttribute("aria-expanded", String(open));
    if (open) {
      document.body.style.overflow = "hidden";
      panel.setAttribute("aria-hidden", "false");
    } else {
      document.body.style.overflow = "";
      panel.setAttribute("aria-hidden", "true");
    }
  }

  btn.addEventListener("click", () => setOpen(!panel.classList.contains("is-open")));

  // Close the sheet when the sticky close row at its top is tapped
  // (the ::before pseudo can't listen, so wire a real button).
  panel.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-sheet]")) setOpen(false);
  });
  // Esc closes the sheet
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) setOpen(false);
  });

  // Collapse news-watch to the 1st headline + a "Show all" toggle.
  // Re-applies every time refreshNewsWatch rebuilds the list.
  function refreshCollapsedNews() {
    if (!newsList) return;
    if (isPhone()) {
      newsList.classList.add("atlas-news-watch-list-collapsed");
    } else {
      newsList.classList.remove("atlas-news-watch-list-collapsed");
    }
  }
  refreshCollapsedNews();
  window.addEventListener("resize", refreshCollapsedNews);
  // Expose so refreshNewsWatch can re-call it after each refresh
  state._refreshCollapsedNews = refreshCollapsedNews;

  // "Show all headlines" button — expands the collapsed news list
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      newsList?.classList.remove("atlas-news-watch-list-collapsed");
    });
  }

  // Update the count on the floating "More …" button so the reader
  // knows how many items are inside the sheet.
  function updatePanelToggleCount() {
    if (!btn) return;
    const newsItems = newsList?.querySelectorAll(".atlas-news-item")?.length ?? 0;
    const sitMods = document.querySelectorAll(".atlas-sit-mod").length;
    const newsCount = newsList?.querySelectorAll(".atlas-news-item").length ?? 0;
    const total = newsCount + sitMods;
    if (total > 0) {
      const countEl = btn.querySelector(".count");
      if (countEl) countEl.textContent = String(total);
      btn.classList.remove("is-hidden");
    }
  }
  updatePanelToggleCount();
  // Re-run after the news-watch builds
  const newsObserver = new MutationObserver(updatePanelToggleCount);
  if (newsList) newsObserver.observe(newsList, { childList: true });
}

function collapseNewsWatch() {
  // Called by refreshNewsWatch after each rebuild so the
  // phone-only collapsed state survives a 5-min refresh.
  if (typeof state._refreshCollapsedNews === "function") state._refreshCollapsedNews();
}

// ─────────────────────────────────────────────────────────────────
// Live presence — anonymous per-tab counter (JK World pattern).
// Generates a session id, pings every 60 s, displays in the header.
// ─────────────────────────────────────────────────────────────────
const ATLAS_SESSION_KEY = "atlas-presence-session";
function getOrCreateSessionId() {
  try {
    let id = localStorage.getItem(ATLAS_SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) || `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(ATLAS_SESSION_KEY, id);
    }
    return id;
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
async function pingPresence() {
  const el = document.getElementById("atlas-presence");
  if (!el) return;
  try {
    const sessionId = getOrCreateSessionId();
    const r = await fetch("/api/presence/ping", {
      method: "POST",
      headers: { "x-atlas-session": sessionId, "accept": "application/json" },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    el.textContent = `· 👥 ${j.online.toLocaleString()} online · peak ${j.peak.toLocaleString()} today`;
    el.hidden = false;
  } catch {
    // A failed ping is fine — the chip just stays hidden. The atlas never
    // depends on this counter; it is social proof, not a control.
    el.hidden = true;
  }
}

async function init() {
  const data = await fetchAreas();
  state.areas = data.areas;

  renderQuickJump(state.areas);
  const versionBadge = document.getElementById("atlas-version");
  if (versionBadge) versionBadge.title = `Build ${ATLAS_BUILD} — the commit and time this page was released`;
  wireAboutDrawer();
  document.getElementById("atlas-share").addEventListener("click", copyDeepLink);

  // Live presence — ping on load and every 60 s (JK World pattern).
  pingPresence();
  setInterval(pingPresence, 60_000);

  // Kick off the BKK provincial live strip — runs in the background and
  // refreshes every 5 minutes (matching the upstream cache TTL). Stolen
  // from bangkok.thaiwater.net/dashboard's 5-card top pattern.
  loadBkkLiveStrip();
  setInterval(loadBkkLiveStrip, 5 * 60 * 1000);
  wireWaterPanel();
  wirePhonePanelToggle();
  loadFloodRelay();
  setInterval(loadFloodRelay, FLOOD_REFRESH_MS);
  // Expire the on-screen verdict even when network refreshes fail or stall.
  setInterval(() => renderFloodVerdict(state.flood), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderFloodVerdict(state.flood);
  });
  // The situation board needs the flood-roads reading even with the layer off.
  const refreshSituation = async () => {
    if (state.map?.getSource(FLOOD_ROADS_SOURCE)) await refreshFloodRoadsLayer();
    else await loadFloodRoadsPayload();
  };
  refreshSituation();
  loadDistrictRain();
  setInterval(refreshSituation, 2 * 60_000);
  setInterval(loadDistrictRain, 5 * 60_000);

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
    canvasContextAttributes: { antialias: true }, // v5+: moved out of MapOptions
    hash: false,
    attributionControl: { compact: true },
  });
  wireCameraWall(map);

  // External fly-to (e.g. bkk's quarter chip loaded the atlas with
  // ?at=lng,lat,zoom). Fires after the map is built so the camera
  // override is the last word.
  if (externalAt && !initialId) {
    map.once("load", () => {
      map.flyTo({ center: externalAt.center, zoom: externalAt.zoom, pitch: 60, bearing: 0, speed: 1.1, essential: true });
    });
  }

  state.map = map;
  // ?debug exposes the live state for console inspection; nothing else reads it.
  if (new URLSearchParams(location.search).has("debug")) {
    window.__atlas = state;
    // The layer registry too. Opt-in layers cannot be turned on from the state
    // object, so without this a render check can only report "not installed" and
    // cannot tell a layer that never works from one nobody switched on.
    window.__atlas.LAYERS = LAYERS;
    // The massing layer renders from a closure. Without this a render check can
    // only see that it draws nothing, not which early-return stops it.
    window.__atlas.massing = massingDebugState;
    window.__atlas.cityForms = cityFormsDebugState;
    window.__atlas.setLayer = async (id, on) => {
      const entry = LAYERS.find((l) => l.id === id);
      if (!entry) throw new Error(`unknown layer ${id}`);
      if (on) await entry.install(map);
      else entry.uninstall?.(map);
      return !!map.getLayer((entry.layers || [])[0]);
    };
  }

  // The map container is a CSS-grid `1fr` row whose height depends on the
  // header's `auto` row, which depends on webfont metrics. If MapLibre reads
  // the container before Sao Chingcha swaps in, it captures the wrong height
  // and never hears about the correction — the canvas paints into a corner
  // of a black box. A ResizeObserver on the container is the actual fix:
  // it fires on the layout settle, on the font swap, on orientation change,
  // and on the mobile stack, none of which reliably fire `window.resize`.
  const mapEl = document.getElementById("atlas-map");
  if (typeof ResizeObserver !== "undefined" && mapEl) {
    let last = 0;
    new ResizeObserver(() => {
      const h = mapEl.clientHeight;
      if (h && h !== last) {
        last = h;
        map.resize();
      }
    }).observe(mapEl);
  }
  // Belt and braces: the two moments the observer can miss on old engines.
  map.once("load", () => map.resize());
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => map.resize());
  }

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
    addPinLayers(map);
    wireInspect(map);
    if (initialArea) setActiveArea(initialArea.id);
  });

  window.addEventListener("hashchange", () => {
    const id = parseHashId();
    if (id && id !== state.activeId) flyToArea(id, { updateHash: false });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopWaterFlow();
    } else if (state.map && state.map.getLayer(KHLONG_FLOW_LAYER) && state.map.getLayoutProperty(KHLONG_FLOW_LAYER, "visibility") !== "none") {
      startWaterFlow(state.map);
    }
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

// ── Camera wall ────────────────────────────────────────────────────────
// A full-screen grid of the cameras in Bangkok, Nonthaburi and the ring
// around them. Pattern and the streaming discipline (attach HLS only while
// a tile is on screen, cap concurrent players) taken from FloodDash's
// camera wall, flood.nonarkara.org — github.com/Nonarkara/FloodDash,
// public/js/layers/cctvWall.js. iTIC tiles play video; Maholan tiles show
// one still through /api/snap, taken when the wall opens.
const WALL_BBOX = { minLat: 13.48, maxLat: 14.15, minLon: 100.25, maxLon: 100.98 }; // BKK + Nonthaburi + ring
const WALL_MAX_LIVE = 12; // ponytail: hard cap, from FloodDash; raise only if bandwidth allows
const wallPlayers = new Map(); // video → Hls | true (native)
const wallVisible = new Set(); // videos on screen; a freed slot goes to the next one waiting
const wallMediaCleanup = new Map();

function inWallBox(f) {
  const [lon, lat] = f?.geometry?.coordinates ?? [];
  return lat >= WALL_BBOX.minLat && lat <= WALL_BBOX.maxLat && lon >= WALL_BBOX.minLon && lon <= WALL_BBOX.maxLon;
}

async function wallCameras() {
  const [itic, maholan] = await Promise.all([
    state.cctvGeojson?.features?.length ? state.cctvGeojson : fetchLiveCctv(),
    state.maholanCctv ?? fetchJson(MAHOLAN_CCTV_URL),
  ]);
  const video = (itic?.features ?? []).filter((f) => inWallBox(f) && f.properties?.hls).map((f) => ({
    kind: "video", id: f.properties.id, name: f.properties.title || f.properties.id,
    org: f.properties.org || "iTIC", hls: f.properties.hls, coords: f.geometry.coordinates,
  }));
  const rank = { ok: 0, unknown: 1, indeterminate: 1 };
  const stills = (maholan?.features ?? [])
    .filter((f) => inWallBox(f) && f.properties?.picture !== "none")
    .sort((a, b) => (rank[a.properties.picture] ?? 2) - (rank[b.properties.picture] ?? 2))
    .map((f) => ({
      kind: "still", id: f.properties.id, name: f.properties.name || f.properties.id,
      org: f.properties.upstream_source || "Maholan", checked: f.properties.picture === "ok",
      category: f.properties.category, viewer: f.properties.viewer_url, coords: f.geometry.coordinates,
      tier: f.properties.tier,
    }));
  return [...video, ...stills];
}

function wallDetach(video, refill = true) {
  const p = wallPlayers.get(video);
  wallMediaCleanup.get(video)?.();
  wallMediaCleanup.delete(video);
  wallPlayers.delete(video);
  if (p && p !== true) { try { p.destroy(); } catch {} }
  try { video.pause(); } catch {}
  video.removeAttribute("src");
  try { video.load(); } catch {}
  if (!video.dataset.failed) video.parentElement.querySelector('.atlas-wall-state').textContent = 'Video · paused off screen';
  if (refill && !document.hidden) for (const v of wallVisible) if (!wallPlayers.has(v) && !v.dataset.failed) { wallAttach(v); break; }
}

function wallAttach(video) {
  const badge = video.parentElement.querySelector(".atlas-wall-state");
  if (document.hidden || !wallVisible.has(video)) return;
  if (wallPlayers.has(video) || video.dataset.failed) return;
  if (wallPlayers.size >= WALL_MAX_LIVE) { badge.textContent = `Video · waiting for a free slot (${WALL_MAX_LIVE} play at once)`; return; }
  const src = video.dataset.hls;
  badge.textContent = "Video · loading";
  const failed = () => { if (!wallMediaCleanup.has(video)) return; video.dataset.failed = "1"; badge.textContent = "Video unavailable · not an all-clear"; wallDetach(video); };
  const playing = () => { if (wallPlayers.has(video)) badge.textContent = 'Video playing · capture time unverified'; };
  video.addEventListener('error',failed);
  video.addEventListener('playing',playing);
  const cleanup = ()=>{video.removeEventListener('error',failed);video.removeEventListener('playing',playing);};
  wallMediaCleanup.set(video,cleanup);
  const Hls = window.Hls;
  if (Hls && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: false, lowLatencyMode: false, maxBufferLength: 8 });
    wallPlayers.set(video, hls);
    hls.on(Hls.Events.ERROR, (_e, d) => { if (d?.fatal && wallPlayers.get(video) === hls) failed(); });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    wallPlayers.set(video, true);
  } else return failed();
  video.play().catch(() => { if (wallMediaCleanup.get(video) === cleanup) { failed(); badge.textContent = 'Playback blocked or unavailable · not an all-clear'; } });
}

function wallTile(c) {
  const name = escapeHtml(c.name.replace(/^\(กรุงเทพมหานคร\)\s*/, ""));
  const org = escapeHtml(c.org);
  if (c.kind === "video") {
    return `<figure class="atlas-wall-tile" data-id="${escapeHtml(c.id)}">
      <div class="atlas-wall-media"><video muted playsinline autoplay data-hls="${escapeHtml(c.hls)}"></video>
      <span class="atlas-wall-state">Video · loading when on screen</span><span class="atlas-wall-cat atlas-wall-cat-itic">iTIC</span></div>
      <figcaption><button type="button" class="atlas-wall-go" data-lon="${c.coords[0]}" data-lat="${c.coords[1]}">${name}</button><small>${org}</small></figcaption></figure>`;
  }
  const cat = { itic: "iTIC", government: "Gov", other: "Other" }[c.category] || "Other";
  const tier = c.tier === 'operator' ? 'Operator source' : c.tier === 'community' ? 'Community · unvetted' : 'Provenance unverified';
  const trafficCandidate = c.tier === 'operator' && /แยก|ถนน|intersection|junction|\broad\b/i.test(c.name) && !/ระดับน้ำ|water level|gauge/i.test(c.name);
  return `<figure class="atlas-wall-tile" data-id="${escapeHtml(c.id)}" data-traffic-eligible="${trafficCandidate ? 'true' : 'false'}">
    <div class="atlas-wall-media"><img loading="lazy" alt="Camera still: ${name} · capture time unverified" referrerpolicy="no-referrer" src="/api/snap/${encodeURIComponent(c.id)}?w=320" />
    <span class="atlas-wall-state">${c.checked ? "Still · capture time unverified" : "Still · picture and capture time unverified"}</span><span class="atlas-wall-cat atlas-wall-cat-${escapeHtml(c.category || "other")}">${cat}</span></div>
    <figcaption><button type="button" class="atlas-wall-go" data-lon="${c.coords[0]}" data-lat="${c.coords[1]}">${name}</button><small>${org} · ${tier}${c.viewer && safeHttpUrl(c.viewer) !== '#' ? ` · <a href="${escapeHtml(safeHttpUrl(c.viewer))}" target="_blank" rel="noopener">viewer ↗</a>` : ""}</small></figcaption></figure>`;
}

function wireCameraWall(map) {
  const warningToggle = document.getElementById('atlas-warning-expand');
  warningToggle?.addEventListener('click',()=>{
    const expanded = warningToggle.getAttribute('aria-expanded') !== 'true';
    warningToggle.setAttribute('aria-expanded',String(expanded));
    document.getElementById('atlas-flood-verdict')?.classList.toggle('is-expanded',expanded);
    warningToggle.textContent = expanded ? 'Collapse warning' : 'Read full warning';
  });
  const root = document.createElement("section");
  root.className = "atlas-wall";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Camera wall");
  root.innerHTML = `<header class="atlas-wall-head">
      <div><p class="atlas-eyebrow">Bangkok · Nonthaburi · surroundings</p><h2>Camera wall</h2>
      <small class="atlas-wall-count" aria-live="polite">Loading cameras…</small></div>
      <button type="button" class="atlas-wall-close">Close</button></header>
    <div class="atlas-wall-grid"></div>
    <p class="atlas-wall-credit">Up to ${WALL_MAX_LIVE} videos play while visible; paused when this page is hidden. Stills load on demand and may be cached; capture time is unverified. No automatic still refresh. A dark tile is not an all-clear. Wall pattern from <a href="https://flood.nonarkara.org" target="_blank" rel="noopener">FloodDash</a>; cameras from iTIC and the Maholan registry.</p>`;
  document.body.appendChild(root);
  const grid = root.querySelector(".atlas-wall-grid");
  const count = root.querySelector(".atlas-wall-count");
  let observer = null;
  let lastFocus = null;
  let requestId = 0;
  let disposeTrafficPilot = () => {};
  const page = document.querySelector('.atlas-page');
  let pageWasInert = false;

  const close = () => {
    if (root.hidden) return;
    requestId++;
    disposeTrafficPilot();
    observer?.disconnect();
    wallVisible.clear();
    for (const v of [...wallPlayers.keys()]) wallDetach(v);
    grid.innerHTML = "";
    root.hidden = true;
    if (page) page.inert = pageWasInert;
    document.body.classList.remove("atlas-wall-open");
    lastFocus?.focus?.({ preventScroll: true });
  };
  const open = async () => {
    if (!root.hidden) return;
    const thisRequest = ++requestId;
    lastFocus = document.activeElement;
    pageWasInert = page?.inert ?? false;
    if (page) page.inert = true;
    root.hidden = false;
    document.body.classList.add("atlas-wall-open");
    root.querySelector(".atlas-wall-close").focus();
    count.textContent = "Loading cameras…";
    let cams;
    try { cams = await wallCameras(); } catch {
      if (thisRequest === requestId && !root.hidden) count.textContent = 'Camera catalogue unavailable · not an all-clear';
      return;
    }
    if (root.hidden || thisRequest !== requestId) return;
    const v = cams.filter((c) => c.kind === "video").length;
    count.textContent = cams.length
      ? `${cams.length} cameras · ${v} video · ${cams.length - v} stills`
      : "No cameras reachable right now · not an all-clear";
    grid.innerHTML = cams.map(wallTile).join("");
    // Research-only until manually evaluated on Bangkok camera footage.
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('trafficPilot') === '1') {
      disposeTrafficPilot = installTrafficPilot(grid, { enabled: true });
    }
    grid.querySelectorAll("img").forEach((img) => img.addEventListener("error", () => {
      img.parentElement.querySelector(".atlas-wall-state").textContent = "No picture · not an all-clear";
      img.remove();
    }, { once: true }));
    observer = new IntersectionObserver((entries) => {
      if (root.hidden || thisRequest !== requestId) return;
      for (const e of entries) {
        if (e.isIntersecting) { wallVisible.add(e.target); wallAttach(e.target); }
        else { wallVisible.delete(e.target); if (wallPlayers.has(e.target)) wallDetach(e.target); }
      }
    }, { root: grid, rootMargin: "0px", threshold: 0.01 });
    grid.querySelectorAll("video").forEach((el) => observer.observe(el));
  };

  root.querySelector(".atlas-wall-close").addEventListener("click", close);
  grid.addEventListener("click", (e) => {
    const go = e.target.closest(".atlas-wall-go");
    if (!go) return;
    close();
    map.flyTo({ center: [Number(go.dataset.lon), Number(go.dataset.lat)], zoom: 16.5, pitch: 55, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1000 });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !root.hidden) close(); });
  root.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll('button:not([disabled]),a[href]')];
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });
  document.addEventListener('visibilitychange',()=>{
    if(root.hidden) return;
    if(document.hidden) for(const v of [...wallPlayers.keys()]) wallDetach(v,false);
    else for(const v of wallVisible) wallAttach(v);
  });
  document.querySelectorAll("[data-wall-open]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); open(); }));
}
