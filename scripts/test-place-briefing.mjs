import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {placeBriefing,nearbyRoadReports,nearestCameras} from '../public/place-briefing.js';
const now=Date.parse('2026-10-15T06:00:00Z');
const at=minutes=>new Date(now-minutes*60000).toISOString();
test('missing, future and stale evidence never gives an all-clear or dry forecast',()=>{
  for(const age of [31,-1,10000]) {
    const rows=placeBriefing(null,{city:{headEn:'ALL CLEAR',updated:at(age)},cityFreshness:{current:true},
      nearestGauge:{name:'Test',distanceKm:1,bandEn:'SAFE',observedAt:at(age===31?121:age)}},now);
    assert.doesNotMatch(JSON.stringify(rows),/ALL CLEAR|SAFE/);
    assert.match(JSON.stringify(rows),/passability unknown/);
    assert.match(JSON.stringify(rows),/Missing rain data does not mean dry/);
  }
  assert.match(JSON.stringify(placeBriefing(null,null,now)),/conditions here are unknown/);
});
test('forecast is dated model output; zero survives and expired/missing data stays unknown',()=>{
  const weather={observationTimeUtc:at(10),hourlyNowcast:[{validAtUtc:at(-30),precipitationMm:0}]};
  assert.match(JSON.stringify(placeBriefing(null,null,now,weather)),/0 mm.*model, not observed flooding/);
  weather.hourlyNowcast[0].precipitationMm=null;
  assert.match(JSON.stringify(placeBriefing(null,null,now,weather)),/Rain amount unknown/);
  assert.match(JSON.stringify(placeBriefing(null,null,now+3*3600000,weather)),/Forecast unavailable or expired/);
});
test('nearby road reports expire, reject future and use line segments not just endpoints',()=>{
  const road=(minutes)=>({geometry:{type:'LineString',coordinates:[[100.49,13.75],[100.51,13.75]]},properties:{latest:at(minutes),road:'Test'}});
  const rows=nearbyRoadReports({features:[road(1),road(1441),road(-1)]},100.5,13.75,now);
  assert.equal(rows.length,1); assert.equal(rows[0].distanceM,0);
  assert.equal(nearbyRoadReports({features:[road(1)]},100.5,13.75,now+25*3600000).length,0);
  assert.equal(nearestCameras(null,100.5,13.75).length,0);
  assert.equal(nearestCameras({features:[{geometry:{type:'Point',coordinates:[101,14]}}]},100.5,13.75).length,0);
});
test('late response for a previous selection cannot overwrite the new place',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function runInspect('),source.indexOf('async function fetchRisk('));
  const elements=new Map();
  let release;
  const first=new Promise(r=>{release=r;});
  const sandbox={Date,AbortSignal,placeBriefing,inspectSequence:0,currentPlace:null,
    state:{cctvGeojson:null},document:{getElementById:id=>{
      if(!elements.has(id))elements.set(id,{hidden:false,replaceChildren(){},tagName:'DETAILS',scrollIntoView(){}});
      return elements.get(id);
    }},window:{matchMedia:()=>({matches:true})},
    massingFeatureAt:()=>null,pickBuildingFeature:()=>null,setInspectMarker(){},revealTask(){},
    fillInspectDl(){},buildingRowsFromFeature:()=>[],floodHitAt:async()=>null,
    fetchRisk:async lng=>Number(lng)===100.5?first:{live:{district:'new'}},
    fetch:async()=>({ok:false}),renderPlaceEvidence(){},nearestCameras:()=>[],
    liveFloodRows:()=>[],floodRiskRows:()=>[],FLOOD_DUTY:'not official'};
  const context=vm.createContext(sandbox);
  vm.runInContext(code,context);
  const older=context.runInspect({}, {lngLat:{lng:100.5,lat:13.75},point:{}});
  await context.runInspect({}, {lngLat:{lng:100.6,lat:13.75},point:{}});
  release({live:{district:'old'}}); await older;
  assert.equal(context.currentPlace.live.district,'new');
});
