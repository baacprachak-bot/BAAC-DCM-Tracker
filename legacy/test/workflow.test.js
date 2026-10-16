import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('customer submission, approval, role enforcement and persistent status', async t => {
  const server = createApp({ database: ':memory:', demo: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, role, method = 'GET', body) => {
    const response = await fetch(root + path, { method, headers: { 'x-demo-role': role, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json() };
  };
  const customer = { firstName: 'ทดสอบ', lastName: 'ระบบ', cif: '000123' };
  assert.equal((await call('/api/requests', 'manager', 'POST', customer)).status, 403);
  assert.equal((await call('/api/requests', 'credit_head', 'POST', { ...customer, cif: 'ABC' })).status, 400);
  const created = await call('/api/requests', 'credit_head', 'POST', customer);
  assert.equal(created.status, 201);
  assert.equal((await call('/api/requests', 'credit_head', 'POST', customer)).status, 409);
  assert.equal((await call('/api/requests', 'credit_head')).status, 403);
  const pending = await call('/api/requests', 'assistant_manager');
  assert.equal(pending.value.length, 1); assert.equal(pending.value[0].cif, '000123');
  assert.equal((await call(`/api/requests/${created.value.id}/approve`, 'credit_head', 'POST')).status, 403);
  assert.equal((await call(`/api/requests/${created.value.id}/approve`, 'assistant_manager', 'POST')).status, 200);
  assert.equal((await call(`/api/requests/${created.value.id}/approve`, 'manager', 'POST')).status, 409);
  assert.equal((await call('/api/requests', 'manager')).value.length, 0);
  const approved = await call('/api/requests?status=approved', 'manager');
  assert.equal(approved.value.length, 1); assert.equal(approved.value[0].approved_by, 'demo-assistant_manager'); assert.ok(approved.value[0].approved_at);
  assert.equal((await call('/api/requests', 'unknown')).status, 401);
  assert.equal((await fetch(root + '/')).status, 200);
});

test('LINE mode rejects demo headers and validates webhook signatures', async t => {
  const previous = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = 'unit-test-secret';
  t.after(() => { if (previous === undefined) delete process.env.LINE_CHANNEL_SECRET; else process.env.LINE_CHANNEL_SECRET = previous; });
  const server = createApp({ database: ':memory:', demo: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(root + '/api/me', { headers: { 'x-demo-role': 'manager' } })).status, 401);
  const body = '{"events":[]}';
  assert.equal((await fetch(root + '/webhook', { method: 'POST', body })).status, 401);
  const signature = createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(body).digest('base64');
  assert.equal((await fetch(root + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': signature } })).status, 200);
});

test('SQLite retains submitted records after service restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'baac-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'tracker.sqlite');
  async function start() {
    const server = createApp({ database, demo: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, root: `http://127.0.0.1:${server.address().port}` };
  }
  const first = await start();
  try {
    const response = await fetch(first.root + '/api/requests', { method: 'POST', headers: { 'x-demo-role': 'credit_head', 'Content-Type': 'application/json' }, body: JSON.stringify({ firstName: 'ทดสอบ', lastName: 'คงอยู่', cif: '0099' }) });
    assert.equal(response.status, 201); await response.json();
  } finally { await new Promise(resolve => first.server.close(resolve)); }
  const second = await start();
  try {
    const response = await fetch(second.root + '/api/requests', { headers: { 'x-demo-role': 'manager' } });
    const records = await response.json();
    assert.equal(records.length, 1); assert.equal(records[0].cif, '0099');
  } finally { await new Promise(resolve => second.server.close(resolve)); }
});
