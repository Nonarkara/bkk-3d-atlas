import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { trafficSummary, installTrafficPilot, withDeadline, runtimeReady } from '../public/traffic-vision.js';
import { validatePhotoSet, loadValidatedPhotoSet } from './photo-intake.mjs';
import { candidateOutput, publishCandidate } from './reconstruction-output.mjs';

test('traffic pilot excludes people, weak scores and malformed boxes', () => {
  const valid = { class: 'car', score: 0.9, bbox: [10, 10, 20, 20] };
  const result = trafficSummary([valid, {...valid, class:'person'}, {...valid, score:0.3}, {...valid, bbox:[NaN,0,5,5]}, {...valid,bbox:[200,0,5,5]}, {...valid,bbox:[0,0,-1,5]}],100,100);
  assert.equal(result.total,1); assert.equal(result.captureTime,null);
  assert.equal(result.tier,'experimental'); assert.equal(result.counts.person,undefined);
});
test('zero detections remain experimental, not a road clearance verdict', () => {
  const result=trafficSummary([],320,240);
  assert.equal(result.total,0); assert.equal(result.safe,undefined);
  assert.throws(()=>trafficSummary([],0,240));
});
test('ordinary camera wall never loads traffic model or needs DOM access', () => {
  assert.doesNotThrow(()=>installTrafficPilot(null)());
});
test('a truthy partial TensorFlow global is not a ready detector runtime', () => {
  assert.equal(runtimeReady({}),false);
  assert.equal(runtimeReady({browser:{fromPixels(){}}}),false);
  assert.equal(runtimeReady({loadGraphModel(){},browser:{fromPixels(){}}}),true);
});
test('release URLs invalidate both the entry module and its changed CV import', async () => {
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/src="\/app\.js\?v=twin-audit-20261015-2"/);
  assert.match(app,/traffic-vision\.js\?v=twin-audit-20261015-2/);
});
test('photo intake rejects small sets and verifies hashes before reconstruction', async () => {
  const dir=await mkdtemp(join(tmpdir(),'bkk-photo-intake-'));
  const path=join(dir,'manifest.json');
  try {
    await writeFile(path,JSON.stringify({landmark:'wat-arun',photos:[]}));
    await assert.rejects(validatePhotoSet(path),/at least 20/);
    const photos=[];
    for(let i=0;i<20;i++) {
      const bytes=Buffer.from(`test intake bytes ${i}`),file=`sample-${i}.jpg`;
      await writeFile(join(dir,file),bytes);
      photos.push({file,author:'Test',source:'https://example.org/photo',license:'CC-BY-4.0',sha256:createHash('sha256').update(bytes).digest('hex')});
    }
    const manifest={landmark:'wat-arun',photos,coverageReviewed:true,licenseReviewed:true};
    await writeFile(path,JSON.stringify(manifest));
    assert.equal((await validatePhotoSet(path)).status,'intake-valid-not-reconstructed');
    const approved=await loadValidatedPhotoSet(path);
    await writeFile(path,JSON.stringify({photos:[]}));
    assert.equal(approved.photos.length,20,'approved snapshot survives manifest replacement');
    assert.equal(approved.photos[0].sha256,photos[0].sha256);
    assert.ok(Object.isFrozen(approved.photos[0]));
    manifest.coverageReviewed='false';
    await writeFile(path,JSON.stringify(manifest));
    await assert.rejects(validatePhotoSet(path),/Human review/);
    manifest.coverageReviewed=true;
    const original=manifest.photos[1]; manifest.photos[1]=manifest.photos[0];
    await writeFile(path,JSON.stringify(manifest));
    await assert.rejects(validatePhotoSet(path),/Duplicate/);
    manifest.photos[1]=original;
    manifest.photos[0].sha256='0'.repeat(64);
    await writeFile(path,JSON.stringify(manifest));
    await assert.rejects(validatePhotoSet(path),/hash mismatch/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('candidate outputs reject public paths, parent aliases, files and dangling links', async () => {
  const dir=await mkdtemp(join(tmpdir(),'bkk-output-test-'));
  try {
    const publicDir=join(dir,'public'); await mkdir(publicDir);
    const alias=join(dir,'public-alias'); await symlink(publicDir,alias,'dir');
    await assert.rejects(candidateOutput(join(publicDir,'x.usdz'),publicDir),/outside/);
    await assert.rejects(candidateOutput(join(alias,'x.usdz'),publicDir),/outside/);
    const out=join(dir,'candidate.usdz'); await symlink(join(dir,'missing.usdz'),out);
    await assert.rejects(candidateOutput(out,publicDir),/exists/);
    await rm(out); await writeFile(out,'original');
    const candidate=join(dir,'reconstructed.usdz'); await writeFile(candidate,'candidate');
    await assert.rejects(publishCandidate(candidate,out,publicDir),/exists/);
    assert.equal(await readFile(out,'utf8'),'original');
    const fresh=join(dir,'fresh.usdz'); await publishCandidate(candidate,fresh,publicDir);
    assert.equal(await readFile(fresh,'utf8'),'candidate');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('deadline rejects a stuck task and consumes its late rejection', async () => {
  let reject;
  const task=new Promise((_r,r)=>{reject=r;});
  await assert.rejects(withDeadline(task,5),/timed out/);
  reject(new Error('late'));
  await new Promise(setImmediate);
});

test('closing and reopening cannot overlap inference; hiding invalidates pending results', async () => {
  const previousDocument=globalThis.document, previousWindow=globalThis.window;
  let finishModel, finishDetection, calls=0;
  const detector={detect:()=>{calls++; return new Promise(resolve=>{finishDetection=resolve;});}};
  const doc=new EventTarget(); doc.hidden=false;
  doc.createElement=tag=> tag==='canvas' ? {width:0,height:0,getContext:()=>({drawImage(){},getImageData(){}})} : {
    textContent:'',disabled:false,setAttribute(){},remove(){this.removed=true;},
    addEventListener(_type,fn){this.click=fn;},removeEventListener(){},
  };
  const root=()=>{
    const nodes=[];
    const tile={querySelector:selector=> selector==='img' ? {complete:true,naturalWidth:320,naturalHeight:240} : {append(...items){nodes.push(...items);}}};
    return {querySelectorAll:()=>[tile],nodes};
  };
  globalThis.document=doc;
  globalThis.window={tf:{loadGraphModel(){},browser:{fromPixels(){}}},cocoSsd:{load:()=>new Promise(resolve=>{finishModel=resolve;})}};
  try {
    const first=root(),closeFirst=installTrafficPilot(first,{enabled:true});
    const loading=first.nodes[0].click();
    await new Promise(setImmediate); closeFirst(); finishModel(detector); await loading;
    assert.equal(calls,0,'closed session never samples an image after model loading');
    const second=root(),closeSecond=installTrafficPilot(second,{enabled:true});
    const inference=second.nodes[0].click(); await new Promise(setImmediate);
    assert.equal(calls,1); closeSecond();
    const third=root(),closeThird=installTrafficPilot(third,{enabled:true});
    await third.nodes[0].click(); assert.match(third.nodes[1].textContent,/still running/);
    finishDetection([]); await inference;
    assert.equal(calls,1,'reopening cannot allocate another GPU task');
    const hidden=third.nodes[0].click(); await new Promise(setImmediate);
    doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));doc.hidden=false;
    finishDetection([]);await hidden;
    assert.match(third.nodes[1].textContent,/interrupted/);
    assert.doesNotMatch(third.nodes[1].textContent,/0 possible vehicles/);
    closeThird();
  } finally { globalThis.document=previousDocument; globalThis.window=previousWindow; }
});
