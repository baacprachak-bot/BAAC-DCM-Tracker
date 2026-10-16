const ASSETS = /* build:assets */ {};
const staffRoles = ['credit_head', 'assistant_manager', 'manager'];
const approvers = ['assistant_manager', 'manager'];
const securityHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' https://static.line-scdn.net; connect-src 'self' https://*.line.me https://*.line-scdn.net; img-src 'self' data: https://*.line-scdn.net https://*.line.me; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > 16384) { await reader.cancel(); fail(413, 'ข้อมูลมีขนาดใหญ่เกินไป'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function input(request) { try { return JSON.parse(await readBody(request)); } catch (e) { if (e.status) throw e; fail(400, 'ข้อมูลไม่ถูกต้อง'); } }
const admins = env => (env.ADMIN_LINE_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
function localDemo(request, env) { return env.LOCAL_DEMO === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname); }

export function createHandler({ fetcher = globalThis.fetch, assets = ASSETS } = {}) {
  async function identity(request, env) {
    let id, name;
    if (localDemo(request, env)) {
      const role = request.headers.get('x-demo-role');
      if (!['admin', ...staffRoles, 'pending'].includes(role)) fail(401, 'เลือกบทบาทสำหรับทดลอง');
      id = `demo-${role}`; name = ({ credit_head: 'หัวหน้าสินเชื่อ (ทดสอบ)', assistant_manager: 'ผู้ช่วยผู้จัดการ (ทดสอบ)', manager: 'ผู้จัดการ (ทดสอบ)', admin: 'ผู้ดูแล (ทดสอบ)', pending: 'เจ้าหน้าที่ใหม่ (ทดสอบ)' })[role];
      await env.DB.prepare('INSERT OR IGNORE INTO staff(line_user_id,display_name,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, name, staffRoles.includes(role) ? role : null, role === 'pending' ? 'pending' : 'active', new Date().toISOString(), new Date().toISOString()).run();
      await env.DB.prepare('UPDATE staff SET display_name=? WHERE line_user_id=?').bind(name, id).run();
      if (role === 'admin') return { id, name, role, status: 'active' };
    } else {
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) fail(401, 'กรุณาเข้าสู่ระบบผ่าน LINE');
      if (!env.LINE_LOGIN_CHANNEL_ID) fail(503, 'ยังไม่ได้ตั้งค่า LINE Login Channel');
      let response;
      try { response = await fetcher('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', body: new URLSearchParams({ id_token: token, client_id: env.LINE_LOGIN_CHANNEL_ID }), signal: AbortSignal.timeout(10000) }); }
      catch { fail(503, 'ติดต่อ LINE ไม่ได้ กรุณาลองใหม่'); }
      if (!response.ok) fail(response.status >= 500 ? 503 : 401, 'กรุณาเข้าสู่ระบบ LINE ใหม่');
      const claims = await response.json();
      if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) fail(401, 'ข้อมูลบัญชี LINE ไม่ถูกต้อง');
      id = claims.sub; name = typeof claims.name === 'string' ? claims.name.slice(0, 100) : 'เจ้าหน้าที่';
      const now = new Date().toISOString();
      await env.DB.prepare('INSERT OR IGNORE INTO staff(line_user_id,display_name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, name, now, now).run();
      if (admins(env).includes(id)) return { id, name, role: 'admin', status: 'active' };
    }
    const staff = await env.DB.prepare('SELECT * FROM staff WHERE line_user_id=?').bind(id).first();
    return { id, name, role: staff.role, status: staff.status };
  }
  const allow = (user, roles) => { if (user.status !== 'active' || !roles.includes(user.role)) fail(403, 'บัญชีนี้ไม่มีสิทธิ์ใช้งานส่วนนี้'); };
  async function replyToMenu(payload, env) {
    for (const event of payload.events || []) {
      if (event.type !== 'message' || event.message?.type !== 'text' || event.source?.type !== 'user' || !event.replyToken) continue;
      const page = ({ 'บันทึกลูกค้า': 'create', 'รออนุมัติ': 'pending', 'รายการรออนุมัติ': 'pending', 'อนุมัติแล้ว': 'approved', 'รายการอนุมัติแล้ว': 'approved' })[event.message.text.trim()];
      const text = page ? `เปิดระบบจัดการลูกค้า\nhttps://liff.line.me/${env.LIFF_ID}?page=${page}` : 'กรุณาเลือกเมนู บันทึกลูกค้า / รออนุมัติ / รายการอนุมัติแล้ว เพื่อเข้าใช้งานระบบ';
      const response = await fetcher('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` }, body: JSON.stringify({ replyToken: event.replyToken, messages: [{ type: 'text', text }] }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('LINE reply failed');
    }
  }
  return async (request, env, ctx = { waitUntil() {} }) => {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        if (!env.DB) return json({ ok: false }, 503);
        await env.DB.prepare('SELECT COUNT(*) AS count FROM staff').first();
        return json({ ok: true, version: '1.0.0' });
      }
      if (request.method === 'GET' && url.pathname === '/api/config') return json({ demo: localDemo(request, env), liffId: env.LIFF_ID || '' });
      if (request.method === 'POST' && url.pathname === '/webhook') {
        if (!env.LINE_CHANNEL_SECRET) fail(503, 'ยังไม่ได้ตั้งค่า LINE webhook');
        const body = await readBody(request);
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(env.LINE_CHANNEL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        let signature; try { signature = Uint8Array.from(atob(request.headers.get('x-line-signature') || ''), c => c.charCodeAt(0)); } catch { fail(401, 'Invalid signature'); }
        if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(body))) fail(401, 'Invalid signature');
        let payload; try { payload = JSON.parse(body); } catch { fail(400, 'Invalid JSON'); }
        if (!Array.isArray(payload.events)) fail(400, 'Invalid events');
        if (payload.events.length && (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LIFF_ID)) fail(503, 'ยังไม่ได้ตั้งค่า LINE Messaging API');
        if (payload.events.length) ctx.waitUntil(replyToMenu(payload, env).catch(() => console.error('LINE menu reply failed')));
        return json({ ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'POST' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) fail(403, 'ต้นทางคำขอไม่ถูกต้อง');
        if (!env.DB) fail(503, 'ยังไม่ได้เชื่อมฐานข้อมูล');
        const user = await identity(request, env);
        if (request.method === 'GET' && url.pathname === '/api/me') return json(user);
        if (url.pathname === '/api/staff' && request.method === 'GET') {
          allow(user, ['admin']);
          return json(await env.DB.prepare('SELECT line_user_id,display_name,role,status,created_at FROM staff ORDER BY created_at DESC LIMIT 500').all().then(r => r.results));
        }
        if (url.pathname === '/api/staff' && request.method === 'POST') {
          allow(user, ['admin']); const values = await input(request);
          const { id, role, status } = values || {};
          if (typeof id !== 'string' || !id || !staffRoles.includes(role) || !['active', 'suspended'].includes(status)) fail(400, 'ข้อมูลสิทธิ์ไม่ถูกต้อง');
          if (admins(env).includes(id) || id === user.id) fail(400, 'ไม่สามารถเปลี่ยนสิทธิ์ผู้ดูแลผ่านหน้านี้');
          const result = await env.DB.prepare('UPDATE staff SET role=?,status=?,updated_by=?,updated_at=? WHERE line_user_id=?').bind(role, status, user.id, new Date().toISOString(), id).run();
          if (!result.meta.changes) fail(404, 'ไม่พบบัญชีเจ้าหน้าที่');
          return json({ ok: true });
        }
        if (url.pathname === '/api/requests' && request.method === 'POST') {
          allow(user, ['credit_head']); const values = await input(request);
          const { firstName, lastName, cif } = values || {};
          if (![firstName, lastName, cif].every(v => typeof v === 'string' && v.trim())) fail(400, 'กรุณากรอกชื่อ นามสกุล และ CIF');
          if (firstName.trim().length > 100 || lastName.trim().length > 100 || !/^\d{4,8}$/.test(cif.trim())) fail(400, 'ชื่อและนามสกุลต้องไม่เกิน 100 ตัวอักษร และ CIF เป็นตัวเลข 4–8 หลัก');
          const id = crypto.randomUUID();
          try { await env.DB.prepare('INSERT INTO requests(id,first_name,last_name,cif,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(id, firstName.trim(), lastName.trim(), cif.trim(), user.id, new Date().toISOString()).run(); }
          catch (e) { if (String(e.message).includes('UNIQUE constraint failed: requests.cif')) fail(409, 'CIF นี้มีรายการรออนุมัติแล้ว'); throw e; }
          return json({ id }, 201);
        }
        if (url.pathname === '/api/requests' && request.method === 'GET') {
          allow(user, approvers);
          const status = url.searchParams.get('status') || 'pending'; const search = url.searchParams.get('search')?.trim() || '';
          const page = Number(url.searchParams.get('page') || 1);
          if (!['pending', 'approved'].includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 100000 || search.length > 100) fail(400, 'เงื่อนไขค้นหาไม่ถูกต้อง');
          const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
          const filter = "r.status=? AND (r.cif LIKE ? ESCAPE '\\' OR r.first_name LIKE ? ESCAPE '\\' OR r.last_name LIKE ? ESCAPE '\\')";
          const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM requests r WHERE ${filter}`).bind(status, pattern, pattern, pattern).first();
          const records = await env.DB.prepare(`SELECT r.*,s.display_name AS created_by_name,a.display_name AS approved_by_name FROM requests r JOIN staff s ON s.line_user_id=r.created_by LEFT JOIN staff a ON a.line_user_id=r.approved_by WHERE ${filter} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`).bind(status, pattern, pattern, pattern, (page - 1) * 20).all();
          return json({ records: records.results, total: count.total, page, pageSize: 20 });
        }
        const approval = url.pathname.match(/^\/api\/requests\/([a-f0-9-]{36})\/approve$/);
        if (approval && request.method === 'POST') {
          allow(user, approvers);
          const result = await env.DB.prepare("UPDATE requests SET status='approved',approved_by=?,approved_at=? WHERE id=? AND status='pending'").bind(user.id, new Date().toISOString(), approval[1]).run();
          if (!result.meta.changes) fail(409, 'รายการนี้อนุมัติแล้วหรือไม่พบรายการรออนุมัติ');
          return json({ ok: true });
        }
        return json({ error: 'ไม่พบรายการ' }, 404);
      }
      if (request.method !== 'GET' || !Object.hasOwn(assets, url.pathname)) return json({ error: 'ไม่พบหน้า' }, 404);
      const asset = assets[url.pathname];
      return new Response(asset.body, { headers: { ...securityHeaders, 'Content-Type': asset.type } });
    } catch (error) { return json({ error: error.status ? error.message : 'ระบบขัดข้อง กรุณาลองใหม่' }, error.status || 500); }
  };
}
export default { fetch: createHandler() };
