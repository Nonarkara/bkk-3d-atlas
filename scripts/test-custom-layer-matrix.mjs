import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mercatorModelMatrix } from '../public/custom-layer-matrix.js';

test('normalized Mercator models select the combined custom-layer matrix, never raw perspective', () => {
  const combined = new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const perspective = [...combined]; perspective[15] = 0; perspective[11] = -1;
  const args = { projectionMatrix: perspective, modelViewProjectionMatrix: perspective, defaultProjectionData: { mainMatrix: combined } };
  assert.equal(mercatorModelMatrix(args), combined);
  assert.equal(mercatorModelMatrix({ projectionMatrix: perspective }), null);
  assert.equal(mercatorModelMatrix({ defaultProjectionData: { mainMatrix: [NaN] } }), null);
  // Ground anchor: the wrong perspective would give w=0 and no finite pixel.
  const anchor = [.7791583, .4614279, 0, 1];
  const w = m => m[3]*anchor[0]+m[7]*anchor[1]+m[11]*anchor[2]+m[15];
  assert.equal(w(perspective), 0);
  assert.equal(w(mercatorModelMatrix(args)), 1);
});
