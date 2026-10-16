import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { build } from './build.js';

export async function deploy(env = process.env, fetcher = globalThis.fetch, { persist = true, log = console.log } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('ยังไม่มีสิทธิ์ Cloudflare: เพิ่ม CLOUDFLARE_API_TOKEN ใน Environment settings (ห้ามส่งในแชต)');
  if (!env.LINE_LOGIN_CHANNEL_ID) throw new Error('ต้องตั้ง LINE_LOGIN_CHANNEL_ID ก่อน deploy');
  const name = env.WORKER_NAME || 'baac-dcm-tracker-v2';
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(name)) throw new Error('Invalid WORKER_NAME');
  const tag = 'baac-dcm-tracker-v1';
  async function api(path, options = {}, allow404 = false) {
    const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, signal: AbortSignal.timeout(30000) });
    if (allow404 && response.status === 404) return null;
    const data = await response.json();
    if (!response.ok || data.success !== true) throw new Error(`Cloudflare API failed (${response.status}; codes: ${(data.errors || []).map(e => e.code).join(',')})`);
    return data.result;
  }
  let account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) { const accounts = await api('/accounts'); if (accounts.length !== 1) throw new Error('กรุณาตั้ง CLOUDFLARE_ACCOUNT_ID เพื่อเลือกบัญชี'); account = accounts[0].id; }
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('Invalid CLOUDFLARE_ACCOUNT_ID');
  const root = `/accounts/${account}`;
  const existing = await api(`${root}/workers/scripts/${name}/settings`, {}, true);
  if (existing && !existing.tags?.includes(tag)) throw new Error('ชื่อ Worker นี้มีระบบอื่นใช้อยู่แล้ว จึงไม่เขียนทับ: เปลี่ยน WORKER_NAME');
  const dbName = `${name}-db`;
  const statePath = new URL('../dist/provisioning.json', import.meta.url);
  const state = persist && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  const databases = await api(`${root}/d1/database?name=${encodeURIComponent(dbName)}`);
  let database = databases.find(db => db.name === dbName);
  if (database && !existing && !(state.account === account && state.name === name && state.databaseId === (database.uuid || database.id))) throw new Error('พบฐานข้อมูลชื่อเดียวกันที่ไม่ได้ผูกกับ Worker นี้ จึงไม่แก้ไขฐานข้อมูลเดิม');
  if (!database) database = await api(`${root}/d1/database`, { method: 'POST', body: JSON.stringify({ name: dbName }) });
  const databaseId = database.uuid || database.id;
  if (persist) {
    mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ account, name, databaseId }));
  }
  await api(`${root}/d1/database/${databaseId}/query`, { method: 'POST', body: JSON.stringify({ sql: readFileSync(new URL('../migrations/0001.sql', import.meta.url), 'utf8') }) });
  const bindings = [
    { name: 'DB', type: 'd1', id: databaseId },
    { name: 'LIFF_ID', type: 'plain_text', text: env.LIFF_ID || '2012048449-ZBktvJBu' },
    { name: 'LINE_LOGIN_CHANNEL_ID', type: 'plain_text', text: env.LINE_LOGIN_CHANNEL_ID },
    { name: 'ADMIN_LINE_USER_IDS', type: 'plain_text', text: env.ADMIN_LINE_USER_IDS ?? existing?.bindings?.find(b => b.name === 'ADMIN_LINE_USER_IDS')?.text ?? '' },
  ];
  for (const secret of ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN']) if (env[secret]) bindings.push({ name: secret, type: 'secret_text', text: env[secret] });
  build();
  const form = new FormData();
  form.set('metadata', JSON.stringify({ main_module: 'worker.mjs', compatibility_date: '2026-10-01', bindings, keep_bindings: ['secret_text'], tags: [tag] }));
  form.set('worker.mjs', new Blob([readFileSync(new URL('../dist/worker.mjs', import.meta.url))], { type: 'application/javascript+module' }), 'worker.mjs');
  await api(`${root}/workers/scripts/${name}`, { method: 'PUT', body: form });
  await api(`${root}/workers/scripts/${name}/subdomain`, { method: 'POST', body: JSON.stringify({ enabled: true, previews_enabled: false }) });
  const subdomain = await api(`${root}/workers/subdomain`);
  const url = `https://${name}.${subdomain.subdomain}.workers.dev`;
  const health = await fetcher(`${url}/health`, { signal: AbortSignal.timeout(20000) });
  if (!health.ok || !(await health.json()).ok) throw new Error('Deployed Worker did not pass database health check');
  const result = { url, databaseId, workerName: name };
  if (persist) {
    mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../dist/deployment.json', import.meta.url), JSON.stringify(result, null, 2));
  }
  log(`Deploy and database health check passed: ${url}`);
  log('Set this URL as the LIFF Endpoint URL; webhook is /webhook. No real customer data was submitted.');
  return result;
}
if (process.argv[1]?.endsWith('/deploy.js')) deploy().catch(error => { console.error(error.message); process.exitCode = 1; });
