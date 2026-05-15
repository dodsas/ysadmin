import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getTabOrder, setTabOrder } from './lib/tabs.js';
import { logger } from './lib/logger.js';
import {
  isInitialized,
  setupCredentials,
  verifyCredentials,
  createSession,
  getSession,
  deleteSession,
  getSessionDurationMs,
} from './lib/auth.js';
import {
  features,
  registerFeatures,
  startFeatureSchedulers,
} from './features/index.js';
import { listApiKeys, createApiKey, revokeApiKey } from './lib/api-keys.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5566);
const VERSION = process.env.IMAGE_TAG || `dev-${Date.now()}`;
const SESSION_COOKIE = 'ys_session';

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function setSessionCookie(res, token, remember) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (remember) {
    parts.push(`Max-Age=${Math.floor(getSessionDurationMs() / 1000)}`);
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

app.get('/api/auth/state', async (req, res) => {
  const initialized = await isInitialized();
  const cookies = parseCookies(req);
  const session = await getSession(cookies[SESSION_COOKIE]);
  res.json({
    initialized,
    authenticated: Boolean(session),
    username: session ? session.username : null,
  });
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    if (await isInitialized()) {
      return res.status(409).json({ error: '이미 초기 설정이 완료되어 있습니다.' });
    }
    const { username, password, remember } = req.body || {};
    const { username: u } = await setupCredentials({ username, password });
    const session = await createSession({ username: u, remember });
    setSessionCookie(res, session.token, Boolean(remember));
    res.status(201).json({ ok: true, username: u });
  } catch (err) {
    const status = err.code === 'ALREADY_INITIALIZED' ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!(await isInitialized())) {
    return res.status(409).json({ error: '초기 설정이 필요합니다.' });
  }
  const { username, password, remember } = req.body || {};
  const ok = await verifyCredentials({ username, password });
  if (!ok) {
    logger.warn('auth', '로그인 실패', { username: String(username ?? '').trim() });
    return res.status(401).json({ error: '아이디 또는 비밀번호가 일치하지 않습니다.' });
  }
  const u = String(username).trim();
  const session = await createSession({ username: u, remember });
  setSessionCookie(res, session.token, Boolean(remember));
  logger.info('auth', '로그인 성공', { username: u, remember: Boolean(remember) });
  res.json({ ok: true, username: u });
});

app.post('/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    await deleteSession(token);
    logger.info('auth', '로그아웃', {});
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

const PUBLIC_API_PATHS = new Set([
  '/api/auth/state',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health',
  '/api/version',
  '/api/version/stream',
  '/api/features',
  '/api/docs',
  '/api/v1/openapi.json',
]);

// 세션 쿠키 대신 자체 인증을 쓰는 경로 prefix — public-api 의 Bearer 토큰.
const SELF_AUTHED_PREFIXES = ['/api/v1/'];

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (SELF_AUTHED_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  const cookies = parseCookies(req);
  const session = await getSession(cookies[SESSION_COOKIE]);
  if (!session) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  req.session = session;
  next();
});

// 각 feature 가 자신의 API 라우트를 등록한다.
registerFeatures(app);

// feature 매니페스트 — 프론트엔드가 어떤 feature 가 활성화돼 있는지 조회.
app.get('/api/features', (_req, res) => {
  res.json({
    features: features.map((f) => ({
      id: f.id,
      label: f.label,
      description: f.description || '',
    })),
  });
});

app.get('/api/admin/api-keys', async (_req, res) => {
  try {
    const keys = await listApiKeys();
    res.json({ keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/api-keys', async (req, res) => {
  try {
    const { label, scopes } = req.body || {};
    const { key, entry } = await createApiKey({ label, scopes });
    logger.info('admin', 'API 키 발급', { id: entry.id, label: entry.label });
    res.status(201).json({ key, entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/api-keys/:id', async (req, res) => {
  const ok = await revokeApiKey(req.params.id);
  if (!ok) return res.status(404).json({ error: '키를 찾을 수 없습니다.' });
  logger.info('admin', 'API 키 폐기', { id: req.params.id });
  res.status(204).end();
});

app.get('/api/tabs/order', async (_req, res) => {
  try {
    const order = await getTabOrder();
    res.json({ order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tabs/order', async (req, res) => {
  try {
    const order = await setTabOrder(req.body?.order);
    res.json({ order });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/version', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json({ version: VERSION });
});

// SSE 버전 스트림 — 클라이언트는 EventSource 로 구독.
// 같은 프로세스가 살아있는 동안 VERSION 은 불변이라 첫 연결 시 1회만 보내고
// heartbeat 으로 연결만 유지. 컨테이너 재시작 → 연결 끊김 → EventSource 자동
// 재연결 → 새 VERSION 수신 → 클라이언트가 배너 표시.
const SSE_HEARTBEAT_MS = 60_000;
app.get('/api/version/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.write(`event: version\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
  const hb = setInterval(() => {
    try {
      res.write(': hb\n\n');
    } catch {
      /* connection already closed */
    }
  }, SSE_HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(hb);
  });
});

app.listen(PORT, () => {
  logger.info('server', '시작', {
    port: PORT,
    version: VERSION,
    features: features.map((f) => f.id),
  });
  console.log(`[server] listening on http://localhost:${PORT} (version=${VERSION})`);
  console.log(`[server] features: ${features.map((f) => `${f.id}(${f.label})`).join(', ')}`);
  startFeatureSchedulers();
});
