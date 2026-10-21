// The custom-layer projection, checked against a live MapLibre session.
//
// MapLibre hands a custom layer two matrices that look interchangeable and are
// not. This repo shipped a layer that used the wrong one and drew nothing,
// while every test that did not look at pixels stayed green.
//
// The fixture was read from a live MapLibre 6.4.1 session on the atlas: the
// real mainMatrix, the real projectionMatrix, and MapLibre's own screen
// position for a set of ground points. This test composes the projection the
// way the layers do and asks where a point in metres lands. If it lands where
// MapLibre says it should — to within a pixel — the projection is right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { composeProjection, mercatorModelMatrix } from '../public/custom-layer-matrix.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/maplibre-mercator-fixture.json', import.meta.url), 'utf8'),
);

const anchorOf = (name) => fixture.anchors.find((a) => a.name === name);

// MapLibre's 2D project() cannot express altitude over flat terrain — a point
// 40 m up projects to the same pixel as the point below it — so the height
// probe is not a usable ground truth. The horizontal ones are.
const probesFor = (name) => fixture.probes.filter((p) => p.group === name && p.local[1] === 0);

function screenOf(matrix, local) {
  const v = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(matrix);
  return [(v.x * 0.5 + 0.5) * fixture.canvas.width, (0.5 - v.y * 0.5) * fixture.canvas.height];
}

function composed(anchor) {
  return composeProjection(THREE, { defaultProjectionData: { mainMatrix: fixture.mainMatrix } }, {
    x: anchor.mercator.x,
    y: anchor.mercator.y,
    z: anchor.mercator.z,
    scale: anchor.scale,
  });
}

test('the composed Mercator projection lands ground points where MapLibre puts them', () => {
  for (const anchor of fixture.anchors) {
    const matrix = composed(anchor);
    assert.ok(matrix, `no projection composed for ${anchor.name}`);
    for (const probe of probesFor(anchor.name)) {
      const px = screenOf(matrix, probe.local);
      const d = Math.hypot(px[0] - probe.screen[0], px[1] - probe.screen[1]);
      assert.ok(
        d < 1.5,
        `${anchor.name} local ${JSON.stringify(probe.local)} lands ${d.toFixed(1)}px from MapLibre's own `
          + `position (${px.map((n) => n.toFixed(1))} vs ${probe.screen})`,
      );
    }
  }
});

test('the fixture still discriminates: args.projectionMatrix is NOT the main matrix', () => {
  // This is the regression the fixture exists to catch. If the two matrices
  // were interchangeable, this test would have to be deleted — so it asserts
  // the opposite: using projectionMatrix alone throws the geometry off screen.
  assert.notDeepEqual(Array.from(fixture.projectionMatrix), fixture.mainMatrix,
    'the fixture recorded the same matrix twice and no longer discriminates');
  const anchor = anchorOf('map-center');
  const right = composed(anchor);
  const wrong = new THREE.Matrix4().fromArray(fixture.projectionMatrix);
  // Compare in clip space. The frustum matrix divides by the point's own z, so
  // a point on the view plane is a divide-by-zero and never reaches a pixel.
  const ndc = (m, local) => {
    const v = new THREE.Vector3(local[0], local[1], local[2]).applyMatrix4(m);
    return { x: v.x, y: v.y };
  };
  let worst = 0;
  for (const probe of probesFor('map-center')) {
    const a = ndc(right, probe.local);
    const b = ndc(wrong, probe.local);
    // Only probes whose ground truth is inside the viewport can be on screen.
    const onScreen = probe.screen[0] >= 0 && probe.screen[0] <= fixture.canvas.width
      && probe.screen[1] >= 0 && probe.screen[1] <= fixture.canvas.height;
    if (onScreen) {
      assert.ok(Math.abs(a.x) <= 1 && Math.abs(a.y) <= 1,
        `the composed projection put ${JSON.stringify(probe.local)} off screen at NDC `
          + `${a.x.toFixed(2)},${a.y.toFixed(2)}`);
    }
    // A probe sitting on the view plane divides by zero under the frustum
    // matrix. It cannot land anywhere, which is not evidence either way.
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y));
  }
  assert.ok(worst > 1,
    `the two matrices put every probe in the same place (worst ${worst.toFixed(3)}) — `
    + 'the fixture no longer discriminates');
});

test('a main matrix that is absent or non-finite yields no projection', () => {
  assert.equal(mercatorModelMatrix({}), null);
  assert.equal(mercatorModelMatrix({ defaultProjectionData: { mainMatrix: [NaN] } }), null);
  assert.equal(mercatorModelMatrix({ defaultProjectionData: { mainMatrix: new Array(15).fill(0) } }), null);
  assert.equal(composeProjection(THREE, {}, anchorOf('map-center')), null);
  assert.equal(composeProjection(THREE, { defaultProjectionData: { mainMatrix: fixture.mainMatrix } }, null), null);
  assert.equal(
    composeProjection(THREE, { defaultProjectionData: { mainMatrix: fixture.mainMatrix } },
      { x: 0, y: 0, z: 0, scale: 0 }),
    null,
    'a zero scale would collapse the scene to a point',
  );
});

test('both layers compose their projection through the shared helper', () => {
  for (const file of ['../public/wireframe-landmarks.js', '../public/building-massing.js']) {
    const raw = readFileSync(new URL(file, import.meta.url), 'utf8');
    // Strip comments first. The module headers document the wrong matrix in
    // prose, and a whole-file scan would flag its own explanation.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(src, /composeProjection\s*\(/,
      `${file} must compose its projection through the shared helper`);
    assert.doesNotMatch(src, /args\?\.projectionMatrix/,
      `${file} must not treat args.projectionMatrix as a world matrix`);
  }
});
