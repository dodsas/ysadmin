// 외부(아이폰 위젯 등)에서 호출하는 공개 API. Bearer 토큰 = API 키.
// 세션 인증과 별개로 동작 — Authorization 헤더만으로 접근.
import { Router } from 'express';
import { listComputers, getComputer, markWoken, recordStatus } from '../lib/computers.js';
import { sendMagicPacket } from '../lib/wol.js';
import { checkComputerStatus } from '../lib/lan.js';
import { shutdownComputer } from '../lib/shutdown.js';
import { verifyApiKey } from '../lib/api-keys.js';
import { logger } from '../lib/logger.js';
import { buildOpenApiSpec } from '../lib/openapi.js';

function getBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  // 위젯에서 헤더 설정이 번거로울 때를 위한 폴백.
  if (req.headers['x-api-key']) return String(req.headers['x-api-key']).trim();
  return '';
}

function requireScope(scope) {
  return (req, res, next) => {
    const scopes = req.apiKey?.scopes || [];
    if (!scopes.includes(scope)) {
      return res.status(403).json({ error: `필요 권한 없음: ${scope}` });
    }
    next();
  };
}

function publicComputer(c) {
  return {
    id: c.id,
    label: c.label,
    mac: c.mac,
    ip: c.ip || null,
    os: c.os,
    status: c.status || 'unknown',
    lastCheckedAt: c.lastCheckedAt || null,
    lastWokenAt: c.lastWokenAt || null,
    shutdownEnabled: Boolean(c.shutdown?.enabled),
  };
}

function register(app) {
  // 스펙/문서는 인증 없이 노출 (외부 도구가 schema 만 읽을 수 있게).
  // v1 라우터보다 먼저 등록해야 함 — 그렇지 않으면 라우터의 auth 미들웨어가 먼저 잡음.
  app.get('/api/v1/openapi.json', (req, res) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const spec = buildOpenApiSpec({ serverUrl: `${proto}://${host}` });
    res.set('Cache-Control', 'no-store');
    res.json(spec);
  });
  app.get('/api/docs', (_req, res) => {
    res.type('html').send(scalarHtml('/api/v1/openapi.json'));
  });

  const v1 = Router();

  // 모든 v1 경로는 API 키 필수.
  v1.use(async (req, res, next) => {
    const raw = getBearer(req);
    const entry = await verifyApiKey(raw);
    if (!entry) {
      res.set('WWW-Authenticate', 'Bearer realm="ysadmin"');
      return res.status(401).json({ error: 'API 키가 유효하지 않습니다.' });
    }
    req.apiKey = entry;
    next();
  });

  v1.get('/computers', requireScope('computers:read'), async (_req, res) => {
    const computers = await listComputers();
    res.json({ computers: computers.map(publicComputer) });
  });

  v1.get('/computers/:id', requireScope('computers:read'), async (req, res) => {
    const c = await getComputer(req.params.id);
    if (!c) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    res.json({ computer: publicComputer(c) });
  });

  v1.get('/computers/:id/status', requireScope('computers:read'), async (req, res) => {
    const c = await getComputer(req.params.id);
    if (!c) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    try {
      const status = await checkComputerStatus({ mac: c.mac, ip: c.ip });
      const updated = await recordStatus(c.id, status);
      res.json({ status, computer: publicComputer(updated) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  v1.post('/computers/:id/wake', requireScope('computers:control'), async (req, res) => {
    const c = await getComputer(req.params.id);
    if (!c) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    try {
      logger.info('api', 'wake', { id: c.id, mac: c.mac, key: req.apiKey.id });
      await sendMagicPacket(c.mac);
      const updated = await markWoken(c.id);
      res.json({ ok: true, computer: publicComputer(updated) });
    } catch (err) {
      logger.error('api', 'wake 실패', { mac: c.mac, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  v1.post('/computers/:id/shutdown', requireScope('computers:control'), async (req, res) => {
    const c = await getComputer(req.params.id);
    if (!c) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    if (!c.shutdown?.enabled) {
      return res.status(400).json({ error: '이 컴퓨터는 끄기가 비활성화돼 있습니다.' });
    }
    try {
      logger.info('api', 'shutdown', { id: c.id, mac: c.mac, key: req.apiKey.id });
      const result = await shutdownComputer(c);
      res.json(result);
    } catch (err) {
      logger.error('api', 'shutdown 실패', { mac: c.mac, error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // 전원 상태 보고 자동 분기 — 위젯의 단일 버튼용.
  v1.post('/computers/:id/toggle', requireScope('computers:control'), async (req, res) => {
    const c = await getComputer(req.params.id);
    if (!c) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    const lastStatus = c.status;
    try {
      if (lastStatus === 'up') {
        if (!c.shutdown?.enabled) {
          return res.status(400).json({ error: 'shutdown 비활성화 — toggle 불가' });
        }
        logger.info('api', 'toggle→shutdown', { id: c.id, key: req.apiKey.id });
        const result = await shutdownComputer(c);
        return res.json({ action: 'shutdown', ...result });
      }
      logger.info('api', 'toggle→wake', { id: c.id, key: req.apiKey.id });
      await sendMagicPacket(c.mac);
      const updated = await markWoken(c.id);
      res.json({ action: 'wake', ok: true, computer: publicComputer(updated) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use('/api/v1', v1);
}

function scalarHtml(specUrl) {
  const config = {
    url: specUrl,
    theme: 'default',
    layout: 'modern',
    darkMode: true,
    hideClientButton: false,
    metaData: { title: 'ysadmin Public API' },
  };
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8" />
<title>ysadmin Public API</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>body { margin: 0; padding: 0; }</style>
</head>
<body>
<script id="api-reference" type="application/json" data-configuration='${JSON.stringify(config).replace(/'/g, '&#39;')}'></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`;
}

export const publicApiFeature = {
  id: 'public-api',
  label: 'Public API',
  description: '외부 위젯/도구용 API 키 기반 REST. /api/docs 에서 문서.',
  register,
};
