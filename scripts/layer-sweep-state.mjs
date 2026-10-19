// Executed in the map's page by the diagnostic harness; no tab ownership here.
export function snapshotVisibility(map, ids) {
  return ids.map(id => [id, map.getLayoutProperty(id, 'visibility') ?? 'visible']);
}

export function restoreVisibility(map, snapshot) {
  for (const [id, visibility] of snapshot) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
  }
}
