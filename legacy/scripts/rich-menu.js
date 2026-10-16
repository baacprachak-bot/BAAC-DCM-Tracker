// Creates a menu but never publishes/binds it automatically.
const { APP_URL, LINE_CHANNEL_ACCESS_TOKEN } = process.env;
if (!APP_URL?.startsWith('https://') || !LINE_CHANNEL_ACCESS_TOKEN) throw new Error('Set APP_URL (HTTPS) and LINE_CHANNEL_ACCESS_TOKEN first');
const root = APP_URL.replace(/\/$/, '');
const menu = { size: { width: 2500, height: 843 }, selected: true, name: 'BAAC DCM Tracker', chatBarText: 'เมนูจัดการลูกค้า', areas: ['create', 'pending', 'approved'].map((page, i) => ({ bounds: { x: [0, 833, 1666][i], y: 0, width: i === 2 ? 834 : 833, height: 843 }, action: { type: 'uri', uri: `${root}/?page=${page}` } })) };
const response = await fetch('https://api.line.me/v2/bot/richmenu', { method: 'POST', headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(menu) });
if (!response.ok) throw new Error(`LINE menu creation failed (${response.status})`);
console.log(JSON.stringify(await response.json()));
console.log('Menu created only. Upload the menu image, then bind it separately after review.');
