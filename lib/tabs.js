import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const DATA_DIR = resolve(process.cwd(), 'data');
const FILE = resolve(DATA_DIR, 'tabs.json');

export const DEFAULT_ORDER = ['computers', 'lunch', 'keepalive'];
const VALID = new Set(DEFAULT_ORDER);

function normalize(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!VALID.has(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  for (const t of DEFAULT_ORDER) if (!seen.has(t)) out.push(t);
  return out;
}

export async function getTabOrder() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_ORDER.slice();
    return normalize(arr);
  } catch (err) {
    if (err.code === 'ENOENT') return DEFAULT_ORDER.slice();
    throw err;
  }
}

export async function setTabOrder(order) {
  if (!Array.isArray(order)) {
    const err = new Error('order는 배열이어야 합니다.');
    err.status = 400;
    throw err;
  }
  for (const x of order) {
    if (typeof x !== 'string' || !VALID.has(x)) {
      const err = new Error(`알 수 없는 탭: ${x}`);
      err.status = 400;
      throw err;
    }
  }
  const final = normalize(order);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(final, null, 2), 'utf8');
  return final;
}
