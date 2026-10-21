// Bangkok city forms: the two roof signatures that make a real street read
// as Bangkok instead of as a row of boxes.
//
//   1. LOW-RISE PITCHED. Houses, row units, small shops and sheds in Bangkok
//      are almost never flat-topped. They carry a tiled gable or hip, and the
//      roof is the only part of the building most people ever see from a
//      footpath. On the atlas, every one of them was a grey box with a lid.
//
//   2. MID-RISE ROOFTOP PLANT. A flat-roofed mid-rise in Bangkok is never a
//      flat roof. It is a roof deck crowded with black water tanks, condenser
//      units, a stair hut and a forest of aerial. The tanks are the single
//      most recognisable thing about the Bangkok skyline after the temples.
//
// Honesty, and it matters here. The atlas draws real OSM footprints at real
// heights. Neither of these two forms is surveyed. A hip roof here is a
// TYPOLOGICAL READING of a low-rise footprint: "buildings of this size and
// this shape in this city have pitched roofs". Rooftop plant is the same
// claim about a flat roof. Neither asserts that a particular building has a
// particular roof, and every feature this module emits says so in its
// `accuracy` field, the way the heritage forms already do.
//
// The two decisions that drive the classification are therefore deliberately
// blunt, because the data available at street zoom is blunt: the OpenMapTiles
// building layer carries a height and a footprint and nothing else. There is
// no `building=house` tag to read, so "house" cannot mean "house". It means
// "low, narrow, and small" — the shape a house has.
//
// Geometry is pure: no DOM, no three.js, no MapLibre. The geometry itself is
// in public/city-forms-geometry.js, and the layer that draws it is
// public/city-forms-layer.js.
//
// One rule makes this work: the roof never carries a height of its own. It
// takes the building's height from the shared rule in building-heights.js —
// the same expression the walls are drawn with, through its JavaScript twin.
// A roof therefore cannot drift from its box, because there is only one
// number.
import { heightFor } from './building-heights.js';

export const DEFAULT_OPTIONS = {
  // Low-rise, pitched. A footprint wider than this is a warehouse or a hall,
  // not a house; a footprint deeper than this is a plot, not a building.
  hipMaxHeight: 13,
  hipMaxArea: 2600,
  hipMaxLong: 120,
  hipMaxShort: 18,
  // How badly the oriented box may overshoot the footprint. A roof is fitted
  // to a rectangle, so a footprint the rectangle does not describe gets no
  // roof: the roof would hang over the street.
  hipMaxFitRatio: 1.9,
  // Mid-rise, flat roof with plant on it.
  plantMinHeight: 13,
  plantMaxHeight: 70,
  plantMinArea: 170,
  // Geometry budget.
  strips: 24,
  tiers: 3,
  eave: 0.55,
  roofRise: 3.1,
  // How far each tier up steps the ridge. It has to exceed the rise the
  // cross-slope loses between tiers, or the upper tier would sink into the
  // lower one instead of stepping over it.
  roofStep: 1.05,
  // How much of the footprint each tier keeps. The short axis shrinks faster
  // than the long one, so the tiers climb to a ridge that runs the length of
  // the building and stops short of the ends: a hip, not a gable.
  hipShortScale: [1, 0.72, 0.44],
  hipLongScale: [1, 0.9, 0.72],
  tankHeight: 1.8,
  acHeight: 0.9,
  hutHeight: 2.6,
  // How many buildings may receive treatment in one pass. A full street view
  // at z16.6 holds about 2,300 buildings; treating them all costs one
  // 120,000-triangle mesh and a ~45 ms rebuild at the end of a pan.
  budget: 2000,
};

const EARTH_R = 6378137;
const DEG = Math.PI / 180;

export function metersPerDegree(lat) {
  return {
    east: EARTH_R * Math.cos(lat * DEG) * DEG,
    north: EARTH_R * DEG,
  };
}

// Ring -> local metres, east positive, north positive.
export function toLocalMeters(ring, origin) {
  const m = metersPerDegree(origin[1]);
  return ring.map(([lng, lat]) => [(lng - origin[0]) * m.east, (lat - origin[1]) * m.north]);
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}

// The oriented bounding box of a footprint: the rectangle a roof is fitted to.
// Returns centre, unit axes (east-ish and north-ish) and half extents.
export function orientedBox(ring) {
  const c = ringCentroid(ring);
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 0.4) continue;
    const ux = ex / len;
    const uy = ey / len;
    let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
    for (const [px, py] of ring) {
      const dx = px - c[0];
      const dy = py - c[1];
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, ux, uy, minU, maxU, minV, maxV, centre: c };
    }
  }
  if (!best) return null;
  const halfU = (best.maxU - best.minU) / 2;
  const halfV = (best.maxV - best.minV) / 2;
  const midU = (best.minU + best.maxU) / 2;
  const midV = (best.minV + best.maxV) / 2;
  return {
    centre: [best.centre[0] + best.ux * midU - best.uy * midV, best.centre[1] + best.uy * midU + best.ux * midV],
    ux: best.ux,
    uy: best.uy,
    halfU,
    halfV,
    // The area of the fitted rectangle, so the caller can ask how well the
    // rectangle describes the footprint.
    area: best.area,
    long: Math.max(halfU, halfV) * 2,
    short: Math.min(halfU, halfV) * 2,
  };
}

// The height the atlas already extrudes this building to, resolved through
// the shared rule in building-heights.js — the same rule the MapLibre
// expression uses, so the classifier and the drawing agree.
export function resolveHeight(props, family = 'metro') {
  return heightFor(props, family);
}

export function outerRing(feature) {
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

// What this footprint is allowed to wear.
//
// 'hip'   a low, narrow footprint gets a pitched roof
// 'plant' a mid-rise flat roof gets tanks, condensers and a stair hut
// null    nothing — and saying nothing is a real answer, not a default
export function classifyRoof(feature, options = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const ring = outerRing(feature);
  if (!ring || ring.length < 4) return null;
  const origin = o.origin ?? [ring[0][0], ring[0][1]];
  const local = toLocalMeters(ring, origin);
  if (local.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  const area = ringArea(local);
  if (area < 12) return null;
  const box = orientedBox(local);
  if (!box) return null;
  const { height, base, degenerate } = resolveHeight(feature.properties ?? {}, o.family ?? 'metro');
  if (degenerate) return null;
  if (height > o.plantMaxHeight) return null;
  // How well does the fitted rectangle describe the footprint? A roof is
  // drawn to the rectangle, so a footprint the rectangle overshoots gets no
  // roof: the roof would hang out over the street.
  const fit = area > 0 ? box.area / area : Infinity;
  if (fit > o.hipMaxFitRatio) return null;
  if (height <= o.hipMaxHeight && area <= o.hipMaxArea && box.long <= o.hipMaxLong && box.short <= o.hipMaxShort) {
    return { kind: 'hip', height, base, area, box, local, fit };
  }
  if (height >= o.plantMinHeight && area >= o.plantMinArea) {
    return { kind: 'plant', height, base, area, box, local, fit };
  }
  return null;
}
