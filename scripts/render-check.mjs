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
  console.error(`render-check: ${message}`);
  process.exit(code);
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
      return new Promise((r, j) => pending.set(mid, { resolve: r, reject: j }));
    },
    close: () => ws.close(),
  };
}

const browser = connect(version.webSocketDebuggerUrl);
await browser.ready;
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
await browser.send('Page.enable', {}, sessionId);
await browser.send('Runtime.enable', {}, sessionId);
await browser.send('Network.enable', {}, sessionId);
// Without this both captures can read identical cached bytes and a real change
// looks like no change at all.
await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

const evaluate = async (expression) => {
  const r = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async () => {
  const r = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  return Buffer.from(r.data, 'base64');
};

await browser.send('Page.navigate', { url: `${URL}/?debug` }, sessionId);
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { if (await evaluate('!!(window.__atlas?.map?.getLayer)')) break; } catch { /* booting */ }
}
if (!(await evaluate('!!window.__atlas?.map?.getLayer'))) die('the atlas map never appeared');

await evaluate(`window.__atlas.map.jumpTo(${JSON.stringify(VIEW)}); true`);
await sleep(12000);

mkdirSync(SHOT_DIR, { recursive: true });
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
  await evaluate(`(()=>{const m=window.__atlas.map; m.setLayoutProperty(${JSON.stringify(id)},'visibility','none'); return true})()`);
  await sleep(400);
  const probe = await evaluate(`window.__atlas.map.getLayoutProperty(${JSON.stringify(id)},'visibility') === 'none'`);
  await sleep(2100);
  const after = await shot();
  await evaluate(`(()=>{const m=window.__atlas.map; m.setLayoutProperty(${JSON.stringify(id)},'visibility','visible'); return true})()`);
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

browser.close();

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
    } else if (r.pct <= 0.05) {
      console.log(`  asleep   ${r.id} — hidden as expected`);
    } else {
      console.log(`  NOISY    ${r.id} — should be hidden but draws ${r.pct.toFixed(2)}%`);
      bad++;
    }
  } else if (r.pct === null) {
    console.log(`  BROKEN   ${r.id} — the two captures are not comparable`);
    bad++;
  } else if (r.pct <= 0.05) {
    console.log(`  BLANK    ${r.id} — installed but changes no pixels (${r.pct.toFixed(3)}%)`);
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
  if (bad - missing) parts.push(`${bad - missing} installed but drawing nothing they should`);
  console.error(`render-check: ${parts.join('; ')}`);
  process.exit(1);
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
  const y0 = Math.round(a.h * 0.245);
  const y1 = Math.round(a.h * 0.87);
  let diff = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < a.w; x++) {
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