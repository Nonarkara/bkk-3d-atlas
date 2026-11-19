import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLandmarkInputs } from './audit-landmark-inputs.mjs';
const square = [[0,0],[3,0],[3,3],[0,3],[0,0]];
const notch = [[0,0],[3,0],[3,1],[1,1],[1,3],[0,3],[0,0]];
const feature = (rings, properties = {}) => ({type:'Feature',properties,geometry:{type:'Polygon',coordinates:rings}});
const collection = features => ({type:'FeatureCollection',features});

test('input audit preserves unknowns and a real zero roof height', () => {
  const r = auditLandmarkInputs(collection([feature([square],{'roof:height':0,'roof:shape':'  ','roof:material':null})]));
  assert.equal(r.fields['roof:height'],1);
  assert.equal(r.fields['roof:shape'],0);
  assert.equal(r.fields['roof:material'],0);
  assert.equal(r.status,'input-audit-not-reconstruction');
});
test('concavities and holes survive the input audit rather than becoming hulls', () => {
  const input = collection([feature([notch]),feature([square,[[1,1],[2,1],[2,2],[1,2],[1,1]]])]);
  const before = JSON.stringify(input);
  const r = auditLandmarkInputs(input);
  assert.equal(r.concaveOuterRings,1);
  assert.equal(r.partsWithHoles,1);
  assert.equal(JSON.stringify(input),before);
  assert.equal(auditLandmarkInputs(collection([feature([notch.slice().reverse()])])).concaveOuterRings,1);
});
test('multipolygons are counted by part; unsupported and malformed data stay explicit', () => {
  const r = auditLandmarkInputs(collection([{geometry:{type:'MultiPolygon',coordinates:[[square],[notch]]}},{geometry:{type:'Point',coordinates:[0,0]}}]));
  assert.equal(r.polygonParts,2);
  assert.equal(r.unsupportedFeatures,1);
  assert.throws(()=>auditLandmarkInputs(collection([feature([[[0,0],[1,0],[NaN,1],[0,0]]])])),/coordinates/);
  assert.throws(()=>auditLandmarkInputs({features:[]}),/FeatureCollection/);
});
