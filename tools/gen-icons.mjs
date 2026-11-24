// Rasterize assets/favicon.svg into PNG icons for the web app manifest.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER || '/workspace/.ptools/node_modules/puppeteer-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const CHROME = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/opt/ungoogled-chromium/chrome'].find((p) => fs.existsSync(p));
const svg = fs.readFileSync(path.join(ASSETS, 'favicon.svg'), 'utf8');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

async function render(size, out, { pad = 0, bg = '#1d1712', radius = 0 } = {}) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const inner = size - pad * 2;
  const html = `<!doctype html><html><body style="margin:0;background:${bg};width:${size}px;height:${size}px;overflow:hidden;">
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg};${radius ? `border-radius:${radius}px;overflow:hidden;` : ''}">
      <div style="width:${inner}px;height:${inner}px">${svg}</div>
    </div>
  </body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: out, type: 'png', omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', out);
}

await render(192, path.join(ASSETS, 'icon-192.png'));
await render(512, path.join(ASSETS, 'icon-512.png'));
// Maskable icons keep the artwork in the inner 80% safe zone.
await render(512, path.join(ASSETS, 'icon-maskable-512.png'), { pad: 51, bg: '#1d1712' });
await render(180, path.join(ASSETS, 'apple-touch-icon.png'), { radius: 0 });
await browser.close();
