export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function formatTimestamp(iso) {
  if (!iso) return '아직 체크 전';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { hour12: false });
}

export function targetStatusLabel(status) {
  switch (status) {
    case 'up':
      return '정상';
    case 'down':
      return '응답 없음';
    default:
      return '확인 중';
  }
}

export function computerStatusLabel(s) {
  if (s === 'up') return '켜짐';
  if (s === 'down') return '꺼짐';
  return '미확인';
}

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '인증이 필요합니다.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}
