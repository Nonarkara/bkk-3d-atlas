// Render check: does each layer actually draw?
//
// "The layer is present" and "the layer draws" are different claims, and a
// whole class of bug lives in between. The heritage forms layer shipped 1,080
// buildings, installed without error, passed every unit test — and drew
// nothing, because one throw inside requestAnimationFrame killed the pump.
//
// This drives a real browser and asks the only question that settles it:
// hide the layer, capture, restore, capture, compare pixels. A layer that
// changes nothing is reported, not assumed fine.
//
// Requires a Chrome already running with --remote-debugging-port. Set
// CHROME_DEBUG_PORT if it is not 9573. Exits non-zero if any layer that is
// expected to be visible draws no pixels.
//
// The percentage is a threshold, not a metric. A wider window at the same
// zoom/pitch shows more map around the same buildings, so the same layer
// measures differently: bkkx-heritage-forms reads 1.83% at 756x469 and 0.66%
// at 1600x1000. Both are far above noise and both mean the same thing. Do not
// read a change in this number as a regression without re-running on the same
// window — compare against the measured noise floor, not a previous run.
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PORT = process.env.CHROME_DEBUG_PORT || '9573';
const URL = process.env.ATLAS_URL || 'https://atlas.nonarkara.org';
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/atlas-render-check';

// Layers that must contribute pixels at this view, with the camera parked on
// the Old Town where the custom 3D layers live.
const VIEW = { center: [100.4928, 13.7518], zoom: 16.4, pitch: 52, bearing: -25 };
// Ids must match the constants in the source. A typo here reports MISSING and
// looks like a broken layer, which is how one round of this check "found" a
// bug that was a mistyped id.
// `expect` states what the layer is supposed to be doing. The roof pilot is
// deliberately hidden while the forms layer is up — it covers the same two
// buildings with flatter geometry, and drawing both gives Wat Phra Kaew two
// roofs. Without that note the check reports a failure every run, and a check
// that always cries wolf is a check people learn to skip.
const LAYERS = [
  { id: 'bkkx-heritage-forms' },
  { id: 'bkkx-building-massing' },
  { id: 'bkkx-heritage-roofs-3d', expect: 'hidden', why: 'the forms layer supersedes the 2-building roof pilot' },
  { id: 'bkkx-rattanakosin-buildings' },
  { id: 'bkkx-landmarks-extrusion' },
];

function die(message, code = 2) {
  process.exitCode = code;
  throw new Error(`render-check: ${message}`);
}

let version;
try {
  version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
} catch {
  die(`no Chrome on 127.0.0.1:${PORT}. Start Chrome with --remote-debugging-port, or set CHROME_DEBUG_PORT.`);
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve: r, reject: j } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result);
    }
  });
  return {
    ready: new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    }),
    send(method, params = {}, sessionId) {
      const mid = ++id;
      const payload = { id: mid, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((r, j) => { const to = setTimeout(() => { pending.delete(mid); j(new Error(`${method} did not answer in 120s`)); }, 120000); pending.set(mid, { resolve: (v) => { clearTimeout(to); r(v); }, reject: (e) => { clearTimeout(to); j(e); } }); })
    },
    close: () => ws.close(),
  };
}

const browser = connect(version.webSocketDebuggerUrl);
await browser.ready;
let ownedTarget;
try {
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
ownedTarget = targetId;
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
await browser.send('Page.enable', {}, sessionId);
await browser.send('Runtime.enable', {}, sessionId);
await browser.send('Network.enable', {}, sessionId);
// Without this both captures can read identical cached bytes and a real change
// looks like no change at all.
await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

// Pin the viewport.
//
// Without this the capture is of whatever the Chrome window happens to be,
// and the window is often occluded or has no size at all — then
// captureScreenshot waits for a surface that never comes and the check dies
// having measured nothing. The script's own header says the number depends
// on the window ("a wider window at the same zoom/pitch shows more map
// around the same buildings"), so a fixed viewport also makes the gate
// comparable between runs.
await browser.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
}, sessionId);
// Focus is not visibility. A window that is behind another app is FOCUSED
// enough for setFocusEmulationEnabled and still HIDDEN, and a hidden page
// never fires requestAnimationFrame — so the map never draws and
// captureScreenshot waits for a frame that will not come. It answered in 120
// s and died with "did not answer", which is a measurement that failed, not
// a page that is broken.
//
// Foreground the tab, then wait until the page really is visible and really
// is producing frames. That is a stronger guarantee than focus emulation:
// the renderer may believe it is focused while the compositor still withholds
// frames, and a capture that waits for a frame then hangs.
async function ensureFrames() {
  await browser.send('Target.activateTarget', { targetId });
  let last = 'unknown';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const state = await browser.send('Runtime.evaluate', {
      expression: `(()=>{if(document.visibilityState!=='visible')return 'hidden';return new Promise((res)=>{let done=false;requestAnimationFrame(()=>{done=true;res('frames')});setTimeout(()=>{if(!done)res('no-frames')},800)})})()`,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    last = state.result?.value ?? String(state);
    if (last === 'frames') return true;
    await browser.send('Target.activateTarget', { targetId });
  }
  // Say so. A capture without a frame does not fail: it waits out its
  // timeout, and the check dies having measured nothing.
  console.error(`render-check: the page is not producing frames (${last}) — the capture would hang`);
  return false;
}
await ensureFrames();

// Close QA tabs left behind by an earlier run. A run that hangs or is killed
// never reaches its own cleanup, and each survivor is a live WebGL atlas
// spinning an rAF loop, so they accumulate across a session.
//
// Only the target created by this run belongs to this check. Other Atlas tabs
// may belong to a person or another audit; URL matching does not grant ownership.

const evaluate = async (expression) => {
  const r = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async () => {
  // Every capture needs a compositor frame. If the page has gone hidden the
  // frame never comes and the capture waits out its 120 s timeout — a check
  // that dies, having measured nothing. Foreground the tab and confirm it is
  // producing frames before every shot.
  await ensureFrames();
  const r = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  return Buffer.from(r.data, 'base64');
};

await browser.send('Page.navigate', { url: `${URL}/?debug` }, sessionId);
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { if (await evaluate('!!(window.__atlas?.map?.getLayer)')) break; } catch { /* booting */ }
}
if (!(await evaluate('!!window.__atlas?.map?.getLayer'))) die('the atlas map never appeared');

// Ensure map style and initial canvas dimensions settle before camera repositioning.
await evaluate(`new Promise((res) => {
  const m = window.__atlas?.map;
  if (!m || m.loaded()) return res(true);
  m.once('load', () => res(true));
  setTimeout(() => res(true), 15000);
})`);

await evaluate(`window.__atlas.map.jumpTo(${JSON.stringify(VIEW)}); true`);

// Wait for the layers to arrive rather than for a fixed number of seconds.
// A run started seconds after a deploy once reported all five layers MISSING
// on a site where all five were installed and drawing: the map existed, but the
// 3D layers install after a lazy three.js import, and a cold Worker was slower
// than the sleep. A check that reports "missing" when the answer is "not yet"
// is a check people learn to ignore.
const want = LAYERS.map((l) => l.id);
const deadline = Date.now() + 75000;
let installed = 0;
while (Date.now() < deadline) {
  installed = await evaluate(`JSON.stringify(${JSON.stringify(want)}.filter(i=>!!window.__atlas.map.getLayer(i)).length)`);
  if (Number(installed) >= want.length) break;
  await sleep(1500);
}
if (Number(installed) < want.length) {
  die(`only ${installed}/${want.length} layers installed within 75s at zoom ${VIEW.zoom} — the map never finished loading, so nothing can be measured`);
}

// Wait for the SOURCES, not just the layers.
//
// A layer is installed the moment its source is added — long before that
// source has anything to draw. MapLibre then builds the source's tiles in a
// worker, and for the 3.8 MB heritage-detail GeoJSON that takes tens of
// seconds. Measured on the live site: the layer was installed at t=17 s, the
// source finished loading at t=56 s, and the layer's own pixel footprint
// climbed 0.03% → 0.31% → 0.80% → 1.0% along that curve.
//
// The old check measured in that window and called the layer BLANK. It was
// installed, it was drawing, and it was 39 seconds away from its real size —
// so the check reported an empty layer for one that was simply still arriving.
//
// So wait for the sources. A source that never loads is not a pass and not a
// blank: it is a layer that could not be measured, and the run must say so
// rather than report a number it did not earn.
const SOURCE_WAIT_MS = 180000;
const sourceWait = await waitForSources(SOURCE_WAIT_MS);
if (!sourceWait.ok) {
  die(`source "${sourceWait.source}" (layer ${sourceWait.id}) had not loaded after ${SOURCE_WAIT_MS / 1000}s — the layer could not be measured, so no verdict can be given`);
}
await sleep(6000); // let the first chunks build before anything is measured

// The map is never still: khlongs flow, flood ripples and event pulses animate
// every frame. Measuring a noise floor on a moving target gave 15%, which would
// have set a 45% threshold and passed anything. Freeze the animated layers
// first — they are decorative motion, and every layer this check measures is
// static — then measure what is left, which is capture and antialiasing error.
const ANIMATED = [
  'bkkx-khlongs-flow', 'bkkx-flood-roads-ripple', 'bkkx-city-event-pulse',
  'bkkx-news-event-glow', 'bkkx-news-event-count', 'bkkx-khlongs-river',
  'bkkx-flood-roads-water', 'bkkx-khlongs-canal',
];
const freeze = await evaluate(`(()=>{const m=window.__atlas.map;let n=0;
 for (const id of ${JSON.stringify(ANIMATED)}) { try { if (m.getLayer(id)) { m.setLayoutProperty(id,'visibility','none'); n++; } } catch(e){} }
 return n})()`);
await sleep(2500);

// A base-style road is not a valid empty-layer control: after paint-order or
// imagery changes it may genuinely draw. Measure unchanged-state repaint noise
// instead, and sample the actual map rectangle rather than a historic crop.
// Values are percentages: 0.15 means 0.15%, not a fraction of 15%.
const mapBounds = await evaluate(`(()=>{const r=document.querySelector('#atlas-map').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
const CALIBRATION = ['unchanged-repaint-1', 'unchanged-repaint-2'];
const calib = {};
// Loaded GeoJSON can still be producing custom geometry. Bound the wait for
// two quiet repaint pairs; never turn that late-arriving geometry into a high
// noise floor that falsely declares small, visible layers blank.
let calibFloor = Infinity;
for (let attempt = 1; attempt <= 4; attempt++) {
  for (const id of CALIBRATION) {
    const before = await shot();
    await evaluate('window.__atlas.map.triggerRepaint(); true');
    await sleep(2200);
    calib[id] = differingPixels(before, await shot());
  }
  calibFloor = Math.max(...Object.values(calib).map(n => n === null ? Infinity : n));
  if (calibFloor <= 0.05) break;
  console.log(`render-check: calibration ${attempt}/4 unsettled (${calibFloor.toFixed(3)}%); waiting for stable map`);
  await sleep(2500);
}
if (calibFloor > 0.05) die('unchanged map did not settle below 0.05%; layer visibility is unproven, not blank');
const FLOOR = Math.max(0.02, calibFloor * 2);
console.log(`render-check: froze ${freeze} animated layer(s); unchanged-state calibration ${Object.entries(calib).map(([k, v]) => `${k}=${v === null ? 'n/a' : v.toFixed(3) + '%'}`).join(' ')} → threshold ${FLOOR.toFixed(3)}%`);

// They stay frozen for the whole run and go back at the very end. Restoring
// them here made the map animate again between every capture pair in the
// measurement loop, and that 0.11% of moving water was reported as the
// deliberately-asleep roof pilot "drawing" — the third distinct noise source
// this check has had to chase.

mkdirSync(SHOT_DIR, { recursive: true });
/**
 * Wait for every measurable layer's source to report loaded.
 *
 * Custom layers (the three.js heritage forms, the massing mesh) have no
 * source — there is nothing to wait for, and MapLibre does not give them one.
 * They are skipped rather than waited on forever.
 *
 * Returns {ok:true} when every source loaded, or {ok:false, id, source} for
 * the first one that did not, so the caller can name it instead of reporting
 * a measurement it never took.
 */
async function waitForSources(deadlineMs) {
  const started = Date.now();
  const waiters = [];
  for (const { id } of LAYERS) {
    const source = await evaluate(`(()=>{const m=window.__atlas.map;const l=m.getLayer(${JSON.stringify(id)});if(!l||!l.source)return null;return String(l.source)})()`);
    if (source) waiters.push({ id, source });
  }
  if (!waiters.length) return { ok: true };

  const pending = new Map(waiters.map((w) => [w.source, w.id]));
  const sources = [...pending.keys()];
  let lastReport = 0;
  while (Date.now() - started < deadlineMs) {
    let state = null;
    try {
      state = await evaluate(`(()=>{const m=window.__atlas.map;const out={};for (const s of ${JSON.stringify(sources)}) out[s]=m.isSourceLoaded(s);return out})()`);
    } catch { /* the page is busy; try again */ }
    if (state && typeof state === 'object') {
      for (const [s, id] of [...pending]) {
        if (state[s]) pending.delete(s);
      }
    }
    const elapsed = (Date.now() - started) / 1000;
    if (pending.size && elapsed - lastReport >= 10) {
      lastReport = elapsed;
      console.log(`render-check: waiting ${pending.size} source(s) to load (${elapsed.toFixed(0)}s): ${[...pending].map(([s, id]) => `${id}<-${s}`).join(', ')}`);
    }
    if (!pending.size) {
      console.log(`render-check: all ${waiters.length} source(s) loaded after ${elapsed.toFixed(1)}s (${waiters.map((w) => w.id).join(', ')})`);
      return { ok: true };
    }
    await sleep(1500);
  }
  const [source, id] = [...pending][0];
  return { ok: false, id, source };
}

const results = [];

for (const { id, expect = 'visible', why } of LAYERS) {
  const present = await evaluate(`!!window.__atlas.map.getLayer(${JSON.stringify(id)})`);
  if (!present) {
    results.push({ id, present: false, pct: 0, note: 'not installed' });
    continue;
  }
  const before = await shot();
  // Hide rather than remove: removal tears down state we want to keep for the
  // next layer, and MapLibre's onRemove can mask what the layer actually drew.
  // Restore the original visibility, never wake the superseded roof pilot.
  const wasVisible = await evaluate(`(()=>{const m=window.__atlas.map;try{return String(m.getLayoutProperty(${JSON.stringify(id)},'visibility')||'visible')}catch(e){return 'visible'}})()`);
  await evaluate(`(()=>{const m=window.__atlas.map; m.setLayoutProperty(${JSON.stringify(id)},'visibility','none'); return true})()`);
  await sleep(400);
  const probe = await evaluate(`window.__atlas.map.getLayoutProperty(${JSON.stringify(id)},'visibility') === 'none'`);
  await sleep(2100);
  const after = await shot();
  await evaluate(`(()=>{const m=window.__atlas.map; m.setLayoutProperty(${JSON.stringify(id)},'visibility',${JSON.stringify(wasVisible)}); return true})()`);
  await sleep(1500);

  const pct = differingPixels(before, after);
  writeFileSync(`${SHOT_DIR}/${id}-on.png`, before);
  writeFileSync(`${SHOT_DIR}/${id}-off.png`, after);
  // Read the visibility back while the layer is still hidden. A layer that
  // refuses to hide (a custom layer that ignores the layout property, or one
  // whose visibility was already 'none' for another reason) measures 0% and
  // would sail through an `expect: 'hidden'` expectation as "correctly
  // asleep" when in fact the check never toggled anything. For a visible
  // layer that same 0% reports BLANK, which is loud — so only the asleep
  // direction needs the proof.
  results.push({ id, present: true, pct, expect, why, probe });
}

// Put the animated layers back — the check must not leave the map altered.
await evaluate(`(()=>{const m=window.__atlas.map;
 for (const id of ${JSON.stringify(ANIMATED)}) { try { if (m.getLayer(id)) m.setLayoutProperty(id,'visibility','visible'); } catch(e){} }
 return true})()`);
await sleep(1500);

console.log(`render-check: ${URL} @ zoom ${VIEW.zoom}`);
let bad = 0;
for (const r of results) {
  if (!r.present) {
    console.log(`  MISSING  ${r.id} — not installed at this view`);
    bad++;
  } else if (r.expect === 'hidden') {
    if (!r.probe) {
      console.log(`  UNPROOF  ${r.id} — reads as hidden, but the hide never took: this check cannot measure it`);
      bad++;
    } else if (r.pct <= FLOOR) {
      console.log(`  asleep   ${r.id} — hidden as expected`);
    } else {
      console.log(`  NOISY    ${r.id} — should be hidden but draws ${r.pct.toFixed(2)}%`);
      bad++;
    }
  } else if (r.pct === null) {
    console.log(`  BROKEN   ${r.id} — the two captures are not comparable`);
    bad++;
  } else if (r.pct <= FLOOR) {
    console.log(`  UNPROVEN ${r.id} — delta ${r.pct.toFixed(3)}% does not exceed measured noise`);
    bad++;
  } else {
    console.log(`  draws    ${r.id} — ${r.pct.toFixed(2)}% of the map area`);
  }
}
console.log(`  screenshots: ${SHOT_DIR}`);
if (bad) {
  // Name the actual failure, not a blanket one. "present but invisible" was
  // what the first version printed for a layer that was never installed at all.
  const missing = results.filter((r) => !r.present).length;
  const parts = [];
  if (missing) parts.push(`${missing} not installed`);
  if (bad - missing) parts.push(`${bad - missing} installed but visibility not proven above noise`);
  console.error(`render-check: ${parts.join('; ')}`);
  die(parts.join('; '), 1);
}
console.log('render-check: every expected layer draws');

// ── minimal PNG reader: enough to diff two captures ────────────────────────
function readPng(buf) {
  let i = 8;
  let idat = [];
  let w = 0; let h = 0; let ct = 6;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  return { w, h, channels, data: out };
}

function differingPixels(aBuf, bBuf) {
  const a = readPng(aBuf);
  const b = readPng(bBuf);
  // A resize mid-run makes the captures incomparable. Scoring that 100 — the
  // first thing I wrote — reports every layer as loudly drawing, which is the
  // exact false green this script exists to prevent. Return null and let the
  // caller call it broken.
  if (a.w !== b.w || a.h !== b.h || a.channels !== b.channels) return null;
  // Only the map area counts. The header carries a live clock and the footer
  // carries the build stamp, and either would hand every layer a free few
  // percent of "it draws". Bounds are a fraction of the capture so a different
  // window size samples the same region rather than quietly a different one.
  const y0 = Math.max(0, Math.ceil(mapBounds.y));
  const y1 = Math.min(a.h, Math.floor(mapBounds.y + mapBounds.height));
  const x0 = Math.max(0, Math.ceil(mapBounds.x));
  const x1 = Math.min(a.w, Math.floor(mapBounds.x + mapBounds.width));
  let diff = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * a.w + x) * a.channels;
      const d = Math.max(
        Math.abs(a.data[o] - b.data[o]),
        Math.abs(a.data[o + 1] - b.data[o + 1]),
        Math.abs(a.data[o + 2] - b.data[o + 2]),
      );
      if (d > 28) diff++;
      total++;
    }
  }
  return total ? (100 * diff) / total : 0;
}
} finally {
  try {
    if (ownedTarget) await browser.send('Target.closeTarget', { targetId: ownedTarget });
  } finally { browser.close(); }
}
