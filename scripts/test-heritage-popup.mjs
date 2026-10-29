import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe } from '../public/heritage-forms-layer.js';

const form = { kind: 'hall', name: 'พระอุโบสถ', confidence: 'named', base: 0, height: 12 };

test('external names and unknown kinds cannot become popup HTML', () => {
  const html = describe({...form, name: '<img src=x onerror=alert(1)>', kind: '<svg/onload=alert(1)>'});
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<svg'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;svg'));
  assert.ok(describe(form).includes('พระอุโบสถ'));
});

test('candidate metadata is escaped without stripping authored qualifications', () => {
  const html = describe({...form, kind:'shophouse', shophouse:{floors:'<i>2</i>', cluster:'<img src=x>', strength:'<script>x</script>'}});
  assert.ok(!/<(?:i|img|script)[ >]/.test(html));
  assert.ok(html.includes('<b>Unverified candidate.</b>'));
  assert.ok(html.includes('Not a designated heritage structure'));
});

test('named buildings do not claim surveyed materials or concave plans', () => {
  const html = describe(form);
  assert.ok(html.includes('not verified finishes'));
  assert.ok(html.includes('convex hull'));
  assert.ok(html.includes('courtyards and concavities are not reconstructed'));
});
