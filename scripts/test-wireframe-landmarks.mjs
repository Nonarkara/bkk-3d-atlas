// The wireframe monuments, ported from PR #19.
//
// PR #19 was closed rather than merged: it added a second, unpinned copy of
// three.js at public/vendor/three.module.js and loaded it by hardcoded path,
// and it used the pre-MapLibre-5 custom-layer render signature. The geometry
// was worth keeping and came across unchanged; these tests hold the port to the
// two things that actually broke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PALETTE,
  WIRE_LANDMARKS,
  buildAll,
  buildLandmark,
  detailForViewport,
  segmentCount,
} from '../public/wireframe-geometry.js';

test('every landmark builds finite geometry at every level of detail', () => {
  for (const width of [390, 768, 1440, 2560]) {
    const detail = detailForViewport(width);
    assert.ok(detail.rows > 0 && detail.radial > 0, `detail for ${width}px is degenerate`);
    for (const spec of WIRE_LANDMARKS) {
      const model = buildLandmark(spec.id, detail);
      assert.ok(model.segments > 0, `${spec.id} drew nothing at ${width}px`);
      assert.equal(model.positions.length, model.segments * 6, `${spec.id}: segments and positions disagree`);
      assert.ok(model.positions.every(Number.isFinite), `${spec.id} produced a non-finite vertex`);
    }
  }
});

test('the set is complete and each landmark is placed in Bangkok', () => {
  assert.equal(WIRE_LANDMARKS.length, 8, 'the port carried eight landmarks');
  const ids = WIRE_LANDMARKS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'landmark ids must be unique');
  for (const spec of WIRE_LANDMARKS) {
    assert.ok(spec.lng > 100.4 && spec.lng < 100.6, `${spec.id} lng ${spec.lng} is not central Bangkok`);
    assert.ok(spec.lat > 13.6 && spec.lat < 13.85, `${spec.id} lat ${spec.lat} is not central Bangkok`);
    assert.ok(spec.name && spec.nameTh, `${spec.id} is missing a name in one language`);
    assert.ok(spec.heightM > 0, `${spec.id} has no height`);
  }
});

test('naming is honest: a wireframe is a drawing, not a survey', () => {
  for (const spec of WIRE_LANDMARKS) {
    // Every landmark carries a note saying what it is not. Checking for the
    // bare word "survey" flagged "Not a surveyed elevation" — a disclaimer read
    // as a claim. Strip the negations first, then look for a claim.
    const disclaimers = ['not a survey', 'unsurveyed', 'not surveyed', 'not measured',
      'not reconstructed', 'schematic', 'stylised', 'stylized', 'illustrative', 'not a reconstruction'];
    const blob = disclaimers.reduce((t, d) => t.split(d).join(''), JSON.stringify(spec).toLowerCase());
    for (const banned of ['survey', 'measured', 'as-built', 'reconstructed', 'accurate', 'exact']) {
      assert.ok(!blob.includes(banned),
        `${spec.id} claims "${banned}" — these are procedural drawings, not a survey`);
    }
    assert.ok(spec.note && spec.note.length > 8, `${spec.id} carries no note saying what it is`);
    // Thai names are real Thai, not transliteration.
    assert.ok(/[฀-๿]/.test(spec.nameTh), `${spec.id} has no Thai script in nameTh`);
  }
});

test('detail scales down on small viewports rather than growing', () => {
  const phone = detailForViewport(390);
  const desktop = detailForViewport(1440);
  assert.ok(phone.rows <= desktop.rows, 'a phone must not get more geometry than a desktop');
  assert.ok(phone.radial <= desktop.radial, 'a phone must not get more radial segments');
  const phoneSegments = buildAll(phone).reduce((n, b) => n + b.segments, 0);
  const desktopSegments = buildAll(desktop).reduce((n, b) => n + b.segments, 0);
  assert.ok(phoneSegments <= desktopSegments, 'phone geometry must not exceed desktop');
});

test('the whole set stays cheap enough to build on a cold start', () => {
  const all = buildAll(detailForViewport(1440));
  const total = all.reduce((n, b) => n + b.segments, 0);
  assert.ok(total > 0);
  // Wireframe, not mesh: well under the tens of thousands of triangles that
  // cost an 84 ms stall before the heritage forms were chunked.
  assert.ok(total < 20000, `${total} segments is heavier than a wireframe should be`);
  for (const b of all) assert.equal(segmentCount(b.positions), b.segments);
});

test('Wat Arun refines curves without inflating its reference-backed extent', () => {
  const detail = detailForViewport(1440);
  const fine = buildLandmark('arun', detail);
  const coarse = buildLandmark('arun', { ...detail, radial: detail.radial / 2 });
  const extent = model => [0, 1, 2].map(axis => {
    const values = model.positions.filter((_, i) => i % 3 === axis);
    return [Math.min(...values), Math.max(...values)];
  });
  assert.ok(fine.segments > coarse.segments * 1.8);
  assert.deepEqual(extent(fine), extent(coarse));
  assert.equal(extent(fine)[1][1], 70);
});

test('the palette is the declared one, not a hardcoded literal elsewhere', () => {
  assert.match(PALETTE.ink, /^#[0-9a-f]{6}$/i);
  assert.match(PALETTE.field, /^#[0-9a-f]{6}$/i);
  assert.ok(PALETTE.ink.toLowerCase() !== PALETTE.field.toLowerCase(), 'ink and field must differ to be legible');
  assert.ok(PALETTE.url.startsWith('https://'), 'the palette credit must be a real reference');
});

test('the layer resolves three through the import map, never a vendored path', () => {
  const raw = readFileSync(new URL('../public/wireframe-landmarks.js', import.meta.url), 'utf8');
  // Strip comments first. The module's own header documents `import('three')` in
  // prose, and a whole-file scan flagged its documentation — the same way the CSP
  // guard once flagged its own explanation of why wasm-unsafe-eval is absent.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imports = [...src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  for (const spec of imports) {
    assert.doesNotMatch(spec, /three.*\.module\.js$/,
      `import("${spec}") loads a second, unpinned copy of three.js`);
  }
  assert.ok(imports.includes('three'), 'the layer must load three lazily as a bare specifier');
});

test('the layer uses the MapLibre 6.4.1 render signature and the Mercator main matrix', () => {
  const src = readFileSync(new URL('../public/wireframe-landmarks.js', import.meta.url), 'utf8');
  // PR #19 shipped render(gl, matrix). On MapLibre 6 that receives the args
  // object instead of a matrix: the layer installs cleanly and draws nothing.
  assert.ok(/render\s*\(\s*gl\s*,\s*args\s*\)/.test(src), 'render() must take the args object');
  // The same failure has a second face. args.projectionMatrix is the camera's
  // view-space frustum matrix; the world matrix is
  // args.defaultProjectionData.mainMatrix. Feeding a metre-scale scene to the
  // frustum matrix puts every monument ten screen-widths off, and the layer
  // draws nothing at all.
  assert.match(src, /composeProjection\s*\(/,
    'render() must compose its projection through the shared helper');
  assert.doesNotMatch(src, /args\?\.projectionMatrix/,
    'args.projectionMatrix is a view-space frustum matrix, not the world matrix');
});
