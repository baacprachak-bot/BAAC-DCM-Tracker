import { readFileSync } from 'node:fs';
import { openDB } from './db.js';
export function seedSQL() {
  const now = '2026-10-16T09:00:00.000Z';
  const roles = { credit_head: 'หัวหน้าสินเชื่อ (ทดสอบ)', assistant_manager: 'ผู้ช่วยผู้จัดการ (ทดสอบ)', manager: 'ผู้จัดการ (ทดสอบ)', pending: 'เจ้าหน้าที่ใหม่ (ทดสอบ)', admin: 'ผู้ดูแล (ทดสอบ)' };
  const sql = ["CREATE TABLE IF NOT EXISTS sandbox_meta (name TEXT PRIMARY KEY,value TEXT NOT NULL);", "INSERT OR IGNORE INTO sandbox_meta VALUES('purpose','synthetic-data-only');"];
  for (const [role, name] of Object.entries(roles)) sql.push(`INSERT OR IGNORE INTO staff(line_user_id,display_name,role,status,created_at,updated_at) VALUES('demo-${role}','${name}',${['admin','pending'].includes(role) ? 'NULL' : `'${role}'`},'${role === 'pending' ? 'pending' : 'active'}','${now}','${now}');`);
  for (let i = 1; i <= 15; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    sql.push(`INSERT OR IGNORE INTO requests(id,first_name,last_name,cif,created_by,created_at) VALUES('${id}','ลูกค้าทดสอบ${String(i).padStart(2,'0')}','นามสกุลสมมติ','${String(1000 + i).padStart(8,'0')}','demo-credit_head','${now}');`);
    if (i > 10) sql.push(`UPDATE requests SET status='approved',approved_by='demo-${i % 2 ? 'manager' : 'assistant_manager'}',approved_at='2026-10-16T10:00:00.000Z' WHERE id='${id}' AND status='pending';`);
  }
  return sql.join('\n');
}
async function remote() {
  const state = JSON.parse(readFileSync(new URL('../dist/provisioning.json', import.meta.url), 'utf8'));
  if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required');
  const base = `https://api.cloudflare.com/client/v4/accounts/${state.account}`;
  async function api(path, options = {}) {
    const response = await fetch(base + path, { ...options, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
    const data = await response.json(); if (!response.ok || !data.success) throw new Error(`Cloudflare sandbox request failed (${response.status})`); return data.result;
  }
  const settings = await api(`/workers/scripts/${state.name}/settings`);
  if (!settings.tags?.includes('baac-dcm-tracker-v1')) throw new Error('Worker ownership mismatch');
  const real = settings.bindings.find(b => b.name === 'DB')?.id;
  const sandbox = settings.bindings.find(b => b.name === 'SANDBOX_DB')?.id;
  if (!real || !sandbox || real === sandbox || sandbox !== state.sandboxDatabaseId) throw new Error('Separate sandbox binding could not be verified');
  const query = sql => api(`/d1/database/${sandbox}/query`, { method: 'POST', body: JSON.stringify({ sql }) });
  await query(seedSQL());
  const count = await query('SELECT status,COUNT(*) AS count FROM requests GROUP BY status');
  console.log('Seeded separate sandbox database:', JSON.stringify(count[0].results));
}
if (process.argv[1]?.endsWith('/seed-sandbox.js')) {
  if (process.argv.includes('--remote')) remote().catch(e => { console.error(e.message); process.exitCode = 1; });
  else { const db = openDB(process.env.SANDBOX_DATABASE_PATH || 'data/sandbox.sqlite'); try { db.raw.exec(seedSQL()); console.log('Seeded local sandbox with 15 synthetic customers.'); } finally { db.close(); } }
}
