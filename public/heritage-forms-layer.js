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
const SHOPHOUSE_URL = '/bkk-shophouse-candidates.geojson';

const runtime = { map: null, layer: null, forms: null, active: false, installed: false, shophouseSkipped: 0 };

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
  const geometry = buildGeometry(THREE, forms);
  // Faces are wound both ways and the Mercator flip mirrors them; draw both sides.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(geometry, material));
  // Late-afternoon light from the south-west — the Chao Phraya side.
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(-0.6, -0.8, 1.2).normalize();
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x3a3326, 1.1));

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
      // MapLibre 5+ passes {defaultProjectionData}; the atlas loads 4.7.1, which
      // passes the matrix itself. Reading only the v5 field leaves this layer blank.
      const matrix = args?.defaultProjectionData?.mainMatrix ?? args;
      if (!matrix) return;
      camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(model);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      geometry.dispose();
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
  if (!runtime.forms.length) return;

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
}

export function heritageFormsCount() {
  return runtime.forms ? runtime.forms.length : 0;
}

/** Candidates left out because no storey count was recorded. */
export function shophouseSkippedCount() {
  return runtime.shophouseSkipped;
}