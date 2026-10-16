from pathlib import Path
import base64

def render(browser):
 root=Path(__file__).resolve().parent.parent
 out=root/'docs/screenshots'
 html=(root/'docs/preview.html').read_text()
 for name in ['01-create-mobile.png','02-pending-mobile.png','03-approved-mobile.png']:
  data=base64.b64encode((out/name).read_bytes()).decode()
  html=html.replace('screenshots/'+name,'data:image/png;base64,'+data)
 preview=browser.new_page(viewport={'width':1320,'height':1280},device_scale_factor=1)
 preview.set_content(html)
 preview.screenshot(path=str(out/'overview.png'),full_page=True)
 menu=browser.new_page(viewport={'width':2500,'height':843},device_scale_factor=1)
 menu.set_content((root/'docs/rich-menu.html').read_text())
 menu.screenshot(path=str(root/'docs/rich-menu.png'))
 preview.close(); menu.close()

if __name__=='__main__':
 from playwright.sync_api import sync_playwright
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  render(browser)
  browser.close()
 print('Rendered actual mobile screenshots and Rich Menu artwork.')
