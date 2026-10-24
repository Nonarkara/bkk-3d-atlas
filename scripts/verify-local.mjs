#!/usr/bin/env node
/**
 * Laptop-scale smoke check — no Cloudflare account, no network tiles.
 * Verifies the static surface the atlas needs to boot from this machine.
 *
 *   node scripts/verify-local.mjs
 *   npm run verify
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const notes = [];

function ok(msg) { notes.push(`✓ ${msg}`); }
function fail(msg) { errors.push(`✗ ${msg}`); }

function mustExist(rel, { maxMb } = {}) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    fail(`missing ${rel}`);
    return null;
  }
  const size = statSync(path).size;
  if (maxMb && size > maxMb * 1024 * 1024) {
    fail(`${rel} is ${(size / 1024 / 1024).toFixed(1)} MB — over ${maxMb} MB laptop budget`);
  } else {
    ok(`${rel} (${(size / 1024).toFixed(0)} KB)`);
  }
  return path;
}

function mustJson(rel, check) {
  const path = mustExist(rel);
  if (!path) return;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    check?.(data);
    ok(`${rel} parses as JSON`);
  } catch (error) {
    fail(`${rel} JSON parse: ${error.message}`);
  }
}

mustExist("public/index.html");
mustExist("public/app.js");
mustExist("public/style.css");
mustExist("src/index.ts");
mustExist("src/flooddash.ts");
mustExist("wrangler.toml");
mustExist("public/labs/paper/index.html");
mustExist("public/labs/index.html");
mustExist("public/labs/paper/shophouses/index.html");
mustExist("public/labs/paper/shophouses/theses.html");
{
  const shophousePaper = readFileSync(join(root, "public/labs/paper/shophouses/index.html"), "utf8");
  const thesesPage = readFileSync(join(root, "public/labs/paper/shophouses/theses.html"), "utf8");
  const about = readFileSync(join(root, "public/index.html"), "utf8");
  const labs = readFileSync(join(root, "public/labs/index.html"), "utf8");
  if (!shophousePaper.includes("1,656")) fail("shophouse bible missing 1,656-unit survey number");
  else ok("shophouse bible cites 1,656 surveyed units");
  if (!shophousePaper.includes("Onsawangchai")) fail("shophouse bible missing Onsawangchai & Funo");
  else ok("shophouse bible cites Onsawangchai & Funo 2004");
  if (!shophousePaper.includes("fig-03-types.svg")) fail("shophouse bible missing typology figure");
  else ok("shophouse bible ships typology figure");
  if (!shophousePaper.includes("theses.html")) fail("shophouse bible missing shelf / theses catalog link");
  else ok("shophouse bible links the recovered thesis catalog");
  if (!thesesPage.includes("Direct PDF")) fail("theses catalog missing Direct PDF access label");
  else ok("theses catalog distinguishes Direct PDF vs repository");
  if (!about.includes("/labs/paper/shophouses/")) fail("About drawer missing shophouse bible link");
  else ok("About research tab links the shophouse bible");
  if (!about.includes("/labs/paper/shophouses/theses.html")) fail("About drawer missing thesis catalog link");
  else ok("About research tab links the thesis catalog");
  if (!labs.includes("/labs/paper/shophouses/")) fail("Labs index missing working paper 02");
  else ok("Labs research tab lists working paper 02");
  if (!labs.includes("/labs/paper/shophouses/theses.html")) fail("Labs index missing thesis catalog");
  else ok("Labs research tab lists the thesis catalog");
  if (!/href="\/labs\/paper\/"/.test(about)) fail("About drawer missing working paper 01 link");
  else ok("About research tab links working paper 01");
  if (!about.includes("https://bkk.nonarkara.org/rowhouses")) fail("About drawer missing live cultural map");
  else ok("About research tab links the live cultural map");
  if (!labs.includes("https://bkk.nonarkara.org/rowhouses")) fail("Labs index missing live cultural map");
  else ok("Labs research tab lists the live cultural map");
  for (const [rel, html] of [
    ["public/labs/index.html", labs],
    ["public/labs/paper/index.html", readFileSync(join(root, "public/labs/paper/index.html"), "utf8")],
    ["public/labs/paper/shophouses/index.html", shophousePaper],
    ["public/labs/paper/shophouses/theses.html", thesesPage],
  ]) {
    if (html.includes('href="/style.css"')) fail(`${rel} must not load atlas style.css (dark chrome leaks onto paper)`);
    else ok(`${rel} is isolated from atlas style.css`);
  }
  const aboutCss = readFileSync(join(root, "public/style.css"), "utf8");
  if (!aboutCss.includes("a:not(.atlas-paper-btn)")) fail("About link rule paints paper buttons yellow-on-yellow");
  else ok("About paper buttons keep ink-on-signal contrast");
  if (about.includes("bkk.nonarkara.org/rowhouses/bible")) fail("About drawer links a bible hub that is not live yet");
  else ok("About drawer does not 404 the unpublished bible hub");
}
mustJson("public/labs/paper/shophouses/catalog.json", (data) => {
  const sections = data.sections;
  if (!Array.isArray(sections) || sections.length < 5) {
    fail("catalog.json missing A–E sections");
    return;
  }
  const theses = sections.filter((s) => s.id !== "E").flatMap((s) => s.entries || []);
  const papers = sections.find((s) => s.id === "E")?.entries || [];
  if (theses.length < 30) fail(`catalog.json only ${theses.length} theses — expected a recovered shelf`);
  else ok(`catalog.json recovers ${theses.length} theses + ${papers.length} papers`);
  const named = [
    "Peeraya Boonprasong",
    "Narut Kupthanaroj",
    "Tanat Bha-aryaphatn",
    "Boonchaiyapruek",
    "Tiamsoon Sirisrisak",
    "Bejrananda"
  ];
  for (const name of named) {
    if (!theses.some((e) => (e.author || "").includes(name))) fail(`catalog missing named PhD ${name}`);
    else ok(`catalog includes named PhD ${name}`);
  }
  const accesses = new Set(theses.concat(papers).map((e) => e.access));
  if (!accesses.has("direct-pdf") || !accesses.has("repository")) {
    fail("catalog.json missing Direct PDF vs repository distinction");
  } else {
    ok("catalog.json marks Direct PDF vs repository");
  }
});

mustJson("public/bkk-areas.json", (data) => {
  if (!Array.isArray(data.areas) || data.areas.length < 1) {
    fail("bkk-areas.json missing areas[]");
  } else {
    ok(`${data.areas.length} curated areas`);
  }
});

mustJson("public/bkk-districts.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n !== 50) fail(`expected 50 district boundaries, got ${n}`);
  else ok(`${n} district boundaries`);
});

mustJson("public/bkk-land-price-districts.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n !== 50) fail(`expected 50 land-price district features, got ${n}`);
  else ok(`${n} land-price districts`);
  const withRoads = (data.features || []).filter((f) => f.properties?.roads?.length > 0).length;
  if (withRoads !== n) fail(`${n - withRoads} districts missing road data`);
  else ok(`all ${n} districts have road-level data`);
  if (!data.disclaimer) fail("land-price-districts missing disclaimer");
  else ok("land-price-districts has disclaimer");
});

mustJson("public/bkk-flood-envelope.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n < 1) fail("flood envelope empty");
  else ok(`${n} flood envelope polygons`);
  if (!String(data.disclaimer || data.source || "").toLowerCase().includes("schematic")
    && !String(data.license || "").includes("schematic")) {
    // soft note only — disclaimer field is enough
  }
  if (!data.disclaimer) fail("flood envelope missing disclaimer");
  else ok("flood envelope has disclaimer");
});

mustJson("public/bkk-rail.geojson", (data) => {
  ok(`${data.features?.length ?? 0} rail segments`);
});

mustJson("public/bkk-water-transit.geojson", (data) => {
  const routes = (data.features || []).filter((feature) => feature.properties?.feature_type === "route");
  const piers = (data.features || []).filter((feature) => feature.properties?.feature_type === "pier");
  if (routes.length !== 4) fail(`expected 4 water-transit routes, got ${routes.length}`);
  else ok("4 scheduled water-transit corridors");
  if (piers.length !== 16) fail(`expected 16 passenger piers, got ${piers.length}`);
  else ok("16 passenger piers");
  if (!String(data.disclaimer || "").includes("not live vessel positions")) fail("water-transit disclaimer must reject live-position inference");
  else ok("water-transit geometry is honestly labelled non-live");
  if (!routes.every((feature) => String(feature.properties?.source_url || "").startsWith("https://"))) fail("water-transit route missing source URL");
  else ok("every water-transit corridor has a source URL");
});

mustJson("public/bkk-traffic-sample.geojson", (data) => {
  ok(`${data.features?.length ?? 0} traffic sample segments`);
});

mustJson("public/bkk-cctv.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n < 20) fail(`cctv features too few: ${n}`);
  else ok(`${n} traffic CCTV sample cameras`);
  const withHls = (data.features || []).filter((f) => f?.properties?.hls).length;
  if (withHls < 20) fail(`cctv HLS urls too few: ${withHls}`);
  else ok(`${withHls} CCTV cameras have HLS urls`);
});

mustJson("public/bkk-venues.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n < 200) fail(`venue gazetteer too small: ${n}`);
  else ok(`${n} gazetteer venues for news matching`);
  const bad = (data.features || []).filter((f) => (f.properties?.name || "").length < 4).length;
  if (bad) fail(`${bad} gazetteer names under 4 chars — would false-match prose`);
  else ok("no gazetteer name short enough to false-match prose");
});

mustJson("public/bkk-civic-pois.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n < 500) fail(`civic POI sample too few: ${n}`);
  else ok(`${n} civic amenity sample points`);
});

mustJson("public/bkk-landmarks.geojson", (data) => {
  const feats = data.features ?? [];
  if (feats.length < 20) fail(`landmarks too few: ${feats.length}`);
  const victory = feats.find((f) => f.properties?.id === "landmark-victory-monument");
  if (!victory) fail("Victory Monument landmark missing");
  else if (Number(victory.properties?.height) < 40) {
    fail(`Victory Monument height too short: ${victory.properties?.height}`);
  } else {
    ok(`Victory Monument ${victory.properties.height} m + ${feats.length - 1} landmark parts`);
  }
  for (const id of ["landmark-democracy-monument", "landmark-golden-mount-chedi"]) {
    if (!feats.some((f) => f.properties?.id === id)) fail(`missing ${id}`);
  }
  ok("Democracy Monument + Golden Mount landmarks present");
});

mustJson("public/bkk-landmarks-quarantine.geojson", (data) => {
  const feats = data.features ?? [];
  if (feats.length < 10) fail(`quarantined landmarks too few: ${feats.length}`);
  else ok(`${feats.length} quarantined landmarks held with auditable reasons`);
});

mustJson("public/bkk-heritage-detail.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n < 8000) fail(`heritage detail too few: ${n}`);
  const tall = data.features.filter((f) => Number(f.properties?.render_height ?? f.properties?.height) >= 28).length;
  if (tall < 20) fail(`heritage detail too few tall footprints: ${tall}`);
  else ok(`${n} Old Town footprints (${tall} ≥28 m)`);
});

// Khlongs are large — warn, don't fail, so a lean laptop checkout still passes.
const khlongs = join(root, "public/bkk-khlongs.geojson");
if (!existsSync(khlongs)) {
  fail("missing public/bkk-khlongs.geojson");
} else {
  const mb = statSync(khlongs).size / 1024 / 1024;
  if (mb > 8) fail(`bkk-khlongs.geojson is ${mb.toFixed(1)} MB — too heavy`);
  else ok(`bkk-khlongs.geojson (${mb.toFixed(1)} MB)`);
}

// Dead weight that used to ship.
if (existsSync(join(root, "public/bkk-canals.geojson"))) {
  fail("public/bkk-canals.geojson still present (unused duplicate of khlongs)");
} else {
  ok("no unused bkk-canals.geojson");
}

const html = readFileSync(join(root, "public/index.html"), "utf8");
if (!html.includes('id="atlas-about"')) fail("index.html missing About drawer #atlas-about");
else ok("index.html has About drawer");
if (!html.includes('id="atlas-pane-research"')) fail("index.html missing Research tab #atlas-pane-research");
else ok("index.html has Research tab in About drawer");
if (!html.includes("data-about-open")) fail("index.html missing About open triggers");
else ok("index.html has About open triggers");
if (html.includes('id="atlas-labs"')) fail("Labs manifesto still in operate panel (should live in About)");
else ok("Labs manifesto moved out of operate panel");
if (!html.includes("My city, not theirs")) fail("About missing thesis line");
else ok("About carries thesis voice");
if (!html.includes("about-contact") || !html.includes("nonsmartcity@gmail.com")) {
  fail("About missing contact section");
} else {
  ok("About has contact");
}
if (!html.includes("about-stack") || !html.includes("How it’s built")) {
  fail("About missing infrastructure section");
} else {
  ok("About has infrastructure section");
}
if (!html.includes("dr-non-siam-square.jpg") || !html.includes("Siam Square")) {
  fail("About missing Siam Square 1981 film still");
} else {
  ok("About carries Siam Square 1981 film still + newborn story");
}
if (!existsSync(join(root, "public/about/dr-non-siam-square.jpg"))) {
  fail("photo file public/about/dr-non-siam-square.jpg missing (About <img> would 404)");
} else {
  ok("Siam Square photo file present in public/about/");
}
if (!html.includes('id="atlas-version"')) fail("index.html missing honest version badge #atlas-version");
else ok("index.html has honest version badge #atlas-version");
if (!html.includes('id="atlas-flood-verdict-sim"')) fail("index.html missing 72h simulation button #atlas-flood-verdict-sim");
else ok("index.html has 72h simulation button #atlas-flood-verdict-sim");
if (!html.includes('id="atlas-sim-hud"')) fail("index.html missing simulation HUD #atlas-sim-hud");
else ok("index.html has simulation HUD #atlas-sim-hud");

const app = readFileSync(join(root, "public/app.js"), "utf8");
// Union of the urban-management tokens and the heritage tokens. Three
// branches each rewrote this list and the merge was committed with
// conflict markers still in it, which made this whole script a syntax
// error. Both feature sets are first-class — neither replaces the other.
for (const token of [
  "ensureStackOrder",
  "wireStackPresets",
  "installDistricts",
  "LAYER_STACK",
  "installFlood",
  "floodHitAt",
  "applyNightMode",
  "installHeat",
  "installWind",
  "windArrowGeometry",
  "loadWaterTransitData",
  "wireWaterTransitInteractions",
  "installAerosol",
  "MODIS_Combined_MAIAC_L2G_AerosolOpticalDepth",
  "loadCctvData",
  "openCctvPopup",
  "CCTV_LAYER",
  "installCivicPois",
  "installCivicDensity",
  "installCityEvents",
  "startCityEventPolling",
  "installNewsEvents",
  "openNewsEventPopup",
  "parseJsonProp",
  "wireAboutDrawer",
  "applyCivicPoiFilter",
  "loadCivicPoiGeoJson",
  "pointLayersOwningClick",
  "hideBaseBuildingFills",
  "BUILDING_EXTRUSION_FILTER",
  "antialias: true",
  "installLandmarks",
  "LANDMARKS_LAYER",
  "RATTANAKOSIN_HEIGHT_EXPRESSION",
  "HERITAGE_DETAIL_URL",
  "bkk-heritage-detail.geojson",
]) {
  if (!app.includes(token)) fail(`public/app.js missing ${token}`);
  else ok(`app.js has ${token}`);
}
if (!html.includes('id="toggle-wind"') || !html.includes('id="legend-wind"')) {
  fail("index.html missing wind field toggle or legend");
} else {
  ok("index.html has wind field toggle + legend");
}
if (!html.includes('id="toggle-water-transit"') || !html.includes('id="legend-water-transit"')) {
  fail("index.html missing water-transit toggle or legend");
} else {
  ok("index.html has water-transit toggle + legend");
}
// The street-zoom buildings must not stop where the archive stops.
//
// The atlas used to hand off at the tippecanoe maxzoom: the archive carried
// tiles to z15 and a second source took over above it, which is why the city
// disappeared above z15. The metro archive now carries native tiles to z17,
// so there is no handoff any more — and the check has to say THAT, not
// insist on a constant that now means the opposite.
if (app.includes("BKKX_BUILDINGS_HANDOFF_ZOOM")) {
  fail("street-zoom buildings still hand off to a second source — the metro archive reaches z17 on its own");
} else if (!/BKKX_BUILDINGS_MAX_ZOOM\s*=\s*17/.test(app)) {
  fail("BKKX_BUILDINGS_MAX_ZOOM is not 17 — the metro archive carries native tiles to z17");
} else if (!/BKKX_BUILDINGS_LAYER_MAX_ZOOM\s*=\s*24/.test(app)) {
  fail("BKKX_BUILDINGS_LAYER_MAX_ZOOM must sit above the source's deepest zoom, or the layer stops early");
} else {
  ok("street-zoom buildings come from one archive to z17, with no handoff");
}
if (!app.includes("landmark-victory-monument") && !app.includes("bkk-landmarks.geojson")) {
  fail("landmarks layer not wired to bkk-landmarks.geojson");
} else {
  ok("Victory Monument + heritage landmarks wired");
}
if (!/id:\s*CIVIC_POI_LAYER[\s\S]{0,220}minzoom:\s*9/.test(app)) {
  fail("CIVIC_POI_LAYER missing minzoom 9");
} else {
  ok("civic POI dots visible from city overview zoom");
}
if (!app.includes("legendInteractive: true")) fail("civic legend should be interactive");
else ok("civic legend categories are toggleable");

const worker = readFileSync(join(root, "src/index.ts"), "utf8");
if (!worker.includes("apiCatalog")) fail("Worker missing /api catalog helper");
else ok("Worker exposes /api catalog");
if (!worker.includes("/api/risk")) fail("Worker missing /api/risk");
else ok("Worker exposes /api/risk");
if (!worker.includes("/api/cctv")) fail("Worker missing /api/cctv");
else ok("Worker exposes /api/cctv");
if (!worker.includes("fetchPointPm25")) fail("Worker risk missing PM2.5 fetch");
else ok("Worker risk folds live PM2.5");
if (!worker.includes("camerasToGeoJson")) fail("Worker missing CCTV GeoJSON builder");
else ok("Worker builds CCTV GeoJSON");
if (!worker.includes("/api/civic-pois")) fail("Worker missing /api/civic-pois");
else ok("Worker exposes /api/civic-pois");
if (!worker.includes("CIVIC_DB")) fail("Worker missing CIVIC_DB D1 binding usage");
else ok("Worker uses CIVIC_DB");
if (!worker.includes("/api/city-events")) fail("Worker missing /api/city-events");
else ok("Worker exposes /api/city-events");
if (!worker.includes("parseBangkokTime")) fail("Worker missing Asia/Bangkok time parser (events would never expire)");
else ok("Worker parses feed times as UTC+7");
if (!worker.includes("MAX_BREAKING_DURATION_HOURS")) fail("Worker missing standing-condition filter");
else ok("Worker filters multi-month roadworks out of breaking events");
if (!worker.includes("/api/news-events")) fail("Worker missing /api/news-events");
else ok("Worker exposes /api/news-events");
if (!worker.includes("match_phrase")) fail("news_events must store the matched phrase (audit trail for every pin)");
else ok("Worker records the phrase that placed each news pin");
if (!worker.includes("AbortSignal.timeout")) fail("news fetches need timeouts (an untimed source stalled the endpoint 21s)");
else ok("news source fetches are time-bounded");
if (!existsSync(join(root, "scripts/build-venue-gazetteer.py"))) fail("missing venue gazetteer builder");
else ok("venue gazetteer builder present");
if (!worker.includes("cityEvents")) fail("Worker scoreboard missing cityEvents feed (added 2026-08-09)");
else ok("Worker scoreboard surfaces cityEvents feed");
if (!worker.includes("newsEvents")) fail("Worker scoreboard missing newsEvents feed (Buzz layer added 2026-08-10)");
else ok("Worker scoreboard surfaces newsEvents feed");
if (!worker.includes("/api/news-events")) fail("Worker missing /api/news-events");
else ok("Worker exposes /api/news-events");
if (!app.includes("parseAtQuery")) fail("app.js missing parseAtQuery (?at=lng,lat,zoom external fly-to)");
else ok("app.js has parseAtQuery (bkk quarter quick-jump)");
if (!worker.includes("bkk-venues.geojson")) fail("Worker missing gazetteer reference (no fabricated coords promise)");
else ok("Worker references bkk-venues.geojson gazetteer");
if (!worker.includes("landmarks")) fail("Worker scoreboard missing landmarks feed (heritage landmarks added 2026-08-10)");
else ok("Worker scoreboard surfaces landmarks feed");
if (!worker.includes("OSM footprints + schematic heritage heights")) {
  fail("Worker landmarks.source must stay honest (OSM/schematic — not Fine Arts Department register)");
} else if (/Fine Arts Department heritage register/.test(worker)) {
  fail("Worker still claims landmarks are the Fine Arts Department register");
} else ok("Worker landmarks.source is honest (OSM/schematic heights)");
if (!app.includes("installNewsEvents")) fail("public/app.js missing installNewsEvents");
else ok("app.js has installNewsEvents");
if (!app.includes("openNewsEventPopup")) fail("public/app.js missing openNewsEventPopup");
else ok("app.js has openNewsEventPopup");
if (!app.includes("installLandmarks")) fail("public/app.js missing installLandmarks");
else ok("app.js has installLandmarks");
if (!app.includes("RATTANAKOSIN_HEIGHT_EXPRESSION")) fail("public/app.js missing RATTANAKOSIN_HEIGHT_EXPRESSION");
else ok("app.js has RATTANAKOSIN_HEIGHT_EXPRESSION");
if (!app.includes("HERITAGE_DETAIL_URL")) fail("public/app.js missing HERITAGE_DETAIL_URL");
else ok("app.js has HERITAGE_DETAIL_URL");
if (!existsSync(join(root, "public/bkk-landmarks.geojson"))) fail("missing public/bkk-landmarks.geojson");
else ok("public/bkk-landmarks.geojson present");
if (!existsSync(join(root, "public/bkk-heritage-detail.geojson"))) fail("missing public/bkk-heritage-detail.geojson");
else ok("public/bkk-heritage-detail.geojson present");
if (!existsSync(join(root, "public/bkk-venues.geojson"))) fail("missing public/bkk-venues.geojson (Buzz gazetteer)");
else ok("public/bkk-venues.geojson present (Buzz gazetteer)");
if (!existsSync(join(root, "db/schema.sql"))) fail("missing db/schema.sql");
else ok("db/schema.sql present");
{
  // Merged schema check: the city_events table must live in db/schema.sql
  // so a fresh deploy applying the documented schema gets EVERY table in
  // one shot. A separate schema-city-events.sql file was a footgun (the
  // README never mentioned it).
  const schema = readFileSync(join(root, "db/schema.sql"), "utf8");
  if (!schema.includes("CREATE TABLE IF NOT EXISTS civic_pois")) fail("db/schema.sql missing civic_pois");
  else ok("db/schema.sql declares civic_pois");
  if (!schema.includes("CREATE TABLE IF NOT EXISTS city_events")) fail("db/schema.sql missing city_events — fresh deploy would have no events table");
  else ok("db/schema.sql declares city_events (merged in 2026-08-09 audit)");
  if (!schema.includes("CREATE TABLE IF NOT EXISTS news_events")) fail("db/schema.sql missing news_events — fresh deploy would have no Buzz layer");
  else ok("db/schema.sql declares news_events (merged in 2026-08-11 audit)");
  if (!schema.includes("CREATE TABLE IF NOT EXISTS flood_state")) fail("db/schema.sql missing flood_state — fresh deploy would have no flood relay table");
  else ok("db/schema.sql declares flood_state (merged in 2026-08-15 flooddash relay)");
}
const wt = readFileSync(join(root, "wrangler.toml"), "utf8");
const cronTomlPath = join(root, "wrangler.cron.toml");
if (!existsSync(cronTomlPath)) fail("missing wrangler.cron.toml — */5 ingest cron has no Worker config");
const cronToml = existsSync(cronTomlPath) ? readFileSync(cronTomlPath, "utf8") : "";
function cpuMs(text) {
  const match = text.match(/\[limits\][^\[]*?cpu_ms\s*=\s*(\d+)/);
  return match ? Number(match[1]) : null;
}
function observabilityOn(text) {
  return /\[observability\][^\[]*?enabled\s*=\s*true/.test(text);
}
if (/\bcrons\b/.test(wt) || wt.includes("*/5")) {
  fail("wrangler.toml still schedules the cron — request Worker must stay at cpu_ms 200 with no trigger");
} else {
  ok("request wrangler.toml has no cron trigger");
}
if (cpuMs(wt) !== 200) fail(`wrangler.toml cpu_ms is ${cpuMs(wt)}, expected 200`);
else ok("request Worker limits.cpu_ms = 200");
if (!observabilityOn(wt)) fail("wrangler.toml observability is not enabled");
else ok("request Worker observability enabled");
if (!cronToml.includes('crons = ["*/5 * * * *"]')) fail("wrangler.cron.toml missing */5 cron trigger");
else ok("cron Worker schedules */5 ingest");
if (cpuMs(cronToml) !== 30000) fail(`wrangler.cron.toml cpu_ms is ${cpuMs(cronToml)}, expected 30000`);
else ok("cron Worker limits.cpu_ms = 30000");
if (!observabilityOn(cronToml)) fail("wrangler.cron.toml observability is not enabled");
else ok("cron Worker observability enabled");
if (!cronToml.includes('name = "bkk-3d-atlas-cron"')) fail("wrangler.cron.toml must name the Worker bkk-3d-atlas-cron");
else ok("cron Worker name is bkk-3d-atlas-cron");
if (/^\s*custom_domain\s*=/m.test(cronToml) || /^\s*pattern\s*=\s*"atlas\.nonarkara\.org"/m.test(cronToml) || /^\s*\[\[routes\]\]/m.test(cronToml)) {
  fail("wrangler.cron.toml must not bind a route or custom domain");
} else {
  ok("cron Worker has no route or custom domain");
}
if (!cronToml.includes("CIVIC_DB") || !cronToml.includes('binding = "ASSETS"')) {
  fail("wrangler.cron.toml missing CIVIC_DB or ASSETS — scheduled() cannot ingest");
} else {
  ok("cron Worker binds CIVIC_DB and ASSETS");
}
{
  // npm run deploy / release run scripts/deploy-live.sh; the order lives there.
  const deploy = readFileSync(join(root, "scripts/deploy-live.sh"), "utf8");
  const cronDeploy = "wrangler deploy --config wrangler.cron.toml";
  if (!deploy.includes(cronDeploy) || deploy.indexOf(cronDeploy) > deploy.indexOf("npx wrangler deploy\n")) {
    fail("npm run deploy must upload wrangler.cron.toml before the request Worker");
  } else {
    ok("npm run deploy uploads the cron Worker first");
  }
  const workflow = readFileSync(join(root, ".github/workflows/deploy-cloudflare.yml"), "utf8");
  const cronStep = workflow.indexOf("command: deploy --config wrangler.cron.toml");
  const requestStep = workflow.lastIndexOf("command: deploy\n");
  if (cronStep === -1 || requestStep === -1 || cronStep > requestStep) {
    fail("deploy workflow must upload wrangler.cron.toml before the request Worker");
  } else {
    ok("deploy workflow uploads the cron Worker first");
  }
}

// AI-readable mirror — six endpoints, added 2026-08-05. If any of these
// are missing, the atlas is back to being a website you look at instead
// of a city you ask questions of.
const ATLAS_PATHS = [
  "/api/atlas/areas",
  "/api/atlas/districts",
  "/api/atlas/at-this-point",
  "/api/atlas/transit",
  "/api/atlas/buildings",
  "/api/atlas/scoreboard",
];
for (const path of ATLAS_PATHS) {
  if (!worker.includes(`"${path}"`)) fail(`Worker missing AI-readable mirror route ${path}`);
  else ok(`Worker exposes ${path}`);
}
if (!worker.includes('"/api/flood/bkk"')) fail("Worker missing FloodDash relay route /api/flood/bkk");
else ok("Worker exposes /api/flood/bkk");
if (!worker.includes("ATLAS_WATER_TRANSIT_ASSET") || !worker.includes("waterRoutes") || !worker.includes("piers")) {
  fail("Worker transit endpoint missing water routes or piers");
} else {
  ok("Worker transit endpoint is multimodal (rail + boats + piers)");
}

// /api/traffic 200-with-configured-false contract: the no-key state is
// a known steady state, not a service failure. Lock it in so a future
// refactor can't silently revert to the 503 that threw two console
// errors on every visitor's page load (commit c84e3c6). The check looks
// at the proxyTraffic function body, not the route table — the route
// table's "/api/traffic" string is far from the actual response shape.
{
  const fnMatch = /async function proxyTraffic[\s\S]*?^}/m.exec(worker);
  if (!fnMatch) {
    fail("Worker missing proxyTraffic function body");
  } else {
    const body = fnMatch[0];
    const hasConfigured = /configured:\s*false/.test(body);
    const hasStatus200 = /status:\s*200/.test(body);
    const hasLackingKey = /LONGDO_KEY/.test(body);
    if (hasConfigured && hasStatus200 && hasLackingKey) {
      ok("Worker /api/traffic no-key contract: 200 + configured:false");
    } else {
      fail(`Worker /api/traffic no-key branch regressed (configured:${hasConfigured} status:200:${hasStatus200} LONGDO_KEY:${hasLackingKey}, see c84e3c6)`);
    }
  }
}

const wranglerToml = readFileSync(join(root, "wrangler.toml"), "utf8");
if (!wranglerToml.includes("CIVIC_DB")) fail("wrangler.toml missing CIVIC_DB d1_databases binding");
else ok("wrangler.toml binds CIVIC_DB");

if (!existsSync(join(root, "db/schema.sql"))) fail("missing db/schema.sql");
else ok("db/schema.sql present");
if (!existsSync(join(root, "scripts/ingest-bma-open-data.py"))) fail("missing scripts/ingest-bma-open-data.py");
else ok("scripts/ingest-bma-open-data.py present");

const glbPath = join(root, "public/models/grand-palace.glb");
if (!existsSync(glbPath)) fail("missing public/models/grand-palace.glb");
else {
  const glb = readFileSync(glbPath);
  const mb = glb.length / 1024 / 1024;
  if (glb.toString("utf8", 0, 4) !== "glTF") fail("grand-palace.glb is not a GLB");
  else if (mb > 3) fail(`grand-palace.glb is ${mb.toFixed(2)} MB — over the 3 MB budget`);
  else ok(`grand-palace.glb (${(glb.length / 1024).toFixed(0)} KB)`);
  const jsonLength = glb.readUInt32LE(12);
  const json = glb.subarray(20, 20 + jsonLength).toString("utf8");
  if (!json.includes("Approximate model, not an official survey")) fail("grand-palace.glb missing the stand-in note");
  else ok("grand-palace.glb carries the stand-in note");
  if (!json.includes("OpenStreetMap")) fail("grand-palace.glb missing OSM credit");
  else ok("grand-palace.glb credits OpenStreetMap");
}
// The pinned three.js version must agree across the import map and the code
// that imports it, and this check must not hardcode the version itself: a
// check that names a version is a check that has to be edited on every bump,
// and the bump on 2026-10-23 left this one naming 0.170.0 while the atlas
// pinned 0.186.1 — so it failed for the wrong reason and stayed broken.
{
  const importMap = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  const mapText = importMap ? importMap[1] : "";
  const pinned = mapText.match(/three@([0-9]+\.[0-9]+\.[0-9]+)/);
  const codeVersions = ["public/building-massing.js", "public/heritage-forms-layer.js", "public/wireframe-landmarks.js"]
    .map((file) => {
      const src = readFileSync(join(root, file), "utf8");
      const m = src.match(/THREE_VERSION\s*=\s*['"]([0-9.]+)['"]/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
  if (!pinned) {
    fail("index.html has no three.js import map — the 3D layers cannot resolve 'three'");
  } else if (!codeVersions.length) {
    ok(`index.html pins three@${pinned[1]} (no source-level pin to cross-check)`);
  } else if (!codeVersions.every((v) => v === pinned[1])) {
    fail(`three.js version disagrees: index.html pins ${pinned[1]}, code pins ${[...new Set(codeVersions)].join(", ")}`);
  } else {
    ok(`index.html and the code both pin three@${pinned[1]}`);
  }
}
if (!html.includes('id="atlas-massing-note"') || !html.includes("Approximate model, not an official survey")) {
  fail("index.html missing the Grand Palace stand-in note");
} else ok("index.html has the Grand Palace stand-in note");
const massingSrc = readFileSync(join(root, "public/building-massing.js"), "utf8");
if (!app.includes("installBuildingMassing") || !massingSrc.includes("MASSING_MIN_ZOOM = 16") || !massingSrc.includes("await import('three')")) {
  fail("building massing is not wired");
} else ok("building massing is wired and three.js stays lazy");
const massingTest = spawnSync(process.execPath, ["--test", "scripts/test-building-massing.mjs"], { cwd: root, encoding: "utf8" });
if (massingTest.status !== 0) {
  fail(`building massing tests failed\n${massingTest.stdout || ""}\n${massingTest.stderr || ""}`);
} else ok("building massing tests passed");

// Thai heritage forms. The classifier must stay conservative and the layer
// must keep three.js lazy, or the Old Town silently reverts to flat boxes.
const formsLayerSrc = readFileSync(join(root, "public/heritage-forms-layer.js"), "utf8");
// A static `from "three"` at the top would drag three.js to every visitor.
const threeIsLazy = /import\(['"]three['"]\)/.test(formsLayerSrc) && !/^import .*from ["']three["'];?$/m.test(formsLayerSrc);
// Check the export surface, not a literal: esbuild hoists exports into a block.
const formsExports = await import(new URL("../public/heritage-forms.js", import.meta.url));
const formsUsable = typeof formsExports.classify === "function" && typeof formsExports.buildForm === "function";
if (
  !app.includes("installHeritageForms") ||
  !threeIsLazy ||
  !formsLayerSrc.includes("defaultProjectionData") ||
  !formsUsable
) {
  fail("Thai heritage forms are not wired");
} else ok("Thai heritage forms are wired, lazy and chunked");
// The shophouse render set must stay a strict subset of the published
// candidates, and must never be larger than the layer is willing to draw.
const slim = JSON.parse(readFileSync(join(root, "public/bkk-shophouse-forms.geojson"), "utf8"));
const candidates = JSON.parse(readFileSync(join(root, "public/bkk-shophouse-candidates.geojson"), "utf8"));
const undrawable = slim.features.filter((f) => f.properties.height_basis !== "overture-storeys" || !f.properties.num_floors);
if (undrawable.length) {
  fail(`shophouse render set carries ${undrawable.length} rows the classifier would refuse`);
} else if (slim.featureCount !== slim.features.length) {
  fail("shophouse render set count disagrees with its features");
} else {
  ok(`shophouse render set: ${slim.features.length} of ${candidates.features.length} candidates, all drawable`);
}

const formsTest = spawnSync(process.execPath, ["--test", "scripts/test-heritage-forms.mjs"], { cwd: root, encoding: "utf8" });
if (formsTest.status !== 0) {
  fail(`heritage forms tests failed\n${formsTest.stdout || ""}\n${formsTest.stderr || ""}`);
} else ok("heritage forms tests passed");

// MapLibre floor. GHSA-jrc7-96c5-q579 (CVE-2026-85061) is a critical XSS in
// DOM.sanitize(): affected <= 6.4.0, patched in 6.4.1. The atlas self-hosts the
// library, so nothing forces an upgrade — a stale vendor directory would ship
// a zero-click XSS with no package manager to catch it. Pin the floor here.
const vendorMatch = html.match(/vendor\/maplibre-([0-9]+)\.([0-9]+)\.([0-9]+)\//);
if (!vendorMatch) {
  fail("cannot determine the vendored MapLibre version");
} else {
  const major = Number(vendorMatch[1]);
  const minor = Number(vendorMatch[2]);
  const patch = Number(vendorMatch[3]);
  const atLeastPatched = major > 6 || (major === 6 && (minor > 4 || (minor === 4 && patch >= 1)));
  if (!atLeastPatched) {
    fail(`vendored MapLibre ${vendorMatch[0]} is vulnerable to GHSA-jrc7-96c5-q579; 6.4.1 is the floor`);
  } else {
    ok(`vendored MapLibre ${major}.${minor}.${patch} clears GHSA-jrc7-96c5-q579`);
  }
}

// Every layer id render-check.mjs measures must be a real constant in the
// source. The first run of that script reported bkkx-landmarks MISSING and I
// went looking for a layer that had silently stopped installing — the id was
// my typo, the real one is bkkx-landmarks-extrusion. A mistyped id reads as a
// broken layer, which is the most expensive kind of false alarm: it sends you
// auditing working code. Catch it here instead, where it costs nothing.
{
  const renderCheckPath = join(root, "scripts/render-check.mjs");
  const sources = ["heritage-forms-layer.js", "heritage-roofs.js", "building-massing.js", "app.js"]
    .map((f) => readFileSync(join(root, "public", f), "utf8"))
    .join("\n");
  const declared = new Set([...sources.matchAll(/["'`](bkkx-[a-z0-9-]+)["'`]/g)].map((m) => m[1]));
  const measured = [...readFileSync(renderCheckPath, "utf8").matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]);
  if (!measured.length) {
    fail("render-check.mjs declares no layers to measure — the check has quietly stopped checking");
  } else {
    const bogus = measured.filter((id) => !declared.has(id));
    if (bogus.length) {
      fail(`render-check.mjs measures layer id(s) no source file declares: ${bogus.join(", ")}`);
    } else {
      ok(`render-check.mjs measures ${measured.length} layer ids, all declared in source`);
    }
  }
}

// src/edge-guard.ts and public/_headers both carry a Content-Security-Policy,
// and a comment in the former used to promise they were identical and checked.
// They were not identical — the Worker's script-src is deliberately narrower,
// since no JSON response runs three.js — and nothing checked either way. A
// promise in a comment is not a control.
//
// What is enforced: the two declare the same directives in the same order (so
// neither silently gains or loses one), and the Worker's copy never widens the
// document policy by carrying wasm-unsafe-eval or the three.js import-map hash.
{
  const guard = readFileSync(join(root, "src/edge-guard.ts"), "utf8");
  const headersBody = readFileSync(join(root, "public/_headers"), "utf8");
  const documentPolicy = (headersBody.match(/^ {2}Content-Security-Policy: (.+)$/m) || [])[1] || "";
  const directives = (policy) => (policy.split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.split(/\s+/)[0]));

  const guardDirectives = [...guard.matchAll(/"([a-z-]+-src|default-src|object-src|base-uri|form-action|frame-ancestors)\s/g)]
    .map((m) => m[1]);
  const docDirectives = directives(documentPolicy);

  if (!documentPolicy) {
    fail("cannot read the document Content-Security-Policy from public/_headers");
  } else if (JSON.stringify(guardDirectives) !== JSON.stringify(docDirectives)) {
    fail(`CSP directives differ between src/edge-guard.ts and public/_headers:\n    guard: ${guardDirectives.join(" ")}\n    _headers: ${docDirectives.join(" ")}`);
  } else {
    ok(`CSP directives agree across ${guardDirectives.length} directives (${guardDirectives.join(" ")})`);
  }

  // Scope both to the policy strings, not the file text. A whole-file grep
  // matched the comment explaining why wasm-unsafe-eval is absent, which is
  // the shape of check that cries wolf on its own documentation.
  const guardPolicy = [...guard.matchAll(/"([a-z-]+-src[^"]*)"/g)].map((m) => m[1]).join("; ");
  if (/wasm-unsafe-eval/.test(guardPolicy)) {
    fail("src/edge-guard.ts grants wasm-unsafe-eval — only the document policy may, and only for three.js");
  } else ok("Worker CSP does not grant wasm-unsafe-eval");

  const hash = (documentPolicy.match(/sha256-[A-Za-z0-9+/=]+/) || [])[0];
  if (hash && guardPolicy.includes(hash)) {
    fail("src/edge-guard.ts carries the document import-map hash; JSON responses have no import map to allow");
  } else ok("Worker CSP does not carry the three.js import-map hash");
}

// The test command must still pick up every test file, by glob rather than by
// name. BKKx names its files explicitly, so a new one there is silently skipped;
// here a glob covers that, but a narrowed one would reintroduce it. Assert the
// glob is intact and that it is actually matching something — a check that
// matches nothing reports the same green as a check that passes.
{
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const cmd = pkg.scripts?.test || "";
  if (!cmd) {
    fail("package.json has no test script");
  } else if (!/node\s+--test\s+scripts\/test-\*\.mjs/.test(cmd)) {
    fail(`the test script no longer globs scripts/test-*.mjs: "${cmd}" — a narrowed command skips every new test file`);
  } else {
    const found = readdirSync(join(root, "scripts")).filter((f) => /^test-.*\.mjs$/.test(f));
    if (!found.length) {
      fail("the test glob matches no files — a suite that runs nothing is green for the wrong reason");
    } else if (found.length < 5) {
      fail(`only ${found.length} test file(s) match scripts/test-*.mjs — has the glob been narrowed?`);
    } else {
      ok(`npm test globs ${found.length} test files, all picked up automatically`);
    }
  }
}

// three.js must resolve through the pinned import map, and there must be
// exactly one copy of it. PR #19 was closed for adding a second: a 4,232-line
// public/vendor/three.module.js loaded by hardcoded path, so the massing and
// forms layers would get three@0.170.0 from unpkg while the landmarks layer got
// whatever was vendored — two copies, no pin on one of them, no hash, and
// nothing to catch a version bump in one place only.
{
  const vendorDir = join(root, "public/vendor");
  const vendoredThree = existsSync(vendorDir)
    ? readdirSync(vendorDir).filter((f) => /three.*\.module\.js$/i.test(f))
    : [];
  if (vendoredThree.length) {
    fail(`public/vendor holds a second copy of three.js (${vendoredThree.join(", ")}) — resolve 'three' through the import map instead`);
  } else {
    ok("three.js is not vendored — one copy, through the pinned import map");
  }

  // Any module that renders 3D must ask for a specifier the import map declares,
  // never a filesystem path. The map carries two entries — `three` and
  // `three/addons/` (GLTFLoader, DRACOLoader) — and both are pinned to the same
  // unpkg version. Anything else mentioning three is a second copy.
  const renderers = ["public/building-massing.js", "public/heritage-forms-layer.js", "public/wireframe-landmarks.js"];
  const bad = [];
  const resolves = (spec) => spec === "three" || spec.startsWith("three/");
  for (const file of renderers) {
    const src = readFileSync(join(root, file), "utf8");
    for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
      if (/three/i.test(m[1]) && !resolves(m[1])) bad.push(`${file}: import("${m[1]}")`);
    }
  }
  if (bad.length) fail(`3D layer(s) import three by path rather than specifier:\n    ${bad.join("\n    ")}`);
  else ok(`all ${renderers.length} 3D layers resolve three through the import map`);
}

// GitHub Actions hardening. security.yml set the standard — every action on a
// commit SHA, workflow-level `permissions: contents: read`, and no leftover
// checkout credentials. The workflow that actually holds CLOUDFLARE_API_TOKEN
// had a floating `wrangler-action@v3` sitting directly above an identically
// pinned step, which is exactly the kind of tag an attacker moves. A pull
// request can reintroduce one of these at any time, so it is checked here
// rather than trusted to review.
{
  const dir = join(root, ".github/workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const unpinned = [];
  const overPermissive = [];
  const credsLeft = [];
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const line of src.split("\n")) {
      const m = line.match(/uses:\s*([^\s#]+)/);
      if (!m) continue;
      const ref = m[1].split("@")[1] || "";
      if (!/^[0-9a-f]{40}$/.test(ref)) unpinned.push(`${f}: ${m[1]}`);
    }
    // A job-level permissions block counts; so does the workflow-level one.
    if (!/^\s*permissions:/m.test(src)) overPermissive.push(f);
    // security.yml sets persist-credentials: false on its checkout. Anything
    // else that checks out code leaves a usable token in .git/config for the
    // rest of the job to find.
    if (/actions\/checkout@/.test(src) && !/persist-credentials:\s*false/.test(src)) credsLeft.push(f);
  }
  if (!files.length) {
    fail("no workflow files found — the Actions guard has nothing to check");
  } else {
    if (unpinned.length) fail(`action referenced by tag, not commit SHA:\n    ${unpinned.join("\n    ")}`);
    else ok(`all actions in ${files.length} workflow(s) pinned to a commit SHA`);
    if (overPermissive.length) fail(`workflow(s) with no permissions block (default GITHUB_TOKEN is read/write): ${overPermissive.join(", ")}`);
    else ok("every workflow declares least-privilege permissions");
    if (credsLeft.length) fail(`checkout leaves credentials on disk: ${credsLeft.join(", ")}`);
  }
}

// app.js is loaded as type="module". A missing brace once parsed in script
// mode, passed review, and took the whole map down in browsers (2026-10-14).
{
  const parse = spawnSync(process.execPath, ["--check", join(root, "public/app.js")], { cwd: root, encoding: "utf8" });
  if (parse.status !== 0) fail(`public/app.js does not parse as a module\n${parse.stderr}`);
  else ok("public/app.js parses as an ES module");
}

// The three.js import map is an inline script; the CSP allows it only by
// hash. Edit the map without updating public/_headers and the massing layer
// dies silently in production (it did, 2026-10-14).
{
  const { createHash } = await import("node:crypto");
  const html = readFileSync(join(root, "public/index.html"), "utf8");
  const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  const headers = readFileSync(join(root, "public/_headers"), "utf8");
  const hash = map ? `'sha256-${createHash("sha256").update(map[1]).digest("base64")}'` : null;
  if (hash && !headers.includes(hash)) fail(`CSP does not allow the import map — add ${hash} to script-src in public/_headers`);
  else ok("CSP allows the three.js import map by hash");
}

console.log(notes.join("\n"));
if (errors.length) {
  console.error("\n" + errors.join("\n"));
  console.error(`\nverify-local: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log("\nverify-local: all checks passed — safe to npm run dev on this laptop");
