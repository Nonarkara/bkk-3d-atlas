// Guards for the header's spatial hallucinations.
//
// Every check here is scoped to code, and every one of them was mutation
// tested: break the thing, the test must fail.
//
// The rendered evidence lives in scripts/msh-audit.mjs. This file is the
// gate that runs without a browser, so the shapes it checks are the ones
// that must never come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('the masthead carries no static feature list', () => {
  // It used to read "432,077 buildings · boats + rail · CCTV · flood sensors
  // · traffic · wind · AQI · rain radar" — 656px of text in a 493px slot, so
  // it was cut with an ellipsis AND it pushed the live presence counter out
  // of sight. The scope claims live in the About panel, the quick jump and
  // the page description instead.
  const meta = html.match(/<div class="atlas-header-meta">([\s\S]*?)<\/div>/);
  assert.ok(meta, 'the header meta block is gone');
  const small = meta[1].match(/<small>([\s\S]*?)<\/small>/);
  assert.ok(small, 'the header no longer has a slot for the live counter');
  const text = small[1].replace(/<[^>]+>/g, '').trim();
  assert.equal(text, '', `the header slot still carries static text: "${text}"`);
  assert.match(small[1], /id="atlas-presence"/, 'the live presence counter must stay');
});

test('the header has no dead eyebrow', () => {
  // It said "BKKx · Bangkok, live · Flood edition" above an h1 that said
  // "Bangkok, live, flood edition" — the same sentence twice — and it was
  // hidden at every width, so it was dead markup.
  const meta = html.match(/<div class="atlas-header-meta">([\s\S]*?)<\/div>/);
  assert.doesNotMatch(meta[1], /atlas-eyebrow/, 'the dead eyebrow is back');
});

test('the phone title is a word that fits, not a phrase that gets cut', () => {
  // At 390px the grid left the title 155px and the phrase needed 174px, so
  // it read "Bangkok · live · Flood e…". A cut word is worse than a short
  // one: the space is paid for and nothing is delivered.
  const phone = html.match(/<span class="atlas-title-phone">([^<]*)<\/span>/);
  assert.ok(phone, 'the phone title variant is gone');
  const text = phone[1].trim();
  assert.ok(text.length > 0, 'the phone title is empty');
  assert.ok(
    text.length <= 12,
    `the phone title "${text}" is ${text.length} characters — it will be cut at 390px`,
  );
  assert.ok(!/…|\.\.\./.test(text), 'the phone title ships an ellipsis');
});

test('the headline toggle is styled at every width, not only on a phone', () => {
  // The rule lived inside @media (max-width: 720px), so on a desktop the
  // button rendered as a raw native button: white box, grey border, system
  // font, in a dark panel.
  const rules = [...css.matchAll(/\.atlas-news-watch-more\s*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(rules.length >= 1, 'the headline toggle has no style at all');

  // A rule is at the top level when the braces before it are balanced.
  const atTopLevel = rules.some((rule) => {
    const i = css.indexOf(rule);
    let depth = 0;
    for (const ch of css.slice(0, i)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    return depth === 0;
  });
  assert.ok(atTopLevel, 'the headline toggle is still only styled inside a media query');

  const base = rules.find((rule) => {
    const i = css.indexOf(rule);
    let depth = 0;
    for (const ch of css.slice(0, i)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    return depth === 0;
  });
  assert.match(base, /background:/, 'the toggle must not fall back to the native button');
  assert.match(base, /color:/, 'the toggle must not fall back to the native button');
  assert.match(base, /border:/, 'the toggle must not fall back to the native button');
});

test('the headline toggle says it once', () => {
  // The pseudo-elements were left over from a version with no text of its
  // own, and the button printed "Show all  Show all headlines  headlines".
  assert.doesNotMatch(
    css,
    /atlas-news-watch-more::(before|after)/,
    'the pseudo-element duplication is back',
  );
});

test('the toggle only appears when there is something to show', () => {
  // On a desktop the list is never collapsed, so the button was a control
  // that looked clickable and did nothing. The rule that hides it has to be
  // a TOP-LEVEL one: inside a phone media query it never applies on a
  // desktop, and the dead button comes back.
  const rules = [...css.matchAll(
    /\.atlas-news-watch-list:not\(\.atlas-news-watch-list-collapsed\)\s*~\s*\.atlas-news-watch-more\s*\{[^}]*\}/g,
  )].map((m) => m[0]);
  assert.ok(rules.length >= 1, 'nothing hides the dead toggle');
  const topLevel = rules.filter((rule) => {
    const i = css.indexOf(rule);
    let depth = 0;
    for (const ch of css.slice(0, i)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    return depth === 0;
  });
  assert.ok(topLevel.length >= 1, 'the dead toggle is hidden only inside a phone media query');
  assert.match(topLevel[0], /display:\s*none/, 'the dead toggle is visible again on a desktop');
});
