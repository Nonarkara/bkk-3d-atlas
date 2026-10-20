// The scroll strips must say they scroll.
//
// The lens strip is 606px of content in a 288px box on a 360px phone. Five of
// its nine buttons sit past the right edge, and because the scrollbar is
// hidden (scrollbar-width: none) there was no cue at all that "Rain now",
// "Cameras", "Live pulse" and "Satellite air" existed. That is the accidental-
// wrapping failure mode: the strip does not wrap, it just truncates in
// silence.
//
// The fix is a fade on the edge that still has content behind it, driven by
// real scroll state. These tests hold that in place.
//
// The source is stripped of comments before matching. A guard that greps for
// "dataset.peek" is satisfied by a comment that says "we set dataset.peek",
// and that failure has happened in this repo before — in code, in a different
// harness, on the same class of mistake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
const JS = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

/**
 * Remove comments while leaving string literals alone.
 *
 * A naive /\/\/.*$/ would eat "https://atlas.nonarkara.org" and the guard
 * would then pass or fail for the wrong reason.
 */
function stripComments(source, kind) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (kind === 'css' && c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    if (kind === 'js' && c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      out += ' ';
      continue;
    }
    if (kind === 'js' && c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const CSS_CODE = stripComments(CSS, 'css');
const JS_CODE = stripComments(JS, 'js');

/**
 * The body of one function, so a guard cannot be satisfied by an unrelated
 * occurrence elsewhere in a 9,000-line file. Mutation testing proved that
 * necessary: asserting "/ResizeObserver/ appears in app.js" passed after the
 * observer was deleted, because three other places in the file use one.
 */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is not defined`);
  let depth = 0;
  let i = source.indexOf('{', start);
  for (let j = i; j < source.length; j += 1) {
    if (source[j] === '{') depth += 1;
    else if (source[j] === '}') { depth -= 1; if (depth === 0) return source.slice(i + 1, j); }
  }
  throw new Error(`unterminated ${name}`);
}

const PEEK = functionBody(JS_CODE, 'wireScrollPeek');

test('every scroll state has a fade, in both vendor spellings', () => {
  for (const state of ['right', 'left', 'both']) {
    for (const selector of ['.atlas-place-tasks', '#atlas-stack-presets']) {
      const rule = new RegExp(`${selector.replace('.', '\\.')}\\[data-peek="${state}"\\][^{]*\\{[^}]*\\}`);
      assert.ok(rule.test(CSS_CODE), `${selector} has no rule for data-peek="${state}"`);
    }
  }
  // A mask that only exists for one engine is a mask that does not exist.
  assert.ok(CSS_CODE.includes('-webkit-mask-image'), 'no -webkit-mask-image fallback');
  assert.ok(CSS_CODE.includes('mask-image'), 'no standard mask-image');
});

test('the fade is sized to the overflow it signals, not a fixed width', () => {
  // A strip clipped by 11px should not get a 28px fade: the cue would dim more
  // of the control than the clipping actually hides.
  assert.ok(/--peek-fade/.test(PEEK), 'the fade width is never computed');
  assert.ok(
    /setProperty\(\s*["']--peek-fade["']/.test(PEEK),
    'the fade width is never set on the element',
  );
});

test('the peek state comes from real scroll position, and only then', () => {
  // The scroll-state assignment specifically. Asserting only that "dataset.peek
  // is assigned somewhere" passed after this line was commented out, because
  // the "none" branch still assigns it.
  assert.ok(
    /dataset\.peek\s*=\s*atStart\s*\?\s*["']right["']\s*:\s*atEnd\s*\?\s*["']left["']\s*:\s*["']both["']/.test(PEEK),
    'the scroll state is not turned into a peek state',
  );
  assert.ok(/scrollLeft/.test(PEEK), 'the peek state ignores where the strip is scrolled to');
  // A strip that fits must not be faded at all.
  assert.ok(/["']none["']/.test(PEEK), 'there is no state for a strip that fits');
});

test('the wire-up runs, on both strips, and survives a resize', () => {
  assert.ok(/wireScrollPeek\(\)/.test(JS_CODE), 'wireScrollPeek is never called');
  assert.ok(/\.atlas-place-tasks/.test(PEEK), 'the lens strip is not watched');
  assert.ok(/atlas-stack-presets/.test(PEEK), 'the panel preset strip is not watched');
  // Fonts and images land after the first paint, so the widths can change.
  assert.ok(/ResizeObserver/.test(PEEK), 'the cue is not recomputed when the strip resizes');
});
