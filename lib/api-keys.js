// 외부(아이폰 위젯 등) 호출용 API 키 관리.
// 평문 키는 발급 직후 1회만 노출, 저장은 sha256 해시만.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const DATA_DIR = resolve(process.cwd(), 'data');
const DATA_FILE = resolve(DATA_DIR, 'api-keys.json');
const KEY_PREFIX = 'ysa_';

let cache = null;
let writeQueue = Promise.resolve();

async function ensureLoaded() {
  if (cache) return cache;
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    cache = JSON.parse(raw);
    if (!Array.isArray(cache)) cache = [];
  } catch (err) {
    if (err.code === 'ENOENT') cache = [];
    else throw err;
  }
  return cache;
}

async function persist() {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function enqueueWrite() {
  writeQueue = writeQueue.then(persist).catch((err) => {
    console.error('[api-keys] persist failed:', err);
  });
  return writeQueue;
}

function hashKey(raw) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export async function listApiKeys() {
  await ensureLoaded();
  return cache.map(({ hash, ...rest }) => rest);
}

export async function createApiKey({ label, scopes }) {
  await ensureLoaded();
  const rawSuffix = randomBytes(24).toString('base64url');
  const raw = `${KEY_PREFIX}${rawSuffix}`;
  const entry = {
    id: randomBytes(8).toString('hex'),
    label: String(label || '').trim() || '이름없음',
    scopes: Array.isArray(scopes) && scopes.length ? scopes : ['computers:read', 'computers:control'],
    hint: `${raw.slice(0, 8)}…${raw.slice(-4)}`,
    hash: hashKey(raw),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  cache.push(entry);
  await enqueueWrite();
  const { hash, ...safe } = entry;
  return { key: raw, entry: safe };
}

export async function revokeApiKey(id) {
  await ensureLoaded();
  const idx = cache.findIndex((k) => k.id === id);
  if (idx === -1) return false;
  cache.splice(idx, 1);
  await enqueueWrite();
  return true;
}

export async function verifyApiKey(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.startsWith(KEY_PREFIX)) return null;
  await ensureLoaded();
  const incoming = Buffer.from(hashKey(raw), 'hex');
  for (const entry of cache) {
    const stored = Buffer.from(entry.hash, 'hex');
    if (stored.length === incoming.length && timingSafeEqual(stored, incoming)) {
      entry.lastUsedAt = new Date().toISOString();
      enqueueWrite();
      const { hash, ...safe } = entry;
      return safe;
    }
  }
  return null;
}
