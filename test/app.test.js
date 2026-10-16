import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../src/worker.js';
import { openDB } from '../tools/db.js';
import { assets, build } from '../tools/build.js';

function fixture(t, overrides = {}, fetcher) {
  const DB = overrides.DB || openDB();
  t.after(() => DB.close());
  const env = { DB, LOCAL_DEMO: 'true', ...overrides };
  const handler = createHandler({ assets: assets(), ...(fetcher ? { fetcher } : {}) });
  const call = async (path, role, method = 'GET', body, extra = {}) => {
    const response = await handler(new Request(`http://localhost${path}`, { method, headers: { 'x-demo-role': role || '', 'Content-Type': 'application/json', ...(extra.headers || {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil() {} });
    return { status: response.status, value: await response.json() };
  };
  return { DB, env, handler, call };
}
const customer = { firstName: 'ทดสอบ', lastName: 'ระบบ', cif: '00123456' };

test('shared workflow persists, enforces all roles, preserves CIF and audits approval once', async t => {
  const { call, DB } = fixture(t);
  for (const role of ['manager', 'assistant_manager', 'admin', 'pending']) assert.equal((await call('/api/requests', role, 'POST', customer)).status, 403);
  const created = await call('/api/requests', 'credit_head', 'POST', customer); assert.equal(created.status, 201);
  assert.equal((await call('/api/requests', 'credit_head', 'POST', customer)).status, 409);
  assert.equal((await call('/api/requests', 'credit_head')).status, 403);
  let pending = await call('/api/requests', 'assistant_manager');
  assert.equal(pending.value.total, 1); assert.equal(pending.value.records[0].cif, '00123456');
  const path = `/api/requests/${created.value.id}/approve`;
  assert.equal((await call(path, 'credit_head', 'POST')).status, 403);
  const approvals = await Promise.all([call(path, 'assistant_manager', 'POST'), call(path, 'manager', 'POST')]);
  assert.deepEqual(approvals.map(r => r.status).sort(), [200,409]);
  assert.equal((await call('/api/requests', 'manager')).value.total, 0);
  const approved = await call('/api/requests?status=approved', 'manager');
  assert.equal(approved.value.records[0].id, created.value.id);
  assert.ok(approved.value.records[0].approved_at); assert.ok(approved.value.records[0].approved_by_name);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='customer_approved'").get().n, 1);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='customer_submitted'").get().n, 1);
});

test('validation, pagination, safe search and cross-origin writes', async t => {
  const { call } = fixture(t);
  for (const data of [{}, null, { ...customer, cif: 'ABC' }, { ...customer, cif: 123456 }, { ...customer, firstName: ' ' }, { ...customer, cif: '123456789' }]) assert.equal((await call('/api/requests', 'credit_head', 'POST', data)).status, 400);
  assert.equal((await call('/api/requests', 'credit_head', 'POST', customer, { headers: { origin: 'https://evil.invalid' } })).status, 403);
  for (let i = 0; i < 25; i++) assert.equal((await call('/api/requests', 'credit_head', 'POST', { ...customer, cif: String(1000 + i) })).status, 201);
  const one = await call('/api/requests?page=1', 'manager'); const two = await call('/api/requests?page=2', 'manager');
  assert.equal(one.value.total, 25); assert.equal(one.value.records.length, 20); assert.equal(two.value.records.length, 5);
  assert.equal(new Set([...one.value.records, ...two.value.records].map(r => r.id)).size, 25);
  assert.equal((await call('/api/requests?search=1001', 'manager')).value.total, 1);
  assert.equal((await call('/api/requests?search=%25', 'manager')).value.total, 0);
  for (const query of ['page=0','page=NaN','status=deleted']) assert.equal((await call(`/api/requests?${query}`, 'manager')).status, 400);
});

test('verified LINE identity enrolls pending; admin grants and suspends access', async t => {
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push({ url, options });
    if (options.body.get('id_token') === 'bad-token') return Response.json({}, { status: 400 });
    const sub = options.body.get('id_token') === 'admin-token' ? 'U-admin' : 'U-member';
    return Response.json({ sub, name: 'เจ้าหน้าที่ทดสอบ' });
  };
  const { handler, DB } = fixture(t, { LOCAL_DEMO: 'false', LINE_LOGIN_CHANNEL_ID: 'test-channel', ADMIN_LINE_USER_IDS: 'U-admin' }, fetcher);
  const env = { DB, LINE_LOGIN_CHANNEL_ID: 'test-channel', ADMIN_LINE_USER_IDS: 'U-admin' };
  const call = async (path, token, method = 'GET', body) => {
    const response = await handler(new Request('https://worker.example' + path, { method, headers: { Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, value: await response.json() };
  };
  assert.equal((await call('/api/me', 'bad-token')).status, 401);
  assert.equal((await call('/api/me', 'user-token')).value.status, 'pending');
  assert.equal((await call('/api/requests', 'user-token')).status, 403);
  assert.equal((await call('/api/staff', 'user-token')).status, 403);
  assert.equal((await call('/api/staff', 'admin-token', 'POST', { id: 'U-member', role: 'credit_head', status: 'active' })).status, 200);
  assert.equal((await call('/api/requests', 'user-token', 'POST', customer)).status, 201);
  assert.equal((await call('/api/staff', 'admin-token', 'POST', { id: 'U-member', role: 'credit_head', status: 'suspended' })).status, 200);
  assert.equal((await call('/api/requests', 'user-token', 'POST', { ...customer, cif: '9999' })).status, 403);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='staff_access_changed'").get().n, 2);
  assert.ok(seen.every(r => r.url === 'https://api.line.me/oauth2/v2.1/verify' && r.options.body.get('client_id') === 'test-channel'));
});

test('production cannot enable demo by header or setting on public host; LINE failures fail closed', async t => {
  const { handler, DB } = fixture(t, {}, async () => { throw new Error('network down'); });
  const response = await handler(new Request('https://worker.example/api/me', { headers: { 'x-demo-role': 'admin' } }), { DB, LOCAL_DEMO: 'true' });
  assert.equal(response.status, 401);
  const config = await handler(new Request('https://worker.example/api/config'), { LOCAL_DEMO: 'true' });
  assert.equal((await config.json()).demo, false);
  const unavailable = await handler(new Request('https://worker.example/api/me', { headers: { Authorization: 'Bearer test' } }), { DB, LINE_LOGIN_CHANNEL_ID: 'x' });
  assert.equal(unavailable.status, 503);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM staff').get().n, 0);
});

test('webhook verifies signature before replying, returns LIFF links and ignores group chat', async t => {
  const calls = [];
  const { handler } = fixture(t, {}, async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({}); });
  const env = { LINE_CHANNEL_SECRET: 'test-secret', LINE_CHANNEL_ACCESS_TOKEN: 'test-token', LIFF_ID: 'test-liff' };
  const invoke = async (events, signed = true) => {
    const body = JSON.stringify({ events }); const jobs = [];
    const signature = signed ? createHmac('sha256', env.LINE_CHANNEL_SECRET).update(body).digest('base64') : 'invalid';
    const response = await handler(new Request('https://worker.example/webhook', { method: 'POST', body, headers: { 'x-line-signature': signature } }), env, { waitUntil: job => jobs.push(job) });
    await Promise.all(jobs); return response;
  };
  const event = { type: 'message', message: { type: 'text', text: 'รายการรออนุมัติ' }, source: { type: 'user', userId: 'test' }, replyToken: 'reply' };
  assert.equal((await invoke([event], false)).status, 401); assert.equal(calls.length, 0);
  assert.equal((await invoke([])).status, 200);
  assert.equal((await invoke([event])).status, 200); assert.match(calls[0].body.messages[0].text, /test-liff\?page=pending/);
  await invoke([{ ...event, source: { type: 'group' } }]); assert.equal(calls.length, 1);
});

test('database survives restart and applying initial migration again preserves records', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'dcm-v2-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'db.sqlite'); const db = openDB(path); const app = createHandler();
  const response = await app(new Request('http://localhost/api/requests', { method: 'POST', headers: { 'x-demo-role': 'credit_head' }, body: JSON.stringify(customer) }), { DB: db, LOCAL_DEMO: 'true' });
  assert.equal(response.status, 201); db.close();
  const restored = openDB(path); t.after(() => restored.close());
  assert.equal(restored.raw.prepare('SELECT cif FROM requests').get().cif, customer.cif);
});

test('built Worker serves current UI and security headers without Node APIs', async t => {
  build();
  const { default: worker } = await import('../dist/worker.mjs');
  const home = await worker.fetch(new Request('https://worker.example/'), {});
  assert.equal(home.status, 200); assert.match(await home.text(), /บันทึกลูกค้า/);
  assert.match(home.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('Cache-Control'), 'no-store');
  const menu = await worker.fetch(new Request('https://worker.example/sandbox/menu'), {});
  const html = await menu.text();
  assert.equal(menu.status, 200);
  assert.match(html, /data:image\/png;base64,/);
  assert.ok(!html.includes('__RICH_MENU_IMAGE__'));
  assert.match(html, /\/sandbox\?page=pending/);
  const { handler, env } = fixture(t);
  assert.equal((await handler(new Request('http://localhost/health'), env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://worker.example/health'), {})).status, 503);
});
