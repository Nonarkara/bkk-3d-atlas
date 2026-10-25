// Phone QA must be able to fail.
//
// The first version of phone-qa.mjs hung on Page.captureScreenshot, printed
// nothing, and still exited 0. Root cause: the Chrome window was occluded, so
// document.visibilityState was "hidden", Chrome suspended the compositor, and
// captureScreenshot never answered. An unsettled top-level await is not an
// error in Node — the process just ends, successfully.
//
// So the guard here is behavioural rather than a source scan: run the real
// script against a fake CDP server and watch what it does. A source test would
// have been satisfied by the very comments that document the bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'phone-qa.mjs');

// A 1x1 PNG, so a screenshot is a real capture the script can decode.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Run the harness's overflow probe against a DOM that behaves like a browser.
 *
 * The one behaviour that matters: when a page's content is wider than the
 * screen, Chrome widens the layout viewport, so window.innerWidth reports the
 * CONTENT width while documentElement.clientWidth stays at the screen width.
 * A probe that measures against innerWidth therefore sees nothing past the
 * edge and returns an empty offender list — the failure this suite guards.
 */
function runProbe(expr, dom, emulated) {
  const viewWidth = emulated;
  const layoutWidth = Math.max(viewWidth, dom.contentWidth ?? viewWidth);
  const documentElement = {
    clientWidth: viewWidth,
    scrollWidth: layoutWidth,
  };
  const sandbox = {
    document: {
      documentElement,
      querySelectorAll: () =>
        (dom.elements ?? []).map((e) => ({
          tagName: e.tag ?? 'DIV',
          className: e.cls ?? '',
          getBoundingClientRect: () => ({
            width: e.left ?? 0,
            height: 20,
            left: 0,
            right: e.left ?? 0,
          }),
        })),
    },
    window: { innerWidth: layoutWidth },
  };
  return runInNewContext(expr, sandbox);
}

/**
 * A CDP endpoint that answers whatever it is asked and records the calls.
 *
 * @param opts.stallOn  never answer this method, to simulate a hung renderer
 * @param opts.dom      geometry the overflow probe should measure
 * @param opts.evalValues map of expression-substring -> value to return
 */
async function fakeChrome({ stallOn = null, dom = {}, evalValues = {} } = {}) {
  const commands = [];
  // The width most recently emulated, so a viewport probe answers honestly for
  // whichever device the harness is currently on.
  let emulated = 390;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/ws` }));
  });
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      commands.push({ method: msg.method, params: msg.params });
      if (msg.method === stallOn) return; // deliberately never answer

      let result = {};
      if (msg.method === 'Target.createTarget') result = { targetId: 'T1' };
      else if (msg.method === 'Target.attachToTarget') result = { sessionId: 'S1' };
      else if (msg.method === 'Page.captureScreenshot') result = { data: PNG_1PX };
      else if (msg.method === 'Emulation.setDeviceMetricsOverride') emulated = msg.params.width;
      else if (msg.method === 'Runtime.evaluate') {
        const expr = msg.params?.expression ?? '';
        let value = null;
        for (const [needle, v] of Object.entries(evalValues)) {
          if (expr.includes(needle)) { value = typeof v === 'function' ? v(emulated) : v; break; }
        }
        if (value === null && expr.includes('readyState')) value = true;
        if (value === null && expr.includes('w: window.innerWidth')) {
          value = { w: emulated, cw: emulated, dpr: 2, vis: 'visible' };
        }
        // Anything else is the overflow probe. Run the harness's own expression
        // against a fake DOM rather than handing back a canned answer: a canned
        // answer cannot tell whether the probe measures the right width, which
        // is exactly the bug this suite exists to catch. Mutation testing proved
        // it — swapping documentElement.clientWidth for window.innerWidth inside
        // phone-qa.mjs left every test green while the offender list silently
        // came back empty on a real overflow.
        if (value === null) value = runProbe(expr, dom, emulated);
        result = { result: { value } };
      }
      ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result }));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, commands, close: () => new Promise((r) => { wss.close(); server.close(r); }) };
}

function runScript(port, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        CHROME_DEBUG_PORT: String(port),
        PHONE_DIR: extraEnv.PHONE_DIR || '/tmp/phone-qa-test',
        PHONE_TIMEOUT_MS: '1500',
        PHONE_SETTLE_MS: '10',
        PHONE_PAGES: JSON.stringify([{ name: 'probe', url: 'https://example.test/' }]),
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });

    // A guard that hangs is not a guard. This test exists precisely to catch an
    // unbounded CDP call, so it must not wait forever when that call comes back.
    // Without this, deleting the timeout inside phone-qa.mjs hangs the suite
    // instead of failing it — found by mutation testing this very file.
    //
    // The bound is wall-clock, and this machine is shared: another agent's
    // browsers have taken the load average past 300, and a script that needs
    // two seconds of CPU can then miss a twenty-second wall clock. The guard
    // fired on a loaded machine four times out of four and the suite was
    // green on an idle one — the failure was the guard, not the thing it
    // guards. The inner timeout is 1.5 s, so ninety seconds still catches a
    // broken one with sixty times the headroom, and it cannot be tripped by a
    // starved CPU.
    const killer = setTimeout(() => { out += '\n[harness killed: it never exited]'; p.kill('SIGKILL'); }, 90000);
    p.on('close', (code) => { clearTimeout(killer); resolve({ code, out }); });
  });
}

// Echo whatever width is currently emulated, so a device-width assertion is
// actually being exercised at both 390 and 360.
const VIEWPORT = (w) => ({ w, cw: w, dpr: 2, vis: 'visible' });

test('a hung screenshot fails the run instead of exiting 0', async () => {
  const fx = await fakeChrome({ stallOn: 'Page.captureScreenshot', evalValues: { 'w: window.innerWidth': VIEWPORT } });
  const { code, out } = await runScript(fx.port);
  await fx.close();

  assert.equal(code, 1, `a stalled capture must exit non-zero. Output:\n${out}`);
  assert.match(out, /did not answer/, 'the failure must say which call hung');
  assert.doesNotMatch(out, /every page fits/, 'it must not claim a pass it never measured');
});

test('an overflowing document is reported and fails the run', async () => {
  const fx = await fakeChrome({
    evalValues: { 'w: window.innerWidth': VIEWPORT },
    dom: { contentWidth: 600, elements: [{ tag: 'DIV', cls: 'wide', left: 600 }, { tag: 'DIV', cls: 'offender', left: 520 }] },
  });
  const { code, out } = await runScript(fx.port);
  await fx.close();

  assert.equal(code, 1, `overflow must fail the run. Output:\n${out}`);
  assert.match(out, /horizontal overflow by 210px/, 'the overflow size must be stated');
  assert.match(out, /div\.wide \+210px/, 'the offending element must be named, not just counted');
});

test('a clean page passes and the focus fix is actually sent', async () => {
  const fx = await fakeChrome({ evalValues: { 'w: window.innerWidth': VIEWPORT } });
  const { code, out } = await runScript(fx.port);
  const commands = fx.commands;
  await fx.close();

  assert.equal(code, 0, `a clean page must pass. Output:\n${out}`);
  assert.match(out, /every page fits/, 'a pass must be stated');

  // Without this the capture hangs whenever the window is occluded.
  assert.ok(
    commands.some((c) => c.method === 'Emulation.setFocusEmulationEnabled'),
    'the harness must ask the renderer to act focused, or it hangs behind another window',
  );

  // Both widths really must be emulated; --window-size would clamp to 500.
  const widths = commands
    .filter((c) => c.method === 'Emulation.setDeviceMetricsOverride')
    .map((c) => c.params.width);
  assert.deepEqual([...new Set(widths)].sort((a, b) => a - b), [360, 390], 'both phone widths must be emulated');
  assert.ok(
    commands.some((c) => c.method === 'Network.setCacheDisabled'),
    'a cached render would prove nothing about what a phone loads',
  );
});

test('a widened layout viewport still reports the device width, not the content width', async () => {
  // innerWidth widened to the content width: the classic mobile fallback when a
  // page has no viewport meta. clientWidth stays honest at the device width.
  const fx = await fakeChrome({
    evalValues: {
      'w: window.innerWidth': (w) => ({ w: 980, cw: w, dpr: 2, vis: 'visible' }),
    },
  });
  const { code, out } = await runScript(fx.port);
  await fx.close();

  assert.equal(code, 0, `clientWidth is the honest measure here, so this should pass. Output:\n${out}`);
  assert.match(out, /viewport=390px/, 'the reported width must be clientWidth, not the content width');
  assert.match(out, /viewport=360px/, 'and it must hold at the narrower width too');
  assert.doesNotMatch(out, /emulation did not take/, 'a correct page must not be accused of a broken viewport');
});