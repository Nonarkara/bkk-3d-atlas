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
  assert(body.feeds.floodBkk, "scoreboard missing floodBkk feed (FloodDash relay added 2026-08-15)");
  assert(body.feeds.floodBkk.endpoint === "/api/flood/bkk", `floodBkk.endpoint=${body.feeds.floodBkk.endpoint}`);
  // The Fine Arts Department register (571 monuments) is the bkk site's
  // /heritage page — not this GeoJSON. Lock the honest source string so
  // a future agent can't re-lie the scoreboard into claiming FAD ownership.
  assert(
    typeof body.feeds.landmarks.source === "string" &&
      /OSM|schematic/i.test(body.feeds.landmarks.source) &&
      !/Fine Arts Department heritage register/i.test(body.feeds.landmarks.source),
    `landmarks.source must describe OSM/schematic heights, not FAD register; got ${body.feeds.landmarks.source}`,
  );
  assert(
    typeof body.feeds.landmarks.count === "number" && body.feeds.landmarks.count >= 90,
    `landmarks.count must be a positive number reflecting actual features; got ${body.feeds.landmarks.count}`,
  );
  assert(
    body.feeds.bkkRainStations && body.feeds.bkkRainStations.endpoint === "/bkk-rain-stations.geojson" && body.feeds.bkkRainStations.count >= 130,
    `bkkRainStations must surface ≥130 stations; got ${body.feeds.bkkRainStations?.count}`,
  );
  logOk("GET /api/atlas/scoreboard", ms, `${body.buildings.totalMetro} buildings · ${body.rail.lines} rail · cityEvents ttl=${body.feeds.cityEvents.ttlMinutes}m · newsEvents=${body.feeds.newsEvents.windowDays}d · landmarks=${body.feeds.landmarks.count}`);
}

// Conditional GET contract on the PMTiles Range proxy (2026-10-03): a
// browser echoes the quoted etag back as If-None-Match, but R2's onlyIf
// expects the raw tag and throws on quotes — every real browser
// revalidation 500'd while the README promised 304. This pair of checks
// is the canary: quoted-match must 304, quoted-miss must fall through
// (HEAD so the miss case downloads no body).
async function checkPmtilesConditional() {
  const head = await fetch(baseUrl + "/bkk-buildings.pmtiles", { method: "HEAD" });
  const etag = head.headers.get("etag");
  if (!etag) return logFail("HEAD /bkk-buildings.pmtiles", "no etag header");
  logOk("HEAD /bkk-buildings.pmtiles", 0, `etag=${etag}`);

  const hit = await fetch(baseUrl + "/bkk-buildings.pmtiles", { headers: { "if-none-match": etag } });
  if (hit.status === 304) logOk("GET /bkk-buildings.pmtiles if-none-match (quoted)", 0, "304 as promised");
  else logFail("GET /bkk-buildings.pmtiles if-none-match (quoted)", `expected 304, got ${hit.status}`);

  const miss = await fetch(baseUrl + "/bkk-buildings.pmtiles", { method: "HEAD", headers: { "if-none-match": '"__stale__"' } });
  if (miss.status === 200) logOk("HEAD /bkk-buildings.pmtiles stale quoted etag", 0, "200 on etag miss (no throw)");
  else logFail("HEAD /bkk-buildings.pmtiles stale quoted etag", `expected 200, got ${miss.status}`);
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

async function checkFloodBkk() {
  const { ok, status, body, ms } = await fetchJson("/api/flood/bkk");
  if (!ok || status !== 200) return logFail("GET /api/flood/bkk", `status=${status}`);
  assert(body.tool === "flood-bkk", `tool=${body.tool}`);
  const verdict = body.verdict ?? body.lastKnownVerdict;
  assert(typeof verdict === "object" && verdict !== null, "missing verdict or lastKnownVerdict object");
  assert(typeof verdict.level === "string", "missing verdict.level");
  assert(Array.isArray(body.gauges), "gauges not an array");
  assert(typeof body.waterways === "object" && body.waterways !== null, "waterways not an object");
  assert(typeof body.hotline === "string", "missing hotline");
  logOk("GET /api/flood/bkk", ms, `verdict=${verdict.level} (${verdict.score}/100)${body.stale ? " [stale-expired]" : ""} gauges=${body.gauges.length} waterways=${Object.keys(body.waterways).length}`);
}

// BMA Drainage bulletin — the city's own gate telemetry, anchored to
// the khlongs GeoJSON the Worker loads. The contract is:
//   - 200, FeatureCollection
//   - features (when present) have coordinates inside the Bangkok bbox
//   - every feature carries severity ∈ {critical, warning, normal}
// The endpoint returns 0 features when the bulletin is empty or stale;
// that's not a fail, it's a signal — the canary is "endpoint reachable".
async function checkBkkCanalGates() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/canal-gates");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/canal-gates", `status=${status}`);
  assert(body.tool === "bkk-canal-gates", `tool=${body.tool}`);
  assert(Array.isArray(body.features), "features not an array");
  const BKK = { minLng: 100.2, maxLng: 101.1, minLat: 13.2, maxLat: 14.4 };
  for (const f of body.features) {
    const p = f.properties || {};
    assert(["critical", "warning", "normal"].includes(p.severity), `unknown severity '${p.severity}' on ${p.name}`);
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      logFail("  /canal-gates feature with non-finite coords", JSON.stringify(p));
      return;
    }
    if (lng < BKK.minLng || lng > BKK.maxLng || lat < BKK.minLat || lat > BKK.maxLat) {
      logFail("  /canal-gates feature outside Bangkok bbox", `(${lng},${lat}) ${p.name}`);
      return;
    }
  }
  const c = body.counts ?? {};
  logOk("GET /api/water/bkk/canal-gates", ms, `bulletin=${body.bulletin_date ?? "?"} · ${c.total ?? body.features.length} stations (critical ${c.critical ?? 0} · warning ${c.warning ?? 0} · normal ${c.normal ?? 0})`);
}

// BMA DDS dated road reports — district-anchored because DDS publishes no
// per-point coordinates. The contract:
//   - 200, FeatureCollection
//   - every feature has a name (road), district (Thai), status, severity
//   - severity ∈ {severe, moderate, shallow, cleared, unknown}
//   - coordinates land inside the Bangkok bbox
async function checkBkkRoadsFlooded() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/roads-flooded");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/roads-flooded", `status=${status}`);
  assert(body.tool === "bkk-roads-flooded", `tool=${body.tool}`);
  assert(Array.isArray(body.features), "features not an array");
  const BKK = { minLng: 100.2, maxLng: 101.1, minLat: 13.2, maxLat: 14.4 };
  const allowed = new Set(["severe", "moderate", "shallow", "cleared", "unknown"]);
  for (const f of body.features) {
    const p = f.properties || {};
    assert(typeof p.name === "string" && p.name.length > 0, `missing name on ${JSON.stringify(p)}`);
    assert(typeof p.district === "string" && p.district.length > 0, `missing district on ${p.name}`);
    assert(allowed.has(p.severity), `unknown severity '${p.severity}' on ${p.name}`);
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      logFail("  /roads-flooded feature with non-finite coords", JSON.stringify(p));
      return;
    }
    if (lng < BKK.minLng || lng > BKK.maxLng || lat < BKK.minLat || lat > BKK.maxLat) {
      logFail("  /roads-flooded feature outside Bangkok bbox", `(${lng},${lat}) ${p.name}`);
      return;
    }
  }
  logOk("GET /api/water/bkk/roads-flooded", ms, `days=${(body.days ?? []).join(",")} · ${body.features.length} reports (severe ${body.counts?.bySeverity?.severe ?? 0} · moderate ${body.counts?.bySeverity?.moderate ?? 0} · cleared ${body.counts?.byStatus?.["reported-cleared"] ?? 0})`);
}

// FloodDash emergency points — the highest-stakes layer in the atlas
// flood edition. Every point carries a tier (confirmed/sensor/reported)
// and band (high/watch). News headlines (up to 3) anchor each pin back
// to public reporting. The contract:
//   - 200, FeatureCollection
//   - coordinates inside the BKK + 30 km halo bbox
//   - if news[] is non-empty, each entry has title + link
async function checkBkkEmergencyPoints() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/emergency-points");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/emergency-points", `status=${status}`);
  assert(body.tool === "bkk-emergency-points", `tool=${body.tool}`);
  assert(Array.isArray(body.features), "features not an array");
  const HALO = { minLng: 100.05, maxLng: 101.10, minLat: 13.25, maxLat: 14.35 };
  for (const f of body.features) {
    const p = f.properties || {};
    assert(["confirmed", "sensor", "reported"].includes(p.tier), `unknown tier '${p.tier}' on ${p.name}`);
    // band can be high / elevated / watch / low / normal — the FloodDash ladder.
    // (saw "elevated" on Bang Phli on 2026-09-27; "normal" on Ongkharak on
    // 2026-10-01 — FloodDash emits normal for a quieted point, missed it
    // first time round both times.)
    assert(["high", "elevated", "watch", "low", "normal"].includes(p.band), `unknown band '${p.band}' on ${p.name}`);
    assert(Array.isArray(p.news) && p.news.length <= 3, `news[] length=${p.news?.length} on ${p.name}`);
    for (const n of p.news ?? []) {
      assert(typeof n.title === "string" && n.title.length > 0, `empty news title on ${p.name}`);
      assert(typeof n.link === "string" && /^https?:\/\//.test(n.link), `invalid news link on ${p.name}: ${n.link}`);
    }
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      logFail("  /emergency-points feature with non-finite coords", JSON.stringify(p));
      return;
    }
    if (lng < HALO.minLng || lng > HALO.maxLng || lat < HALO.minLat || lat > HALO.maxLat) {
      logFail("  /emergency-points feature outside BKK halo bbox", `(${lng},${lat}) ${p.name}`);
      return;
    }
  }
  logOk("GET /api/water/bkk/emergency-points", ms, `windowHours=${body.window_hours ?? "?"} · ${body.features.length} points (BKK + 30 km halo · confirmed + reported)`);
}

async function checkCivicPois() {
  const { ok, status, body, ms } = await fetchJson("/api/civic-pois");
  if (!ok || status !== 200) return logFail("GET /api/civic-pois", `status=${status}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  logOk("GET /api/civic-pois", ms, `count=${body.count ?? body.features.length} (D1-backed)`);
}

// Dams (2026-09-29) — pulled from FloodDash snapshot.dams. Filtered to
// Chao Phraya + nearby basins that actually drive BKK floods. Contract:
//   - 200, FeatureCollection
//   - every feature has valid coords + severity ∈ {critical, warning, watch, safe, unknown}
//   - coordinates sit inside the wider BKK-halo bbox (12.5–20.5 lat, 97.0–106.0 lng)
//   - storage_pct is a number in [0, 100] when present
async function checkBkkDams() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/dams");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/dams", `status=${status}`);
  assert(body.tool === "bkk-dams", `tool=${body.tool}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  const allowed = new Set(["critical", "warning", "watch", "safe", "unknown"]);
  for (const f of body.features) {
    const p = f.properties || {};
    assert(allowed.has(p.severity), `unknown severity '${p.severity}' on ${p.name_en}`);
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      logFail("  /dams feature with non-finite coords", JSON.stringify(p));
      return;
    }
    if (lng < 97.0 || lng > 106.0 || lat < 12.5 || lat > 20.5) {
      logFail("  /dams feature outside dam bbox", `(${lng},${lat}) ${p.name_en}`);
      return;
    }
    if (p.storage_pct != null) {
      // storage_pct can briefly exceed 100 when an upstream source
      // reports "capacity vs spillway" instead of "absolute storage".
      // Allow up to 200 to catch genuine bad data without rejecting
      // honest readings from RID/EGAT during high-flow events.
      assert(p.storage_pct >= 0 && p.storage_pct <= 200, `storage_pct ${p.storage_pct} out of [0,200] on ${p.name_en}`);
    }
  }
  const c = body.counts ?? {};
  logOk("GET /api/water/bkk/dams", ms, `${c.total ?? body.features.length} dams (critical ${c.critical ?? 0} · warning ${c.warning ?? 0} · watch ${c.watch ?? 0} · safe ${c.safe ?? 0})`);
}

// Active alerts (2026-09-29) — filtered to BKK + Chao Phraya upstream.
// Contract:
//   - 200, JSON object with tool=bkk-alerts
//   - items array with Thai + English messages
//   - severity is a number, not a string
//   - when items is non-empty, each item has source + ts + message_en
async function checkBkkAlerts() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/alerts");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/alerts", `status=${status}`);
  assert(body.tool === "bkk-alerts", `tool=${body.tool}`);
  assert(Array.isArray(body.items), "items not an array");
  for (const a of body.items) {
    assert(typeof a.message_en === "string" && a.message_en.length > 0, `empty message_en on ${a.province_en}`);
    assert(typeof a.severity === "number", `severity not a number on ${a.province_en}`);
    assert(typeof a.source === "string" && a.source.length > 0, `empty source on ${a.province_en}`);
    assert(typeof a.ts === "string", `missing ts on ${a.province_en}`);
  }
  const c = body.counts ?? {};
  logOk("GET /api/water/bkk/alerts", ms, `${c.total ?? body.items.length} alerts (critical ${c.critical ?? 0} · high ${c.high ?? 0} · watch ${c.watch ?? 0})`);
}

// Sources health (2026-09-29) — 40 upstream feeds with their ingest
// status. Contract:
//   - 200, JSON with tool=sources-health
//   - items array, each with key + label_en + status ∈ {ok, degraded, stale, skipped}
//   - if lastError is set, status must not be ok
async function checkSourcesHealth() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/sources-health");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/sources-health", `status=${status}`);
  assert(body.tool === "sources-health", `tool=${body.tool}`);
  assert(Array.isArray(body.items), "items not an array");
  const allowed = new Set(["ok", "degraded", "stale", "skipped"]);
  for (const s of body.items) {
    assert(typeof s.key === "string" && s.key.length > 0, "missing key");
    assert(allowed.has(s.status), `unknown status '${s.status}' on ${s.key}`);
    assert(typeof s.label_en === "string" && s.label_en.length > 0, `empty label_en on ${s.key}`);
    if (s.lastError && s.status === "ok") {
      logFail("  /sources-health item with lastError but status=ok", `${s.key}: ${s.lastError}`);
      return;
    }
  }
  const c = body.counts ?? {};
  logOk("GET /api/water/bkk/sources-health", ms, `${c.total ?? body.items.length} feeds (ok ${c.ok ?? 0} · degraded ${c.degraded ?? 0} · skipped ${c.skipped ?? 0}) · system ${body.system_counts?.monitored_stations ?? "?"} stations`);
}

// News watch (2026-09-29) — FloodDash gnews_flood curated feed.
// Contract:
//   - 200, JSON with tool=bkk-news-watch
//   - items array, each with title + link + source_domain + severity
//   - severity ∈ {urgent, watch, advisory, info}
//   - link is https?:// (a real article URL, not a redirect)
//   - when items is non-empty, each item has a non-empty title
async function checkNewsWatch() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/news-watch");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/news-watch", `status=${status}`);
  assert(body.tool === "bkk-news-watch", `tool=${body.tool}`);
  assert(Array.isArray(body.items), "items not an array");
  const allowed = new Set(["urgent", "watch", "advisory", "info"]);
  for (const n of body.items) {
    assert(typeof n.title === "string" && n.title.length > 0, "empty title");
    assert(typeof n.link === "string" && /^https?:\/\//.test(n.link), `invalid link on '${n.title.slice(0, 40)}'`);
    assert(allowed.has(n.severity), `unknown severity '${n.severity}' on '${n.title.slice(0, 40)}'`);
    assert(typeof n.source_domain === "string" && n.source_domain.length > 0, `empty source_domain on '${n.title.slice(0, 40)}'`);
  }
  const c = body.counts ?? {};
  logOk("GET /api/water/bkk/news-watch", ms, `${c.total ?? body.items.length} headlines (urgent ${c.urgent ?? 0} · watch ${c.watch ?? 0} · advisory ${c.advisory ?? 0} · info ${c.info ?? 0} · trusted ${c.trusted ?? 0})`);
}

// Maholan community CCTV (2026-09-30) — proxies cctv.maholan.net's
// 2,355-camera aggregator, filtered to BKK + 30 km halo. Contract:
//   - 200, FeatureCollection
//   - every feature has valid coords inside the BKK-halo bbox
//   - upstream_type ∈ {hls, mjpeg, snapshot}
//   - severity ∈ {live, stale}
//   - viewer_url is https://cctv.maholan.net/?cam=<id>
async function checkMaholanCctv() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/maholan-cctv");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/maholan-cctv", `status=${status}`);
  assert(body.tool === "bkk-maholan-cctv", `tool=${body.tool}`);
  assert(body.type === "FeatureCollection", `type=${body.type}`);
  assert(Array.isArray(body.features), "features not an array");
  const allowedType = new Set(["hls", "mjpeg", "snapshot"]);
  const allowedSeverity = new Set(["live", "stale"]);
  for (const f of body.features) {
    const p = f.properties || {};
    assert(typeof p.id === "string" && p.id.length > 0, "missing id");
    assert(allowedType.has(p.upstream_type), `unknown upstream_type '${p.upstream_type}' on ${p.id}`);
    assert(allowedSeverity.has(p.severity), `unknown severity '${p.severity}' on ${p.id}`);
    assert(typeof p.viewer_url === "string" && /^https:\/\/cctv\.maholan\.net\//.test(p.viewer_url), `invalid viewer_url on ${p.id}`);
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      logFail("  /maholan-cctv feature with non-finite coords", JSON.stringify(p));
      return;
    }
    if (lng < 99.85 || lng > 101.15 || lat < 13.20 || lat > 14.40) {
      logFail("  /maholan-cctv feature outside BKK-halo bbox", `(${lng},${lat}) ${p.id}`);
      return;
    }
  }
  const c = body.counts ?? {};
  logOk("GET /api/water/bkk/maholan-cctv", ms, `${c.total ?? body.features.length} cameras (live ${c.live ?? 0} · HLS ${c.hls ?? 0} · MJPEG ${c.mjpeg ?? 0} · snapshot ${c.snapshot ?? 0})`);
}

// Honest cross-reference: BMA DDS + Traffy + iTIC road reports
// cross-checked against FloodDash gauges (JK World Owner rule
// 2026-10-01). The smoke test verifies the contract, not the
// specific number — the number is what the live data says it is.
async function checkRoadsXref() {
  const { ok, status, body, ms } = await fetchJson("/api/water/bkk/roads-xref");
  if (!ok || status !== 200) return logFail("GET /api/water/bkk/roads-xref", `status=${status}`);
  assert(body.tool === "bkk-roads-xref", `tool=${body.tool}`);
  assert(typeof body.confirmRadiusM === "number" && body.confirmRadiusM > 0, `confirmRadiusM=${body.confirmRadiusM}`);
  const counts = body.counts || {};
  for (const k of ["confirmed", "unconfirmed_no_sensor", "unconfirmed_sensor_stale", "unconfirmed_sensor_dry", "sensor_only", "total_roads"]) {
    assert(Number.isInteger(counts[k]) && counts[k] >= 0, `counts.${k} missing or negative: ${counts[k]}`);
  }
  assert(Array.isArray(body.confirmed), "confirmed is not an array");
  assert(Array.isArray(body.unconfirmed), "unconfirmed is not an array");
  assert(Array.isArray(body.sensorOnly), "sensorOnly is not an array");
  assert(typeof body.attribution === "string" && body.attribution.includes("JK World"), "attribution does not credit JK World");
  // Each confirmed row must have a nearest_gauge with a valid distance.
  for (const r of body.confirmed.slice(0, 3)) {
    assert(r.q === "sensor-confirmed", `confirmed row q=${r.q}`);
    assert(r.nearest_gauge && typeof r.nearest_gauge.distance_m === "number", `confirmed row missing nearest_gauge.distance_m`);
    assert(r.nearest_gauge.distance_m <= body.confirmRadiusM, `confirmed row distance ${r.nearest_gauge.distance_m}m > radius ${body.confirmRadiusM}m`);
  }
  // Each unconfirmed row must NOT be tagged as confirmed.
  for (const r of body.unconfirmed.slice(0, 3)) {
    assert(r.q !== "sensor-confirmed", `unconfirmed row q=${r.q}`);
  }
  logOk("GET /api/water/bkk/roads-xref", ms,
    `${counts.confirmed} confirmed · ${counts.unconfirmed_no_sensor} no-sensor · ${counts.unconfirmed_sensor_stale} stale · ${counts.unconfirmed_sensor_dry} sensor-safe · ${counts.sensor_only} sensor-only (within ${body.confirmRadiusM} m)`);
}

// /api/snap/<id> — Maholan snapshot proxy. The atlas popup points at
// this URL because cctv.maholan.net sends no Access-Control-Allow-Origin,
// which makes browsers refuse to paint a direct <img>. The proxy
// adds ACAO *, passes through X-Image-Time so the popup can show
// snapshot age, and falls back to a tiny honest SVG when upstream
// returns 404 / non-image / timeout — never a broken-image glyph.
async function checkSnapProxy() {
  // Real cam — expect JPEG, ACAO, cache-control.
  const live = await fetchJson("/api/snap/rangsit-200?w=480");
  if (!live.ok || live.status !== 200) return logFail("GET /api/snap/rangsit-200", `status=${live.status}`);
  const ctype = live.headers.get("content-type") || "";
  assert(ctype.startsWith("image/"), `content-type=${ctype}`);
  assert(live.headers.get("access-control-allow-origin") === "*", "no ACAO on proxy response");
  assert((live.headers.get("cache-control") || "").includes("max-age"), "no cache-control on proxy");
  const len = live.body && typeof live.body === "string" ? new TextEncoder().encode(live.body).length : 0;
  logOk("GET /api/snap/rangsit-200?w=480", live.ms, `${ctype} · ~${len} bytes · ACAO=*`);
  // Bad id — expect the inline-SVG placeholder, NOT a 404. The atlas
  // never lets the popup render a broken-image glyph.
  const bad = await fetchJson("/api/snap/__definitely_does_not_exist__");
  if (!bad.ok || bad.status !== 200) return logFail("GET /api/snap/<bad>", `status=${bad.status}`);
  const bctype = bad.headers.get("content-type") || "";
  assert(bctype.startsWith("image/svg"), `bad-id content-type=${bctype}`);
  const body = typeof bad.body === "string" ? bad.body : new TextDecoder().decode(bad.body);
  assert(/snapshot unavailable/i.test(body), "placeholder SVG missing 'snapshot unavailable' text");
  logOk("GET /api/snap/<bad-id>", bad.ms, `${bctype} placeholder served`);
}

// Live presence — anonymous per-tab counter (JK World pattern).
async function checkPresence() {
  const { ok, status, body, ms } = await fetchJson("/api/presence");
  if (!ok || status !== 200) return logFail("GET /api/presence", `status=${status}`);
  assert(typeof body.online === "number" && body.online >= 0, `online=${body.online}`);
  assert(typeof body.peak === "number" && body.peak >= body.online, `peak=${body.peak}`);
  const ping = await fetchJson("/api/presence/ping", { method: "POST" });
  if (!ping.ok || ping.status !== 200) return logFail("POST /api/presence/ping", `status=${ping.status}`);
  assert(typeof ping.body.sessionId === "string" && ping.body.sessionId.length > 0, "missing sessionId");
  assert(ping.body.online >= 1, `ping did not register: online=${ping.body.online}`);
  logOk("POST /api/presence/ping", ping.ms, `sessionId=${ping.body.sessionId.slice(0, 8)}… · online=${ping.body.online} · peak=${ping.body.peak}`);
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
  await checkPmtilesConditional();
  await checkScoreboard();
  await checkTraffic();
  await checkRisk();
  await checkCctv();
  await checkFloodSensors();
  await checkFloodBkk();
  await checkBkkCanalGates();
  await checkBkkRoadsFlooded();
  await checkBkkEmergencyPoints();
  await checkBkkDams();
  await checkBkkAlerts();
  await checkNewsWatch();
  await checkMaholanCctv();
  await checkSourcesHealth();
  await checkRoadsXref();
  await checkSnapProxy();
  await checkPresence();
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
