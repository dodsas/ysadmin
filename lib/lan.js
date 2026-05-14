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

async function lookupArpCmd(target) {
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
  const cmd =
    process.platform === 'darwin'
      ? `ping -c 1 -t ${timeoutSec} ${ip}`
      : `ping -c 1 -W ${timeoutSec} ${ip}`;
  try {
    await execp(cmd, { timeout: (timeoutSec + 1) * 1000 });
    return true;
  } catch {
    return false;
  }
}

// 서브넷 ping 스윕 — ARP 캐시 채우기용. WOL_BROADCAST 에서 /24 가정.
async function pingSweep() {
  const m = WOL_BROADCAST.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (!m) {
    logger.warn('lan', 'WOL_BROADCAST 형식 부적합, 스윕 스킵', { WOL_BROADCAST });
    return false;
  }
  const base = m[1];
  const started = Date.now();
  logger.info('lan', `서브넷 ping 스윕 시작 ${base}.1-254`);
  try {
    // -P64 병렬, -W1 1초 타임아웃, stderr/stdout 무시
    await execp(
      `seq 1 254 | xargs -P64 -I_ ping -c1 -W1 ${base}._ >/dev/null 2>&1 || true`,
      { timeout: 10000, shell: '/bin/bash' },
    );
    logger.info('lan', `서브넷 ping 스윕 완료`, { elapsedMs: Date.now() - started });
    return true;
  } catch (err) {
    logger.warn('lan', '서브넷 ping 스윕 오류 (계속 진행)', { error: err.message });
    return false;
  }
}

export async function checkComputerStatus({ mac, ip }) {
  logger.info('lan', `상태확인 시작`, { mac, ip: ip || null });

  // 1) 알려진 IP가 있으면 ping
  if (ip) {
    const alive = await pingHost(ip);
    logger.info('lan', `ping 결과 (${ip})`, { alive });
    if (alive) {
      const arp = await lookupArp(mac);
      return { up: true, ip, macMatched: arp ? arp.ip === ip : null, via: 'ping' };
    }
  }

  // 2) ARP 캐시 1차 조회
  let arp = await lookupArp(mac);
  if (arp) {
    logger.info('lan', `ARP 히트 (1차)`, { mac, ...arp });
    return { up: true, ip: arp.ip, macMatched: true, via: arp.source };
  }
  logger.info('lan', `ARP 1차 미스 — 서브넷 스윕으로 ARP 채우기 시도`, { mac });

  // 3) 서브넷 스윕 후 ARP 재조회
  await pingSweep();
  arp = await lookupArp(mac);
  if (arp) {
    logger.info('lan', `ARP 히트 (스윕 후)`, { mac, ...arp });
    return { up: true, ip: arp.ip, macMatched: true, via: `${arp.source} (after sweep)` };
  }

  logger.warn('lan', `상태확인 결과: 오프라인 (또는 LAN 미도달)`, { mac, ip: ip || null });
  return { up: false };
}
