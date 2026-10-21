// The city forms: hipped roofs on low-rise footprints, rooftop plant on flat
// mid-rise roofs.
//
// These are typological readings, and the tests hold them to that. A form
// that claims to be surveyed, or that puts a roof on something the data
// cannot support, is a lie drawn in 3D.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRoof,
  DEFAULT_OPTIONS,
  orientedBox,
  resolveHeight,
  ringArea,
  toLocalMeters,
} from '../public/city-forms.js';
import {
  ACCURACY,
  buildCityGeometry,
  hipRoofTriangles,
  plantTriangles,
} from '../public/city-forms-geometry.js';

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

function vertices(geometry) {
  const out = [];
  for (let i = 0; i < geometry.positions.length; i += 3) {
    out.push([geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]]);
  }
  return out;
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

test('a long narrow row gets a roof, because that is what a row is', () => {
  // A Bangkok shophouse row is long and narrow, and it is pitched. Refusing
  // it for being long left the biggest buildings in the old town as grey
  // boxes, which is the whole problem this layer exists to fix.
  const row = withHeight(rectangle(0, 0, 72, 12), 9);
  const plan = classifyRoof(row, { origin: ORIGIN });
  assert.ok(plan, 'a 72 x 12 m row at 9 m should be pitched');
  assert.equal(plan.kind, 'hip');
});

test('a footprint the rectangle does not describe gets no roof', () => {
  // An L-shape. A rectangle fitted to it overshoots badly, and a roof drawn
  // to that rectangle would hang out over the street.
  const l = withHeight({
    type: 'Feature',
    properties: { render_height: 8, render_min_height: 0 },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [ORIGIN[0], ORIGIN[1]],
        [ORIGIN[0] + 0.0009, ORIGIN[1]],
        [ORIGIN[0] + 0.0009, ORIGIN[1] + 0.00009],
        [ORIGIN[0] + 0.00045, ORIGIN[1] + 0.00009],
        [ORIGIN[0] + 0.00045, ORIGIN[1] + 0.00018],
        [ORIGIN[0], ORIGIN[1] + 0.00018],
        [ORIGIN[0], ORIGIN[1]],
      ]],
    },
  }, 8);
  assert.equal(classifyRoof(l, { origin: ORIGIN }), null,
    'an L-shaped footprint must not be given a rectangle roof');
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
  assert.ok(Math.abs(box.area - 200) < 0.001, `box area ${box.area}`);
});

test('a hip roof is a real roof: eight triangles, a ridge, and no steps', () => {
  const row = withHeight(rectangle(0, 0, 24, 9), 7);
  const plan = classifyRoof(row, { origin: ORIGIN });
  const geometry = hipRoofTriangles(plan, DEFAULT_OPTIONS);
  // Two long slopes and two hips: eight triangles, plus the eave band.
  assert.ok(geometry.positions.length > 0, 'a roof was not built');
  assert.equal(geometry.positions.length % 9, 0, 'the geometry is not a whole number of triangles');
  assert.equal(geometry.positions.length, geometry.normals.length, 'normals do not match positions');
  assert.equal(geometry.positions.length, geometry.colors.length, 'colours do not match positions');

  const points = vertices(geometry);
  for (const [x, y, z] of points) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), 'non-finite vertex');
  }
  // The eave sits on the building's top, and the ridge is above it.
  const zs = points.map((p) => p[2]);
  assert.ok(Math.min(...zs) >= plan.height - 0.01, 'the roof sinks into the building');
  const ridge = Math.max(...zs);
  assert.ok(ridge > plan.height + 0.8, `the roof rises only ${(ridge - plan.height).toFixed(2)} m`);
  // The ridge runs along the LONG axis. The long axis of this building is
  // east-west, so the highest vertices share a north coordinate near the
  // middle of the short axis, and they are spread east-west.
  const top = points.filter((p) => p[2] > ridge - 0.01);
  const norths = top.map((p) => p[1]);
  const easts = top.map((p) => p[0]);
  assert.ok(Math.max(...norths) - Math.min(...norths) < 1.0,
    'the ridge is not a line: it spreads across the short axis');
  assert.ok(Math.max(...easts) - Math.min(...easts) > 5,
    'the ridge does not run the length of the building');
  // And it is centred on the footprint.
  const centre = plan.box.centre;
  assert.ok(Math.abs((Math.max(...norths) + Math.min(...norths)) / 2 - centre[1]) < 0.01,
    'the ridge is not centred on the building');
});

test('the roof stays on the building it belongs to', () => {
  const row = withHeight(rectangle(0, 0, 24, 9), 7);
  const plan = classifyRoof(row, { origin: ORIGIN });
  const geometry = hipRoofTriangles(plan, DEFAULT_OPTIONS);
  const local = toLocalMeters(row.geometry.coordinates[0], ORIGIN);
  const minX = Math.min(...local.map((p) => p[0]));
  const maxX = Math.max(...local.map((p) => p[0]));
  const minY = Math.min(...local.map((p) => p[1]));
  const maxY = Math.max(...local.map((p) => p[1]));
  const eave = DEFAULT_OPTIONS.eave + 0.01;
  for (const [x, y] of vertices(geometry)) {
    assert.ok(x >= minX - eave && x <= maxX + eave, 'a roof vertex hangs off the building in x');
    assert.ok(y >= minY - eave && y <= maxY + eave, 'a roof vertex hangs off the building in y');
  }
});

test('rooftop plant stands on the roof and stays inside the footprint', () => {
  const mid = withHeight(rectangle(0, 0, 26, 20), 22);
  const plan = classifyRoof(mid, { origin: ORIGIN });
  const geometry = plantTriangles(plan, DEFAULT_OPTIONS);
  assert.ok(geometry.positions.length > 0, 'a flat mid-rise roof carries nothing');
  const local = toLocalMeters(mid.geometry.coordinates[0], ORIGIN);
  const minX = Math.min(...local.map((p) => p[0]));
  const maxX = Math.max(...local.map((p) => p[0]));
  const minY = Math.min(...local.map((p) => p[1]));
  const maxY = Math.max(...local.map((p) => p[1]));
  const zs = vertices(geometry).map((p) => p[2]);
  assert.ok(Math.min(...zs) >= plan.height - 0.01, 'the plant sinks into the roof');
  assert.ok(Math.max(...zs) > plan.height + 0.5, 'the plant has no height');
  for (const [x, y] of vertices(geometry)) {
    assert.ok(x >= minX - 0.01 && x <= maxX + 0.01, 'plant outside the footprint in x');
    assert.ok(y >= minY - 0.01 && y <= maxY + 0.01, 'plant outside the footprint in y');
  }
  // The water tanks are the thing that makes a Bangkok roof recognisable, and
  // they are the dark ones.
  const colours = new Set();
  for (let i = 0; i < geometry.colors.length; i += 3) {
    colours.add([geometry.colors[i], geometry.colors[i + 1], geometry.colors[i + 2]].join(','));
  }
  assert.ok(colours.size >= 2, 'the plant is all one colour');
});

test('the forms say what they are and claim nothing', () => {
  for (const [kind, note] of Object.entries(ACCURACY)) {
    assert.ok(note.length > 20, `${kind}: a form with no accuracy note`);
    assert.match(note, /unsurveyed/i, `${kind}: a form that does not say it is unsurveyed`);
    assert.match(note, /not for flood calculations/i, `${kind}: a form that does not refuse flood use`);
  }
});

test('the whole city is one merged set of triangles', () => {
  const features = [
    withHeight(rectangle(0, 0, 9, 7), 7),
    withHeight(rectangle(40, 0, 26, 20), 22),
  ];
  const plans = features
    .map((feature) => classifyRoof(feature, { origin: ORIGIN }))
    .filter(Boolean);
  assert.equal(plans.length, 2);
  const geometry = buildCityGeometry(plans, DEFAULT_OPTIONS);
  assert.ok(geometry.positions.length > 0, 'the city has no geometry');
  assert.equal(geometry.positions.length % 9, 0, 'the geometry is not a whole number of triangles');
  assert.equal(geometry.positions.length, geometry.normals.length);
  assert.equal(geometry.positions.length, geometry.colors.length);
  // Both roofs are in there, at their own heights.
  const zs = vertices(geometry).map((p) => p[2]);
  assert.ok(Math.min(...zs) < 8 && Math.max(...zs) > 22,
    'the city is not holding both a 7 m house and a 22 m block');
});

test('the budget is a budget', () => {
  const features = [];
  for (let i = 0; i < 40; i++) features.push(withHeight(rectangle(i * 30, 0, 9, 7), 7));
  const plans = features
    .map((feature) => classifyRoof(feature, { origin: ORIGIN }))
    .filter(Boolean);
  const kept = plans.slice(0, 10);
  assert.equal(kept.length, 10);
  assert.equal(plans.length - kept.length, 30);
});
