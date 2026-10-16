// Thai architectural forms for the atlas map, drawn with three.js.
//
// Rattanakosin's flat-topped extrusions read as massing. This renders the same
// real OpenStreetMap footprints as recognisable Thai forms — halls, chedis,
// prangs, mondops — using the pure geometry in ./heritage-forms.js.
//
// Loading is lazy and zoom-gated: three.js is only fetched once a visitor is
// close enough to read a roof, and never for someone who stays at city scale.
// The layer is a single merged mesh with vertex colours and Lambert light,
// mirroring building-massing.js.
//
// Honesty: every form is either "named" (a Thai name says what it is) or
// "inferred" (only building type and shape do). Clicking one says which, and
// says that the profile is a typological reading rather than a measurement.

import { buildForm, classify, classifyShophouse, ORIGIN } from './heritage-forms.js';
import { ROOF_LAYER } from './heritage-roofs.js';

export const FORMS_LAYER = 'bkkx-heritage-forms';
export const FORMS_MIN_ZOOM = 15;
// The slim render set (769 of 2,273 candidates, 577 KB). The full candidate
// file stays published as a download; shipping all of it cost 2.7 MB on every
// cold load for rows the classifier refuses anyway.
const SHOPHOUSE_URL = '/bkk-shophouse-forms.geojson';

const runtime = {
  map: null, layer: null, forms: null, chunks: new Map(),
  active: false, installed: false, shophouseSkipped: 0,
  builtChunks: 0, startPumping: null, pumpNow: null,
};

const KIND_LABEL = {
  hall: 'Viharn / ubosot hall',
  sala: 'Sala pavilion',
  chedi: 'Chedi',
  prang: 'Prang',
  mondop: 'Mondop',
  prasat: 'Prasat',
  throne: 'Throne hall',
  fort: 'Fort',
  shophouse: 'Shophouse row unit',
};

/**
 * Classify a feature collection once. Exported so tests and the inspect card
 * can use the exact same decision the renderer made.
 */
export function classifyAll(features) {
  const forms = [];
  for (const f of features) {
    try {
      const spec = classify(f);
      if (spec) forms.push(spec);
    } catch {
      // A malformed footprint is not a reason to lose the other 300 forms.
    }
  }
  return forms;
}

function loadThree() {
  return import('three');
}

function buildGeometry(THREE, forms) {
  const positions = [];
  const colors = [];
  for (const f of forms) {
    const m = buildForm(f);
    for (const v of m.positions) positions.push(v);
    for (const c of m.colors) colors.push(c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ── Spatial chunking ────────────────────────────────────────────────────────
// One merged mesh for all 1,080 forms cost 84 ms of main thread on the first
// zoom-in and then drew 93k triangles every frame with nothing culled — a hard
// stall on a phone. Chunks are built on demand near the camera and disposed
// once the camera leaves, so a cold start pays a few milliseconds per frame
// and only what is on screen is ever submitted.
const CHUNK_DEG = 0.0025; // ~275 m. Measured over the real form set this is the
// knee: 0.004 leaves one chunk with 263 forms, 0.0025 caps it at 128.
const CHUNKS_PER_FRAME = 2;
const KEEP_RADIUS = 3;   // cells beyond the viewport before a chunk is dropped

function chunkCentroid(f) {
  let x = 0;
  let y = 0;
  for (const [lng, lat] of f.ring) { x += lng; y += lat; }
  return [x / f.ring.length, y / f.ring.length];
}

export function chunkKeyFor(lng, lat, deg = CHUNK_DEG) {
  return `${Math.floor(lng / deg)}:${Math.floor(lat / deg)}`;
}

export function groupIntoChunks(forms, deg = CHUNK_DEG) {
  const cells = new Map();
  for (const f of forms) {
    const [x, y] = chunkCentroid(f);
    const k = chunkKeyFor(x, y, deg);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(f);
  }
  return cells;
}

/**
 * Rebuild the chunk store whenever it is empty.
 *
 * The forms themselves are worth caching across a toggle, but the chunk map is
 * cleared on uninstall — so gating the rebuild on the forms being absent leaves
 * a layer that has 319 buildings and zero chunks and therefore draws nothing.
 * That bug shipped once and 80 green tests did not catch it, because every
 * test exercised classify/buildForm/grouping in isolation and none of them ran
 * an install → uninstall → install cycle.
 */
export function ensureChunkStore(forms, current) {
  if (current && current.size > 0) return current;
  return groupIntoChunks(forms ?? []);
}

/** Cells covering the viewport plus a margin, so panning does not thrash. */
export function visibleCells(bounds, deg = CHUNK_DEG) {
  const w = bounds.getWest();
  const s = bounds.getSouth();
  const e = bounds.getEast();
  const n = bounds.getNorth();
  const out = new Set();
  for (let i = Math.floor(w / deg) - 1; i <= Math.floor(e / deg) + 1; i++) {
    for (let j = Math.floor(s / deg) - 1; j <= Math.floor(n / deg) + 1; j++) out.add(`${i}:${j}`);
  }
  return out;
}

function describe(form) {
  if (form.kind === 'shophouse') {
    const sh = form.shophouse ?? {};
    return [
      form.name || 'Shophouse row candidate',
      `${sh.floors ?? '?'} storeys · ${Math.round(form.height)} m (assumed storey height)`,
      `Corridor: ${sh.cluster ?? 'unknown'} · ${sh.strength ?? 'unknown strength'}`,
      `<b>Unverified candidate.</b> Detected by morphology screen, not a heritage survey.`,
      'Not a designated heritage structure. Not evidence for protection, value or demolition.',
    ].join('<br>');
  }
  const named = form.confidence === 'named';
  return [
    form.name || '(unnamed building)',
    KIND_LABEL[form.kind] || form.kind,
    named
      ? 'Named building · Thai name identifies the type.'
      : 'Inferred from building type and footprint shape.',
    'Roof tiers and profile are a typological reading, not a measurement.',
    `Height ${Math.round(form.base + form.height)} m from the atlas height value.`,
  ].join('<br>');
}

function createLayer(THREE, forms) {
  const ml = window.maplibregl;
  const origin = ml.MercatorCoordinate.fromLngLat([ORIGIN.lng, ORIGIN.lat], 0);
  const s = origin.meterInMercatorCoordinateUnits();
  // Local metres (x east, y north, z up) → Mercator (y grows south).
  const model = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(s, -s, s));

  let renderer = null;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  // Faces are wound both ways and the Mercator flip mirrors them; draw both sides.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // Late-afternoon light from the south-west — the Chao Phraya side.
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-0.6, -0.8, 1.2).normalize();
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3326, 1.1));

  const chunks = runtime.chunks;
  let pump = 0;

  /** Build a couple of missing chunks per frame; never block the main thread. */
  function pumpChunks(map) {
    let need;
    try { need = visibleCells(map.getBounds()); } catch { return; }
    runtime.pumpRuns = (runtime.pumpRuns || 0) + 1;
    const pending = [];
    let known = 0;
    for (const key of need) {
      const cell = chunks.get(key);
      if (cell) known++;
      if (cell && !cell.mesh) pending.push(key);
    }
    runtime.lastPump = { need: need.size, known, pending: pending.length, chunks: chunks.size };
    for (const key of pending.slice(0, CHUNKS_PER_FRAME)) {
      const cell = chunks.get(key);
      if (!cell || cell.mesh) continue;
      const geo = buildGeometry(THREE, cell.forms);
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false; // the shared model matrix is not the default one
      scene.add(mesh);
      cell.mesh = mesh;
      cell.geo = geo;
    }
    // Drop chunks the camera has left well behind, with hysteresis so a
    // boundary jitter cannot thrash a build/dispose cycle.
    if (need.size && chunks.size > need.size * 2) {
      for (const [key, cell] of chunks) {
        if (need.has(key) || !cell.mesh) continue;
        if (cell.usedTick === pump) continue;
        scene.remove(cell.mesh);
        cell.geo.dispose();
        cell.mesh = null;
        cell.geo = null;
      }
      for (const key of [...chunks.keys()]) if (!chunks.get(key).mesh) chunks.delete(key);
    }
    runtime.builtChunks = [...chunks.values()].filter((c) => c.mesh).length;
  }

  function startPumping(map) {
    pumpChunks(map);
    if (pump) cancelAnimationFrame(pump);
    const tick = () => {
      let need;
      try { need = visibleCells(map.getBounds()); } catch { pump = 0; return; }
      let missing = 0;
      for (const key of need) { const c = chunks.get(key); if (c && !c.mesh) missing++; }
      for (const key of need) { const c = chunks.get(key); if (c) c.usedTick = pump; }
      pumpChunks(map);
      if (missing > CHUNKS_PER_FRAME) pump = requestAnimationFrame(tick);
      else pump = 0;
    };
    pump = requestAnimationFrame(tick);
  }
  runtime.startPumping = startPumping;
  runtime.pumpNow = () => pumpChunks(map);

  return {
    id: FORMS_LAYER,
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      if (!renderer || !runtime.active) return;
      const matrix = args?.defaultProjectionData?.mainMatrix; // MapLibre 5+ custom-layer API
      if (!matrix) return;
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(model);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      for (const cell of chunks.values()) {
        if (cell.mesh) scene.remove(cell.mesh);
        cell.geo?.dispose();
        cell.mesh = null;
        cell.geo = null;
      }
      chunks.clear();
      if (pump) cancelAnimationFrame(pump);
      pump = 0;
      runtime.startPumping = null;
      runtime.pumpNow = null;
      material.dispose();
      renderer = null;
    },
  };
}

function nearestForm(lngLat) {
  let best = null;
  let bestD = Infinity;
  for (const f of runtime.forms) {
    let cx = 0;
    let cy = 0;
    for (const [lng, lat] of f.ring) { cx += lng; cy += lat; }
    cx /= f.ring.length;
    cy /= f.ring.length;
    const d = (cx - lngLat.lng) ** 2 + (cy - lngLat.lat) ** 2;
    if (d < bestD) { bestD = d; best = f; }
  }
  // ~40 m: a tap, not a drag across the whole island.
  return bestD < 0.0004 ** 2 ? best : null;
}

export async function installHeritageForms(map, features) {
  if (!map || !Array.isArray(features)) return;
  runtime.map = map;
  if (!runtime.forms) {
    const forms = classifyAll(features);
    // Shophouse candidates are a separate, newer file. If it fails, the Thai
    // forms still render — losing the rows must not cost the temples.
    try {
      const res = await fetch(SHOPHOUSE_URL);
      if (!res.ok) throw new Error(`shophouse candidates HTTP ${res.status}`);
      const shop = await res.json();
      const shophouses = (shop.features ?? [])
        .map((f) => { try { return classifyShophouse(f); } catch { return null; } })
        .filter(Boolean);
      runtime.shophouseSkipped = (shop.features?.length ?? 0) - shophouses.length;
      forms.push(...shophouses);
    } catch (error) {
      console.warn('Shophouse candidates unavailable; Thai forms retained:', error);
    }
    runtime.forms = forms;
  }
  // Chunks, not forms, are what get cleared on uninstall. Rebuild whenever the
  // map is empty, or a toggle-off/on leaves a layer that can never build a mesh.
  runtime.chunks = ensureChunkStore(runtime.forms, runtime.chunks);
  if (!runtime.forms.length) return;

  // ?debug only. Reading this module's runtime from an injected
  // import('/heritage-forms-layer.js') can hand back a different instance than
  // the one app.js loaded, which is how a broken layer once looked healthy.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) {
    if (window.__atlas) {
      window.__atlas.formsDiag = () => {
        let boundsOk = true;
        let cells = -1;
        try { cells = visibleCells(map.getBounds()).size; } catch { boundsOk = false; }
        return {
          forms: runtime.forms?.length ?? 0,
          chunks: runtime.chunks?.size ?? 0,
          built: runtime.builtChunks ?? 0,
          active: runtime.active,
          hasPump: typeof runtime.startPumping === 'function',
          pumpRuns: runtime.pumpRuns || 0,
          lastPump: runtime.lastPump || null,
          boundsOk,
          cellsInView: cells,
          zoom: Number(map.getZoom().toFixed(1)),
        };
      };
    }
  }

  const activate = async () => {
    if (runtime.layer || !map.getLayer || !map.getCanvas()) return;
    try {
      const THREE = await loadThree();
      if (!map.getLayer(FORMS_LAYER)) map.addLayer(createLayer(THREE, runtime.forms));
      runtime.layer = map.getLayer(FORMS_LAYER);
    } catch (error) {
      console.warn('Heritage forms unavailable; extrusions retained:', error);
      return;
    }
    try { map.moveLayer(FORMS_LAYER); } catch { /* stack order will catch up */ }
    runtime.active = true;
    // The 2-building roof pilot draws flat gable strips on the same footprints.
    // Real forms now cover those buildings, so suppress the pilot rather than
    // stacking two roofs on Wat Phra Kaew.
    if (map.getLayer(ROOF_LAYER)) {
      try { map.setLayoutProperty(ROOF_LAYER, 'visibility', 'none'); } catch { /* not added yet */ }
    }
    // Build only the chunks near the camera, a couple per frame.
    runtime.startPumping?.(map);
    for (const ev of ['moveend', 'zoomend']) {
      map.on(ev, () => { if (runtime.active) runtime.startPumping?.(map); });
    }
  };

  if (map.getZoom() >= FORMS_MIN_ZOOM) await activate();
  map.on('zoom', () => {
    if (map.getZoom() < FORMS_MIN_ZOOM) runtime.active = false;
    else activate();
  });
  map.on('click', (event) => {
    if (!runtime.active) return;
    const form = nearestForm(event.lngLat);
    if (!form) return;
    new window.maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
      .setLngLat(event.lngLat)
      .setHTML(describe(form))
      .addTo(map);
  });
}

export function uninstallHeritageForms(map) {
  runtime.active = false;
  if (map?.getLayer?.(FORMS_LAYER)) {
    try { map.removeLayer(FORMS_LAYER); } catch { /* already gone */ }
  }
  // Give the roof pilot back whatever the forms were hiding.
  if (map?.getLayer?.(ROOF_LAYER)) {
    try { map.setLayoutProperty(ROOF_LAYER, 'visibility', 'visible'); } catch { /* not added yet */ }
  }
  runtime.layer = null;
  runtime.map = null;
  runtime.chunks.clear();
  runtime.builtChunks = 0;
}

export function heritageFormsCount() {
  return runtime.forms ? runtime.forms.length : 0;
}

/** Candidates left out because no storey count was recorded. */
export function shophouseSkippedCount() {
  return runtime.shophouseSkipped;
}

/** Chunks currently holding a built mesh. 0 while zoomed in means chunking broke. */
export function builtChunkCount() {
  return runtime.builtChunks;
}

/** Chunks the camera asked for last pump. */
export function visibleChunkCount(map) {
  if (!map) return 0;
  return visibleCells(map.getBounds()).size;
}