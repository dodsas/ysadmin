import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const execp = promisify(exec);

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

// Look up a MAC address in the host's neighbor/ARP table.
// Returns { ip } when found, or null. Cache only — does not trigger discovery.
async function lookupArp(mac) {
  const target = normalizeMac(mac);

  // Linux: /proc/net/arp (works inside containers with host network mode)
  try {
    const arp = await readFile('/proc/net/arp', 'utf8');
    const lines = arp.split('\n').slice(1);
    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const lanMac = cols[3].replace(/:/g, '').toLowerCase();
      if (lanMac === target && lanMac !== '000000000000') {
        return { ip: cols[0] };
      }
    }
  } catch {
    /* fall through */
  }

  // Linux: ip neigh (more complete than /proc/net/arp)
  try {
    const { stdout } = await execp('ip neigh show', { timeout: 3000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/^([\d.]+)\s+.*lladdr\s+([0-9a-f:]+)/i);
      if (!m) continue;
      const lineMac = m[2].replace(/:/g, '').toLowerCase();
      if (lineMac === target) return { ip: m[1] };
    }
  } catch {
    /* fall through */
  }

  // macOS / BSD: arp -an
  try {
    const { stdout } = await execp('arp -an', { timeout: 3000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/\(([\d.]+)\)\s+at\s+([0-9a-fA-F:]+)/);
      if (!m) continue;
      const lineMac = padMacBytes(m[2]);
      if (lineMac === target) return { ip: m[1] };
    }
  } catch {
    /* fall through */
  }

  return null;
}

async function pingHost(ip) {
  // -c 1: 1 packet, -W 1: 1s timeout (Linux). macOS uses -W in ms but we run in Linux container in prod.
  const cmd = process.platform === 'darwin'
    ? `ping -c 1 -t 1 ${ip}`
    : `ping -c 1 -W 1 ${ip}`;
  try {
    await execp(cmd, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

// Check whether the given computer (by mac + optional known ip) is online.
// - If known IP: ping it. If reachable, confirm MAC via ARP cache.
// - Else: look up MAC in ARP cache (only works if host has talked to it recently).
export async function checkComputerStatus({ mac, ip }) {
  if (ip) {
    const alive = await pingHost(ip);
    if (alive) {
      const arp = await lookupArp(mac);
      return { up: true, ip, macMatched: arp ? arp.ip === ip : null };
    }
  }
  const arp = await lookupArp(mac);
  if (arp) return { up: true, ip: arp.ip, macMatched: true };
  return { up: false };
}
