// The city must never be invisible.
//
// This reads like a slogan until you remember the bug it was written for.
// The map allowed zoom 10, the archive's TileJSON declares minzoom 11, and
// the atlas OPENS at z10.6 — so the opening view had no city in it. Satellite,
// roads and khlongs, and a flat plane where Bangkok should be.
//
// Two failures hide behind that one symptom, and the second is why lowering
// the LAYER's floor did not fix it:
//
//   1. a layer whose minzoom is above the map's zoom is hidden, and
//   2. a SOURCE whose minzoom is above the map's zoom is switched off
//      outright — the source cache never asks the archive for a tile, so the
//      layer is not "late", it is never consulted.
//
// MapLibre warns about neither. There is no error and no empty response to
// notice. The only symptom is a city that is not there.
//
// So the rule is asserted here, against the numbers the app actually uses:
//   1. the map may not allow a zoom the archive does not reach
//   2. the city layer's floor is at or below the map's own floor
//   3. every quick-jump view is served at a zoom where the city exists
//   4. the city layer's ceiling is above the source's deepest zoom
//   5. the band layer's floor is at or below the massing mesh's floor
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATLAS_MAX_PITCH,
  ATLAS_MAX_ZOOM,
  ATLAS_MIN_ZOOM,
  BAND_LAYER_MIN_ZOOM,
  BUILDINGS_LAYER_MAX_ZOOM,
  BUILDINGS_LAYER_MIN_ZOOM,
  BUILDINGS_SOURCE_MAX_ZOOM,
  BUILDINGS_SOURCE_MIN_ZOOM,
  MASSING_LAYER_MIN_ZOOM,
} from '../public/layer-zooms.js';

const areas = JSON.parse(readFileSync(new URL('../public/bkk-areas.json', import.meta.url), 'utf8'));

test('the map may not allow a zoom the archive does not reach', () => {
  assert.ok(
    ATLAS_MIN_ZOOM >= BUILDINGS_SOURCE_MIN_ZOOM,
    `the map allows z${ATLAS_MIN_ZOOM} but the metro archive starts at z${BUILDINGS_SOURCE_MIN_ZOOM} — below that, MapLibre switches the source off and never asks the archive for a tile, so the city is simply absent`,
  );
});

test('the city is visible at every zoom the map allows', () => {
  assert.ok(
    BUILDINGS_LAYER_MIN_ZOOM <= ATLAS_MIN_ZOOM,
    `the city layer starts at z${BUILDINGS_LAYER_MIN_ZOOM} but the map allows z${ATLAS_MIN_ZOOM} — the city is hidden from the visitor's own zoom range`,
  );
});

test('every quick-jump view is served at a zoom where the city exists', () => {
  // MapLibre clamps a jump to the map's floor, so a view asking for z10.6
  // under a floor of 11 is served at 11 — which is where the city is.
  const blind = areas.areas.filter((a) => Math.max(a.zoom, ATLAS_MIN_ZOOM) < BUILDINGS_LAYER_MIN_ZOOM);
  assert.deepEqual(blind.map((a) => `${a.id}@z${a.zoom}`), [], 'these quick-jump views open with no city in them');
});

test('the layer ceiling sits above the source depth, so z17 is still requested', () => {
  assert.ok(
    BUILDINGS_LAYER_MAX_ZOOM > BUILDINGS_SOURCE_MAX_ZOOM,
    `the layer's ceiling (z${BUILDINGS_LAYER_MAX_ZOOM}) must sit above the source's deepest zoom (z${BUILDINGS_SOURCE_MAX_ZOOM}); a layer capped AT the source depth is not drawn there, and MapLibre then never asks the source for a tile`,
  );
});

test('the band exists wherever the mesh that replaces it is awake', () => {
  assert.ok(
    BAND_LAYER_MIN_ZOOM <= MASSING_LAYER_MIN_ZOOM,
    `the band layer starts at z${BAND_LAYER_MIN_ZOOM} but the facade mesh at z${MASSING_LAYER_MIN_ZOOM} — above the band the mesh asks a layer that does not exist for its buildings, and the band falls back to plain boxes`,
  );
});

test('the camera limits are the ones the atlas claims', () => {
  assert.equal(ATLAS_MAX_ZOOM, 19);
  assert.equal(ATLAS_MAX_PITCH, 75);
});

test('app.js uses the shared constants instead of its own literals', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // The map's own zoom limits, once written as literals, were the source of
  // the drift: 10 in the Map constructor and 11 in the layer.
  assert.match(app, /minZoom: ATLAS_MIN_ZOOM,/);
  assert.match(app, /maxZoom: ATLAS_MAX_ZOOM,/);
  assert.match(app, /maxPitch: ATLAS_MAX_PITCH,/);
  assert.match(app, /minzoom: BUILDINGS_LAYER_MIN_ZOOM,/);
  // A stray literal in the buildings layer would put the hole back.
  const layerBlock = app.slice(app.indexOf('id: BKKX_BUILDINGS_LAYER,'), app.indexOf('id: BKKX_BUILDINGS_LAYER,') + 700);
  assert.doesNotMatch(layerBlock, /minzoom:\s*\d+/, 'the city layer must not carry its own zoom literal');
  // And so would a stray literal in the Map constructor.
  const mapBlock = app.slice(app.indexOf('const map = new maplibregl.Map('), app.indexOf('const map = new maplibregl.Map(') + 700);
  assert.doesNotMatch(mapBlock, /minZoom:\s*\d+/, 'the map must not carry its own zoom literal');
});
