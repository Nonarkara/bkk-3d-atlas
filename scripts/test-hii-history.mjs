import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseCsv,summarize} from './build-hii-history.mjs';
import {historyFeatures} from '../public/hii-history.js';
const boundaryBytes=readFileSync(new URL('../public/bkk-districts.geojson',import.meta.url));
const boundaries=JSON.parse(boundaryBytes);
const data=JSON.parse(readFileSync(new URL('../public/bkk-hii-history.json',import.meta.url)));

test('50 khet remain unchanged in geometry and have a one-to-one HII code bridge',()=>{
  assert.equal(boundaries.features.length,50);assert.equal(data.districts.length,50);
  assert.equal(new Set(data.districts.map(d=>d.code)).size,50);
  assert.equal(data.boundarySha256,createHash('sha256').update(boundaryBytes).digest('hex'));
  assert.equal(data.bangkokRowCount,352);assert.equal(data.reportedSubdistrictCount,158);
  let low=0,medium=0,high=0;
  for(const d of data.districts){assert.match(d.code,/^10\d{2}$/);for(const m of Object.values(d.months)){low+=m.low;medium+=m.medium;high+=m.high;}}
  assert.deepEqual([low,medium,high],[329,23,0]);
  assert.match(data.license,/Non-Commercial/);assert.match(data.caveat,/not live/);
  assert.ok(boundaries.features.every(f=>f.properties.hii_risk===undefined),'legacy inferred district labels retired');
});
test('missing months never become dry, low risk or live; actual geometry is preserved',()=>{
  const before=JSON.stringify(boundaries);
  const january=historyFeatures(data,boundaries,1);
  assert.ok(january.features.every(f=>f.properties.maxReportedBand==='unassessed'));
  for(const month of [6,9,10,11,12]){
    const fc=historyFeatures(data,boundaries,month);
    fc.features.forEach((f,i)=>assert.deepEqual(f.geometry,boundaries.features[i].geometry));
    assert.ok(fc.features.some(f=>f.properties.reportedSubdistricts>0));
  }
  const october=historyFeatures(data,boundaries,10);
  assert.equal(october.features.reduce((n,f)=>n+f.properties.reportedSubdistricts,0),92);
  assert.equal(JSON.stringify(boundaries),before);
  assert.throws(()=>historyFeatures(data,boundaries,13));
  assert.throws(()=>historyFeatures({...data,districts:[]},boundaries,10),/bridge mismatch/);
});
test('CSV parsing supports quoted commas, BOM and fails on malformed input',()=>{
  assert.equal(parseCsv('\uFEFFGEOCODE,NAME\r\n100101,"name, with comma"\r\n')[0].NAME,'name, with comma');
  assert.throws(()=>parseCsv('GEOCODE,NAME\n100101,"broken'));
  assert.throws(()=>parseCsv('OTHER\n1'));
  assert.throws(()=>summarize([{PROV_CODE:'10',AMPHOE_CODE:'1001',GEOCODE:'100201'}],boundaries),/parent code mismatch/);
});
