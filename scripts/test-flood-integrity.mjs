import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';

// Compile the real modules with the installed compiler; no runner dependency.
const dir = mkdtempSync(join(tmpdir(), 'atlas-flood-test-'));
let buildRoadsXref, currentStreetReports, floodRoadsResponse, refreshFloodRoads;
try {
  for (const name of ['report-freshness', 'flooddash', 'floodroads', 'roads-xref']) {
    const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    writeFileSync(join(dir, `${name}.mjs`), compiled.replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"'));
  }
  ({ buildRoadsXref } = await import(pathToFileURL(join(dir, 'roads-xref.mjs'))));
  ({ currentStreetReports, floodRoadsResponse, refreshFloodRoads } = await import(pathToFileURL(join(dir, 'floodroads.mjs'))));
} finally { rmSync(dir, { recursive: true, force: true }); }

const now = Date.parse('2026-10-01T09:00:00Z');
const at = hours => new Date(now - hours * 3600000).toISOString();
const road = (hours = 1, closed = false) => ({
  type: 'Feature', geometry: { type: 'LineString', coordinates: [[100.5, 13.75], [100.501, 13.75]] },
  properties: { road: 'Test road', n: 1, traffy: 1, latest: at(hours), depth: 4, depthEn: 'knee', closed },
});
const roads = (features = [road()]) => ({
  tool: 'flood-roads', version: 1, fetchedAt: at(0), windowH: 24, sources: {},
  counts: { stretches: features.length, closed: 0, heatCells: 0, unplacedDds: 0 },
  roads: { type: 'FeatureCollection', features }, heat: { type: 'FeatureCollection', features: [] },
  unplacedDds: [], areas: [], hourly: [], rainTrend: null,
});
const gauge = (change = {}) => ({ id: 'g1', lng: 100.5, lat: 13.75, band: 'prepare', name: 'Canal', confidence: 'high', observedAt: at(0.1), ageMin: 6, ...change });
const xref = (g, features) => buildRoadsXref(roads(features), { gauges: [g] }, now);

test('unknown, future, absent and stale observations cannot provide fresh gauge context', () => {
  for (const change of [
    { observedAt: null }, { observedAt: 'invalid' }, { observedAt: at(-1) },
    { observedAt: at(1), ageMin: 1 }, { ageMin: 60 }, { ageMin: -20 },
    { confidence: 'absent' }, { confidence: 'stale' }, { confidence: 'medium' },
  ]) {
    const result = xref(gauge(change));
    assert.equal(result.counts.confirmed, 0, JSON.stringify(change));
    assert.equal(result.sensorOnly.length, 0, JSON.stringify(change));
  }
});

test('nearby gauge context expires with observation age, and makes no road-passability claim', () => {
  const state = { gauges: [gauge()] };
  const result = buildRoadsXref(roads(), state, now);
  assert.equal(result.counts.confirmed, 1);
  assert.match(result.credit, /does not verify road flooding/);
  assert.equal(buildRoadsXref(roads(), state, now + 46 * 60000).counts.confirmed, 0);
  const withoutAlert = xref(gauge({ band: 'safe' }));
  assert.equal(withoutAlert.counts.confirmed, 0);
  assert.equal(withoutAlert.unconfirmed[0].passable, undefined);
});

test('old roads do not suppress sensor-only context; expired and future reports leave the active window', () => {
  const result = xref(gauge(), [road(7), road(25), road(-1)]);
  assert.equal(result.counts.confirmed, 0);
  assert.equal(result.counts.total_roads, 1);
  assert.equal(result.counts.sensor_only, 1);
});

test('cached resident reports expire and completed tickets stop counting during outages', () => {
  const reports = [1, 25, -1].map((h, i) => ({ id: String(i), t: at(h), lat: 13.75, lng: 100.5, depth: null, done: false }));
  reports.push({ ...reports[0], id: 'done', done: true });
  assert.deepEqual(currentStreetReports(reports, now).map(r => r.id), ['0']);
  assert.equal(currentStreetReports(reports, now + 26 * 3600000).length, 0);
});

test('cached API responses age individual roads and recompute closure counts', async () => {
  const state = roads([road(1), road(25, true), road(-1, true)]);
  const result = await floodRoadsResponse(state, now).json();
  assert.equal(result.roads.features.length, 1);
  assert.equal(result.counts.stretches, 1);
  assert.equal(result.counts.closed, 0);
  assert.equal(result.fetchedAt, state.fetchedAt);
});

test('heat observations also expire without changing the snapshot timestamp', async () => {
  const state = roads();
  state.heat.features = [1, 25, -1].map(h => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [100.5, 13.75] }, properties: { latest: at(h), w: 1 } }));
  const result = await floodRoadsResponse(state, now).json();
  assert.equal(result.heat.features.length, 1);
  assert.equal(result.counts.heatCells, 1);
  assert.equal(result.fetchedAt, state.fetchedAt);
});

test('outages invalidate current aggregate claims and expire unplaced DDS reports', async () => {
  const state = roads([road(25)]);
  state.fetchedAt = at(25);
  state.areas = [{ n3h: 1 }];
  state.hourly = [{ traffy: 1, itic: 0 }];
  state.unplacedDds = [{ floodedAt: at(25) }];
  const result = await floodRoadsResponse(state, now).json();
  assert.equal(result.areas, null);
  assert.equal(result.hourly, null);
  assert.equal(result.aggregatesAvailable, false);
  assert.equal(result.unplacedDds.length, 0);
  assert.equal(result.counts.unplacedDds, 0);
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function renderSituation(');
  const end = app.indexOf('function renderRoadsXref(', start);
  const elements = new Map();
  const document = { getElementById: id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: 'old totals', textContent: '1', dataset: {} });
    return elements.get(id);
  } };
  vm.runInNewContext(app.slice(start, end) + '\nrenderSituation(payload)', { document, payload: result, minutesSince: () => 1500, ageWords: () => '25h', state: {} });
  assert.match(elements.get('atlas-sit-areas').innerHTML, /not an all-clear/);
  assert.equal(elements.get('atlas-sit-pulse-n').textContent, '—');
  assert.equal(elements.get('atlas-sit-pulse-bars').innerHTML, '');
});

test('failed Traffy refresh does not resurrect old tickets in roads, heat or source counts', async () => {
  const clock = Date.now();
  const kept = [{ id: 'old', t: new Date(clock - 25 * 3600000).toISOString(), lat: 13.75, lng: 100.5, depth: 'knee', done: false }];
  const values = new Map([['bkk-traffy', { payload: JSON.stringify(kept), fetched_at: at(25) }]]);
  const env = {
    CIVIC_DB: { prepare: () => ({ bind: (...args) => ({ first: async () => values.get(args[0]) ?? null, run: async () => { values.set(args[0], { payload: args[1], fetched_at: args[2] }); } }) }) },
    ASSETS: { fetch: async () => Response.json({ origin: { lng: 100, lat: 13 }, cell: 0.1, cells: [] }) },
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('upstream offline'); };
  try {
    const result = await refreshFloodRoads(env, { flood: null, districts: null, news: async () => [] }, { force: true });
    assert.equal(result.sources.traffy.ok, false);
    assert.equal(result.sources.traffy.count, 0);
    assert.equal(result.counts.stretches, 0);
    assert.equal(result.counts.heatCells, 0);
  } finally { globalThis.fetch = original; }
});

test('scenario playback shows no invented depth, road count or dated river forecast', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('const SIM_PHASES =');
  const end = app.indexOf('function start72hSimulation', start);
  assert.ok(start >= 0 && end > start);
  const elements = new Map();
  const document = { getElementById: id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', style: {}, setAttribute: (k, v) => { elements.get(id)[k] = v; } });
    return elements.get(id);
  } };
  vm.runInNewContext(app.slice(start, end) + '\nfor (const phase of SIM_PHASES) updateSimHud(phase.fromH, phase, phase.fromH / 72);', { document });
  for (const id of ['depth', 'roads', 'river']) assert.equal(elements.get(`atlas-sim-metric-${id}`).textContent, 'Not calculated');
  assert.equal(elements.get('atlas-sim-date').textContent, 'Scenario time · illustrative');
  assert.equal(elements.get('atlas-sim-progressbar')['aria-valuenow'], '52');
});

test('road-layer status distinguishes relay age, report window and failed sources', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function floodRoadsAgeText(');
  const end = app.indexOf('function openFloodRoadPopup', start);
  const context = { minutesSince: () => 2, ageWords: n => `${n}m`, payload: { windowH: 24, sources: { traffy: { ok: false, count: 900, error: 'timeout' }, itic: { ok: true, error: null } } } };
  const status = vm.runInNewContext(app.slice(start, end) + '\nfloodRoadsAgeText(payload)', context);
  assert.match(status, /relay 2m ago/);
  assert.match(status, /last 24 h/);
  assert.match(status, /check source: traffy/);
});
