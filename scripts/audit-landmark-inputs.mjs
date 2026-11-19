// Read-only capture/data preflight. Missing tags are unknown, never defaults.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const DETAIL_FIELDS = ['roof:shape', 'roof:height', 'roof:material', 'building:material', 'height_source'];
const present = v => v !== null && v !== undefined && String(v).trim() !== '';

function concave(ring) {
  const p = ring.slice();
  if (p.length > 1 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]) p.pop();
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const cross = (b[0]-a[0])*(c[1]-b[1]) - (b[1]-a[1])*(c[0]-b[0]);
    if (Math.abs(cross) < 1e-16) continue;
    const next = Math.sign(cross);
    if (sign && next !== sign) return true;
    sign = next;
  }
  return false;
}

export function auditLandmarkInputs(collection) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Expected GeoJSON FeatureCollection');
  const fields = Object.fromEntries(DETAIL_FIELDS.map(k => [k, 0]));
  let polygonParts = 0, partsWithHoles = 0, concaveOuterRings = 0, unsupportedFeatures = 0;
  for (const f of collection.features) {
    for (const k of DETAIL_FIELDS) if (present(f.properties?.[k])) fields[k]++;
    const g = f.geometry;
    const parts = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null;
    if (!parts) { unsupportedFeatures++; continue; }
    for (const rings of parts) {
      if (!Array.isArray(rings) || !rings.length) throw new Error('Missing polygon rings');
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) throw new Error('Invalid polygon coordinates');
      }
      polygonParts++;
      if (rings.length > 1) partsWithHoles++;
      if (concave(rings[0])) concaveOuterRings++;
    }
  }
  return {
    features: collection.features.length, fields,
    polygonParts, partsWithHoles, concaveOuterRings, unsupportedFeatures,
    status: 'input-audit-not-reconstruction',
    limitations: 'Counts measure supplied tags and ring shape, not source accuracy, valid topology, photo coverage or surveyed dimensions. Convex-hull models cannot preserve concavities or holes.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2] ? resolve(process.argv[2]) : new URL('../public/bkk-heritage-detail.geojson', import.meta.url);
    console.log(JSON.stringify(auditLandmarkInputs(JSON.parse(await readFile(path, 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
