#!/usr/bin/env node
/**
 * Headless screenshots and a frame-time sample for the Landmarks layer.
 *
 *   node scripts/shoot-wireframe-landmarks.mjs [out-dir]
 *
 * Serves public/ locally, opens the atlas in headless Chrome, and writes
 * one map clip per landmark at 1440×900 and 390×844. Prints perf JSON.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIRE_LANDMARKS } from "../public/wireframe-geometry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] || "/opt/cursor/artifacts/landmarks";
const port = 8765;
mkdirSync(outDir, { recursive: true });

const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: join(root, "public"),
  stdio: "ignore",
});

const chrome = spawn("google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--remote-debugging-port=9222",
  "--user-data-dir=/tmp/atlas-wire-chrome",
  "--window-size=1440,900",
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9222/json/version");
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* chrome still booting */ }
    await sleep(250);
  }
  throw new Error("Chrome DevTools did not open");
}

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  let seq = 0;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() { ws.close(); },
  };
}

async function main() {
  await sleep(300);
  const ws = connect(await browserSocket());
  await ws.ready;
  const { targetId } = await ws.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await ws.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => ws.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.enable").catch(() => {});

  const perf = {};
  for (const viewport of [{ name: "desktop", width: 1440, height: 900, dsf: 1 }, { name: "phone", width: 390, height: 844, dsf: 2 }]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dsf,
      mobile: viewport.name === "phone",
    });
    perf[viewport.name] = await measure(send, viewport);
    await shootAll(send, viewport);
  }

  const perfPath = join(outDir, "perf.json");
  writeFileSync(perfPath, JSON.stringify(perf, null, 2));
  console.log(JSON.stringify(perf, null, 2));
  console.log(`wrote ${perfPath}`);
  ws.close();
  chrome.kill();
  server.kill();
}

async function measure(send, viewport) {
  const url = `http://127.0.0.1:${port}/?debug=1`;
  await send("Page.navigate", { url });
  await evalJson(send, waitForMap, 25000);
  const before = await evalJson(send, () => {
    const nav = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
    return {
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      landmarkResources: resources.filter((name) => /wireframe|three\.module/.test(name)),
    };
  });
  const baseline = await evalJson(send, frameSample, 8000);
  await evalJson(send, () => {
    const toggle = document.querySelector("#toggle-wire-landmarks");
    if (!toggle) return false;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    return true;
  });
  const ready = await evalJson(send, waitForWire, 25000);
  const withLayer = await evalJson(send, frameSample, 8000);
  const after = await evalJson(send, () => {
    const resources = performance.getEntriesByType("resource")
      .filter((entry) => /wireframe|three\.module/.test(entry.name))
      .map((entry) => ({
        name: entry.name.split("/").pop(),
        durationMs: Math.round(entry.duration),
        transferBytes: entry.transferSize || entry.encodedBodySize || 0,
      }));
    return { resources, stats: window.__bkkxWireStats || null };
  });
  return { viewport, before, baseline, ready, withLayer, after };
}

async function shootAll(send, viewport) {
  const first = WIRE_LANDMARKS[0];
  const url = `http://127.0.0.1:${port}/?debug=1&landmarks=1&at=${first.lng},${first.lat},${first.shot.zoom}`;
  await send("Page.navigate", { url });
  const ready = await evalJson(send, waitForWire, 25000);
  if (!ready) throw new Error(`landmarks did not draw at ${viewport.name}`);
  for (const spec of WIRE_LANDMARKS) {
    await evalJson(send, (shot) => new Promise((resolve) => {
      const map = window.__atlas.map;
      map.jumpTo({
        center: [shot.lng, shot.lat],
        zoom: shot.zoom,
        pitch: shot.pitch,
        bearing: shot.bearing,
      });
      map.resize();
      setTimeout(resolve, 1800);
    }), 8000, { ...spec.shot, lng: spec.lng, lat: spec.lat });
    const rect = await evalJson(send, () => {
      const box = document.querySelector("#atlas-map").getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
    });
    const file = join(outDir, `${spec.id}-${viewport.name}.png`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(file, `${Math.round(rect.width)}x${Math.round(rect.height)}`);
  }
}

async function evalJson(send, fn, timeoutMs, arg) {
  const expression = `(${fn})(${arg === undefined ? "" : JSON.stringify(arg)})`;
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "page eval failed");
  }
  return result.result.value;
}

function waitForMap() {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (window.__atlas?.map?.loaded?.() && performance.now() - start > 1200) resolve(true);
      else if (performance.now() - start > 20000) resolve(false);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function waitForWire() {
  return new Promise((resolve) => {
    if (window.__bkkxWireReady) {
      resolve(window.__bkkxWireStats);
      return;
    }
    const timer = setTimeout(() => resolve(null), 20000);
    window.addEventListener("bkkx-wireframes-ready", (event) => {
      clearTimeout(timer);
      resolve(event.detail);
    }, { once: true });
  });
}

function frameSample() {
  return new Promise((resolve) => {
    const map = window.__atlas?.map;
    const samples = [];
    let last = performance.now();
    const start = last;
    if (map) map.panBy([120, 30], { duration: 1600 });
    const tick = (now) => {
      samples.push(now - last);
      last = now;
      if (now - start < 1800) requestAnimationFrame(tick);
      else {
        samples.sort((a, b) => a - b);
        const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
        resolve({
          frames: samples.length,
          avgMs: Math.round(avg * 10) / 10,
          p95Ms: Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] * 10) / 10,
          fps: Math.round(1000 / avg),
        });
      }
    };
    requestAnimationFrame(tick);
  });
}

main().catch((error) => {
  console.error(error);
  chrome.kill();
  server.kill();
  process.exit(1);
});
