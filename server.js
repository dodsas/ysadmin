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
} from './lib/computers.js';
import { sendMagicPacket } from './lib/wol.js';
import { checkComputerStatus } from './lib/lan.js';
import { logger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 6666);
const VERSION = process.env.IMAGE_TAG || `dev-${Date.now()}`;

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

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
    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/computers/:id', async (req, res) => {
  try {
    const updated = await updateComputer(req.params.id, {
      label: req.body?.label,
      ip: req.body?.ip,
    });
    if (!updated) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    res.json({ computer: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.get('/api/version', (_req, res) => {
  res.json({ version: VERSION });
});

app.listen(PORT, () => {
  logger.info('server', `시작`, { port: PORT, version: VERSION });
  console.log(`[server] listening on http://localhost:${PORT} (version=${VERSION})`);
  startScheduler();
});
