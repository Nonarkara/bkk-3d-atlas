// Thai heritage forms: classification honesty and geometry sanity.
//
// The forms are a typological reading, not a measurement. These tests protect
// that contract: a form must come from real data, a name must beat a guess, and
// an ambiguous footprint must be left alone rather than invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { classify, classifyShophouse, buildForm, ORIGIN } from '../public/heritage-forms.js';
import { classifyAll, evictOffScreenChunks, MAX_RESIDENT_CHUNKS, CHUNK_GRACE_PUMPS } from '../public/heritage-forms-layer.js';

const detail = JSON.parse(
  readFileSync(new URL('../public/bkk-heritage-detail.geojson', import.meta.url), 'utf8'),
);

function feature(props, ring) {
  return {
    type: 'Feature',
    properties: { id: 'bkk-building-1', ...props },
    geometry: { type: 'Polygon', coordinates: [ring ?? [[100.5, 13.75], [100.501, 13.75], [100.501, 13.751], [100.5, 13.751], [100.5, 13.75]]] },
  };
}

test('a Thai name identifies the type; the footprint only guesses', () => {
  assert.equal(classify(feature({ name: 'พระศรีรัตนเจดีย์', building: 'temple', height: 20 })).kind, 'chedi');
  assert.equal(classify(feature({ name: 'ปราสาทพระเทพบิดร', building: 'temple', height: 20 })).kind, 'prasat');
  assert.equal(classify(feature({ name: 'หอมณเฑียรธรรม', building: 'temple', height: 20 })).kind, 'mondop');
  assert.equal(classify(feature({ name: 'พระวิหารยอด', building: 'temple', height: 20 })).kind, 'hall');
});

test('attama prangs and gold chedis keep their material', () => {
  assert.equal(classify(feature({ name: 'พระสัมมาสัมพุทธมหาเจดีย์', height: 60 })).material, 'ceramic');
  assert.equal(classify(feature({ name: 'พระศรีรัตนเจดีย์', height: 60 })).material, 'gold');
});

test('a European-style throne hall is refused, not guessed', () => {
  // The Ananta Samakhom Throne Hall is a European-style building. With no style
  // record the classifier must leave it as a plain extrusion.
  const s = classify(feature({ name: 'พระที่นั่งอินทรา สมเด็จพระบรมราชานุภาพ', building: 'temple', height: 30 }));
  assert.equal(s, null);
});

test('confidence separates a named type from a shape inference', () => {
  const named = classify(feature({ name: 'พระวิหารยอด', building: 'temple', height: 20 }));
  assert.equal(named.confidence, 'named');
  // A long, large, unnamed temple-compound building reads as a hall. The ring
  // is a real one from the dataset, because the inference is shape-based.
  const real = detail.features.find(
    (f) => { const s = classify(f); return s && s.confidence === 'inferred' && s.kind === 'hall'; },
  );
  const inferred = classify(real);
  assert.equal(inferred.confidence, 'inferred');
  assert.equal(inferred.name, null);
});

test('a non-temple building is never dressed as a Thai form', () => {
  assert.equal(classify(feature({ building: 'commercial', height: 30 })), null);
  assert.equal(classify(feature({ name: 'ตึกออฟฟิศ', building: 'office', height: 60 })), null);
});

test('too flat to be a temple is refused', () => {
  assert.equal(classify(feature({ name: 'พระวิหาร', building: 'temple', height: 1, base_height: 0 })), null);
});

test('a real palace chedi classifies and builds finite geometry', () => {
  const found = detail.features
    .map(classify)
    .filter(Boolean)
    .find((f) => f.kind === 'chedi' && f.confidence === 'named');
  assert.ok(found, 'expected a named chedi in the heritage detail file');
  const mesh = buildForm(found);
  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.positions.length, mesh.colors.length);
  assert.ok(mesh.positions.every(Number.isFinite), 'mesh has non-finite coordinates');
  assert.ok(mesh.positions.every((v) => v >= -5000 && v <= 5000), 'mesh vertex is implausibly far from the origin');
});

test('every form the real dataset produces is buildable and finite', () => {
  const forms = classifyAll(detail.features);
  assert.ok(forms.length > 100, `expected a meaningful set of forms, got ${forms.length}`);
  for (const f of forms) {
    const mesh = buildForm(f);
    assert.ok(mesh.positions.length > 0, `${f.kind} ${f.id} produced an empty mesh`);
    assert.ok(mesh.positions.every(Number.isFinite), `${f.kind} ${f.id} produced a non-finite vertex`);
    assert.equal(mesh.positions.length, mesh.colors.length);
  }
});

test('classification stays inside the Old Town envelope', () => {
  for (const f of classifyAll(detail.features)) {
    for (const [lng, lat] of f.ring) {
      assert.ok(Number.isFinite(lng) && Number.isFinite(lat));
      assert.ok(Math.abs(lng - ORIGIN.lng) < 0.05, `form ${f.id} sits ${lng} away from the origin`);
      assert.ok(Math.abs(lat - ORIGIN.lat) < 0.05, `form ${f.id} sits ${lat} away from the origin`);
    }
  }
});

test('one malformed footprint does not lose the rest', () => {
  const broken = [
    feature({ name: 'พระวิหาร', building: 'temple', height: 20 }),
    { type: 'Feature', properties: { id: 'x', name: 'พระวิหาร', building: 'temple', height: 20 }, geometry: null },
    { type: 'Feature', properties: { id: 'y' }, geometry: { type: 'Polygon', coordinates: [[]] } },
    feature({ name: 'พระอุโบสถ', building: 'temple', height: 20 }),
  ];
  assert.equal(classifyAll(broken).length, 2);
});
// ── Shophouse row candidates ───────────────────────────────────────────────
const shopFile = new URL('../public/bkk-shophouse-candidates.geojson', import.meta.url);
const shopData = JSON.parse(readFileSync(shopFile, 'utf8'));

function shopFeature(overrides) {
  return {
    type: 'Feature',
    properties: {
      overture_id: 'test-1', name: 'Tanao Road rows', cluster_name: 'Tanao Road rows',
      num_floors: 3, height_basis: 'overture-storeys', height_m: null,
      candidate_strength: 'strong morphology', review_status: 'unverified candidate',
      not_heritage_designation: true, detail_box_id: 'bkk-building-123', ...overrides,
    },
    geometry: { type: 'Polygon', coordinates: [[[100.5, 13.75], [100.50005, 13.75], [100.50005, 13.75005], [100.5, 13.75005], [100.5, 13.75]]] },
  };
}

test('a candidate with a real storey count becomes a shophouse', () => {
  const s = classifyShophouse(shopFeature({}));
  assert.equal(s.kind, 'shophouse');
  assert.equal(s.shophouse.floors, 3);
  assert.equal(s.height, 3 * 3.15);
  assert.ok(s.heightSource.includes('assumed storey'));
});

test('a candidate with no recorded storey height is refused, never zeroed', () => {
  // These were screened on a modal storey height that was never written down.
  // Rendering them would put an invented number on a real building.
  assert.equal(classifyShophouse(shopFeature({ num_floors: null })), null);
  assert.equal(classifyShophouse(shopFeature({ height_basis: 'modal-storeys', num_floors: null })), null);
  assert.equal(classifyShophouse(shopFeature({ height_basis: 'modal-storeys', num_floors: 2 })), null);
});

test('a shophouse is never dressed as confirmed heritage', () => {
  const s = classifyShophouse(shopFeature({}));
  assert.equal(s.confidence, 'inferred');
  assert.equal(s.shophouse.notHeritage, true);
  assert.equal(s.shophouse.review, 'unverified candidate');
});

test('absurd storey counts are refused rather than drawn', () => {
  assert.equal(classifyShophouse(shopFeature({ num_floors: 0 })), null);
  assert.equal(classifyShophouse(shopFeature({ num_floors: 40 })), null);
  assert.equal(classifyShophouse(shopFeature({ num_floors: Number.NaN })), null);
});

test('the real candidate file renders only where a storey count exists', () => {
  const all = shopData.features.length;
  const forms = shopData.features.map(classifyShophouse).filter(Boolean);
  const withFloors = shopData.features.filter((f) => f.properties.height_basis === 'overture-storeys').length;
  assert.ok(forms.length > 500, `expected a real row of shophouses, got ${forms.length}`);
  assert.ok(forms.length <= withFloors, 'a form must never exist without a recorded storey count');
  assert.ok(forms.length < all, 'candidates without a storey count must be skipped, not all-or-nothing');
  for (const f of forms) {
    assert.equal(f.kind, 'shophouse');
    assert.ok(f.height > 0, 'height must never be zero');
    assert.equal(f.shophouse.floors, Math.round(f.height / 3.15));
  }
});

test('every shophouse builds finite geometry', () => {
  for (const f of shopData.features.map(classifyShophouse).filter(Boolean)) {
    const m = buildForm(f);
    assert.ok(m.positions.length > 0, `${f.id} produced an empty shophouse`);
    assert.ok(m.positions.every(Number.isFinite), `${f.id} produced a non-finite vertex`);
  }
});

test('a shophouse does not borrow temple vocabulary', () => {
  const s = classifyShophouse(shopFeature({}));
  const shop = buildForm(s);
  const hall = buildForm(classify(feature({ name: 'พระวิหารยอด', building: 'temple', height: 9.45 })));
  const keys = (m) => new Set(Array.from({ length: m.colors.length / 3 }, (_, i) => m.colors.slice(i * 3, i * 3 + 3).join(',')));
  const shared = [...keys(shop)].filter((c) => keys(hall).has(c));
  // Plinth is the only colour the two may share; gold pediments must not appear.
  assert.ok(shared.length <= 1, `shophouse reused temple colours: ${shared.join(' | ')}`);
});

// ── Chunking: the perf guard ────────────────────────────────────────────────
// A single merged mesh for every form cost 84 ms on the first zoom-in and drew
// 93k triangles per frame with nothing culled. Chunking is what stops that
// coming back, so the budget is asserted, not assumed.
import { groupIntoChunks, visibleCells, chunkKeyFor, pendingCells } from '../public/heritage-forms-layer.js';

const ALL_FORMS = [
  ...detail.features.map(classify),
  ...shopData.features.map(classifyShophouse),
].filter(Boolean);

test('chunking keeps every form and splits the dense Old Town', () => {
  const cells = groupIntoChunks(ALL_FORMS);
  const total = [...cells.values()].reduce((n, arr) => n + arr.length, 0);
  assert.equal(total, ALL_FORMS.length, 'chunking lost or duplicated a form');
  assert.ok(cells.size > 8, `expected several chunks, got ${cells.size}`);
  const worst = Math.max(...[...cells.values()].map((a) => a.length));
  assert.ok(worst < ALL_FORMS.length / 4, `one chunk holds ${worst} of ${ALL_FORMS.length}`);
});

test('a chunk is structurally small enough to build in a frame', () => {
  // Asserting wall-clock here is a coin flip: this suite is also spawned as a
  // subprocess while a machine is busy, and it failed 3 times in 9 runs while
  // the code was unchanged. The bound that actually guarantees the cost is
  // structural — forms per chunk — so assert that, and report the timing.
  const MAX_FORMS_PER_CHUNK = 160;
  let worstMs = 0;
  let worstCount = 0;
  for (const [, forms] of groupIntoChunks(ALL_FORMS)) {
    assert.ok(forms.length <= MAX_FORMS_PER_CHUNK, `chunk holds ${forms.length} forms`);
    const t0 = performance.now();
    for (const f of forms) buildForm(f);
    const ms = performance.now() - t0;
    if (forms.length > worstCount) { worstCount = forms.length; worstMs = ms; }
  }
  // Informational only — never an assertion.
  const cells = groupIntoChunks(ALL_FORMS);
  console.log(`    ${cells.size} chunks; largest ${worstCount} forms built in ${worstMs.toFixed(1)} ms`);
  assert.ok(cells.size >= 30, `expected the form set to stay split, got ${cells.size} chunks`);
});

test('the viewport selects chunks and always includes the origin cell', () => {
  const fakeBounds = {
    getWest: () => 100.49, getEast: () => 100.51,
    getSouth: () => 13.74, getNorth: () => 13.76,
  };
  const cells = visibleCells(fakeBounds);
  assert.ok(cells.has(chunkKeyFor(100.5, 13.75)), 'the camera cell must be built');
  assert.ok(cells.size >= 9, `viewport should span several cells, got ${cells.size}`);
  assert.ok(!cells.has(chunkKeyFor(101.4, 13.75)), 'distant cells must not be built');
});

// ── The toggle cycle that shipped broken ────────────────────────────────────
// uninstall clears the chunk map but the forms stay cached. Gating the rebuild
// on "forms are absent" therefore produced a layer holding 319 buildings and
// zero chunks, which draws nothing and looks completely healthy in every other
// check. Nothing caught it because nothing ran install → uninstall → install.
import { ensureChunkStore } from '../public/heritage-forms-layer.js';

test('a layer reinstalled after uninstall still has chunks to build', () => {
  const cells = ensureChunkStore(ALL_FORMS, null);
  assert.ok(cells.size > 8, 'a fresh store must be populated');
  // uninstall clears the store; the forms are still cached, exactly as in the
  // runtime. This is the state that silently rendered nothing.
  const cleared = new Map(cells);
  cleared.clear();
  const afterToggle = ensureChunkStore(ALL_FORMS, cleared);
  assert.ok(afterToggle.size > 8, 'reinstall must rebuild the store, not inherit the cleared one');
  const total = [...afterToggle.values()].reduce((n, arr) => n + arr.length, 0);
  assert.equal(total, ALL_FORMS.length, 'the rebuilt store must still hold every form');
});

test('an intact store is reused rather than rebuilt', () => {
  const cells = ensureChunkStore(ALL_FORMS, null);
  assert.equal(ensureChunkStore(ALL_FORMS, cells), cells, 'a populated store should be kept as-is');
});

// The pump reached for `cell.forms` on a value that is a plain array of forms.
// `for (const f of undefined)` threw inside requestAnimationFrame, where
// nothing catches, so the pump reported zero builds and no error. Both halves
// of that contract are pinned here.
test('a chunk cell is the array of forms, and the pump reads it as such', () => {
  const store = groupIntoChunks(ALL_FORMS);
  for (const [key, cell] of store) {
    assert.ok(Array.isArray(cell), `chunk ${key} is not an array — the pump would read undefined`);
    assert.ok(cell.every((f) => f && typeof f === 'object' && Array.isArray(f.ring)), `chunk ${key} holds a non-form`);
  }
});

test('pendingCells finds exactly the visible cells with no mesh yet', () => {
  const store = groupIntoChunks(ALL_FORMS);
  const built = new Map();
  const all = new Set(store.keys());
  const { keys, unknown } = pendingCells(store, built, all);
  assert.equal(unknown, 0, 'every requested cell should exist in the store');
  assert.equal(keys.length, all.size, 'with nothing built, every visible cell is pending');

  // Build two, the way the pump does.
  for (const k of keys.slice(0, 2)) built.set(k, { mesh: {}, geo: {} });
  const second = pendingCells(store, built, all);
  assert.equal(second.keys.length, all.size - 2, 'two built cells must drop out of the pending list');
  assert.ok(!second.keys.includes(keys[0]), 'an already-built cell must not be rebuilt');
});

test('a cell that is not in the store is reported, not silently ignored', () => {
  const store = groupIntoChunks(ALL_FORMS);
  const { unknown } = pendingCells(store, new Map(), new Set(['nope:nope']));
  assert.equal(unknown, 1, 'a requested cell with no forms must be visible to the caller');
});

// ── resident-chunk eviction ─────────────────────────────────────────────────
// The layer disposed nothing at all before this. Measured on the live atlas:
// `built` sat at 22 through a pan 12 km east and a zoom out to z12, because the
// old guard compared built chunks against *every visible cell*, most of which
// hold no data. 22 > 42*2 is false; 22 > 1210*2 is false. The condition could
// never be met anywhere the layer is actually used.

test('eviction releases off-screen chunks once the resident set is over budget', () => {
  const built = new Map();
  const disposed = [];
  const scene = { remove: (m) => disposed.push(m) };
  for (let i = 0; i < 30; i++) built.set(`k${i}`, { mesh: `m${i}`, geo: { dispose() {} }, usedTick: i });

  const need = new Set(['k29']);
  const res = evictOffScreenChunks(built, need, 100, scene, 24);

  assert.equal(res.evicted, 6, 'thirty built against a budget of 24 should release six');
  assert.equal(built.size, 24, 'the resident set lands on the budget, not below it');
  assert.equal(res.resident, 24);
  assert.ok(built.has('k29'), 'the one chunk still on screen is never evicted');
  assert.equal(disposed.length, 6, 'every evicted mesh leaves the scene');
});

test('eviction disposes the geometry of what it releases', () => {
  const built = new Map();
  let disposeCount = 0;
  const scene = { remove() {} };
  for (let i = 0; i < 26; i++) built.set(`k${i}`, { mesh: {}, geo: { dispose: () => { disposeCount++; } }, usedTick: i });
  evictOffScreenChunks(built, new Set(), 99, scene, 24);
  assert.equal(disposeCount, 2, 'a released chunk must free its GPU buffers, not orphan them');
});

test('a chunk inside its grace period survives, so boundary jitter cannot thrash', () => {
  const built = new Map();
  const scene = { remove() {} };
  // All over budget, but every one was used within the grace window.
  for (let i = 0; i < 40; i++) built.set(`k${i}`, { mesh: {}, geo: { dispose() {} }, usedTick: 100 });
  const res = evictOffScreenChunks(built, new Set(), 100, scene, 24);
  assert.equal(res.evicted, 0, 'nothing used this very pump may be released');
  assert.equal(built.size, 40);

  // Push the clock past the grace window and the same call releases them.
  const later = evictOffScreenChunks(built, new Set(), 100 + CHUNK_GRACE_PUMPS + 1, scene, 24);
  assert.ok(later.evicted > 0, 'once the grace window lapses the eviction runs');
  assert.equal(built.size, 24);
});

test('under budget nothing is touched at all', () => {
  const built = new Map();
  const scene = { remove: () => { throw new Error('scene.remove must not be called under budget'); } };
  // Exactly at the budget, not over it. One more chunk and eviction starts.
  for (let i = 0; i < MAX_RESIDENT_CHUNKS; i++) built.set(`k${i}`, { mesh: {}, geo: { dispose() {} }, usedTick: 0 });
  const res = evictOffScreenChunks(built, new Set(), 1000, scene);
  assert.equal(res.evicted, 0);
  assert.equal(built.size, MAX_RESIDENT_CHUNKS);
});

test('eviction is oldest-use-first, so the coldest chunks go', () => {
  const built = new Map();
  const scene = { remove() {} };
  // k0..k19 were used long ago, k20..k29 were used just now but are off screen.
  for (let i = 0; i < 20; i++) built.set(`k${i}`, { mesh: {}, geo: { dispose() {} }, usedTick: 1 });
  for (let i = 20; i < 30; i++) built.set(`k${i}`, { mesh: {}, geo: { dispose() {} }, usedTick: 90 });
  evictOffScreenChunks(built, new Set(), 1000, scene, 24);
  for (let i = 0; i < 6; i++) assert.ok(!built.has(`k${i}`), `the coldest chunk k${i} should be released`);
  for (let i = 20; i < 30; i++) assert.ok(built.has(`k${i}`), 'recently used chunks survive');
});

test('eviction does not depend on how many cells happen to be in view', () => {
  // This is the test the bug actually needed. `need` is every visible cell,
  // most of which hold no forms, so it is large — 42 zoomed in over the Old
  // Town, 1210 zoomed out to z12. An eviction policy keyed off `need.size`
  // reads "plenty of cells in view" as "no reason to release anything", which
  // is exactly backwards, and is why nothing was ever disposed.
  for (const cellsInView of [42, 220, 1210]) {
    const built = new Map();
    const scene = { remove() {} };
    for (let i = 0; i < 30; i++) built.set(`k${i}`, { mesh: {}, geo: { dispose() {} }, usedTick: i });
    const need = new Set();
    for (let i = 0; i < cellsInView; i++) need.add(`empty${i}`); // none hold data
    const res = evictOffScreenChunks(built, need, 100, scene, 24);
    assert.ok(res.evicted > 0,
      `with ${cellsInView} cells in view and 30 built, the budget must still bite — it released nothing`);
    assert.equal(built.size, 24, `the resident set lands on the budget at ${cellsInView} cells in view`);
  }
});

test('the old guard could never have fired — this is the regression, stated', () => {
  // Reconstructed from the measurement: 22 chunks built, against the counts of
  // visible cells seen at each stop on a real camera walk.
  const builtSize = 22;
  for (const cellsInView of [42, 220, 1210]) {
    assert.ok(!(builtSize > cellsInView * 2),
      `the old guard built.size > need.size*2 is false at ${cellsInView} visible cells`);
  }
  // The old guard compared two unrelated quantities, so it needed an absurd
  // number of empty cells to trip. The replacement asks the question the
  // memory is actually spent in, and answers it the same way at every zoom.
  assert.ok(builtSize <= MAX_RESIDENT_CHUNKS, 'a 22-chunk view sits under the budget and is kept');
  assert.ok(48 > MAX_RESIDENT_CHUNKS, 'the whole 48-chunk dataset does trip the budget');
  assert.ok(24 <= MAX_RESIDENT_CHUNKS && 24 > 20, 'and the budget sits below half the dataset');
});
