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
  if (target.basicAuth && target.basicAuth.username) {
    urlEl.title = `자동 로그인: ${target.basicAuth.username}`;
  } else {
    urlEl.title = '';
  }
  urlEl.addEventListener('click', (e) => {
    if (!isStandalone()) return;
    e.preventDefault();
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

function openTargetFrame(target) {
  const dlg = $('#target-frame-dialog');
  const iframe = $('[data-frame]', dlg);
  const title = $('[data-frame-title]', dlg);
  const goUrl = `/api/targets/${target.id}/go`;
  title.textContent = target.label || target.url;
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
  const iframe = $('[data-frame]', dlg);
  const back = $('[data-frame-back]', dlg);
  const external = $('[data-frame-external]', dlg);

  const close = () => {
    iframe.src = 'about:blank';
    if (dlg.open) dlg.close();
  };

  back.addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  external.addEventListener('click', () => {
    const url = iframe.src;
    close();
    window.open(url, '_blank', 'noreferrer');
  });
}

function openTargetSettingsDialog(target) {
  const dlg = $('#target-settings-dialog');
  const form = $('#target-settings-form');
  form.label.value = target.label || '';
  const ba = target.basicAuth || {};
  form.basicUser.value = ba.username || '';
  form.basicPassword.value = ba.password || '';
  form.dataset.id = target.id;
  dlg.showModal();
}

export function setupTargetSettingsDialog() {
  const dlg = $('#target-settings-dialog');
  const form = $('#target-settings-form');
  form.querySelector('[data-dialog-cancel]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.dataset.id;
    if (!id) return;
    const username = form.basicUser.value.trim();
    const body = {
      label: form.label.value.trim(),
      basicAuth: username ? { username, password: form.basicPassword.value } : null,
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
