"""Local UI verification and screenshots. Requires Python Playwright and Chromium."""
from pathlib import Path
import time
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent
out=root/'docs/screenshots'; out.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
 page=context.new_page(); errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto('http://127.0.0.1:3100')
 expect(page.get_by_role('heading',name='บันทึกข้อมูลลูกค้า',exact=True)).to_be_visible()
 page.screenshot(path=str(out/'01-create-mobile.png'),full_page=True)
 cif=f'{int(time.time())%100000000:08d}'
 for name,number in [('ลูกค้าทดสอบหนึ่ง',cif),('ลูกค้าทดสอบสอง',f'{(int(cif)+1)%100000000:08d}')]:
  page.locator('[name=firstName]').fill(name)
  page.locator('[name=lastName]').fill('ข้อมูลสมมติ')
  page.locator('[name=cif]').fill(number)
  page.get_by_role('button',name='บันทึกและส่งรออนุมัติ').click()
  expect(page.locator('#message')).to_contain_text('บันทึกสำเร็จ')
 page.select_option('#role','assistant_manager')
 expect(page.get_by_role('heading',name='รายการรออนุมัติ',exact=True)).to_be_visible()
 expect(page.locator('article').filter(has_text=cif)).to_be_visible()
 page.screenshot(path=str(out/'02-pending-mobile.png'),full_page=True)
 page.locator('article').filter(has_text=cif).get_by_role('button',name='อนุมัติรายการ',exact=True).click()
 expect(page.locator('dialog')).to_be_visible()
 page.get_by_role('button',name='ยืนยันอนุมัติ',exact=True).click()
 expect(page.locator('#message')).to_contain_text('อนุมัติสำเร็จ')
 page.locator('nav button[data-page=approved]').click()
 expect(page.get_by_role('heading',name='รายการอนุมัติแล้ว',exact=True)).to_be_visible()
 expect(page.locator('article').filter(has_text=cif)).to_contain_text('อนุมัติโดย')
 page.screenshot(path=str(out/'03-approved-mobile.png'),full_page=True)
 page.reload()
 expect(page.get_by_role('heading',name='บันทึกข้อมูลลูกค้า',exact=True)).to_be_visible()
 page.select_option('#role','manager')
 expect(page.get_by_role('heading',name='รายการรออนุมัติ',exact=True)).to_be_visible()
 page.locator('nav button[data-page=approved]').click()
 expect(page.locator('article').filter(has_text=cif)).to_be_visible()
 page.select_option('#role','pending')
 expect(page.get_by_role('heading',name='เข้าสู่ระบบ LINE สำเร็จแล้ว',exact=True)).to_be_visible()
 expect(page.locator('nav button:disabled')).to_have_count(3)
 page.screenshot(path=str(out/'04-access-mobile.png'),full_page=True)
 page.select_option('#role','admin')
 expect(page.get_by_role('heading',name='กำหนดสิทธิ์เจ้าหน้าที่',exact=True)).to_be_visible()
 page.screenshot(path=str(out/'05-staff-mobile.png'),full_page=True)
 assert not errors,errors
 print('Browser passed: submit two customers; approve; view approved; reload persistence; pending-access screen; admin screen; no JS errors.')
 from importlib import import_module
 import_module('render-previews').render(browser)
 browser.close()
