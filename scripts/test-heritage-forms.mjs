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
import { classifyAll } from '../public/heritage-forms-layer.js';

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

test('attama prangs and gold chedis keep their finish', () => {
  assert.equal(classify(feature({ name: 'พระสัมมาสัมพุทธมหาเจดีย์', height: 60 })).finish, 'ceramic');
  assert.equal(classify(feature({ name: 'พระศรีรัตนเจดีย์', height: 60 })).finish, 'gold');
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
