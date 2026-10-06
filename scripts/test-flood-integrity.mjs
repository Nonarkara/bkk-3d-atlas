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
let buildRoadsXref, currentStreetReports, floodRoadsResponse, refreshFloodRoads, weatherSupport, unavailableHydroForecast;
try {
  for (const name of ['report-freshness', 'flooddash', 'floodroads', 'roads-xref', 'weather-support']) {
    const source = readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    writeFileSync(join(dir, `${name}.mjs`), compiled.replace(/from "\.\/([^".]+)"/g, 'from "./$1.mjs"'));
  }
  ({ buildRoadsXref } = await import(pathToFileURL(join(dir, 'roads-xref.mjs'))));
  ({ currentStreetReports, floodRoadsResponse, refreshFloodRoads } = await import(pathToFileURL(join(dir, 'floodroads.mjs'))));
  ({ weatherSupport, unavailableHydroForecast } = await import(pathToFileURL(join(dir, 'weather-support.mjs'))));
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

test('real model weather never turns rainfall into vehicle clearance or protection deadlines', async () => {
  const original=globalThis.fetch;
  const time=new Date().toISOString();
  globalThis.fetch=async()=>Response.json({current:{time,interval:900,temperature_2m:31,relative_humidity_2m:80,precipitation:0,wind_speed_10m:0},hourly:{time:[new Date(Date.now()+3600000).toISOString()],precipitation:[4],precipitation_probability:[70]}});
  try {
    const p=await (await weatherSupport(new Request('https://atlas.test/api/weather/google'))).json();
    assert.equal(p.tier,'model');assert.equal(p.weather.precipitationMm,0);
    assert.equal(p.hourlyNowcast[0].precipitationMm,4);
    for(const v of Object.values(p.lifeSafety.vehiclePassability))assert.equal(v.status,'unknown');
    assert.equal(p.livelihood.shophouseProtection.leadTimeHours,null);
    assert.equal(p.observationTimeUtc,time);
  }finally{globalThis.fetch=original;}
});

test('weather failures and invalid locations produce no fabricated fallback; hydro inference is unavailable',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('offline');};
  try{
    const invalid=await weatherSupport(new Request('https://atlas.test/api/weather/google?lat=999&lng=100.5'));assert.equal(invalid.status,400);assert.equal(calls,0);
    const p=await (await weatherSupport(new Request('https://atlas.test/api/weather/google'))).json();assert.equal(p.status,'unavailable');assert.equal(p.weather,null);assert.equal(p.hourlyNowcast.length,0);
    const h=await unavailableHydroForecast().json();assert.equal(h.model,null);assert.equal(h.stations.length,0);assert.equal(h.configured,false);
  }finally{globalThis.fetch=original;}
});

test('browser weather fallback uses real valid-time forecasts and preserves missing rainfall', async()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=app.indexOf('async function fetchBrowserWeather()'),end=app.indexOf('async function refreshSafetyModule()',start);
  const next=new Date(Date.now()+3600000).toISOString();
  const fn=vm.runInNewContext(app.slice(start,end)+'\nfetchBrowserWeather',{AbortSignal,fetch:async()=>({ok:true,json:async()=>({current:{time:new Date().toISOString()},hourly:{time:[next],precipitation:[null],precipitation_probability:[70]}})})});
  const p=await fn();assert.match(p.source,/direct browser fallback/);assert.equal(p.hourlyNowcast[0].precipitationMm,null);assert.equal(p.hourlyNowcast[0].validAtUtc,next);assert.equal(p.configured,undefined);
});

test('historical-envelope point summaries cannot imply present-day safe roads', () => {
  const source = readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
  const start = source.indexOf('  // Summary band —');
  const end = source.indexOf('async function atlasTransit',start);
  const js = ts.transpileModule('function pointSummary(){\n'+source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  for(const inside of [false,true]){
    const result = vm.runInNewContext(js+'\npointSummary()',{
      landPriceRow:null,nearestTransit:null,nearestWaterTransit:null,districtRow:null,lng:100.5,lat:13.75,
      ATLAS_API_VERSION:1,flood:{inside,top:inside?{severity:'high'}:null},jsonResponse:body=>body,
    });
    assert.equal(result.summary.floodBand,inside?'high':'unassessed');
    assert.equal(result.summary.roadPassability,'unknown');
    assert.equal(result.summary.floodBandBasis,'historical-schematic-envelope');
    assert.match(result.disclaimer,/not dry or safe/);
  }
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  assert.doesNotMatch(html,/Confirmed · report \+ nearby gauge/);
});

test('missing wind values are unknown, while a genuine calm model field remains zero', async () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('function weatherNumber(');
  const end = app.indexOf('\nfunction ', app.indexOf('async function fetchWindGrid()', start));
  let current;
  const fetchGrid = vm.runInNewContext(app.slice(start, end) + '\nfetchWindGrid', {
    WIND_API: 'https://example.test', windCompass: () => 'N', windArrowGeometry: () => ({}),
    fetch: async () => ({ ok: true, json: async () => ({latitude:13.75,longitude:100.5,current}) }),
  });
  for (const bad of [null, '', ' ', false, [], {}, -1]) {
    current = {wind_speed_10m:bad,wind_direction_10m:0,wind_gusts_10m:null};
    assert.equal(await fetchGrid(), null, String(bad));
  }
  current = {wind_speed_10m:0,wind_direction_10m:0,wind_gusts_10m:null};
  const calm = await fetchGrid();
  assert.equal(calm.features[0].properties.speedKmh,0);
  assert.equal(calm.features[0].properties.gustKmh,null);
  current.wind_direction_10m = null;
  assert.equal(await fetchGrid(),null);
});

test('weather KPIs never turn missing or negative rainfall into dry readings', async () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function weatherNumber(');
  const end = source.indexOf('// ──', source.indexOf('async function proxyBkkRainKpi',start));
  const js = ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  let rows = [];
  const fn = vm.runInNewContext(js+'\nproxyBkkRainKpi',{
    BKK_RAIN1D_URL:'rain',BKK_RAIN3D_URL:'rain',BKK_RAIN7D_URL:'rain',BKK_TEMP_URL:'temp',BKK_WATER_CACHE_TTL_SECONDS:300,
    Response,fetchThaiwaterJson:async url=>({ok:true,data:{data:url==='temp'?[{max_temperature:null,min_temperature:'',start_date:'2026-09-28'}]:rows}}),
  });
  rows=[{rain_1d:null},{rain_1d:''},{rain_1d:-1},{rain_1d:false}];
  const missing=await (await fn({})).json();
  assert.equal(missing.rain['1d'].mm,null);
  assert.equal(missing.temperature.max_c,null);
  assert.equal(missing.temperature.min_c,null);
  rows.push({rain_1d:0});
  const zero=await (await fn({})).json();
  assert.equal(zero.rain['1d'].mm,0);
});

test('weekly temperature rendering shows missing values as unknown and retains its period', () => {
  const app = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const helperStart = app.indexOf('function weatherNumber(');
  const helperEnd = app.indexOf('async function fetchWindGrid',helperStart);
  const start = app.indexOf('    const temp = kpi.temperature;');
  const end = app.indexOf('    // Freshness',start);
  const elements = new Map();
  const document = {getElementById:id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id);}};
  vm.runInNewContext(app.slice(helperStart,helperEnd)+app.slice(start,end),{document,kpi:{temperature:{max_c:null,min_c:0,station:'Station',start_date:'2026-09-28'}}});
  assert.equal(elements.get('bkk-card-temp-max').textContent,'—');
  assert.equal(elements.get('bkk-card-temp-min').textContent,'0.0');
  assert.match(elements.get('bkk-card-temp-where').textContent,/week from 2026-09-28/);
});

test('camera provenance uses exact known labels, not agency-name fragments', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const MAHOLAN_OPERATOR_SOURCES =');
  const end = source.indexOf('async function proxyMaholanCctv', start);
  const classify = vm.runInNewContext(source.slice(start, end) + '\n(s) => MAHOLAN_OPERATOR_SOURCES.has(String(s || "").trim().toLowerCase())');
  for (const s of ['iTIC', 'สำนักการระบายน้ำ กทม.', ' BMA/สจส (via world.tehx) ']) assert.equal(classify(s), true);
  for (const s of ['', null, 'ผู้ใช้เพิ่มเอง', 'unofficial BMA mirror', 'private เทศบาล webcam', 'world.tehx.fake']) assert.equal(classify(s), false, String(s));
});

test('cache uses relay fetch age, preserves observation age and survives null or thrown producers', async () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function withD1Cache');
  const end = source.indexOf('// Parse a single-range', start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cache = vm.runInNewContext(js + '\nwithD1Cache', { console });
  const row = { payload: '{"lastGood":true}', fetched_at: at(25), attempted_at: new Date().toISOString() };
  let calls = 0;
  const env = { CIVIC_DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } };
  const hit = await cache(env, 'test', 300, async () => { calls++; return null; });
  assert.equal(calls, 0);
  assert.equal(hit.fetchedAt, row.fetched_at);
  row.attempted_at = at(25);
  for (const producer of [async () => null, async () => { throw new Error('invalid JSON'); }]) {
    const fallback = await cache(env, 'test', 300, producer);
    assert.equal(fallback.payload.lastGood, true);
    assert.equal(fallback.fetchedAt, row.fetched_at);
  }
  row.payload = 'corrupt';
  assert.equal(await cache(env, 'test', 300, async () => { throw new Error('offline'); }), null);
});

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
