// Static file server for Ornate Chess, bound to 0.0.0.0 so a public tunnel can reach it.
// Usage: node tools/public-server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const PORT = +(process.argv[2] || process.env.PORT || 8477);
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  else if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    const ext = path.extname(file);
    const name = path.basename(file);
    const headers = {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': name === 'sw.js' || ext === '.html' || ext === '.webmanifest' ? 'no-cache' : 'no-cache',
    };
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ornate Chess serving ${ROOT} on http://${HOST}:${PORT}/`);
});
