import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
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
  const detail = await pingHostDetailed(ip, timeoutSec);
  return detail.alive;
}

async function pingHostDetailed(ip, timeoutSec = 1) {
  let cmd;
  if (process.platform === 'win32') {
    cmd = `ping -n 1 -w ${timeoutSec * 1000} ${ip}`;
  } else if (process.platform === 'darwin') {
    cmd = `ping -c 1 -t ${timeoutSec} ${ip}`;
  } else {
    cmd = `ping -c 1 -W ${timeoutSec} ${ip}`;
  }
  const started = Date.now();
  try {
    const { stdout, stderr } = await execp(cmd, {
      timeout: (timeoutSec + 1) * 1000,
      encoding: process.platform === 'win32' ? 'buffer' : 'utf8',
    });
    const elapsedMs = Date.now() - started;
    const outText = process.platform === 'win32' ? stdout.toString('latin1') : stdout;
    const errText = process.platform === 'win32' ? (stderr ? stderr.toString('latin1') : '') : stderr || '';
    let alive;
    if (process.platform === 'win32') {
      alive = /TTL=|ttl=/i.test(outText);
    } else {
      alive = / bytes from |time=|ttl=/i.test(outText);
    }
    return { alive, cmd, exitCode: 0, stdout: outText.slice(0, 600), stderr: errText.slice(0, 300), elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    const errStdout = err.stdout ? (Buffer.isBuffer(err.stdout) ? err.stdout.toString('latin1') : String(err.stdout)) : '';
    const errStderr = err.stderr ? (Buffer.isBuffer(err.stderr) ? err.stderr.toString('latin1') : String(err.stderr)) : '';
    return {
      alive: false,
      cmd,
      exitCode: err.code ?? null,
      signal: err.signal ?? null,
      stdout: errStdout.slice(0, 600),
      stderr: errStderr.slice(0, 300),
      elapsedMs,
      timedOut: err.killed === true,
    };
  }
}

function probeTcp(ip, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ port, ...result, elapsedMs: Date.now() - started });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish({ state: 'open' }));
    sock.once('timeout', () => finish({ state: 'timeout' }));
    sock.once('error', (err) => {
      const code = err.code || 'ERR';
      let state = 'error';
      if (code === 'ECONNREFUSED') state = 'refused';
      else if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') state = 'unreachable';
      else if (code === 'ETIMEDOUT') state = 'timeout';
      finish({ state, code });
    });
    try {
      sock.connect(port, ip);
    } catch (err) {
      finish({ state: 'error', code: err.code || 'EXC' });
    }
  });
}

async function probeCommonWindowsPorts(ip) {
  const ports = [135, 139, 445, 3389];
  const results = await Promise.all(ports.map((p) => probeTcp(ip, p, 1500)));
  return results;
}

async function snapshotArpForIp(ip) {
  try {
    if (process.platform === 'linux') {
      const arp = await readFile('/proc/net/arp', 'utf8');
      const lines = arp.split('\n').slice(1);
      for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 4) continue;
        if (cols[0] === ip) {
          return { source: '/proc/net/arp', ip: cols[0], hwType: cols[1], flags: cols[2], mac: cols[3], device: cols[5] || null };
        }
      }
      return { source: '/proc/net/arp', present: false };
    }
    if (process.platform === 'win32') {
      const { stdout } = await execp('arp -a', { timeout: 3000, encoding: 'buffer' });
      const text = stdout.toString('latin1');
      for (const line of text.split('\n')) {
        const m = line.match(/\s([\d.]+)\s+([0-9a-fA-F-]{17})\s+(\S+)/);
        if (m && m[1] === ip) return { source: 'arp -a (win)', ip: m[1], mac: m[2], type: m[3] };
      }
      return { source: 'arp -a (win)', present: false };
    }
    const { stdout } = await execp('arp -an', { timeout: 3000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]+|incomplete)/);
      if (m && m[1] === ip) return { source: 'arp -an', ip: m[1], mac: m[2] };
    }
    return { source: 'arp -an', present: false };
  } catch (err) {
    return { error: err.message };
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
    const pingDetail = await pingHostDetailed(ip, PING_TIMEOUT_SEC);
    logger.info('lan', `ping 결과 (${ip})`, {
      alive: pingDetail.alive,
      cmd: pingDetail.cmd,
      exitCode: pingDetail.exitCode,
      signal: pingDetail.signal || null,
      timedOut: pingDetail.timedOut || false,
      elapsedMs: pingDetail.elapsedMs,
      stdout: pingDetail.stdout,
      stderr: pingDetail.stderr,
    });
    if (pingDetail.alive) return { up: true, ip, via: 'ping(known-ip)' };

    // 진단 보조: ping 실패 시 ARP 스냅샷 + TCP 노크 결과를 같이 남김
    const arpAfter = await snapshotArpForIp(ip);
    logger.info('lan', `진단 — ARP 스냅샷 (ping 실패 후, ${ip})`, arpAfter);
    const tcpResults = await probeCommonWindowsPorts(ip);
    const anyResponsive = tcpResults.some((r) => r.state === 'open' || r.state === 'refused');
    logger.info('lan', `진단 — TCP 노크 (${ip})`, { ports: tcpResults, anyResponsive });

    return {
      up: false,
      ip,
      via: 'ping-failed(known-ip)',
      diag: { arp: arpAfter, tcp: tcpResults, anyResponsive },
    };
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
