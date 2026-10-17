// Layer sweep: which of the installed layers actually draw?
//
// render-check.mjs measures five hand-picked layers, because a check that cries
// wolf gets ignored. This measures all of them and reports, so an auditor can
// see the whole picture. It reports; it does not gate. Expect a long tail of
// layers that legitimately draw nothing at a given view — an empty data source,
// a zoom gate, a road that is not at this spot. The job is to give every zero a
// reason, not to demand every layer be loud.
//
//   node scripts/layer-sweep.mjs
//
// Requires a Chrome on CHROME_DEBUG_PORT (default 9333). Writes per-layer
// percentages to /tmp/atlas-layer-sweep/sweep.json.
//
// THE ENUMERATION TRAP, which cost the first run of this script its two most
// important layers. `map.getStyle().layers` does NOT include custom layers. It
// returned 73 and silently omitted bkkx-heritage-forms and bkkx-building-massing
// — both `type: "custom"` three.js layers, and precisely the two that have
// broken silently and shipped drawing nothing. Any presence check built on the
// style object reports them missing forever. Use `map.getLayersOrder()`.
//
// Cumulative rather than pairwise: shoot with everything on, shoot with
// everything off, then add layers back one at a time. The delta between
// consecutive shots is that layer's footprint, for one screenshot per layer
// instead of two. Additive so a later layer does not hide an earlier one.
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PORT = process.env.CHROME_DEBUG_PORT || '9333';
const URL = process.env.ATLAS_URL || 'https://atlas.nonarkara.org';
const SHOT_DIR = process.env.SWEEP_DIR || '/tmp/atlas-layer-sweep';
const SETTLE = Number(process.env.SETTLE_MS || 900);

const VIEWS = [
  { label: 'Old Town z16.4',   view: { center: [100.4928, 13.7518], zoom: 16.4, pitch: 52, bearing: -25 } },
  { label: 'city scale z12',   view: { center: [100.5010, 13.7560], zoom: 12.0, pitch: 0, bearing: 0 } },
];

const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
function connect(url) {
  const ws = new WebSocket(url); let id = 0; const p = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { const { resolve: r, reject: j } = p.get(m.id); p.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
  });
  return {
    ready: new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }),
    send(method, params = {}, sessionId) { const mid = ++id; const pl = { id: mid, method, params }; if (sessionId) pl.sessionId = sessionId; ws.send(JSON.stringify(pl)); return new Promise((r, j) => { const to = setTimeout(() => { p.delete(mid); j(new Error(`${method} did not answer in 120s`)); }, 120000); p.set(mid, { resolve: (v) => { clearTimeout(to); r(v); }, reject: (e) => { clearTimeout(to); j(e); } }); }) },
    close: () => ws.close(),
  };
}
const b = connect(v.webSocketDebuggerUrl); await b.ready;
const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable']) await b.send(m, {}, sessionId);
// Without this, consecutive captures can be byte-identical cached reads.
await b.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
// Keep the renderer producing frames even when the Chrome window is occluded
// behind another app. Without this, captureScreenshot never answers: the page
// goes hidden, Chrome suspends the compositor, and an unsettled top-level await
// ends the process with exit 0 — a check that measured nothing and passed.
await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
// Pin the surface to 1x. This sweep has to capture the city-scale view, and at
// the window's native 2x the backing surface is 4.8 megapixels — captureScreenshot
// then never returns, not even after 150s, while the map itself runs at ~50fps.
// Measured: 1200x1004@1x captures in 329ms at zoom 10.60, where 2x never answers.
// The map was never broken. Only the capture path was.
await b.send('Emulation.setDeviceMetricsOverride', {
  width: 1200, height: 1004, deviceScaleFactor: 1, mobile: false,
}, sessionId);

// Close QA tabs left behind by an earlier run. A run that hangs or is killed
// never reaches its own cleanup, and each survivor is a live WebGL atlas
// spinning an rAF loop, so they accumulate across a session.
//
// This is hygiene, not a fix. It was written on the theory that leaked tabs were
// starving the compositor; it was not — cleaning them changed nothing about the
// mid-sweep hang, which was the 2x surface above. Kept because leaked tabs are
// still real, not because they caused anything.
{
  const { targetInfos } = await b.send('Target.getTargets');
  for (const t of targetInfos) {
    if (t.targetId === targetId || t.type !== 'page') continue;
    if (!/^https?:\/\/(atlas|bkk)\.nonarkara\.org\/|^about:blank/.test(t.url || '')) continue;
    try { await b.send('Target.closeTarget', { targetId: t.targetId }); } catch {}
  }
}

const ev = async (x) => { const r = await b.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async () => Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64');

await b.send('Page.navigate', { url: `${URL}/?debug` }, sessionId);
for (let i = 0; i < 60; i++) { await sleep(1000); try { if (await ev('!!(window.__atlas?.map?.getLayer)')) break; } catch {} }
if (!(await ev('!!window.__atlas?.map?.getLayer'))) { console.error('sweep: the atlas map never appeared'); process.exit(2); }

mkdirSync(SHOT_DIR, { recursive: true });
const report = {};

for (const { label, view } of VIEWS) {
  await ev(`window.__atlas.map.jumpTo(${JSON.stringify(view)}); true`);
  await sleep(14000);

  // getLayersOrder(), NOT getStyle().layers. The style object omits custom
  // layers entirely: it reported 73 layers and left out both three.js layers —
  // exactly the ones that have broken silently twice. Anything that enumerates
  // layers to decide whether they are "installed" is blind to every custom
  // layer if it reads the style.
  const ids = JSON.parse(await ev('JSON.stringify(window.__atlas.map.getLayersOrder())'));
  console.log(`\n══ ${label} — ${ids.length} installed layers ══`);

  // Each layer is measured ALONE against the all-off baseline.
  //
  // This used to enable them cumulatively — one more layer visible each step,
  // each delta measured against the previous step. That reads as equivalent and
  // is not. bkkx-heritage-roofs-3d scored exactly 0.000% that way while
  // MapLibre's own queryRenderedFeatures returned 144 rendered features at the
  // very same view, and turning it on visibly changed pixels with its sibling
  // extrusions already visible. Forty layers were sitting in that suspect bucket
  // with no evidence any of them were actually broken.
  //
  // Cost is identical: one shared baseline, one capture per layer.
  await ev(`(()=>{const m=window.__atlas.map;for(const id of ${JSON.stringify(ids)}){try{m.setLayoutProperty(id,'visibility','none')}catch(e){}}return true})()`);
  await sleep(SETTLE);
  const base = await shot();
  const pct = {};
  for (const id of ids) {
    await ev(`(()=>{const m=window.__atlas.map;for(const o of ${JSON.stringify(ids)}){try{m.setLayoutProperty(o,'visibility','none')}catch(e){}}
      try{m.setLayoutProperty(${JSON.stringify(id)},'visibility','visible')}catch(e){};return true})()`);
    await sleep(SETTLE);
    const cur = await shot();
    const d = differingPixels(base, cur);
    pct[id] = d === null ? null : d;
  }
  // Leave the map as we found it.
  await ev(`(()=>{const m=window.__atlas.map;for(const id of ${JSON.stringify(ids)}){try{m.setLayoutProperty(id,'visibility','none')}catch(e){}}return true})()`);
  await sleep(400);
  for (const id of ids) { await ev(`(()=>{try{window.__atlas.map.setLayoutProperty(${JSON.stringify(id)},'visibility','visible')}catch(e){};return true})()`); }

  report[label] = pct;
  const blank = ids.filter((id) => pct[id] !== null && pct[id] <= 0.02);
  for (const id of ids.slice().sort((a, b2) => (pct[b2] ?? 0) - (pct[a] ?? 0))) {
    const val = pct[id];
    const mark = val === null ? '??' : val <= 0.02 ? '   ' : ' · ';
    console.log(`  ${mark}${(val === null ? 'n/a' : val.toFixed(3) + '%').padStart(8)}  ${id}`);
  }
  console.log(`  → ${blank.length} of ${ids.length} change no pixels at this view`);
}

writeFileSync(`${SHOT_DIR}/sweep.json`, JSON.stringify(report, null, 2));
console.log(`\nsweep: written to ${SHOT_DIR}/sweep.json`);
b.close();

function readPng(buf) {
  let i = 8, idat = [], w = 0, h = 0, ct = 6;
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
  let prev = Buffer.alloc(stride); let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const bb = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + bb) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + bb) >> 1)) & 255;
      else if (filter === 4) { const p = a + bb - c; const pa = Math.abs(p - a); const pb = Math.abs(p - bb); const pc = Math.abs(p - c); line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255; }
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, channels, data: out };
}
function differingPixels(aBuf, bBuf) {
  const a = readPng(aBuf), c = readPng(bBuf);
  if (a.w !== c.w || a.h !== c.h || a.channels !== c.channels) return null;
  const y0 = Math.round(a.h * 0.245), y1 = Math.round(a.h * 0.87);
  let diff = 0, total = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < a.w; x++) {
    const o = (y * a.w + x) * a.channels;
    const d = Math.max(Math.abs(a.data[o] - c.data[o]), Math.abs(a.data[o + 1] - c.data[o + 1]), Math.abs(a.data[o + 2] - c.data[o + 2]));
    if (d > 28) diff++; total++;
  }
  return total ? (100 * diff) / total : 0;
}