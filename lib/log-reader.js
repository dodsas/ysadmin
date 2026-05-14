import { readFile, stat, open, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOG_DIR = process.env.LOG_DIR || resolve(process.cwd(), 'logs');
const LOG_FILE = resolve(LOG_DIR, 'ysadmin.log');

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
