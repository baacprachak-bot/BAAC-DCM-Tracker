import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../integrations/line-webhook.js';
import { readFileSync } from 'node:fs';

test('uploaded Worker integration: signed messages, customer lists, permissions and private chats', async t => {
  const env = { LINE_CHANNEL_SECRET: 'test-only', LINE_CHANNEL_ACCESS_TOKEN: 'test-only', GOOGLE_SCRIPT_URL: 'https://example.invalid/exec', DCM_API_KEY: 'test-only' };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = [], backend;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    return Response.json(String(url).startsWith('https://api.line.me/') ? {} : backend);
  };
  async function invoke(text, { source = { type: 'user', userId: 'test-user' }, validSignature = true } = {}) {
    calls = [];
    const body = JSON.stringify({ events: [{ type: 'message', message: { type: 'text', text }, source, replyToken: 'test-reply' }] });
    const signature = validSignature ? createHmac('sha256', env.LINE_CHANNEL_SECRET).update(body).digest('base64') : 'invalid';
    const jobs = [];
    const response = await worker.fetch(new Request('https://example.invalid/webhook', { method: 'POST', body, headers: { 'x-line-signature': signature } }), env, { waitUntil: job => jobs.push(job) });
    await Promise.all(jobs);
    return response;
  }
  backend = { success: true, count: 1, customers: [{ customerName: 'ทดสอบ ระบบ', cif: '001234' }] };
  assert.equal((await invoke('รายการรออนุมัติ')).status, 200);
  assert.equal(calls[0].body.action, 'listPendingCustomers');
  assert.equal(calls[0].body.lineUserId, 'test-user');
  assert.match(calls[1].body.messages[0].text, /001234/);
  await invoke('รายการอนุมัติแล้ว');
  assert.equal(calls[0].body.action, 'listApprovedCustomers');
  assert.match(calls[1].body.messages[0].text, /อนุมัติแล้ว/);
  assert.doesNotMatch(calls[1].body.messages[0].text, /พิมพ์ อนุมัติ/);
  backend = { success: false, error: 'PERMISSION_DENIED' };
  await invoke('รายการอนุมัติแล้ว');
  assert.match(calls[1].body.messages[0].text, /ไม่มีสิทธิ์/);
  backend = { success: true, count: 0, customers: [] };
  await invoke('รายการอนุมัติแล้ว');
  assert.equal(calls[1].body.messages[0].text, 'ไม่มีรายการลูกค้าอนุมัติแล้ว');
  backend = { success: true }; // A success flag alone must not claim an empty list.
  await invoke('รายการอนุมัติแล้ว');
  assert.match(calls[1].body.messages[0].text, /ข้อมูลรายการจากระบบไม่ถูกต้อง/);
  await invoke('รายการรออนุมัติ', { source: { type: 'group', userId: 'test-user' } });
  assert.equal(calls.length, 0);
  assert.equal((await invoke('รายการอนุมัติแล้ว', { validSignature: false })).status, 401);
  assert.equal(calls.length, 0);
  backend = { success: true, customerName: 'ทดสอบ ระบบ', cif: '001234' };
  await invoke('อนุมัติ 001234');
  assert.equal(calls[0].body.action, 'approveCustomer');
  assert.equal(calls[0].body.cif, '001234');
  assert.match(calls[1].body.messages[0].text, /อนุมัติรายการสำเร็จ/);
});

test('Rich Menu opens existing LIFF and emits the supported listing commands', () => {
  const menu = JSON.parse(readFileSync(new URL('../integrations/rich-menu.json', import.meta.url)));
  assert.equal(menu.areas.length, 3);
  assert.equal(menu.areas[0].action.uri, 'https://liff.line.me/2012048449-ZBktvJBu');
  assert.equal(menu.areas[1].action.text, 'รายการรออนุมัติ');
  assert.equal(menu.areas[2].action.text, 'รายการอนุมัติแล้ว');
  assert.equal(menu.areas.reduce((sum, area) => sum + area.bounds.width, 0), menu.size.width);
});
