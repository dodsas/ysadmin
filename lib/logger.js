import { appendFile, mkdir, stat, rename, unlink, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const LOG_DIR = process.env.LOG_DIR || resolve(process.cwd(), 'logs');
const LOG_FILE = resolve(LOG_DIR, 'ysadmin.log');
const MAX_BYTES = Number(process.env.LOG_MAX_BYTES || 5 * 1024 * 1024);
const KEEP = Number(process.env.LOG_KEEP || 5);

let dirReady = null;
function ensureDir() {
  if (!dirReady) {
    dirReady = mkdir(LOG_DIR, { recursive: true }).catch((err) => {
      console.error('[logger] mkdir failed:', err.message);
    });
  }
  return dirReady;
}

let rotating = false;
async function rotateIfNeeded() {
  if (rotating) return;
  try {
    const st = await stat(LOG_FILE);
    if (st.size < MAX_BYTES) return;
  } catch {
    return;
  }
  rotating = true;
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await rename(LOG_FILE, resolve(LOG_DIR, `ysadmin.${ts}.log`));
    const files = (await readdir(LOG_DIR))
      .filter((f) => f.startsWith('ysadmin.') && f.endsWith('.log'))
      .sort();
    while (files.length > KEEP) {
      const oldest = files.shift();
      await unlink(resolve(LOG_DIR, oldest)).catch(() => {});
    }
  } catch (err) {
    console.error('[logger] rotation failed:', err.message);
  } finally {
    rotating = false;
  }
}

async function write(level, source, msg, extra) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    source,
    msg,
    ...(extra && Object.keys(extra).length ? { extra } : {}),
  };
  const line = JSON.stringify(entry);
  console.log(line);
  try {
    await ensureDir();
    await rotateIfNeeded();
    await appendFile(LOG_FILE, line + '\n', 'utf8');
  } catch (err) {
    console.error('[logger] file write failed:', err.message);
  }
}

export const logger = {
  info: (source, msg, extra) => write('info', source, msg, extra),
  warn: (source, msg, extra) => write('warn', source, msg, extra),
  error: (source, msg, extra) => write('error', source, msg, extra),
  debug: (source, msg, extra) => write('debug', source, msg, extra),
};
