import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotVisibility, restoreVisibility } from './layer-sweep-state.mjs';

test('sweep restores hidden, default-visible and custom layers without enabling everything', () => {
  const state = new Map([['roads', undefined], ['rain', 'none'], ['custom', 'visible']]);
  const map = {
    getLayoutProperty: id => state.get(id),
    getLayer: id => state.has(id),
    setLayoutProperty: (id, property, value) => state.set(id, value),
  };
  const snapshot = snapshotVisibility(map, [...state.keys()]);
  for (const id of state.keys()) state.set(id, 'none');
  restoreVisibility(map, snapshot);
  assert.deepEqual([...state.values()], ['visible', 'none', 'visible']);
  state.delete('custom');
  assert.doesNotThrow(() => restoreVisibility(map, snapshot));
});
