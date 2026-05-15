// 로그 feature — 서버 로그 조회/삭제
import { readRecentLogs, clearLogs } from '../lib/log-reader.js';
import { logger } from '../lib/logger.js';

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
}

export const logsFeature = {
  id: 'logs',
  label: '로그',
  description: '서버 로그 (logs/ysadmin.log) 최근 항목 조회',
  register,
  startSchedulers: null,
};
