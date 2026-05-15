// 피씨 feature — 컴퓨터 원격 켜기/끄기 (WoL + SSH shutdown)
import {
  listComputers,
  addComputer,
  removeComputer,
  getComputer,
  markWoken,
  reorderComputers,
  updateComputer,
  recordStatus,
} from '../lib/computers.js';
import { sendMagicPacket } from '../lib/wol.js';
import { checkComputerStatus } from '../lib/lan.js';
import { startComputerPoller, triggerCheckAll } from '../lib/computer-poller.js';
import { shutdownComputer } from '../lib/shutdown.js';
import { logger } from '../lib/logger.js';

function register(app) {
  app.get('/api/computers', async (_req, res) => {
    const computers = await listComputers();
    res.json({ computers });
  });

  app.post('/api/computers', async (req, res) => {
    try {
      const computer = await addComputer({
        mac: req.body?.mac,
        label: req.body?.label,
        ip: req.body?.ip,
      });
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
      const computers = await reorderComputers(req.body?.order);
      res.json({ computers });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/computers/:id/wake', async (req, res) => {
    const computer = await getComputer(req.params.id);
    if (!computer) return res.status(404).json({ error: '컴퓨터를 찾을 수 없습니다.' });
    try {
      logger.info('wol', '매직 패킷 전송 시도', {
        id: computer.id,
        mac: computer.mac,
        label: computer.label,
      });
      await sendMagicPacket(computer.mac);
      const updated = await markWoken(computer.id);
      logger.info('wol', '매직 패킷 전송 완료', { mac: computer.mac });
      res.json({ computer: updated });
    } catch (err) {
      logger.error('wol', '매직 패킷 전송 실패', {
        mac: computer.mac,
        error: err.message,
      });
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
}

export const pcFeature = {
  id: 'computers',
  label: '피씨',
  description: '컴퓨터 원격 켜기/끄기 (Wake-on-LAN + SSH shutdown)',
  register,
  startSchedulers: startComputerPoller,
};
