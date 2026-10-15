import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('../src/source-health.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { sourceHealth } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const now = Date.parse('2026-10-15T12:00:00Z');
const item = (age, extra = {}) => ({ key: 'test', last_run: new Date(now).toISOString(),
  last_ok: new Date(now - age * 60000).toISOString(), interval_ms: 6 * 3600000,
  failures: 0, last_error: null, ...extra });
test('six-hour feed stays healthy until two scheduled intervals are missed', () => {
  const result = sourceHealth({ items: [item(183), item(720), item(721)] }, now);
  assert.deepEqual(result.counts, { total: 3, ok: 2, stale: 1, degraded: 0, skipped: 0 });
  assert.equal(result.items[0].status, 'stale');
});
test('counts partition sources; missing/future success cannot turn green', () => {
  const result = sourceHealth({ items: [item(1), item(1, { failures: 1 }),
    item(1, { last_ok: null }), item(-1), item(1, { last_error: 'skipped: disabled' })] }, now);
  assert.deepEqual(result.counts, { total: 5, ok: 1, degraded: 1, stale: 2, skipped: 1 });
  assert.equal(Object.values(result.counts).slice(1).reduce((a,b) => a+b, 0), result.counts.total);
});
test('cached responses age without refreshing original timestamps', () => {
  const payload = { fetchedAt: new Date(now).toISOString(), items: [item(14, { interval_ms: 60000 })] };
  const first = sourceHealth(payload, now);
  const later = sourceHealth(first, now + 120000);
  assert.equal(first.items[0].status, 'ok');
  assert.equal(later.items[0].status, 'stale');
  assert.equal(later.items[0].age_min, 16);
  assert.equal(later.fetchedAt, payload.fetchedAt);
  assert.equal(payload.items[0].status, undefined);
  assert.equal(sourceHealth({items:[item(181, {interval_ms:null})]}, now).items[0].status,'stale');
});
