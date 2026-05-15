import { readFile, stat, open, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOG_DIR = process.env.LOG_DIR || resolve(process.cwd(), 'logs');
const LOG_FILE = resolve(LOG_DIR, 'ysadmin.log');
const DAY_MS = 24 * 60 * 60 * 1000;

const READ_TAIL_BYTES = 256 * 1024;

export async function readRecentLogs({ limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  let text;
  try {
    const st = await stat(LOG_FILE);
    if (st.size <= READ_TAIL_BYTES) {
      text = await readFile(LOG_FILE, 'utf8');
    } else {
      const fh = await open(LOG_FILE, 'r');
      try {
        const buf = Buffer.alloc(READ_TAIL_BYTES);
        await fh.read(buf, 0, READ_TAIL_BYTES, st.size - READ_TAIL_BYTES);
        text = buf.toString('utf8');
        const firstNewline = text.indexOf('\n');
        if (firstNewline >= 0) text = text.slice(firstNewline + 1);
      } finally {
        await fh.close();
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const lines = text.split('\n').filter((l) => l.length > 0);
  const tail = lines.slice(-safeLimit);
  const entries = [];
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      entries.push({ ts: null, level: 'raw', source: '-', msg: line });
    }
  }
  entries.reverse();
  return entries;
}

// mtime 이 olderThanDays 일 이전인 rotated 로그 파일을 삭제.
// 활성 로그(ysadmin.log) 는 절대 건드리지 않는다 (rotateIfNeeded 책임).
export async function purgeOldLogs({ olderThanDays = 7 } = {}) {
  const days = Math.max(0, Number(olderThanDays) || 0);
  const cutoff = Date.now() - days * DAY_MS;
  const removed = [];
  let scanned = 0;
  try {
    const files = await readdir(LOG_DIR);
    for (const f of files) {
      if (f === 'ysadmin.log') continue;
      if (!f.startsWith('ysadmin.') || !f.endsWith('.log')) continue;
      scanned += 1;
      const p = resolve(LOG_DIR, f);
      try {
        const st = await stat(p);
        if (st.mtimeMs < cutoff) {
          await unlink(p);
          removed.push({ file: f, mtime: new Date(st.mtimeMs).toISOString() });
        }
      } catch {
        // 파일이 도중에 사라졌거나 권한 문제 — 조용히 스킵
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { scanned, removed, olderThanDays: days };
}

export async function clearLogs({ includeRotated = true } = {}) {
  let truncated = false;
  let removedRotated = 0;
  try {
    await writeFile(LOG_FILE, '', 'utf8');
    truncated = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (includeRotated) {
    try {
      const files = await readdir(LOG_DIR);
      for (const f of files) {
        if (f.startsWith('ysadmin.') && f.endsWith('.log') && f !== 'ysadmin.log') {
          await unlink(resolve(LOG_DIR, f)).catch(() => {});
          removedRotated += 1;
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return { truncated, removedRotated };
}
