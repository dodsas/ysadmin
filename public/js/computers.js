import { $, api, formatTimestamp, computerStatusLabel } from './util.js';
import { attachDragHandlers, isDraggingActive } from './drag.js';

const WAKE_WINDOW_MS = 60000;
const WAKE_POLL_INTERVAL_MS = 5000;
const SHUTDOWN_WINDOW_MS = 60000;

const activePolls = new Set();
const activeShutdowns = new Set();
const activeChecks = new Set();

const ctx = {
  container: null,
  orderEndpoint: '/api/computers/order',
  refresh: () => refreshComputers(),
};

export function setComputersContainer(el) {
  ctx.container = el;
}

function isWaking(computer) {
  if (computer.lastStatus === 'up') return false;
  if (!computer.lastWakeAt) return false;
  return Date.now() - new Date(computer.lastWakeAt).getTime() < WAKE_WINDOW_MS;
}

function renderComputer(computer) {
  const tpl = $('#computer-row');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = computer.id;

  const lastStatus = computer.lastStatus || 'unknown';
  const waking = isWaking(computer);
  const statusEl = $('[data-status]', node);
  if (waking) {
    statusEl.dataset.status = 'unknown';
    $('.status-label', statusEl).textContent = '깨우는 중';
  } else {
    statusEl.dataset.status = lastStatus;
    $('.status-label', statusEl).textContent = computerStatusLabel(lastStatus);
  }

  $('[data-label]', node).textContent = computer.label || computer.mac;
  const ipDisplay = computer.ip || computer.lastSeenIp;
  $('[data-mac]', node).textContent = computer.mac + (ipDisplay ? ` · ${ipDisplay}` : '');

  const metaParts = [`마지막 부팅 시도: ${formatTimestamp(computer.lastWakeAt)}`];
  if (computer.lastStatusAt) metaParts.push(`상태확인: ${formatTimestamp(computer.lastStatusAt)}`);
  $('[data-meta]', node).textContent = metaParts.join('\n');

  const toggleBtn = $('[data-action="toggle"]', node);
  const statusBtn = $('[data-action="status"]', node);
  const shuttingDown = activeShutdowns.has(computer.id);
  const checking = activeChecks.has(computer.id);
  const shutdownReady = Boolean(computer.shutdown && computer.shutdown.enabled);

  toggleBtn.classList.remove('btn-primary', 'btn-warn');
  toggleBtn.title = '';
  toggleBtn.dataset.mode = '';

  if (shuttingDown) {
    toggleBtn.textContent = '끄는 중';
    toggleBtn.disabled = true;
    toggleBtn.classList.add('btn-warn');
    statusBtn.disabled = true;
  } else if (waking) {
    toggleBtn.textContent = '켜는 중';
    toggleBtn.disabled = true;
    toggleBtn.classList.add('btn-primary');
    statusBtn.disabled = true;
  } else if (checking) {
    toggleBtn.textContent = '확인 중';
    toggleBtn.disabled = true;
    toggleBtn.classList.add('btn-primary');
    statusBtn.disabled = true;
  } else if (lastStatus === 'up') {
    if (shutdownReady) {
      toggleBtn.textContent = '끄기';
      toggleBtn.disabled = false;
      toggleBtn.classList.add('btn-warn');
      toggleBtn.dataset.mode = 'shutdown';
    } else {
      toggleBtn.textContent = '✓ 켜짐';
      toggleBtn.disabled = true;
      toggleBtn.classList.add('btn-primary');
      toggleBtn.title = '끄기 기능: ⚙ 설정에서 SSH 활성화 필요';
    }
    statusBtn.disabled = false;
  } else {
    toggleBtn.textContent = '켜기';
    toggleBtn.disabled = false;
    toggleBtn.classList.add('btn-primary');
    toggleBtn.dataset.mode = 'wake';
    statusBtn.disabled = false;
  }

  toggleBtn.addEventListener('click', async (e) => {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'wake') {
      try {
        await api(`/api/computers/${computer.id}/wake`, { method: 'POST' });
        await refreshComputers();
        pollComputerStatus(computer.id, WAKE_WINDOW_MS, WAKE_POLL_INTERVAL_MS);
      } catch (err) {
        alert(err.message);
        await refreshComputers();
      }
    } else if (mode === 'shutdown') {
      if (!confirm(`${computer.label} 을(를) 끕니다.\n\n계속하시겠습니까?`)) return;
      activeShutdowns.add(computer.id);
      await refreshComputers();
      try {
        await api(`/api/computers/${computer.id}/shutdown`, { method: 'POST' });
        pollShutdownStatus(computer.id, SHUTDOWN_WINDOW_MS, WAKE_POLL_INTERVAL_MS);
      } catch (err) {
        alert(err.message);
        activeShutdowns.delete(computer.id);
        await refreshComputers();
      }
    }
  });

  $('[data-action="settings"]', node).addEventListener('click', () => {
    openSettingsDialog(computer);
  });

  statusBtn.addEventListener('click', async () => {
    activeChecks.add(computer.id);
    await refreshComputers();
    try {
      await api(`/api/computers/${computer.id}/status`);
    } catch (err) {
      alert(err.message);
    } finally {
      activeChecks.delete(computer.id);
      await refreshComputers();
    }
  });

  $('[data-action="delete"]', node).addEventListener('click', async () => {
    if (!confirm(`정말 삭제하시겠습니까?\n${computer.label} (${computer.mac})`)) return;
    try {
      await api(`/api/computers/${computer.id}`, { method: 'DELETE' });
      await refreshComputers();
    } catch (err) {
      alert(err.message);
    }
  });

  attachDragHandlers(node, computer.id, ctx);

  return node;
}

async function pollShutdownStatus(id, maxDurationMs, intervalMs) {
  const deadline = Date.now() + maxDurationMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (Date.now() >= deadline) break;
      try {
        const { status } = await api(`/api/computers/${id}/status`);
        await refreshComputers().catch(() => {});
        if (!status.up) return;
      } catch {
        /* keep polling */
      }
    }
  } finally {
    activeShutdowns.delete(id);
    refreshComputers().catch(() => {});
  }
}

async function pollComputerStatus(id, maxDurationMs, intervalMs) {
  if (activePolls.has(id)) return;
  activePolls.add(id);
  const deadline = Date.now() + maxDurationMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (Date.now() >= deadline) break;
      try {
        const { status } = await api(`/api/computers/${id}/status`);
        await refreshComputers().catch(() => {});
        if (status.up) return;
      } catch {
        /* keep polling until deadline */
      }
    }
  } finally {
    activePolls.delete(id);
  }
}

function openSettingsDialog(computer) {
  const dlg = $('#computer-settings-dialog');
  const form = $('#computer-settings-form');
  form.label.value = computer.label || '';
  form.ip.value = computer.ip || '';
  form.os.value = computer.os || 'unknown';
  const s = computer.shutdown || {};
  form.shutdownEnabled.checked = Boolean(s.enabled);
  form.sshUser.value = s.sshUser || '';
  form.sshPort.value = s.sshPort || 22;
  form.sshPassword.value = s.sshPassword || '';
  form.shutdownCommand.value = s.command || '';
  form.dataset.id = computer.id;
  dlg.showModal();
}

export function setupSettingsDialog() {
  const dlg = $('#computer-settings-dialog');
  const form = $('#computer-settings-form');
  form.querySelector('[data-dialog-cancel]').addEventListener('click', () => dlg.close());

  form.os.addEventListener('change', () => {
    const current = form.shutdownCommand.value.trim();
    if (!current || current === 'shutdown /s /t 0 /f' || current === 'sudo shutdown -h now') {
      form.shutdownCommand.value =
        form.os.value === 'windows' ? 'shutdown /s /t 0 /f' : 'sudo shutdown -h now';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.dataset.id;
    if (!id) return;
    const body = {
      label: form.label.value.trim(),
      ip: form.ip.value.trim() || null,
      os: form.os.value,
      shutdown: {
        enabled: form.shutdownEnabled.checked,
        sshUser: form.sshUser.value.trim() || null,
        sshPort: Number(form.sshPort.value) || 22,
        sshPassword: form.sshPassword.value,
        command: form.shutdownCommand.value.trim(),
      },
    };
    try {
      await api(`/api/computers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      dlg.close();
      await refreshComputers();
    } catch (err) {
      alert(err.message);
    }
  });
}

export async function refreshComputers() {
  if (isDraggingActive()) return;
  const { computers } = await api('/api/computers');
  const container = ctx.container;
  container.innerHTML = '';
  if (!computers.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '등록된 컴퓨터가 없습니다.';
    container.appendChild(empty);
    return;
  }
  computers.forEach((c) => container.appendChild(renderComputer(c)));
}

export function setupAddComputerForm() {
  const form = $('#add-computer-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const macInput = $('#computer-mac-input');
    const labelInput = $('#computer-label-input');
    const ipInput = $('#computer-ip-input');
    const mac = macInput.value.trim();
    if (!mac) return;
    try {
      await api('/api/computers', {
        method: 'POST',
        body: JSON.stringify({
          mac,
          label: labelInput.value.trim() || undefined,
          ip: ipInput.value.trim() || undefined,
        }),
      });
      macInput.value = '';
      labelInput.value = '';
      ipInput.value = '';
      await refreshComputers();
    } catch (err) {
      alert(err.message);
    }
  });
}

export function setupRefreshComputersButton() {
  $('#refresh-computers-btn').addEventListener('click', () => {
    refreshComputers().catch((err) => alert(err.message));
  });
}

export async function onEnterComputersTab() {
  try {
    const result = await api('/api/computers/check-all', { method: 'POST' });
    if (result && result.ok) {
      setTimeout(() => refreshComputers().catch(() => {}), 3000);
      setTimeout(() => refreshComputers().catch(() => {}), 10000);
    }
  } catch {
    /* ignore */
  }
}
