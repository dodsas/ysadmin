import { $, api } from './util.js';

const CACHE_KEY = 'ysadmin:lunch:v1';

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return p || '';
  return `${n.toLocaleString('ko-KR')}원`;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', { hour12: false });
}

function todayKstKey() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function readLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj.dayKey !== todayKstKey()) return null;
    return obj.meta || null;
  } catch {
    return null;
  }
}

function writeLocalCache(meta) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ dayKey: todayKstKey(), meta }));
  } catch {
    /* quota/private mode */
  }
}

function renderMeta(metaEl, imgEl, meta, opts = {}) {
  const info = [];
  if (meta.name) info.push(meta.name);
  if (meta.price) info.push(formatPrice(meta.price));
  if (meta.description) info.push(meta.description);
  const tail = [`갱신: ${formatTime(meta.fetchedAt)}`];
  if (meta.fromCache || opts.fromCache) tail.push('(오늘 캐시)');
  if (opts.stale) tail.push(`(캐시 — 갱신 실패: ${opts.error})`);
  metaEl.textContent = [info.join(' · '), tail.join(' · ')].filter(Boolean).join('\n');
  imgEl.src = `/api/lunch/image?t=${encodeURIComponent(meta.fetchedAt)}`;

  const ocrWrap = $('#lunch-ocr');
  const ocrText = $('#lunch-ocr-text');
  if (ocrWrap && ocrText) {
    const text = (meta.extractedText || '').trim();
    if (text) {
      ocrText.textContent = text;
      ocrWrap.hidden = false;
    } else {
      ocrText.textContent = '';
      ocrWrap.hidden = true;
    }
  }
}

let inFlight = null;

export async function refreshLunch(force = false) {
  if (inFlight) return inFlight;
  const metaEl = $('#lunch-meta');
  const imgEl = $('#lunch-image');

  if (!force) {
    const cached = readLocalCache();
    if (cached) {
      renderMeta(metaEl, imgEl, cached, { fromCache: true });
      return;
    }
  }

  metaEl.textContent = force ? '강제 갱신 중...' : '불러오는 중...';
  if (force) imgEl.removeAttribute('src');

  inFlight = (async () => {
    try {
      const { meta, stale, error } = await api(`/api/lunch${force ? '?force=1' : ''}`);
      renderMeta(metaEl, imgEl, meta, { stale, error });
      if (!stale) writeLocalCache(meta);
    } catch (err) {
      metaEl.textContent = `오류: ${err.message}`;
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

export function setupLunchRefreshButton() {
  $('#lunch-refresh-btn').addEventListener('click', () => {
    refreshLunch(true).catch((err) => alert(err.message));
  });
}

export async function onEnterLunchTab() {
  await refreshLunch(false);
}
