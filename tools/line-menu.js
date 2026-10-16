import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const liffId = process.env.LIFF_ID || '2012048449-ZBktvJBu';
if (!/^[0-9]+-[A-Za-z0-9]+$/.test(liffId)) throw new Error('Invalid LIFF_ID');
const menu = { size: { width: 2500, height: 843 }, selected: true, name: 'DCM Tracker', chatBarText: 'เมนูจัดการลูกค้า', areas: ['create','pending','approved'].map((page, i) => ({ bounds: { x: i * 833, y: 0, width: i === 2 ? 834 : 833, height: 843 }, action: { type: 'uri', label: ['บันทึกลูกค้า','รออนุมัติ','อนุมัติแล้ว'][i], uri: `https://liff.line.me/${liffId}?page=${page}` } })) };
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/rich-menu.json', import.meta.url), JSON.stringify(menu, null, 2));
if (!process.argv.includes('--publish')) {
  console.log('Prepared dist/rich-menu.json. Publishing requires --publish and LINE_CHANNEL_ACCESS_TOKEN.');
} else {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Environment settings ก่อน');
  const image = readFileSync(new URL('../docs/rich-menu.png', import.meta.url));
  async function line(url, options) {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`LINE menu API failed (${response.status})`);
    return response;
  }
  const response = await line('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(menu) });
  const { richMenuId } = await response.json();
  writeFileSync(new URL('../dist/created-rich-menu.json', import.meta.url), JSON.stringify({ richMenuId }));
  await line(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: image });
  await line(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
  console.log('Published Rich Menu successfully:', richMenuId);
}
