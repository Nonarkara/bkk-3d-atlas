// The facade vocabulary and the mesh it produces.
//
// The mesh is the point: a profile that says "recessed ground storey" has to
// come out of the builder as geometry that is actually recessed, and the
// band filter has to pick out exactly the band and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACADE,
  FACADE_BAND_FILTER,
  FACADE_MAX_METERS,
  FACADE_MIN_METERS,
  facadeDetail,
  facadeProfile,
  isFacadeCandidate,
  offsetRing,
  storeyLines,
} from '../public/building-facades.js';
import { buildFacadeGroup } from '../public/building-massing.js';
import { HEIGHT_GET, heightFor } from '../public/building-heights.js';

const ring = [[0, 0], [20, 0], [20, 12], [0, 12]];

test('the detail level is a function of the zoom', () => {
  assert.equal(facadeDetail(15.9), 'base');
  assert.equal(facadeDetail(16), 'base');
  assert.equal(facadeDetail(17.4), 'base');
  assert.equal(facadeDetail(17.5), 'courses');
  assert.equal(facadeDetail(18.4), 'courses');
  assert.equal(facadeDetail(18.5), 'full');
});

test('the band is 13 m to 70 m, and nothing else', () => {
  assert.equal(isFacadeCandidate({ render_height: 12.9 }), false);
  assert.equal(isFacadeCandidate({ render_height: 13 }), true);
  assert.equal(isFacadeCandidate({ render_height: 21 }), true);
  assert.equal(isFacadeCandidate({ render_height: 70 }), true);
  assert.equal(isFacadeCandidate({ render_height: 70.1 }), false);
  assert.equal(isFacadeCandidate({ render_height: 120 }), false);
  assert.equal(isFacadeCandidate(null), false);
  // A building whose base is at its height is degenerate: the map collapses
  // its extrusion, so the atlas must not draw a facade for it either.
  assert.equal(isFacadeCandidate({ render_height: 20, render_min_height: 20 }), false);
});

test('the storey count comes from the height, not from a guess', () => {
  // 18.9 m tall: a 4.2 m ground storey and 3.15 m storeys above it.
  const lines = storeyLines(0, 18.9);
  assert.deepEqual(lines, [4.2, 7.35, 10.5, 13.65, 16.8]);
  assert.ok(lines.every((y) => y >= FACADE.groundHeight));
});

test('the profile is continuous: no gap in the wall', () => {
  for (const height of [13, 18.9, 21, 45, 70]) {
    const { profile } = facadeProfile(0, height, 'full');
    for (let i = 1; i < profile.length; i++) {
      const [offsetA, yA] = profile[i - 1];
      const [offsetB, yB] = profile[i];
      // Each step is either a wall (same offset) or a ledge (same height).
      // Never both at once, and never a hole.
      assert.ok(
        offsetA === offsetB || yA === yB,
        `step ${i} of a ${height} m building is diagonal: ${offsetA},${yA} -> ${offsetB},${yB}`,
      );
    }
  }
});

test('the ground storey is set back and the cornice stands proud', () => {
  const { profile, roofDeck } = facadeProfile(0, 21, 'base');
  const offsets = profile.map(([offset]) => offset);
  assert.ok(offsets.includes(-FACADE.groundDepth), 'the ground storey is recessed');
  assert.ok(offsets.includes(FACADE.corniceDepth), 'the cornice stands proud');
  assert.equal(roofDeck, 21);
  // The wall between the arcade and the cornice is on the footprint.
  assert.ok(offsets.includes(0));
  // The parapet rises above the roof deck.
  const top = Math.max(...profile.map(([, y]) => y));
  assert.equal(top, 21 + FACADE.parapet);
});

test('the storey lines only appear when the screen can carry them', () => {
  const base = facadeProfile(0, 45, 'base').profile.length;
  const courses = facadeProfile(0, 45, 'courses').profile.length;
  assert.ok(courses > base, 'courses add steps');
  const full = facadeProfile(0, 45, 'full').profile.length;
  assert.ok(full >= courses);
});

test('a building too short for a shopfront does not get an arcade', () => {
  // A 4 m shed: there is no room for a 4.2 m ground storey under a wall.
  const short = facadeProfile(0, 4, 'base');
  assert.ok(!short.profile.some(([offset]) => offset === -FACADE.groundDepth));
  // A three-storey shophouse does: the shopfront is the point of it.
  const tall = facadeProfile(0, 9, 'base');
  assert.ok(tall.profile.some(([offset]) => offset === -FACADE.groundDepth));
});

test('the ring offset moves outwards for a positive distance', () => {
  const out = offsetRing(ring, 2);
  assert.ok(out[0][0] < ring[0][0], 'the left edge moves west');
  assert.ok(out[1][0] > ring[1][0], 'the right edge moves east');
  const inward = offsetRing(ring, -2);
  assert.ok(inward[0][0] > ring[0][0], 'a negative distance moves inwards');
});

test('the mesh is built from the footprint and the height', () => {
  const feature = {
    type: 'Feature',
    properties: { building: 'apartments', render_height: 21, render_min_height: 0 },
    geometry: { type: 'Polygon', coordinates: [[
      [100.5400, 13.7540], [100.5402, 13.7540], [100.5402, 13.7541], [100.5400, 13.7541], [100.5400, 13.7540],
    ]] },
  };
  const built = buildFacadeGroup([feature], 'base', [100.5401, 13.75405], 0, () => 0);
  assert.equal(built.count, 1);
  assert.equal(built.groups.length, 1);
  const buffer = built.groups[0].buffer;
  assert.ok(buffer.positions.length > 0);
  // The mesh stands from the ground to the top of the parapet.
  const ys = [];
  for (let i = 1; i < buffer.positions.length; i += 3) ys.push(buffer.positions[i]);
  assert.ok(Math.min(...ys) >= -0.001, 'the mesh starts at the ground');
  assert.ok(Math.abs(Math.max(...ys) - (21 + FACADE.parapet)) < 0.001, 'the mesh ends at the parapet');
  // The ground storey is recessed, so the mesh's lowest band is inside the
  // footprint: the arcade is a hole in the wall, not a wider box.
  const lowest = ys.filter((y) => y < 0.01);
  assert.ok(lowest.length > 0);
});

test('the band filter names the band by height, not by id', () => {
  assert.equal(FACADE_BAND_FILTER[0], 'all');
  const json = JSON.stringify(FACADE_BAND_FILTER);
  assert.ok(!json.includes('"id"'), 'the filter must not read an id');
  assert.ok(json.includes(String(FACADE_MIN_METERS)));
  assert.ok(json.includes(String(FACADE_MAX_METERS)));
  // It is built on the same height expression the map extrudes with.
  assert.ok(json.includes(JSON.stringify(HEIGHT_GET).slice(1, 40)));
});

test('the mesh and the map agree on how tall a building is', () => {
  const props = { render_height: 21 };
  const { height, base } = heightFor(props, 'metro');
  const { profile } = facadeProfile(base, height, 'base');
  const top = Math.max(...profile.map(([, y]) => y));
  assert.ok(top > height, 'the parapet stands above the extruded height');
  assert.ok(top < height + 2);
});
