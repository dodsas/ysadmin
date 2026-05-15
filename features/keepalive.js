// 모니터링 feature — 외부 URL Keep-Alive 핑
import {
  listTargets,
  addTarget,
  removeTarget,
  getTarget,
  reorderTargets,
  updateTarget,
} from '../lib/store.js';
import { startScheduler, checkTarget } from '../lib/pinger.js';
import { issueSsoToken, generateSecret } from '../lib/sso.js';

function register(app) {
  app.get('/api/targets', async (_req, res) => {
    const targets = await listTargets();
    res.json({ targets });
  });

  app.post('/api/targets', async (req, res) => {
    try {
      const target = await addTarget({ url: req.body?.url, label: req.body?.label });
      checkTarget(target).catch((err) => console.error('[server] initial check failed:', err));
      res.status(201).json({ target });
    } catch (err) {
      const status = err.code === 'DUPLICATE' ? 409 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  app.delete('/api/targets/:id', async (req, res) => {
    const ok = await removeTarget(req.params.id);
    if (!ok) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
    res.status(204).end();
  });

  app.put('/api/targets/order', async (req, res) => {
    try {
      const targets = await reorderTargets(req.body?.order);
      res.json({ targets });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/targets/:id/check', async (req, res) => {
    const target = await getTarget(req.params.id);
    if (!target) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
    const updated = await checkTarget(target);
    res.json({ target: updated });
  });

  app.patch('/api/targets/:id', async (req, res) => {
    try {
      const updated = await updateTarget(req.params.id, req.body || {});
      if (!updated) return res.status(404).json({ error: '대상을 찾을 수 없습니다.' });
      res.json({ target: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/targets/:id/go', async (req, res) => {
    const target = await getTarget(req.params.id);
    if (!target) return res.status(404).send('대상을 찾을 수 없습니다.');
    const { basicAuth, sso, url } = target;

    // 1) SSO 토큰 핸드오프 (최우선) — POST form 으로 전달.
    // GET 쿼리로 보내면 토큰이 ① 브라우저 history ② 대상 access log ③ Referer 헤더에 남음.
    // SAML/OIDC form_post 와 동일 패턴: 자동 submit HTML 한 장 반환.
    if (sso && sso.enabled && sso.secret) {
      try {
        const token = issueSsoToken({
          secret: sso.secret,
          subject: sso.subject || req.session?.username || 'ysadmin',
          audience: new URL(url).hostname,
          ttlSec: sso.ttlSec || 30,
          extra: { src: 'ysadmin' },
        });
        const action = new URL(sso.endpoint || '/sso', url).toString();
        const html = renderSsoFormPost(action, token);
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        return res.send(html);
      } catch (err) {
        return res.status(500).send(`SSO 토큰 발급 실패: ${err.message}`);
      }
    }

    // 2) HTTP Basic Auth (레거시) — 일부 브라우저는 userinfo URL 차단.
    if (basicAuth && basicAuth.username) {
      try {
        const u = new URL(url);
        u.username = basicAuth.username;
        u.password = basicAuth.password || '';
        return res.redirect(302, u.toString());
      } catch {
        return res.redirect(302, url);
      }
    }

    return res.redirect(302, url);
  });

  // SSO 시크릿 자동 생성 — UI 의 "생성" 버튼이 호출. 저장은 별도 PATCH.
  app.post('/api/targets/sso/secret', (_req, res) => {
    res.json({ secret: generateSecret(32) });
  });
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function renderSsoFormPost(action, token) {
  const a = htmlEscape(action);
  const t = htmlEscape(token);
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8" />
<meta name="referrer" content="no-referrer" />
<title>SSO 이동중…</title>
</head>
<body>
<form id="f" method="POST" action="${a}">
  <input type="hidden" name="token" value="${t}" />
  <noscript><button type="submit">계속</button></noscript>
</form>
<script>document.getElementById('f').submit();</script>
</body></html>`;
}

export const keepaliveFeature = {
  id: 'keepalive',
  label: '모니터링',
  description: 'render.com 등 외부 URL 주기 GET 으로 sleep 방지',
  register,
  startSchedulers: startScheduler,
};
