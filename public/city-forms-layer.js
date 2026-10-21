// The layer that draws the city forms: hipped roofs on low-rise footprints and
// rooftop plant on flat mid-rise roofs.
//
// It is additive. The MapLibre extrusions stay exactly as they were — this
// layer only puts a roof on top of them, and for a pitched roof that roof
// covers the flat lid the extrusion would otherwise show.
//
// THE ONE RULE. A roof never carries an absolute height. It carries a `rise`
// above the building, and the paint asks MapLibre for the building's height
// with the very expression the walls use — HEIGHT_GET for the metro
// footprints, RATTANAKOSIN_HEIGHT_EXPRESSION for the Old Town ones, which
// has its own typology table. So a roof is on its wall by construction, and
// the two cannot drift apart.
//
// Everything it draws is a typological reading, and it says so on the map:
// the layer attribution and every feature's `accuracy` field say the forms
// are schematic and unsurveyed. Footprints and heights are real; the roofs
// are not a survey of any building.
import {
  CITY_FORMS_SOURCE,
  CITY_FORMS_LAYER,
  DEFAULT_OPTIONS,
  buildCityForms,
} from './city-forms.js';
import {
  HEIGHT_GET,
  RATTANAKOSIN_HEIGHT_EXPRESSION,
} from './building-heights.js';

// Re-exported so the app can name the layers without importing the geometry
// module as well. An ES module import that names a missing export is a hard
// boot failure, and the type checker does not read the public/ module graph.
export { CITY_FORMS_SOURCE, CITY_FORMS_LAYER };

export const CITY_FORMS_MIN_ZOOM = 16.2;
// The Old Town has its own height rule, so it gets its own draw layer.
export const CITY_FORMS_OLDTOWN_LAYER = 'bkkx-city-forms-oldtown-3d';

let modulePromise = null;
let runtime = {
  map: null,
  installed: false,
  generation: 0,
  stats: { treated: 0, skipped: 0, kinds: {}, pieces: 0 },
  lastError: null,
};

function loadModule() {
  modulePromise = modulePromise || import('./city-forms.js');
  return modulePromise;
}

function ringOf(feature) {
  const g = feature?.geometry;
  if (!g) return null;
  if (g.type === 'Polygon') return g.coordinates?.[0] ?? null;
  if (g.type === 'MultiPolygon') {
    let best = null;
    let bestArea = -1;
    for (const part of g.coordinates ?? []) {
      const ring = part?.[0];
      if (!ring) continue;
      const a = Math.abs(ring.reduce((t, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return t + p[0] * q[1] - q[0] * p[1];
      }, 0)) / 2;
      if (a > bestArea) { bestArea = a; best = ring; }
    }
    return best;
  }
  return null;
}

function ringSpan(ring) {
  if (!ring || !ring.length) return 0;
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return (maxX - minX) * (maxY - minY);
}

// The building features in view, split by which height rule draws them.
//
// The atlas draws buildings twice over the Old Town: the OpenMapTiles layer
// underneath and the heritage-detail layer on top of it, each with its own
// height rule. The visible top of a building drawn twice is the taller of the
// two, so the roof has to be placed on the taller one — not on whichever
// source happened to be read first.
//
// Both sets are taken from the RENDERED features, so they are the buildings
// actually on screen and carry the properties the layer drew them with. A
// footprint that appears in both is one building, so it is matched by
// centroid and drawn once.
function centroidOf(ring) {
  if (!ring || !ring.length) return null;
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}

function buildingFeaturesInView(map) {
  const oldtown = [];
  const metro = [];
  try {
    if (map.getLayer('bkkx-rattanakosin-buildings')) {
      for (const feature of map.queryRenderedFeatures({ layers: ['bkkx-rattanakosin-buildings'] })) {
        const ring = ringOf(feature);
        if (!ring) continue;
        oldtown.push({ feature, ring, family: 'oldtown', centroid: centroidOf(ring) });
      }
    }
  } catch { /* the old town layer may not be loaded */ }
  try {
    if (map.getLayer('bkkx-3d-buildings-hi')) {
      for (const feature of map.queryRenderedFeatures({ layers: ['bkkx-3d-buildings-hi'] })) {
        const ring = ringOf(feature);
        if (!ring) continue;
        metro.push({ feature, ring, family: 'metro', centroid: centroidOf(ring) });
      }
    }
  } catch { /* the tile layer may not be loaded */ }

  // One building, one roof: a metro footprint that is the same building as an
  // old town one is dropped here, and the old town version — with its real
  // OSM properties — is used instead.
  const oldtownCentroids = oldtown.map((f) => f.centroid).filter(Boolean);
  const sameBuilding = (centroid) => oldtownCentroids.some((c) => {
    const dx = (c[0] - centroid[0]) * 108200;
    const dy = (c[1] - centroid[1]) * 110500;
    return Math.hypot(dx, dy) < 3;
  });
  const metroOnly = metro.filter((f) => !f.centroid || !sameBuilding(f.centroid));

  // Biggest first: the budget should buy the buildings a person is looking
  // at, not the ones furthest away.
  const all = [...oldtown, ...metroOnly];
  all.sort((a, b) => ringSpan(b.ring) - ringSpan(a.ring));
  return all;
}

export function cityFormsDebugState() {
  return {
    installed: runtime.installed,
    generation: runtime.generation,
    stats: runtime.stats,
    lastError: runtime.lastError,
  };
}

export async function installCityForms(map) {
  runtime.map = map;
  if (map.getLayer(CITY_FORMS_LAYER)) {
    runtime.installed = true;
    return;
  }
  map.addSource(CITY_FORMS_SOURCE, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    attribution: '© OpenStreetMap contributors (ODbL) · schematic roof forms, unsurveyed',
  });
  // The Old Town draws its buildings twice, once by each rule, and the
  // taller of the two is what a person sees. So the roof's base is the
  // taller of the two heights, computed by MapLibre from the same
  // properties the walls were drawn from.
  const OLDTOWN_BASE = ['max', RATTANAKOSIN_HEIGHT_EXPRESSION, HEIGHT_GET];
  const paint = (base) => ({
    'fill-extrusion-color': ['get', 'color'],
    'fill-extrusion-base': base,
    'fill-extrusion-height': ['+', base, ['get', 'rise']],
    'fill-extrusion-opacity': 1,
  });
  try {
    map.addLayer({
      id: CITY_FORMS_LAYER,
      type: 'fill-extrusion',
      source: CITY_FORMS_SOURCE,
      minzoom: CITY_FORMS_MIN_ZOOM,
      filter: ['==', ['get', 'family'], 'metro'],
      paint: paint(HEIGHT_GET),
    });
    map.addLayer({
      id: CITY_FORMS_OLDTOWN_LAYER,
      type: 'fill-extrusion',
      source: CITY_FORMS_SOURCE,
      minzoom: CITY_FORMS_MIN_ZOOM,
      filter: ['==', ['get', 'family'], 'oldtown'],
      paint: paint(OLDTOWN_BASE),
    });
  } catch (error) {
    if (map.getLayer(CITY_FORMS_LAYER)) map.removeLayer(CITY_FORMS_LAYER);
    if (map.getLayer(CITY_FORMS_OLDTOWN_LAYER)) map.removeLayer(CITY_FORMS_OLDTOWN_LAYER);
    if (map.getSource(CITY_FORMS_SOURCE)) map.removeSource(CITY_FORMS_SOURCE);
    throw error;
  }
  runtime.installed = true;
  if (!map.__bkkxCityFormsClick) {
    map.__bkkxCityFormsClick = (event) => {
      const p = event.features?.[0]?.properties;
      if (!p) return;
      const card = document.createElement('div');
      card.className = 'atlas-cctv-card';
      const title = document.createElement('strong');
      title.textContent = p.form === 'hip' ? 'Schematic hipped roof' : 'Schematic rooftop plant';
      const note = document.createElement('p');
      note.textContent = p.accuracy;
      card.append(title, note);
      new maplibregl.Popup({ className: 'atlas-cctv-popup', maxWidth: '280px' })
        .setLngLat(event.lngLat)
        .setDOMContent(card)
        .addTo(map);
    };
    map.on('click', CITY_FORMS_LAYER, map.__bkkxCityFormsClick);
    map.on('click', CITY_FORMS_OLDTOWN_LAYER, map.__bkkxCityFormsClick);
  }
  await refreshCityForms(map);
}

export async function refreshCityForms(map) {
  runtime.map = map;
  if (!runtime.installed) return null;
  if (!map.getSource(CITY_FORMS_SOURCE)) return null;
  if (map.getZoom() < CITY_FORMS_MIN_ZOOM) {
    map.getSource(CITY_FORMS_SOURCE).setData({ type: 'FeatureCollection', features: [] });
    runtime.stats = { treated: 0, skipped: 0, kinds: {}, pieces: 0 };
    return null;
  }
  const generation = ++runtime.generation;
  try {
    const mod = await loadModule();
    const centre = map.getCenter();
    const entries = buildingFeaturesInView(map);
    const { collection, stats } = mod.buildCityForms(entries, {
      ...DEFAULT_OPTIONS,
      origin: [centre.lng, centre.lat],
    });
    if (generation !== runtime.generation) return null;
    map.getSource(CITY_FORMS_SOURCE).setData(collection);
    runtime.stats = stats;
    runtime.lastError = null;
    return stats;
  } catch (error) {
    runtime.lastError = String(error && error.message ? error.message : error).slice(0, 200);
    return null;
  }
}

export function uninstallCityForms(map) {
  if (map.__bkkxCityFormsClick) {
    map.off('click', CITY_FORMS_LAYER, map.__bkkxCityFormsClick);
    map.off('click', CITY_FORMS_OLDTOWN_LAYER, map.__bkkxCityFormsClick);
    delete map.__bkkxCityFormsClick;
  }
  if (map.getLayer(CITY_FORMS_LAYER)) map.removeLayer(CITY_FORMS_LAYER);
  if (map.getLayer(CITY_FORMS_OLDTOWN_LAYER)) map.removeLayer(CITY_FORMS_OLDTOWN_LAYER);
  if (map.getSource(CITY_FORMS_SOURCE)) map.removeSource(CITY_FORMS_SOURCE);
  runtime.installed = false;
}
