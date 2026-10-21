// Models are translated to normalized Mercator (0..1), not view-space or
// world-pixel coordinates. MapLibre's raw projectionMatrix is NOT compatible.
export function mercatorModelMatrix(args) {
  const matrix = args?.defaultProjectionData?.mainMatrix;
  return matrix?.length === 16 && Array.from(matrix).every(Number.isFinite) ? matrix : null;
}

// The custom-layer projection contract for MapLibre 6.x.
//
// MapLibre hands a custom layer two matrices in render()'s args that look
// interchangeable and are not:
//
//   args.defaultProjectionData.mainMatrix — the Mercator main matrix. It maps
//     NORMALISED MERCATOR WORLD coordinates (0..1) to clip space.
//   args.projectionMatrix — the camera's PERSPECTIVE FRUSTUM matrix. It maps
//     VIEW-SPACE coordinates to clip space.
//
// A three.js scene of buildings in METRES is in neither space. The Mercator
// model matrix is the bridge:
//
//   translate(anchor) -> scale(metres into Mercator units) -> rotate the
//   Mercator axes into three's Y-up axes
//
// The order is not guessable, and getting it wrong is silent: the layer
// installs, activates, reports success, and draws nothing. This project has
// shipped that bug twice — once as "draw(gl, matrix)" from a pre-MapLibre-5
// branch, once as "use args.projectionMatrix" — and in both cases every test
// that did not look at pixels stayed green.
//
// scripts/test-custom-layer-projection.mjs checks the composition against a
// fixture captured from a live MapLibre 6.4.1 session, to the pixel.

// Compose the camera projection for a scene placed in metres relative to a
// Mercator anchor.
//
// anchor: { x, y, z }  the anchor's normalised Mercator coordinates
//         { scale }    Mercator units per metre at the anchor's latitude
//
// Returns a THREE.Matrix4 for camera.projectionMatrix, or null when MapLibre
// did not hand us a usable main matrix.
export function composeProjection(THREE, args, anchor) {
  const main = mercatorModelMatrix(args);
  if (!main || !anchor) return null;
  const { x, y, z, scale } = anchor;
  if (![x, y, z, scale].every(Number.isFinite) || scale === 0) return null;
  const model = new THREE.Matrix4()
    .makeTranslation(x, y, z)
    .scale(new THREE.Vector3(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  return new THREE.Matrix4().fromArray(main).multiply(model);
}
