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
    send(method, params = {}, sessionId) { const mid = ++id; const pl = { id: mid, method, params }; if (sessionId) pl.sessionId = sessionId; ws.send(JSON.stringify(pl)); return new Promise((r, j) => p.set(mid, { resolve: r, reject: j })); },
    close: () => ws.close(),
  };
}
const b = connect(v.webSocketDebuggerUrl); await b.ready;
const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await b.send(m, {}, sessionId);
await b.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

const ev = async (x) => {
  const r = await b.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async () => Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64');

await b.send('Page.navigate', { url: `${URL}/?debug` }, sessionId);
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  try { if (await ev('!!(window.__atlas?.map?.getLayer)')) break; } catch { /* booting */ }
}
if (!(await ev('!!window.__atlas?.map?.getLayer'))) { console.error('no atlas'); process.exit(2); }

// Park on the Rattanakosin monuments the layer draws.
await ev(`window.__atlas.map.jumpTo(${JSON.stringify(VIEW)}); true`);
await sleep(14000);

console.log('wireframe landmarks — installed and drawing?\n');
console.log('  installed before enabling:', await ev(`!!window.__atlas.map.getLayer(${JSON.stringify(ID)})`));

// Enable it the way the layer toggle does.
const enabled = await ev(`(async()=>{
  const entry = window.__atlas.LAYERS ? window.__atlas.LAYERS.find(l => l.id === 'wireframe-landmarks') : null;
  if (!entry) return 'no registry entry exposed on window.__atlas';
  try { await entry.install(window.__atlas.map); return 'install() ok'; }
  catch (e) { return 'install() threw: ' + String(e && e.message || e).slice(0,200); }
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

// Warm, then diff with the layer hidden.
await sleep(4000);
const on = await shot();
await ev(`(()=>{const m=window.__atlas.map;try{m.setLayoutProperty(${JSON.stringify(ID)},'visibility','none')}catch(e){};return true})()`);
await sleep(2500);
const off = await shot();
await ev(`(()=>{const m=window.__atlas.map;try{m.setLayoutProperty(${JSON.stringify(ID)},'visibility','visible')}catch(e){};return true})()`);
await sleep(1500);

const pct = differingPixels(on, off);
mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(`${SHOT_DIR}/wireframe-on.png`, on);
writeFileSync(`${SHOT_DIR}/wireframe-off.png`, off);
console.log(`\n  footprint: ${pct === null ? 'captures not comparable' : pct.toFixed(3) + '% of the map area'}`);
console.log(`  screenshots: ${SHOT_DIR}/wireframe-{on,off}.png`);
console.log(pct !== null && pct > 0.02
  ? '  VERDICT: draws. Installed, present, and changing pixels.'
  : '  VERDICT: installed but draws nothing — this is the silent failure.');
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
      else if (filter === 4) { const pp = a + bb - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - bb); const pc = Math.abs(pp - c); line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? bb : c)) & 255; }
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