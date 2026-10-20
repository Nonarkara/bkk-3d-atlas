// Models are translated to normalized Mercator (0..1), not view-space or
// world-pixel coordinates. MapLibre's raw projectionMatrix is NOT compatible.
export function mercatorModelMatrix(args) {
  const matrix = args?.defaultProjectionData?.mainMatrix;
  return matrix?.length === 16 && Array.from(matrix).every(Number.isFinite) ? matrix : null;
}
