import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildHeritageRoofs} from '../public/heritage-roofs.js';
test('pilot follows two existing footprints with finite closed roof geometry', () => {
  const data = JSON.parse(readFileSync(new URL('../public/bkk-heritage-detail.geojson', import.meta.url)));
  const before = JSON.stringify(data);
  const roofs = buildHeritageRoofs(data);
  assert.equal(roofs.features.length, 96);
  assert.equal(new Set(roofs.features.map(f => f.properties.name)).size, 2);
  for (const f of roofs.features) {
    assert.ok(f.geometry.coordinates.flat(2).every(Number.isFinite));
    assert.deepEqual(f.geometry.coordinates[0][0], f.geometry.coordinates[0].at(-1));
    assert.ok(f.properties.top >= f.properties.base && f.properties.top <= f.properties.base + 6);
    assert.match(f.properties.accuracy, /not for flood/);
  }
  assert.equal(JSON.stringify(data), before);
});
test('missing geometry produces no invented landmarks', () => {
  assert.deepEqual(buildHeritageRoofs({features: []}).features, []);
});
