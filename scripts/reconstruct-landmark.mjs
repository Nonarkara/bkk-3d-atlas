// Stages ONLY manifest-listed photos. Unreviewed neighbours never enter RealityKit.
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadValidatedPhotoSet } from './photo-intake.mjs';
import { candidateOutput, publishCandidate } from './reconstruction-output.mjs';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}
const [manifestArg, outputArg] = process.argv.slice(2);
let staging;
try {
  if (!manifestArg || !outputArg) throw new Error('Usage: npm run reconstruct:landmark -- MANIFEST.json OUTPUT.usdz');
  const manifestPath = resolve(manifestArg);
  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
  const output = await candidateOutput(outputArg, publicRoot);
  const approved = await loadValidatedPhotoSet(manifestPath);
  console.log(approved.summary);
  if (process.platform !== 'darwin') throw new Error('Local Object Capture requires macOS');
  staging = await mkdtemp(join(tmpdir(), 'bkk-reconstruction-'));
  const photos = join(staging, 'photos'); await mkdir(photos);
  for (const [i, photo] of approved.photos.entries()) {
    const extension = extname(photo.path).toLowerCase();
    if (!['.jpg','.jpeg','.png','.heic'].includes(extension)) throw new Error('Unsupported photo extension');
    const destination = join(photos, `${String(i).padStart(4, '0')}${extension}`);
    await copyFile(photo.path, destination);
    // Hash the staged bytes too, so source changes during staging cannot slip in.
    if (createHash('sha256').update(await readFile(destination)).digest('hex') !== photo.sha256) throw new Error('Staged photo hash mismatch');
  }
  const executable = join(staging, 'reconstruct');
  await run('swiftc', ['-parse-as-library', fileURLToPath(new URL('./reconstruct-landmark.swift', import.meta.url)), '-o', executable]);
  const candidate = join(staging, 'candidate.usdz');
  await run(executable, [photos, candidate]);
  await publishCandidate(candidate, output, publicRoot);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (staging) await rm(staging, {recursive:true, force:true}); }
