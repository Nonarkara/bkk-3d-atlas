#!/usr/bin/env node
/**
 * smoke-atlas-api.mjs
 * --------------------
 * End-to-end smoke test for the atlas public API surface — the six
 * /api/atlas/* AI-readable mirror endpoints PLUS the six raw feed
 * proxies (/api/traffic, /api/risk, /api/cctv, /api/flood-sensors,
 * /api/civic-pois, /api/city-events). Operator-runnable, no setup
 * beyond network. Exits non-zero on any failed assertion.
 *
 *   node scripts/smoke-atlas-api.mjs                       # default: live URL
 *   ATLAS_URL=http://localhost:8787 node scripts/...       # local wrangler dev
 *   ATLAS_URL=https://atlas.nonarkara.org node scripts/... # explicit
 *
 * Designed to be the script you run after `wrangler deploy` to know
 * the city is still answering. Also locks in three contracts that are
 * easy to silently break:
 *   - /api/atlas/* shape (areas, districts, at-this-point, transit,
 *     buildings, scoreboard)
 *   - /api/traffic 200-with-configured-false contract (the previous
 *     503 contract threw two console errors on every visitor's page
 *     load — see commit c84e3c6 / version 95f4c4d8)
 *   - /api/city-events "no fabricated coordinates" promise (every
 *     feature must have finite coords inside the Bangkok bbox; if a
 *     future change drops the bbox filter, this is the canary — see
 *     commit 4845de0)
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
  // The scoreboard should list EVERY live feed the atlas actually pulls
  // from, not just the ones that pre-date the city-events layer. If a new
  // feed is added, this list is the place that tells the world.
  assert(body.feeds.cityEvents, "scoreboard missing cityEvents feed");
  assert(body.feeds.cityEvents.endpoint === "/api/city-events", `cityEvents.endpoint=${body.feeds.cityEvents.endpoint}`);
  assert(body.feeds.cityEvents.ttlMinutes === 60, `cityEvents.ttlMinutes=${body.feeds.cityEvents.ttlMinutes}`);
  assert(body.feeds.newsEvents, "scoreboard missing newsEvents feed (Buzz layer added 2026-08-10)");
  assert(body.feeds.newsEvents.endpoint === "/api/news-events", `newsEvents.endpoint=${body.feeds.newsEvents.endpoint}`);
  assert(body.feeds.landmarks, "scoreboard missing landmarks feed (heritage landmarks added 2026-08-10)");
  assert(body.feeds.landmarks.endpoint === "/bkk-landmarks.geojson", `landmarks.endpoint=${body.feeds.landmarks.endpoint}`);
  logOk("GET /api/atlas/scoreboard", ms, `${body.buildings.totalMetro} buildings · ${body.rail.lines} rail · cityEvents ttl=${body.feeds.cityEvents.ttlMinutes}m · newsEvents=${body.feeds.newsEvents.windowDays}d · landmarks=${body.feeds.landmarks.count}`);
}

// Legacy raw-feed endpoints — the same surface, different shape. We lock
// in the contract so a future refactor can't silently break the client's
// fallback path. /api/traffic specifically: 200 with `configured: false`
// and no `features` array is the steady state (no Longdo key on the
// workspace register); the client treats that body as "fall back to
// /bkk-traffic-sample.geojson" and the layer keeps its honest label.

async function checkTraffic() {
  const { ok, status, body, ms } = await fetchJson("/api/traffic");
  if (!ok) return logFail("GET /api/traffic", `status=${status}`);
  // 200 (not 503) is the new contract — the no-key state is a known steady
  // state, not a service failure. The previous contract made the console
  // throw two errors on every visitor's page load.
  assert(status === 200, `expected 200, got ${status}`);
  assert(typeof body === "object" && body !== null, "body not an object");
  assert("configured" in body, "missing `configured` field");
  // The body intentionally omits `features` when no key is set, so the
  // client falls back to the static sample. If a future change adds
  // `features: []` or `features: [...]` here, this assertion is the
  // canary that says "the steady-state contract changed — update the README
  // and the paper too."
  assert(!("features" in body), `body leaked features field (length=${(body.features || []).length}); contract says "no features" until LONGDO_KEY is set`);
  logOk("GET /api/traffic", ms, `status=200 configured=${body.configured} (no features, client falls back to sample)`);
}

async function checkRisk() {
  const { ok, status, body, ms } = await fetchJson("/api/risk?lng=100.5321&lat=13.7367");
  if (!ok || status !== 200) return logFail("GET /api/risk", `status=${status}`);
  assert(body.tool === "risk", `tool=${body.tool}`);
  assert(typeof body.score === "number", "score not a number");
  assert(["moderate", "elevated", "high"].includes(body.band), `band=${body.band}`);
  assert(body.factors, "missing factors");
  logOk("GET /api/risk", ms, `score=${body.score} band=${body.band} pm25=${body.factors.pm25}`);
}

async function checkCctv() {
  const { ok, status, body, ms } = await fetchJson("/api/cctv");
  if (!ok || status !== 200) return logFail("GET /api/cctv", `status=${status}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  logOk("GET /api/cctv", ms, `count=${body.count ?? body.features.length}`);
}

async function checkFloodSensors() {
  const { ok, status, body, ms } = await fetchJson("/api/flood-sensors");
  if (!ok || status !== 200) return logFail("GET /api/flood-sensors", `status=${status}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  // Each ThaiWater row should have a levelColor — that's the thing the
  // map paints on the gauge dots.
  const colored = body.features.filter((f) => f.properties?.levelColor).length;
  assert(colored > 0, "no features have levelColor");
  logOk("GET /api/flood-sensors", ms, `count=${body.count ?? body.features.length} with-levelColor=${colored}`);
}

async function checkCivicPois() {
  const { ok, status, body, ms } = await fetchJson("/api/civic-pois");
  if (!ok || status !== 200) return logFail("GET /api/civic-pois", `status=${status}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  logOk("GET /api/civic-pois", ms, `count=${body.count ?? body.features.length} (D1-backed)`);
}

// Live city incidents — the "God Mode" layer. The contract is:
//   - 200, FeatureCollection
//   - features (when present) have coordinates inside the Bangkok bbox
//   - attribution + ttlMinutes are surfaced for the client
//   - every feature has a non-empty geometry (we never store a row without
//     coordinates — the design promise is "an event arrives with coordinates
//     or it isn't stored")
async function checkCityEvents() {
  const { ok, status, body, ms } = await fetchJson("/api/city-events");
  if (!ok || status !== 200) return logFail("GET /api/city-events", `status=${status}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  assert(typeof body.ttlMinutes === "number" && body.ttlMinutes > 0, `ttlMinutes=${body.ttlMinutes}`);
  assert(typeof body.attribution === "string" && body.attribution.length > 0, "missing attribution");
  // Bangkok bbox — the same one the Worker uses to filter the upstream feed.
  // If a future change drops the bbox check, this is the canary.
  const BKK = { minLng: 100.2, maxLng: 101.0, minLat: 13.4, maxLat: 14.2 };
  for (const f of body.features) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      logFail("  /city-events feature with non-finite coords", JSON.stringify(f.properties));
      return;
    }
    if (lng < BKK.minLng || lng > BKK.maxLng || lat < BKK.minLat || lat > BKK.maxLat) {
      logFail("  /city-events feature outside Bangkok bbox", `(${lng},${lat}) ${JSON.stringify(f.properties)}`);
      return;
    }
  }
  logOk("GET /api/city-events", ms, `count=${body.count ?? body.features.length} ttlMinutes=${body.ttlMinutes} (all coords inside Bangkok bbox)`);
}

// Geolocated news ("Buzz" layer) — same "no fabricated coordinates"
// promise as city events, but for articles. A pin only exists where a
// gazetteer name (built from OpenStreetMap + curated areas) was found
// in the headline. The match phrase is stored on every row so any pin
// can be audited back to the words that put it there.
async function checkNewsEvents() {
  const { ok, status, body, ms } = await fetchJson("/api/news-events");
  if (!ok || status !== 200) return logFail("GET /api/news-events", `status=${status}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  assert(typeof body.attribution === "string" && body.attribution.length > 0, "missing attribution");
  assert(typeof body.windowDays === "number" && body.windowDays > 0, `windowDays=${body.windowDays}`);
  // Every venue must carry precision = 'venue' | 'area' (the client
  // labels both, so nobody reads an area pin as a street address).
  for (const f of body.features) {
    const p = f.properties || {};
    assert(p.precision === "venue" || p.precision === "area", `unknown precision '${p.precision}' on ${p.venueName}`);
    // The audit trail lives inside the articles[] array — a venue
    // cluster can have multiple articles, each matched by its own
    // phrase. At least one article per cluster must carry a non-empty
    // matchPhrase, otherwise we couldn't tell why a pin landed there.
    const articles = Array.isArray(p.articles) ? p.articles : [];
    assert(articles.length > 0, `no articles on ${p.venueName} — every pin must carry the matched text`);
    const anyMatch = articles.some((a) => typeof a.matchPhrase === "string" && a.matchPhrase.length > 0);
    assert(anyMatch, `no article on ${p.venueName} has a matchPhrase (audit trail missing)`);
    // Same Bangkok bbox promise as city-events.
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (lng < 100.2 || lng > 101.0 || lat < 13.4 || lat > 14.2) {
      logFail("  /news-events feature outside Bangkok bbox", `(${lng},${lat}) ${p.venueName}`);
      return;
    }
  }
  logOk("GET /api/news-events", ms, `count=${body.count ?? body.features.length} articleCount=${body.articleCount ?? "?"} windowDays=${body.windowDays} (every pin has matchPhrase + valid precision)`);
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
  await checkTraffic();
  await checkRisk();
  await checkCctv();
  await checkFloodSensors();
  await checkCivicPois();
  await checkCityEvents();
  await checkNewsEvents();

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
