// 메뉴 탭 첫 클릭 직후 0~800ms 동안 5ms 간격으로 위치 측정 (서브-프레임 shift 탐지)
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:5566';
const sessions = JSON.parse(
  await readFile('/Users/nam-yuseon/IdeaProjects/ysadmin/data/sessions.json', 'utf8'),
);
const token = sessions[0]?.token;
const VIEWPORT = { width: Number(process.argv[2] || 1280), height: 900 };

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT });
await ctx.addCookies([
  { name: 'ys_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
]);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-tab="lunch"]', { timeout: 10000 });

// PerformanceObserver로 layout-shift 캡처
await page.evaluate(() => {
  window.__shifts = [];
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__shifts.push({ value: e.value, time: e.startTime, sources: (e.sources || []).map((s) => s.node?.id || s.node?.className || s.node?.tagName) });
    }
  });
  try { obs.observe({ type: 'layout-shift', buffered: true }); } catch {}
});

// 측정 함수
async function snap() {
  return await page.evaluate(() => {
    const m = document.getElementById('lunch-meta');
    const i = document.getElementById('lunch-image');
    return {
      t: performance.now(),
      metaH: m ? Math.round(m.getBoundingClientRect().height) : null,
      metaTop: m ? Math.round(m.getBoundingClientRect().top) : null,
      imgTop: i ? Math.round(i.getBoundingClientRect().top) : null,
      text: (m?.textContent || '').slice(0, 30),
    };
  });
}

// 메뉴 탭 클릭 (page reload 직후 첫 진입)
console.log('-- first click --');
await page.click('[data-tab="lunch"]');
const start = Date.now();
const samples = [];
while (Date.now() - start < 800) {
  samples.push(await snap());
}
const distinct = [];
for (const s of samples) {
  const last = distinct[distinct.length - 1];
  if (!last || last.imgTop !== s.imgTop || last.metaH !== s.metaH || last.text !== s.text) {
    distinct.push(s);
  }
}
console.log('distinct snapshots (text/imgTop/metaH change):');
for (const s of distinct) console.log(s);

// 누적 CLS
const shifts = await page.evaluate(() => window.__shifts);
const cls = shifts.reduce((a, s) => a + s.value, 0);
console.log('CLS:', cls.toFixed(4), 'entries:', shifts.length);
for (const s of shifts) console.log('  ', s);

await browser.close();
