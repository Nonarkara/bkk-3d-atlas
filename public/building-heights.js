// One source of truth for how tall a building is.
//
// The atlas extrudes buildings with a MapLibre expression. Anything that has
// to sit ON those buildings — a roof, a water tank, a stair hut — has to know
// the same number, or it floats above the roof or drowns inside the walls.
//
// So the expression lives here, next to the table it reads, and this module
// also carries a JavaScript twin of it for the code that cannot run a
// MapLibre expression (the city forms classifier). The twin is not a guess:
// scripts/test-building-heights.mjs walks the same cases through both and
// fails if they ever disagree.
//
// Three families of building exist in the atlas and they do NOT share a
// height rule:
//
//   metro    bkkx-3d-buildings-hi   OpenFreeMap / OpenMapTiles footprints
//   oldtown  bkkx-rattanakosin-buildings  heritage-detail GeoJSON
//   tiles    bkkx-3d-buildings     the metro PMTiles at zoom 11-15
//
// The metro and the old town have their own typology defaults. The PMTiles
// path uses the metro rule.
export const LEVEL_HEIGHT_M = 3.15;
export const DEFAULT_HEIGHT = 8.5;
export const RATTANAKOSIN_DEFAULT_HEIGHT = 9;

// Typology-aware height default, metro. Hotels are towers, a detached house
// is not, and the difference is most of what makes a skyline read as a city.
export const HEIGHT_BY_TYPE = {
  hotel: 28,
  office: 25,
  hospital: 22,
  apartments: 21,
  condominium: 24,
  dormitory: 18,
  commercial: 14,
  retail: 14,
  supermarket: 12,
  mall: 20,
  university: 16,
  college: 16,
  school: 12,
  kindergarten: 8,
  temple: 14,
  pagoda: 24,
  monastery: 14,
  government: 18,
  civic: 15,
  train_station: 14,
  transportation: 14,
  industrial: 10,
  warehouse: 10,
  factory: 10,
  house: 8.5,
  residential: 8.5,
  terrace: 8.5,
  detached: 8.5,
};

// The old town reads as a city of wats and two- to three-storey rows, so an
// untagged shophouse is lifted from 8.5 m to 12 m there.
export const RATTANAKOSIN_HEIGHT_BY_TYPE = {
  temple: 18,
  pagoda: 36,
  shrine: 14,
  chapel: 14,
  monastery: 16,
  commercial: 12,
  retail: 12,
  terrace: 12,
  house: 10,
  residential: 10,
};

const HEIGHT_NUM = ["to-number", ["coalesce", ["get", "render_height"], ["get", "height"], 0], 0];
const LEVELS_NUM = ["to-number", ["coalesce", ["get", "building:levels"], ["get", "building_levels"], ["get", "levels"], 0], 0];

function matchExpression(table, fallback) {
  const out = ["match", ["coalesce", ["get", "building"], ["get", "building_type"], ""]];
  for (const [key, value] of Object.entries(table)) out.push(key, value);
  out.push(fallback);
  return out;
}

export const HEIGHT_GET = [
  "case",
  ["all", [">=", HEIGHT_NUM, 1], ["<=", HEIGHT_NUM, 500]],
  HEIGHT_NUM,
  ["all", [">=", LEVELS_NUM, 1], ["<=", LEVELS_NUM, 160]],
  ["*", LEVELS_NUM, LEVEL_HEIGHT_M],
  matchExpression(HEIGHT_BY_TYPE, DEFAULT_HEIGHT),
];

// Base must stay strictly below height — base >= height makes MapLibre emit
// degenerate roof triangles that read as sawteeth.
const MIN_HEIGHT_RAW = [
  "to-number",
  ["coalesce",
    ["get", "render_min_height"],
    ["get", "min_height"],
    ["get", "base_height"],
    0,
  ],
  0,
];

export const MIN_HEIGHT_GET = [
  "case",
  [">=", MIN_HEIGHT_RAW, HEIGHT_GET],
  HEIGHT_GET,
  ["max", 0, MIN_HEIGHT_RAW],
];

export const HAS_TAGGED_HEIGHT = [
  "any",
  ["all", [">=", HEIGHT_NUM, 1], ["<=", HEIGHT_NUM, 500]],
  ["all", [">=", LEVELS_NUM, 1], ["<=", LEVELS_NUM, 160]],
];

export const RATTANAKOSIN_HEIGHT_EXPRESSION = [
  "case",
  HAS_TAGGED_HEIGHT, HEIGHT_GET,
  matchExpression(RATTANAKOSIN_HEIGHT_BY_TYPE, RATTANAKOSIN_DEFAULT_HEIGHT),
];

export const RATTANAKOSIN_MIN_HEIGHT_EXPRESSION = [
  "case",
  [">=", MIN_HEIGHT_RAW, RATTANAKOSIN_HEIGHT_EXPRESSION],
  0,
  ["max", 0, MIN_HEIGHT_RAW],
];

// The JavaScript twin of HEIGHT_GET / MIN_HEIGHT_GET.
//
// Every branch mirrors the expression above, including the odd one: when the
// minimum height is at or above the height, the atlas uses the HEIGHT as the
// base, which makes the extrusion degenerate and invisible. A roof on such a
// building would float, so callers get `degenerate: true` and should skip it.
export function heightFor(props, family = 'metro') {
  const p = props ?? {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const tagged = num(p.render_height ?? p.height);
  const levels = num(p['building:levels'] ?? p.building_levels ?? p.levels);
  let height;
  let source;
  if (tagged >= 1 && tagged <= 500) {
    height = tagged;
    source = 'tagged-height';
  } else if (levels >= 1 && levels <= 160) {
    height = levels * LEVEL_HEIGHT_M;
    source = 'tagged-levels';
  } else {
    const type = String(p.building ?? p.building_type ?? '');
    const table = family === 'oldtown' ? RATTANAKOSIN_HEIGHT_BY_TYPE : HEIGHT_BY_TYPE;
    const fallback = family === 'oldtown' ? RATTANAKOSIN_DEFAULT_HEIGHT : DEFAULT_HEIGHT;
    height = Object.prototype.hasOwnProperty.call(table, type) ? table[type] : fallback;
    source = 'typology';
  }
  const minRaw = num(p.render_min_height ?? p.min_height ?? p.base_height);
  // The two families clamp a bad base differently, and the twin has to match
  // each one exactly: the metro rule collapses the extrusion, the old town
  // rule falls back to the ground.
  const base = family === 'oldtown'
    ? (minRaw >= height ? 0 : Math.max(0, minRaw))
    : (minRaw >= height ? height : Math.max(0, minRaw));
  return { height, base, source, degenerate: base >= height };
}
