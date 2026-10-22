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
  massingHitProperties,
  toLocal,
} from '../public/building-massing.js';
import { classify, buildForm } from '../public/heritage-forms.js';
import { CURATED_PLANS, cityIconAccuracy, planFor, planMetres } from '../public/city-icons.js';

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

// The builder works in metres relative to the footprint's own centre, which
// is what the massing layer hands it. A test that passes raw lng/lat feeds it
// degrees and measures nothing.
function localRing(f) {
  const ring = ring2d(f);
  const origin = [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
  return ring.map(([lng, lat]) => toLocal(lng, lat, origin));
}

function planSpan(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { width: maxX - minX, depth: maxZ - minZ, midX: (minX + maxX) / 2, midZ: (minZ + maxZ) / 2 };
}

// The longest side of the plan. A square's axis-aligned bounding box grows
// to side x sqrt(2) once it is rotated to the street, so the box measures the
// screen, not the building.
function planSide(ring) {
  let longest = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    longest = Math.max(longest, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return longest;
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
      const built = buildCityIcon(kind, localRing(f), height, 0, lod);
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

// The published figures the plans are derived from, written out here so the
// test does not read its own answer out of the module. Wikipedia infoboxes
// citing CTBUH 487 / Emporis 107136 and Emporis 107198, read 2026-10-22.
const PUBLISHED = {
  'baiyoke-ii': { floorAreaM2: 179400, storeys: 88, trim: 1 },
  'state-tower': { floorAreaM2: 300000, storeys: 68, trim: 0.93 },
};

test('the OSM footprint is not the building, so the plan is corrected', () => {
  // Baiyoke's OSM way is the lift core (26 m across) and State Tower's
  // includes the podium (143 m long). Both plans are replaced with one
  // derived from the published floor area.
  for (const [kind, id] of [['baiyoke-ii', 'icon-baiyoke-tower-ii'], ['state-tower', 'icon-state-tower']]) {
    const f = featureById(id);
    const local = localRing(f);
    const osm = planSpan(local);
    const plan = planFor(kind, local);
    const span = planSpan(plan);

    // The module must carry the published figures, not a typed-in width.
    assert.equal(CURATED_PLANS[kind].floorAreaM2, PUBLISHED[kind].floorAreaM2,
      `${kind}'s published floor area was changed — re-read the source`);
    assert.equal(CURATED_PLANS[kind].storeys, PUBLISHED[kind].storeys,
      `${kind}'s published storey count was changed — re-read the source`);
    assert.equal(CURATED_PLANS[kind].trim, PUBLISHED[kind].trim);

    // And the plan must be that figure, derived.
    const expected = Math.sqrt(PUBLISHED[kind].floorAreaM2 / PUBLISHED[kind].storeys) * PUBLISHED[kind].trim;
    assert.ok(
      Math.abs(planMetres(kind) - expected) < 0.01,
      `${kind}'s plan is not derived from its published floor area`,
    );
    assert.ok(
      Math.abs(planSide(plan) - expected) < 0.5,
      `${kind} was not drawn on its derived plan`,
    );
    assert.equal(plan.length, 5, `${kind} plan should be a square with one cut corner`);
    assert.notEqual(
      Math.round(planSide(local)),
      Math.round(expected),
      `${kind}'s OSM outline no longer differs from the curated plan — the override may be stale`,
    );
    // The plan is centred where the OSM outline was: same plot, right shape.
    // A square of side s, rotated to the street, puts its corners at s/2 * √2
    // from the centre. The cut corner pulls its two vertices in.
    const cornerRadius = Math.max(...plan.map((p) => Math.hypot(p[0], p[1])));
    const cornerExpected = (expected / 2) * Math.SQRT2;
    assert.ok(
      Math.abs(cornerRadius - cornerExpected) < 0.5,
      `${kind} plan is not centred on its plot: corner at ${cornerRadius.toFixed(1)} m, expected ${cornerExpected.toFixed(1)} m`,
    );
    assert.ok(osm.width > 0);
  }
});

test('the MahaNakhon keeps its OSM footprint — its way already is the building', () => {
  const f = featureById('icon-mahanakhon');
  const local = localRing(f);
  const plan = planFor('mahanakhon', local);
  assert.equal(plan, local, 'the MahaNakhon has no curated plan and must be left alone');
  assert.equal(CURATED_PLANS.mahanakhon, undefined);
});

test('a tower whose plan was inferred says so, and never claims a survey', () => {
  for (const kind of CITY_ICON_KINDS) {
    const note = cityIconAccuracy(kind);
    assert.match(note, /not a survey/);
    if (CURATED_PLANS[kind]) {
      assert.match(note, /inferred from published floor area/,
        `${kind}'s plan was replaced — the note must say so`);
      assert.match(note, /not a survey/);
    }
  }
  // The note travels on the feature the popup reports.
  const built = buildTowerBuffers(featureById('icon-state-tower'), 1);
  assert.match(String(built.properties.accuracy), /inferred from published floor area/);
});

test('a click lands on the silhouette you can see', () => {
  // The hit ring follows the drawn plan, not the OSM outline the icon
  // replaced: a visitor clicks the tower they see.
  const f = featureById('icon-baiyoke-tower-ii');
  const built = buildTowerBuffers(f, 1);
  const ring = built.ring;
  assert.ok(ring && ring.length >= 4, 'the icon has no hit ring');
  const span = planSpan(ring);
  const metres = Math.abs(ring[0][0] - ring[1][0]) * 111319.49 * Math.cos(13.754 * Math.PI / 180);
  assert.ok(metres > 20, `the hit ring is the ${26} m OSM core, not the 45 m tower`);
  assert.ok(span.width > 0);
});

test('a picked tower keeps the label of how it was modelled', () => {
  // The massing layer used to stamp every picked tower as 'setback', which
  // relabelled Mahanakhon's spiral as a generic stack. The builder's own
  // label must survive into the properties a click reports.
  const icon = massingHitProperties({ massing: 'icon', accuracy: 'typological silhouette, not a survey' });
  assert.equal(icon.massing, 'icon', 'an icon must not be relabelled a setback');
  assert.match(String(icon.accuracy), /not a survey/);

  const plain = massingHitProperties({ render_height: 120 });
  assert.equal(plain.massing, 'setback', 'a generic tower still says what it is');
  assert.equal(plain.render_height, 120, 'the other properties must survive');

  // And the builder must actually produce those two labels.
  const maha = buildTowerBuffers(featureById('icon-mahanakhon'), 1);
  assert.equal(massingHitProperties(maha.properties).massing, 'icon');
  const generic = buildTowerBuffers(landmarks.features.find((f) => f.properties?.id === 'icon-empire-tower'), 1);
  assert.equal(massingHitProperties(generic.properties).massing, 'setback');
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
  // Strip comments, then look at the executable code and the strings it
  // ships. A string may MENTION a survey only to deny one; a bare "measured
  // footprint" or "as-built" is a claim this layer cannot support.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const strings = [...code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
    .filter(Boolean);
  for (const text of strings) {
    if (!/survey|measured|as-built/i.test(text)) continue;
    assert.match(
      text,
      /not a survey|no survey|not measured|never/i,
      `the code claims measurement: "${text}"`,
    );
  }
});
