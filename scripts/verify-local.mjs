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

mustJson("public/bkk-civic-pois.geojson", (data) => {
  const n = data.features?.length ?? 0;
  if (n < 500) fail(`civic POI sample too few: ${n}`);
  else ok(`${n} civic amenity sample points`);
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
if (!html.includes("dr-non-1998.jpg") || !html.includes("1998 was the year")) {
  fail("About missing 1998 personal film marker");
} else {
  ok("About carries 1998 film still + personal story");
}

const app = readFileSync(join(root, "public/app.js"), "utf8");
for (const token of ["ensureStackOrder", "wireStackPresets", "installDistricts", "LAYER_STACK", "installFlood", "floodHitAt", "applyNightMode", "installHeat", "loadCctvData", "openCctvPopup", "CCTV_LAYER", "installCivicPois", "installCivicDensity", "parseJsonProp", "wireAboutDrawer", "applyCivicPoiFilter", "loadCivicPoiGeoJson", "pointLayersOwningClick"]) {
  if (!app.includes(token)) fail(`public/app.js missing ${token}`);
  else ok(`app.js has ${token}`);
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
