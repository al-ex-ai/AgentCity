// Minimal static server for the viewer, bound to 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Serve the viewer folder plus an in-memory city.json.
 * @param {string} viewerDir
 * @param {string} cityJson
 * @param {number} [port] 0 picks a free port
 * @returns {Promise<{ url: string, close: () => void }>}
 */
export function serve(viewerDir, cityJson, port = 0) {
  const root = path.resolve(viewerDir);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let url;
    try { url = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (url === '/city.json') {
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      res.end(cityJson);
      return;
    }
    const file = path.resolve(root, '.' + (url.endsWith('/') ? url + 'index.html' : url));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (path.extname(file))] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({ url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() });
    });
  });
}
