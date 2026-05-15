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

export function setupLunchImageZoom() {
  const wrap = document.querySelector('.lunch-image-wrap');
  const img = $('#lunch-image');
  if (!wrap || !img) return;

  // ── 줌 / 팬 / 핀치 (메인 이미지 직접 적용) ────────────────────
  const MIN = 1;
  const MAX = 6;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map();
  let lastPinchDist = 0;
  let lastPinchCenter = { x: 0, y: 0 };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastTapAt = 0;

  function apply(animate = false) {
    img.style.transition = animate ? 'transform 0.18s ease' : 'none';
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
  }
  function zoomAt(clientX, clientY, next) {
    next = Math.max(MIN, Math.min(MAX, next));
    const rect = img.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const ratio = next / scale;
    tx = dx - ratio * (dx - tx);
    ty = dy - ratio * (dy - ty);
    scale = next;
    if (scale <= MIN + 0.001) {
      scale = 1;
      tx = 0;
      ty = 0;
    }
    apply(false);
  }

  // 새 이미지 src 가 세팅될 때(매번 fetch 시) 줌 리셋
  img.addEventListener('load', () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply(false);
  });

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, scale * factor);
  }, { passive: false });

  img.addEventListener('pointerdown', (e) => {
    img.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      dragging = false;
      const [a, b] = [...pointers.values()];
      lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      lastPinchCenter = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }

    // 더블탭(터치) — 250ms 안 같은 자리 두 번
    if (e.pointerType === 'touch') {
      const now = Date.now();
      if (now - lastTapAt < 250) {
        zoomAt(e.clientX, e.clientY, scale > 1 ? 1 : 2.5);
        apply(true);
        lastTapAt = 0;
        return;
      }
      lastTapAt = now;
    }

    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  img.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (lastPinchDist > 0) {
        zoomAt(cx, cy, scale * (dist / lastPinchDist));
        tx += cx - lastPinchCenter.x;
        ty += cy - lastPinchCenter.y;
        apply(false);
      }
      lastPinchDist = dist;
      lastPinchCenter = { x: cx, y: cy };
      return;
    }

    if (dragging && scale > 1) {
      tx += e.clientX - lastX;
      ty += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      apply(false);
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) lastPinchDist = 0;
    if (pointers.size === 0) {
      dragging = false;
    }
  }
  img.addEventListener('pointerup', endPointer);
  img.addEventListener('pointercancel', endPointer);
  img.addEventListener('lostpointercapture', endPointer);

  // 데스크탑 더블클릭으로 토글 줌
  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, scale > 1 ? 1 : 2.5);
    apply(true);
  });

  apply(false);
}

export async function onEnterLunchTab() {
  await refreshLunch(false);
}
