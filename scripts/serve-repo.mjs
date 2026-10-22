// A static server for the repository root, for the QA pages in scripts/.
//
// The shipped atlas is served from public/; pages in scripts/ import from
// public/ and must therefore be served from the root, not from public/.
//
//   node scripts/serve-repo.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || 8899);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.usdz': 'model/vnd.usdz+zip',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`repo root on http://127.0.0.1:${port}`);
  console.log(`  QA page: http://127.0.0.1:${port}/scripts/icon-lab.html`);
});
