// Stages ONLY manifest-listed photos. Unreviewed neighbours never enter RealityKit.
import { mkdtemp, mkdir, copyFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { validatePhotoSet } from './photo-intake.mjs';

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
  const output = join(await realpath(dirname(resolve(outputArg))), basename(outputArg));
  const publicRoot = await realpath(fileURLToPath(new URL('../public/', import.meta.url)));
  if (!relative(publicRoot, output).startsWith('..')) throw new Error('Candidates must stay outside public/ until reviewed');
  if (!output.endsWith('.usdz')) throw new Error('Output must end with .usdz');
  let exists = true;
  try { await access(output); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
  if (exists) throw new Error('Output exists; refusing to overwrite');
  console.log(await validatePhotoSet(manifestPath));
  if (process.platform !== 'darwin') throw new Error('Local Object Capture requires macOS');
  staging = await mkdtemp(join(tmpdir(), 'bkk-reconstruction-'));
  const photos = join(staging, 'photos'); await mkdir(photos);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [i, photo] of manifest.photos.entries()) {
    const extension = extname(photo.file).toLowerCase();
    if (!['.jpg','.jpeg','.png','.heic'].includes(extension)) throw new Error('Unsupported photo extension');
    const destination = join(photos, `${String(i).padStart(4, '0')}${extension}`);
    await copyFile(resolve(dirname(manifestPath), photo.file), destination);
    // Hash the staged bytes too, so source changes during staging cannot slip in.
    if (createHash('sha256').update(await readFile(destination)).digest('hex') !== photo.sha256) throw new Error('Staged photo hash mismatch');
  }
  const executable = join(staging, 'reconstruct');
  await run('swiftc', ['-parse-as-library', fileURLToPath(new URL('./reconstruct-landmark.swift', import.meta.url)), '-o', executable]);
  await run(executable, [photos, output]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (staging) await rm(staging, {recursive:true, force:true}); }
