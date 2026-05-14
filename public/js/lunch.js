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

function renderMeta(meta, opts = {}) {
  const metaEl = $('#lunch-meta');
  const imgEl = $('#lunch-image');
  const info = [];
  if (meta.name) info.push(meta.name);
  if (meta.price) info.push(formatPrice(meta.price));
  if (meta.description) info.push(meta.description);
  const tail = [`갱신: ${formatTime(meta.fetchedAt)}`];
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
  metaEl.textContent = force ? '강제 갱신 중...' : '불러오는 중...';
  if (force) imgEl.removeAttribute('src');

  inFlight = (async () => {
    try {
      const { meta, stale, error } = await api(`/api/lunch${force ? '?force=1' : ''}`);
      renderMeta(meta, { stale, error });
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

export function setupLunchImageDialog() {
  const img = $('#lunch-image');
  const dlg = $('#lunch-image-dialog');
  const large = $('#lunch-image-large');
  if (!img || !dlg || !large) return;
  img.addEventListener('click', () => {
    if (!img.src) return;
    large.src = img.src;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  const close = dlg.querySelector('[data-dialog-close]');
  if (close) close.addEventListener('click', () => dlg.close());
  // 백드롭 클릭으로도 닫기
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
}

export async function onEnterLunchTab() {
  await refreshLunch(false);
}
