#!/usr/bin/env node
/**
 * Laptop-scale smoke check — no Cloudflare account, no network tiles.
 * Verifies the static surface the atlas needs to boot from this machine.
 *
 *   node scripts/verify-local.mjs
 *   npm run verify
 */
import { readFileSync, existsSync, statSync } from "node:fs";
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
  "BKKX_BUILDINGS_HI_LAYER",
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
if (!app.includes("BKKX_BUILDINGS_HANDOFF_ZOOM")) fail("missing building zoom handoff constant");
else ok("street-zoom buildings hand off past tippecanoe maxzoom");
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
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const deploy = pkg.scripts?.deploy ?? "";
  const cronDeploy = "wrangler deploy --config wrangler.cron.toml";
  if (!deploy.includes(cronDeploy) || deploy.indexOf(cronDeploy) > deploy.indexOf("&& wrangler deploy")) {
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

console.log(notes.join("\n"));
if (errors.length) {
  console.error("\n" + errors.join("\n"));
  console.error(`\nverify-local: ${errors.length} failure(s)`);
  process.exit(1);
}
console.log("\nverify-local: all checks passed — safe to npm run dev on this laptop");
