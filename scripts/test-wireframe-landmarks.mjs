import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PALETTE,
  WIRE_LANDMARKS,
  boundsOf,
  buildAll,
  buildLandmark,
  detailForViewport,
} from "../public/wireframe-geometry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("plate 052 is the only ink, and every model is a finite line drawing", () => {
  assert.equal(PALETTE.ink, "#f5ecc2");
  assert.equal(PALETTE.field, "#111314");
  assert.equal(PALETTE.plate, "052");
  const desk = detailForViewport(1440);
  const phone = detailForViewport(390);
  assert.equal(desk.phone, false);
  assert.equal(phone.phone, true);
  const built = buildAll(desk);
  assert.equal(built.length, 8);
  let deskSegments = 0;
  let phoneSegments = 0;
  for (const model of built) {
    assert.ok(model.segments > 40, `${model.id} is too empty`);
    for (let i = 0; i < model.positions.length; i++) {
      assert.ok(Number.isFinite(model.positions[i]), `${model.id} has a non-finite vertex`);
    }
    const box = boundsOf(model.positions);
    assert.ok(box.max[1] > 10, `${model.id} has no height`);
    assert.ok(box.min[1] >= -0.01, `${model.id} sinks below the ground`);
    deskSegments += model.segments;
    phoneSegments += buildLandmark(model.id, phone).segments;
  }
  assert.ok(phoneSegments < deskSegments, "phone detail should drop segments");
  assert.ok(deskSegments < 7000, `desk segment budget blown: ${deskSegments}`);
  assert.ok(phoneSegments < 4500, `phone segment budget blown: ${phoneSegments}`);
});

test("silhouettes keep the measurements that make each building itself", () => {
  const detail = detailForViewport(1440);
  const chakri = boundsOf(buildLandmark("chakri", detail).positions);
  assert.ok(chakri.max[1] >= 49 && chakri.max[1] <= 51);
  const center = maxYWhere(buildLandmark("chakri", detail).positions, (x) => Math.abs(x) < 8);
  const side = maxYWhere(buildLandmark("chakri", detail).positions, (x) => Math.abs(x) > 12);
  assert.ok(center > side + 8, `center spire ${center} should clear the flanks ${side}`);

  const chedi = boundsOf(buildLandmark("chedi", detail).positions);
  assert.ok(Math.abs(chedi.max[1] - 42) < 0.2);

  const mondop = boundsOf(buildLandmark("mondop", detail).positions);
  assert.ok(Math.abs(mondop.max[1] - 28) < 0.2);

  const pantheon = boundsOf(buildLandmark("pantheon", detail).positions);
  assert.ok(Math.abs(pantheon.max[1] - 34) < 0.2);
  assert.ok(pantheon.max[0] > 14 && pantheon.max[2] > 14, "pantheon should read as a cross");

  const arun = buildLandmark("arun", detail).positions;
  const arunBox = boundsOf(arun);
  assert.ok(Math.abs(arunBox.max[1] - 70) < 0.2);
  const satellite = maxYWhere(arun, (x, _y, z) => Math.hypot(x, z) > 8);
  assert.ok(satellite < 40, `satellite prangs too tall: ${satellite}`);
  assert.ok(satellite > 20, "satellite prangs missing");

  const swing = boundsOf(buildLandmark("swing", detail).positions);
  assert.ok(Math.abs(swing.max[1] - 21.15) < 0.05);
  assert.ok(swing.min[0] < -4 && swing.max[0] > 4, "two posts");

  const mount = boundsOf(buildLandmark("golden-mount", detail).positions);
  assert.ok(Math.abs(mount.max[1] - 60) < 0.2);
  assert.ok(mount.max[0] > 28, "the mound should be wide at the base");

  const democracy = boundsOf(buildLandmark("democracy", detail).positions);
  assert.ok(Math.abs(democracy.max[1] - 28) < 0.2);
  assert.ok(democracy.max[0] > 20 && democracy.max[2] > 20, "four wings");
});

test("coordinates sit on the real monuments and inside Bangkok", () => {
  const ids = WIRE_LANDMARKS.map((item) => item.id);
  assert.deepEqual(ids, ["chakri", "chedi", "mondop", "pantheon", "arun", "democracy", "swing", "golden-mount"]);
  for (const spec of WIRE_LANDMARKS) {
    assert.ok(spec.lng > 100.47 && spec.lng < 100.52, spec.id);
    assert.ok(spec.lat > 13.73 && spec.lat < 13.77, spec.id);
    assert.ok(spec.pickRadius >= 12 && spec.pickRadius <= 50);
    assert.equal(typeof spec.note, "string");
    assert.match(spec.coordSource, /Wikipedia|OSM|bkk-/);
  }
  const chedi = WIRE_LANDMARKS.find((item) => item.id === "chedi");
  const pantheon = WIRE_LANDMARKS.find((item) => item.id === "pantheon");
  assert.ok(chedi.lng < pantheon.lng, "chedi is west of the pantheon on the terrace");
  assert.match(pantheon.note, /not a Khmer prang|not Wat Arun/);
});

test("the layer is off, lazy, and does not add a script host", () => {
  const html = read("public/index.html");
  const app = read("public/app.js");
  const headers = read("public/_headers");
  const landmarks = read("public/wireframe-landmarks.js");
  assert.match(html, /id="toggle-wire-landmarks"/);
  assert.match(html, /<strong>Landmarks<\/strong>/);
  assert.equal(html.includes('id="toggle-wire-landmarks" checked'), false);
  const scriptHosts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scriptHosts.filter((src) => src.startsWith("http")), [
    "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js",
    "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
    "https://unpkg.com/pmtiles@4.4.1/dist/pmtiles.js",
  ]);
  assert.equal(scriptHosts.some((src) => src.includes("three")), false);
  assert.match(headers, /script-src 'self' https:\/\/unpkg.com https:\/\/cdn.jsdelivr.net https:\/\/static.cloudflareinsights.com/);
  assert.equal(app.slice(0, 800).includes("wireframe-landmarks"), false);
  assert.match(app, /wireframeModulePromise = wireframeModulePromise \|\| import\("\/wireframe-landmarks\.js"\)/);
  assert.match(app, /defaultOn: false,\n\s+softUninstall: false,\n\s+layers: \[WIRE_LANDMARKS_LAYER\]/);
  assert.match(app, /get\("landmarks"\) === "1"/);
  assert.equal(landmarks.includes("triggerRepaint()"), true);
  assert.equal((landmarks.match(/triggerRepaint\(\)/g) || []).length, 1);
  assert.equal(landmarks.includes("AdditiveBlending"), false);
  assert.match(landmarks, /color: 0xf5ecc2/);
  assert.match(landmarks, /depthTest: false/);
  const vendor = read("public/vendor/three.module.js");
  assert.match(vendor, /SPDX-License-Identifier: MIT/);
  assert.match(vendor, /export\{/);
  assert.match(read("THIRD_PARTY.md"), /Apache License 2\.0/);
  assert.match(read("CREDITS.md"), /img2threejs/);
  assert.match(read("CREDITS.md"), /Juanitoooww/);
  assert.match(read("CREDITS.md"), /KOSIN SUKHUM/);
});

function maxYWhere(positions, pred) {
  let max = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (pred(x, y, z) && y > max) max = y;
  }
  return max;
}
