#!/usr/bin/env node
/**
 * smoke-atlas-api.mjs
 * --------------------
 * End-to-end smoke test for the /api/atlas/* AI-readable mirror.
 * Operator-runnable, no setup beyond network. Exits non-zero on any
 * failed assertion.
 *
 *   node scripts/smoke-atlas-api.mjs                       # default: live URL
 *   ATLAS_URL=http://localhost:8787 node scripts/...       # local wrangler dev
 *   ATLAS_URL=https://atlas.nonarkara.org node scripts/... # explicit
 *
 * Hits all six endpoints, asserts the basic shape of each, and prints
 * a one-line PASS/FAIL summary at the end. Designed to be the script
 * you run after `wrangler deploy` to know the city is still answering.
 */

const DEFAULT_URL = "https://atlas.nonarkara.org";
const baseUrl = (process.env.ATLAS_URL || DEFAULT_URL).replace(/\/+$/, "");

// Three known points to validate the at-this-point endpoint against.
// Each has a real human-readable name and an expected anchor.
const ANCHORS = [
  { name: "Baiyoke Tower II (Pratunam)",     lng: 100.5401, lat: 13.7547 },
  { name: "Grand Palace",                    lng: 100.4914, lat: 13.7500 },
  { name: "Don Mueang Airport",              lng: 100.6068, lat: 13.9128 },
];

const C = {
  reset: "\x1b[0m",
  dim:   "\x1b[2m",
  bold:  "\x1b[1m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  yel:   "\x1b[33m",
  cyan:  "\x1b[36m",
  gray:  "\x1b[90m",
};

const failures = [];
const passes = [];

function logOk(name, ms, extra = "") {
  passes.push(name);
  console.log(`  ${C.green}✓${C.reset} ${C.bold}${name}${C.reset} ${C.gray}${ms}ms${C.reset}${extra ? " " + C.dim + extra + C.reset : ""}`);
}
function logFail(name, reason) {
  failures.push({ name, reason });
  console.log(`  ${C.red}✗ ${C.bold}${name}${C.reset}  ${C.red}${reason}${C.reset}`);
}
function logInfo(msg) {
  console.log(`${C.cyan}${msg}${C.reset}`);
}

async function fetchJson(path, init = {}) {
  const t0 = Date.now();
  const res = await fetch(baseUrl + path, init);
  const ms = Date.now() - t0;
  const ct = res.headers.get("content-type") ?? "";
  const body = ct.includes("json") ? await res.json() : await res.text();
  return { ok: res.ok, status: res.status, body, ms, headers: res.headers };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function checkAreas() {
  const { ok, status, body, ms } = await fetchJson("/api/atlas/areas");
  if (!ok || status !== 200) return logFail("GET /api/atlas/areas", `status=${status}`);
  assert(body.tool === "atlas-areas", `tool=${body.tool}`);
  assert(typeof body.count === "number" && body.count > 0, `count=${body.count}`);
  assert(Array.isArray(body.areas) && body.areas.length === body.count, "areas length mismatch");
  const ids = body.areas.map((a) => a.id);
  assert(ids.includes("ratchathewi"), "missing ratchathewi");
  assert(ids.includes("rattanakosin"), "missing rattanakosin");
  logOk("GET /api/atlas/areas", ms, `count=${body.count}`);

  // Filtered sub-check.
  const filt = await fetchJson("/api/atlas/areas?category=historic-core");
  if (filt.ok && filt.body.tool === "atlas-areas" && filt.body.count >= 1) {
    const allHistoric = filt.body.areas.every((a) => a.category === "historic-core");
    if (allHistoric) logOk("  filter ?category=historic-core", filt.ms, `count=${filt.body.count}`);
    else logFail("  filter ?category=historic-core", "non-historic-core area in result");
  } else {
    logFail("  filter ?category=historic-core", `status=${filt.status}`);
  }
}

async function checkDistricts() {
  const { ok, status, body, ms } = await fetchJson("/api/atlas/districts");
  if (!ok || status !== 200) return logFail("GET /api/atlas/districts", `status=${status}`);
  assert(body.tool === "atlas-districts", `tool=${body.tool}`);
  assert(body.count === 50, `count=${body.count} (expected 50)`);
  const withPrice = body.districts.filter((d) => d.landPrice?.peakNewPrice != null).length;
  logOk("GET /api/atlas/districts", ms, `count=${body.count} price-known=${withPrice}`);
}

async function checkAtThisPoint() {
  for (const a of ANCHORS) {
    const path = `/api/atlas/at-this-point?lng=${a.lng}&lat=${a.lat}`;
    const { ok, status, body, ms } = await fetchJson(path);
    if (!ok || status !== 200) {
      logFail(`GET /api/atlas/at-this-point @ ${a.name}`, `status=${status}`);
      continue;
    }
    assert(body.tool === "atlas-at-this-point", `tool=${body.tool}`);
    assert(body.query.lng === a.lng && body.query.lat === a.lat, "query echo wrong");
    assert(body.summary, "missing summary");
    assert(body.disclaimer, "missing disclaimer");
    const d = body.district?.nameEn ?? "(no district)";
    const lp = body.landPrice?.peakNewPrice != null ? `฿${body.landPrice.peakNewPrice.toLocaleString()}/sq.wah` : "no price";
    const nt = body.nearestTransit ? `${body.nearestTransit.line} ${body.nearestTransit.distanceM}m` : "no transit";
    const fl = body.flood.inside ? `flood:${body.flood.severity}` : "flood:clear";
    logOk(`GET /api/atlas/at-this-point @ ${a.name}`, ms, `${d} · ${lp} · ${nt} · ${fl}`);
  }

  // Error path: out-of-bbox.
  const bad = await fetchJson("/api/atlas/at-this-point?lng=0&lat=0");
  if (!bad.ok && bad.status === 400 && bad.body?.error === "out_of_bangkok_bbox") {
    logOk("  /at-this-point rejects out-of-bbox", bad.ms, "400 out_of_bangkok_bbox");
  } else {
    logFail("  /at-this-point rejects out-of-bbox", `expected 400, got ${bad.status}`);
  }
}

async function checkTransit() {
  // Victory Monument (transit-rich).
  const path = "/api/atlas/transit?lng=100.5383&lat=13.7649&radius=2000&limit=3";
  const { ok, status, body, ms } = await fetchJson(path);
  if (!ok || status !== 200) return logFail("GET /api/atlas/transit", `status=${status}`);
  assert(body.tool === "atlas-transit", `tool=${body.tool}`);
  assert(body.count >= 1, `count=${body.count} (expected ≥1 near Victory Monument)`);
  const first = body.segments[0];
  logOk("GET /api/atlas/transit @ Victory Monument", ms, `${body.count} within ${body.query.radiusM}m, closest=${first?.line} ${first?.distanceM}m`);
}

async function checkBuildings() {
  const { ok, status, body, ms } = await fetchJson("/api/atlas/buildings?bbox=100.49,13.74,100.52,13.76&limit=100");
  if (!ok || status !== 200) return logFail("GET /api/atlas/buildings", `status=${status}`);
  assert(body.tool === "atlas-buildings", `tool=${body.tool}`);
  assert(body.buildings.totalMetro === 432077, `totalMetro=${body.buildings.totalMetro}`);
  assert(body.buildings.metroPmtiles.url === "/bkk-buildings.pmtiles", "pmtiles url wrong");
  assert(body.buildings.metroPmtiles.reachable === true, "pmtiles not reachable from worker");
  logOk("GET /api/atlas/buildings", ms, `PMTiles ${(body.buildings.metroPmtiles.sizeBytes / 1024 / 1024).toFixed(1)}MB reachable=${body.buildings.metroPmtiles.reachable}`);

  // Bad bbox.
  const bad = await fetchJson("/api/atlas/buildings?bbox=garbage");
  if (!bad.ok && bad.status === 400) {
    logOk("  /buildings rejects malformed bbox", bad.ms, "400 invalid_bbox");
  } else {
    logFail("  /buildings rejects malformed bbox", `expected 400, got ${bad.status}`);
  }
}

async function checkScoreboard() {
  const { ok, status, body, ms } = await fetchJson("/api/atlas/scoreboard");
  if (!ok || status !== 200) return logFail("GET /api/atlas/scoreboard", `status=${status}`);
  assert(body.tool === "atlas-scoreboard", `tool=${body.tool}`);
  assert(body.buildings.totalMetro === 432077, "buildings totalMetro wrong");
  assert(body.districts === 50, "districts wrong");
  assert(body.rail.lines === 9, `rail.lines=${body.rail.lines}`);
  assert(body.rail.segments === 126, `rail.segments=${body.rail.segments}`);
  assert(body.khlongs.total === 4063, `khlongs.total=${body.khlongs.total}`);
  assert(body.feeds.traffic, "missing traffic feed");
  assert(body.feeds.rain, "missing rain feed");
  logOk("GET /api/atlas/scoreboard", ms, `${body.buildings.totalMetro} buildings · ${body.rail.lines} rail · traffic.configured=${body.feeds.traffic.configured}`);
}

async function main() {
  logInfo(`\n  BKKx 3D Atlas — AI-readable mirror smoke test`);
  logInfo(`  target: ${baseUrl}\n`);

  // Quick reachability check.
  try {
    const home = await fetch(baseUrl + "/", { method: "HEAD" });
    if (!home.ok) throw new Error(`homepage HEAD status=${home.status}`);
    logInfo(`  ${C.gray}homepage reachable: ${home.status}${C.reset}\n`);
  } catch (err) {
    logFail("homepage reachability", String(err));
    return summarize();
  }

  await checkAreas();
  await checkDistricts();
  await checkAtThisPoint();
  await checkTransit();
  await checkBuildings();
  await checkScoreboard();

  summarize();
}

function summarize() {
  console.log();
  if (failures.length === 0) {
    logInfo(`  ${C.green}${C.bold}ALL PASS${C.reset} ${C.gray}(${passes.length} checks)${C.reset}\n`);
    process.exit(0);
  } else {
    logInfo(`  ${C.red}${C.bold}FAILED${C.reset} ${C.gray}(${failures.length} of ${passes.length + failures.length})${C.reset}\n`);
    for (const f of failures) logFail(f.name, f.reason);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n  ${C.red}smoke test crashed${C.reset}: ${err.stack || err.message}\n`);
  process.exit(2);
});
