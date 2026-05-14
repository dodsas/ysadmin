import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { logger } from './logger.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const META_FILE = resolve(DATA_DIR, 'lunch.json');
const IMAGE_FILE = resolve(DATA_DIR, 'lunch.jpg');
const PLACE_ID = process.env.LUNCH_PLACE_ID || '1397161473';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const LUNCH_IMAGE_FILE = IMAGE_FILE;

async function fetchMenuPage() {
  const url = `https://pcmap.place.naver.com/restaurant/${PLACE_ID}/menu/list`;
  const res = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9',
      'sec-ch-ua': '"Chromium";v="126", "Not(A:Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      referer: 'https://map.naver.com/',
      'user-agent': UA,
    },
  });
  if (!res.ok) throw new Error(`Naver fetch ${res.status}`);
  return await res.text();
}

function extractApolloState(html) {
  const marker = 'window.__APOLLO_STATE__ = ';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Apollo state not found');
  const jsonStart = start + marker.length;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = jsonStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(jsonStart, i + 1));
    }
  }
  throw new Error('Apollo state JSON unbalanced');
}

function findMenu(state) {
  for (const v of Object.values(state)) {
    if (v && v.__typename === 'Menu' && Array.isArray(v.images) && v.images.length > 0) {
      return v;
    }
  }
  throw new Error('Menu with image not found');
}

async function downloadImage(url) {
  const res = await fetch(url, {
    headers: {
      referer: 'https://m.place.naver.com/',
      'user-agent': UA,
    },
  });
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(IMAGE_FILE, buf);
  return buf.length;
}

export async function refreshLunch() {
  const html = await fetchMenuPage();
  const state = extractApolloState(html);
  const menu = findMenu(state);
  const imageUrl = menu.images[0];
  const bytes = await downloadImage(imageUrl);
  const meta = {
    name: menu.name,
    price: menu.price,
    description: menu.description,
    imageUrl,
    fetchedAt: new Date().toISOString(),
    bytes,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(META_FILE, JSON.stringify(meta, null, 2));
  logger.info('lunch', '메뉴 갱신', { name: meta.name, price: meta.price, bytes });
  return meta;
}

export async function getLunchMeta() {
  try {
    const raw = await readFile(META_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
