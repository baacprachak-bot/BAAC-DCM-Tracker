const $ = s => document.querySelector(s);
const roleNames = { credit_head: 'หัวหน้าฝ่ายสินเชื่อ', assistant_manager: 'ผู้ช่วยผู้จัดการสาขา', manager: 'ผู้จัดการสาขา' };
let config, me, token, busy = false;
let page = new URLSearchParams(location.search).get('page') || 'create';
function message(text = '', error = false) { $('#message').textContent = text; $('#message').className = error ? 'error' : 'success'; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(config.demo ? { 'x-demo-role': $('#role').value } : { Authorization: `Bearer ${token}` }) } });
  const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
}
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
async function render() {
  message(); $('#content').replaceChildren();
  for (const button of document.querySelectorAll('nav button')) {
    button.classList.toggle('active', button.dataset.page === page);
    button.disabled = me.role === 'credit_head' ? button.dataset.page !== 'create' : button.dataset.page === 'create';
  }
  if ((page === 'create') !== (me.role === 'credit_head')) { $('#content').append(element('p', 'คุณไม่มีสิทธิ์ใช้งานเมนูนี้ กรุณาเลือกเมนูตามบทบาท')); return; }
  if (page === 'create') {
    $('#content').innerHTML = '<h1>บันทึกข้อมูลลูกค้า</h1><p class="muted">กรอกข้อมูลให้ครบถ้วนเพื่อส่งให้ผู้อนุมัติ</p><form><label>ชื่อ<input name="firstName" maxlength="100" autocomplete="given-name" required></label><label>นามสกุล<input name="lastName" maxlength="100" autocomplete="family-name" required></label><label>หมายเลขประจำตัวลูกค้า (CIF)<input name="cif" inputmode="numeric" pattern="[0-9]{1,30}" maxlength="30" required><small class="muted">กรอกตัวเลขตามทะเบียนลูกค้า รวมเลขศูนย์นำหน้า</small></label><button class="primary">บันทึกและส่งรออนุมัติ</button></form>';
    $('form').onsubmit = async event => {
      event.preventDefault(); if (busy) return; busy = true; const button = $('form button'); button.disabled = true;
      try { const result = await api('/api/requests', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); event.target.reset(); message(`บันทึกรายการ #${result.id} แล้ว — อยู่ระหว่างรออนุมัติ`); }
      catch (e) { message(e.message, true); } finally { busy = false; button.disabled = false; }
    };
    return;
  }
  $('#content').append(element('h1', page === 'pending' ? 'รายการรออนุมัติ' : 'รายการอนุมัติแล้ว'));
  $('#content').append(element('p', 'แสดงรายการล่าสุดสูงสุด 200 รายการ', 'muted'));
  try {
    const records = await api(`/api/requests?status=${page}`);
    if (!records.length) $('#content').append(element('p', 'ยังไม่มีรายการ', 'muted'));
    for (const record of records) {
      const card = element('article', '', 'record'); card.append(element('h2', `${record.first_name} ${record.last_name}`), element('p', `CIF: ${record.cif} • รายการ #${record.id}`), element('p', `วันที่บันทึก: ${new Date(record.created_at).toLocaleString('th-TH')}`));
      if (record.approved_at) card.append(element('p', `วันที่อนุมัติ: ${new Date(record.approved_at).toLocaleString('th-TH')}`));
      if (page === 'pending') {
        const button = element('button', 'อนุมัติรายการ', 'primary');
        button.onclick = async () => {
          if (!confirm(`ยืนยันอนุมัติรายการ #${record.id} ของ ${record.first_name} ${record.last_name}?`)) return;
          button.disabled = true;
          try { await api(`/api/requests/${record.id}/approve`, { method: 'POST' }); await render(); message(`อนุมัติรายการ #${record.id} แล้ว`); }
          catch (e) { message(e.message, true); button.disabled = false; }
        }; card.append(button);
      }
      $('#content').append(card);
    }
  } catch (e) { message(e.message, true); }
}
async function identify() { me = await api('/api/me'); $('#identity').textContent = `บทบาท: ${roleNames[me.role]}`; }
document.querySelectorAll('nav button').forEach(button => button.onclick = () => { page = button.dataset.page; render(); });
try {
  config = await (await fetch('/api/config')).json();
  if (config.demo) {
    $('#demo').hidden = false;
    $('#role').onchange = async () => { await identify(); page = me.role === 'credit_head' ? 'create' : 'pending'; await render(); };
  } else {
    if (!config.liffId) throw new Error('ยังไม่ได้ตั้งค่า LIFF ID กรุณาติดต่อผู้ดูแลระบบ');
    if (!window.liff) throw new Error('โหลด LINE SDK ไม่สำเร็จ กรุณาลองใหม่');
    await liff.init({ liffId: config.liffId });
    if (!liff.isLoggedIn()) { liff.login(); } else { token = liff.getIDToken(); }
    if (!token) throw new Error('กรุณาเข้าสู่ระบบ LINE โดยเปิดสิทธิ์ openid ใน LIFF');
  }
  await identify();
  if (!new URLSearchParams(location.search).has('page')) page = me.role === 'credit_head' ? 'create' : 'pending';
  await render();
} catch (e) { message(e.message, true); document.querySelectorAll('nav button').forEach(button => button.disabled = true); }
