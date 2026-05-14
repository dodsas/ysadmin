import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { logger } from './logger.js';

const execp = promisify(exec);

const WOL_BROADCAST = process.env.WOL_BROADCAST || '255.255.255.255';

function normalizeMac(mac) {
  return mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function padMacBytes(macStr) {
  return macStr
    .split(':')
    .map((p) => p.padStart(2, '0'))
    .join('')
    .toLowerCase();
}

async function lookupArpProcFile(target) {
  if (process.platform !== 'linux') return null;
  try {
    const arp = await readFile('/proc/net/arp', 'utf8');
    const lines = arp.split('\n').slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const lanMac = cols[3].replace(/:/g, '').toLowerCase();
      if (lanMac === target && lanMac !== '000000000000') {
        return { ip: cols[0], source: '/proc/net/arp' };
      }
    }
  } catch (err) {
    logger.debug('lan', '/proc/net/arp 읽기 실패', { error: err.message });
  }
  return null;
}

async function lookupIpNeigh(target) {
  if (process.platform === 'win32') return null;
  try {
    const { stdout } = await execp('ip neigh show', { timeout: 3000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/^([\d.]+)\s+.*lladdr\s+([0-9a-f:]+)/i);
      if (!m) continue;
      const lineMac = m[2].replace(/:/g, '').toLowerCase();
      if (lineMac === target) return { ip: m[1], source: 'ip neigh' };
    }
  } catch (err) {
    logger.debug('lan', 'ip neigh 실행 실패', { error: err.message });
  }
  return null;
}

async function lookupArpWindows(target) {
  try {
    const { stdout } = await execp('arp -a', { timeout: 3000, encoding: 'buffer' });
    const text = stdout.toString('latin1');
    for (const line of text.split('\n')) {
      const m = line.match(/\s([\d.]+)\s+([0-9a-fA-F-]{17})\s+/);
      if (!m) continue;
      const lineMac = m[2].replace(/-/g, '').toLowerCase();
      if (lineMac === target) return { ip: m[1], source: 'arp -a (win)' };
    }
  } catch (err) {
    logger.debug('lan', 'arp -a 실행 실패 (win)', { code: err.code, signal: err.signal });
  }
  return null;
}

async function lookupArpCmd(target) {
  if (process.platform === 'win32') return lookupArpWindows(target);
  try {
    const { stdout } = await execp('arp -an', { timeout: 3000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]+)/);
      if (!m) continue;
      const lineMac = padMacBytes(m[2]);
      if (lineMac === target) return { ip: m[1], source: 'arp -an' };
    }
  } catch (err) {
    logger.debug('lan', 'arp -an 실행 실패', { error: err.message });
  }
  return null;
}

async function lookupArp(mac) {
  const target = normalizeMac(mac);
  return (
    (await lookupArpProcFile(target)) ||
    (await lookupIpNeigh(target)) ||
    (await lookupArpCmd(target))
  );
}

async function pingHost(ip, timeoutSec = 1) {
  let cmd;
  if (process.platform === 'win32') {
    cmd = `ping -n 1 -w ${timeoutSec * 1000} ${ip}`;
  } else if (process.platform === 'darwin') {
    cmd = `ping -c 1 -t ${timeoutSec} ${ip}`;
  } else {
    cmd = `ping -c 1 -W ${timeoutSec} ${ip}`;
  }
  try {
    const { stdout } = await execp(cmd, {
      timeout: (timeoutSec + 1) * 1000,
      encoding: process.platform === 'win32' ? 'buffer' : 'utf8',
    });
    if (process.platform === 'win32') {
      const text = stdout.toString('latin1');
      if (/TTL=|ttl=/i.test(text)) return true;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// 서브넷 ping 스윕 — ARP 캐시 채우기용. WOL_BROADCAST 에서 /24 가정.
// Node 자체 동시성으로 동작 (셸 파이프라인 의존 없음 → Alpine 컨테이너에서도 작동)
async function pingSweep() {
  const m = WOL_BROADCAST.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (!m) {
    logger.warn('lan', 'WOL_BROADCAST 형식 부적합, 스윕 스킵', { WOL_BROADCAST });
    return false;
  }
  const base = m[1];
  const started = Date.now();
  logger.info('lan', `서브넷 ping 스윕 시작 ${base}.1-254`);

  const queue = [];
  for (let i = 1; i <= 254; i++) queue.push(`${base}.${i}`);

  const concurrency = 64;
  let hits = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const ip = queue.shift();
      if (!ip) break;
      if (await pingHost(ip, 1)) hits++;
    }
  });
  await Promise.all(workers);

  logger.info('lan', `서브넷 ping 스윕 완료`, { elapsedMs: Date.now() - started, hits });
  return true;
}

const PING_TIMEOUT_SEC = Number(process.env.PING_TIMEOUT_SEC || 2);

export async function checkComputerStatus({ mac, ip }) {
  logger.info('lan', `상태확인 시작`, { mac, ip: ip || null });

  // 1) 알려진 IP가 있으면 ping 으로 직접 검증 (ARP 캐시 무시)
  if (ip) {
    const alive = await pingHost(ip, PING_TIMEOUT_SEC);
    logger.info('lan', `ping 결과 (${ip})`, { alive });
    if (alive) return { up: true, ip, via: 'ping(known-ip)' };
    return { up: false, ip, via: 'ping-failed(known-ip)' };
  }

  // 2) ARP 캐시 1차 조회 — hit 해도 ping 으로 검증 (캐시는 stale 일 수 있음)
  let arp = await lookupArp(mac);
  if (arp) {
    logger.info('lan', `ARP 히트 (1차) — ping 검증`, { mac, ...arp });
    const alive = await pingHost(arp.ip, PING_TIMEOUT_SEC);
    if (alive) {
      logger.info('lan', `ping 검증 성공`, { ip: arp.ip });
      return { up: true, ip: arp.ip, macMatched: true, via: `${arp.source}+ping` };
    }
    logger.info('lan', `ARP 히트 — 그러나 ping 응답 없음 (stale 캐시로 판단, 오프라인)`, {
      mac,
      ip: arp.ip,
    });
    return { up: false, ip: arp.ip, via: 'arp-stale' };
  }
  logger.info('lan', `ARP 1차 미스 — 서브넷 스윕으로 ARP 채우기 시도`, { mac });

  // 3) 서브넷 스윕 후 ARP 재조회 (스윕에서 응답한 호스트만 등록됨 — ping 검증 한 번 더)
  await pingSweep();
  arp = await lookupArp(mac);
  if (arp) {
    logger.info('lan', `ARP 히트 (스윕 후) — ping 검증`, { mac, ...arp });
    const alive = await pingHost(arp.ip, PING_TIMEOUT_SEC);
    if (alive) {
      logger.info('lan', `ping 검증 성공 (스윕 후)`, { ip: arp.ip });
      return { up: true, ip: arp.ip, macMatched: true, via: `${arp.source} (after sweep)+ping` };
    }
    logger.info('lan', `ARP 히트 (스윕 후) — ping 응답 없음, 오프라인`, { mac, ip: arp.ip });
    return { up: false, ip: arp.ip, via: 'arp-after-sweep-stale' };
  }

  logger.warn('lan', `상태확인 결과: 오프라인 (또는 LAN 미도달)`, { mac, ip: ip || null });
  return { up: false };
}
