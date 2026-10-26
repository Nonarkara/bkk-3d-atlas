// Real pointer/keyboard QA; uses an existing Chrome and owns only its new tab.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LANDMARK_VIEWS } from '../public/landmark-views.js';
const base = process.env.ATLAS_URL || 'https://atlas.nonarkara.org';
const out = process.env.MSH_DIR || '/tmp/atlas-space-qa';
const port = process.env.CHROME_DEBUG_PORT || '9421';
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0, targetId, sessionId;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data), job = pending.get(msg.id);
  if (!job) return;
  pending.delete(msg.id); clearTimeout(job.timer);
  msg.error ? job.reject(new Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
};
function send(method, params = {}, session = sessionId) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, method === 'Page.captureScreenshot' ? 90000 : 30000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: requestId, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'browser evaluation failed');
  return r.result.value;
}
async function click(selector) {
  const point = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();if(!r.width||!r.height||r.top<0||r.bottom>innerHeight)throw Error('control not reachable');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function key(key, code, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers });
}
async function capture() {
  await send('Target.activateTarget', { targetId }, null);
  await ev(`new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('no visible compositor frame')),4000);requestAnimationFrame(()=>{clearTimeout(timer);resolve(true)})})`);
  return send('Page.captureScreenshot', { format: 'png' });
}
try {
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }, null));
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  for (const name of ['Page.enable', 'Runtime.enable', 'Network.enable']) await send(name);
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Target.activateTarget', { targetId }, null);
  await send('Page.navigate', { url: `${base}/?debug` });
  await ev(`new Promise((resolve,reject)=>{const start=Date.now();const t=setInterval(()=>{if(document.querySelector('.atlas-area-btn')&&document.querySelector('#atlas-panel').hasAttribute('role')){clearInterval(t);resolve(true)}else if(Date.now()-start>25000){clearInterval(t);reject(Error('atlas did not boot'))}},200)})`);
  mkdirSync(out, { recursive: true });
  for (const [width, height] of [[1440,900],[1280,900],[1024,768],[768,900],[390,844],[375,812]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 721 });
    await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
    const state = await ev(`(()=>{const p=document.querySelector('#atlas-panel'),m=document.querySelector('#atlas-map').getBoundingClientRect();return {hidden:p.getAttribute('aria-hidden'),inert:p.inert,map:m.width*m.height/(innerWidth*innerHeight),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`);
    assert.equal(state.overflow, false, `overflow at ${width}`);
    assert.ok(state.map >= 0.60, `map allocation below 60% at ${width}: ${state.map}`);
    if (width <= 1280) {
      assert.equal(state.hidden, 'true'); assert.equal(state.inert, true);
      await click('#atlas-panel-toggle');
      assert.equal(await ev(`document.querySelector('#atlas-panel').classList.contains('is-open') && !document.querySelector('#atlas-panel').inert`), true);
      await key('Tab', 9, 8);
      assert.equal(await ev(`document.querySelector('#atlas-panel').contains(document.activeElement)`), true);
      await key('Escape', 27);
      assert.equal(await ev(`document.activeElement.id==='atlas-panel-toggle' && document.querySelector('#atlas-panel').inert`), true);
    } else {
      assert.equal(state.hidden, 'false'); assert.equal(state.inert, false);
      const hasHeadlines = await ev(`new Promise(resolve=>{const start=Date.now();const t=setInterval(()=>{if(!document.querySelector('#atlas-news-watch-more').hidden){clearInterval(t);resolve(true)}else if(Date.now()-start>15000){clearInterval(t);resolve(false)}},200)})`);
      if (hasHeadlines) {
        await click('#atlas-news-watch-more');
        assert.equal(await ev(`!document.querySelector('#atlas-news-watch-list').classList.contains('atlas-news-watch-list-collapsed')`), true);
      } else console.log('UNVERIFIED headline expansion: upstream supplied fewer than four items');
    }
    const shot = await capture();
    writeFileSync(`${out}/${width}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`PASS ${width}×${height}: map ${(state.map*100).toFixed(1)}%, drawer/focus/overflow`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const landmark of ['grand-palace', 'wat-arun']) {
    await click(`[data-landmark-view="${landmark}"]`);
    const [lng, lat] = LANDMARK_VIEWS[landmark].center;
    const ready = await ev(`new Promise(resolve=>{const start=Date.now();const t=setInterval(()=>{const m=window.__atlas?.map;if(m&&!m.isMoving()&&m.getZoom()>=16&&Math.hypot(m.getCenter().lng-${lng},m.getCenter().lat-${lat})<0.0001&&window.__bkkxWireReady&&window.__bkkxWireStats?.solidTriangles>0){clearInterval(t);resolve(true)}else if(Date.now()-start>25000){clearInterval(t);resolve(false)}},200)})`);
    assert.equal(ready, true, `heritage shortcut failed: ${landmark}`);
    const shot = await capture();
    writeFileSync(`${out}/${landmark}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`PASS ${landmark}: pointer shortcut reaches the 3D scale`);
  }
} finally {
  if (targetId) await send('Target.closeTarget', { targetId }, null);
  ws.close();
}
