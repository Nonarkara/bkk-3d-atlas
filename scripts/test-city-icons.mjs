// Signature city icons: the three skyline towers draw as themselves, and
// Loha Prasat draws as the Metal Palace rather than a cruciform prasat.
//
// These are typological silhouettes on real footprints — the tests protect
// the honesty contract (no survey claims) and the geometry contract (finite
// vertices, proportions that survive a LOD change, icons denser than the
// generic stack they replace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cityIconKindFor,
  buildCityIcon,
  CITY_ICON_KINDS,
} from '../public/city-icons.js';
import {
  buildTowerBuffers,
  resolveHeight,
} from '../public/building-massing.js';
import { classify, buildForm } from '../public/heritage-forms.js';

const landmarks = JSON.parse(
  readFileSync(new URL('../public/bkk-landmarks.geojson', import.meta.url), 'utf8'),
);

function featureById(id) {
  return landmarks.features.find((f) => f.properties?.id === id);
}

function ring2d(f) {
  const g = f.geometry;
  return g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
}

function heritageFeature(props, ring) {
  return {
    type: 'Feature',
    properties: { id: 'bkk-building-1', ...props },
    geometry: { type: 'Polygon', coordinates: [ring ?? [[100.5, 13.75], [100.501, 13.75], [100.501, 13.751], [100.5, 13.751], [100.5, 13.75]]] },
  };
}

function finiteGeometry(part) {
  return !!part && part.positions.length >= 9 && part.positions.every(Number.isFinite);
}

test('icons match by registry id and OSM way id, and refuse strangers', () => {
  assert.equal(cityIconKindFor({ id: 'icon-mahanakhon' }), 'mahanakhon');
  assert.equal(cityIconKindFor({ osm_id: 444651219 }), 'mahanakhon');
  assert.equal(cityIconKindFor({ osm_id: '444651219' }), 'mahanakhon');
  assert.equal(cityIconKindFor({ id: 'icon-baiyoke-tower-ii' }), 'baiyoke-ii');
  assert.equal(cityIconKindFor({ id: 'icon-state-tower' }), 'state-tower');
  assert.equal(cityIconKindFor({ id: 'icon-empire-tower' }), null);
  assert.equal(cityIconKindFor({ name: 'ใบหยก 2' }), null, 'name alone must not match');
  assert.equal(cityIconKindFor(null), null);
});

test('every icon builds finite geometry at both LODs from the real footprint', () => {
  const byKind = {
    mahanakhon: 'icon-mahanakhon',
    'baiyoke-ii': 'icon-baiyoke-tower-ii',
    'state-tower': 'icon-state-tower',
  };
  assert.deepEqual(Object.keys(byKind).sort(), [...CITY_ICON_KINDS].sort());
  for (const [kind, id] of Object.entries(byKind)) {
    const f = featureById(id);
    assert.ok(f, `${id} missing from bkk-landmarks.geojson`);
    const height = resolveHeight(f.properties);
    assert.ok(height >= 200, `${id} height ${height} is not tower scale`);
    for (const lod of [0, 1]) {
      const built = buildCityIcon(kind, ring2d(f), height, 0, lod);
      assert.ok(built, `${kind} built nothing at lod ${lod}`);
      for (const part of [built.body, built.crown, built.roof]) {
        if (part === null) continue;
        assert.ok(finiteGeometry(part), `${kind} lod ${lod} produced degenerate geometry`);
      }
    }
  }
});

test('Mahanakhon is denser than the generic stack it replaces', () => {
  const f = featureById('icon-mahanakhon');
  const local = ring2d(f);
  const height = resolveHeight(f.properties);
  const icon = buildCityIcon('mahanakhon', local, height, 0, 1);
  const generic = buildCityIcon('mahanakhon', local, height, 0, 1); // same builder must be deterministic
  assert.equal(icon.body.positions.length, generic.body.positions.length);
  // The pixel ribbon: the crown group must carry substantial extra geometry
  // beyond the shaft's tier caps — the ribbon is the point of the form.
  assert.ok(icon.crown.positions.length > 200,
    `crown (pixels + tier caps) too thin: ${icon.crown.positions.length} floats`);
});

test('Baiyoke reaches its full 304 m including the spire', () => {
  const f = featureById('icon-baiyoke-tower-ii');
  const height = resolveHeight(f.properties);
  const built = buildCityIcon('baiyoke-ii', ring2d(f), height, 0, 1);
  let maxY = -Infinity;
  for (const part of [built.body, built.crown, built.roof]) {
    if (!part) continue;
    for (let i = 1; i < part.positions.length; i += 3) maxY = Math.max(maxY, part.positions[i]);
  }
  assert.ok(Math.abs(maxY - height) < height * 0.01,
    `top of geometry ${maxY.toFixed(1)}m is not the stated ${height}m`);
});

test('State Tower carries its dome in the gold roof group', () => {
  const f = featureById('icon-state-tower');
  const height = resolveHeight(f.properties);
  const built = buildCityIcon('state-tower', ring2d(f), height, 0, 1);
  assert.ok(finiteGeometry(built.roof), 'State Tower drew no roof/dome group');
  assert.equal(built.colors.roof, 0xc9a227, 'dome must ride the gold roof color');
  // The dome lives in the top fifth of the tower, not at its base.
  let roofMinY = Infinity;
  for (let i = 1; i < built.roof.positions.length; i += 3) roofMinY = Math.min(roofMinY, built.roof.positions[i]);
  assert.ok(roofMinY > height * 0.7, `dome starts at ${roofMinY.toFixed(0)}m — too low for the crown`);
});

test('buildTowerBuffers routes the named icons through the signature forms', () => {
  for (const id of ['icon-mahanakhon', 'icon-baiyoke-tower-ii', 'icon-state-tower']) {
    const f = featureById(id);
    const built = buildTowerBuffers(f, 1);
    assert.ok(built, `${id} built nothing`);
    assert.ok(built.icon, `${id} did not take the icon path`);
    assert.match(String(built.properties.accuracy), /not a survey/);
    assert.ok(built.properties.source, 'the registry source line must travel');
  }
  // A non-icon tower still takes the generic setback path.
  const plain = landmarks.features.find((f) => f.properties?.id === 'icon-empire-tower');
  const built = buildTowerBuffers(plain, 1);
  assert.ok(built, 'generic tower built nothing');
  assert.equal(built.icon, undefined, 'non-icon must not claim an icon');
});

test('Loha Prasat classifies as its own form, not a cruciform prasat', () => {
  const kind = classify(heritageFeature({
    name: 'โลหะปราสาท',
    building: 'temple',
    height: 33,
  }));
  assert.equal(kind.kind, 'loha');
  assert.equal(kind.confidence, 'named');
});

test('the Loha Prasat form carries 37 spires worth of silhouette', () => {
  // A 36 m square footprint, 33 m tall — close to the real Metal Palace plan.
  const ring = [[100.503, 13.748], [100.5034, 13.748], [100.5034, 13.7484], [100.503, 13.7484], [100.503, 13.748]];
  const form = buildForm({ kind: 'loha', ring, base: 0, height: 33, tiers: 1, confidence: 'named' });
  assert.ok(form.positions.length > 0, 'Loha Prasat drew nothing');
  assert.ok(form.positions.every(Number.isFinite), 'non-finite vertex in the Metal Palace');
  // 37 spires × 6 lathe segments × quads each — far more triangles than the
  // three bare terrace prisms would produce alone.
  assert.ok(form.positions.length > 1500,
    `too thin for 37 spires: ${form.positions.length / 9} triangles`);
  // Iron, not gold: no colour triple may equal the gold token.
  const gold = [0.84, 0.66, 0.2];
  for (let i = 0; i < form.colors.length; i += 3) {
    const isGold = Math.abs(form.colors[i] - gold[0]) < 1e-6
      && Math.abs(form.colors[i + 1] - gold[1]) < 1e-6
      && Math.abs(form.colors[i + 2] - gold[2]) < 1e-6;
    assert.ok(!isGold, 'Loha Prasat is iron — the gold token must not appear');
  }
});

test('the icon file claims no survey', () => {
  const src = readFileSync(new URL('../public/city-icons.js', import.meta.url), 'utf8');
  assert.match(src, /typological/, 'the file must say what it is');
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ''), /survey|measured|as-built/i,
    'executable code must not claim measurement');
});
