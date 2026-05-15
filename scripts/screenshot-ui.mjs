// Headless capture — inspects header layout + API keys dialog after login.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:5566';
const OUT_DIR = '/tmp';

const sessions = JSON.parse(await readFile('data/sessions.json', 'utf8'));
const token = sessions[0]?.token;
if (!token) throw new Error('no session token');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
await ctx.addCookies([
  { name: 'ys_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
]);

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#api-keys-link:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(300);

const headerBox = await page.locator('.app-header').boundingBox();
await page.screenshot({
  path: `${OUT_DIR}/ui-header.png`,
  clip: { x: 0, y: 0, width: 1280, height: Math.ceil((headerBox?.height ?? 80) + 20) },
});

// Mobile width
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
await page.screenshot({
  path: `${OUT_DIR}/ui-header-mobile.png`,
  clip: { x: 0, y: 0, width: 390, height: 120 },
});
await page.setViewportSize({ width: 1280, height: 800 });

// Open API keys dialog
await page.click('#api-keys-link');
await page.waitForSelector('#api-keys-dialog[open]', { timeout: 3000 });
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT_DIR}/ui-api-keys-dialog.png`, fullPage: false });

// Dump layout info
const info = await page.evaluate(() => {
  const tabs = document.querySelector('.tabs');
  const items = Array.from(document.querySelectorAll('.tabs > *')).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: el.className,
      hidden: el.hidden,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  return {
    tabsRect: tabs ? tabs.getBoundingClientRect() : null,
    items,
  };
});
console.log(JSON.stringify(info, null, 2));

await browser.close();
console.log('saved:');
console.log(' ', `${OUT_DIR}/ui-header.png`);
console.log(' ', `${OUT_DIR}/ui-header-mobile.png`);
console.log(' ', `${OUT_DIR}/ui-api-keys-dialog.png`);
