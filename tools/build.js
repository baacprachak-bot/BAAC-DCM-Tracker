import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
export function assets() {
  const files = [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'], ['/sandbox/menu', 'menu.html', 'text/html'], ['/menu.js', 'menu.js', 'text/javascript'], ['/menu.css', 'menu.css', 'text/css']];
  return Object.fromEntries(files.map(([path, file, type]) => {
    let body = readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8');
    if (file === 'menu.html') body = body.replace('__RICH_MENU_IMAGE__', `data:image/png;base64,${readFileSync(new URL('../docs/rich-menu.png', import.meta.url)).toString('base64')}`);
    return [path, { body, type: `${type}; charset=utf-8` }];
  }));
}
export function build() {
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const marker = 'const ASSETS = /* build:assets */ {};';
  if (!source.includes(marker)) throw new Error('Missing asset marker');
  mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../dist/worker.mjs', import.meta.url), source.replace(marker, () => `const ASSETS = ${JSON.stringify(assets())};`));
}
if (process.argv[1]?.endsWith('/build.js')) { build(); console.log('Built dist/worker.mjs — Worker and UI in one deployment'); }
