import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createApp(options = {}) {
  const config = { database: process.env.DATABASE_PATH || 'data/tracker.sqlite', demo: process.env.DEMO_MODE === 'true', users: JSON.parse(process.env.LINE_USERS_JSON || '{}'), ...options };
  mkdirSync(dirname(config.database), { recursive: true });
  const db = new DatabaseSync(config.database);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, cif TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    approved_by TEXT, approved_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_cif ON requests(cif) WHERE status='pending';`);
  const roles = ['credit_head', 'assistant_manager', 'manager'];
  const approvers = ['assistant_manager', 'manager'];
  function fail(status, message) { throw Object.assign(new Error(message), { status }); }
  async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 16384) fail(413, 'ข้อมูลมีขนาดใหญ่เกินไป'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  async function user(req) {
    if (config.demo) {
      const role = req.headers['x-demo-role'];
      if (!roles.includes(role)) fail(401, 'กรุณาเลือกบทบาทสำหรับทดลอง');
      return { id: `demo-${role}`, role };
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token || !process.env.LINE_LOGIN_CHANNEL_ID) fail(401, 'กรุณาเข้าสู่ระบบผ่าน LINE');
    const response = await fetch('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', body: new URLSearchParams({ id_token: token, client_id: process.env.LINE_LOGIN_CHANNEL_ID }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) fail(401, 'การเข้าสู่ระบบ LINE หมดอายุ');
    const identity = await response.json();
    const role = config.users[identity.sub];
    if (!roles.includes(role)) fail(403, 'บัญชี LINE นี้ยังไม่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแล');
    return { id: identity.sub, role };
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/api/config') return send(200, { demo: config.demo, liffId: process.env.LIFF_ID || '' });
      if (req.method === 'POST' && url.pathname === '/webhook') {
        const raw = await body(req); const secret = process.env.LINE_CHANNEL_SECRET;
        if (!secret) return send(503, { error: 'ยังไม่ได้ตั้งค่า LINE webhook' });
        const actual = Buffer.from(req.headers['x-line-signature'] || '', 'base64');
        const expected = createHmac('sha256', secret).update(raw).digest();
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Invalid signature' });
        return send(200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        const current = await user(req);
        if (req.method === 'GET' && url.pathname === '/api/me') return send(200, current);
        if (req.method === 'GET' && url.pathname === '/api/requests') {
          if (!approvers.includes(current.role)) fail(403, 'เฉพาะผู้อนุมัติเท่านั้น');
          const status = url.searchParams.get('status') || 'pending';
          if (!['pending', 'approved'].includes(status)) fail(400, 'สถานะไม่ถูกต้อง');
          return send(200, db.prepare('SELECT * FROM requests WHERE status=? ORDER BY id DESC LIMIT 200').all(status));
        }
        if (req.method === 'POST' && url.pathname === '/api/requests') {
          if (current.role !== 'credit_head') fail(403, 'เฉพาะหัวหน้าฝ่ายสินเชื่อเท่านั้น');
          let input; try { input = JSON.parse((await body(req)).toString()); } catch (e) { if (e.status) throw e; fail(400, 'ข้อมูลไม่ถูกต้อง'); }
          const { firstName, lastName, cif } = input || {};
          if (![firstName, lastName, cif].every(v => typeof v === 'string' && v.trim())) fail(400, 'กรุณากรอกชื่อ นามสกุล และ CIF');
          if (firstName.trim().length > 100 || lastName.trim().length > 100 || !/^\d{1,30}$/.test(cif.trim())) fail(400, 'ชื่อและนามสกุลต้องไม่เกิน 100 ตัวอักษร และ CIF ต้องเป็นตัวเลขไม่เกิน 30 หลัก');
          try {
            const result = db.prepare('INSERT INTO requests(first_name,last_name,cif,created_by,created_at) VALUES(?,?,?,?,?)').run(firstName.trim(), lastName.trim(), cif.trim(), current.id, new Date().toISOString());
            return send(201, { id: Number(result.lastInsertRowid) });
          } catch (e) { if (e.code?.includes('SQLITE') && e.message.includes('UNIQUE')) fail(409, 'CIF นี้มีรายการรออนุมัติอยู่แล้ว'); throw e; }
        }
        const match = url.pathname.match(/^\/api\/requests\/(\d+)\/approve$/);
        if (req.method === 'POST' && match) {
          if (!approvers.includes(current.role)) fail(403, 'เฉพาะผู้อนุมัติเท่านั้น');
          const result = db.prepare("UPDATE requests SET status='approved',approved_by=?,approved_at=? WHERE id=? AND status='pending'").run(current.id, new Date().toISOString(), match[1]);
          if (!result.changes) fail(409, 'ไม่พบรายการรออนุมัติ หรือรายการนี้อนุมัติแล้ว');
          return send(200, { ok: true });
        }
        return send(404, { error: 'ไม่พบรายการ' });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method !== 'GET' || !files[url.pathname]) return send(404, { error: 'ไม่พบหน้า' });
      const [file, type] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(readFileSync(new URL(`./public/${file}`, import.meta.url)));
    } catch (e) { send(e.status || 500, { error: e.status ? e.message : 'ระบบขัดข้อง กรุณาลองใหม่' }); }
  });
  server.on('close', () => db.close());
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = process.env.DEMO_MODE === 'true';
  const server = createApp();
  server.listen(Number(process.env.PORT || 3000), demo ? '127.0.0.1' : '0.0.0.0', () => console.log(`BAAC DCM listening on port ${server.address().port} (${demo ? 'local demo' : 'LINE mode'})`));
}
