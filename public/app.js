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

// Rattanakosin (Old Town) high-zoom PMTiles. 9,275 features covering
// 100.49–100.52 E, 13.74–13.76 N (Grand Palace, Wat Pho, Wat Phra
// Kaew, Wat Suthat, the royal field). Zoom 14–18 — way past the
// metro-level PMTiles' maxzoom 15, so individual temple buildings
// stay sharp and you can see the ordination halls' geometry.
const BKKX_RATTANAKOSIN_PMTILES_URL = "/bkk-buildings-rattanakosin.pmtiles";
const BKKX_RATTANAKOSIN_PMTILES_LAYER = "bkkx-pmtiles-rattanakosin";
const RATTANAKOSIN_BUILDINGS_LAYER = "bkkx-rattanakosin-buildings";

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
const MIN_HEIGHT_GET = [
  "coalesce",
  ["get", "render_min_height"],
  ["get", "min_height"],
  0,
];

const BUILDING_HEIGHT_EXPRESSION = HEIGHT_GET;
const BUILDING_MIN_HEIGHT_EXPRESSION = MIN_HEIGHT_GET;

// 3D buildings — monochrome (signal yellow) for the default atlas mode.
const BUILDING_PAINT_MONOCHROME = {
  "fill-extrusion-color": "#c9ff38",
  "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
  "fill-extrusion-base": BUILDING_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": [
    "interpolate", ["linear"], ["zoom"],
    11, 0.32,
    13, 0.55,
    15, 0.7,
    17, 0.82,
  ],
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
  "fill-extrusion-opacity": [
    "interpolate", ["linear"], ["zoom"],
    11, 0.42,
    13, 0.65,
    15, 0.78,
    17, 0.9,
  ],
  "fill-extrusion-vertical-gradient": true,
};

// Rattanakosin Old Town — same type-color logic, plus higher opacity
// at every zoom (the layer is only visible at zoom 14+ so we don't
// need to ramp it up gradually).
const RATTANAKOSIN_BUILDING_PAINT_BY_TYPE = {
  "fill-extrusion-color": BUILDING_COLOR_BY_TYPE,
  "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
  "fill-extrusion-base": BUILDING_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": 0.92,
  "fill-extrusion-vertical-gradient": true,
};
const RATTANAKOSIN_BUILDING_PAINT_MONOCHROME = {
  "fill-extrusion-color": "#c9ff38",
  "fill-extrusion-height": BUILDING_HEIGHT_EXPRESSION,
  "fill-extrusion-base": BUILDING_MIN_HEIGHT_EXPRESSION,
  "fill-extrusion-opacity": 0.82,
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

// Treasury Department land appraisal price (ราคาประเมินที่ดิน).
// 2024–2028 assessment, aggregated from 2.28M parcels to 477 UTMMAP3
// zones across Bangkok. Display positions are approximate rectangular
// grids inside map-sheet bboxes (see scripts/rebuild-land-price-positions.py)
// — NOT cadastral centroids. Replace with RTSD polygons when available.
const LAND_PRICE_SOURCE = "bkkx-land-price";
const LAND_PRICE_FILL = "bkkx-land-price-fill";
const LAND_PRICE_LINE = "bkkx-land-price-line";
const LAND_PRICE_DATA_URL = "/bkk-land-price.geojson";

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

// Colour ramp steps (Thai Baht per square wah). Tuned to the 2024–2028
// Bangkok distribution: median 24k, top decile starts at ~100k, top 1%
// starts at ~250k, max ~435k. Vivid enough to read against the
// monochrome satellite base.
const LAND_PRICE_COLOR_RAMP = [
  "step", ["coalesce", ["get", "price_per_wah"], 0],
  "#fef9c3", 20000,
  "#fde047", 50000,
  "#fbbf24", 100000,
  "#f97316", 200000,
  "#dc2626", 350000,
  "#7f1d1d",
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
  rainFramePath: null,
  rainLastFetch: 0,
  inspectMarker: null,
  trafficSource: null, // "live" | "sample" | null
  landPriceFeatures: null, // cached for client-side nearest (laptop / API fallback)
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
  "bkkx-3d-buildings",
  RATTANAKOSIN_BUILDINGS_LAYER,
  "bkkx-roads-minor",
  "bkkx-roads-major",
  "bkkx-roads-motorway",
  KHLONG_RIVER_LAYER,
  KHLONG_CANAL_LAYER,
  RAIL_LAYER,
  TRAFFIC_LAYER,
  LAND_PRICE_FILL,
  FLOOD_FILL,
  FLOOD_LINE,
  HEAT_LAYER,
  HEAT_CIRCLE_LAYER,
  AQI_LAYER,
  AQI_CIRCLE_LAYER,
  RAIN_LAYER,
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
      ? ["interpolate", ["linear"], ["zoom"], 11, 0.28, 13, 0.48, 15, 0.62, 17, 0.72]
      : (state.buildingPaint === "type"
        ? BUILDING_PAINT_BY_TYPE["fill-extrusion-opacity"]
        : BUILDING_PAINT_MONOCHROME["fill-extrusion-opacity"]);
    if (map.getLayer("bkkx-3d-buildings")) {
      try { map.setPaintProperty("bkkx-3d-buildings", "fill-extrusion-opacity", buildingOpacity); } catch {}
    }
    if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
      try {
        map.setPaintProperty(
          RATTANAKOSIN_BUILDINGS_LAYER,
          "fill-extrusion-opacity",
          weatherOn ? 0.72 : (state.buildingPaint === "type" ? 0.92 : 0.82),
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
  if (state.nightMode && map.getLayer("bkkx-3d-buildings")) {
    try {
      map.setPaintProperty("bkkx-3d-buildings", "fill-extrusion-color", [
        "interpolate", ["linear"], ["zoom"],
        11, "#c9ff38",
        14, "#ffb84d",
        17, "#ffe08a",
      ]);
      map.setPaintProperty("bkkx-3d-buildings", "fill-extrusion-opacity", [
        "interpolate", ["linear"], ["zoom"],
        11, 0.45, 13, 0.7, 15, 0.88, 17, 0.95,
      ]);
    } catch {}
  } else if (map.getLayer("bkkx-3d-buildings")) {
    applyBuildingPaint(map);
  }

  if (state.nightMode && map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    try {
      map.setPaintProperty(RATTANAKOSIN_BUILDINGS_LAYER, "fill-extrusion-color", "#ffe08a");
      map.setPaintProperty(RATTANAKOSIN_BUILDINGS_LAYER, "fill-extrusion-opacity", 0.95);
    } catch {}
  } else if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    applyRattanakosinPaint(map);
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
    khlongs: "Khlongs",
    terrain: "Terrain",
    "land-price": "Land ฿",
    flood: "Flood",
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
    layers: ["bkkx-3d-buildings", RATTANAKOSIN_BUILDINGS_LAYER, "bkkx-satellite", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway"],
    install: async (map) => { installBuildings(map); installRattanakosin(map); ensureStackOrder(map); },
    uninstall: (map) => { setLayersVisible(map, ["bkkx-3d-buildings", RATTANAKOSIN_BUILDINGS_LAYER, "bkkx-satellite", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway"], false); },
    legend: [
      { color: "#f5b800", label: "temple / pagoda" },
      { color: "#a8c84a", label: "mosque" },
      { color: "#c89b3c", label: "church / cathedral" },
      { color: "#3b82f6", label: "school" },
      { color: "#1e40af", label: "university" },
      { color: "#10b981", label: "hospital" },
      { color: "#ec4899", label: "hotel" },
      { color: "#a855f7", label: "museum" },
      { color: "#fef3c7", label: "commercial / retail" },
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
    description: "RainViewer · last 2 hours",
    defaultOn: false,
    softUninstall: true,
    layers: [RAIN_LAYER],
    install: async (map) => { await installRain(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [RAIN_LAYER], false),
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
    id: "land-price",
    name: "Land price (ราคาประเมิน)",
    description: "Treasury 2024–2028 · ฿/sq.wah",
    defaultOn: false,
    softUninstall: true,
    layers: [LAND_PRICE_FILL],
    install: async (map) => { await installLandPrice(map); ensureStackOrder(map); },
    uninstall: (map) => setLayersVisible(map, [LAND_PRICE_FILL], false),
    legend: [
      { color: "#fef9c3", label: "< 20,000 ฿" },
      { color: "#fde047", label: "20k–50k ฿" },
      { color: "#fbbf24", label: "50k–100k ฿" },
      { color: "#f97316", label: "100k–200k ฿" },
      { color: "#dc2626", label: "200k–350k ฿" },
      { color: "#7f1d1d", label: "350k+ ฿" },
    ],
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
  return raw || null;
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

function installBuildings(map) {
  registerPmtilesProtocol();

  if (!map.getSource(BKKX_BUILDINGS_PMTILES_LAYER)) {
    try {
      map.addSource(BKKX_BUILDINGS_PMTILES_LAYER, {
        type: "vector",
        url: "pmtiles://" + BKKX_BUILDINGS_PMTILES_URL,
        attribution: "© OpenStreetMap contributors (ODbL-1.0) · BKKx 3D buildings",
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
  if (!source.isPmtiles && !map.getLayer("bkkx-roads-minor")) {
    const addLine = (id, filter, color, width, opacity) => {
      try {
        map.addLayer({
          id,
          type: "line",
          source: sourceName,
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

  if (!map.getLayer("bkkx-3d-buildings")) {
    try {
      map.addLayer({
        id: "bkkx-3d-buildings",
        type: "fill-extrusion",
        source: sourceName,
        "source-layer": sourceLayer,
        minzoom: 11,
        paint: state.buildingPaint === "type" ? BUILDING_PAINT_BY_TYPE : BUILDING_PAINT_MONOCHROME,
      });
    } catch {
      // ignore — style schema may omit extrusion; the layer just won't render
    }
  } else {
    applyBuildingPaint(map);
  }
}

function applyBuildingPaint(map) {
  if (map.getLayer("bkkx-3d-buildings")) {
    const paint = state.buildingPaint === "type" ? BUILDING_PAINT_BY_TYPE : BUILDING_PAINT_MONOCHROME;
    for (const [key, value] of Object.entries(paint)) {
      try { map.setPaintProperty("bkkx-3d-buildings", key, value); } catch {}
    }
  }
  if (map.getLayer(RATTANAKOSIN_BUILDINGS_LAYER)) {
    applyRattanakosinPaint(map);
  }
}

function uninstallBuildings(map) {
  for (const id of ["bkkx-3d-buildings", "bkkx-roads-minor", "bkkx-roads-major", "bkkx-roads-motorway", "bkkx-satellite"]) {
    if (map.getLayer(id)) try { map.removeLayer(id); } catch {}
  }
  for (const id of ["bkkx-esri-imagery", BKKX_BUILDINGS_PMTILES_LAYER]) {
    if (map.getSource(id)) try { map.removeSource(id); } catch {}
  }
}

// Rattanakosin high-zoom detail layer. Activated when zoom >= 14
// and the buildings layer is on. Sits on top of the metro PMTiles
// (which only goes to zoom 15) and continues the rendering up to
// zoom 18 with full building geometry.
function installRattanakosin(map) {
  if (!map.getSource(BKKX_RATTANAKOSIN_PMTILES_LAYER)) {
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
      map.addLayer({
        id: RATTANAKOSIN_BUILDINGS_LAYER,
        type: "fill-extrusion",
        source: BKKX_RATTANAKOSIN_PMTILES_LAYER,
        "source-layer": "buildings",
        minzoom: 14,
        paint: state.buildingPaint === "type"
          ? RATTANAKOSIN_BUILDING_PAINT_BY_TYPE
          : RATTANAKOSIN_BUILDING_PAINT_MONOCHROME,
      });
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
  if (map.getSource(BKKX_RATTANAKOSIN_PMTILES_LAYER)) try { map.removeSource(BKKX_RATTANAKOSIN_PMTILES_LAYER); } catch {}
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
  if (el) el.textContent = text;
}

// ─────────────────────────────────────────────────────────────────
// Rain radar (RainViewer)
// ─────────────────────────────────────────────────────────────────

async function fetchRainManifest() {
  const res = await fetch(RAIN_MANIFEST, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

async function installRain(map) {
  if (map.getLayer(RAIN_LAYER) && state.rainFramePath) {
    setLayersVisible(map, [RAIN_LAYER], true);
    if (Date.now() - state.rainLastFetch >= 5 * 60_000) {
      // Refresh tiles in background; keep current frame visible.
      fetchRainManifest().then((manifest) => {
        const latest = manifest?.radar?.past?.[manifest.radar.past.length - 1];
        if (latest?.path) {
          state.rainFramePath = latest.path;
          state.rainLastFetch = Date.now();
          setRainTiles(map, latest.path);
        }
      }).catch(() => {});
    }
    applyOverlayCompositing(map);
    return;
  }
  if (Date.now() - state.rainLastFetch < 5 * 60_000 && state.rainFramePath) {
    setRainTiles(map, state.rainFramePath);
    ensureStackOrder(map);
    return;
  }
  const manifest = await fetchRainManifest();
  if (!manifest?.radar?.past?.length) {
    setLayerStatus("rain", "unavailable · RainViewer failed");
    console.warn("RainViewer manifest returned no past frames");
    return;
  }
  const latest = manifest.radar.past[manifest.radar.past.length - 1];
  const path = latest.path;
  state.rainFramePath = path;
  state.rainLastFetch = Date.now();
  setRainTiles(map, path);
  setLayerStatus("rain", "RainViewer · latest · overzoom from z7");
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
// Land price (Treasury Department 2024-2028)
// ─────────────────────────────────────────────────────────────────

async function installLandPrice(map) {
  if (map.getLayer(LAND_PRICE_FILL)) {
    setLayersVisible(map, [LAND_PRICE_FILL], true);
    return;
  }
  let geojson;
  try {
    const res = await fetch(LAND_PRICE_DATA_URL, { cache: "force-cache" });
    if (!res.ok) {
      console.warn(`Land price GeoJSON returned ${res.status}`);
      setLayerStatus("land-price", "unavailable · geojson failed");
      return;
    }
    geojson = await res.json();
    if (geojson?.features) state.landPriceFeatures = geojson.features;
  } catch (error) {
    console.warn("Land price fetch failed:", error);
    setLayerStatus("land-price", "unavailable · fetch failed");
    return;
  }
  if (!map.getSource(LAND_PRICE_SOURCE)) {
    try {
      map.addSource(LAND_PRICE_SOURCE, { type: "geojson", data: geojson });
    } catch (error) {
      console.warn("Land price source failed:", error);
      return;
    }
  }
  try {
    map.addLayer({
      id: LAND_PRICE_FILL,
      type: "circle",
      source: LAND_PRICE_SOURCE,
      minzoom: 10,
      paint: {
        // Keep dots small at city scale so the sheet-grid layout reads
        // as a scatter, not as merged columns.
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, 3,
          12, 4.5,
          14, 7,
          16, 11,
          18, 16,
        ],
        "circle-color": LAND_PRICE_COLOR_RAMP,
        "circle-opacity": 0.72,
        "circle-stroke-color": "#11120f",
        "circle-stroke-width": 0.6,
        "circle-stroke-opacity": 0.75,
      },
    });
    setLayerStatus("land-price", "Treasury 2024–2028 · approx. sheet grid");
  } catch (error) {
    console.warn("Land price layer failed:", error);
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
// Inspect — click building + nearest Treasury land-price zone
// ─────────────────────────────────────────────────────────────────

const INSPECT_BUILDING_LAYERS = ["bkkx-3d-buildings", RATTANAKOSIN_BUILDINGS_LAYER];

function formatBaht(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${Number(n).toLocaleString("en-US")} ฿`;
}

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
  const type = p.building ?? p.building_type ?? p.class ?? "yes";
  const height = p.render_height ?? p.height ?? null;
  const minH = p.render_min_height ?? p.min_height ?? null;
  const osmId = p.osm_id ?? p.id ?? p["@id"] ?? null;
  const rows = [
    ["Type", String(type)],
    ["Height", height != null ? `${height} m` : "—"],
    ["Base", minH != null && Number(minH) > 0 ? `${minH} m` : "0 m"],
  ];
  if (osmId != null) rows.push(["OSM id", String(osmId)]);
  return rows;
}

async function fetchNearestLandPrice(lng, lat) {
  try {
    const res = await fetch(`/api/land-price?lng=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`, {
      cache: "no-store",
    });
    if (res.ok) return await res.json();
  } catch {
    /* fall through to client nearest — laptop / offline path */
  }
  return nearestLandPriceClient(Number(lng), Number(lat));
}

function haversineMeters(lng1, lat1, lng2, lat2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function ensureLandPriceFeatures() {
  if (state.landPriceFeatures?.length) return state.landPriceFeatures;
  try {
    const res = await fetch(LAND_PRICE_DATA_URL, { cache: "force-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    state.landPriceFeatures = data.features ?? [];
    return state.landPriceFeatures;
  } catch {
    return null;
  }
}

async function nearestLandPriceClient(lng, lat) {
  const features = await ensureLandPriceFeatures();
  if (!features?.length) return null;
  let best = null;
  for (const feature of features) {
    if (feature.geometry?.type !== "Point") continue;
    const [zLng, zLat] = feature.geometry.coordinates;
    if (!Number.isFinite(zLng) || !Number.isFinite(zLat)) continue;
    const distanceM = haversineMeters(lng, lat, zLng, zLat);
    if (!best || distanceM < best.distanceM) {
      best = { zone: feature.properties, lng: zLng, lat: zLat, distanceM };
    }
  }
  if (!best) return null;
  return {
    tool: "land-price",
    query: { lng, lat },
    nearestZone: {
      zone_id: best.zone.zone_id,
      price_per_wah: best.zone.price_per_wah,
      min_price: best.zone.min_price,
      max_price: best.zone.max_price,
      parcel_count: best.zone.parcel_count,
      displayLng: best.lng,
      displayLat: best.lat,
      distanceM: Math.round(best.distanceM),
    },
    notes:
      "Client-side nearest (API unavailable). Display positions are grid-layout approximations of UTMMAP3 zones.",
    assessment: "Treasury Department ราคาประเมินที่ดิน 2024–2028",
  };
}

function landRowsFromApi(payload) {
  const z = payload?.nearestZone;
  if (!z) {
    return [
      ["Zone", "Unavailable"],
      ["฿/sq.wah", "—"],
    ];
  }
  return [
    ["Zone", String(z.zone_id)],
    ["฿/sq.wah", formatBaht(z.price_per_wah)],
    ["Range", `${formatBaht(z.min_price)} – ${formatBaht(z.max_price)}`],
    ["Parcels", String(z.parcel_count ?? "—")],
    ["Distance", z.distanceM != null ? `${z.distanceM} m to zone display point` : "—"],
  ];
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
  const landEl = document.getElementById("atlas-inspect-land");
  const floodEl = document.getElementById("atlas-inspect-flood");
  const noteEl = document.getElementById("atlas-inspect-note");
  const apiLink = document.getElementById("atlas-inspect-api");

  if (hint) hint.hidden = true;
  if (card) card.hidden = false;
  if (coordsEl) {
    coordsEl.textContent = `${lng.toFixed(5)}° E, ${lat.toFixed(5)}° N`;
  }
  fillInspectDl(buildingEl, buildingRowsFromFeature(feature));
  fillInspectDl(landEl, [["Zone", "Loading…"], ["฿/sq.wah", "…"]]);
  fillInspectDl(floodEl, [["Envelope", "Loading…"], ["Risk", "…"]]);
  if (noteEl) noteEl.textContent = "";
  if (apiLink) {
    apiLink.href = `/api/risk?lng=${lng.toFixed(5)}&lat=${lat.toFixed(5)}`;
  }

  const [payload, flood, risk] = await Promise.all([
    fetchNearestLandPrice(lng.toFixed(5), lat.toFixed(5)),
    floodHitAt(lng, lat),
    fetchRisk(lng.toFixed(5), lat.toFixed(5)),
  ]);
  fillInspectDl(landEl, landRowsFromApi(payload));
  fillInspectDl(floodEl, floodRiskRows(flood, risk, feature));
  if (noteEl) {
    const bits = [];
    if (payload?.notes) bits.push(payload.notes);
    bits.push("Flood envelopes are schematic civic demos — not official DDPM/BMA maps.");
    noteEl.textContent = bits.join(" ");
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
  const [land, flood, pm25] = await Promise.all([
    nearestLandPriceClient(lng, lat),
    floodHitAt(lng, lat),
    fetchPointPm25Client(lat, lng),
  ]);
  return buildRiskPayload(lng, lat, land?.nearestZone ?? null, flood, pm25);
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

function buildRiskPayload(lng, lat, zone, flood, pm25 = null) {
  const severity = flood?.inside ? (flood.top?.severity ?? "medium") : "none";
  const severityWeight = { none: 0, low: 0.35, medium: 0.65, high: 1 }[severity] ?? 0;
  const price = zone?.price_per_wah ?? 0;
  const landFactor = price > 0 ? Math.min(1, Math.log10(price + 10) / 6) : 0;
  const aqiFactor =
    pm25 == null || Number.isNaN(Number(pm25))
      ? 0
      : Math.min(1, Math.max(0, (Number(pm25) - 12) / 138));
  const score = Math.round(100 * (0.35 * landFactor + 0.4 * severityWeight + 0.25 * aqiFactor));
  return {
    tool: "risk",
    version: 2,
    query: { lng, lat },
    score,
    band: score >= 70 ? "high" : score >= 40 ? "elevated" : "moderate",
    factors: {
      landPricePerWah: price || null,
      floodInside: !!flood?.inside,
      floodSeverity: severity,
      floodEnvelope: flood?.top?.name ?? null,
      pm25: pm25 ?? null,
      aqiFactor: Math.round(aqiFactor * 100) / 100,
    },
    disclaimer: "Schematic civic score — not for insurance underwriting.",
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

function wireInspect(map) {
  map.on("click", (event) => {
    runInspect(map, event);
  });

  map.on("mousemove", (event) => {
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

function renderLegend(legendEl, items) {
  if (!legendEl || !items) return;
  legendEl.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "atlas-legend-row";
    const swatch = document.createElement("span");
    swatch.className = "atlas-legend-swatch";
    swatch.style.background = item.color;
    const label = document.createElement("span");
    label.textContent = item.label;
    row.append(swatch, label);
    legendEl.appendChild(row);
  }
  legendEl.hidden = false;
}

function hideLegend(legendEl) {
  if (legendEl) legendEl.hidden = true;
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
        if (legendEl && layer.legend) renderLegend(legendEl, layer.legend);
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
    if (legendEl && layer.legend) renderLegend(legendEl, layer.legend);
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
      city: { buildings: true, rail: true, traffic: true, khlongs: true, rain: false, aqi: false, heat: false, flood: false, "land-price": false, terrain: false, night: false },
      rain: { buildings: true, rail: true, traffic: false, khlongs: false, rain: true, aqi: false, heat: false, flood: false, "land-price": false, terrain: false, night: false },
      aqi: { buildings: true, rail: true, traffic: false, khlongs: false, rain: false, aqi: true, heat: false, flood: false, "land-price": false, terrain: false, night: false },
      heat: { buildings: true, rail: true, traffic: false, khlongs: true, rain: false, aqi: false, heat: true, flood: false, "land-price": false, terrain: false, night: false },
      flood: { buildings: true, rail: true, traffic: false, khlongs: true, rain: true, aqi: false, heat: false, flood: true, "land-price": false, terrain: true, night: false },
      night: { buildings: true, rail: true, traffic: false, khlongs: false, rain: false, aqi: false, heat: false, flood: false, "land-price": false, terrain: false, night: true },
      pulse: { buildings: true, rail: true, traffic: true, khlongs: false, rain: true, aqi: true, heat: false, flood: true, "land-price": false, terrain: false, night: false },
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

async function init() {
  const data = await fetchAreas();
  state.areas = data.areas;

  renderQuickJump(state.areas);
  document.getElementById("atlas-share").addEventListener("click", copyDeepLink);

  const initialId = parseHashId();
  const initialArea = initialId ? state.areas.find((a) => a.id === initialId) : state.areas[0];

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
    hash: false,
    attributionControl: { compact: true },
  });

  state.map = map;

  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

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
