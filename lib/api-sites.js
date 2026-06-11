// OPENAPI 사이트 디렉터리 스토어 — 사이트명/주소/용도 + favicon.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = resolve(process.cwd(), 'data');
const DATA_FILE = resolve(DATA_DIR, 'api-sites.json');

let cache = null;
let writeQueue = Promise.resolve();

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    cache = JSON.parse(raw);
    if (!Array.isArray(cache)) cache = [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = [];
    } else {
      throw err;
    }
  }
  return cache;
}

async function persist() {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function enqueueWrite() {
  writeQueue = writeQueue.then(persist).catch((err) => {
    console.error('[api-sites] persist failed:', err);
  });
  return writeQueue;
}

function normalizeUrl(input) {
  if (typeof input !== 'string') throw badRequest('주소는 문자열이어야 합니다.');
  const trimmed = input.trim();
  if (!trimmed) throw badRequest('사이트 주소가 비어 있습니다.');
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  const u = new URL(candidate);
  return u.toString().replace(/\/$/, '');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export async function listSites() {
  await ensureLoaded();
  return cache.map((s) => ({ ...s }));
}

export async function getSite(id) {
  await ensureLoaded();
  const s = cache.find((x) => x.id === id);
  return s ? { ...s } : null;
}

export async function addSite({ name, url, purpose }) {
  await ensureLoaded();
  const normalized = normalizeUrl(url);
  const site = {
    id: randomUUID(),
    name: (name && String(name).trim()) || hostnameOf(normalized),
    url: normalized,
    purpose: (purpose && String(purpose).trim()) || '',
    createdAt: new Date().toISOString(),
  };
  cache.push(site);
  await enqueueWrite();
  return { ...site };
}

export async function updateSite(id, patch) {
  await ensureLoaded();
  const s = cache.find((x) => x.id === id);
  if (!s) return null;
  if (patch.name !== undefined) {
    const next = String(patch.name).trim();
    if (next) s.name = next;
  }
  if (patch.url !== undefined) {
    s.url = normalizeUrl(patch.url);
  }
  if (patch.purpose !== undefined) {
    s.purpose = String(patch.purpose).trim();
  }
  await enqueueWrite();
  return { ...s };
}

export async function removeSite(id) {
  await ensureLoaded();
  const idx = cache.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  cache.splice(idx, 1);
  await enqueueWrite();
  return true;
}

export async function reorderSites(orderedIds) {
  await ensureLoaded();
  if (!Array.isArray(orderedIds)) throw badRequest('순서는 ID 배열이어야 합니다.');
  const byId = new Map(cache.map((s) => [s.id, s]));
  const seen = new Set();
  const next = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (!s || seen.has(id)) continue;
    next.push(s);
    seen.add(id);
  }
  for (const s of cache) if (!seen.has(s.id)) next.push(s);
  cache = next;
  await enqueueWrite();
  return cache.map((s) => ({ ...s }));
}

// ── favicon 리졸버 ────────────────────────────────────────────────
// 사이트 HTML 의 <link rel="icon"> 을 파싱해 가장 좋은 후보를 고르고,
// 실패하면 /favicon.ico → Google s2 순으로 폴백. 결과(이미지 바이트)는
// origin 기준 메모리 캐시. 클라이언트는 /api/apisites/:id/favicon 로 프록시
// 받아서 CORS/mixed-content 걱정 없이 표에 그린다.
const FAVICON_TTL_MS = 24 * 60 * 60 * 1000;
const FAVICON_TIMEOUT_MS = 8000;
const faviconCache = new Map(); // origin -> { buffer, contentType, fetchedAt }

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAVICON_TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'ysadmin-favicon/0.1' },
      ...opts,
    });
  } finally {
    clearTimeout(timer);
  }
}

// HTML 에서 아이콘 후보 URL 들을 추출해 절대경로로 변환. 큰 아이콘 우선.
function extractIconCandidates(html, baseUrl) {
  const out = [];
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1] || '';
    if (!/icon/i.test(rel)) continue;
    const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const sizes = (tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1];
    let score = Number(sizes) || 0;
    if (/apple-touch-icon/i.test(rel)) score += 16; // 보통 고해상도 PNG
    try {
      out.push({ url: new URL(href, baseUrl).toString(), score });
    } catch {
      /* 잘못된 href 무시 */
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((c) => c.url);
}

async function tryFetchImage(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!/^image\//i.test(contentType) && !/\.ico(\?|$)/i.test(url)) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return null;
    return { buffer, contentType: contentType || 'image/x-icon' };
  } catch {
    return null;
  }
}

export async function resolveFavicon(siteUrl) {
  const origin = new URL(siteUrl).origin;
  const host = new URL(siteUrl).hostname;
  const cached = faviconCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < FAVICON_TTL_MS) {
    return { buffer: cached.buffer, contentType: cached.contentType };
  }

  const candidates = [];
  try {
    const res = await fetchWithTimeout(origin, {
      headers: { 'User-Agent': 'ysadmin-favicon/0.1', Accept: 'text/html' },
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, 200_000);
      candidates.push(...extractIconCandidates(html, origin));
    }
  } catch {
    /* HTML 못 받아도 아래 폴백 시도 */
  }
  candidates.push(new URL('/favicon.ico', origin).toString());
  candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`);

  const seen = new Set();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    const img = await tryFetchImage(url);
    if (img) {
      faviconCache.set(origin, { ...img, fetchedAt: Date.now() });
      return img;
    }
  }
  return null;
}

// 사이트 수정/삭제 시 캐시 무효화.
export function invalidateFavicon(siteUrl) {
  try {
    faviconCache.delete(new URL(siteUrl).origin);
  } catch {
    /* noop */
  }
}
