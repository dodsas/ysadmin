import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { listTargets, addTarget, removeTarget, getTarget, reorderTargets } from './lib/store.js';
import { startScheduler, checkTarget } from './lib/pinger.js';
import {
  listComputers,
  addComputer,
  removeComputer,
  getComputer,
  markWoken,
  reorderComputers,
  updateComputer,
  recordStatus,
} from './lib/computers.js';
import { sendMagicPacket } from './lib/wol.js';
import { checkComputerStatus } from './lib/lan.js';
import { logger } from './lib/logger.js';
import { startComputerPoller, triggerCheckAll } from './lib/computer-poller.js';
import { shutdownComputer } from './lib/shutdown.js';
import {
  isInitialized,
  setupCredentials,
  verifyCredentials,
  createSession,
  getSession,
  deleteSession,
  getSessionDurationMs,
} from './lib/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 6666);
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
]);

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  const cookies = parseCookies(req);
  const session = await getSession(cookies[SESSION_COOKIE]);
  if (!session) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  req.session = session;
  next();
});

app.get('/api/targets', async (_req, res) => {
  const targets = await listTargets();
  res.json({ targets });
});

app.post('/api/targets', async (req, res) => {
  try {
    const target = await addTarget({ url: req.body?.url, label: req.body?.label });
    checkTarget(target).catch((err) => console.error('[server] initial check failed:', err));
    res.status(201).json({ target });
  } catch (err) {
    const status = err.code === 'DUPLICATE' ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/targets/:id', async (req, res) => {
  const ok = await removeTarget(req.params.id);
  if (!ok) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
  res.status(204).end();
});

app.put('/api/targets/order', async (req, res) => {
  try {
    const order = req.body?.order;
    const targets = await reorderTargets(order);
    res.json({ targets });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/targets/:id/check', async (req, res) => {
  const target = await getTarget(req.params.id);
  if (!target) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
  const updated = await checkTarget(target);
  res.json({ target: updated });
});

app.get('/api/computers', async (_req, res) => {
  const computers = await listComputers();
  res.json({ computers });
});

app.post('/api/computers', async (req, res) => {
  try {
    const computer = await addComputer({ mac: req.body?.mac, label: req.body?.label });
    res.status(201).json({ computer });
  } catch (err) {
    const status = err.code === 'DUPLICATE' ? 409 : 400;
    res.status(status).json({ error: err.message });
  }
});

app.delete('/api/computers/:id', async (req, res) => {
  const ok = await removeComputer(req.params.id);
  if (!ok) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
  res.status(204).end();
});

app.put('/api/computers/order', async (req, res) => {
  try {
    const order = req.body?.order;
    const computers = await reorderComputers(order);
    res.json({ computers });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/computers/:id/wake', async (req, res) => {
  const computer = await getComputer(req.params.id);
  if (!computer) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
  try {
    logger.info('wol', `매직 패킷 전송 시도`, { id: computer.id, mac: computer.mac, label: computer.label });
    await sendMagicPacket(computer.mac);
    const updated = await markWoken(computer.id);
    logger.info('wol', `매직 패킷 전송 완료`, { mac: computer.mac });
    res.json({ computer: updated });
  } catch (err) {
    logger.error('wol', `매직 패킷 전송 실패`, { mac: computer.mac, error: err.message });
    res.status(500).json({ error: `매직 패킷 전송 실패: ${err.message}` });
  }
});

app.get('/api/computers/:id/status', async (req, res) => {
  const computer = await getComputer(req.params.id);
  if (!computer) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
  try {
    const status = await checkComputerStatus({ mac: computer.mac, ip: computer.ip });
    const updated = await recordStatus(computer.id, status);
    res.json({ status, computer: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/computers/check-all', async (_req, res) => {
  const result = await triggerCheckAll('tab-entry');
  res.json(result);
});

app.patch('/api/computers/:id', async (req, res) => {
  try {
    const updated = await updateComputer(req.params.id, {
      label: req.body?.label,
      ip: req.body?.ip,
      os: req.body?.os,
      shutdown: req.body?.shutdown,
    });
    if (!updated) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    res.json({ computer: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/computers/:id/shutdown', async (req, res) => {
  const computer = await getComputer(req.params.id);
  if (!computer) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
  try {
    const result = await shutdownComputer(computer);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
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

app.listen(PORT, () => {
  logger.info('server', `시작`, { port: PORT, version: VERSION });
  console.log(`[server] listening on http://localhost:${PORT} (version=${VERSION})`);
  startScheduler();
  startComputerPoller();
});
