import http from 'node:http';
import { Readable } from 'node:stream';
import { createHandler } from '../src/worker.js';
import { openDB } from './db.js';
import { assets } from './build.js';
const db = openDB(process.env.DATABASE_PATH || 'data/v2.sqlite');
const handler = createHandler({ assets: assets() });
const env = { DB: db, LOCAL_DEMO: 'true', LIFF_ID: process.env.LIFF_ID || '2012048449-ZBktvJBu' };
const server = http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method, headers: req.headers, ...(['GET','HEAD'].includes(req.method) ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const response = await handler(request, env, { waitUntil: promise => promise.catch(() => {}) });
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Local server error'); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`DCM v1 local simulator on port ${server.address().port}; synthetic data only`));
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
