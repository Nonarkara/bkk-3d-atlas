// Local, fail-closed intake for RealityKit. This does not assert photo overlap.
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function validatePhotoSet(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!['wat-arun', 'grand-palace'].includes(manifest.landmark)) throw new Error('Unknown pilot landmark');
  if (!Array.isArray(manifest.photos) || manifest.photos.length < 20) throw new Error('Need at least 20 overlapping photographs; this is an intake floor, not proof of coverage');
  const root = await realpath(dirname(manifestPath));
  const hashes = new Set();
  for (const photo of manifest.photos) {
    if (!photo.file || !photo.author || !photo.source || !photo.license || !/^[a-f0-9]{64}$/.test(photo.sha256 || '')) throw new Error('Each photograph needs file, author, source, license and SHA256');
    const source = new URL(photo.source);
    if (source.protocol !== 'https:') throw new Error('Photo source must be HTTPS');
    if (!['CC0-1.0', 'CC-BY-2.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-SA-3.0', 'CC-BY-SA-4.0', 'own-permission'].includes(photo.license)) throw new Error('License needs manual review');
    if (photo.license === 'own-permission' && !photo.permission) throw new Error('Record permission evidence');
    const path = await realpath(resolve(root, photo.file));
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Photo escapes intake folder');
    const bytes = await readFile(path);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== photo.sha256) throw new Error('Photo hash mismatch');
    if (hashes.has(hash)) throw new Error('Duplicate photograph');
    hashes.add(hash);
  }
  if (manifest.coverageReviewed !== true || manifest.licenseReviewed !== true) throw new Error('Human review of overlap and license obligations required');
  return { landmark: manifest.landmark, photographs: hashes.size, status: 'intake-valid-not-reconstructed' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await validatePhotoSet(resolve(process.argv[2] || 'missing-manifest.json')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
