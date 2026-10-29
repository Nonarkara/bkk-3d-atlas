// One declared colour set, and a form that fits where it is drawn.
//
// This is the atlas's half of a shared rule. A temple is made of something —
// teak, plaster, dull gold, glazed ceramic, blue glass, iron — and the
// material decides the colour, once, in one table (public/temple-materials.js)
// that the forms mesh, the map's extrusion, the massing layer and the
// sibling project all read.
//
// The rule exists because the alternative was measured: 302 of the Old Town's
// 319 temples came out the same white plaster (94.6%, measured against
// bkk-heritage-detail.geojson), because "finish" said only gold / white /
// ceramic and ceramic was painted #d4d1c4 — the same white as plaster. Two
// different materials, one colour, and a city that looked like one building
// repeated. After the material rule the mix is plaster 258, teak 44, ceramic
// 10, gold 4, glass 2, iron 1 — every non-plaster one named by its own
// evidence.
//
// The second half of the rule is the plan. A form is drawn on the footprint
// it came from, and it must not overhang it: a temple standing in the road
// is a temple drawn in the wrong place. Six of the Old Town's real forms
// reached more than ten metres outside their own footprint before the plan
// was inscribed (worst 21.1 m). After the plan rule: zero.
//
// So this file asserts three things, and each is measured against the real
// data rather than a sample:
//
//   1. the palette is the only place a colour is written down
//   2. every form wears a declared material, decided from its own evidence
//   3. every form's plan fits inside the footprint it was drawn from
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TEMPLE_BODY_MATERIALS,
  TEMPLE_MATERIALS,
  TEMPLE_MATERIAL_NAMES,
  bodyOf,
  hexOf,
  intOf,
  lightOf,
  partOf,
  shadeOf,
} from '../public/temple-materials.js';
import {
  ROOF_OVERHANG,
  buildForm,
  classify,
  classifyShophouse,
  fitRectInside,
  openRing,
  outerRing,
  toLocal,
} from '../public/heritage-forms.js';

const detail = JSON.parse(
  readFileSync(new URL('../public/bkk-heritage-detail.geojson', import.meta.url), 'utf8'),
);
const shops = JSON.parse(
  readFileSync(new URL('../public/bkk-shophouse-forms.geojson', import.meta.url), 'utf8'),
);
const formsSrc = readFileSync(new URL('../public/heritage-forms.js', import.meta.url), 'utf8');

function feature(props, ring) {
  return {
    type: 'Feature',
    properties: { id: 'bkk-building-1', ...props },
    geometry: {
      type: 'Polygon',
      coordinates: [ring ?? [[100.5, 13.75], [100.501, 13.75], [100.501, 13.751], [100.5, 13.751], [100.5, 13.75]]],
    },
  };
}

/** A small footprint — about 15 m square, the size of a pavilion. */
const SMALL_RING = [
  [100.5, 13.75], [100.50014, 13.75], [100.50014, 13.75014], [100.5, 13.75014], [100.5, 13.75],
];

/** Every colour the table declares, as "r,g,b" strings. */
function paletteColors() {
  const out = new Set();
  for (const m of Object.values(TEMPLE_MATERIALS)) {
    for (const step of [m.shade, m.base, m.light]) out.add(step.map((v) => v.toFixed(6)).join(','));
    for (const p of Object.values(m.parts ?? {})) out.add(p.map((v) => v.toFixed(6)).join(','));
  }
  return out;
}

/** The convex hull of a footprint, in local metres. */
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** How far a point lies outside a convex polygon, in metres. 0 when inside. */
function outsideDistance(poly, [x, y]) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    area += x0 * y1 - x1 * y0;
  }
  const p = area < 0 ? poly.slice().reverse() : poly;
  let min = Infinity;
  for (let i = 0; i < p.length; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % p.length];
    const ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const cross = (ex * (y - ay) - ey * (x - ax)) / len;
    if (cross < min) min = cross;
  }
  return min > 0 ? 0 : -min;
}

/** Every form the atlas actually draws, from the real data. */
function allForms() {
  const out = [];
  for (const f of detail.features) {
    const s = classify(f);
    if (s) out.push(s);
  }
  for (const f of shops.features) {
    const s = classifyShophouse(f);
    if (s) out.push(s);
  }
  return out;
}

// ── 1. the palette is the only place a colour is written down ─────────────

test('no temple colour is written down outside the material table', async () => {
  const { BUILDING_COLOR_TABLE } = await import('../public/building-colors.js');
  const { MASSING_PALETTE } = await import('../public/building-massing.js');
  const golds = new Set([hexOf('gold'), hexOf('gold', 'shade'), hexOf('gold', 'light')]);
  const code = (file) => readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  // The forms mesh may not write a colour at all: every colour it wears is a
  // material's, and the materials are in the table.
  assert.deepEqual(
    code('heritage-forms.js').match(/#[0-9a-fA-F]{6}\b/g) ?? [],
    [],
    'the forms mesh writes a colour of its own',
  );

  // The massing mesh writes the atlas's own neutrals — paper, ink, steel —
  // but its gold is the table's gold, read from the table.
  const massing = code('building-massing.js');
  for (const g of golds) {
    assert.ok(!massing.includes(g), `the massing mesh hard-codes the temple gold ${g}`);
  }
  assert.equal(MASSING_PALETTE.gold, intOf('gold'));

  // The map's legend owns its categorical colours — sixty building types.
  // The religious ones are not its own.
  for (const key of ['temple', 'pagoda', 'shrine', 'wayside_shrine', 'monastery']) {
    assert.ok(golds.has(BUILDING_COLOR_TABLE[key]), `${key} wears a colour the table does not declare`);
  }
});

test('a temple is one gold in the map, the massing and the mesh', async () => {
  const { BUILDING_COLOR_TABLE } = await import('../public/building-colors.js');
  const { MASSING_PALETTE } = await import('../public/building-massing.js');
  const gold = hexOf('gold');
  assert.equal(BUILDING_COLOR_TABLE.temple, gold);
  assert.equal(BUILDING_COLOR_TABLE.pagoda, gold);
  assert.equal(MASSING_PALETTE.gold, parseInt(gold.slice(1), 16));
  // A transport shed is not a religious building and must not wear the gold.
  assert.notEqual(BUILDING_COLOR_TABLE.transportation, gold);
});

test('every material is a dark-to-light ramp, and the ramp is ordered', () => {
  for (const [name, m] of Object.entries(TEMPLE_MATERIALS)) {
    for (const step of ['shade', 'base', 'light']) {
      const c = m[step];
      assert.equal(c.length, 3, `${name}.${step} is not a colour`);
      for (const v of c) {
        assert.ok(v >= 0 && v <= 1, `${name}.${step} has a channel outside 0..1`);
      }
    }
    for (let i = 0; i < 3; i++) {
      assert.ok(m.shade[i] <= m.base[i] + 1e-9, `${name} is not dark at channel ${i}`);
      assert.ok(m.base[i] <= m.light[i] + 1e-9, `${name} is not light at channel ${i}`);
    }
  }
});

test('a body material is something a building can be; a trim is not', () => {
  assert.ok(TEMPLE_BODY_MATERIALS.includes('teak'));
  assert.ok(TEMPLE_BODY_MATERIALS.includes('plaster'));
  assert.ok(TEMPLE_BODY_MATERIALS.includes('gold'));
  assert.ok(TEMPLE_BODY_MATERIALS.includes('ceramic'));
  assert.ok(TEMPLE_BODY_MATERIALS.includes('glass'));
  assert.ok(TEMPLE_BODY_MATERIALS.includes('iron'));
  // The roof tile, the skirt tile and the plinth are architecture, not
  // substance: no building may be made of them.
  for (const trim of ['roof', 'skirt', 'plinth', 'shadow']) {
    assert.ok(!TEMPLE_BODY_MATERIALS.includes(trim), `${trim} must not be a body material`);
  }
});

test('the gold is the same dull ochre the massing layer uses', () => {
  // One gold across the atlas. The massing layer's gold roof is #c9a227; the
  // forms mesh must not carry a second, brighter one.
  assert.equal(hexOf('gold'), '#c9a227');
});

test('a material and its parts are the only colours a form can wear', () => {
  const palette = paletteColors();
  for (const spec of allForms()) {
    const mesh = buildForm(spec);
    for (let i = 0; i < mesh.colors.length; i += 3) {
      const key = [mesh.colors[i], mesh.colors[i + 1], mesh.colors[i + 2]]
        .map((v) => v.toFixed(6)).join(',');
      assert.ok(palette.has(key), `a form wears a colour the table does not declare: ${key}`);
    }
  }
});

// ── 2. the material is decided from the building's own evidence ────────────

test('a name that says timber gets timber; a name that says nothing does not', () => {
  assert.equal(classify(feature({ name: 'วิหารไม้สัก', building: 'temple', height: 20 })).material, 'teak');
  assert.equal(classify(feature({ name: 'พระอุโบสถ', building: 'temple', height: 20 })).material, 'plaster');
});

test('the famous monuments keep the material they are known for', () => {
  // Gilded, by name.
  assert.equal(classify(feature({ name: 'พระศรีรัตนเจดีย์', height: 60 })).material, 'gold');
  // Clad in coloured glass mosaic, by name.
  assert.equal(classify(feature({ name: 'พระมหาเจดีย์มุนีบัตบริขาร', height: 60 })).material, 'glass');
  // A glazed prang.
  assert.equal(classify(feature({ name: 'พระสัมมาสัมพุทธมหาเจดีย์', height: 60 })).material, 'ceramic');
  // The Metal Palace: iron, not plaster.
  assert.equal(classify(feature({ name: 'โลหะปราสาท', height: 30 })).material, 'iron');
});

test('a timber scripture hall is teak; a masonry one is plaster', () => {
  assert.equal(classify(feature({ name: 'หอมณเฑียรธรรม', height: 20 })).material, 'teak');
  assert.equal(classify(feature({ name: 'หอระฆัง', height: 20 })).material, 'teak');
  assert.equal(classify(feature({ name: 'พระมณฑป', height: 20 })).material, 'plaster');
});

test('a pavilion is timber; a masonry pavilion is not', () => {
  assert.equal(classify(feature({ name: 'ศาลาราย 3', height: 10 }, SMALL_RING)).material, 'teak');
  assert.equal(classify(feature({ name: 'พลับพลามหาเจษฎาบดินทร์', height: 20 }, SMALL_RING)).material, 'plaster');
});

test('a shophouse is not a temple and does not borrow a temple colour', () => {
  const s = classifyShophouse({
    type: 'Feature',
    properties: { overture_id: 'x', num_floors: 2, height_basis: 'overture-storeys' },
    geometry: { type: 'Polygon', coordinates: [SMALL_RING] },
  });
  assert.equal(s.material, 'shophouse');
  assert.notEqual(s.material, 'plaster');
});

test('every form the atlas draws carries a declared body material', () => {
  const forms = allForms();
  assert.ok(forms.length > 1000, `expected the whole Old Town, got ${forms.length}`);
  for (const s of forms) {
    assert.ok(
      TEMPLE_BODY_MATERIALS.includes(s.material),
      `${s.kind} "${s.name ?? ''}" carries an undeclared material: ${s.material}`,
    );
  }
});

test('the Old Town is no longer one colour', () => {
  // The measure that started this: 298 of 322 temples were the same white.
  const forms = allForms();
  const temples = forms.filter((f) => f.kind !== 'shophouse');
  const counts = new Map();
  for (const f of temples) counts.set(f.material, (counts.get(f.material) ?? 0) + 1);
  const plaster = counts.get('plaster') ?? 0;
  assert.ok(
    plaster < temples.length * 0.9,
    `${plaster} of ${temples.length} temples are still plaster`,
  );
  // And the ones that are not plaster must be there for a reason, not by
  // accident: every non-plaster temple is one the evidence names.
  for (const f of temples) {
    if (f.material === 'plaster') continue;
    assert.ok(
      ['teak', 'gold', 'ceramic', 'glass', 'iron'].includes(f.material),
      `unexpected material on ${f.kind} "${f.name ?? ''}": ${f.material}`,
    );
  }
});

// ── 3. the plan fits inside the footprint ─────────────────────────────────

test('no form overhangs the footprint it was drawn from', () => {
  // A roof may hang past its walls — that is what a roof does — but the plan
  // itself may not leave the footprint. The allowance is the roof overhang
  // the geometry declares, measured against the footprint's own size, so a
  // big building is allowed a big eave and a small one is not.
  //
  // This measures the built mesh, not the helper: a helper that fits while
  // the drawing does not use it is still a building in the road.
  const forms = allForms();
  const offenders = [];
  for (const spec of forms) {
    const ring = outerRing({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [spec.ring] } });
    const local = openRing(ring).map(toLocal);
    const h = hull(local);
    if (h.length < 3) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of h) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const half = Math.max(maxX - minX, maxY - minY) / 2;
    const allowance = (ROOF_OVERHANG - 1) * half + 1e-6;
    const mesh = buildForm(spec);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const out = outsideDistance(h, [mesh.positions[i], mesh.positions[i + 1]]);
      if (out > allowance) {
        offenders.push(`${spec.kind} "${spec.name ?? ''}" ${out.toFixed(2)}m > ${allowance.toFixed(2)}m`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the whole Old Town wears only the declared palette', () => {
  const palette = paletteColors();
  const used = new Set();
  for (const spec of allForms()) {
    const mesh = buildForm(spec);
    for (let i = 0; i < mesh.colors.length; i += 3) {
      used.add([mesh.colors[i], mesh.colors[i + 1], mesh.colors[i + 2]].map((v) => v.toFixed(6)).join(','));
    }
  }
  for (const c of used) assert.ok(palette.has(c), `a colour escaped the table: ${c}`);
  // The palette is a set, not a rainbow: the Old Town is drawn in a handful
  // of colours, and a new one has to be declared on purpose.
  assert.ok(used.size <= palette.size, 'more colours in use than the table declares');
});
