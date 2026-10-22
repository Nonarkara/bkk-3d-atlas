// The layer that draws the city forms: hipped roofs on low-rise footprints and
// rooftop plant on flat mid-rise roofs.
//
// It is a three.js layer, not a fill-extrusion.
//
// A fill-extrusion can only make flat-topped prisms, so a pitched roof drawn
// with one has to be a staircase — and at street zoom every step between two
// prisms catches the light differently. The first version of this did that,
// with seventy-two prisms to a roof, and the roof read as corrugated metal.
// The atlas already draws its Thai roofs with three.js and they read as roofs.
// This does the same for the whole city, with eight triangles to a roof.
//
// It is additive. The MapLibre extrusions stay exactly as they were — this
// layer only puts a roof on top of them.
//
// THE ONE RULE. A roof never carries a height of its own. It takes the
// building's height from the shared rule in building-heights.js — the same
// expression the walls are drawn with, through its JavaScript twin — so a
// roof is on its wall by construction and the two cannot drift apart.
//
// Everything it draws is a typological reading, and it says so on the map:
// the layer attribution and every form's `accuracy` field say the forms are
// schematic and unsurveyed. Footprints and heights are real; the roofs are
// not a survey of any building.
import { composeProjection } from './custom-layer-matrix.js';
import { classifyRoof, DEFAULT_OPTIONS } from './city-forms.js';
import { buildCityGeometry, ACCURACY } from './city-forms-geometry.js';
import { heightFor } from './building-heights.js';
import { heritageFormIds, heritageFormRings } from './heritage-forms-layer.js';
import { pointInRing } from './building-massing.js';

export const CITY_FORMS_SOURCE = 'bkkx-city-forms';
export const CITY_FORMS_LAYER = 'bkkx-city-forms-3d';
export const CITY_FORMS_MIN_ZOOM = 16.2;

let modulePromise = null;
let threePromise = null;
// The counters a visitor never sees but a reviewer must be able to trust.
// `vertices` is how many corners the geometry has; `triangles` is how many
// faces it draws. They are different numbers and used to share one name.
function emptyStats() {
  return { treated: 0, skipped: 0, kinds: {}, vertices: 0, triangles: 0 };
}

const runtime = {
  map: null,
  layer: null,
  installed: false,
  generation: 0,
  stats: emptyStats(),
  lastError: null,
  // How many building features the last pass actually saw. Zero means the
  // buildings had not arrived yet, which is the signal to retry.
  lastSeen: 0,
  // The zoom of the last pass, for diagnosis.
  lastZoom: 0,
  // The scene, and the mesh in it.
  scene: null,
  camera: null,
  renderer: null,
  content: null,
  mesh: null,
  active: false,
  origin: [0, 0],
  altitude: 0,
  signature: '',
  plans: [],
};

let refreshTimer = 0;
let retryTimer = 0;
let retryCount = 0;

// A settled view is not a loaded view.
//
// Measured on the old town: the zoomend fires at t=8ms, the heritage detail
// file is not queryable until t=7025ms, and 'idle' never fires again — this
// map does not go idle, because live markers, water and pulses keep the
// render loop alive. A single refresh on 'idle' therefore lands long before
// the buildings exist, and the layer stays empty until the next zoom.
//
// The massing layer hit this first and solved it the same way: keep trying
// while the layer is still empty. So does this one.
const REFRESH_DELAY_MS = 450;
const RETRY_INTERVAL_MS = 400;
const RETRY_LIMIT = 30;

function scheduleRefresh(map) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = 0;
    refreshCityForms(map).catch((error) => {
      console.warn('City forms refresh failed; previous roofs kept:', error);
    });
  }, REFRESH_DELAY_MS);
}

function clearRetry() {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryCount = 0;
}

// Rebuild, and keep rebuilding until the buildings are actually in view.
function armRefresh(map) {
  scheduleRefresh(map);
  clearRetry();
  const tick = () => {
    retryCount += 1;
    if (!runtime.map || runtime.lastSeen > 0 || retryCount > RETRY_LIMIT
      || map.getZoom() < CITY_FORMS_MIN_ZOOM) {
      retryTimer = 0;
      return;
    }
    scheduleRefresh(map);
    retryTimer = setTimeout(tick, RETRY_INTERVAL_MS);
  };
  retryTimer = setTimeout(tick, RETRY_INTERVAL_MS);
}

// Rebuild the roofs whenever the view settles, and whenever the buildings
// change underneath it.
export function attachCityFormsRefresh(map) {
  if (map.__bkkxCityFormsRefresh) return;
  const handler = () => armRefresh(map);
  map.__bkkxCityFormsRefresh = handler;
  map.on('idle', handler);
  map.on('zoomend', handler);
  map.on('moveend', handler);
  map.on('resize', handler);
  // The first pass runs now, and keeps running until the buildings show up.
  armRefresh(map);
}

export function detachCityFormsRefresh(map) {
  if (!map.__bkkxCityFormsRefresh) return;
  map.off('idle', map.__bkkxCityFormsRefresh);
  map.off('zoomend', map.__bkkxCityFormsRefresh);
  map.off('moveend', map.__bkkxCityFormsRefresh);
  map.off('resize', map.__bkkxCityFormsRefresh);
  delete map.__bkkxCityFormsRefresh;
  clearRetry();
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = 0; }
}

function loadModule() {
  modulePromise = modulePromise || import('./city-forms.js');
  return modulePromise;
}

function loadThree() {
  if (!threePromise) {
    threePromise = import('three').catch((error) => {
      threePromise = null;
      throw error;
    });
  }
  return threePromise;
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

function centroidOf(ring) {
  if (!ring || !ring.length) return null;
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}

// The buildings in view, one entry per building.
//
// The atlas draws buildings twice over the Old Town: the OpenMapTiles layer
// underneath and the heritage-detail layer on top of it, each with its own
// height rule. The visible top of a building drawn twice is the taller of the
// two, so the roof has to go on the taller one.
//
// Both sets are taken from the RENDERED features, so they are the buildings
// actually on screen and carry the properties the layers drew them with. A
// footprint that appears in both is one building, matched by centroid.
//
// The Thai forms layer draws real forms on some of these same footprints, at
// a higher fidelity than a schematic roof. Those buildings are left alone:
// two roofs on one building is worse than one.
function buildingsInView(map) {
  const oldtown = [];
  const metro = [];
  const collect = (layerId, family, into) => {
    try {
      if (!map.getLayer(layerId)) return;
      for (const feature of map.queryRenderedFeatures({ layers: [layerId] })) {
        const ring = ringOf(feature);
        if (!ring) continue;
        into.push({ feature, ring, family, centroid: centroidOf(ring) });
      }
    } catch { /* the layer may not be loaded */ }
  };
  collect('bkkx-rattanakosin-buildings', 'oldtown', oldtown);
  collect('bkkx-3d-buildings-hi', 'metro', metro);

  const sameMetres = (a, b) => {
    const dx = (a[0] - b[0]) * 108200;
    const dy = (a[1] - b[1]) * 110500;
    return Math.hypot(dx, dy) < 3;
  };
  const groups = [];
  for (const item of oldtown) groups.push({ candidates: [item] });
  for (const item of metro) {
    const match = groups.find((g) => g.candidates.some((c) => c.centroid && sameMetres(c.centroid, item.centroid)));
    if (match) match.candidates.push(item);
    else groups.push({ candidates: [item] });
  }
  return groups;
}

// Is this footprint already roofed by a Thai form?
//
// The ids are not enough. A shophouse row is drawn from one footprint but
// covers the buildings behind it, and those carry their own ids, so a
// building under a Thai form has to be found by geometry. The rule is the
// one the massing layer already uses: the centroid is inside the form, or
// most of the footprint's corners are.
function coveredByForm(ring, formRings) {
  for (const area of formRings) {
    const centroid = centroidOf(ring);
    if (centroid && pointInRing(centroid[0], centroid[1], area)) return true;
    let inside = 0;
    for (const point of ring) if (pointInRing(point[0], point[1], area)) inside += 1;
    if (inside >= 3 && inside / ring.length >= 0.6) return true;
  }
  return false;
}

// The building to put a roof on: the tallest of the candidates, because that
// is the one whose top a person can see.
function tallestCandidate(candidates) {
  let best = null;
  for (const candidate of candidates) {
    const height = heightFor(candidate.feature.properties ?? {}, candidate.family).height;
    if (!best || height > best.height) best = { ...candidate, height };
  }
  return best;
}

export function cityFormsDebugState() {
  return {
    installed: runtime.installed,
    generation: runtime.generation,
    stats: runtime.stats,
    lastSeen: runtime.lastSeen,
    lastZoom: runtime.lastZoom,
    lastError: runtime.lastError,
    active: runtime.active,
    // Both counts come from the same build, so they cannot disagree. The
    // geometry has three corners per face.
    vertices: runtime.stats.vertices ?? 0,
    triangles: runtime.stats.triangles ?? 0,
    // How many Thai forms were known when this pass ran. Zero means the
    // heritage forms had not loaded yet, and the overlap could not be ruled
    // out on this pass.
    thaiForms: runtime.thaiForms ?? 0,
    // How long the last rebuild took. A rebuild happens at the end of a pan,
    // so this is the longest hitch a visitor can feel from this layer.
    lastBuildMs: Math.round((runtime.lastBuildMs ?? 0) * 10) / 10,
    excludedById: runtime.excludedById ?? 0,
    excludedByForm: runtime.excludedByForm ?? 0,
  };
}

function terrainMeters(map, lngLat) {
  try {
    if (!map.getTerrain?.()) return 0;
    const elevation = map.queryTerrainElevation(lngLat);
    return Number.isFinite(elevation) ? elevation : 0;
  } catch {
    return 0;
  }
}

function disposeMesh(mesh) {
  if (!mesh) return;
  mesh.geometry?.dispose?.();
  if (mesh.material) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose?.();
  }
}

function createCustomLayer(THREE) {
  return {
    id: CITY_FORMS_LAYER,
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.66));
      const sun = new THREE.DirectionalLight(0xffffff, 0.5);
      sun.position.set(-0.35, 1, 0.2);
      this.scene.add(sun);
      this.content = new THREE.Group();
      this.content.name = 'content';
      this.content.frustumCulled = false;
      this.scene.add(this.content);
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      runtime.scene = this.scene;
      runtime.camera = this.camera;
      runtime.renderer = this.renderer;
      runtime.content = this.content;
    },
    render(gl, args) {
      if (!runtime.active || !this.renderer || !runtime.content?.visible) return;
      if (typeof maplibregl === 'undefined') return;
      // The scene is built in metres relative to the map centre. The Mercator
      // model matrix is the bridge from metres to clip space; the camera's
      // projectionMatrix is NOT. See custom-layer-matrix.js.
      const coord = maplibregl.MercatorCoordinate.fromLngLat(runtime.origin, runtime.altitude);
      const matrix = composeProjection(THREE, args, {
        x: coord.x,
        y: coord.y,
        z: coord.z,
        scale: coord.meterInMercatorCoordinateUnits(),
      });
      if (!matrix) return;
      this.camera.projectionMatrix = matrix;
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    },
    onRemove() {
      disposeMesh(runtime.mesh);
      runtime.mesh = null;
      runtime.content?.clear?.();
      runtime.renderer?.dispose?.();
      runtime.renderer = null;
      runtime.scene = null;
      runtime.camera = null;
      runtime.content = null;
      runtime.active = false;
    },
  };
}

async function ensureLayer(map, THREE) {
  if (!map.getLayer(CITY_FORMS_LAYER)) {
    const layer = createCustomLayer(THREE);
    runtime.layer = layer;
    map.addLayer(layer);
  }
}

function nearestForm(map, lngLat) {
  let best = null;
  let bestDistance = Infinity;
  for (const plan of runtime.plans) {
    const dx = (plan.centroid[0] - lngLat.lng) * 108200;
    const dy = (plan.centroid[1] - lngLat.lat) * 110500;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) { bestDistance = distance; best = plan; }
  }
  return bestDistance < 24 ? best : null;
}

export async function installCityForms(map) {
  runtime.map = map;
  if (runtime.installed) return;
  runtime.installed = true;
  if (!map.__bkkxCityFormsClick) {
    map.__bkkxCityFormsClick = (event) => {
      const plan = nearestForm(map, event.lngLat);
      if (!plan) return;
      const card = document.createElement('div');
      card.className = 'atlas-cctv-card';
      const title = document.createElement('strong');
      title.textContent = plan.kind === 'hip' ? 'Schematic hipped roof' : 'Schematic rooftop plant';
      const note = document.createElement('p');
      note.textContent = plan.accuracy;
      card.append(title, note);
      new maplibregl.Popup({ className: 'atlas-cctv-popup', maxWidth: '280px' })
        .setLngLat(event.lngLat)
        .setDOMContent(card)
        .addTo(map);
    };
    map.on('click', CITY_FORMS_LAYER, map.__bkkxCityFormsClick);
  }
  await refreshCityForms(map);
}

export async function refreshCityForms(map) {
  runtime.map = map;
  if (!runtime.installed) return null;
  const generation = ++runtime.generation;
  runtime.lastZoom = map.getZoom();
  if (map.getZoom() < CITY_FORMS_MIN_ZOOM) {
    runtime.active = false;
    if (runtime.content) runtime.content.visible = false;
    runtime.lastSeen = 0;
    runtime.stats = emptyStats();
    return null;
  }
  try {
    const mod = await loadModule();
    const centre = map.getCenter();
    const origin = [centre.lng, centre.lat];
    const groups = buildingsInView(map);
    runtime.lastSeen = groups.length;
    if (generation !== runtime.generation) return null;

    // The Thai forms layer draws real forms on some of these footprints, at
    // a higher fidelity than a schematic roof. Leave those buildings alone:
    // two roofs on one building is worse than one.
    //
    // The test is on the BUILDING, not on the candidate chosen to build it.
    // A building drawn twice carries two ids — the tile one and the heritage
    // one — and the roof goes on whichever is taller. Checking only the
    // chosen candidate let a roof land on a building the Thai forms already
    // roofed, which then poked through as a sliver.
    const drawn = heritageFormIds();
    const formRings = heritageFormRings();
    runtime.thaiForms = formRings.length;
    const plans = [];
    let skipped = 0;
    let excludedById = 0;
    let excludedByForm = 0;
    const kinds = { hip: 0, plant: 0 };
    for (const group of groups) {
      const best = tallestCandidate(group.candidates);
      if (!best) { skipped += 1; continue; }
      const byId = group.candidates.some((c) => {
        const id = c.feature.properties?.id;
        return id && drawn.has(String(id));
      });
      const byForm = !byId && group.candidates.some((c) => coveredByForm(c.ring, formRings));
      if (byId) excludedById += 1;
      if (byForm) excludedByForm += 1;
      if (byId || byForm) { skipped += 1; continue; }
      const plan = mod.classifyRoof(best.feature, {
        ...DEFAULT_OPTIONS,
        origin,
        family: best.family,
      });
      if (!plan) { skipped += 1; continue; }
      plan.kind = plan.kind;
      plan.centroid = best.centroid;
      plan.accuracy = ACCURACY[plan.kind];
      plans.push(plan);
    }
    // Biggest first: the budget should buy the buildings a person is looking
    // at, not the ones furthest away.
    plans.sort((a, b) => (b.box.long * b.box.short) - (a.box.long * a.box.short));
    const kept = plans.slice(0, DEFAULT_OPTIONS.budget);
    const dropped = plans.length - kept.length;
    // The kinds describe what was built, not what was planned. A plan that
    // the budget dropped was never drawn.
    for (const plan of kept) kinds[plan.kind] += 1;
    runtime.excludedById = excludedById;
    runtime.excludedByForm = excludedByForm;

    const signature = [
      origin[0].toFixed(5),
      origin[1].toFixed(5),
      map.getZoom().toFixed(2),
      kept.map((p) => `${p.centroid[0].toFixed(5)}:${p.centroid[1].toFixed(5)}:${p.kind}`).join(','),
    ].join('|');
    if (signature === runtime.signature && runtime.active) {
      const vertices = runtime.mesh?.geometry?.attributes?.position?.count ?? 0;
      runtime.stats = { treated: kept.length, skipped: skipped + dropped, kinds, vertices, triangles: vertices / 3 };
      return runtime.stats;
    }

    let THREE;
    try {
      THREE = await loadThree();
    } catch (error) {
      runtime.lastError = 'three.js did not load';
      console.warn('City forms: three.js did not load; extrusions retained.', error);
      return null;
    }
    if (generation !== runtime.generation) return null;
    await ensureLayer(map, THREE);
    if (generation !== runtime.generation) return null;

    const startedAt = performance.now();
    const geometry = buildCityGeometry(kept, { ...DEFAULT_OPTIONS });
    runtime.lastBuildMs = performance.now() - startedAt;
    const buffer = new THREE.BufferGeometry();
    // The scene is in three's axes: x east, y up, z south. The geometry is in
    // map axes: x east, y north, z up.
    const positions = new Float32Array(geometry.positions.length);
    for (let i = 0; i < geometry.positions.length; i += 3) {
      positions[i] = geometry.positions[i];
      positions[i + 1] = geometry.positions[i + 2];
      positions[i + 2] = -geometry.positions[i + 1];
    }
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(geometry.normals), 3));
    buffer.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.colors), 3));
    const mesh = new THREE.Mesh(buffer, new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;

    const previous = runtime.mesh;
    runtime.mesh = mesh;
    runtime.content?.clear?.();
    runtime.content?.add(mesh);
    disposeMesh(previous);
    runtime.origin = origin;
    runtime.altitude = terrainMeters(map, origin);
    if (runtime.content) runtime.content.visible = true;
    runtime.active = true;
    runtime.plans = kept;
    runtime.signature = signature;
    // `positions` is a flat float list, three numbers per corner, so its
    // length is three times the corner count. Dividing by three gives
    // vertices; vertices over three gives the faces actually drawn.
    const vertices = positions.length / 3;
    runtime.stats = { treated: kept.length, skipped: skipped + dropped, kinds, vertices, triangles: vertices / 3 };
    runtime.lastError = null;
    map.triggerRepaint?.();
    return runtime.stats;
  } catch (error) {
    runtime.lastError = String(error && error.message ? error.message : error).slice(0, 200);
    return null;
  }
}

export function uninstallCityForms(map) {
  if (map.__bkkxCityFormsClick) {
    map.off('click', CITY_FORMS_LAYER, map.__bkkxCityFormsClick);
    delete map.__bkkxCityFormsClick;
  }
  disposeMesh(runtime.mesh);
  runtime.mesh = null;
  runtime.content?.clear?.();
  if (map.getLayer(CITY_FORMS_LAYER)) map.removeLayer(CITY_FORMS_LAYER);
  runtime.layer = null;
  runtime.installed = false;
  runtime.active = false;
  runtime.lastSeen = 0;
  runtime.stats = emptyStats();
}
