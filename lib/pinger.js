import { listTargets, updateTargetStatus } from './store.js';

const DEFAULT_INTERVAL_MS = Number(process.env.PING_INTERVAL_MS ?? 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS ?? 10_000);

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

export function startScheduler(intervalMs = DEFAULT_INTERVAL_MS) {
  if (timer) {
    // 중복 호출은 좀비 인터벌의 원인이라 가시화한다.
    console.warn('[pinger] startScheduler 중복 호출 — 기존 인터벌 정리 후 재시작');
    stopScheduler();
  }
  const tick = () => {
    checkAll().catch((err) => console.error('[pinger] tick failed:', err));
  };
  tick();
  timer = setInterval(tick, intervalMs);
  console.log(`[pinger] scheduler started — interval ${Math.round(intervalMs / 1000)}s`);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
