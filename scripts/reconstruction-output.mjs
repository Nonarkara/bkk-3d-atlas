import { copyFile, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename, join, relative, isAbsolute, sep } from 'node:path';

export async function candidateOutput(outputArg, publicDirectory) {
  const output = join(await realpath(dirname(resolve(outputArg))), basename(outputArg));
  const publicRoot = await realpath(publicDirectory);
  const rel = relative(publicRoot, output);
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (!outside) throw new Error('Candidates must stay outside public/ until reviewed');
  if (!output.endsWith('.usdz')) throw new Error('Output must end with .usdz');
  try {
    await lstat(output); // Unlike access(), also catches dangling symbolic links.
  } catch (error) {
    if (error.code === 'ENOENT') return output;
    throw error;
  }
  throw new Error('Output exists; refusing to overwrite');
}

export async function publishCandidate(candidate, output, publicDirectory) {
  // Revalidate after the potentially long reconstruction. COPYFILE_EXCL also
  // rejects files or links created between this check and the actual write.
  const checked = await candidateOutput(output, publicDirectory);
  await copyFile(candidate, checked, constants.COPYFILE_EXCL);
}
