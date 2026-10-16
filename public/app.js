const $ = selector => document.querySelector(selector);
const names = { credit_head: 'หัวหน้าฝ่ายสินเชื่อ', assistant_manager: 'ผู้ช่วยผู้จัดการสาขา', manager: 'ผู้จัดการสาขา', admin: 'ผู้ดูแลระบบ' };
let config, me, token, page = new URLSearchParams(location.search).get('page') || 'create', listPage = 1, search = '', rendering = 0;
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
const date = value => new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });
function notify(value = '', error = false) { $('#message').textContent = value; $('#message').hidden = !value; $('#message').className = error ? 'error' : ''; }
async function api(path, options = {}) {
 const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(config.demo ? { 'x-demo-role': $('#role').value } : { Authorization: `Bearer ${token}` }) } });
 const result = await response.json(); if (!response.ok) throw new Error(result.error || 'ระบบขัดข้อง'); return result;
}
function title(heading, subtitle, badge) { const row = text('div', '', 'section-title'); const left = text('div', ''); left.append(text('h2', heading), text('p', subtitle, 'muted')); row.append(left); if (badge) row.append(badge); $('#content').append(row); }
async function identify() { me = await api('/api/me'); $('#identity').textContent = `● ${names[me.role] || (me.status === 'suspended' ? 'บัญชีถูกระงับ' : 'รอรับสิทธิ์ใช้งาน')}`; }
function permitted() { return me.status === 'active' && me.role; }
function accessScreen() {
 const panel = text('div', '', 'access');
 panel.append(text('h2', me.status === 'suspended' ? 'บัญชีนี้ถูกระงับการใช้งาน' : 'เข้าสู่ระบบ LINE สำเร็จแล้ว'), text('p', 'กรุณาแจ้งผู้ดูแลให้กำหนดสิทธิ์ตามตำแหน่งของคุณก่อนเริ่มใช้งาน ข้อมูลลูกค้าจะแสดงเฉพาะผู้ที่ได้รับสิทธิ์เท่านั้น'), text('code', me.id));
 const copy = text('button', 'คัดลอกรหัสบัญชีของฉัน', 'secondary'); copy.onclick = async () => { try { await navigator.clipboard.writeText(me.id); notify('คัดลอกรหัสบัญชีแล้ว'); } catch { notify('กรุณาคัดลอกรหัสบัญชีที่แสดงด้านบน', true); } };
 const refresh = text('button', 'ตรวจสอบสิทธิ์อีกครั้ง', 'primary'); refresh.onclick = async () => { try { await identify(); if (permitted()) page = me.role === 'credit_head' ? 'create' : me.role === 'admin' ? 'staff' : 'pending'; await render(); } catch (e) { notify(e.message, true); } };
 panel.append(copy, text('p', 'รหัสนี้ใช้ระบุบัญชีของคุณ ไม่ใช่รหัสผ่าน'), refresh); $('#content').append(panel);
}
async function render() {
 const version = ++rendering; notify(); $('#content').replaceChildren(); $('#content').setAttribute('aria-busy', 'true');
 document.querySelectorAll('nav button').forEach(button => { const target = button.dataset.page; button.classList.toggle('active', target === page); button.disabled = !permitted() || (me.role === 'credit_head' ? target !== 'create' : me.role === 'admin' || target === 'create'); });
 try {
  if (!permitted()) { accessScreen(); return; }
  if (me.role === 'admin') { await staffScreen(version); return; }
  if (me.role === 'credit_head' && page !== 'create' || me.role !== 'credit_head' && page === 'create') { title('เมนูสำหรับตำแหน่งอื่น', 'กรุณาเลือกเมนูที่ตรงกับสิทธิ์ของคุณ'); return; }
  if (page === 'create') { createScreen(); return; }
  if (!['pending', 'approved'].includes(page)) { title('ไม่พบเมนู', 'กรุณาเลือกเมนูด้านบน'); return; }
  await listScreen(version);
 } catch (e) { notify(e.message, true); } finally { if (version === rendering) $('#content').setAttribute('aria-busy', 'false'); }
}
function createScreen() {
 title('บันทึกข้อมูลลูกค้า', 'กรอกข้อมูลเพื่อส่งให้ผู้อนุมัติตรวจสอบ', text('span', 'ขั้นตอนที่ 1 / 2', 'step'));
 const form = document.createElement('form');
 form.innerHTML = '<div class="fields"><label>ชื่อ <span class="required">*</span><input name="firstName" maxlength="100" autocomplete="given-name" placeholder="กรอกชื่อลูกค้า" required></label><label>นามสกุล <span class="required">*</span><input name="lastName" maxlength="100" autocomplete="family-name" placeholder="กรอกนามสกุลลูกค้า" required></label></div><label>หมายเลขประจำตัวลูกค้า (CIF) <span class="required">*</span><input name="cif" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" placeholder="เช่น 00123456" required><small>ตัวเลข 4–8 หลัก · กรอกเลขศูนย์นำหน้าให้ครบตามทะเบียน</small></label><div class="hint"><span>ⓘ</span><span><strong>ตรวจสอบข้อมูลก่อนส่ง</strong><br>เมื่อบันทึกแล้ว รายการจะถูกส่งให้ผู้ช่วยผู้จัดการสาขาหรือผู้จัดการสาขาอนุมัติ</span></div><div class="form-bottom"><p>ข้อมูลนี้มองเห็นได้เฉพาะเจ้าหน้าที่ที่มีสิทธิ์</p><button class="primary" type="submit">บันทึกและส่งรออนุมัติ →</button></div>';
 form.onsubmit = async event => { event.preventDefault(); const button = form.querySelector('button'); if (button.disabled) return; button.disabled = true; button.textContent = 'กำลังบันทึก…'; try { await api('/api/requests', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); notify('บันทึกสำเร็จ · ส่งรายการให้ผู้อนุมัติแล้ว'); } catch (e) { notify(e.message, true); } finally { button.disabled = false; button.textContent = 'บันทึกและส่งรออนุมัติ →'; } }; $('#content').append(form);
}
async function confirmApproval(record) {
 $('#approval-name').textContent = `${record.first_name} ${record.last_name}\nCIF ${record.cif}`; const dialog = $('#approval-dialog');
 return new Promise(resolve => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'approve'), { once: true }); dialog.returnValue = 'cancel'; dialog.showModal(); });
}
async function listScreen(version) {
 const approved = page === 'approved'; const currentPage = page;
 const data = await api(`/api/requests?status=${page}&page=${listPage}&search=${encodeURIComponent(search)}`); if (version !== rendering) return;
 title(approved ? 'รายการอนุมัติแล้ว' : 'รายการรออนุมัติ', approved ? 'ตรวจสอบประวัติ ผู้อนุมัติ และวันที่ดำเนินการ' : 'ตรวจสอบข้อมูลลูกค้าก่อนยืนยันอนุมัติ', text('span', `${data.total} รายการ`, `count${approved ? ' approved' : ''}`));
 const form = text('form', '', 'search-form'); const input = document.createElement('input'); input.placeholder = 'ค้นหาชื่อ นามสกุล หรือ CIF'; input.setAttribute('aria-label', 'ค้นหารายการ'); input.value = search; const submit = text('button', 'ค้นหา', 'secondary'); form.append(input, submit); form.onsubmit = e => { e.preventDefault(); search = input.value.trim(); listPage = 1; render(); }; $('#content').append(form);
 if (!data.records.length) { const empty = text('div', '', 'empty'); empty.append(text('span', approved ? '✓' : '◷'), text('p', search ? 'ไม่พบรายการที่ค้นหา' : approved ? 'ยังไม่มีรายการอนุมัติแล้ว' : 'ไม่มีรายการค้างรออนุมัติ')); $('#content').append(empty); }
 for (const record of data.records) {
  const card = text('article', '', 'record'); const details = text('div', ''); details.append(text('h3', `${record.first_name} ${record.last_name}`), text('p', `CIF ${record.cif}`, 'cif'), text('p', `บันทึกโดย ${record.created_by_name} · ${date(record.created_at)}`)); if (approved) details.append(text('p', `อนุมัติโดย ${record.approved_by_name} · ${date(record.approved_at)}`));
  const actions = text('div', '', 'record-actions'); actions.append(text('span', approved ? '✓ อนุมัติแล้ว' : '◷ รออนุมัติ', `status${approved ? ' done' : ''}`));
  if (!approved) { const button = text('button', 'อนุมัติรายการ', 'primary'); button.onclick = async () => { if (!await confirmApproval(record)) return; button.disabled = true; try { await api(`/api/requests/${record.id}/approve`, { method: 'POST' }); await render(); notify('อนุมัติสำเร็จ · ดูย้อนหลังได้ที่เมนูอนุมัติแล้ว'); } catch (e) { notify(e.message, true); button.disabled = false; } }; actions.append(button); } card.append(details, actions); $('#content').append(card);
 }
 const pager = text('div', '', 'pager'); pager.append(text('span', `หน้า ${data.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))}`)); const buttons = text('div', '');
 for (const [label, change, disabled] of [['ก่อนหน้า', -1, listPage <= 1], ['ถัดไป', 1, listPage * data.pageSize >= data.total]]) { const button = text('button', label); button.disabled = disabled; button.onclick = () => { if (page !== currentPage) return; listPage += change; render(); }; buttons.append(button); } pager.append(buttons); $('#content').append(pager);
}
async function staffScreen(version) {
 const staff = await api('/api/staff'); if (version !== rendering) return; title('กำหนดสิทธิ์เจ้าหน้าที่', 'เจ้าหน้าที่ต้องเปิดแอปและเข้าสู่ LINE ก่อน จึงจะปรากฏในรายการนี้');
 for (const member of staff) {
  const card = text('article', '', 'staff'); card.append(text('h3', member.display_name), text('p', ({ pending: 'รอรับสิทธิ์', active: 'ใช้งานได้', suspended: 'ระงับการใช้งาน' })[member.status], 'muted'), text('code', member.line_user_id));
  if (member.line_user_id !== me.id) {
   const controls = text('div', '', 'controls'); const role = document.createElement('select'); role.setAttribute('aria-label', `ตำแหน่งของ ${member.display_name}`);
   for (const key of ['credit_head', 'assistant_manager', 'manager']) { const option = text('option', names[key]); option.value = key; role.append(option); } role.value = member.role || 'credit_head';
   const status = document.createElement('select'); status.setAttribute('aria-label', `สถานะของ ${member.display_name}`); for (const [key, label] of [['active', 'อนุญาตให้ใช้งาน'], ['suspended', 'ระงับการใช้งาน']]) { const option = text('option', label); option.value = key; status.append(option); } status.value = member.status === 'suspended' ? 'suspended' : 'active';
   const button = text('button', 'บันทึกสิทธิ์', 'primary'); button.onclick = async () => { button.disabled = true; try { await api('/api/staff', { method: 'POST', body: JSON.stringify({ id: member.line_user_id, role: role.value, status: status.value }) }); await render(); notify('บันทึกสิทธิ์เจ้าหน้าที่แล้ว'); } catch (e) { notify(e.message, true); button.disabled = false; } }; controls.append(role, status, button); card.append(controls);
  } $('#content').append(card);
 }
}
async function boot() {
 config = await (await fetch('/api/config')).json();
 if (config.demo) { $('#demo').hidden = false; $('#role').onchange = async () => { try { await identify(); page = me.role === 'credit_head' ? 'create' : me.role === 'admin' ? 'staff' : 'pending'; listPage = 1; search = ''; await render(); } catch (e) { notify(e.message, true); } }; }
 else {
  if (!config.liffId) throw new Error('ยังไม่ได้ตั้งค่า LIFF กรุณาติดต่อผู้ดูแล');
  await new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js'; script.onload = resolve; script.onerror = () => reject(new Error('โหลด LINE ไม่สำเร็จ กรุณาลองใหม่')); document.head.append(script); });
  await liff.init({ liffId: config.liffId }); if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; } token = liff.getIDToken(); if (!token) throw new Error('กรุณาเปิดสิทธิ์ openid ของ LIFF'); const redirected = new URLSearchParams(location.search).get('page'); if (redirected) page = redirected;
 }
 await identify(); if (!['create', 'pending', 'approved'].includes(page) || !new URLSearchParams(location.search).has('page')) page = me.role === 'credit_head' ? 'create' : me.role === 'admin' ? 'staff' : 'pending'; await render();
}
document.querySelectorAll('nav button').forEach(button => button.onclick = () => { page = button.dataset.page; listPage = 1; search = ''; render(); });
boot().catch(e => { $('#content').replaceChildren(text('p', 'ยังไม่สามารถเปิดระบบได้ กรุณาลองใหม่หรือติดต่อผู้ดูแล', 'muted')); $('#content').setAttribute('aria-busy', 'false'); notify(e.message, true); document.querySelectorAll('nav button').forEach(button => button.disabled = true); });
