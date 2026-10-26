import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANDMARK_VIEWS } from '../public/landmark-views.js';
import { GRAND_PALACE_SLOT } from '../public/grand-palace-slot.js';

const source = readFileSync(new URL('../public/building-massing.js', import.meta.url), 'utf8');
// Execute the actual renderer factory, supplying only its external dependencies.
const factory = source.slice(source.indexOf('function createCustomLayer('), source.indexOf('\nfunction parkLayer('));
function harness({ valid = true, failAt = 0, rendered = false } = {}) {
  const runtime = { active: true, rendered, origin: [100.49, 13.75], altitude: 0, content: { visible: true }, facadeContent: { visible: true }, facadeScene: {} };
  const jobs = [];
  let passes = 0, restored = 0, disabled = 0;
  const make = new Function('runtime', 'MASSING_LAYER', 'composeProjection', 'maplibregl', 'queueMicrotask', 'reapplyMassingFilters', 'deactivate', 'console', `${factory}; return createCustomLayer;`)(
    runtime, 'test-layer', () => valid ? {} : null,
    { MercatorCoordinate: { fromLngLat: () => ({ x: 0, y: 0, z: 0, meterInMercatorCoordinateUnits: () => 1 }) } },
    fn => jobs.push(fn), map => { assert.equal(map, layer.map); restored++; },
    map => { assert.equal(map, layer.map); disabled++; runtime.active = false; }, { warn() {} },
  );
  const layer = make({ THREE: {} });
  layer.map = {};
  layer.camera = {};
  layer.scene = {};
  layer.renderer = { resetState() {}, render() { passes++; if (passes === failAt) throw new Error('GPU draw failed'); } };
  return { layer, runtime, flush() { jobs.splice(0).forEach(fn => fn()); }, counts: () => ({ passes, restored, disabled }) };
}

test('native buildings are replaced only after both custom passes succeed', () => {
  const h = harness();
  assert.equal(h.runtime.rendered, false);
  h.layer.render(null, {});
  assert.equal(h.runtime.rendered, true);
  h.flush();
  assert.deepEqual(h.counts(), { passes: 2, restored: 1, disabled: 0 });
});
test('a missing projection restores native buildings instead of silently hiding them', () => {
  const h = harness({ valid: false, rendered: true });
  h.layer.render(null, {}); h.flush();
  assert.equal(h.runtime.rendered, false);
  assert.deepEqual(h.counts(), { passes: 0, restored: 1, disabled: 0 });
});
test('a failure in either draw pass abandons the handoff and restores extrusions', () => {
  for (const failAt of [1, 2]) {
    const h = harness({ failAt, rendered: true });
    h.layer.render(null, {}); h.flush();
    assert.equal(h.runtime.rendered, false);
    assert.equal(h.counts().disabled, 1);
  }
  assert.match(source, /const replacing = runtime\.active && runtime\.rendered/);
  assert.match(source, /webglcontextlost/);
  assert.match(source, /webglcontextrestored/);
  assert.match(source, /if \(!mesh\) continue;\s*for \(const key of mesh.keys\) builtKeys.add\(key\)/);
  assert.match(source, /const hidden = rebuildScene/);
});

test('render audit never closes other peoples tabs by matching their URL', () => {
  const audit = readFileSync(new URL('./render-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(audit, /Target\.getTargets/);
  assert.doesNotMatch(audit, /process\.exit\(/);
  assert.match(audit, /finally[\s\S]*Target\.closeTarget/);
});

test('heritage entry points land above both model zoom floors at existing anchors', () => {
  assert.deepEqual(LANDMARK_VIEWS['grand-palace'].center, GRAND_PALACE_SLOT.anchor);
  for (const view of Object.values(LANDMARK_VIEWS)) {
    assert.ok(view.zoom >= 16 && view.pitch >= 45);
    assert.ok(view.center[0] > 100.48 && view.center[0] < 100.50);
    assert.ok(view.center[1] > 13.74 && view.center[1] < 13.76);
  }
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of Object.keys(LANDMARK_VIEWS)) assert.ok(html.includes(`data-landmark-view="${id}"`));
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const initialMapLoad = new Promise/);
  assert.match(app, /await initialMapLoad/);
  assert.doesNotMatch(app, /if \(!map.isStyleLoaded\(\)\) await new Promise/);
});

test('every registered map layer has the control required by setLayerToggle', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const start = app.indexOf('const LAYERS = [');
  assert.ok(start >= 0);
  const registry = app.slice(start, app.indexOf('\n];', start));
  const ids = [...registry.matchAll(/^    id: "([^"]+)"/gm)].map(m => m[1]);
  assert.ok(ids.length >= 20, 'the registry check must not silently check an empty slice');
  for (const id of ids) assert.ok(html.includes(`id="toggle-${id}"`), `${id} cannot be switched on: missing control`);
});
