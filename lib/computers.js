import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeMac } from './wol.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const DATA_FILE = resolve(DATA_DIR, 'computers.json');

const SEED = [
  { mac: 'D0-88-0C-6F-99-B1', label: '맥북에어', os: 'macos' },
  { mac: '08-BF-B8-13-11-95', label: 'MAIN', os: 'windows' },
  { mac: 'A8-5E-45-E1-E5-B4', label: 'SUB', os: 'windows' },
  { mac: '90-2E-1C-3B-C3-79', label: 'N100', os: 'windows' },
  { mac: '58-86-94-09-00-8D', label: '쭈니메인컴', os: 'windows' },
];

function defaultShutdownCommand(os) {
  if (os === 'windows') return 'shutdown /s /t 0 /f';
  return 'sudo shutdown -h now'; // macos / linux 공통
}

let cache = null;
let writeQueue = Promise.resolve();

function applyDefaults(c) {
  if (!c.os) c.os = 'unknown';
  if (!c.shutdown) {
    c.shutdown = {
      enabled: false,
      sshUser: null,
      sshPort: 22,
      sshPassword: '',
      command: defaultShutdownCommand(c.os),
    };
  } else if (c.shutdown.sshPassword === undefined) {
    c.shutdown.sshPassword = '';
  }
  return c;
}

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    cache = JSON.parse(raw);
    if (!Array.isArray(cache)) cache = [];
    cache.forEach(applyDefaults);
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = SEED.map((s) => ({
        id: randomUUID(),
        mac: normalizeMac(s.mac),
        label: s.label,
        ip: null,
        os: s.os || 'unknown',
        createdAt: new Date().toISOString(),
        lastWakeAt: null,
        lastStatus: 'unknown',
        lastStatusAt: null,
        lastSeenIp: null,
        shutdown: {
          enabled: false,
          sshUser: null,
          sshPort: 22,
          sshPassword: '',
          command: defaultShutdownCommand(s.os),
        },
      }));
      await persist();
    } else {
      throw err;
    }
  }
  return cache;
}

async function persist() {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function enqueueWrite() {
  writeQueue = writeQueue.then(persist).catch((err) => {
    console.error('[computers] persist failed:', err);
  });
  return writeQueue;
}

// hot path — 5초 폴링으로 매 호출됨. 예전엔 cache.map(c => ({...c})) 로 매번
// 모든 항목을 얕은 복사했는데, 호출자(전부 read-only: JSON 직렬화 또는 map 후
// 직렬화) 가 mutate 하지 않으므로 raw cache 를 그대로 반환. JSON.stringify 는
// 동기라 mutate 와 인터리브되지 않음.
export async function listComputers() {
  await ensureLoaded();
  return cache;
}

export async function getComputer(id) {
  await ensureLoaded();
  const c = cache.find((x) => x.id === id);
  return c ? { ...c } : null;
}

export async function addComputer({ mac, label, ip }) {
  await ensureLoaded();
  const normalized = normalizeMac(mac);
  if (cache.find((c) => c.mac === normalized)) {
    const err = new Error('이미 등록된 MAC입니다.');
    err.code = 'DUPLICATE';
    throw err;
  }
  const computer = {
    id: randomUUID(),
    mac: normalized,
    label: (label && String(label).trim()) || normalized,
    ip: (ip && String(ip).trim()) || null,
    createdAt: new Date().toISOString(),
    lastWakeAt: null,
    lastStatus: 'unknown',
    lastStatusAt: null,
    lastSeenIp: null,
  };
  cache.push(computer);
  await enqueueWrite();
  return { ...computer };
}

export async function updateComputer(id, patch) {
  await ensureLoaded();
  const c = cache.find((x) => x.id === id);
  if (!c) return null;
  if (patch.label !== undefined) c.label = String(patch.label).trim() || c.label;
  if (patch.ip !== undefined) c.ip = patch.ip ? String(patch.ip).trim() : null;
  if (patch.os !== undefined) c.os = patch.os;
  if (patch.shutdown !== undefined) {
    const s = patch.shutdown || {};
    c.shutdown = {
      enabled: Boolean(s.enabled),
      sshUser: s.sshUser ? String(s.sshUser).trim() : null,
      sshPort: Number(s.sshPort) || 22,
      sshPassword: typeof s.sshPassword === 'string' ? s.sshPassword : (c.shutdown?.sshPassword || ''),
      command: s.command ? String(s.command) : defaultShutdownCommand(c.os),
    };
  }
  await enqueueWrite();
  return { ...c };
}

export async function removeComputer(id) {
  await ensureLoaded();
  const idx = cache.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  cache.splice(idx, 1);
  await enqueueWrite();
  return true;
}

export async function markWoken(id) {
  await ensureLoaded();
  const c = cache.find((x) => x.id === id);
  if (!c) return null;
  c.lastWakeAt = new Date().toISOString();
  await enqueueWrite();
  return { ...c };
}

export async function recordStatus(id, status) {
  await ensureLoaded();
  const c = cache.find((x) => x.id === id);
  if (!c) return null;
  c.lastStatus = status.up ? 'up' : 'down';
  c.lastStatusAt = new Date().toISOString();
  if (status.ip) c.lastSeenIp = status.ip;
  await enqueueWrite();
  return { ...c };
}

export async function reorderComputers(orderedIds) {
  await ensureLoaded();
  if (!Array.isArray(orderedIds)) {
    throw new Error('순서는 ID 배열이어야 합니다.');
  }
  const byId = new Map(cache.map((c) => [c.id, c]));
  const seen = new Set();
  const next = [];
  for (const id of orderedIds) {
    const c = byId.get(id);
    if (!c || seen.has(id)) continue;
    next.push(c);
    seen.add(id);
  }
  for (const c of cache) {
    if (!seen.has(c.id)) next.push(c);
  }
  cache = next;
  await enqueueWrite();
  return cache.map((c) => ({ ...c }));
}
