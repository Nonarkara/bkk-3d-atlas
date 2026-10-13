// Street-zoom building massing.
//
// Below zoom 16 the atlas keeps fill-extrusion. At zoom 16 and closer, and
// only when a tall tower or the Grand Palace stand-in is in view, this
// module loads three.js r0.170.0 (import map in index.html) and draws a
// MapLibre custom layer. Towers get a short podium and setbacks from the
// OSM footprint plus height / building:levels. The palace file is
// public/models/grand-palace.glb — see grand-palace-slot.js to replace it.
//
// Colours are the atlas palette: paper #f1efe8, ink #11120f, the existing
// tower steel #9ba3b4, and gold #c9a227 (paper.css --paper-accent) on roofs
// only. No textures. Footprints stay © OpenStreetMap contributors, ODbL.

import { GRAND_PALACE_SLOT, PALACE_ROOF_NAME } from './grand-palace-slot.js';

export const MASSING_LAYER = 'bkkx-building-massing';
export const MASSING_MIN_ZOOM = 16;
export const TALL_MIN_METERS = 80;
export const THREE_VERSION = '0.170.0';
export const LEVEL_HEIGHT_M = 3.15;
export const MASSING_PALETTE = {
  paper: 0xf1efe8,
  paperStrong: 0xfffdf5,
  ink: 0x11120f,
  steel: 0x9ba3b4,
  gold: 0xc9a227,
  // 84% paper mixed with 16% ink, so shade faces stay inside the two tokens.
  shade: 0xcdcbc5,
};

const HI_LAYER = 'bkkx-3d-buildings-hi';
const RATTANAKOSIN_LAYER = 'bkkx-rattanakosin-buildings';
const LANDMARKS_LAYER = 'bkkx-landmarks-extrusion';
const LANDMARKS_SOURCE = 'bkkx-landmarks';
const HERITAGE_SOURCE = 'bkkx-heritage-detail';
const ROOF_LAYER = 'bkkx-heritage-roofs-3d';
const DRACO_DECODER = `https://unpkg.com/three@${THREE_VERSION}/examples/jsm/libs/draco/gltf/`;

const SKIP_KIND = new Set([
  'chedi', 'prasat', 'monument', 'ubosot', 'viharn', 'throne', 'mondop',
  'golden_mount', 'heritage', 'shrine', 'park', 'bridge', 'temple', 'pagoda',
  'chapel', 'monastery', 'cathedral', 'church', 'mosque', 'synagogue',
]);

const PITCHED_ROOFS = new Set([
  'gabled', 'hipped', 'pyramidal', 'skillion', 'gambrel', 'mansard',
  'half-hipped', 'round', 'onion', 'gabled_height',
]);
const FLAT_ROOFS = new Set(['flat', 'dome', 'none']);
const PITCHED_BUILDINGS = new Set([
  'house', 'residential', 'detached', 'terrace', 'semidetached_house',
  'hut', 'bungalow', 'cabin',
]);

const runtime = {
  installed: false,
  map: null,
  baseFilter: null,
  active: false,
  hiddenIds: [],
  palaceShown: false,
  hits: [],
  palaceRings: [],
  palaceFeature: null,
  signature: '',
  gen: 0,
  frame: 0,
  threePromise: null,
  libs: null,
  layer: null,
  scene: null,
  camera: null,
  renderer: null,
  content: null,
  palaceObject: null,
  origin: GRAND_PALACE_SLOT.anchor,
  altitude: 0,
  popup: null,
  arm: 0,
};

export function srgbChannelToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearColor(hex) {
  const n = typeof hex === 'string' ? Number.parseInt(hex.replace('#', ''), 16) : hex;
  return [
    srgbChannelToLinear((n >> 16) & 255),
    srgbChannelToLinear((n >> 8) & 255),
    srgbChannelToLinear(n & 255),
    1,
  ];
}

export function resolveHeight(props) {
  const tagged = Number(props?.render_height ?? props?.height);
  if (Number.isFinite(tagged) && tagged >= 1 && tagged <= 500) return tagged;
  const levels = Number(props?.['building:levels'] ?? props?.building_levels ?? props?.levels);
  if (Number.isFinite(levels) && levels >= 1 && levels <= 160) {
    return Math.min(500, levels * LEVEL_HEIGHT_M);
  }
  return null;
}

export function resolveBase(props, height) {
  const base = Number(props?.render_min_height ?? props?.min_height ?? props?.base_height ?? 0);
  if (!Number.isFinite(base) || base <= 0 || base >= height) return 0;
  return base;
}

export function roofChoice(props, height) {
  const shape = String(props?.['roof:shape'] ?? props?.roof_shape ?? props?.roofShape ?? '').toLowerCase();
  if (PITCHED_ROOFS.has(shape)) return 'pitched';
  if (FLAT_ROOFS.has(shape)) return 'flat';
  const kind = String(props?.building ?? props?.building_type ?? props?.kind ?? '').toLowerCase();
  if (PITCHED_BUILDINGS.has(kind) && height < 36) return 'pitched';
  return 'flat';
}

export function isTowerCandidate(props) {
  if (!props) return false;
  const kind = String(props.kind ?? props.building ?? props.building_type ?? '').toLowerCase();
  if (SKIP_KIND.has(kind)) return false;
  const height = resolveHeight(props);
  return height != null && height >= TALL_MIN_METERS;
}

export function featureKeys(feature) {
  const props = feature?.properties ?? {};
  const keys = [];
  for (const value of [props.id, props.osm_id, feature?.id]) {
    if (value == null || value === '') continue;
    const key = String(value);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

function ringCoveredBy(ring, areas) {
  const [lng, lat] = centroidLngLat(ring);
  return areas.some((area) => {
    if (pointInRing(lng, lat, area)) return true;
    let inside = 0;
    for (const point of ring) if (pointInRing(point[0], point[1], area)) inside += 1;
    return inside >= 3 && inside / ring.length >= 0.6;
  });
}

// OpenFreeMap often draws the same tower under a different way id than the
// landmark file. A full-height extrusion inside the massing footprint would
// fill the setbacks back in, so those ids are hidden and not meshed again.
export function keysInsideRings(features, rings) {
  const keys = [];
  const areas = (rings ?? []).filter((ring) => ring && ring.length >= 3);
  if (!areas.length) return keys;
  for (const feature of features ?? []) {
    const ring = outerRingLngLat(feature);
    if (!ring || !ringCoveredBy(ring, areas)) continue;
    for (const key of featureKeys(feature)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

export function towerTiers(base, height, lod) {
  const span = height - base;
  if (span >= 160 && lod >= 1) {
    const podium = base + Math.min(24, span * 0.08);
    return [
      { from: base, to: podium, scale: 1 },
      { from: podium, to: base + span * 0.74, scale: 0.9 },
      { from: base + span * 0.74, to: base + span * 0.9, scale: 0.74 },
      { from: base + span * 0.9, to: height, scale: 0.58 },
    ];
  }
  if (span >= 160) {
    const shaft = base + span * 0.8;
    return [
      { from: base, to: shaft, scale: 1 },
      { from: shaft, to: height, scale: 0.72 },
    ];
  }
  if (lod >= 1) {
    const a = base + span * 0.62;
    const b = base + span * 0.86;
    return [
      { from: base, to: a, scale: 1 },
      { from: a, to: b, scale: 0.86 },
      { from: b, to: height, scale: 0.7 },
    ];
  }
  const a = base + span * 0.78;
  return [
    { from: base, to: a, scale: 1 },
    { from: a, to: height, scale: 0.8 },
  ];
}

export function massingMaterials(roof) {
  return {
    body: MASSING_PALETTE.steel,
    crown: MASSING_PALETTE.paper,
    roof: roof === 'pitched' ? MASSING_PALETTE.gold : MASSING_PALETTE.paper,
    edge: MASSING_PALETTE.ink,
  };
}

export function metersPerDegree(lat) {
  const latRad = lat * Math.PI / 180;
  return { east: 111320 * Math.cos(latRad), north: 110540 };
}

export function toLocal(lng, lat, origin) {
  const meters = metersPerDegree(origin[1]);
  const east = (lng - origin[0]) * meters.east;
  const north = (lat - origin[1]) * meters.north;
  return [east, -north];
}

export function outerRingLngLat(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  let ring = null;
  if (geometry.type === 'Polygon') ring = geometry.coordinates?.[0];
  else if (geometry.type === 'MultiPolygon') {
    let best = null;
    for (const part of geometry.coordinates ?? []) {
      const outer = part?.[0];
      if (!outer) continue;
      if (!best || Math.abs(signedAreaLng(outer)) > Math.abs(signedAreaLng(best))) best = outer;
    }
    ring = best;
  }
  if (!ring || ring.length < 4) return null;
  const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  const out = [];
  for (const point of open) {
    if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const prev = out.at(-1);
    if (prev && Math.abs(prev[0] - point[0]) < 1e-12 && Math.abs(prev[1] - point[1]) < 1e-12) continue;
    out.push([point[0], point[1]]);
  }
  return out.length >= 3 ? out : null;
}

function signedAreaLng(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

export function signedAreaXZ(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
}

export function orientCCW(ring) {
  const copy = ring.map((point) => [point[0], point[1]]);
  if (signedAreaXZ(copy) < 0) copy.reverse();
  return copy;
}

export function scaleAbout(ring, scale) {
  let cx = 0;
  let cz = 0;
  for (const point of ring) { cx += point[0]; cz += point[1]; }
  cx /= ring.length;
  cz /= ring.length;
  return ring.map(([x, z]) => [cx + (x - cx) * scale, cz + (z - cz) * scale]);
}

function area2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function pointInTriangle(p, a, b, c) {
  const c1 = area2(a, b, p);
  const c2 = area2(b, c, p);
  const c3 = area2(c, a, p);
  const hasNeg = c1 < -1e-9 || c2 < -1e-9 || c3 < -1e-9;
  const hasPos = c1 > 1e-9 || c2 > 1e-9 || c3 > 1e-9;
  return !(hasNeg && hasPos);
}

export function triangulateXZ(ring) {
  const pts = ring.map((point) => [point[0], point[1]]);
  if (pts.length >= 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-8) pts.pop();
  }
  if (signedAreaXZ(pts) < 0) pts.reverse();
  const idx = pts.map((_, index) => index);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 8000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = pts[i0];
      const b = pts[i1];
      const c = pts[i2];
      if (area2(a, b, c) <= 1e-10) continue;
      let ear = true;
      for (const k of idx) {
        if (k === i0 || k === i1 || k === i2) continue;
        if (pointInTriangle(pts[k], a, b, c)) { ear = false; break; }
      }
      if (!ear) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else if (idx.length > 3) {
    tris.length = 0;
    for (let i = 1; i < pts.length - 1; i++) tris.push([0, i, i + 1]);
  }
  return { pts, tris };
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function longAxis(ring) {
  let cx = 0;
  let cz = 0;
  for (const point of ring) { cx += point[0]; cz += point[1]; }
  cx /= ring.length;
  cz /= ring.length;
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const point of ring) {
    const x = point[0] - cx;
    const z = point[1] - cz;
    xx += x * x;
    xz += x * z;
    zz += z * z;
  }
  const trace = xx + zz;
  const det = xx * zz - xz * xz;
  const lambda = trace / 2 + Math.sqrt(Math.max(0, trace * trace / 4 - det));
  let ax = 1;
  let az = 0;
  if (Math.abs(xz) > 1e-8) { ax = lambda - zz; az = xz; }
  else if (zz > xx) { ax = 0; az = 1; }
  const len = Math.hypot(ax, az) || 1;
  ax /= len;
  az /= len;
  return { cx, cz, ax, az, px: -az, pz: ax };
}

export class MeshDraft {
  constructor() {
    this.groups = new Map();
  }

  group(name) {
    let entry = this.groups.get(name);
    if (!entry) {
      entry = { positions: [], normals: [] };
      this.groups.set(name, entry);
    }
    return entry;
  }

  tri(name, a, b, c) {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return;
    nx /= len;
    ny /= len;
    nz /= len;
    const entry = this.group(name);
    for (const point of [a, b, c]) {
      entry.positions.push(point.x, point.y, point.z);
      entry.normals.push(nx, ny, nz);
    }
  }

  quad(name, a, b, c, d) {
    this.tri(name, a, b, c);
    this.tri(name, a, c, d);
  }

  walls(name, ring, y0, y1) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      this.quad(
        name,
        { x: a[0], y: y0, z: a[1] },
        { x: b[0], y: y0, z: b[1] },
        { x: b[0], y: y1, z: b[1] },
        { x: a[0], y: y1, z: a[1] },
      );
    }
  }

  cap(name, ring, y) {
    const { pts, tris } = triangulateXZ(ring);
    for (const [i, j, k] of tris) {
      const a = pts[i];
      const b = pts[j];
      const c = pts[k];
      this.tri(name, { x: a[0], y, z: a[1] }, { x: b[0], y, z: b[1] }, { x: c[0], y, z: c[1] });
    }
  }

  finish(name) {
    const entry = this.groups.get(name);
    if (!entry || entry.positions.length < 9) return null;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < entry.positions.length; i += 3) {
      const x = entry.positions[i];
      const y = entry.positions[i + 1];
      const z = entry.positions[i + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return {
      positions: Float32Array.from(entry.positions),
      normals: Float32Array.from(entry.normals),
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    };
  }
}

export function addGableRoof(draft, slopeMaterial, endMaterial, ring, yEave, yRidge) {
  const axis = longAxis(ring);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const along = Math.abs((b[0] - a[0]) * axis.ax + (b[1] - a[1]) * axis.az);
    const across = Math.abs((b[0] - a[0]) * axis.px + (b[1] - a[1]) * axis.pz);
    const material = along >= across ? slopeMaterial : endMaterial;
    const project = (point) => {
      const t = (point[0] - axis.cx) * axis.ax + (point[1] - axis.cz) * axis.az;
      return { x: axis.cx + axis.ax * t, y: yRidge, z: axis.cz + axis.az * t };
    };
    const A = { x: a[0], y: yEave, z: a[1] };
    const B = { x: b[0], y: yEave, z: b[1] };
    const pa = project(a);
    const pb = project(b);
    draft.tri(material, A, B, pb);
    draft.tri(material, A, pb, pa);
  }
}

function centroidLngLat(ring) {
  let lng = 0;
  let lat = 0;
  for (const point of ring) { lng += point[0]; lat += point[1]; }
  return [lng / ring.length, lat / ring.length];
}

export function buildTowerBuffers(feature, lod = 1) {
  const props = feature?.properties ?? {};
  if (!isTowerCandidate(props)) return null;
  const ringLngLat = outerRingLngLat(feature);
  if (!ringLngLat) return null;
  const origin = centroidLngLat(ringLngLat);
  const local = orientCCW(ringLngLat.map(([lng, lat]) => toLocal(lng, lat, origin)));
  const height = resolveHeight(props);
  const base = resolveBase(props, height);
  const roof = roofChoice(props, height);
  const tiers = towerTiers(base, height, lod);
  const draft = new MeshDraft();
  const edges = [];
  tiers.forEach((tier, index) => {
    const ring = scaleAbout(local, tier.scale);
    const top = index === tiers.length - 1;
    if (top && roof === 'pitched') {
      const eaveDrop = Math.min(8, Math.max(3, (height - base) * 0.06));
      const eave = Math.max(tier.from, tier.to - eaveDrop);
      draft.walls('body', ring, tier.from, eave);
      addGableRoof(draft, 'roof', 'body', ring, eave, tier.to);
    } else {
      draft.walls('body', ring, tier.from, tier.to);
      draft.cap(top ? 'roof' : 'crown', ring, tier.to);
    }
    if (lod >= 1 && ring.length <= 48) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        edges.push(a[0], tier.from, a[1], b[0], tier.from, b[1]);
        edges.push(a[0], tier.to, a[1], b[0], tier.to, b[1]);
        edges.push(a[0], tier.from, a[1], a[0], tier.to, a[1]);
      }
    }
  });
  return {
    keys: featureKeys(feature),
    origin,
    body: draft.finish('body'),
    crown: draft.finish('crown'),
    roof: draft.finish('roof'),
    edges,
    colors: massingMaterials(roof),
    properties: props,
    ring: ringLngLat,
  };
}

export function filterHidingIds(baseFilter, ids) {
  if (!ids?.length) return baseFilter ?? null;
  const hide = ['!', ['in', ['to-string', ['coalesce', ['get', 'id'], ['get', 'osm_id'], ['id'], '']], ['literal', ids]]];
  return baseFilter ? ['all', baseFilter, hide] : hide;
}

export function palaceHideKeys() {
  const keys = [...GRAND_PALACE_SLOT.hideIds];
  for (const id of GRAND_PALACE_SLOT.hideIds) {
    const match = /^bkk-building-(\d+)$/.exec(id);
    if (match && !keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

export function reapplyMassingFilters(map) {
  if (!runtime.installed) return;
  const target = map || runtime.map;
  if (!target?.getLayer) return;
  const ids = runtime.active ? runtime.hiddenIds : [];
  for (const layerId of [HI_LAYER, RATTANAKOSIN_LAYER]) {
    if (!target.getLayer(layerId)) continue;
    try { target.setFilter(layerId, filterHidingIds(runtime.baseFilter, ids)); } catch (error) {
      console.warn('BKKx massing filter failed:', error);
    }
  }
  if (target.getLayer(LANDMARKS_LAYER)) {
    try {
      target.setFilter(LANDMARKS_LAYER, ids.length ? filterHidingIds(null, ids) : null);
    } catch (error) {
      console.warn('BKKx massing landmark filter failed:', error);
    }
  }
  if (target.getLayer(ROOF_LAYER)) {
    try {
      target.setFilter(ROOF_LAYER, runtime.palaceShown ? ['!=', ['get', 'name'], PALACE_ROOF_NAME] : null);
    } catch (error) {
      console.warn('BKKx massing roof filter failed:', error);
    }
  }
}

export function massingFeatureAt(lngLat) {
  if (!runtime.active || !lngLat) return null;
  const x = lngLat.lng ?? lngLat[0];
  const y = lngLat.lat ?? lngLat[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const hit of runtime.hits) {
    if (pointInRing(x, y, hit.ring)) return hit.feature;
  }
  if (runtime.palaceShown) {
    for (const ring of runtime.palaceRings) {
      if (pointInRing(x, y, ring)) return runtime.palaceFeature;
    }
  }
  return null;
}

function setPalaceNote(shown) {
  if (typeof document === 'undefined') return;
  const note = document.getElementById('atlas-massing-note');
  if (note) note.hidden = !shown;
}

function viewBounds(map) {
  const bounds = map.getBounds();
  return {
    west: bounds.getWest(),
    east: bounds.getEast(),
    south: bounds.getSouth(),
    north: bounds.getNorth(),
  };
}

function ringBox(ring) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of ring) {
    west = Math.min(west, point[0]);
    east = Math.max(east, point[0]);
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  return { west, east, south, north };
}

function boxesOverlap(a, b) {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

function ringInside(ring, bounds) {
  return ring.every((point) => point[0] >= bounds.west && point[0] <= bounds.east && point[1] >= bounds.south && point[1] <= bounds.north);
}

function insetBounds(bounds, fraction) {
  const dx = (bounds.east - bounds.west) * fraction;
  const dy = (bounds.north - bounds.south) * fraction;
  return { west: bounds.west + dx, east: bounds.east - dx, south: bounds.south + dy, north: bounds.north - dy };
}

function safeSourceFeatures(map, source, sourceLayer) {
  if (!map.getSource?.(source)) return [];
  try {
    return sourceLayer ? map.querySourceFeatures(source, { sourceLayer }) : map.querySourceFeatures(source);
  } catch {
    return [];
  }
}

function collectTowers(map) {
  const bounds = viewBounds(map);
  const chosen = new Map();
  for (const feature of safeSourceFeatures(map, LANDMARKS_SOURCE)) {
    if (!isTowerCandidate(feature.properties)) continue;
    const ring = outerRingLngLat(feature);
    if (!ring || !boxesOverlap(ringBox(ring), bounds)) continue;
    const key = featureKeys(feature)[0];
    if (key) chosen.set(key, feature);
  }
  if (map.getLayer?.(HI_LAYER)) {
    let rendered = [];
    try { rendered = map.queryRenderedFeatures({ layers: [HI_LAYER] }); } catch { rendered = []; }
    const inset = insetBounds(bounds, 0.06);
    const knownOsm = new Set();
    const claimed = [];
    for (const feature of chosen.values()) {
      for (const key of featureKeys(feature)) knownOsm.add(key);
      const ring = outerRingLngLat(feature);
      if (ring) claimed.push(ring);
    }
    let scanned = 0;
    for (const feature of rendered) {
      if (++scanned > 4000) break;
      if (!isTowerCandidate(feature.properties)) continue;
      const keys = featureKeys(feature);
      if (!keys.length || keys.some((key) => knownOsm.has(key) || chosen.has(key))) continue;
      const ring = outerRingLngLat(feature);
      if (!ring || !ringInside(ring, inset)) continue;
      if (ringCoveredBy(ring, claimed)) continue;
      chosen.set(keys[0], feature);
    }
  }
  const cap = (map.getContainer?.().clientWidth ?? 800) < 500 ? 16 : 32;
  return [...chosen.values()]
    .sort((a, b) => resolveHeight(b.properties) - resolveHeight(a.properties))
    .slice(0, cap);
}

function palaceInView(map) {
  const bounds = viewBounds(map);
  const [lng, lat] = GRAND_PALACE_SLOT.anchor;
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function buildingsVisible(map) {
  if (!map.getLayer?.(HI_LAYER) && !map.getLayer?.(LANDMARKS_LAYER)) return true;
  const id = map.getLayer(HI_LAYER) ? HI_LAYER : LANDMARKS_LAYER;
  return map.getLayoutProperty(id, 'visibility') !== 'none';
}

function loadThree() {
  if (!runtime.threePromise) {
    runtime.threePromise = (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
      const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
      return { THREE, GLTFLoader, DRACOLoader, MeshoptDecoder };
    })().catch((error) => {
      runtime.threePromise = null;
      throw error;
    });
  }
  return runtime.threePromise;
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

function createCustomLayer(libs) {
  const { THREE } = libs;
  return {
    id: MASSING_LAYER,
    type: 'custom',
    renderingMode: '3d',
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
      const sun = new THREE.DirectionalLight(0xffffff, 0.48);
      sun.position.set(-0.35, 1, 0.2);
      this.scene.add(sun);
      this.content = new THREE.Group();
      this.content.name = 'content';
      this.content.frustumCulled = false;
      this.scene.add(this.content);
      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      this.renderer.autoClear = false;
      runtime.scene = this.scene;
      runtime.camera = this.camera;
      runtime.renderer = this.renderer;
      runtime.content = this.content;
    },
    render(gl, args) {
      if (!runtime.active || !this.renderer || !runtime.content?.visible) return;
      if (typeof maplibregl === 'undefined') return;
      const matrix = args?.defaultProjectionData?.mainMatrix;
      if (!matrix) return;
      const coord = maplibregl.MercatorCoordinate.fromLngLat(runtime.origin, runtime.altitude);
      const scale = coord.meterInMercatorCoordinateUnits();
      const main = new THREE.Matrix4().fromArray(matrix);
      const model = new THREE.Matrix4()
        .makeTranslation(coord.x, coord.y, coord.z)
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
      this.camera.projectionMatrix = main.multiply(model);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    },
  };
}

function parkLayer(map) {
  if (!map.getLayer(MASSING_LAYER)) return;
  const before = ['bkkx-roads-minor', 'bkkx-land-price-fill', 'bkkx-khlongs-river'];
  for (const id of before) {
    if (!map.getLayer(id)) continue;
    try { map.moveLayer(MASSING_LAYER, id); } catch { /* stack order will catch up */ }
    return;
  }
}

async function ensureLayer(map, libs) {
  if (map.getLayer(MASSING_LAYER)) return;
  const layer = createCustomLayer(libs);
  runtime.layer = layer;
  map.addLayer(layer);
  parkLayer(map);
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((node) => {
    node.geometry?.dispose?.();
    const materials = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : [];
    for (const material of materials) material.dispose?.();
  });
}

function addBufferMesh(THREE, parent, geometry, color) {
  if (!geometry) return;
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
  buffer.setAttribute('normal', new THREE.BufferAttribute(geometry.normals, 3));
  const mesh = new THREE.Mesh(buffer, new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  parent.add(mesh);
}

function matteMaterials(THREE, root) {
  root.traverse((node) => {
    node.frustumCulled = false;
    if (!node.isMesh) return;
    const sources = Array.isArray(node.material) ? node.material : [node.material];
    const next = sources.map((source) => new THREE.MeshLambertMaterial({
      color: source?.color ? source.color.clone() : new THREE.Color(MASSING_PALETTE.paper),
      map: source?.map ?? null,
      side: THREE.DoubleSide,
    }));
    node.material = next.length === 1 ? next[0] : next;
  });
}

function loadPalaceModel(libs) {
  if (!runtime.palaceLoad) {
    runtime.palaceLoad = new Promise((resolve, reject) => {
      const { GLTFLoader, DRACOLoader, MeshoptDecoder, THREE } = libs;
      const loader = new GLTFLoader();
      const draco = new DRACOLoader();
      draco.setDecoderPath(DRACO_DECODER);
      loader.setDRACOLoader(draco);
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.load(GRAND_PALACE_SLOT.file, (gltf) => {
        matteMaterials(THREE, gltf.scene);
        gltf.scene.name = 'grand-palace-stand-in';
        resolve(gltf.scene);
      }, undefined, reject);
    }).catch((error) => {
      runtime.palaceLoad = null;
      throw error;
    });
  }
  return runtime.palaceLoad;
}

function showPalacePopup(map, lngLat) {
  if (typeof maplibregl === 'undefined' || typeof document === 'undefined') return;
  runtime.popup?.remove();
  const card = document.createElement('div');
  card.className = 'atlas-cctv-card';
  const title = document.createElement('strong');
  title.textContent = GRAND_PALACE_SLOT.name;
  const note = document.createElement('p');
  note.textContent = GRAND_PALACE_SLOT.note;
  const credit = document.createElement('p');
  credit.textContent = 'Footprints © OpenStreetMap contributors, ODbL.';
  card.append(title, note, credit);
  runtime.popup = new maplibregl.Popup({ className: 'atlas-cctv-popup', maxWidth: '280px' })
    .setLngLat(lngLat)
    .setDOMContent(card)
    .addTo(map);
}

function deactivate(map) {
  if (!runtime.active && runtime.hiddenIds.length === 0 && !runtime.palaceShown) {
    setPalaceNote(false);
    return;
  }
  runtime.active = false;
  runtime.hiddenIds = [];
  runtime.palaceShown = false;
  runtime.hits = [];
  runtime.palaceRings = [];
  runtime.signature = '';
  if (runtime.content) runtime.content.visible = false;
  setPalaceNote(false);
  runtime.popup?.remove();
  reapplyMassingFilters(map);
  map.triggerRepaint?.();
}

function rebuildScene(map, libs, towers, palaceObject) {
  const { THREE } = libs;
  const center = map.getCenter();
  runtime.origin = [center.lng, center.lat];
  runtime.altitude = terrainMeters(map, runtime.origin);
  if (!runtime.content) return;
  const previous = runtime.content.getObjectByName('towers');
  if (previous) {
    runtime.content.remove(previous);
    disposeGroup(previous);
  }
  const towersGroup = new THREE.Group();
  towersGroup.name = 'towers';
  towersGroup.frustumCulled = false;
  const hits = [];
  for (const built of towers) {
    const mesh = buildTowerBuffers(built, map.getZoom() >= 17 ? 1 : 0);
    if (!mesh) continue;
    const offset = toLocal(mesh.origin[0], mesh.origin[1], runtime.origin);
    const group = new THREE.Group();
    group.position.set(offset[0], terrainMeters(map, mesh.origin) - runtime.altitude, offset[1]);
    group.frustumCulled = false;
    addBufferMesh(THREE, group, mesh.body, mesh.colors.body);
    addBufferMesh(THREE, group, mesh.crown, mesh.colors.crown);
    addBufferMesh(THREE, group, mesh.roof, mesh.colors.roof);
    if (mesh.edges.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.edges, 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: mesh.colors.edge }));
      lines.frustumCulled = false;
      group.add(lines);
    }
    towersGroup.add(group);
    hits.push({
      ring: mesh.ring,
      feature: {
        type: 'Feature',
        properties: { ...mesh.properties, massing: 'setback' },
        geometry: built.geometry,
      },
    });
  }
  runtime.content.add(towersGroup);
  if (palaceObject) {
    if (palaceObject.parent !== runtime.content) runtime.content.add(palaceObject);
    const offset = toLocal(GRAND_PALACE_SLOT.anchor[0], GRAND_PALACE_SLOT.anchor[1], runtime.origin);
    palaceObject.position.set(
      offset[0],
      terrainMeters(map, GRAND_PALACE_SLOT.anchor) - runtime.altitude,
      offset[1],
    );
    palaceObject.rotation.y = GRAND_PALACE_SLOT.yaw;
    palaceObject.scale.setScalar(GRAND_PALACE_SLOT.scale || 1);
    palaceObject.visible = true;
  } else if (runtime.palaceObject) {
    runtime.palaceObject.visible = false;
  }
  runtime.content.visible = true;
  runtime.hits = hits;
  runtime.active = true;
}

async function refreshMassing(map) {
  const gen = ++runtime.gen;
  if (!map || map.getZoom() < MASSING_MIN_ZOOM || !buildingsVisible(map)) {
    deactivate(map);
    return;
  }
  const towers = collectTowers(map);
  const wantPalace = palaceInView(map);
  if (!towers.length && !wantPalace) {
    deactivate(map);
    return;
  }
  const lod = map.getZoom() >= 17 ? 1 : 0;
  const signature = [
    map.getZoom().toFixed(2),
    map.getCenter().lng.toFixed(4),
    map.getCenter().lat.toFixed(4),
    lod,
    wantPalace ? 1 : 0,
    towers.map((feature) => featureKeys(feature)[0]).sort().join(','),
  ].join('|');
  if (signature === runtime.signature && runtime.active) return;

  let libs;
  try {
    libs = await loadThree();
  } catch (error) {
    console.warn('BKKx massing: three.js did not load; extrusions kept.', error);
    deactivate(map);
    return;
  }
  if (gen !== runtime.gen) return;
  runtime.libs = libs;
  try {
    await ensureLayer(map, libs);
  } catch (error) {
    console.warn('BKKx massing layer failed; extrusions kept.', error);
    deactivate(map);
    return;
  }
  if (gen !== runtime.gen) return;

  let palaceObject = null;
  if (wantPalace) {
    try {
      palaceObject = await loadPalaceModel(libs);
      runtime.palaceObject = palaceObject;
    } catch (error) {
      console.warn('Grand Palace stand-in failed to load; extrusions kept.', error);
      palaceObject = null;
    }
  }
  if (gen !== runtime.gen) return;

  rebuildScene(map, libs, towers, palaceObject);
  const hidden = [];
  const towerRings = [];
  for (const feature of towers) {
    for (const key of featureKeys(feature)) if (!hidden.includes(key)) hidden.push(key);
    const ring = outerRingLngLat(feature);
    if (ring) towerRings.push(ring);
  }
  if (towerRings.length && map.getLayer?.(HI_LAYER)) {
    let rendered = [];
    try { rendered = map.queryRenderedFeatures({ layers: [HI_LAYER] }); } catch { rendered = []; }
    for (const key of keysInsideRings(rendered, towerRings)) {
      if (!hidden.includes(key)) hidden.push(key);
    }
  }
  runtime.palaceShown = Boolean(palaceObject);
  if (runtime.palaceShown) {
    for (const key of palaceHideKeys()) if (!hidden.includes(key)) hidden.push(key);
    runtime.palaceRings = safeSourceFeatures(map, HERITAGE_SOURCE)
      .filter((feature) => GRAND_PALACE_SLOT.hideIds.includes(feature?.properties?.id))
      .map(outerRingLngLat)
      .filter(Boolean);
    runtime.palaceFeature = {
      type: 'Feature',
      properties: {
        name: GRAND_PALACE_SLOT.name,
        name_en: GRAND_PALACE_SLOT.name,
        building: 'palace',
        id: GRAND_PALACE_SLOT.id,
        standIn: true,
        accuracy: GRAND_PALACE_SLOT.note,
      },
      geometry: { type: 'Point', coordinates: GRAND_PALACE_SLOT.anchor },
    };
  } else {
    runtime.palaceRings = [];
  }
  runtime.hiddenIds = hidden;
  runtime.signature = signature;
  setPalaceNote(runtime.palaceShown);
  reapplyMassingFilters(map);
  map.triggerRepaint?.();
}

function scheduleRefresh(map) {
  if (runtime.frame) return;
  runtime.frame = requestAnimationFrame(() => {
    runtime.frame = 0;
    refreshMassing(map).catch((error) => {
      console.warn('BKKx massing refresh failed; extrusions kept.', error);
    });
  });
}

function clearArm() {
  if (!runtime.arm) return;
  clearTimeout(runtime.arm);
  runtime.arm = 0;
}

// Landmark GeoJSON is often not queryable on the same turn it is added, and
// a map that never goes idle (a tile 404 storm) will not fire the idle
// listener. Retry a few times so a deep link at street zoom still builds.
function armRefresh(map) {
  scheduleRefresh(map);
  clearArm();
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (!runtime.map || runtime.active || tries > 8 || map.getZoom() < MASSING_MIN_ZOOM) {
      runtime.arm = 0;
      return;
    }
    scheduleRefresh(map);
    runtime.arm = setTimeout(tick, 400);
  };
  runtime.arm = setTimeout(tick, 400);
}

export function suspendBuildingMassing(map) {
  deactivate(map);
}

export function installBuildingMassing(map, baseFilter) {
  if (!map) return;
  if (runtime.map === map) {
    queueMicrotask(() => armRefresh(map));
    return;
  }
  runtime.installed = true;
  runtime.map = map;
  runtime.baseFilter = baseFilter ?? null;
  map.on('zoom', () => {
    if (map.getZoom() < MASSING_MIN_ZOOM) {
      clearArm();
      deactivate(map);
    }
  });
  map.on('zoomend', () => armRefresh(map));
  map.on('moveend', () => armRefresh(map));
  map.on('resize', () => armRefresh(map));
  map.on('idle', () => scheduleRefresh(map));
  map.on('click', (event) => {
    const hit = massingFeatureAt(event.lngLat);
    if (hit?.properties?.standIn) showPalacePopup(map, event.lngLat);
  });
  armRefresh(map);
}

export function uninstallBuildingMassing(map) {
  clearArm();
  deactivate(map);
  if (map?.getLayer?.(MASSING_LAYER)) {
    try { map.removeLayer(MASSING_LAYER); } catch { /* already gone */ }
  }
  runtime.installed = false;
  runtime.map = null;
  runtime.signature = '';
}
