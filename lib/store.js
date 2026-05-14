import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = resolve(process.cwd(), 'data');
const DATA_FILE = resolve(DATA_DIR, 'targets.json');

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
      cache = [];
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
    console.error('[store] persist failed:', err);
  });
  return writeQueue;
}

export async function listTargets() {
  await ensureLoaded();
  return cache.map((t) => ({ ...t }));
}

export async function addTarget({ url, label }) {
  await ensureLoaded();
  const normalized = normalizeUrl(url);
  const exists = cache.find((t) => t.url === normalized);
  if (exists) {
    const err = new Error('이미 등록된 URL입니다.');
    err.code = 'DUPLICATE';
    throw err;
  }
  const target = {
    id: randomUUID(),
    url: normalized,
    label: (label && String(label).trim()) || hostnameOf(normalized),
    createdAt: new Date().toISOString(),
    status: 'unknown',
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastError: null,
    lastStatusCode: null,
  };
  cache.push(target);
  await enqueueWrite();
  return { ...target };
}

export async function removeTarget(id) {
  await ensureLoaded();
  const idx = cache.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  cache.splice(idx, 1);
  await enqueueWrite();
  return true;
}

export async function updateTargetStatus(id, patch) {
  await ensureLoaded();
  const target = cache.find((t) => t.id === id);
  if (!target) return null;
  Object.assign(target, patch);
  await enqueueWrite();
  return { ...target };
}

export async function getTarget(id) {
  await ensureLoaded();
  const target = cache.find((t) => t.id === id);
  return target ? { ...target } : null;
}

export async function reorderTargets(orderedIds) {
  await ensureLoaded();
  if (!Array.isArray(orderedIds)) {
    throw new Error('순서는 ID 배열이어야 합니다.');
  }
  const byId = new Map(cache.map((t) => [t.id, t]));
  const seen = new Set();
  const next = [];
  for (const id of orderedIds) {
    const t = byId.get(id);
    if (!t || seen.has(id)) continue;
    next.push(t);
    seen.add(id);
  }
  for (const t of cache) {
    if (!seen.has(t.id)) next.push(t);
  }
  cache = next;
  await enqueueWrite();
  return cache.map((t) => ({ ...t }));
}

function normalizeUrl(input) {
  if (typeof input !== 'string') throw new Error('URL은 문자열이어야 합니다.');
  const trimmed = input.trim();
  if (!trimmed) throw new Error('URL이 비어 있습니다.');
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  const u = new URL(candidate);
  return u.toString().replace(/\/$/, '');
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
