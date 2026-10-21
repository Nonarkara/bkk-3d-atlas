// The city forms layer must not depend on luck.
//
// Measured on the old town: the zoomend fires at t=8ms, the heritage detail
// file is not queryable until t=7025ms, and 'idle' never fires again,
// because this map never goes idle. A layer that rebuilds once on 'idle' is
// therefore empty when the user looks at it.
//
// These tests hold the layer to the behaviour that fixes it: it keeps trying
// until the buildings are actually in view.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  installCityForms,
  uninstallCityForms,
  attachCityFormsRefresh,
  detachCityFormsRefresh,
  cityFormsDebugState,
  CITY_FORMS_LAYER,
} from '../public/city-forms-layer.js';

const ORIGIN = [100.5, 13.75];

function rectangle(eastM, northM, widthM, depthM, height) {
  const m = { east: 111319.49 * Math.cos(ORIGIN[1] * Math.PI / 180), north: 110574 };
  const e = eastM / m.east;
  const n = northM / m.north;
  const w = widthM / m.east;
  const d = depthM / m.north;
  return {
    type: 'Feature',
    properties: { render_height: height, render_min_height: 0 },
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

// A map that holds one layer of buildings, and can be told to pretend they
// have not arrived yet.
function fakeMap({ buildings = [], zoom = 17.6 } = {}) {
  const state = { buildings, zoom, handlers: new Map(), layers: new Set() };
  // The building layers the city forms read are present; only their contents
  // arrive late, which is the whole point of the test.
  state.layers.add('bkkx-3d-buildings-hi');
  state.layers.add('bkkx-rattanakosin-buildings');
  const map = {
    state,
    getZoom: () => state.zoom,
    getCenter: () => ({ lng: ORIGIN[0], lat: ORIGIN[1] }),
    getLayer: (id) => (state.layers.has(id) ? { id, type: 'fill-extrusion' } : undefined),
    addLayer: (layer) => { state.layers.add(layer.id); },
    removeLayer: (id) => { state.layers.delete(id); },
    queryRenderedFeatures: ({ layers }) => (
      layers.includes('bkkx-3d-buildings-hi') ? state.buildings : []
    ),
    triggerRepaint: () => {},
    on: (event, handler) => {
      if (!state.handlers.has(event)) state.handlers.set(event, new Set());
      state.handlers.get(event).add(handler);
    },
    off: (event, handler) => { state.handlers.get(event)?.delete(handler); },
    fire: (event) => { for (const handler of state.handlers.get(event) ?? []) handler(); },
  };
  return map;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Run the clock forward far enough for the debounce and the retry to fire.
async function settle(t, rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    t.mock.timers.tick(500);
    await flush();
  }
}

test('the layer keeps trying after a pass that found nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = fakeMap({ buildings: [] });
  await installCityForms(map);
  attachCityFormsRefresh(map);

  // The first pass runs while the buildings are still in flight. This is the
  // pass that used to be the only pass.
  await settle(t, 2);
  assert.equal(cityFormsDebugState().stats.treated, 0);
  assert.equal(cityFormsDebugState().lastSeen, 0, 'the layer should know it saw nothing');

  // The buildings land. Nothing else re-arms the layer: no 'idle' arrives,
  // because this map never goes idle.
  map.state.buildings = [rectangle(0, 0, 9, 7, 7), rectangle(30, 0, 26, 20, 22)];
  await settle(t);

  const state = cityFormsDebugState();
  assert.equal(state.lastSeen, 2, 'the layer never saw the buildings');
  assert.equal(state.stats.treated, 2, 'the layer never rebuilt on the buildings');
  assert.equal(state.stats.kinds.hip, 1);
  assert.equal(state.stats.kinds.plant, 1);
  assert.ok(state.triangles > 0, 'the layer built no geometry');

  detachCityFormsRefresh(map);
  uninstallCityForms(map);
});

test('the layer stops retrying once it has built what it can', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = fakeMap({ buildings: [] });
  await installCityForms(map);
  attachCityFormsRefresh(map);
  await settle(t, 2);
  map.state.buildings = [rectangle(0, 0, 9, 7, 7)];
  await settle(t);
  assert.equal(cityFormsDebugState().lastSeen, 1);
  const built = cityFormsDebugState().generation;

  // With the buildings in view, the retry must stop rather than spin.
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(cityFormsDebugState().generation, built, 'the layer kept rebuilding after it had finished');

  detachCityFormsRefresh(map);
  uninstallCityForms(map);
});

test('a view below the zoom threshold draws nothing and says so', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = fakeMap({ buildings: [], zoom: 14 });
  await installCityForms(map);
  attachCityFormsRefresh(map);
  await settle(t, 4);
  const state = cityFormsDebugState();
  assert.equal(state.stats.treated, 0);
  assert.equal(state.active, false, 'the layer should not be drawing at city scale');
  assert.equal(state.triangles, 0);
  // At city scale the layer is not even added: there is nothing to draw, and
  // a custom layer costs a render pass.
  assert.equal(map.getLayer(CITY_FORMS_LAYER), undefined, 'the layer should not be installed at city scale');

  detachCityFormsRefresh(map);
  uninstallCityForms(map);
});
