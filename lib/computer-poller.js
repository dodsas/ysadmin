import { listComputers, recordStatus } from './computers.js';
import { checkComputerStatus } from './lan.js';
import { logger } from './logger.js';

const POLL_INTERVAL_MS = Number(process.env.COMPUTER_POLL_INTERVAL_MS || 10 * 60 * 1000);
const INITIAL_DELAY_MS = 5_000;
const TAB_TRIGGER_DEBOUNCE_MS = Number(process.env.COMPUTER_TAB_DEBOUNCE_MS || 5 * 60 * 1000);

let running = false;
let lastRunAt = 0;
let initialTimer = null;
let intervalTimer = null;

export function isRunning() {
  return running;
}

export function getLastRunAt() {
  return lastRunAt;
}

async function runOnce(trigger) {
  if (running) {
    logger.info('computer-poller', `이미 실행 중 — 스킵`, { trigger });
    return { skipped: 'running' };
  }
  running = true;
  const started = Date.now();
  try {
    const computers = await listComputers();
    logger.info('computer-poller', `전체 상태 체크 시작`, { trigger, count: computers.length });
    for (const c of computers) {
      try {
        const status = await checkComputerStatus({ mac: c.mac, ip: c.ip });
        await recordStatus(c.id, status);
      } catch (err) {
        logger.warn('computer-poller', `${c.label} 체크 실패`, { error: err.message });
      }
    }
    lastRunAt = Date.now();
    logger.info('computer-poller', `전체 상태 체크 완료`, {
      trigger,
      elapsedMs: lastRunAt - started,
    });
    return { ok: true };
  } finally {
    running = false;
  }
}

// 탭 진입 등 외부 트리거. 최근 실행/실행중이면 스킵.
export async function triggerCheckAll(trigger = 'manual') {
  if (running) return { skipped: 'running' };
  const since = Date.now() - lastRunAt;
  if (lastRunAt && since < TAB_TRIGGER_DEBOUNCE_MS) {
    logger.info('computer-poller', `최근 실행됨 — 스킵`, {
      trigger,
      msSinceLastRun: since,
    });
    return { skipped: 'recent', msSinceLastRun: since };
  }
  return runOnce(trigger);
}

export function startComputerPoller() {
  // 중복 호출 가드 — 기존 타이머가 있으면 정리 후 새로 만든다.
  stopComputerPoller();

  initialTimer = setTimeout(() => {
    initialTimer = null;
    runOnce('startup').catch((err) =>
      logger.error('computer-poller', '초기 체크 실패', { error: err.message }),
    );
  }, INITIAL_DELAY_MS);

  intervalTimer = setInterval(() => {
    runOnce('scheduled').catch((err) =>
      logger.error('computer-poller', '스케줄 체크 실패', { error: err.message }),
    );
  }, POLL_INTERVAL_MS);

  logger.info('computer-poller', `스케줄러 시작`, {
    intervalMs: POLL_INTERVAL_MS,
    debounceMs: TAB_TRIGGER_DEBOUNCE_MS,
  });
}

export function stopComputerPoller() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}
