import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('English uses self-hosted Jost before the retained Thai family', () => {
  assert.match(css, /--font-body: "Jost", "Sao Chingcha", sans-serif/);
  assert.match(css, /--font-display: "Jost", "Sao Chingcha", sans-serif/);
  for (const file of ['jost-latin-variable.woff2', 'jost-latin-ext-variable.woff2']) {
    const bytes = readFileSync(new URL(`../public/fonts/${file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    assert.ok(css.includes(`/fonts/${file}`));
  }
  assert.match(readFileSync(new URL('../public/fonts/Jost-OFL.txt', import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE/);
  assert.match(css, /sao-chingcha-700\.woff2[\s\S]*?font-weight: 700/);
});

test('interface emphasis tops out at semibold instead of heavy 700–900 cuts', () => {
  const rules = css.replace(/@font-face\s*\{[^}]*\}/g, '');
  assert.doesNotMatch(rules, /font-weight:\s*[789]00|font:\s*[789]00\s/);
  assert.match(rules, /strong, b \{ font-weight: 600; \}/);
});
