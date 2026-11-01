// A chedi drawn as a box at its spire height is a 40 m column in the Grand
// Palace. These footprints must be flagged so the map draws only a pad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { markSpires } from '../public/heritage-forms-layer.js';
import { heightFor } from '../public/building-heights.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8')).features;
const sacred = (p) => /เจดีย์|ปรางค์|มณฑป|ปราสาท|พระที่นั่ง/.test(p.name ?? '') && !/วิหาร|อุโบสถ/.test(p.name);

test('every Wat Phra Kaew and Wat Pho chedi is a pad, not a column', () => {
  const detail = read('bkk-heritage-detail.geojson');
  markSpires(detail, (p) => heightFor(p, 'oldtown').height, sacred);
  const chedis = detail.filter((f) => /มหาเจดีย์|พระเจดีย์ทรงเครื่อง|พระสุวรรณเจดีย์|พระศรีรัตนเจดีย์/.test(f.properties.name ?? ''));
  assert.ok(chedis.length >= 15);
  for (const f of chedis) assert.equal(f.properties.spire, true, f.properties.name);
});

test('halls and ordinary rows keep their boxes', () => {
  const detail = read('bkk-heritage-detail.geojson');
  markSpires(detail, (p) => heightFor(p, 'oldtown').height, sacred);
  const ubosot = detail.find((f) => f.properties.name === 'พระอุโบสถ' && f.properties.building === 'temple');
  assert.notEqual(ubosot.properties.spire, true);
  const flagged = detail.filter((f) => f.properties.spire);
  assert.ok(flagged.length < 60, `only slender named forms are flagged (${flagged.length})`);
  assert.ok(flagged.every((f) => f.properties.name), 'an unnamed building is never guessed into a spire');
});

test('landmark chedis are flagged too', () => {
  const kinds = new Set(['chedi', 'prasat', 'mondop', 'heritage', 'throne', 'ubosot', 'viharn']);
  const lm = read('bkk-landmarks.geojson');
  markSpires(lm, (p) => Number(p.height) || 12, (p) => kinds.has(p.kind));
  for (const f of lm.filter((x) => x.properties.kind === 'chedi')) assert.equal(f.properties.spire, true, f.properties.name);
});
