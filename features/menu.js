// 메뉴 feature — 구내식당 식단 이미지 제공
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  getLunchMeta,
  getOrRefreshLunch,
  startLunchScheduler,
  LUNCH_IMAGE_FILE,
} from '../lib/lunch.js';
import { logger } from '../lib/logger.js';

function register(app) {
  app.get('/api/lunch', async (req, res) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    try {
      const meta = await getOrRefreshLunch({ force });
      res.json({ meta });
    } catch (err) {
      logger.error('lunch', '갱신 실패', { error: err.message });
      const cached = await getLunchMeta();
      if (cached) {
        res.json({ meta: cached, stale: true, error: err.message });
      } else {
        res.status(502).json({ error: err.message });
      }
    }
  });

  app.get('/api/lunch/image', async (_req, res) => {
    try {
      await stat(LUNCH_IMAGE_FILE);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Content-Type', 'image/jpeg');
      createReadStream(LUNCH_IMAGE_FILE).pipe(res);
    } catch {
      res.status(404).json({ error: '이미지가 아직 다운로드되지 않았습니다.' });
    }
  });
}

export const menuFeature = {
  id: 'lunch',
  label: '메뉴',
  description: '구내식당 식단 이미지 (08:00 KST 자동 갱신)',
  register,
  startSchedulers: startLunchScheduler,
};
