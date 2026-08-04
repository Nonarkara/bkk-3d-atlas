// BKKx 3D Atlas — MapLibre viewer with quick-jump to Bangkok key areas.
// No build step. Loads from /bkk-areas.json (the reusable data file).
// The layer stack is the same recipe as the BKKx public atlas:
//   1. Esri World Imagery (raster, desaturated)
//   2. minor / major / motorway road tiers
//   3. 3D building fill-extrusion in BKKx signal yellow
// Sharp edges only. No rounded corners on the chrome.

const OPENFREEMAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const ESRI_IMAGERY_TILES = [
  "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
];
const ESRI_ATTRIBUTION =
  "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community";

const BUILDING_SOURCE_CANDIDATES = ["openfreemap", "openmaptiles"];

const BUILDING_PAINT = {
  "fill-extrusion-color": "#c9ff38",
  "fill-extrusion-height": [
    "coalesce",
    ["get", "render_height"],
    ["get", "height"],
    0,
  ],
  "fill-extrusion-base": [
    "coalesce",
    ["get", "render_min_height"],
    ["get", "min_height"],
    0,
  ],
  // Opacity ramps up with zoom so the whole-city view (zoom 11) shows
  // a yellow silhouette over the satellite instead of a solid yellow
  // blob, and street-level (zoom 17) keeps the buildings fully solid.
  "fill-extrusion-opacity": [
    "interpolate",
    ["linear"],
    ["zoom"],
    11, 0.32,
    13, 0.55,
    15, 0.7,
    17, 0.82,
  ],
  "fill-extrusion-vertical-gradient": true,
};

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
};

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

function findBuildingSource(map) {
  const style = map.getStyle();
  if (!style.sources) return null;
  for (const [name] of Object.entries(style.sources)) {
    if (BUILDING_SOURCE_CANDIDATES.includes(name)) return name;
  }
  return null;
}

function attachLayers(map) {
  const source = findBuildingSource(map);

  // 1. Esri satellite as the new base
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
    } catch {
      // ignore — fall back to dark style as-is
    }
  }

  // 2. Tiered roads from the same OpenFreeMap source
  if (source && !map.getLayer("bkkx-roads-minor")) {
    const addLine = (id, filter, color, width, opacity) => {
      try {
        map.addLayer({
          id,
          type: "line",
          source,
          "source-layer": "transportation",
          filter,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": color,
            "line-width": width,
            "line-opacity": opacity,
          },
        });
      } catch {
        // style schema may omit transportation; ignore
      }
    };
    addLine("bkkx-roads-minor", ROAD_FILTERS.minor, "#2c2d28", lineWidth(0.3, 2.4), 0.7);
    addLine("bkkx-roads-major", ROAD_FILTERS.major, "#5e6157", lineWidth(0.4, 3.6), 0.9);
    addLine("bkkx-roads-motorway", ROAD_FILTERS.motorway, "#c9ff38", lineWidth(0.6, 5.2), 1.0);
  }

  // 3. 3D buildings on top. minzoom 11 keeps the whole Bangkok urban
  //    area visible as a 3D silhouette at city scale; the opacity
  //    ramp in BUILDING_PAINT does the rest.
  if (source && !map.getLayer("bkkx-3d-buildings")) {
    try {
      map.addLayer({
        id: "bkkx-3d-buildings",
        type: "fill-extrusion",
        source,
        "source-layer": "building",
        minzoom: 11,
        paint: BUILDING_PAINT,
      });
    } catch {
      // ignore
    }
  }
}

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

  // Build quick-jump UI before map is ready so it's interactive from the start.
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
    attachLayers(map);
    if (initialArea) {
      setActiveArea(initialArea.id);
    }
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
