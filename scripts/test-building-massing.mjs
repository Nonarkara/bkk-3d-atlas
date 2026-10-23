import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MASSING_MIN_ZOOM,
  TALL_MIN_METERS,
  THREE_VERSION,
  buildTowerBuffers,
  featureKeys,
  filterHidingIds,
  keysInsideRings,
  isTowerCandidate,
  palaceHideKeys,
  pointInTriangle,
  resolveHeight,
  roofChoice,
  towerTiers,
  triangulateXZ,
} from '../public/building-massing.js';
import { GRAND_PALACE_SLOT } from '../public/grand-palace-slot.js';
import { buildPalaceDraft, hallTierPlan, palaceFormFor, readGlbJson, CHEDI_BELL, addTieredHall, addBellChedi, addMondop, addPrang } from './palace-standin.mjs';
import { MeshDraft } from '../public/building-massing.js';

test('roof choice follows roof:shape, then a short residential default', () => {
  assert.equal(roofChoice({ 'roof:shape': 'gabled', building: 'office' }, 120), 'pitched');
  assert.equal(roofChoice({ roof_shape: 'flat', building: 'house' }, 12), 'flat');
  assert.equal(roofChoice({ building: 'house' }, 12), 'pitched');
  assert.equal(roofChoice({ building: 'office', kind: 'tower' }, 200), 'flat');
  assert.equal(roofChoice({ 'roof:shape': 'pyramidal' }, 30), 'pitched');
});

test('height prefers a sane tag and falls back to building:levels', () => {
  assert.equal(resolveHeight({ height: 10, 'building:levels': 40 }), 10);
  assert.equal(resolveHeight({ 'building:levels': '40' }), 126);
  assert.equal(resolveHeight({ height: 9000 }), null);
  assert.equal(resolveHeight({}), null);
  assert.equal(resolveHeight({ render_height: 0 }), null);
});

test('a tile footprint inside a tower ring is hidden with the tower', () => {
  const tower = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  const inside = { properties: { id: 99 }, geometry: { type: 'Polygon', coordinates: [[[0.4, 0.4], [1.2, 0.4], [1.2, 1.2], [0.4, 1.2], [0.4, 0.4]]] } };
  const outside = { properties: { osm_id: 7 }, geometry: { type: 'Polygon', coordinates: [[[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]]] } };
  assert.deepEqual(keysInsideRings([inside, outside], [tower]), ['99']);
});

test('temples and short blocks stay on fill-extrusion', () => {
  assert.equal(isTowerCandidate({ kind: 'chedi', height: 120 }), false);
  assert.equal(isTowerCandidate({ kind: 'bridge', height: 160 }), false);
  assert.equal(isTowerCandidate({ building: 'temple', height: 90 }), false);
  assert.equal(isTowerCandidate({ kind: 'tower', height: TALL_MIN_METERS - 1 }), false);
  assert.equal(isTowerCandidate({ kind: 'tower', height: TALL_MIN_METERS }), true);
  assert.equal(isTowerCandidate({ kind: 'hotel', height: 150 }), true);
  assert.equal(MASSING_MIN_ZOOM, 16);
  assert.equal(THREE_VERSION, '0.186.1');
});

test('tower tiers cover the tagged height and step inward', () => {
  for (const lod of [0, 1]) {
    const tiers = towerTiers(0, 314, lod);
    assert.equal(tiers[0].from, 0);
    assert.equal(tiers.at(-1).to, 314);
    assert.equal(tiers[0].scale, 1);
    for (let i = 1; i < tiers.length; i++) {
      assert.equal(tiers[i].from, tiers[i - 1].to);
      assert.ok(tiers[i].scale < tiers[i - 1].scale);
    }
  }
  assert.ok(towerTiers(0, 314, 1).length > towerTiers(0, 314, 0).length);
});

test('a concave footprint triangulates without filling the notch', () => {
  const ring = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const { pts, tris } = triangulateXZ(ring);
  assert.equal(tris.length, 4);
  assert.equal(pointInTriangle([1.5, 0.5], ...tris[0].map((index) => pts[index])) || tris.some(([a, b, c]) => pointInTriangle([1.5, 0.5], pts[a], pts[b], pts[c])), true);
  assert.equal(tris.some(([a, b, c]) => pointInTriangle([1.5, 1.5], pts[a], pts[b], pts[c])), false);
});

test('MahaNakhon massing stays light and reaches its tagged height', () => {
  const landmarks = JSON.parse(readFileSync(new URL('../public/bkk-landmarks.geojson', import.meta.url)));
  const feature = landmarks.features.find((item) => item.properties?.id === 'icon-mahanakhon');
  const mesh = buildTowerBuffers(feature, 1);
  assert.ok(mesh);
  assert.ok(mesh.keys.includes('icon-mahanakhon'));
  assert.ok(mesh.keys.includes(String(feature.properties.osm_id)));
  const positions = [...mesh.body.positions, ...mesh.crown.positions, ...mesh.roof.positions];
  assert.ok(positions.every(Number.isFinite));
  let maxY = 0;
  for (const geometry of [mesh.body, mesh.crown, mesh.roof]) {
    for (let i = 1; i < geometry.positions.length; i += 3) maxY = Math.max(maxY, geometry.positions[i]);
  }
  assert.ok(Math.abs(maxY - 314) < 0.01);
  const triangles = [mesh.body, mesh.crown, mesh.roof].reduce((sum, geometry) => sum + geometry.positions.length / 9, 0);
  assert.ok(triangles < 2500, `triangle count ${triangles}`);
  assert.equal(mesh.colors.body, 0x9ba3b4);
  assert.equal(mesh.colors.roof, 0xf1efe8);
});

test('a gabled tower puts gold on the roof only', () => {
  const feature = {
    type: 'Feature',
    properties: { id: 'tower-gable', kind: 'tower', height: 100, 'roof:shape': 'gabled' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[100.5, 13.7], [100.501, 13.7], [100.501, 13.7004], [100.5, 13.7004], [100.5, 13.7]]],
    },
  };
  const mesh = buildTowerBuffers(feature, 1);
  assert.equal(mesh.colors.roof, 0xc9a227);
  assert.ok(mesh.roof.positions.length > 0);
  assert.equal(mesh.colors.body, 0x9ba3b4);
});

test('hiding filter keeps the base extrusion filter and lists ids', () => {
  const base = ['all', ['!=', ['get', 'hide_3d'], true]];
  const filter = filterHidingIds(base, ['icon-mahanakhon', '444651219']);
  assert.equal(filter[0], 'all');
  assert.equal(filter[1], base);
  assert.deepEqual(filter[2][1][2], ['literal', ['icon-mahanakhon', '444651219']]);
  assert.equal(filterHidingIds(base, []), base);
});

test('temple silhouettes stack, bell, taper, and stay on the plan', () => {
  const plan = hallTierPlan(3);
  for (let i = 1; i < plan.scales.length; i++) {
    assert.ok(plan.scales[i] < plan.scales[i - 1]);
    assert.ok(plan.pitches[i] > plan.pitches[i - 1]);
  }
  const bellMax = Math.max(...CHEDI_BELL);
  assert.ok(bellMax > CHEDI_BELL[0] && bellMax > CHEDI_BELL[CHEDI_BELL.length - 1]);
  assert.equal(palaceFormFor('bkk-building-23482983'), 'hall');
  assert.equal(palaceFormFor('bkk-building-782453374'), 'hall');
  assert.equal(palaceFormFor('bkk-building-82541135'), 'gallery');
  assert.equal(palaceFormFor('bkk-building-23482988'), 'chedi');
  assert.equal(palaceFormFor('bkk-building-23482989'), 'mondop');
  assert.equal(palaceFormFor('bkk-building-23482990'), 'prang');
  assert.equal(palaceFormFor('bkk-building-782214624'), 'block');

  const rect = [[-10, -4], [10, -4], [10, 4], [-10, 4]];
  const hall = new MeshDraft();
  addTieredHall(hall, rect, 20);
  const hallGold = hall.finish('gold').positions;
  let hallMaxY = 0;
  for (let i = 1; i < hallGold.length; i += 3) hallMaxY = Math.max(hallMaxY, hallGold[i]);
  const maxAbsZ = (y0, y1) => {
    let reach = 0;
    for (let i = 0; i < hallGold.length; i += 3) {
      const y = hallGold[i + 1];
      if (y < y0 || y > y1) continue;
      reach = Math.max(reach, Math.abs(hallGold[i + 2]));
    }
    return reach;
  };
  assert.ok(hallGold.some((value, index) => index % 3 === 0 && value > 10));
  assert.ok(hallGold.some((value, index) => index % 3 === 0 && value < -10));
  assert.ok(hallMaxY > 7, `hall roof should rise steeply, got ${hallMaxY}`);
  assert.ok(
    maxAbsZ(hallMaxY * 0.75, hallMaxY) < maxAbsZ(0, hallMaxY * 0.4),
    'upper roof tier is narrower than the lower eave',
  );

  function bandRadius(positions, y0, y1) {
    let radius = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      if (y < y0 || y > y1) continue;
      radius = Math.max(radius, Math.hypot(positions[i], positions[i + 2]));
    }
    return radius;
  }
  const square = [[-6, -6], [6, -6], [6, 6], [-6, 6]];
  const chedi = new MeshDraft();
  addBellChedi(chedi, square, 40);
  const chediGold = chedi.finish('gold').positions;
  const bulge = bandRadius(chediGold, 10, 18);
  const neck = bandRadius(chediGold, 28, 34);
  assert.ok(bulge > neck, `bell ${bulge} should be wider than the spire ${neck}`);
  assert.ok(bandRadius(chediGold, 38, 40) < 1.2);

  const mondop = new MeshDraft();
  addMondop(mondop, square, 28);
  const mondopAll = [...mondop.finish('gold').positions, ...mondop.finish('steel').positions];
  assert.ok(bandRadius(mondopAll, 0, 4) > 5);
  assert.ok(bandRadius(mondopAll, 22, 28) < bandRadius(mondopAll, 0, 4) * 0.45);

  const cross = [[2, 8], [2, 2], [8, 2], [8, -2], [2, -2], [2, -8], [-2, -8], [-2, -2], [-8, -2], [-8, 2], [-2, 2], [-2, 8]];
  const prang = new MeshDraft();
  addPrang(prang, cross, 32);
  const prangAll = [...prang.finish('gold').positions, ...prang.finish('steel').positions];
  const arms = bandRadius(prangAll, 0, 6);
  const cob = bandRadius(prangAll, 24, 32);
  assert.ok(arms > 7, `cross arms ${arms}`);
  assert.ok(cob < arms * 0.45, `prang ${cob} against arms ${arms}`);
});

test('palace slot matches the ubosot centroid and real heritage ids', () => {
  const heritage = JSON.parse(readFileSync(new URL('../public/bkk-heritage-detail.geojson', import.meta.url)));
  const ubosot = heritage.features.find((feature) => feature.properties?.id === GRAND_PALACE_SLOT.anchorFeatureId);
  const ring = ubosot.geometry.coordinates[0].slice(0, -1);
  const centroid = ring.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / ring.length);
  assert.ok(Math.abs(centroid[0] - GRAND_PALACE_SLOT.anchor[0]) < 1e-8);
  assert.ok(Math.abs(centroid[1] - GRAND_PALACE_SLOT.anchor[1]) < 1e-8);
  const ids = new Set(heritage.features.map((feature) => feature.properties?.id));
  for (const id of GRAND_PALACE_SLOT.hideIds) assert.ok(ids.has(id), id);
  assert.ok(palaceHideKeys().includes('23482983'));
  const { used, missing, draft, forms } = buildPalaceDraft(heritage);
  assert.deepEqual(missing, []);
  assert.equal(used.length, GRAND_PALACE_SLOT.hideIds.length);
  assert.equal(forms['bkk-building-23482983'], 'hall');
  assert.equal(forms['bkk-building-82541135'], 'gallery');
  assert.equal(forms['bkk-building-23482988'], 'chedi');
  assert.equal(forms['bkk-building-23482989'], 'mondop');
  assert.equal(forms['bkk-building-23482990'], 'prang');
  const gold = draft.finish('gold');
  const steel = draft.finish('steel');
  const paper = draft.finish('paper');
  assert.ok(gold.positions.length > 0);
  assert.ok(steel.positions.length > 0);
  assert.ok(paper.positions.length > 0);
  const all = [...gold.positions, ...steel.positions, ...paper.positions];
  assert.ok(all.every(Number.isFinite));
  let maxAbs = 0;
  let maxY = 0;
  for (let i = 0; i < all.length; i += 3) {
    maxAbs = Math.max(maxAbs, Math.hypot(all[i], all[i + 2]));
    maxY = Math.max(maxY, all[i + 1]);
  }
  assert.ok(maxAbs < 160, `stand-in extends ${maxAbs} m from the ubosot`);
  assert.ok(maxY <= 42.01);
  const triangles = all.length / 9;
  assert.ok(triangles < 8000, `palace triangles ${triangles}`);
});

test('shipped GLB is a small schematic with the survey note and no metal', () => {
  const bytes = readFileSync(new URL('../public/models/grand-palace.glb', import.meta.url));
  assert.ok(bytes.length < 3 * 1024 * 1024);
  assert.ok(bytes.length > 500);
  const json = readGlbJson(bytes);
  assert.match(json.asset.copyright, /OpenStreetMap contributors, ODbL/);
  assert.equal(json.asset.extras.note, 'Approximate model, not an official survey.');
  assert.equal(json.asset.extras.standIn, true);
  for (const material of json.materials) {
    assert.equal(material.pbrMetallicRoughness.metallicFactor, 0);
    assert.equal(material.pbrMetallicRoughness.roughnessFactor ?? 1, 1);
  }
  assert.ok(json.extensionsUsed?.includes('EXT_meshopt_compression'));
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const massing = readFileSync(new URL('../public/building-massing.js', import.meta.url), 'utf8');
  assert.match(page, new RegExp(`three@${THREE_VERSION}`));
  assert.match(page, /Approximate model, not an official survey/);
  assert.match(massing, /await import\('three'\)/);
  assert.match(massing, /GLTFLoader/);
  assert.match(massing, /MeshoptDecoder/);
  assert.match(massing, /DRACOLoader/);
  assert.match(massing, /DoubleSide/);
  assert.doesNotMatch(app, /from 'three'/);
  assert.match(app, /installBuildingMassing/);
  assert.ok(featureKeys({ properties: { id: 'icon-a', osm_id: 12 }, id: 12 }).includes('12'));
});
