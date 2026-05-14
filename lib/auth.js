import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { logger } from './logger.js';

const DATA_DIR = resolve(process.cwd(), 'data');
const AUTH_FILE = resolve(DATA_DIR, 'auth.json');
const SESSIONS_FILE = resolve(DATA_DIR, 'sessions.json');

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

let authCache = null;
let authLoaded = false;
let sessionsCache = null;
let sessionsLoaded = false;
let writeQueue = Promise.resolve();

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function ensureAuthLoaded() {
  if (authLoaded) return;
  authCache = await readJson(AUTH_FILE, null);
  authLoaded = true;
}

async function ensureSessionsLoaded() {
  if (sessionsLoaded) return;
  const data = await readJson(SESSIONS_FILE, []);
  sessionsCache = Array.isArray(data) ? data : [];
  sessionsLoaded = true;
}

async function persistAuth() {
  await mkdir(DATA_DIR, { recursive: true });
  if (authCache === null) {
    await unlink(AUTH_FILE).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    return;
  }
  await writeFile(AUTH_FILE, JSON.stringify(authCache, null, 2), 'utf8');
}

async function persistSessions() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(sessionsCache, null, 2), 'utf8');
}

function enqueue(fn) {
  writeQueue = writeQueue.then(fn).catch((err) => {
    logger.error('auth', '저장 실패', { error: err.message });
  });
  return writeQueue;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
}

export async function isInitialized() {
  await ensureAuthLoaded();
  return Boolean(authCache && authCache.username && authCache.passwordHash);
}

export async function setupCredentials({ username, password }) {
  await ensureAuthLoaded();
  if (authCache && authCache.username) {
    const err = new Error('이미 초기 설정이 완료되어 있습니다.');
    err.code = 'ALREADY_INITIALIZED';
    throw err;
  }
  const u = String(username ?? '').trim();
  const p = String(password ?? '');
  if (u.length < 3) throw new Error('아이디는 최소 3자 이상이어야 합니다.');
  if (p.length < 6) throw new Error('비밀번호는 최소 6자 이상이어야 합니다.');
  const salt = randomBytes(16).toString('hex');
  authCache = {
    username: u,
    salt,
    passwordHash: hashPassword(p, salt),
    createdAt: new Date().toISOString(),
  };
  await enqueue(persistAuth);
  logger.info('auth', '초기 자격증명 등록', { username: u });
  return { username: u };
}

export async function verifyCredentials({ username, password }) {
  await ensureAuthLoaded();
  if (!authCache || !authCache.username) return false;
  const u = String(username ?? '').trim();
  if (u !== authCache.username) return false;
  const candidate = hashPassword(String(password ?? ''), authCache.salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(authCache.passwordHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function cleanupExpired(now) {
  const before = sessionsCache.length;
  sessionsCache = sessionsCache.filter((s) => new Date(s.expiresAt).getTime() > now);
  return sessionsCache.length !== before;
}

export async function createSession({ username, remember }) {
  await ensureSessionsLoaded();
  const now = Date.now();
  cleanupExpired(now);
  const session = {
    token: randomBytes(32).toString('hex'),
    username,
    remember: Boolean(remember),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_DURATION_MS).toISOString(),
  };
  sessionsCache.push(session);
  await enqueue(persistSessions);
  return session;
}

export async function getSession(token) {
  if (!token) return null;
  await ensureSessionsLoaded();
  const now = Date.now();
  const session = sessionsCache.find((s) => s.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= now) {
    sessionsCache = sessionsCache.filter((s) => s.token !== token);
    await enqueue(persistSessions);
    return null;
  }
  return session;
}

export async function deleteSession(token) {
  if (!token) return;
  await ensureSessionsLoaded();
  const before = sessionsCache.length;
  sessionsCache = sessionsCache.filter((s) => s.token !== token);
  if (sessionsCache.length !== before) {
    await enqueue(persistSessions);
  }
}

export function getSessionDurationMs() {
  return SESSION_DURATION_MS;
}
