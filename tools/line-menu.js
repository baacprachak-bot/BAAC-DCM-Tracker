import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function menuDefinition(liffId) {
 if (!/^[0-9]+-[A-Za-z0-9]+$/.test(liffId)) throw new Error('Invalid LIFF_ID');
 return { size: { width: 2500, height: 843 }, selected: true, name: 'DCM Tracker', chatBarText: 'เมนูจัดการลูกค้า', areas: ['create','pending','approved'].map((page, i) => ({ bounds: { x: i * 833, y: 0, width: i === 2 ? 834 : 833, height: 843 }, action: { type: 'uri', label: ['บันทึกลูกค้า','รออนุมัติ','อนุมัติแล้ว'][i], uri: `https://liff.line.me/${liffId}?page=${page}` } })) };
}
export async function publishMenu({ env = process.env, fetcher = globalThis.fetch, persist = true, log = console.log, image = readFileSync(new URL('../docs/rich-menu.png', import.meta.url)) } = {}) {
 const token = env.LINE_CHANNEL_ACCESS_TOKEN;
 if (!token) throw new Error('ยังไม่พบ LINE_CHANNEL_ACCESS_TOKEN ที่บันทึกและส่งเข้ามาในเครื่อง');
 const menu = menuDefinition(env.LIFF_ID || '2012048449-ZBktvJBu');
 if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== 2500 || image.readUInt32BE(20) !== 843 || image.length > 1000000) throw new Error('Invalid Rich Menu PNG dimensions or size');
 async function line(path, options = {}, allow404 = false, data = false) {
  const response = await fetcher(`https://${data ? 'api-data' : 'api'}.line.me${path}`, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`LINE menu API failed (${response.status})`);
  return response;
 }
 const bot = await (await line('/v2/bot/info')).json();
 if (!bot.userId || !bot.displayName) throw new Error('LINE account verification failed');
 log(`Verified OA: ${bot.displayName}`);
 const oldResponse = await line('/v2/bot/user/all/richmenu', {}, true);
 const oldDefault = oldResponse ? await oldResponse.json() : null;
 const oldDefinition = oldDefault?.richMenuId ? await (await line(`/v2/bot/richmenu/${oldDefault.richMenuId}`)).json() : null;
 const backup = { checkedAt: new Date().toISOString(), botId: bot.userId, botName: bot.displayName, oldDefaultId: oldDefault?.richMenuId || null, oldDefinition };
 if (persist) {
  mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
  writeFileSync(new URL(`../dist/line-menu-backup-${Date.now()}.json`, import.meta.url), JSON.stringify(backup, null, 2));
 }
 // Keep the old menu and image on LINE; change the default only after upload succeeds.
 const created = await (await line('/v2/bot/richmenu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menu) })).json();
 if (!created.richMenuId) throw new Error('LINE did not return a Rich Menu ID');
 const result = { ...backup, richMenuId: created.richMenuId };
 if (persist) writeFileSync(new URL('../dist/created-rich-menu.json', import.meta.url), JSON.stringify(result, null, 2));
 await line(`/v2/bot/richmenu/${created.richMenuId}/content`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: image }, false, true);
 await line(`/v2/bot/user/all/richmenu/${created.richMenuId}`, { method: 'POST' });
 const current = await (await line('/v2/bot/user/all/richmenu')).json();
 if (current.richMenuId !== created.richMenuId) throw new Error('Default menu verification failed; inspect the saved backup before retrying');
 log('Published and verified OA default Rich Menu successfully. Previous menu retained.');
 return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const menu = menuDefinition(process.env.LIFF_ID || '2012048449-ZBktvJBu');
  mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../dist/rich-menu.json', import.meta.url), JSON.stringify(menu, null, 2));
  if (process.argv.includes('--publish')) await publishMenu();
  else console.log('Prepared dist/rich-menu.json. Publishing requires --publish and LINE_CHANNEL_ACCESS_TOKEN.');
 } catch (e) { console.error(e.message); process.exitCode = 1; }
}
