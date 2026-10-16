import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuDefinition, publishMenu } from '../tools/line-menu.js';

test('Rich Menu has three exact LIFF targets and covers the whole image', () => {
 const menu = menuDefinition('2012048449-ZBktvJBu');
 assert.equal(menu.areas.length, 3);
 assert.deepEqual(menu.areas.map(area => area.action.uri), ['create','pending','approved'].map(page => `https://liff.line.me/2012048449-ZBktvJBu?page=${page}`));
 assert.equal(menu.areas.reduce((n, area) => n + area.bounds.width, 0), 2500);
});

test('missing or invalid LINE credential prevents all menu mutations', async () => {
 let calls = 0;
 await assert.rejects(publishMenu({ env: {}, persist: false, fetcher: async () => { calls++; } }), /LINE_CHANNEL_ACCESS_TOKEN/);
 assert.equal(calls, 0);
 await assert.rejects(publishMenu({ env: { LINE_CHANNEL_ACCESS_TOKEN: 'test-only' }, persist: false, fetcher: async (url, options) => { calls++; assert.equal(options.method, undefined); return new Response('{}', { status: 401 }); } }), /401/);
 assert.equal(calls, 1);
});

test('OA publication preserves old default metadata and uploads image before switching', async () => {
 const calls = []; let switched = false;
 const result = await publishMenu({ env: { LINE_CHANNEL_ACCESS_TOKEN: 'test-only' }, persist: false, log: () => {}, fetcher: async (url, options) => {
  calls.push({ url, method: options.method || 'GET' });
  if (url.endsWith('/info')) return Response.json({ userId: 'test-bot', displayName: 'Test OA' });
  if (url.endsWith('/user/all/richmenu')) return Response.json({ richMenuId: switched ? 'new-menu' : 'old-menu' });
  if (url.endsWith('/richmenu/old-menu')) return Response.json({ richMenuId: 'old-menu', name: 'Previous' });
  if (url.endsWith('/richmenu') && options.method === 'POST') return Response.json({ richMenuId: 'new-menu' });
  if (url.endsWith('/content')) { assert.ok(url.startsWith('https://api-data.line.me/')); return Response.json({}); }
  if (url.endsWith('/user/all/richmenu/new-menu')) { switched = true; return Response.json({}); }
  throw new Error('Unexpected request');
 } });
 assert.equal(result.oldDefaultId, 'old-menu'); assert.equal(result.oldDefinition.name, 'Previous');
 assert.equal(result.richMenuId, 'new-menu');
 assert.ok(calls.findIndex(c => c.url.endsWith('/content')) < calls.findIndex(c => c.url.endsWith('/user/all/richmenu/new-menu')));
 assert.ok(!calls.some(c => c.method === 'DELETE'));
});

test('image upload failure keeps the previous default menu selected', async () => {
 let switchRequested = false;
 await assert.rejects(publishMenu({ env: { LINE_CHANNEL_ACCESS_TOKEN: 'test-only' }, persist: false, log: () => {}, fetcher: async (url, options) => {
  if (url.endsWith('/info')) return Response.json({ userId: 'test-bot', displayName: 'Test OA' });
  if (url.endsWith('/user/all/richmenu')) return Response.json({ richMenuId: 'old-menu' });
  if (url.endsWith('/richmenu/old-menu')) return Response.json({ richMenuId: 'old-menu', name: 'Previous' });
  if (url.endsWith('/richmenu') && options.method === 'POST') return Response.json({ richMenuId: 'new-menu' });
  if (url.endsWith('/content')) return new Response('{}', { status: 500 });
  if (url.endsWith('/user/all/richmenu/new-menu')) switchRequested = true;
  throw new Error('Unexpected request');
 } }), /500/);
 assert.equal(switchRequested, false);
});
