import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { logger } from './logger.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const META_FILE = resolve(DATA_DIR, 'lunch.json');
const IMAGE_FILE = resolve(DATA_DIR, 'lunch.jpg');
const TESS_CACHE = resolve(DATA_DIR, 'tess-cache');
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
  // 2x Lanczos3 업스케일 + 언샤프 마스크: 작은 셀의 한글이 시각적으로 또렷해짐
  // 동시에 OCR 정확도도 함께 상승
  const meta = await sharp(buf).metadata();
  const targetW = Math.min(2400, (meta.width || 600) * 3);
  const targetH = Math.round(targetW * ((meta.height || 1) / (meta.width || 1)));
  const processed = await sharp(buf)
    .resize({ width: targetW, height: targetH, kernel: sharp.kernel.lanczos3, fit: 'fill' })
    .sharpen({ sigma: 1.2, m1: 0.5, m2: 2.5 })
    .modulate({ brightness: 1.0, saturation: 1.05 })
    .linear(1.08, -8)
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  await writeFile(IMAGE_FILE, processed);
  return processed.length;
}

let workerPromise = null;
async function getOcrWorker() {
  if (!workerPromise) {
    await mkdir(TESS_CACHE, { recursive: true });
    workerPromise = (async () => {
      const w = await createWorker(['kor', 'eng'], 1, {
        cacheMethod: 'readWrite',
        cachePath: TESS_CACHE,
        logger: () => {},
      });
      // 표/메뉴판 같은 균일 블록 텍스트는 PSM 6 가 가장 안정적
      await w.setParameters({ tessedit_pageseg_mode: '6' });
      return w;
    })();
  }
  return workerPromise;
}

async function runOcr(imagePath) {
  try {
    // 전처리: 그레이스케일 + 콘트라스트 부스트 → OCR 정확도 ↑
    const preBuf = await sharp(imagePath)
      .grayscale()
      .linear(1.2, -20)
      .sharpen({ sigma: 1, m1: 0.5, m2: 2 })
      .toBuffer();
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(preBuf);
    const raw = (data?.text || '').trim();
    // 의미 없는 기호 라인 제거 (3자 미만이거나 한글/숫자/영문 비율이 너무 낮은 줄)
    const lines = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 2)
      .filter((l) => {
        const meaningful = (l.match(/[가-힣A-Za-z0-9]/g) || []).length;
        return meaningful / l.length >= 0.4;
      });
    return lines.join('\n');
  } catch (err) {
    logger.warn('lunch', 'OCR 실패', { error: err.message });
    return '';
  }
}

export async function refreshLunch() {
  const html = await fetchMenuPage();
  const state = extractApolloState(html);
  const menu = findMenu(state);
  const imageUrl = menu.images[0];
  const bytes = await downloadImage(imageUrl);
  const extractedText = await runOcr(IMAGE_FILE);
  const meta = {
    name: menu.name,
    price: menu.price,
    description: menu.description,
    imageUrl,
    fetchedAt: new Date().toISOString(),
    bytes,
    extractedText,
  };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(META_FILE, JSON.stringify(meta, null, 2));
  logger.info('lunch', '메뉴 갱신', {
    name: meta.name,
    price: meta.price,
    bytes,
    ocrChars: extractedText.length,
  });
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

function kstDateKey(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getOrRefreshLunch({ force = false } = {}) {
  if (!force) {
    const cached = await getLunchMeta();
    const today = kstDateKey(new Date().toISOString());
    if (cached && kstDateKey(cached.fetchedAt) === today) {
      return { ...cached, fromCache: true };
    }
  }
  return await refreshLunch();
}
