"""Click the menu preview against local seeded sandbox only."""
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
url='http://127.0.0.1:3220/sandbox/menu'
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def start(role):
  page.goto(url);page.select_option('#menu-role',role)
 page.goto(url)
 expect(page.locator('.menu-hotspots a')).to_have_count(3)
 assert page.locator('.menu-art img').evaluate('(img)=>img.complete && img.naturalWidth===2500')
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(root/'docs/screenshots/menu-preview.png'),full_page=True)
 cases=[('credit_head','บันทึกลูกค้า','บันทึกข้อมูลลูกค้า'),('assistant_manager','รออนุมัติ','รายการรออนุมัติ'),('manager','อนุมัติแล้ว','รายการอนุมัติแล้ว'),('manager','บันทึกลูกค้า','เมนูสำหรับตำแหน่งอื่น'),('pending','รออนุมัติ','เข้าสู่ระบบ LINE สำเร็จแล้ว')]
 for role,button,heading in cases:
  start(role)
  page.get_by_role('link',name=button,exact=True).click()
  expect(page.get_by_role('heading',name=heading,exact=True)).to_be_visible()
  expect(page.locator('#demo')).to_contain_text('ข้อมูลสมมติแยก')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  print('PASS:',role,'→',button,'→',heading)
 assert not errors,errors
 browser.close()
 print('Menu preview: 5 navigation/permission cases passed; image loaded; no horizontal overflow or JS errors.')
