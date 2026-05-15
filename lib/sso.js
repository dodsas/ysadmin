// HS256 JWT 발급 — ysadmin → 관제 사이트 SSO 핸드오프용.
// 외부 의존성 없이 Node crypto 만 사용.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function b64u(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(secret, data) {
  return b64u(createHmac('sha256', secret).update(data).digest());
}

// payload: { sub, ...claims }  — iat/exp/jti/iss 는 자동 부여.
export function issueSsoToken({ secret, subject, audience, ttlSec = 30, extra = {} }) {
  if (!secret) throw new Error('SSO secret 이 비어 있습니다.');
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(
    JSON.stringify({
      iss: 'ysadmin',
      sub: String(subject || ''),
      aud: audience || undefined,
      iat: now,
      exp: now + ttlSec,
      jti: randomBytes(8).toString('hex'),
      ...extra,
    }),
  );
  const data = `${header}.${payload}`;
  return `${data}.${sign(secret, data)}`;
}

// 디버깅/테스트용 — 같은 시크릿으로 토큰 검증.
export function verifySsoToken({ token, secret }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };
  const [h, p, s] = parts;
  const expected = sign(secret, `${h}.${p}`);
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature' };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload' };
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired', payload };
  }
  return { ok: true, payload };
}

export function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}
