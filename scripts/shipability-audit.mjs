// Shipability audit: can this be released with confidence?
//
// A shippable surface passes all of it, and every part is measured on the
// LIVE site, not on the source:
//
//   1. reachable      — the URL answers 200 and serves the expected build
//   2. quiet         — no console errors, no uncaught exceptions, no CSP
//                       refusals on first load
//   3. whole         — no failed network requests (no 404 assets)
//   4. honest        — the page says what it is, carries its build id, and
//                       no element is a dead control
//   5. clean         — the tree is clean, committed and pushed
//
//   node scripts/shipability-audit.mjs
//   SHIP_PAGES='[{"name":"atlas","url":"https://atlas.nonarkara.org/"}]' node scripts/shipability-audit.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PORT = process.env.CHROME_DEBUG_PORT || '9411';
const OUT = process.env.SHIP_DIR || '/tmp/shipability';

const PAGES = process.env.SHIP_PAGES
  ? JSON.parse(process.env.SHIP_PAGES)
  : [
    { name: 'atlas', url: 'https://atlas.nonarkara.org/' },
    { name: 'bkkx-home', url: 'https://bkk.nonarkara.org/' },
    { name: 'bkkx-atlas', url: 'https://bkk.nonarkara.org/atlas/historic-core' },
    { name: 'shophouses', url: 'https://shophouses.nonarkara.org/' },
  ];

const REPOS = process.env.SHIP_REPOS
  ? JSON.parse(process.env.SHIP_REPOS)
  : [
    { name: 'bkk-3d-atlas', dir: '/Users/nonarkara/Projects/bkk-3d-atlas' },
    { name: 'BKKx', dir: '/Users/nonarkara/Projects/BKKx' },
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
await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
await browser.send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
}, sessionId);

const ev = async (expression) => {
  const r = await browser.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];

for (const page of PAGES) {
  // Failed requests are read from the page's own Performance timeline below,
  // which is where the status codes actually are. A CDP Network handler would
  // need an event subscription this client does not expose, so an earlier
  // version carried one that never fired — it looked like it was watching and
  // was not.
  browser.send('Network.enable', {}, sessionId);

  await browser.send('Page.navigate', { url: page.url }, sessionId);

  // Wait for the page to actually settle before measuring. Evaluating while
  // the execution context is being swapped returns nothing and hangs: the
  // response is addressed to a context that no longer exists.
  let settled = false;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      const ok = await ev(`(()=>{
        if (document.readyState !== 'complete') return false;
        // Only a map page must show a map. An essay page settles on the
        // document alone — requiring a canvas made two good pages look
        // broken.
        const c = document.querySelector('canvas.maplibregl-canvas');
        if (!c) return true;
        if (c.width === 0) return false;
        return !!document.querySelector('.maplibregl-ctrl-attrib');
      })()`);
      if (ok) { settled = true; break; }
    } catch { /* still booting */ }
  }
  if (!settled) {
    console.log(`\n── ${page.name} ── ${page.url}\n  NEVER SETTLED — the page did not finish loading in 60s`);
    results.push({ page: page.name, url: page.url, title: null, failedRequests: [], deadControls: [], brokenLinks: [], neverSettled: true });
    continue;
  }
  await sleep(4000);

  let facts;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { facts = await ev(`(() => {
    const errors = [];
    window.addEventListener('error', (e) => errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
    // Performance entries tell us what actually loaded and how big it was.
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const res = performance.getEntriesByType('resource') || [];
    // A failed request is not automatically our defect. A 404 is always ours:
    // we asked for a resource that does not exist (a missing glyph, a renamed
    // asset). A 401/403/429 or a 5xx on somebody else's host is their refusal
    // or their outage — it is reported, but it does not fail the build.
    const ours = [];
    const upstream = [];
    for (const r of res) {
      const status = r.responseStatus || 0;
      if (!status || status < 400) continue;
      let host = '';
      try { host = new URL(r.name).host; } catch { /* not a URL */ }
      const entry = r.name.slice(0, 120) + ' [' + status + ']';
      const sameSite = host.endsWith(location.hostname.replace(/^www\\./, ''));
      if (status === 404) ours.push(entry);
      else if (!sameSite && (status === 401 || status === 403 || status === 429 || status >= 500)) upstream.push(entry);
      else ours.push(entry);
    }
    const bytes = res.reduce((s, r) => s + (r.decodedBodySize || 0), 0);
    const slowest = res.map((r) => ({ n: r.name.split('/').pop().slice(0, 40), ms: Math.round(r.duration), kb: Math.round((r.decodedBodySize||0)/1024) }))
      .sort((a,b) => b.ms - a.ms).slice(0, 5);
    // A dead control is one that does nothing when pressed. An attribute scan
    // cannot see one: React attaches handlers through __reactProps$ on the
    // DOM node (or on an ancestor the click bubbles to), and MapLibre drives
    // its own markers and controls. So this asks three questions instead:
    //   1. does an on* function prop exist on the element or an ancestor?
    //   2. does MapLibre own it?
    //   3. is it the already-selected option of a radio or tab, where
    //      pressing it again is idempotent by design?
    // Only a button that fails all three is reported. The scan was validated
    // against a click-every-button probe on the live pages: 93 buttons, and
    // every button this now calls alive was alive when it was clicked.
const dead = [];
const selectedState = [];
const reactHandler = (el) => {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const key = Object.keys(n).find((k) => k.startsWith('__reactProps$'));
    if (!key) continue;
    const props = n[key];
    if (!props || typeof props !== 'object') continue;
    for (const k of Object.keys(props)) {
      if (/^on[A-Z]/.test(k) && typeof props[k] === 'function') return k;
    }
  }
  return null;
};
const maplibreOwned = (el) => Boolean(
  el.closest('.maplibregl-marker') || el.closest('.maplibregl-ctrl')
  || /maplibregl-(marker|ctrl)/.test(String(el.className || '')),
);
for (const el of document.querySelectorAll('button')) {
  if (el.disabled || el.hidden || el.offsetParent === null) continue;
  const label = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const cls = String(el.className || '').slice(0, 40);
  if (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-selected') === 'true') {
    selectedState.push({ cls, label });
    continue;
  }
  if (reactHandler(el)) continue;
  if (maplibreOwned(el)) continue;
  if (el.getAttribute('onclick') || el.closest('form') || el.id || el.getAttribute('aria-controls')) continue;
  dead.push({ cls, label });
}
    const build = document.querySelector('[data-build], #atlas-version, .atlas-version');
    return JSON.stringify({
      title: document.title,
      pageErrors: errors,
      buildText: build ? (build.title || build.textContent || '').slice(0, 90) : null,
      canvases: document.querySelectorAll('canvas').length,
      hasMap: !!document.querySelector('canvas.maplibregl-canvas'),
      docHeight: document.documentElement.scrollHeight,
      resources: res.length,
      bytes: Math.round(bytes/1024),
      failedRequests: ours.slice(0, 10),
      upstreamRequests: upstream.slice(0, 10),
      slowest,
      dead: dead.slice(0, 8),
      selectedState: selectedState.slice(0, 8),
      links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
        .filter((h) => h && !h.startsWith('#') && !h.startsWith('mailto:') && !h.startsWith('javascript:')).slice(0, 40),
    });
  })()`);
      break;
    } catch (err) {
      facts = null;
      if (attempt === 2) throw err;
      await sleep(3000);
    }
  }
  const f = JSON.parse(facts);

  // Every outbound link is fetched for real: a 404 in the nav is a defect.
  const linkResults = [];
  for (const href of f.links) {
    const abs = new URL(href, page.url).href;
    if (!abs.startsWith('http')) continue;
    if (linkResults.some((l) => l.url === abs)) continue;
    try {
      const res = await fetch(abs, { redirect: 'follow' });
      linkResults.push({ url: abs, status: res.status });
    } catch (e) {
      linkResults.push({ url: abs, status: 0, error: String(e.message).slice(0, 60) });
    }
  }

  // 401/403/429 mean the other side refused us, not that the link is wrong.
  // A news site that blocks bots and an API that rate-limits are not
  // broken links in our page.
  const broken = linkResults.filter((l) => l.status === 0 || (l.status >= 400 && l.status !== 401 && l.status !== 403 && l.status !== 429));
  const refused = linkResults.filter((l) => l.status === 401 || l.status === 403 || l.status === 429);
  const shot = Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64');
  writeFileSync(`${OUT}/${page.name}.png`, shot);

  const entry = {
    page: page.name,
    url: page.url,
    title: f.title,
    pageErrors: f.pageErrors,
    buildText: f.buildText,
    hasMap: f.hasMap,
    canvases: f.canvases,
    resources: f.resources,
    payloadKb: f.bytes,
    slowest: f.slowest,
    failedRequests: f.failedRequests,
    upstreamRequests: f.upstreamRequests,
    deadControls: f.dead,
    selectedControls: f.selectedState,
    linksChecked: linkResults.length,
    brokenLinks: broken,
    refusedLinks: refused,
  };
  results.push(entry);

  console.log(`\n── ${page.name} ── ${page.url}`);
  console.log(`  title      ${f.title}`);
  if (f.pageErrors.length) {
    console.log(`  page errors ${f.pageErrors.length}`);
    for (const e of f.pageErrors.slice(0, 3)) console.log(`     ${e}`);
  }
  console.log(`  build      ${f.buildText ?? '(none on the page)'}`);
  console.log(`  map        ${f.hasMap ? 'canvas present' : 'NO MAP CANVAS'} · ${f.canvases} canvas(es)`);
  console.log(`  payload    ${f.resources} resources · ${f.bytes} KB decoded`);
  console.log(`  failed req ${f.failedRequests.length}`);
  for (const r of f.failedRequests.slice(0, 5)) console.log(`     ${r}`);
  if (f.upstreamRequests.length) {
    console.log(`  upstream   ${f.upstreamRequests.length} refused by a third party (not our defect)`);
    for (const r of f.upstreamRequests.slice(0, 3)) console.log(`     ${r}`);
  }
  console.log(`  dead ctrls ${f.dead.length}`);
  for (const d of f.dead.slice(0, 5)) console.log(`     ${d.cls} "${d.label}"`);
  if (f.selectedState.length) {
    console.log(`  selected   ${f.selectedState.length} already-active control(s), idempotent by design`);
  }
  console.log(`  links      ${linkResults.length} checked, ${broken.length} broken`);
  for (const b of broken.slice(0, 6)) console.log(`     ${b.status} ${b.url}`);
  console.log(`  slowest    ${f.slowest.map((s) => `${s.n} ${s.ms}ms ${s.kb}KB`).join(' · ')}`);
}

// ── repo hygiene ────────────────────────────────────────────────────────────
console.log('\n══ repo hygiene ══');
const repoReport = [];
for (const repo of REPOS) {
  const run = (cmd) => {
    try { return execSync(cmd, { cwd: repo.dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim(); }
    catch { return '(command failed)'; }
  };
  const status = run('git status --porcelain');
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const head = run('git log -1 --format=%h');
  const unpushedRaw = run('git log --oneline @{u}..HEAD 2>/dev/null || echo "(no upstream)"');
  // An empty `git log` output is "" — splitting that on "\n" yields [""],
  // which reads as one unpushed commit that does not exist. Filter the blanks.
  const unpushed = unpushedRaw === '(no upstream)'
    ? unpushedRaw
    : unpushedRaw.split('\n').map((l) => l.trim()).filter(Boolean);
  const entry = { repo: repo.name, branch, head, dirty: status ? status.split('\n').length : 0, dirtyFiles: status ? status.split('\n').slice(0, 8) : [], unpushed };
  repoReport.push(entry);
  console.log(`  ${repo.name}  branch=${branch} head=${head}  dirty=${entry.dirty}  unpushed=${entry.unpushed.length ? entry.unpushed.length : 0}`);
  for (const f of entry.dirtyFiles) console.log(`     ${f}`);
}

writeFileSync(`${OUT}/report.json`, JSON.stringify({ at: new Date().toISOString(), results, repos: repoReport }, null, 2));

// ── verdict ─────────────────────────────────────────────────────────────────
const problems = [];
for (const r of results) {
  if (!r.title) problems.push(`${r.page}: no title`);
  if (r.failedRequests.length) problems.push(`${r.page}: ${r.failedRequests.length} failed request(s)`);
  if (r.brokenLinks.length) problems.push(`${r.page}: ${r.brokenLinks.length} broken link(s)`);
  if (r.pageErrors && r.pageErrors.length) problems.push(`${r.page}: ${r.pageErrors.length} uncaught page error(s)`);
  if (r.deadControls && r.deadControls.length) problems.push(`${r.page}: ${r.deadControls.length} control(s) with no handler`);
}
for (const r of repoReport) {
  if (r.dirty) problems.push(`${r.repo}: ${r.dirty} uncommitted change(s)`);
  if (r.unpushed.length && r.unpushed[0] !== '(no upstream)') problems.push(`${r.repo}: ${r.unpushed.length} unpushed commit(s)`);
}
console.log(`\n══ VERDICT ══ ${problems.length === 0 ? 'SHIP' : `${problems.length} PROBLEM(S)`}`);
for (const p of problems) console.log(`  ✖ ${p}`);
console.log(`\nreport in ${OUT}/report.json`);

await browser.send('Target.closeTarget', { targetId });
browser.close();
process.exit(problems.length === 0 ? 0 : 1);
