# เปิดใช้ระบบใหม่โดยไม่ต้องเขียนโค้ด

ใช้เพียง **Cloudflare**, **LINE Developers / LINE OA Manager** และ **GitHub** สำหรับเก็บโค้ดและอัปเดตอัตโนมัติ ไม่ต้องสร้าง Google Apps Script เพิ่ม

## URL ที่นำขึ้น Cloudflare แล้ว

`https://baac-dcm-tracker-v2.baac-prachak.workers.dev`

สร้าง Worker และ D1 สำเร็จแล้ว ตรวจ health ฐานข้อมูลและหน้าเว็บผ่าน ระบบปิดโหมดทดลองบนเว็บจริง ขั้นต่อไปให้ตั้ง URL นี้เป็น LIFF Endpoint URL แล้วเข้าสู่ LINE เพื่อรับรหัสบัญชีสำหรับตั้งผู้ดูแลคนแรก การเข้าใช้จริงด้วย LINE และการผูก Rich Menu ยังต้องตรวจต่อหลังเปลี่ยน Endpoint

## 1. ให้สิทธิ์ deploy กับ Cloudflare

ใน Cloudflare เปิด My Profile → API Tokens → Create Token เลือกบัญชีที่จะใช้ แล้วกำหนด:

- Account → Workers Scripts → Edit
- Account → D1 → Edit
- หากไม่ระบุ Account ID ต้องมี Account → Account Settings → Read สำหรับค้นบัญชี

คัดลอก **Account ID** จากหน้าบัญชี ตั้ง `CLOUDFLARE_ACCOUNT_ID` และใส่ token ในช่อง secret `CLOUDFLARE_API_TOKEN` ของสภาพแวดล้อมที่ให้ผู้ช่วยรันงาน ห้ามส่ง token ในแชต หากกำหนด IP/เครือข่ายให้ token ต้องอนุญาตเครื่องที่ deploy ด้วย

โหมด proxy-backed secrets ของ Codex ต้องอนุญาต HTTPS destination `api.cloudflare.com` หากต้องส่ง LINE credentials เข้า Cloudflare ด้วย ให้ credentials เหล่านั้นใช้ destination นี้ด้วย การประกาศชื่อ secret อย่างเดียวไม่ได้สร้างค่าให้บัญชี

## 2. LINE Login และ LIFF

- ใช้ LIFF ID `2012048449-ZBktvJBu` ที่ส่งมาได้
- ใน LINE Login channel → Basic settings ตรวจ Channel ID แล้วตั้ง `LINE_LOGIN_CHANNEL_ID` (จาก LIFF ที่ให้มา prefix คือ `2012048449` ให้ยืนยันจาก console)
- ตั้ง LIFF scopes `openid` และ `profile`
- หลัง deploy ผ่าน ให้นำ URL ที่สคริปต์แสดงไปใส่ LIFF Endpoint URL (URL ใหม่นี้ต่างจากเว็บเดิม)
- LINE Login และ Messaging API channel ของ OA ต้องอยู่ Provider เดียวกันเพื่อให้รหัสผู้ใช้ตรงกัน เปิด channel ให้เจ้าหน้าที่ใช้งานตามสถานะ Published/Tester ของ LINE

**ยังไม่ต้องกำหนดตำแหน่งทุกคนด้วยโค้ด:** เจ้าหน้าที่เปิด LIFF แล้วบัญชีจะรอรับสิทธิ์ ผู้ดูแลเป็นผู้เลือกตำแหน่งผ่านหน้าจอ

## 3. ผู้ดูแลคนแรก

หลังเปิด LIFF ให้ผู้ที่จะดูแลระบบเข้าสู่ LINE หน้ารอรับสิทธิ์จะแสดงรหัสบัญชีของตน นำรหัสนั้นตั้งเป็น `ADMIN_LINE_USER_IDS` ใน Worker Settings → Variables and Secrets แล้ว deploy ค่า หรือกำหนดในสภาพแวดล้อมและรัน deploy ซ้ำ

ถ้ามีหลายคนคั่นด้วย comma ผู้ดูแลที่กำหนดด้วยค่านี้จะถูกสงวนไว้ไม่ให้คนอื่นแก้สิทธิ์ผ่าน UI ผู้ดูแลไม่ได้สิทธิ์อนุมัติข้อมูลลูกค้าโดยอัตโนมัติ สามตำแหน่งงานให้ใช้บัญชีเจ้าหน้าที่ที่ได้รับสิทธิ์ตามจริง

## 4. Rich Menu และ webhook

สามารถสร้าง 3 ช่องผ่าน LINE OA Manager แล้วตั้งลิงก์:

| ช่อง | ลิงก์ |
|---|---|
| บันทึกลูกค้า | `https://liff.line.me/2012048449-ZBktvJBu?page=create` |
| รออนุมัติ | `https://liff.line.me/2012048449-ZBktvJBu?page=pending` |
| อนุมัติแล้ว | `https://liff.line.me/2012048449-ZBktvJBu?page=approved` |

มีภาพพร้อมใช้อัปโหลดที่ `docs/rich-menu.png` และโครง API ที่สร้างจาก `npm run line:menu` หรือให้สคริปต์ตั้งเมนูทั้งหมดด้วย `npm run line:menu -- --publish` เมื่อใส่ `LINE_CHANNEL_ACCESS_TOKEN` อย่างปลอดภัยแล้ว คำสั่งนี้จะเปลี่ยน default Rich Menu ของ OA สำหรับทุกคน จึงต้องทดสอบ LIFF ใหม่ก่อน

ถ้าต้องการตอบข้อความเมนูในแชต ให้ตั้ง `LINE_CHANNEL_SECRET` กับ `LINE_CHANNEL_ACCESS_TOKEN` บน Worker และกำหนด Webhook URL เป็น `<URL ระบบใหม่>/webhook` จากนั้นใช้ Verify ใน Messaging API console หากยังมีคำสั่งเก่าที่ต้องใช้ อย่าเปลี่ยน webhook จากระบบเก่าจนตรวจการย้ายข้อมูลและขอบเขตงานแล้ว การเปิด LIFF ผ่าน URI Rich Menu ไม่จำเป็นต้องใช้ webhook

## 5. ซิงค์ GitHub แล้ว deploy ตามโค้ด

ใน GitHub repository → Settings → Secrets and variables → Actions:

- Secrets: `CLOUDFLARE_API_TOKEN`, และ `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_ACCESS_TOKEN` ถ้าต้องการ webhook
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `LINE_LOGIN_CHANNEL_ID`, `LIFF_ID`, `ADMIN_LINE_USER_IDS`

Workflow `.github/workflows/check-and-deploy.yml` ตรวจแล้ว deploy main อัตโนมัติ หากยังไม่มี token จะตรวจ tests/build อย่างเดียว ผลผ่านของ tests ไม่ได้แปลว่า deploy แล้ว

## ก่อนใช้ข้อมูลจริง

ใช้ข้อมูลสมมติทดสอบบันทึก → ผู้อนุมัติเห็นรายการ → อนุมัติ → รายการย้ายไปประวัติ → refresh แล้วยังอยู่ ตรวจบัญชีไม่มีสิทธิ์/ถูกระงับด้วย ตั้งการสำรอง D1 และระยะเวลาเก็บรักษาตามนโยบายหน่วยงาน ข้อมูลใน Google Sheet/ฐานข้อมูลเก่าไม่ได้ถูกย้ายหรือลบโดยงานนี้
