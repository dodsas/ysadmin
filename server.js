import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { listTargets, addTarget, removeTarget, getTarget, reorderTargets } from './lib/store.js';
import { startScheduler, checkTarget } from './lib/pinger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 6666);

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  startScheduler();
});
