// The spatial-hallucination audit, as an instrument.
//
// MSH asks one question of every region: why is this here, why this size,
// why this far from that? An answer of "the grid put it there" is a failed
// answer. A large footprint is a prompt to investigate, not a failure.
//
// Section 6 of the law is the part agents break: before declaring a pass,
// capture the REAL interface at 390, 1024 and 1440 px, and per viewport
// record chrome cost, task visibility, geometry failures, hierarchy and
// preservation. Source scans and green builds cannot prove a visual pass.
//
// This script measures and writes PNGs. It does NOT judge. The judgement is
// made by looking at the PNGs; the numbers tell you where to look.
//
//   node scripts/msh-audit.mjs
//   ATLAS_URL=http://127.0.0.1:8899 node scripts/msh-audit.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = process.env.CHROME_DEBUG_PORT || '9333';
const URL = process.env.ATLAS_URL || 'https://atlas.nonarkara.org';
const OUT = process.env.MSH_DIR || '/tmp/atlas-msh';
const PAGES = process.env.MSH_PAGES
  ? JSON.parse(process.env.MSH_PAGES)
  : [{ name: 'atlas', url: `${URL}/` }];

// 390x844 and 1440x900 are the law's first-screen sizes. 1024 is a laptop
// half-screen; its height is recorded so a reading can be reproduced.
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, dsf: 2, firstScreen: true },
  { name: 'half', width: 1024, height: 768, dsf: 1, firstScreen: false },
  { name: 'desk', width: 1440, height: 900, dsf: 1, firstScreen: true },
];

mkdirSync(OUT, { recursive: true });

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();

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
      return new Promise((r, j) => {
        const timer = setTimeout(() => {
          pending.delete(mid);
          j(new Error(`${method} did not answer in 60s`));
        }, 60000);
        pending.set(mid, {
          resolve: (v) => { clearTimeout(timer); r(v); },
          reject: (err) => { clearTimeout(timer); j(err); },
        });
      });
    },
    close: () => ws.close(),
  };
}

const browser = connect(version.webSocketDebuggerUrl);
await browser.ready;
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
for (const m of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable']) {
  await browser.send(m, {}, sessionId);
}
await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
// An occluded window makes the page hidden, the compositor suspends, and
// captureScreenshot never returns. A silent hang is a silent pass.
await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
await browser.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
}, sessionId);

const ev = async (expression) => {
  const r = await browser.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  }
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The measurement, run in the page. Everything here is a measurement, not a
// judgement: the numbers describe the interface, the PNGs decide about it.
const MEASURE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const doc = document.documentElement;

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ── chrome: the bands that sit above the map, top and bottom ──────────
  // Stacked sticky bands count together: two 40px bands cost 80px.
  // A band is a full-width strip anchored to the top or the bottom of the
  // viewport. It does not have to be fixed — on a page that scrolls, the
  // masthead is a grid row, and it still eats the first screen.
  const banded = [...document.querySelectorAll('body *')].filter((el) => {
    const s = getComputedStyle(el);
    const fixedish = s.position === 'fixed' || s.position === 'sticky';
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    // A wrapper that spans the whole screen is a container, not chrome —
    // measuring it reported the chrome cost as 100% of the viewport.
    if (r.height > vh * 0.4) return false;
    if (r.width < vw * 0.8) return false;
    if (fixedish) return r.top <= 2 || r.bottom >= vh - 2;
    // A non-fixed band counts when it starts at the top of the viewport.
    return r.top <= 4;
  });
  const topBands = [];
  const bottomBands = [];
  for (const el of banded) {
    const r = el.getBoundingClientRect();
    const entry = { tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className || '').slice(0, 60), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    if (r.top <= 4) topBands.push(entry);
    if (r.bottom >= vh - 2) bottomBands.push(entry);
  }
  const chromeTop = topBands.length ? Math.max(...topBands.map((b) => b.bottom)) : 0;
  const chromeBottom = bottomBands.length ? Math.min(...bottomBands.map((b) => b.top)) : vh;

  // ── task visibility: the map, the primary surface ─────────────────────
  const canvas = document.querySelector('canvas.maplibregl-canvas');
  const mapRect = canvas ? canvas.getBoundingClientRect() : null;

  // ── geometry failures ────────────────────────────────────────────────
  const overflow = { scrollW: doc.scrollWidth, clientW: doc.clientWidth, over: doc.scrollWidth - doc.clientWidth, offenders: [] };
  if (overflow.over > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        overflow.offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 50), right: Math.round(r.right), left: Math.round(r.left) });
      }
    }
    overflow.offenders = overflow.offenders.slice(0, 12);
  }

  // Tap targets: anything a finger has to hit. Only a touch viewport has a
  // minimum — a 17px label is fine under a mouse and unreadable under a
  // thumb, so the threshold follows the viewport, not the element.
  const touch = vw < 500;
  const minTap = touch ? 44 : 24;
  const small = [];
  for (const el of document.querySelectorAll('a, button, [role=button], input, select, summary')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    if (r.width < minTap || r.height < minTap) {
      small.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 44), label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }

  // Accidental wrapping: a label squeezed onto one or two characters a line.
  const cramped = [];
  for (const el of document.querySelectorAll('button, a, label, span, h1, h2, h3, p, li')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height < 14) continue;
    const text = (el.textContent || '').trim();
    if (text.length < 4) continue;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const lines = Math.round(r.height / lineHeight);
    if (lines > 1 && text.length / lines <= 2.5) {
      cramped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 44), text: text.slice(0, 24), lines, w: Math.round(r.width) });
    }
  }

  // Truncation: text that does not fit the box it was given. This is the
  // quiet one — the element still renders, the layout still "works", and the
  // visitor reads a fragment instead of the sentence. A cut word ("Flood
  // e…") is a spatial hallucination: the space is paid for and nothing is
  // delivered.
  const truncated = [];
  for (const el of document.querySelectorAll('h1, h2, h3, p, span, small, a, button, strong, em, li, div')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Only leaf-ish elements carry their own text.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (own.length < 4) continue;
    const style = getComputedStyle(el);
    let have = el.clientWidth;
    let need = el.scrollWidth;
    let mode = style.textOverflow === 'ellipsis' ? 'ellipsis' : 'clipped';
    if (style.display === 'inline') {
      // An inline box has no clientWidth — it reports 0 and the overflow
      // check silently passes. Measure the text itself against the block it
      // sits in.
      const range = document.createRange();
      range.selectNodeContents(el);
      need = Math.round(range.getBoundingClientRect().width);
      const parent = el.parentElement;
      have = parent ? Math.round(parent.getBoundingClientRect().width) : 0;
      mode = 'inline-overflow';
    }
    if (have <= 0) continue;
    if (need <= have + 1) continue;
    truncated.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 44),
      text: own.slice(0, 30),
      have,
      need,
      cut: Math.round(need - have),
      mode,
    });
  }

  // ── hierarchy: what competes for the first screen ────────────────────
  const firstScreen = [...document.querySelectorAll('a, button, [role=button]')].filter((el) => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= chromeTop + 1;
  });

  return {
    vw, vh,
    chromeTop, chromeBottom,
    chromeTopPct: Math.round((chromeTop / vh) * 1000) / 10,
    chromeBottomH: vh - chromeBottom,
    chromeBottomPct: Math.round(((vh - chromeBottom) / vh) * 1000) / 10,
    chromePct: Math.round(((chromeTop + (vh - chromeBottom)) / vh) * 1000) / 10,
    topBands, bottomBands,
    map: mapRect ? { x: Math.round(mapRect.x), y: Math.round(mapRect.y), w: Math.round(mapRect.width), h: Math.round(mapRect.height), areaPct: Math.round((mapRect.width * mapRect.height) / (vw * vh) * 1000) / 10 } : null,
    overflow,
    small: small.slice(0, 14),
    cramped: cramped.slice(0, 10),
    truncated: truncated.slice(0, 14),
    truncatedCount: truncated.length,
    firstScreenActions: firstScreen.length,
    firstScreenLabels: firstScreen.map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 22)),
  };
})()`;

const report = { at: new Date().toISOString(), url: URL, viewports: [] };

for (const page of PAGES) {
  for (const vp of VIEWPORTS) {
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf, mobile: vp.width < 500,
    }, sessionId);
    await browser.send('Page.navigate', { url: page.url }, sessionId);
    let booted = false;
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      // Boot is read from the DOM, not from window.__atlas: that handle only
      // exists with ?debug, and the audit must measure the plain page.
      try {
        if (await ev(`(()=>{
          const c = document.querySelector('canvas.maplibregl-canvas');
          // A page with no map at all is a static document, not a slow map.
          // Waiting the full minute for a canvas that will never exist
          // wastes the clock and teaches nothing.
          if (!c) return document.readyState === 'complete';
          if (c.width === 0 || c.height === 0) return false;
          // MapLibre adds the attribution control when the style is ready.
          return !!document.querySelector('.maplibregl-ctrl-attrib');
        })()`)) { booted = true; break; }
      } catch { /* booting */ }
    }
    await sleep(4000);
    // Assert the served page identifies ITSELF before measuring anything.
    // A preview port can already be held by another agent's project; the
    // server answers, the layout is deterministic, and every number is a
    // confident measurement of the WRONG app. This audit once measured a
    // Shanghai city app while aiming at the Bangkok atlas.
    // A page may declare what its own title must contain, so the check can
    // be as specific as the page deserves — the atlas papers are not the
    // atlas and would otherwise be refused or, worse, measured by proxy.
    const identity = await ev('document.title');
    const expected = page.expect ? new RegExp(page.expect, 'i') : /atlas|bkkx|bangkok/i;
    if (!expected.test(String(identity || ''))) {
      console.error(`\nREFUSING TO MEASURE: ${page.url} served "${identity}" — that is not ${page.expect || 'the atlas'}.`);
      await browser.send('Target.closeTarget', { targetId });
      browser.close();
      process.exit(2);
    }
    const m = await ev(MEASURE);
    const shot = Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64');
    const file = `${OUT}/${page.name}-${vp.name}.png`;
    writeFileSync(file, shot);
    report.viewports.push({ page: page.name, viewport: vp, booted, file, ...m });
    console.log(`\n── ${page.name} @ ${vp.width}x${vp.height} (dsf ${vp.dsf}) ──${booted ? '' : '  [MAP NEVER BOOTED]'}`);
    console.log(`  chrome    top ${m.chromeTop}px (${m.chromeTopPct}%)  bottom ${m.chromeBottomH}px (${m.chromeBottomPct}%)  total ${m.chromePct}%`);
    console.log(`  map       ${m.map ? `${m.map.w}x${m.map.h} at ${m.map.x},${m.map.y} — ${m.map.areaPct}% of the viewport` : 'NO MAP CANVAS'}`);
    console.log(`  overflow  ${m.overflow.over}px${m.overflow.offenders.length ? ` (${m.overflow.offenders.length} offender(s))` : ''}`);
    if (m.overflow.offenders.length) for (const o of m.overflow.offenders.slice(0, 5)) console.log(`     ${o.tag}.${o.cls} right=${o.right}`);
    console.log(`  small tap ${m.small.length} under 32px`);
    for (const s of m.small.slice(0, 6)) console.log(`     ${s.tag}.${s.cls} ${s.w}x${s.h} "${s.label}"`);
    console.log(`  cramped   ${m.cramped.length}`);
    for (const c of m.cramped.slice(0, 4)) console.log(`     ${c.tag}.${c.cls} "${c.text}" ${c.lines} lines in ${c.w}px`);
    console.log(`  truncated ${m.truncatedCount} element(s) cut short`);
    for (const t of m.truncated.slice(0, 6)) console.log(`     ${t.tag}.${t.cls} "${t.text}" ${t.have}px<-${t.need}px (-${t.cut}, ${t.mode})`);
    console.log(`  hierarchy ${m.firstScreenActions} action(s) in the top chrome: ${JSON.stringify(m.firstScreenLabels)}`);
  }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(`\nPNGs and report in ${OUT}`);
await browser.send('Target.closeTarget', { targetId });
browser.close();
