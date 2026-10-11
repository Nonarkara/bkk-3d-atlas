// Original BKKx schematic geometry, not a scan or a hydraulic obstacle model.
// Footprints remain OSM-derived (ODbL); vertical dimensions are illustrative.
export const ROOF_SOURCE = 'bkkx-heritage-roofs';
export const ROOF_LAYER = 'bkkx-heritage-roofs-3d';
const PILOT = new Map([
  ['bkk-building-23482983', 'Wat Phra Kaew · Ubosot'],
  ['bkk-building-23630098', 'Wat Pho · Ubosot'],
]);

export function buildHeritageRoofs(data) {
  const features = [];
  for (const feature of data.features ?? []) {
    const name = PILOT.get(feature.id ?? feature.properties?.id);
    if (!name || feature.geometry?.type !== 'Polygon') continue;
    const ring = feature.geometry.coordinates[0];
    if (ring.length !== 5 || !ring.flat().every(Number.isFinite)) continue;
    const points = ring.slice(0, 4);
    const distance = (a, b) => Math.hypot((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]);
    // Orient the ridge along the long axis of the existing rectangular footprint.
    if (distance(points[0], points[1]) > distance(points[1], points[2])) points.push(points.shift());
    const [a, b, c, d] = points;
    const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
    const height = Number(feature.properties?.render_height ?? feature.properties?.height);
    if (!Number.isFinite(height) || height < 5 || height > 50) continue;
    // Native extrusion strips share MapLibre's depth buffer. Fine steps approximate
    // a gable; the existing massing stays intact underneath, including on failure.
    for (let i = 0; i < 48; i++) {
      const t0 = i / 48, t1 = (i + 1) / 48;
      const p = lerp(a, b, t0), q = lerp(a, b, t1);
      const r = lerp(d, c, t1), s = lerp(d, c, t0);
      features.push({type: 'Feature', properties: {
        name, base: height, top: height + 6 * (1 - Math.abs(2 * (t0 + t1) / 2 - 1)),
        color: i < 24 ? '#a64e38' : '#c57548',
        accuracy: 'Schematic roof reconstruction · unsurveyed heights · not for flood calculations',
      }, geometry: {type: 'Polygon', coordinates: [[p, q, r, s, p]]}});
    }
  }
  return {type: 'FeatureCollection', features};
}

export function installHeritageRoofs(map, data) {
  const roofs = buildHeritageRoofs(data);
  if (!roofs.features.length || map.getSource(ROOF_SOURCE)) return;
  map.addSource(ROOF_SOURCE, {type: 'geojson', data: roofs,
    attribution: '© OpenStreetMap contributors · BKKx schematic roofs (unsurveyed)'});
  try {
    map.addLayer({id: ROOF_LAYER, type: 'fill-extrusion', source: ROOF_SOURCE, minzoom: 16,
      paint: {'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 1}});
  } catch (error) {
    map.removeSource(ROOF_SOURCE);
    throw error;
  }
}

export function uninstallHeritageRoofs(map) {
  if (map.getLayer(ROOF_LAYER)) map.removeLayer(ROOF_LAYER);
  if (map.getSource(ROOF_SOURCE)) map.removeSource(ROOF_SOURCE);
}
