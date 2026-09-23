/**
 * Serves the web export (`dist/`) for a browser demo.
 *
 * Exists for one reason: expo-sqlite on web needs SharedArrayBuffer, which a
 * browser only allows on a cross-origin-isolated page, and `expo start --web`
 * does not send the two headers that make a page isolated. Any static host that
 * sets them works as well — this is just the one that needs no setup.
 *
 *   npm run demo:web          # export, then serve on http://localhost:8090
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const port = Number(process.env.PORT ?? 8090);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
};

function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^[/\\]+/, '');
  const candidates = [clean, `${clean}.html`, join(clean, 'index.html')];
  for (const candidate of candidates) {
    const full = join(root, candidate);
    if (!full.startsWith(root)) return null;
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  // Single-page fallback: a deep link like /job/abc is resolved by the router.
  return join(root, 'index.html');
}

createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');
  if (!file) {
    res.writeHead(403).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`ScopeFlow web demo: http://localhost:${port}`);
});
