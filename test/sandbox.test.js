import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/worker.js';
import { openDB } from '../tools/db.js';
import { assets } from '../tools/build.js';
import { seedSQL } from '../tools/seed-sandbox.js';

function fixture(t) {
  const DB = openDB(), SANDBOX_DB = openDB();
  t.after(() => { DB.close(); SANDBOX_DB.close(); });
  SANDBOX_DB.raw.exec(seedSQL());
  const env = { DB, SANDBOX_DB, LINE_LOGIN_CHANNEL_ID: 'test-channel', ADMIN_LINE_USER_IDS: 'U-owner' };
  const handler = createHandler({ assets: assets(), fetcher: async (url, options) => {
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    return Response.json({ sub: options.body.get('id_token') === 'owner-token' ? 'U-owner' : 'U-other', name: 'ผู้ทดสอบ' });
  } });
  const call = async (path, role = 'credit_head', { token = 'owner-token', method = 'GET', body } = {}) => {
    const response = await handler(new Request(`https://app.example${path}`, { method, headers: { 'x-demo-role': role, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    return { status: response.status, value: await response.json() };
  };
  return { DB, SANDBOX_DB, env, handler, call };
}

test('online sandbox requires verified real admin before allowing simulated roles', async t => {
  const { call, SANDBOX_DB } = fixture(t);
  assert.equal((await call('/sandbox/api/requests', 'manager', { token: null })).status, 401);
  assert.equal((await call('/sandbox/api/requests', 'manager', { token: 'staff-token' })).status, 403);
  const user = await call('/sandbox/api/me');
  assert.equal(user.value.id, 'demo-credit_head');
  assert.equal((await call('/api/me', 'manager')).value.role, 'admin');
  assert.equal((await call('/sandbox/api/requests', 'pending')).status, 403);
  assert.equal((await call('/sandbox/api/me', 'invalid')).status, 401);
  assert.equal(SANDBOX_DB.raw.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 15);
});

test('sandbox workflow and staff changes cannot modify or expose production customer data', async t => {
  const { DB, SANDBOX_DB, call } = fixture(t);
  DB.raw.exec("INSERT INTO staff VALUES('real-creator','ข้อมูลระบบจริง','credit_head','active','2026-10-16','2026-10-16',NULL); INSERT INTO requests(id,first_name,last_name,cif,created_by,created_at) VALUES('protected-production','ข้อมูลจริง','ต้องไม่ปะปน','99999999','real-creator','2026-10-16');");
  const before = JSON.stringify(DB.raw.prepare('SELECT * FROM requests').all());
  const initial = await call('/sandbox/api/requests', 'manager');
  assert.equal(initial.value.total, 10);
  assert.ok(initial.value.records.every(row => row.cif !== '99999999'));
  const created = await call('/sandbox/api/requests', 'credit_head', { method: 'POST', body: { firstName: 'ทดลองเพิ่ม', lastName: 'สมมติ', cif: '00334455' } });
  assert.equal(created.status, 201);
  const path = `/sandbox/api/requests/${created.value.id}/approve`;
  assert.equal((await call(path, 'credit_head', { method: 'POST' })).status, 403);
  assert.equal((await call(path, 'assistant_manager', { method: 'POST' })).status, 200);
  assert.equal((await call(path, 'manager', { method: 'POST' })).status, 409);
  const approved = await call('/sandbox/api/requests?status=approved&search=00334455', 'manager');
  assert.equal(approved.value.total, 1);
  assert.equal(approved.value.records[0].approved_by, 'demo-assistant_manager');
  assert.equal((await call('/sandbox/api/staff', 'admin', { method: 'POST', body: { id: 'real-creator', role: 'manager', status: 'suspended' } })).status, 404);
  assert.equal(JSON.stringify(DB.raw.prepare('SELECT * FROM requests').all()), before);
  assert.equal(DB.raw.prepare("SELECT role FROM staff WHERE line_user_id='real-creator'").get().role, 'credit_head');
  assert.equal(SANDBOX_DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE target=? AND action='customer_approved'").get(created.value.id).n, 1);
});

test('sandbox refuses aliased or missing database and idempotent seed preserves trial actions', async t => {
  const { env, handler, SANDBOX_DB } = fixture(t);
  for (const bad of [undefined, env.DB]) {
    const response = await handler(new Request('https://app.example/sandbox/api/me', { headers: { Authorization: 'Bearer owner-token', 'x-demo-role': 'manager' } }), { ...env, SANDBOX_DB: bad });
    assert.equal(response.status, 503);
  }
  const id = '00000000-0000-4000-8000-000000000001';
  SANDBOX_DB.raw.prepare("UPDATE requests SET status='approved',approved_by='demo-manager',approved_at='2026-10-16T11:00:00Z' WHERE id=?").run(id);
  const count = SANDBOX_DB.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  SANDBOX_DB.raw.exec(seedSQL());
  assert.equal(SANDBOX_DB.raw.prepare('SELECT COUNT(*) AS n FROM requests').get().n, 15);
  assert.equal(SANDBOX_DB.raw.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, count);
  assert.equal(SANDBOX_DB.raw.prepare('SELECT status FROM requests WHERE id=?').get(id).status, 'approved');
});
