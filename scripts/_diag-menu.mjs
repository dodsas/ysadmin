// 메뉴 탭 클릭 반복 시 layout shift 진단.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:5566';
const sessions = JSON.parse(await readFile('/Users/nam-yuseon/IdeaProjects/ysadmin/data/sessions.json', 'utf8'));
const token = sessions[0]?.token;

const VIEWPORT = { width: Number(process.argv[2] || 1280), height: 900 };
console.log('viewport:', VIEWPORT);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });
await ctx.addCookies([
  { name: 'ys_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
]);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-tab="lunch"]', { timeout: 10000 });
await page.waitForTimeout(500);

async function measure(label) {
  return await page.evaluate((l) => {
    const meta = document.getElementById('lunch-meta');
    const img = document.getElementById('lunch-image');
    const ocr = document.getElementById('lunch-ocr');
    return {
      label: l,
      metaText: (meta?.textContent || '').replace(/\s+/g, ' ').slice(0, 100),
      metaH: meta ? Math.round(meta.getBoundingClientRect().height) : null,
      metaTop: meta ? Math.round(meta.getBoundingClientRect().top) : null,
      imgTop: img ? Math.round(img.getBoundingClientRect().top) : null,
      imgH: img ? Math.round(img.getBoundingClientRect().height) : null,
      ocrHidden: ocr?.hidden,
    };
  }, label);
}

await page.click('[data-tab="lunch"]');
await page.waitForTimeout(500);
console.log(await measure('first-enter'));

for (let i = 1; i <= 5; i++) {
  await page.click('[data-tab="lunch"]');
  await page.waitForTimeout(150);
  console.log(await measure(`click-${i}`));
}

const otherTab = await page.evaluate(() => {
  const arr = [...document.querySelectorAll('.tab')].map((x) => x.dataset.tab);
  return arr.find((x) => x !== 'lunch');
});
await page.click(`[data-tab="${otherTab}"]`);
await page.waitForTimeout(200);
await page.click('[data-tab="lunch"]');
await page.waitForTimeout(50);
console.log(await measure('switch-back-50ms'));
await page.waitForTimeout(400);
console.log(await measure('switch-back-450ms'));

await browser.close();
