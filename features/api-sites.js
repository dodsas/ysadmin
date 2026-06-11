// OPENAPI feature — 자주 쓰는 OpenAPI 사이트 디렉터리 (사이트명/주소/용도 + favicon)
import {
  listSites,
  getSite,
  addSite,
  updateSite,
  removeSite,
  reorderSites,
  resolveFavicon,
  invalidateFavicon,
} from '../lib/api-sites.js';
import { logger } from '../lib/logger.js';

function register(app) {
  app.get('/api/apisites', async (_req, res) => {
    const sites = await listSites();
    res.json({ sites });
  });

  app.post('/api/apisites', async (req, res) => {
    try {
      const site = await addSite({
        name: req.body?.name,
        url: req.body?.url,
        purpose: req.body?.purpose,
      });
      logger.info('apisites', '사이트 추가', { id: site.id, url: site.url });
      res.status(201).json({ site });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.patch('/api/apisites/:id', async (req, res) => {
    try {
      const before = await getSite(req.params.id);
      const site = await updateSite(req.params.id, req.body || {});
      if (!site) return res.status(404).json({ error: '사이트를 찾을 수 없습니다.' });
      if (before && before.url !== site.url) invalidateFavicon(before.url);
      res.json({ site });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  app.delete('/api/apisites/:id', async (req, res) => {
    const site = await getSite(req.params.id);
    const ok = await removeSite(req.params.id);
    if (!ok) return res.status(404).json({ error: '사이트를 찾을 수 없습니다.' });
    if (site) invalidateFavicon(site.url);
    res.status(204).end();
  });

  app.put('/api/apisites/order', async (req, res) => {
    try {
      const sites = await reorderSites(req.body?.order);
      res.json({ sites });
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // favicon 프록시 — 사이트의 아이콘을 서버가 받아 캐시하고 이미지 바이트로 반환.
  app.get('/api/apisites/:id/favicon', async (req, res) => {
    const site = await getSite(req.params.id);
    if (!site) return res.status(404).end();
    try {
      const icon = await resolveFavicon(site.url);
      if (!icon) return res.status(404).end();
      res.set('Content-Type', icon.contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(icon.buffer);
    } catch {
      res.status(404).end();
    }
  });
}

export const apiSitesFeature = {
  id: 'apisites',
  label: 'OPENAPI',
  description: '자주 쓰는 OpenAPI 사이트 디렉터리 (사이트명/주소/용도)',
  register,
};
