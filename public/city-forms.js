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
// Geometry is pure: no DOM, no three.js, no MapLibre. The layer that draws it
// is public/city-forms-layer.js.
//
// One rule makes this work: a piece never carries an absolute height. It
// carries a RISE above the building it sits on, and the layer asks MapLibre
// for the building's height with the very expression the walls use. A roof
// therefore cannot drift from its box, because there is only one number.
import { heightFor } from './building-heights.js';

export const CITY_FORMS_SOURCE = 'bkkx-city-forms';
export const CITY_FORMS_LAYER = 'bkkx-city-forms-3d';

export const DEFAULT_OPTIONS = {
  // Low-rise, pitched. A footprint wider than this is a warehouse or a hall,
  // not a house; a footprint deeper than this is a plot, not a building.
  hipMaxHeight: 13,
  hipMaxArea: 460,
  hipMaxLong: 48,
  hipMaxShort: 17,
  // Mid-rise, flat roof with plant on it.
  plantMinHeight: 13,
  plantMaxHeight: 70,
  plantMinArea: 170,
  // Geometry budget.
  strips: 8,
  tiers: 3,
  eave: 0.55,
  roofRise: 3.1,
  tankHeight: 1.8,
  acHeight: 0.9,
  hutHeight: 2.6,
  // How many buildings may receive treatment in one pass.
  budget: 300,
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
  if (height <= o.hipMaxHeight && area <= o.hipMaxArea && box.long <= o.hipMaxLong && box.short <= o.hipMaxShort) {
    return { kind: 'hip', height, base, area, box, local };
  }
  if (height >= o.plantMinHeight && area >= o.plantMinArea) {
    return { kind: 'plant', height, base, area, box, local };
  }
  return null;
}

// The point on the OBB, in local metres.
function obbPoint(box, u, v) {
  return [box.centre[0] + box.ux * u - box.uy * v, box.centre[1] + box.uy * u + box.ux * v];
}

// A stepped hipped roof over a rectangular fit of the footprint.
//
// The technique is the one the heritage roofs already use: each strip of the
// roof is a thin plan sliver that spans the full width and carries its own
// top height, so a slope is drawn as a staircase of small steps.
//
// Two slopes have to be drawn at once. The CROSS slope — up from the eave
// toward the ridge — is the tiers: each tier is a smaller ring set higher
// than the last, so stepping inward steps upward. The LENGTH slope — down
// from the ridge toward the gable ends — is the taper, which lowers every
// tier's top as the strip approaches the end of the long axis.
//
// A roof with only the cross slope is a shed with a lid; a roof with only
// the length slope is a flat box with a ridge line. Both are needed.
//
// Returns local-metre polygons with `base` and `top` heights.
export function buildHipRoof(plan, options = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const { box } = plan;
  const halfU = box.halfU + o.eave;
  const halfV = box.halfV + o.eave;
  const strips = Math.max(4, Math.round(o.strips));
  const tiers = Math.max(2, Math.round(o.tiers));
  // The long axis is the one the ridge runs along. For a square-ish footprint
  // either will do; for a row unit the ridge must run the length.
  const longHalf = Math.max(box.halfU, box.halfV);
  const scales = [];
  for (let k = 0; k < tiers; k++) scales.push(1 - (1 - 0.22) * (k / Math.max(1, tiers - 1)));
  const out = [];
  for (let tier = 0; tier < tiers; tier++) {
    const scale = scales[tier];
    const tu = halfU * scale;
    const tv = halfV * scale;
    // How far below the ridge this tier's top sits.
    const drop = (tiers - 1 - tier) * (o.roofRise * 0.30);
    for (let i = 0; i < strips; i++) {
      const t0 = i / strips;
      const t1 = (i + 1) / strips;
      const u0 = -tu + 2 * tu * t0;
      const u1 = -tu + 2 * tu * t1;
      const mid = Math.abs(2 * ((t0 + t1) / 2) - 1);
      // Ridge height at this strip: full at the middle of the long axis,
      // tapering to a fifth at the ends.
      const taper = 1 - 0.8 * mid;
      // A rise, measured from the building's top. The layer adds it to
      // whatever MapLibre says the building's height is.
      const rise = Math.max(0.06, o.roofRise * taper - drop);
      const p = obbPoint(box, u0, -tv);
      const q = obbPoint(box, u1, -tv);
      const r = obbPoint(box, u1, tv);
      const s = obbPoint(box, u0, tv);
      out.push({ ring: [p, q, r, s], rise, tier, strip: i });
    }
  }
  return out;
}

// Rooftop plant: black water tanks, a condenser bank and a stair hut.
//
// The counts are a typological reading, not a survey. A tank is placed on a
// regular grid over the roof, skipping the stair hut's corner.
export function buildRooftopPlant(plan, options = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const { box } = plan;
  const out = [];
  const halfU = box.halfU - 1.6;
  const halfV = box.halfV - 1.6;
  if (halfU <= 1.2 || halfV <= 1.2) return out;
  // Tanks on a grid, sized to the roof.
  const tankR = Math.min(1.1, Math.max(0.45, Math.min(halfU, halfV) * 0.22));
  const cols = Math.max(1, Math.min(4, Math.floor((halfU * 2) / (tankR * 3.4))));
  const rows = Math.max(1, Math.min(3, Math.floor((halfV * 2) / (tankR * 3.4))));
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (cols * rows > 6 && (c + r) % 3 === 2) continue;
      const u = cols === 1 ? 0 : -halfU + (2 * halfU) * (c / (cols - 1));
      const v = rows === 1 ? 0 : -halfV + (2 * halfV) * (r / (rows - 1));
      const cx = box.centre[0] + box.ux * u - box.uy * v;
      const cy = box.centre[1] + box.uy * u + box.ux * v;
      const ring = [];
      const sides = 8;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        ring.push([cx + Math.cos(a) * tankR, cy + Math.sin(a) * tankR]);
      }
      out.push({ ring, rise: o.tankHeight, kind: 'tank' });
    }
  }
  // Condenser bank along the long edge.
  const acW = Math.min(halfU * 0.9, 2.4);
  const acD = Math.min(halfV * 0.35, 1.3);
  for (let i = 0; i < 2; i++) {
    const v = halfV - acD * (0.8 + i * 1.3);
    if (v + acD > halfV + 0.9) break;
    const u = -halfU * 0.35 + i * halfU * 0.7;
    const p = obbPoint(box, u - acW, v - acD);
    const q = obbPoint(box, u + acW, v - acD);
    const r = obbPoint(box, u + acW, v + acD);
    const s = obbPoint(box, u - acW, v + acD);
    out.push({ ring: [p, q, r, s], rise: o.acHeight, kind: 'ac' });
  }
  // Stair hut: the one opaque block every Bangkok roof carries.
  const hutW = Math.min(2.6, halfU * 0.6);
  const hutD = Math.min(2.4, halfV * 0.6);
  if (hutW > 0.8 && hutD > 0.8) {
    const p = obbPoint(box, -halfU + hutW * 0.5, -halfV + hutD * 0.5);
    const q = obbPoint(box, -halfU + hutW * 1.5, -halfV + hutD * 0.5);
    const r = obbPoint(box, -halfU + hutW * 1.5, -halfV + hutD * 1.5);
    const s = obbPoint(box, -halfU + hutW * 0.5, -halfV + hutD * 1.5);
    out.push({ ring: [p, q, r, s], rise: o.hutHeight, kind: 'hut' });
  }
  return out;
}

const HIP_COLOUR = '#8e5a3c';
const HIP_EAVE = '#c9a06a';
const TANK_COLOUR = '#2b2b2e';
const AC_COLOUR = '#8d9296';
const HUT_COLOUR = '#b9b3a6';

const ACCURACY = {
  hip: 'Schematic hipped roof · typological reading of a low-rise footprint · unsurveyed · not for flood calculations',
  plant: 'Schematic rooftop plant · typical of a flat-roofed mid-rise · unsurveyed · not for flood calculations',
};

// The height properties a roof has to carry so the layer can ask MapLibre for
// the building's height with the same expression the walls use.
const HEIGHT_PROPERTIES = [
  'render_height',
  'height',
  'building:levels',
  'building_levels',
  'levels',
  'building',
  'building_type',
  'render_min_height',
  'min_height',
  'base_height',
];

// Build the whole layer's geometry from a list of building features.
//
// The output is a GeoJSON FeatureCollection of thin vertical prisms, which
// MapLibre draws with one fill-extrusion layer per height family. Coordinates
// come back in lng/lat, because that is what a GeoJSON source needs.
//
// Each piece carries a `rise` — how far above the building's top it sits —
// and a copy of the building's height properties. The layer's paint then
// computes the absolute height as HEIGHT_GET + rise, so the roof is on the
// wall by construction and not by arithmetic done somewhere else.
// `entries` is a list of { feature, family }. It is a list of pairs and not
// a list of features because a MapLibre rendered feature carries its geometry
// on a prototype getter: spreading one to hang a `family` on it copies
// nothing that matters, and the feature silently classifies as nothing.
export function buildCityForms(entries, options = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const origin = o.origin;
  if (!origin) throw new Error('buildCityForms needs an origin');
  const m = metersPerDegree(origin[1]);
  const out = [];
  let treated = 0;
  let skipped = 0;
  const kinds = { hip: 0, plant: 0 };
  for (const entry of entries) {
    const feature = entry.feature ?? entry;
    if (treated >= o.budget) { skipped++; continue; }
    const family = entry.family ?? feature.family ?? o.family ?? 'metro';
    const plan = classifyRoof(feature, { ...o, origin, family });
    if (!plan) { skipped++; continue; }
    const pieces = plan.kind === 'hip'
      ? buildHipRoof(plan, o).map((p) => ({ ...p, kind: 'hip' }))
      : buildRooftopPlant(plan, o);
    const carried = {};
    const sourceProps = feature.properties ?? {};
    for (const key of HEIGHT_PROPERTIES) {
      if (sourceProps[key] !== undefined && sourceProps[key] !== null) carried[key] = sourceProps[key];
    }
    for (const piece of pieces) {
      const ring = piece.ring.map(([x, y]) => [
        +(origin[0] + x / m.east).toFixed(7),
        +(origin[1] + y / m.north).toFixed(7),
      ]);
      ring.push(ring[0]);
      const colour = piece.kind === 'hip'
        ? (piece.tier === 0 ? HIP_EAVE : HIP_COLOUR)
        : piece.kind === 'tank' ? TANK_COLOUR : piece.kind === 'ac' ? AC_COLOUR : HUT_COLOUR;
      out.push({
        type: 'Feature',
        properties: {
          ...carried,
          kind: piece.kind,
          form: plan.kind,
          family,
          rise: +piece.rise.toFixed(3),
          color: colour,
          accuracy: ACCURACY[plan.kind],
          source: 'OSM footprint via OpenMapTiles · ODbL',
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      });
    }
    treated++;
    kinds[plan.kind]++;
  }
  return {
    collection: { type: 'FeatureCollection', features: out },
    stats: { treated, skipped, kinds, pieces: out.length },
  };
}
