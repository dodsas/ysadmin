import { listTargets, updateTargetStatus, clampInterval } from './store.js';

const REQUEST_TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS ?? 10_000);
// 스케줄러 base tick — 매 tick 마다 대상별 intervalMs 경과 여부를 확인해
// "지금 보낼 대상" 만 핑한다. 단일 타이머로 분~하루까지 대상별 주기를 처리.
const BASE_TICK_MS = Number(process.env.PING_TICK_MS ?? 30_000);

let timer = null;

export async function checkTarget(target) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const patch = {
    lastCheckedAt: new Date().toISOString(),
    lastLatencyMs: null,
    lastStatusCode: null,
    lastError: null,
    status: 'down',
  };

  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'ysadmin-keepalive/0.1' },
    });
    patch.lastLatencyMs = Date.now() - startedAt;
    patch.lastStatusCode = res.status;
    patch.status = res.status < 500 ? 'up' : 'down';
    if (patch.status === 'down') {
      patch.lastError = `HTTP ${res.status}`;
    }
  } catch (err) {
    patch.lastLatencyMs = Date.now() - startedAt;
    patch.lastError = err.name === 'AbortError' ? '요청 시간 초과' : err.message;
  } finally {
    clearTimeout(timeout);
  }

  return updateTargetStatus(target.id, patch);
}

export async function checkAll() {
  const targets = await listTargets();
  if (targets.length === 0) return [];
  return Promise.all(targets.map(checkTarget));
}

// 대상별 주기 도래 판정. lastCheckedAt 이 없거나 intervalMs 경과했으면 체크 대상.
function isDue(target, now) {
  if (!target.lastCheckedAt) return true;
  const last = Date.parse(target.lastCheckedAt);
  if (Number.isNaN(last)) return true;
  // base tick 간격 탓에 매 주기가 조금씩 밀리는 누적 드리프트 방지: 반 tick 여유.
  return now - last >= clampInterval(target.intervalMs) - BASE_TICK_MS / 2;
}

// 이번 tick 에 주기가 도래한 대상만 핑.
export async function checkDue() {
  const targets = await listTargets();
  if (targets.length === 0) return [];
  const now = Date.now();
  const due = targets.filter((t) => isDue(t, now));
  if (due.length === 0) return [];
  return Promise.all(due.map(checkTarget));
}

export function startScheduler() {
  if (timer) {
    // 중복 호출은 좀비 인터벌의 원인이라 가시화한다.
    console.warn('[pinger] startScheduler 중복 호출 — 기존 인터벌 정리 후 재시작');
    stopScheduler();
  }
  const tick = () => {
    checkDue().catch((err) => console.error('[pinger] tick failed:', err));
  };
  tick();
  timer = setInterval(tick, BASE_TICK_MS);
  console.log(
    `[pinger] scheduler started — base tick ${Math.round(BASE_TICK_MS / 1000)}s, 대상별 주기 적용`,
  );
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
