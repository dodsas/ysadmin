// 로그 feature — 서버 로그 조회/삭제 + 오래된 로그 자동 정리
import { readRecentLogs, clearLogs, purgeOldLogs } from '../lib/log-reader.js';
import { logger } from '../lib/logger.js';

const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 7);
const PURGE_INTERVAL_MS = Number(process.env.LOG_PURGE_INTERVAL_MS || 24 * 60 * 60 * 1000);
const PURGE_STARTUP_DELAY_MS = 10_000;

async function runPurge(trigger) {
  try {
    const result = await purgeOldLogs({ olderThanDays: RETENTION_DAYS });
    if (result.removed.length > 0) {
      logger.info('logs', '오래된 로그 파일 삭제', {
        trigger,
        retentionDays: RETENTION_DAYS,
        removedCount: result.removed.length,
        files: result.removed.map((r) => r.file),
      });
    }
    return result;
  } catch (err) {
    logger.error('logs', '오래된 로그 삭제 실패', {
      trigger,
      error: err.message,
    });
    throw err;
  }
}

function register(app) {
  app.get('/api/logs', async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      const entries = await readRecentLogs({ limit });
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/logs', async (req, res) => {
    try {
      const username = req.session?.username || '-';
      const result = await clearLogs({ includeRotated: req.query.rotated !== '0' });
      logger.info('logs', '로그 삭제', { by: username, ...result });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/logs/purge', async (req, res) => {
    try {
      const days = req.body?.olderThanDays ?? RETENTION_DAYS;
      const result = await purgeOldLogs({ olderThanDays: Number(days) });
      logger.info('logs', '수동 오래된 로그 삭제', {
        by: req.session?.username || '-',
        ...result,
        removedCount: result.removed.length,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

function startSchedulers() {
  logger.info('logs', '오래된 로그 정리 스케줄러 시작', {
    retentionDays: RETENTION_DAYS,
    intervalMs: PURGE_INTERVAL_MS,
  });
  setTimeout(() => {
    runPurge('startup').catch(() => {});
  }, PURGE_STARTUP_DELAY_MS);
  setInterval(() => {
    runPurge('scheduled').catch(() => {});
  }, PURGE_INTERVAL_MS);
}

export const logsFeature = {
  id: 'logs',
  label: '로그',
  description: '서버 로그 조회 + 7일 지난 rotated 로그 자동 삭제',
  register,
  startSchedulers,
};
