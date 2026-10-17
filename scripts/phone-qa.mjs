// Phone visual QA at 390px — the viewport nobody has checked.
//
// An audit handed this to "a human with a real phone", on the grounds that no
// tooling here can render one. That is not true: CDP can emulate one.
//
// Two traps, both of which produce convincing lies:
//
// 1. `--window-size=390,844` does NOT give a 390px viewport. Chrome clamps the
//    window to a 500px minimum and hands back a 390px-wide CROP of it, which
//    looks exactly like a layout broken at the right edge.
//
// 2. `Page.captureScreenshot` on a continuously-animating page (the atlas runs an
//    rAF loop) needs a compositor frame. If the Chrome window is occluded behind
//    another app, `document.visibilityState` goes "hidden", Chrome suspends the
//    compositor, and captureScreenshot never returns — it does not error, it just
//    never settles. That is how the first run of this script printed nothing and
//    still exited 0: a false green from an unsettled top-level await.
//    `Emulation.setFocusEmulationEnabled` makes the renderer treat the target as
//    focused and visible, so frames flow even when the window is behind others.
//
// What it reports per page:
//   - a screenshot at the emulated width
//   - horizontal overflow: scrollWidth > clientWidth is the classic phone bug
//     and is invisible to a headless smoke test that only reads HTML/CSS
//   - console errors and CSP refusals, which do not throw
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CHROME_DEBUG_PORT || '9333';
const OUT = process.env.PHONE_DIR || '/tmp/atlas-phone-qa';
// Overridable so a test can make an unanswered command fail fast instead of
// costing 30s. The default is deliberately long: the atlas takes real time to
// boot, and a timeout that fires early reports a hang that is really a slow map.
const CALL_TIMEOUT_MS = Number(process.env.PHONE_TIMEOUT_MS || 30000);
// Settle time after load, before measuring. Shortened by the test so it does not
// sit through two 6-second sleeps.
const SETTLE_MS = Number(process.env.PHONE_SETTLE_MS || 6000);

const DEVICES = [
  { name: 'iphone-14', width: 390, height: 844, dsf: 2 },
  { name: 'small-android', width: 360, height: 740, dsf: 2 }, // the narrow common case
];

// Overridable so this can be pointed at a preview URL — or at a page that is
// deliberately broken, which is the only way to know the check still bites.
const PAGES = process.env.PHONE_PAGES
  ? JSON.parse(process.env.PHONE_PAGES)
  : [
    { name: 'atlas', url: 'https://atlas.nonarkara.org/' },
    { name: 'atlas-heritage', url: 'https://atlas.nonarkara.org/#heritage' },
    { name: 'bkkx-home', url: 'https://bkk.nonarkara.org/' },
    { name: 'bkkx-atlas', url: 'https://bkk.nonarkara.org/atlas/historic-core' },
  ];

mkdirSync(OUT, { recursive: true });

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();

function connect(url) {
  const ws = new WebSocket(url); let id = 0; const p = new Map(); const events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) {
      const entry = p.get(m.id); p.delete(m.id);
      if (m.error) entry.reject(new Error(JSON.stringify(m.error))); else entry.resolve(m.result);
      return;
    }
    events.push(m);
  });
  return {
    ready: new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); }),
    // Every call is bounded. An unanswered CDP command is a hang, not a pass.
    send(method, params = {}, sessionId, timeoutMs = CALL_TIMEOUT_MS) {
      const mid = ++id; const pl = { id: mid, method, params };
      if (sessionId) pl.sessionId = sessionId;
      ws.send(JSON.stringify(pl));
      return new Promise((resolve, reject) => {
        const to = setTimeout(() => { p.delete(mid); reject(new Error(`${method} did not answer in ${timeoutMs}ms`)); }, timeoutMs);
        p.set(mid, { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } });
      });
    },
    events,
    close: () => ws.close(),
  };
}

const b = connect(version.webSocketDebuggerUrl);
await b.ready;

let problems = 0;
let targetId = null;

try {
  ({ targetId } = await b.send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) await b.send(m, {}, sessionId);
  // The fix for an occluded window. Without it captureScreenshot on an animated
  // page hangs forever and this script exits 0 having checked nothing.
  await b.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
  await b.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

  const ev = async (x) => {
    const r = await b.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const dev of DEVICES) {
    // The real device. Not window-size, which clamps to 500px and crops.
    await b.send('Emulation.setDeviceMetricsOverride', {
      width: dev.width, height: dev.height, deviceScaleFactor: dev.dsf, mobile: true,
    }, sessionId);
    await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);

    console.log(`\n══ ${dev.name} — ${dev.width}x${dev.height} @${dev.dsf}x ══`);

    for (const page of PAGES) {
      b.events.length = 0;
      await b.send('Page.navigate', { url: page.url }, sessionId);
      for (let i = 0; i < 40; i++) { await sleep(500); try { if (await ev('document.readyState === "complete"')) break; } catch {} }
      await sleep(SETTLE_MS);

      // The viewport must actually be the emulated one, or the whole run is a lie.
      //
      // Measure the width with documentElement.clientWidth, NOT window.innerWidth.
      // Under mobile emulation a page whose content is too wide widens the layout
      // viewport, so innerWidth reports the *content* width (600) instead of the
      // screen (390). innerWidth then equals scrollWidth, the overflow looks like
      // it does not exist, and no element ever registers as an offender. Mutation
      // testing caught exactly that: a 210px overflow with an empty offender list.
      const real = await ev('({ w: window.innerWidth, cw: document.documentElement.clientWidth, dpr: window.devicePixelRatio, vis: document.visibilityState })');

      const overflow = await ev(`(() => {
        const de = document.documentElement;
        const vw = de.clientWidth;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1) {
            offenders.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 44), over: Math.round(r.right - vw) });
          }
          if (offenders.length >= 6) break;
        }
        return { scrollW: de.scrollWidth, clientW: vw, offenders };
      })()`);

      // Name the resource. "Failed to load resource" without a URL is not a
      // report, it is a shrug — and it is the difference between a transient
      // connection reset and a subrequest that reliably 404s on a phone.
      const errors = b.events
        .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
        .map((e) => {
          const en = e.params.entry;
          return `${en.text}${en.url ? ` <${en.url}>` : ''}`;
        })
        .filter((t) => !/favicon|wood-pattern/i.test(t));
      const consoleErrs = b.events
        .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
        .map((e) => (e.params.args || []).map((a) => a.description || a.value || '').join(' '))
        .filter((t) => !/favicon|wood-pattern/i.test(t));

      const shot = Buffer.from((await b.send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64');
      writeFileSync(`${OUT}/${dev.name}-${page.name}.png`, shot);

      const fits = overflow.scrollW <= overflow.clientW + 1;
      const errCount = errors.length + consoleErrs.length;
      const visible = real.vis === 'visible';
      const rightWidth = real.cw === dev.width;
      const ok = fits && errCount === 0 && rightWidth && visible;
      if (!ok) problems++;

      console.log(`  ${ok ? 'OK  ' : 'FLAG'} ${page.name.padEnd(16)} viewport=${real.cw}px@${real.dpr}x vis=${real.vis}  scrollW=${overflow.scrollW} clientW=${overflow.clientW}  errors=${errCount}`);
      if (!rightWidth) console.log(`       ! viewport is ${real.cw}px, not ${dev.width}px — emulation did not take`);
      if (!visible) console.log(`       ! page is ${real.vis}: an occluded renderer hides real layout faults and freezes the capture`);
      if (!fits) {
        console.log(`       ! horizontal overflow by ${overflow.scrollW - overflow.clientW}px`);
        for (const o of overflow.offenders) console.log(`         ${o.tag}.${o.cls} +${o.over}px`);
        if (!overflow.offenders.length) console.log('         (no single element is past the edge — the overflow is from the page itself, not a child)');
      }
      for (const e of [...errors, ...consoleErrs].slice(0, 4)) console.log(`       ! ${e.slice(0, 140)}`);
    }
  }
} catch (e) {
  // A harness that cannot complete its checks must never report success.
  console.error(`\nphone-qa: aborted — ${e.message}`);
  problems++;
} finally {
  if (targetId) { try { await b.send('Target.closeTarget', { targetId }); } catch {} }
  b.close();
}

console.log(`\nscreenshots: ${OUT}`);
if (problems) {
  console.error(`phone-qa: ${problems} page(s) flagged at a phone width`);
  process.exit(1);
}
console.log('phone-qa: every page fits 390px and 360px with no console errors');