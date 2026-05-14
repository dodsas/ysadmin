import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeMac } from './wol.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const DATA_FILE = resolve(DATA_DIR, 'computers.json');

const SEED = [
  { mac: 'D0-88-0C-6F-99-B1', label: '맥북에어' },
  { mac: '08-BF-B8-13-11-95', label: 'MAIN' },
  { mac: 'A8-5E-45-E1-E5-B4', label: 'SUB' },
  { mac: '90-2E-1C-3B-C3-79', label: 'N100' },
  { mac: '58-86-94-09-00-8D', label: '쭈니메인컴' },
];

let cache = null;
let writeQueue = Promise.resolve();

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    cache = JSON.parse(raw);
    if (!Array.isArray(cache)) cache = [];
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = SEED.map((s) => ({
        id: randomUUID(),
        mac: normalizeMac(s.mac),
        label: s.label,
        ip: null,
        createdAt: new Date().toISOString(),
        lastWakeAt: null,
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

export async function listComputers() {
  await ensureLoaded();
  return cache.map((c) => ({ ...c }));
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
