import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploy } from '../tools/deploy.js';

test('deployment requires real credentials before making external requests', async () => {
  let calls = 0;
  await assert.rejects(deploy({}, () => { calls++; }), /CLOUDFLARE_API_TOKEN/);
  await assert.rejects(deploy({ CLOUDFLARE_API_TOKEN: 'test' }, () => { calls++; }), /LINE_LOGIN_CHANNEL_ID/);
  assert.equal(calls, 0);
});

test('deployment provisions one database, uploads unified production Worker, and checks health', async () => {
  const calls = []; let metadata;
  const env = { CLOUDFLARE_API_TOKEN: 'test-only', CLOUDFLARE_ACCOUNT_ID: 'f'.repeat(32), LINE_LOGIN_CHANNEL_ID: 'test-channel', WORKER_NAME: 'test-dcm-worker', LIFF_ID: '123-test', ADMIN_LINE_USER_IDS: 'U-admin' };
  const fetcher = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/health')) return Response.json({ ok: true });
    let result = {};
    if (url.endsWith('/settings')) return new Response('{}', { status: 404 });
    if (url.includes('/d1/database?')) result = [];
    else if (url.endsWith('/d1/database')) result = { uuid: 'test-database' };
    else if (url.endsWith('/query')) assert.match(JSON.parse(options.body).sql, /CREATE TABLE IF NOT EXISTS requests/);
    else if (options.body instanceof FormData) {
      metadata = JSON.parse(options.body.get('metadata'));
      const module = await options.body.get('worker.mjs').text();
      assert.match(module, /บันทึกข้อมูลลูกค้า/); assert.doesNotMatch(module, /node:sqlite/);
    } else if (url.endsWith('/workers/subdomain')) result = { subdomain: 'test-account' };
    return Response.json({ success: true, result });
  };
  const result = await deploy(env, fetcher, { persist: false, log: () => {} });
  assert.equal(result.url, 'https://test-dcm-worker.test-account.workers.dev');
  assert.equal(metadata.bindings.find(b => b.name === 'DB').id, 'test-database');
  assert.ok(!metadata.bindings.some(b => b.name === 'LOCAL_DEMO'));
  assert.deepEqual(metadata.keep_bindings, ['secret_text']);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
});

test('deployment refuses to replace a Worker belonging to another application', async () => {
  const calls = [];
  const env = { CLOUDFLARE_API_TOKEN: 'test-only', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), LINE_LOGIN_CHANNEL_ID: 'test-channel' };
  await assert.rejects(deploy(env, async (url, options) => { calls.push({ url, options }); return Response.json({ success: true, result: { tags: [] } }); }), /ไม่เขียนทับ/);
  assert.equal(calls.length, 1);
});
