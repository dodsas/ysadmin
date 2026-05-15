// 사용자가 메뉴 탭 깜빡임 문제를 직접 보여줄 수 있도록 headed Playwright 브라우저를 띄우고 대기.
// 종료: 사용자가 브라우저를 닫거나 프로세스 kill.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const BASE = 'http://localhost:5566';

const sessions = JSON.parse(
  await readFile('/Users/nam-yuseon/IdeaProjects/ysadmin/data/sessions.json', 'utf8'),
);
const token = sessions[0]?.token;
if (!token) throw new Error('no session token');

const browser = await chromium.launch({ headless: false, slowMo: 0 });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
await ctx.addCookies([
  {
    name: 'ys_session',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  },
]);

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`[console.${t}]`, m.text());
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

// 메뉴 탭이 보이면 클릭(없어도 무시)
try {
  await page.waitForSelector('[data-tab="lunch"]', { timeout: 5000 });
  console.log('READY — 메뉴 탭이 보이는 상태입니다. 자유롭게 클릭해 보세요.');
} catch {
  console.log('READY — 페이지는 떴는데 메뉴 탭 셀렉터를 못 찾았습니다.');
}

// 브라우저가 닫힐 때까지 프로세스 유지
browser.on('disconnected', () => {
  console.log('browser disconnected — exiting');
  process.exit(0);
});
await new Promise(() => {});
