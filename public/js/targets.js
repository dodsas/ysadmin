import { $, api, formatTimestamp, targetStatusLabel } from './util.js';
import { attachDragHandlers, isDraggingActive } from './drag.js';

const ctx = {
  container: null,
  orderEndpoint: '/api/targets/order',
  refresh: () => refreshTargets(),
};

export function setTargetsContainer(el) {
  ctx.container = el;
}

function renderTarget(target) {
  const tpl = $('#target-row');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = target.id;

  const statusEl = $('[data-status]', node);
  statusEl.dataset.status = target.status || 'unknown';
  $('.status-label', statusEl).textContent = targetStatusLabel(target.status);

  $('[data-label]', node).textContent = target.label || target.url;
  const urlEl = $('[data-url]', node);
  urlEl.textContent = target.url;
  urlEl.href = `/api/targets/${target.id}/go`;
  if (isStandalone()) {
    urlEl.removeAttribute('target');
  } else {
    urlEl.setAttribute('target', '_blank');
  }
  if (target.sso && target.sso.enabled) {
    urlEl.title = 'SSO 자동 로그인 (토큰 핸드오프)';
  } else if (target.basicAuth && target.basicAuth.username) {
    urlEl.title = `Basic 자동 로그인: ${target.basicAuth.username}`;
  } else {
    urlEl.title = '';
  }
  urlEl.addEventListener('click', (e) => {
    if (!isStandalone()) return;
    e.preventDefault();
    // iOS Safari PWA 는 iframe 안의 third-party 쿠키를 ITP 로 차단해서
    // SSO 핸드오프 후 타겟이 Set-Cookie 해도 세션이 유지되지 않음 → 로그인 화면이 다시 뜸.
    // SSO 가 켜진 항목은 PWA 창을 top-level 로 이동시켜 first-party 쿠키로 처리.
    if (target.sso && target.sso.enabled) {
      window.location.href = `/api/targets/${target.id}/go`;
      return;
    }
    openTargetFrame(target);
  });

  const metaParts = [];
  metaParts.push(`마지막 체크: ${formatTimestamp(target.lastCheckedAt)}`);
  if (target.lastStatusCode != null) metaParts.push(`HTTP ${target.lastStatusCode}`);
  if (target.lastLatencyMs != null) metaParts.push(`${target.lastLatencyMs}ms`);
  if (target.lastError) metaParts.push(`오류: ${target.lastError}`);
  $('[data-meta]', node).textContent = metaParts.join(' · ');

  $('[data-action="check"]', node).addEventListener('click', async () => {
    try {
      await api(`/api/targets/${target.id}/check`, { method: 'POST' });
      await refreshTargets();
    } catch (err) {
      alert(err.message);
    }
  });

  $('[data-action="settings"]', node).addEventListener('click', () => {
    openTargetSettingsDialog(target);
  });

  $('[data-action="delete"]', node).addEventListener('click', async () => {
    if (!confirm(`정말 삭제하시겠습니까?\n${target.url}`)) return;
    try {
      await api(`/api/targets/${target.id}`, { method: 'DELETE' });
      await refreshTargets();
    } catch (err) {
      alert(err.message);
    }
  });

  attachDragHandlers(node, target.id, ctx);

  return node;
}

export async function refreshTargets() {
  if (isDraggingActive()) return;
  const { targets } = await api('/api/targets');
  const container = ctx.container;
  container.innerHTML = '';
  if (!targets.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '등록된 URL이 없습니다. 위 입력창에서 추가해주세요.';
    container.appendChild(empty);
    return;
  }
  targets.forEach((t) => container.appendChild(renderTarget(t)));
}

export function setupAddForm() {
  const form = $('#add-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const urlInput = $('#url-input');
    const labelInput = $('#label-input');
    const url = urlInput.value.trim();
    if (!url) return;
    try {
      await api('/api/targets', {
        method: 'POST',
        body: JSON.stringify({ url, label: labelInput.value.trim() || undefined }),
      });
      urlInput.value = '';
      labelInput.value = '';
      await refreshTargets();
    } catch (err) {
      alert(err.message);
    }
  });
}

export function setupRefreshButton() {
  $('#refresh-btn').addEventListener('click', () => {
    refreshTargets().catch((err) => alert(err.message));
  });
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator && window.navigator.standalone === true) return true;
  return false;
}

const FRAME_HISTORY_TAG = 'targetFrameDialog';
let frameHistoryBaseLen = 0;
let frameClosing = false;

function openTargetFrame(target) {
  const dlg = $('#target-frame-dialog');
  const iframe = $('[data-frame]', dlg);
  const title = $('[data-frame-title]', dlg);
  const goUrl = `/api/targets/${target.id}/go`;
  title.textContent = target.label || target.url;
  // 센티넬 상태를 push 해서 백 제스처/버튼을 다이얼로그 닫기로 가로챈다.
  history.pushState({ tag: FRAME_HISTORY_TAG }, '');
  // 센티넬 직후 길이를 기준점으로 저장. iframe 내부 네비게이션으로 늘어난 만큼 닫을 때 되돌린다.
  // 닫을 때 되돌릴 양 = (현재 길이 - 기준 길이) + 1(센티넬 자신).
  frameHistoryBaseLen = history.length;
  iframe.src = goUrl;
  if (typeof dlg.showModal === 'function') {
    dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}

export function setupTargetFrameDialog() {
  const dlg = $('#target-frame-dialog');
  if (!dlg) return;
  const back = $('[data-frame-back]', dlg);
  const external = $('[data-frame-external]', dlg);

  // iframe.src = 'about:blank' 은 또 다른 history 항목을 만들어 정리를 망가뜨린다.
  // 대신 iframe 엘리먼트 자체를 새 빈 것으로 교체해 (1) 모니터 세션을 끊고 (2) history 오염도 피한다.
  const finalize = () => {
    const current = $('[data-frame]', dlg);
    if (current) {
      const fresh = document.createElement('iframe');
      for (const attr of current.attributes) {
        if (attr.name === 'src') continue;
        fresh.setAttribute(attr.name, attr.value);
      }
      current.replaceWith(fresh);
    }
    if (dlg.open) dlg.close();
  };

  // 사용자가 명시적으로 닫는 경로(버튼/취소/외부열기): iframe 가 만든 히스토리까지 함께 되돌린다.
  // 되돌릴 양 = (현재 길이) - (열기 직전 길이). 센티넬 + iframe 누적 항목이 포함된다.
  const close = () => {
    if (frameClosing) return;
    const steps = Math.max(0, history.length - frameHistoryBaseLen) + 1;
    if (steps > 0) {
      frameClosing = true;
      const onPop = () => {
        window.removeEventListener('popstate', onPop);
        frameClosing = false;
        finalize();
      };
      window.addEventListener('popstate', onPop);
      history.go(-steps);
    } else {
      finalize();
    }
  };

  back.addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  external.addEventListener('click', () => {
    const current = $('[data-frame]', dlg);
    const url = current ? current.src : '';
    const openExternal = () => window.open(url, '_blank', 'noreferrer');
    if (frameClosing) {
      openExternal();
      return;
    }
    // close() 가 history.go 를 트리거하므로, 정리가 끝난 뒤 새 탭을 연다.
    const steps = Math.max(0, history.length - frameHistoryBaseLen) + 1;
    if (steps > 0) {
      frameClosing = true;
      const onPop = () => {
        window.removeEventListener('popstate', onPop);
        frameClosing = false;
        finalize();
        openExternal();
      };
      window.addEventListener('popstate', onPop);
      history.go(-steps);
    } else {
      finalize();
      openExternal();
    }
  });

  // 백 제스처/버튼으로 popstate 가 발생했고 다이얼로그가 열려있다면, SPA 가 뒤로 가는 대신 닫는다.
  // 이 시점에는 사용자가 이미 한 단계 뒤로 갔으므로(센티넬 또는 iframe 항목 소비),
  // 남은 항목 = 현재 길이 - 기준 길이. 0 이면 그냥 정리.
  window.addEventListener('popstate', () => {
    if (frameClosing) return;
    if (!dlg.open) return;
    const steps = Math.max(0, history.length - frameHistoryBaseLen);
    if (steps > 0) {
      frameClosing = true;
      const onPop = () => {
        window.removeEventListener('popstate', onPop);
        frameClosing = false;
        finalize();
      };
      window.addEventListener('popstate', onPop);
      history.go(-steps);
    } else {
      finalize();
    }
  });
}

function openTargetSettingsDialog(target) {
  const dlg = $('#target-settings-dialog');
  const form = $('#target-settings-form');
  form.label.value = target.label || '';
  const ba = target.basicAuth || {};
  form.basicUser.value = ba.username || '';
  form.basicPassword.value = ba.password || '';
  const sso = target.sso || {};
  form.ssoEnabled.checked = Boolean(sso.enabled);
  form.ssoSecret.value = sso.secret || '';
  form.ssoEndpoint.value = sso.endpoint || '/sso';
  form.ssoSubject.value = sso.subject || '';
  form.ssoTtl.value = sso.ttlSec || 30;
  form.dataset.id = target.id;
  dlg.showModal();
}

export function setupTargetSettingsDialog() {
  const dlg = $('#target-settings-dialog');
  const form = $('#target-settings-form');
  form.querySelector('[data-dialog-cancel]').addEventListener('click', () => dlg.close());
  form.querySelector('[data-sso-generate]').addEventListener('click', async () => {
    try {
      const { secret } = await api('/api/targets/sso/secret', { method: 'POST' });
      form.ssoSecret.value = secret;
      form.ssoEnabled.checked = true;
    } catch (err) {
      alert(err.message);
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.dataset.id;
    if (!id) return;
    const username = form.basicUser.value.trim();
    const ssoEnabled = form.ssoEnabled.checked;
    const ssoSecret = form.ssoSecret.value.trim();
    if (ssoEnabled && !ssoSecret) {
      alert('SSO 시크릿을 입력하거나 생성 버튼을 눌러주세요.');
      return;
    }
    const body = {
      label: form.label.value.trim(),
      basicAuth: username ? { username, password: form.basicPassword.value } : null,
      sso: ssoEnabled
        ? {
            enabled: true,
            secret: ssoSecret,
            endpoint: form.ssoEndpoint.value.trim() || '/sso',
            subject: form.ssoSubject.value.trim() || null,
            ttlSec: Number(form.ssoTtl.value) || 30,
          }
        : null,
    };
    try {
      await api(`/api/targets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      dlg.close();
      await refreshTargets();
    } catch (err) {
      alert(err.message);
    }
  });
}
