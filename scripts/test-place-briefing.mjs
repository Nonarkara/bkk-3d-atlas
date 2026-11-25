import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {placeBriefing,nearbyRoadReports,nearestCameras,locationEvidenceRows} from '../public/place-briefing.js';
const now=Date.parse('2026-10-15T06:00:00Z');
const at=minutes=>new Date(now-minutes*60000).toISOString();
test('nearby aggregates never conflate reference, last-good, zero or unknown',()=>{
  const civic={status:'reference',fetchedAt:at(2),count:1,places:[{name:'Test school',distanceM:120}]};
  const complaints={status:'stale',fetchedAt:at(120),value:{recent:0}};
  const data={version:1,query:{radiusM:800},civic,complaints};
  const [amenities,reports]=locationEvidenceRows(data,now).map(row=>row[1]);
  assert.match(amenities,/1 catalogued.*reference.*12:58 ICT.*Test school \(120 m\).*access and hours unverified/);
  assert.match(reports,/0 in the past 12 months.*Traffy Fondue.*last-good copy.*11:00 ICT/);
  for(const fetchedAt of [null,at(-1),at(7*1440)]) {
    const result=locationEvidenceRows({...data,complaints:{...complaints,fetchedAt}},now);
    assert.equal(result[0][1],amenities);
    assert.match(result[1][1],/count is unknown/);
  }
  assert.match(locationEvidenceRows(null,now)[0][1],/services are unknown/);
});
test('missing, future and stale evidence never gives an all-clear or dry forecast',()=>{
  for(const age of [31,-1,10000]) {
    const rows=placeBriefing(null,{city:{headEn:'ALL CLEAR',updated:at(age)},cityFreshness:{current:true},
      nearestGauge:{name:'Test',distanceKm:1,bandEn:'SAFE',observedAt:at(age===31?121:age)}},now);
    assert.doesNotMatch(JSON.stringify(rows),/ALL CLEAR|SAFE/);
    assert.match(JSON.stringify(rows),/passability unknown/);
    assert.match(JSON.stringify(rows),/Missing rain data does not mean dry/);
  }
  assert.match(JSON.stringify(placeBriefing(null,null,now)),/conditions here are unknown/);
  assert.doesNotMatch(JSON.stringify(placeBriefing(null,{nearestGauge:{bandEn:'SAFE',observedAt:'2026-10-15T06:00:00'}},now)),/SAFE/);
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
    massingFeatureAt:()=>null,pickBuildingFeature:()=>null,setInspectMarker(){},revealTask(){},resetLocationEvidence(){},
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
test('nearby evidence is opt-in and a superseded response cannot repaint the disclosure',async()=>{
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('let locationSelection'),source.indexOf('function renderPlaceEvidence'));
  const details={open:false};
  const output={replaceChildren(){this.rows=[];}};
  const pending=[];
  const ctx=vm.createContext({
    AbortController,AbortSignal,URLSearchParams,setTimeout,clearTimeout,
    document:{getElementById:id=>id==='atlas-location-evidence'?details:output},
    fillInspectDl:(el,rows)=>{el.rows=rows;},
    locationEvidenceRows:data=>data,
    fetch:(url,{signal})=>new Promise(resolve=>pending.push({url,signal,resolve})),
  });
  vm.runInContext(code,ctx);
  ctx.resetLocationEvidence({lat:13.75,lng:100.5});
  await ctx.readLocationEvidence(details);
  assert.equal(pending.length,0);
  details.open=true;
  const old=ctx.readLocationEvidence(details);
  ctx.resetLocationEvidence({lat:13.76,lng:100.6});
  assert.equal(pending[0].signal.aborted,true);
  details.open=true;
  const latest=ctx.readLocationEvidence(details);
  pending[1].resolve({ok:true,json:async()=>[['new']]});
  await latest;
  pending[0].resolve({ok:true,json:async()=>[['old']]});
  await old;
  assert.deepEqual(output.rows,[['new']]);
});
