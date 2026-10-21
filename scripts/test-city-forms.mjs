// The city forms: hipped roofs on low-rise footprints, rooftop plant on flat
// mid-rise roofs.
//
// These are typological readings, and the tests hold them to that. A form
// that claims to be surveyed, or that puts a roof on something the data
// cannot support, is a lie drawn in 3D.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCityForms,
  buildHipRoof,
  buildRooftopPlant,
  classifyRoof,
  DEFAULT_OPTIONS,
  orientedBox,
  resolveHeight,
  ringArea,
  toLocalMeters,
} from '../public/city-forms.js';

const ORIGIN = [100.5, 13.75];

// A rectangle in lng/lat, sized in metres.
function rectangle(eastM, northM, widthM, depthM) {
  const m = { east: 111319.49 * Math.cos(ORIGIN[1] * Math.PI / 180), north: 110574 };
  const e = eastM / m.east;
  const n = northM / m.north;
  const w = widthM / m.east;
  const d = depthM / m.north;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [ORIGIN[0] + e, ORIGIN[1] + n],
        [ORIGIN[0] + e + w, ORIGIN[1] + n],
        [ORIGIN[0] + e + w, ORIGIN[1] + n + d],
        [ORIGIN[0] + e, ORIGIN[1] + n + d],
        [ORIGIN[0] + e, ORIGIN[1] + n],
      ]],
    },
  };
}

function withHeight(feature, height, minHeight = 0) {
  return {
    ...feature,
    properties: { render_height: height, render_min_height: minHeight },
  };
}

test('height resolution matches the atlas extrusion expression', () => {
  // The atlas extrudes with HEIGHT_GET: a tagged render_height in 1..500 wins,
  // otherwise levels x 3.15, otherwise the typology table, otherwise 8.5 m.
  assert.equal(resolveHeight({ render_height: 24 }).height, 24);
  assert.equal(resolveHeight({ render_height: 0 }).height, 8.5);
  assert.equal(resolveHeight({}).height, 8.5);
  assert.equal(resolveHeight({ render_height: 900 }).height, 8.5);
  assert.equal(resolveHeight({ 'building:levels': 10 }).height, 31.5);
  assert.equal(resolveHeight({ building: 'office' }).height, 25);
  assert.equal(resolveHeight({ building: 'house' }).height, 8.5);
  // The old town lifts an untagged shophouse from 8.5 m to 12 m.
  assert.equal(resolveHeight({ building: 'commercial' }, 'oldtown').height, 12);
  assert.equal(resolveHeight({ building: 'commercial' }).height, 14);
  // A base at or above the top is degenerate in the metro rule, and the
  // extrusion collapses. A roof must not be put on such a building.
  const collapsed = resolveHeight({ render_height: 10, render_min_height: 12 });
  assert.equal(collapsed.degenerate, true);
  assert.equal(resolveHeight({ render_height: 10, render_min_height: 4 }).degenerate, false);
  assert.equal(resolveHeight({ render_height: 10, render_min_height: 4 }).base, 4);
});

test('a low narrow footprint gets a hip; a wide low one does not', () => {
  const house = withHeight(rectangle(0, 0, 9, 7), 7);
  const plan = classifyRoof(house, { origin: ORIGIN });
  assert.ok(plan, 'a 9 x 7 m house at 7 m should be pitched');
  assert.equal(plan.kind, 'hip');

  // A warehouse: low, but 60 m across.
  const shed = withHeight(rectangle(0, 0, 60, 25), 6);
  assert.equal(classifyRoof(shed, { origin: ORIGIN }), null,
    'a 60 m wide low building is a shed, not a house with a hipped roof');

  // A tower: tall, so it gets plant rather than a roof.
  const tower = withHeight(rectangle(0, 0, 20, 20), 180);
  assert.equal(classifyRoof(tower, { origin: ORIGIN }), null,
    'a 180 m tower is above the plant band and is not a low-rise roof');
});

test('a mid-rise flat roof gets plant, a low one does not', () => {
  const mid = withHeight(rectangle(0, 0, 26, 20), 22);
  const plan = classifyRoof(mid, { origin: ORIGIN });
  assert.ok(plan, 'a 26 x 20 m block at 22 m should get rooftop plant');
  assert.equal(plan.kind, 'plant');

  const low = withHeight(rectangle(0, 0, 26, 20), 9);
  assert.notEqual(classifyRoof(low, { origin: ORIGIN })?.kind, 'plant',
    'a low wide block is not a flat mid-rise');
});

test('the classifier refuses what it cannot support', () => {
  assert.equal(classifyRoof({ type: 'Feature', properties: {}, geometry: null }, { origin: ORIGIN }), null);
  assert.equal(classifyRoof(null, { origin: ORIGIN }), null);
  const sliver = withHeight(rectangle(0, 0, 1, 1), 6);
  assert.equal(classifyRoof(sliver, { origin: ORIGIN }), null, 'a 1 m2 speck is not a building');
});

test('the oriented box is fitted to the footprint, not assumed axis aligned', () => {
  const ring = [[0, 0], [20, 0], [20, 10], [0, 10]];
  const box = orientedBox(ring);
  assert.ok(box);
  assert.ok(Math.abs(box.long - 20) < 0.001, `long axis ${box.long}`);
  assert.ok(Math.abs(box.short - 10) < 0.001, `short axis ${box.short}`);
});

test('a hip roof is a closed, finite set of prisms above the building', () => {
  const house = withHeight(rectangle(0, 0, 9, 7), 7);
  const plan = classifyRoof(house, { origin: ORIGIN });
  const pieces = buildHipRoof(plan, DEFAULT_OPTIONS);
  assert.ok(pieces.length > 0, 'a roof was not built');
  for (const piece of pieces) {
    assert.ok(Number.isFinite(piece.rise), 'non-finite rise');
    assert.ok(piece.rise > 0, 'a roof piece with no height above the building');
    for (const [x, y] of piece.ring) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y), 'non-finite roof vertex');
    }
  }
  // The roof must actually rise above the flat lid it covers. A rise is
  // measured from the building's top, so the tallest piece has to clear
  // the eave by a visible margin.
  const highest = Math.max(...pieces.map((p) => p.rise));
  assert.ok(highest > 1.5, `the roof rises only ${highest.toFixed(2)} m above the extrusion`);
});

test('rooftop plant stands on the roof and stays inside the footprint', () => {
  const mid = withHeight(rectangle(0, 0, 26, 20), 22);
  const plan = classifyRoof(mid, { origin: ORIGIN });
  const pieces = buildRooftopPlant(plan, DEFAULT_OPTIONS);
  assert.ok(pieces.length >= 2, 'a flat mid-rise roof carries more than one object');
  const local = toLocalMeters(
    rectangle(0, 0, 26, 20).geometry.coordinates[0],
    ORIGIN,
  );
  const minX = Math.min(...local.map((p) => p[0]));
  const maxX = Math.max(...local.map((p) => p[0]));
  const minY = Math.min(...local.map((p) => p[1]));
  const maxY = Math.max(...local.map((p) => p[1]));
  for (const piece of pieces) {
    assert.ok(piece.rise > 0, 'plant with no height');
    for (const [x, y] of piece.ring) {
      assert.ok(x >= minX - 0.01 && x <= maxX + 0.01, 'plant outside the footprint in x');
      assert.ok(y >= minY - 0.01 && y <= maxY + 0.01, 'plant outside the footprint in y');
    }
  }
  const kinds = new Set(pieces.map((p) => p.kind));
  assert.ok(kinds.has('tank'), 'a Bangkok flat roof without a water tank is not a Bangkok flat roof');
});

test('the built collection says what it is and claims nothing', () => {
  const features = [
    withHeight(rectangle(0, 0, 9, 7), 7),
    withHeight(rectangle(40, 0, 26, 20), 22),
  ];
  const { collection, stats } = buildCityForms(
    features.map((feature) => ({ feature, family: 'metro' })),
    { origin: ORIGIN },
  );
  assert.equal(collection.type, 'FeatureCollection');
  assert.equal(stats.treated, 2);
  assert.equal(stats.kinds.hip, 1);
  assert.equal(stats.kinds.plant, 1);
  assert.ok(collection.features.length > 2);
  for (const feature of collection.features) {
    const p = feature.properties;
    assert.ok(p.accuracy && p.accuracy.length > 20, 'a form with no accuracy note');
    assert.match(p.accuracy, /unsurveyed/i, 'a form that does not say it is unsurveyed');
    assert.match(p.accuracy, /not for flood calculations/i, 'a form that does not refuse flood use');
    // A rise, not an absolute height. The layer adds it to the height
    // MapLibre computes for the wall underneath.
    assert.ok(Number.isFinite(p.rise) && p.rise > 0, 'a form with no rise');
    assert.ok(!('top' in p) && !('base' in p), 'a form carrying an absolute height');
    // The height properties have to travel with the piece, or the layer
    // cannot ask MapLibre for the building's height.
    assert.ok('render_height' in p, 'a form that lost the building height');
    assert.equal(p.family, 'metro');
    const ring = feature.geometry.coordinates[0];
    assert.ok(ring.length >= 4, 'a polygon with fewer than four corners');
    assert.deepEqual(ring[0], ring[ring.length - 1], 'a polygon that is not closed');
  }
});

test('the budget is a budget', () => {
  const features = [];
  for (let i = 0; i < 40; i++) features.push(withHeight(rectangle(i * 30, 0, 9, 7), 7));
  const { stats } = buildCityForms(
    features.map((feature) => ({ feature, family: 'metro' })),
    { origin: ORIGIN, budget: 10 },
  );
  assert.equal(stats.treated, 10);
  assert.equal(stats.skipped, 30);
});

test('a form is never built without an origin to measure from', () => {
  assert.throws(() => buildCityForms([{ feature: rectangle(0, 0, 9, 7) }], {}), /origin/);
});
