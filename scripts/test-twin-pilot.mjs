import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { trafficSummary, installTrafficPilot } from '../public/traffic-vision.js';
import { validatePhotoSet } from './photo-intake.mjs';

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
