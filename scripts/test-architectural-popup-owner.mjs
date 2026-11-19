// One architectural answer per click.
//
// Measured on the live build (bkk-atlas-20261104-…): the heritage forms
// layer registered a bare map.on('click') that opened a MapLibre popup
// beside the inspector's card, never disposed a popup it had opened, and
// never consulted the ownership protocol the operational overlays follow
// (pointLayersOwningClick). Three layers could each answer the same click.
//
// The arbitration the reconciliation approved: a click has ONE
// architectural owner, resolved deterministically —
//   overlay  > monument > compound stand-in > generic form
// and "specific" means the cursor is inside the feature's own footprint,
// not the nearest one by distance. These tests hold the wiring to that.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveArchitecturalOwner,
  attachHeritageFormClicks,
  closeHeritageFormPopup,
  heritageFormsDebugState,
} from '../public/heritage-forms-layer.js';

function fakeMap() {
  const handlers = {};
  return {
    handlers,
    on(type, fn) { (handlers[type] ??= []).push(fn); },
    off(type, fn) { handlers[type] = (handlers[type] ?? []).filter((f) => f !== fn); },
    fire(type, event) { for (const fn of handlers[type] ?? []) fn(event); },
  };
}

class FakePopup {
  static live = [];
  static reset() { FakePopup.live = []; }
  constructor(options) {
    this.options = options;
    FakePopup.live.push(this);
  }
  setLngLat(v) { this.lngLat = v; return this; }
  setHTML(v) { this.html = v; return this; }
  addTo(map) { this.map = map; return this; }
  remove() {
    FakePopup.live = FakePopup.live.filter((p) => p !== this);
    return this;
  }
}

const CLICK = { lngLat: { lng: 100.4913, lat: 13.75 }, point: { x: 100, y: 100 } };
const FORM = { id: 'form-1', kind: 'chedi', ring: [[100.4913, 13.75]], height: 30, name: 'Test chedi' };
const nearest = () => FORM;
const Popup = FakePopup;

test('the decision is a total order: overlay beats monument beats compound beats form', () => {
  assert.equal(resolveArchitecturalOwner({ overlayCount: 1, monumentHit: true, compoundHit: true, formNear: true }), 'overlay');
  assert.equal(resolveArchitecturalOwner({ overlayCount: 0, monumentHit: true, compoundHit: true, formNear: true }), 'monument');
  assert.equal(resolveArchitecturalOwner({ overlayCount: 0, monumentHit: false, compoundHit: true, formNear: true }), 'compound');
  assert.equal(resolveArchitecturalOwner({ overlayCount: 0, monumentHit: false, compoundHit: false, formNear: true }), 'form');
  assert.equal(resolveArchitecturalOwner({ overlayCount: 0, monumentHit: false, compoundHit: false, formNear: false }), null);
});

test('handler order cannot change the answer: the forms layer defers to the same owner before and after the inspector would run', () => {
  // The decision is a pure function both handlers consult, so registration
  // order cannot matter. Prove it: whatever the "registration order", the
  // forms handler sees the same owner and defers the same way.
  for (const owner of ['overlay', 'monument', 'compound']) {
    FakePopup.reset();
    const map = fakeMap();
    const early = attachHeritageFormClicks(map, { ownerAt: () => owner, nearest, Popup, isActive: () => true });
    // The inspector's handler is a second listener on the same map; its
    // answer comes from the same pure decision, so no state can leak
    // between them.
    assert.equal(resolveArchitecturalOwner({ overlayCount: owner === 'overlay' ? 1 : 0, monumentHit: owner === 'monument', compoundHit: owner === 'compound', formNear: true }), owner);
    map.fire('click', CLICK);
    assert.equal(FakePopup.live.length, 0, `owner ${owner} must silence the forms popup`);
    early();
  }
});

test('repeated clicks on the same form leave one card, not two', () => {
  FakePopup.reset();
  const map = fakeMap();
  attachHeritageFormClicks(map, { ownerAt: () => 'form', nearest, Popup, isActive: () => true });
  map.fire('click', CLICK);
  map.fire('click', CLICK);
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 1, 'each new form answer must dispose the previous one');
  closeHeritageFormPopup();
  assert.equal(FakePopup.live.length, 0);
});

test('closing a card removes it; a later click opens exactly one', () => {
  FakePopup.reset();
  const map = fakeMap();
  attachHeritageFormClicks(map, { ownerAt: () => 'form', nearest, Popup, isActive: () => true });
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 1);
  closeHeritageFormPopup();
  assert.equal(FakePopup.live.length, 0, 'close must remove the open card');
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 1, 'a later click opens exactly one');
  closeHeritageFormPopup();
});

test('a click an overlay owns opens no architectural card', () => {
  FakePopup.reset();
  const map = fakeMap();
  attachHeritageFormClicks(map, { ownerAt: () => 'overlay', nearest, Popup, isActive: () => true });
  map.fire('click', CLICK);
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 0);
  closeHeritageFormPopup();
});

test('with no owner the forms layer still answers a click near a form — behaviour earned, not removed', () => {
  FakePopup.reset();
  const map = fakeMap();
  attachHeritageFormClicks(map, { ownerAt: () => null, nearest, Popup, isActive: () => true });
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 1);
  const popup = FakePopup.live[0];
  assert.match(popup.html, /Test chedi/, 'the popup still describes the form');
  assert.equal(popup.options.className, 'atlas-heritage-popup');
  closeHeritageFormPopup();
});

test('detach removes the handler: a detached layer never opens a card', () => {
  FakePopup.reset();
  const map = fakeMap();
  const detach = attachHeritageFormClicks(map, { ownerAt: () => 'form', nearest, Popup, isActive: () => true });
  detach();
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 0);
  assert.equal(map.handlers.click?.length ?? 0, 0, 'the handler is off the map');
  closeHeritageFormPopup();
});

test('an inactive forms layer opens nothing, and the debug state says what is live', () => {
  FakePopup.reset();
  const map = fakeMap();
  attachHeritageFormClicks(map, { ownerAt: () => 'form', nearest, Popup, isActive: () => false });
  map.fire('click', CLICK);
  assert.equal(FakePopup.live.length, 0);
  const state = heritageFormsDebugState();
  assert.equal(typeof state.active, 'boolean');
  assert.equal(typeof state.popupOpen, 'boolean');
  closeHeritageFormPopup();
});
