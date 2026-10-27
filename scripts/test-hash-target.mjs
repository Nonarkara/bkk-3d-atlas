// A share link must work, or say so.
//
// The bug this covers: a visitor typed "#/yaowarat-chinatown" — a path-style
// hash, the kind a person writes by hand or another site builds — and the
// atlas read the id as "/yaowarat-chinatown", which matches no area.
// setActiveArea() then no-ops without a word: no error, no message, no
// navigation. The visitor lands on the opening view and concludes the link
// is broken. It was not broken; it was not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashTarget } from '../public/hash-target.js';
import { readFileSync } from 'node:fs';

const areas = JSON.parse(readFileSync(new URL('../public/bkk-areas.json', import.meta.url), 'utf8'));
const areaIds = new Set(areas.areas.map((a) => a.id));

test('a plain hash is the target', () => {
  assert.equal(hashTarget('#yaowarat-chinatown'), 'yaowarat-chinatown');
});

test('a path-style hash is the same target', () => {
  assert.equal(hashTarget('#/yaowarat-chinatown'), 'yaowarat-chinatown');
  assert.equal(hashTarget('#//yaowarat-chinatown'), 'yaowarat-chinatown');
});

test('a bare hash and an empty hash are nothing', () => {
  assert.equal(hashTarget('#'), '');
  assert.equal(hashTarget(''), '');
  assert.equal(hashTarget(), '');
  assert.equal(hashTarget(null), '');
});

test('the panes still read as panes', () => {
  assert.equal(hashTarget('#about'), 'about');
  assert.equal(hashTarget('#/research'), 'research');
});

test('whitespace is trimmed', () => {
  assert.equal(hashTarget('#  rattanakosin  '), 'rattanakosin');
});

test('every area is reachable by both spellings', () => {
  for (const id of areaIds) {
    assert.equal(hashTarget(`#${id}`), id);
    assert.equal(hashTarget(`#/${id}`), id);
  }
});

test('app.js reads the hash through the shared helper', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{ hashTarget \} from '\.\/hash-target\.js';/);
  // A hand-rolled strip in the app would drift from the helper.
  assert.doesNotMatch(app, /location\.hash\.slice\(1\)/, 'the app must read the hash through hashTarget()');
});
