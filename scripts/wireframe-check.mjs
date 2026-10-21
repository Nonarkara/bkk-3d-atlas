// Does the wireframe landmark layer actually draw?
//
// Installed and drawing are different claims, and this project has shipped a
// layer that installed cleanly and rendered nothing twice — most recently
// PR #19's pre-MapLibre-5 render(gl, matrix) signature. So: enable the layer
// the way a visitor would, then diff pixels with it hidden.
//
// The layer is opt-in, so this has to turn it on: find the registry entry,
// call its install(), and let three.js resolve through the import map.
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PORT = process.env.CHROME_DEBUG_PORT || '9333';
const URL = process.env.ATLAS_URL || 'https://atlas.nonarkara.org';
const SHOT_DIR = '/tmp/atlas-render-check';
const ID = 'bkkx-wireframe-landmarks';
const VIEW = { center: [100.4913, 13.7501], zoom: 16.4, pitch: 52, bearing: -25 };

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
for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await b.send(m, {}, sessionId);
await b.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
// Keep the renderer producing frames even when the Chrome window is occluded
// behind another app. Without this, captureScreenshot never answers: the page
// goes hidden, Chrome suspends the compositor, and an unsettled top-level await
// ends the process with exit 0 — a check that measured nothing and passed.
await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
// Pin the viewport. At headless defaults the map canvas collapses (observed
// 297x30, then 30x30 after settle at a 1280 override), the screenshot clip
// shrinks with it, and every monument falls outside the capture — the check
// reads exactly like a layer that draws nothing. 1440x900 at dpr 1 yields
// the real map surface (~1000x643).
await b.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
}, sessionId);
// Freeze the map's own animation (live markers, pulses, water). The atlas
// honours prefers-reduced-motion; without it the noise floor between two
// hidden captures sits at ~0.15% and can mask a thin line drawing.
await b.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
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

const ev = async (x) => {
  const r = await b.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Crop every capture to the map canvas. A full-page capture includes the live
// news panel, whose headlines refresh on a timer, and the panel's text churn
// lands in the same pixel band as the map. That churn is not a render
// difference, and it is large enough to hide a layer that draws nothing.
let clip = null;
const shot = async () => {
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 1 };
  return Buffer.from((await b.send('Page.captureScreenshot', params, sessionId)).data, 'base64');
};

await b.send('Page.navigate', { url: `${URL}/?debug` }, sessionId);
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { if (await ev('!!(window.__atlas?.map?.getLayer)')) break; } catch { /* booting */ }
}
if (!(await ev('!!window.__atlas?.map?.getLayer'))) { console.error('no atlas'); process.exit(2); }

const readRect = `(()=>{const r=window.__atlas.map.getCanvas().getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };})()`;
const canvasRect = await ev(readRect);
clip = canvasRect;
console.log('  map canvas at boot:', `${canvasRect.width}x${canvasRect.height} at ${canvasRect.x},${canvasRect.y}`);

// Park on the Rattanakosin monuments the layer draws.
await ev(`window.__atlas.map.jumpTo(${JSON.stringify(VIEW)}); true`);
await sleep(14000);

// Re-read the canvas after the view settles: at boot the map container can
// still be mid-layout (the earlier 297x30 clip captured the corner of a
// collapsing canvas and every monument fell outside the screenshot).
const settledRect = await ev(readRect);
if (settledRect.width !== canvasRect.width || settledRect.height !== canvasRect.height) {
  clip = settledRect;
  console.log('  map canvas settled:', `${settledRect.width}x${settledRect.height} at ${settledRect.x},${settledRect.y}`);
}

console.log('wireframe landmarks — installed and drawing?\n');
console.log('  installed before enabling:', await ev(`!!window.__atlas.map.getLayer(${JSON.stringify(ID)})`));

// Enable it the way the layer toggle does.
const enabled = await ev(`(async()=>{
  if (typeof window.__atlas?.setLayer !== 'function') return 'no setLayer on window.__atlas (needs ?debug)';
  try { return await window.__atlas.setLayer('wireframe-landmarks', true) ? 'setLayer(true) ok' : 'setLayer ran but the layer is not on the map'; }
  catch (e) { return 'setLayer threw: ' + String(e && e.message || e).slice(0,220); }
})()`);
console.log('  enabling:', enabled);

const deadline = Date.now() + 40000;
let present = false;
while (Date.now() < deadline) {
  present = await ev(`!!window.__atlas.map.getLayer(${JSON.stringify(ID)})`);
  if (present) break;
  await sleep(1500);
}
console.log('  installed after enabling :', present);
console.log('  segments reported        :', await ev(`(window.__bkkxWireStats||{}).segments ?? '(not announced)'`));
console.log('  models                   :', JSON.stringify(await ev(`(window.__bkkxWireStats||{}).models ?? '(none)'`)));

if (!present) {
  console.log('\n  VERDICT: not installed — the layer does not reach the map.');
  b.close();
  process.exit(1);
}

// The layer announces its own first successful render via
// window.__bkkxWireStats. Waiting for that signal — not a fixed sleep — is
// what separates "installed" from "drew": three.js resolves from unpkg on
// first enable, and the earlier fixed 4 s warm-up captured pre-announce
// frames, which read exactly like a layer that draws nothing.
const announceDeadline = Date.now() + 45000;
let announced = false;
while (Date.now() < announceDeadline) {
  announced = await ev(`!!window.__bkkxWireStats`);
  if (announced) break;
  await sleep(1500);
}
console.log('  first render announced    :', announced);

// Warm, then diff with the layer hidden.
await sleep(4000);
const on = await shot();
await ev(`(()=>{const m=window.__atlas.map;try{m.setLayoutProperty(${JSON.stringify(ID)},'visibility','none')}catch(e){};return true})()`);
await sleep(2500);
const off = await shot();
// Noise floor: two captures of the same settled state. If this is not tiny,
// the map moved between captures and the footprint below is measuring the
// move, not the layer.
const offAgain = await shot();
await ev(`(()=>{const m=window.__atlas.map;try{m.setLayoutProperty(${JSON.stringify(ID)},'visibility','visible')}catch(e){};return true})()`);
await sleep(1500);

const diff = diffStats(on, off);
const noise = diffStats(off, offAgain);
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(`${SHOT_DIR}/wireframe-on.png`, on);
writeFileSync(`${SHOT_DIR}/wireframe-off.png`, off);
writeFileSync(`${SHOT_DIR}/wireframe-off-again.png`, offAgain);
console.log(`\n  footprint  : ${diff.pct === null ? 'captures not comparable' : diff.pct.toFixed(3) + '% of the map canvas'}`);
console.log(`  noise floor: ${noise.pct === null ? 'n/a' : noise.pct.toFixed(3) + '% (map movement between captures)'}`);
if (diff.pct !== null) {
  console.log(`  changed px : ${diff.pixels} in ${diff.clusters} region(s), bbox ${diff.bbox}`);
}
console.log(`  screenshots: ${SHOT_DIR}/wireframe-{on,off,off-again}.png`);
console.log(verdict(diff, noise));
b.close();

function verdict(diff, noise) {
  if (diff.pct === null) return '  VERDICT: captures not comparable — no measurement.';
  if (noise.pct !== null && noise.pct > 0.05) {
    return `  VERDICT: not measured. The map moved ${noise.pct.toFixed(3)}% between two identical `
      + 'captures, so the footprint above is the movement, not the layer.';
  }
  if (diff.pct <= 0.02) {
    return '  VERDICT: installed but draws nothing — this is the silent failure.';
  }
  if (diff.pct >= 12) {
    return `  VERDICT: draws a slab. ${diff.pct.toFixed(3)}% of the canvas changed in `
      + `${diff.clusters} region(s) — the geometry is projected at the wrong scale.`;
  }
  if (diff.clusters < 2) {
    return `  VERDICT: draws one blob, not eight landmarks (${diff.pct.toFixed(3)}% in `
      + `${diff.clusters} region).`;
  }
  return `  VERDICT: draws. ${diff.pct.toFixed(3)}% of the canvas across ${diff.clusters} `
    + 'discrete regions, consistent with eight wireframe monuments.';
}

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
      else if (filter === 4) { const pp = a + bb - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - bb); const pc = Math.abs(pp - c); line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255; }
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, channels, data: out };
}
// Pixel diff with the shape of the change, not just its size.
//
// A footprint percentage alone cannot tell "eight thin wireframe monuments"
// from "one enormous slab": this repo's own harness once passed a layer that
// drew nothing at all, because a different layer repainted in the same frame
// and the panel's live headlines churned inside the same pixel band. The
// number of separate regions the change falls into does tell them apart, so
// count them.
function diffStats(aBuf, bBuf) {
  const a = readPng(aBuf), c = readPng(bBuf);
  if (a.w !== c.w || a.h !== c.h || a.channels !== c.channels) return { pct: null };
  const total = a.w * a.h;
  const mask = new Uint8Array(total);
  let diff = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const p = y * a.w + x, o = p * a.channels;
    const d = Math.max(Math.abs(a.data[o] - c.data[o]), Math.abs(a.data[o + 1] - c.data[o + 1]), Math.abs(a.data[o + 2] - c.data[o + 2]));
    if (d > 28) { mask[p] = 1; diff++; }
  }
  const { clusters, bbox } = countRegions(mask, a.w, a.h);
  return { pct: total ? (100 * diff) / total : 0, pixels: diff, clusters, bbox };
}

// 8-connected flood fill over the changed-pixel mask.
function countRegions(mask, w, h) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let clusters = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    clusters++;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (mask[np] && !seen[np]) { seen[np] = 1; stack[sp++] = np; }
      }
    }
  }
  const bbox = clusters ? `${minX}-${maxX} x ${minY}-${maxY}` : 'none';
  return { clusters, bbox };
}