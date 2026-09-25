// Serves the static build (out/) at http://127.0.0.1:4341/docs, the way Caddy or Nginx will on
// the server: the files map to /docs/..., and a path without an extension tries <path>.html and
// <path>/index.html. Unknown paths get 404.html. Use it to check `npm run build` before deploying.
//
//   npm run build && npm start
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const flag = process.argv.indexOf('--port');
const PORT = Number(flag > -1 ? process.argv[flag + 1] : process.env.PORT) || 4341;
const BASE = '/docs';
const root = path.resolve(import.meta.dirname, '..', 'out');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** The file for a URL path inside out/, or null. Never leaves out/. */
function resolve(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/\/+$/, '');
  const candidates = path.extname(rel) ? [rel] : [rel, `${rel}.html`, `${rel}/index.html`];
  for (const c of candidates) {
    const file = path.join(root, c);
    if (!file.startsWith(root)) return null;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function send(res, status, file) {
  res.writeHead(status, {
    'Content-Type': TYPES[path.extname(file)] ?? (path.basename(file) === 'search' ? 'application/json' : 'application/octet-stream'),
  });
  fs.createReadStream(file).pipe(res);
}

if (!fs.existsSync(root)) {
  console.error('No out/ folder. Run npm run build first.');
  process.exit(1);
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/') {
      res.writeHead(302, { Location: `${BASE}` });
      return res.end();
    }
    if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('The docs live under /docs.');
    }
    const file = resolve(pathname.slice(BASE.length) || '/index');
    if (file) return send(res, 200, file);
    const notFound = path.join(root, '404.html');
    if (fs.existsSync(notFound)) return send(res, 404, notFound);
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Serving out/ at http://127.0.0.1:${PORT}${BASE}`));
