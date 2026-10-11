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
    const center = points.reduce((p, q) => p.map((v, i) => v + q[i] / 4), [0, 0]);
    const lerp = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
    const height = Number(feature.properties?.render_height ?? feature.properties?.height);
    if (!Number.isFinite(height) || height < 5 || height > 50) continue;
    // Native extrusion strips share MapLibre's depth buffer. Fine steps approximate
    // a gable; the existing massing stays intact underneath, including on failure.
    for (let tier = 0; tier < 3; tier++) {
    const scale = [1, 0.82, 0.64][tier];
    const [a, b, c, d] = points.map(p => p.map((v, i) => center[i] + (v - center[i]) * scale));
    for (let i = 0; i < 48; i++) {
      const t0 = i / 48, t1 = (i + 1) / 48;
      const p = lerp(a, b, t0), q = lerp(a, b, t1);
      const r = lerp(d, c, t1), s = lerp(d, c, t0);
      features.push({type: 'Feature', properties: {
        name, base: height + tier * 2.8, top: height + tier * 2.8 + 6 * scale * (1 - Math.abs(2 * (t0 + t1) / 2 - 1)),
        color: (i === 0 || i === 47) ? '#d7ac59' : i < 24 ? '#8e382b' : '#c57548',
        footprintSource: `https://www.openstreetmap.org/way/${String(feature.properties.id).replace('bkk-building-', '')}`,
        accuracy: 'Schematic roof reconstruction · unsurveyed heights · not for flood calculations',
      }, geometry: {type: 'Polygon', coordinates: [[p, q, r, s, p]]}});
    }
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
    if (!map.__bkkxHeritageRoofClick) {
      map.__bkkxHeritageRoofClick = event => {
        const p = event.features?.[0]?.properties;
        if (!p) return;
        const card = document.createElement('div');
        card.className = 'atlas-cctv-card';
        const title = document.createElement('strong'); title.textContent = p.name;
        const note = document.createElement('p'); note.textContent = p.accuracy;
        const link = document.createElement('a'); link.href = p.footprintSource;
        link.textContent = 'OSM footprint · ODbL'; link.target = '_blank'; link.rel = 'noreferrer';
        card.append(title, note, link);
        new maplibregl.Popup({className: 'atlas-cctv-popup', maxWidth: '280px'}).setLngLat(event.lngLat).setDOMContent(card).addTo(map);
      };
      map.on('click', ROOF_LAYER, map.__bkkxHeritageRoofClick);
    }
  } catch (error) {
    if (map.getLayer(ROOF_LAYER)) map.removeLayer(ROOF_LAYER);
    map.removeSource(ROOF_SOURCE);
    throw error;
  }
}

export function uninstallHeritageRoofs(map) {
  if (map.__bkkxHeritageRoofClick) {
    map.off('click', ROOF_LAYER, map.__bkkxHeritageRoofClick);
    delete map.__bkkxHeritageRoofClick;
  }
  if (map.getLayer(ROOF_LAYER)) map.removeLayer(ROOF_LAYER);
  if (map.getSource(ROOF_SOURCE)) map.removeSource(ROOF_SOURCE);
}
