import { $, api } from './util.js';

function formatPrice(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return p || '';
  return `${n.toLocaleString('ko-KR')}원`;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', { hour12: false });
}

let inFlight = null;

export async function refreshLunch() {
  if (inFlight) return inFlight;
  const metaEl = $('#lunch-meta');
  const imgEl = $('#lunch-image');
  metaEl.textContent = '갱신 중...';
  imgEl.removeAttribute('src');
  inFlight = (async () => {
    try {
      const { meta, stale, error } = await api('/api/lunch');
      const parts = [];
      if (meta.name) parts.push(meta.name);
      if (meta.price) parts.push(formatPrice(meta.price));
      if (meta.description) parts.push(meta.description);
      parts.push(`갱신: ${formatTime(meta.fetchedAt)}`);
      if (stale) parts.push(`(캐시 — 갱신 실패: ${error})`);
      metaEl.textContent = parts.join(' · ');
      imgEl.src = `/api/lunch/image?t=${encodeURIComponent(meta.fetchedAt)}`;
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
    refreshLunch().catch((err) => alert(err.message));
  });
}

export async function onEnterLunchTab() {
  await refreshLunch();
}
