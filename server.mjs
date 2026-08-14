// Static server for the AETHER RIFT game (game/ directory) — Railway-ready.
// Node ≥ 18, zero dependencies. Gzips text assets, long-caches vendored libs.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'game');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const GZIP = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    let p = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let st = await stat(p).catch(() => null);
    if (st?.isDirectory()) { p = path.join(p, 'index.html'); st = await stat(p).catch(() => null); }
    if (!st) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(p);
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': p.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
    };
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    if (acceptsGzip && GZIP.has(ext) && st.size > 1024) {
      headers['content-encoding'] = 'gzip';
      headers['vary'] = 'accept-encoding';
      res.writeHead(200, headers);
      createReadStream(p).pipe(createGzip({ level: 6 })).pipe(res);
    } else {
      headers['content-length'] = st.size;
      res.writeHead(200, headers);
      createReadStream(p).pipe(res);
    }
  } catch { res.writeHead(500); res.end(); }
}).listen(PORT, () => console.log(`AETHER RIFT serving on :${PORT}`));
