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

// id → 렌더된 row 노드. refresh 시 innerHTML 통째 교체 대신 키 기반 diff 로
// 갱신하면, 5초 폴링 × N 개 row 만큼의 reflow 가 사라지고 사용자가 누르고
// 있던 버튼/포커스/터치 상태가 새로고침으로 파괴되지 않는다.
const renderedById = new Map();

function createComputerNode(id) {
  const tpl = $('#computer-row');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  attachDragHandlers(node, id, ctx);
  bindComputerHandlers(node);
  return node;
}

function bindComputerHandlers(node) {
  // 핸들러는 항상 node._computer 의 최신 값을 읽는다. 클로저로 잡아두면
  // diff 갱신 후 stale 한 라벨/상태로 동작할 수 있음.
  const toggleBtn = $('[data-action="toggle"]', node);
  const statusBtn = $('[data-action="status"]', node);

  toggleBtn.addEventListener('click', async (e) => {
    const computer = node._computer;
    if (!computer) return;
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
    const computer = node._computer;
    if (computer) openSettingsDialog(computer);
  });

  statusBtn.addEventListener('click', async () => {
    const computer = node._computer;
    if (!computer) return;
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
    const computer = node._computer;
    if (!computer) return;
    if (!confirm(`정말 삭제하시겠습니까?\n${computer.label} (${computer.mac})`)) return;
    try {
      await api(`/api/computers/${computer.id}`, { method: 'DELETE' });
      await refreshComputers();
    } catch (err) {
      alert(err.message);
    }
  });
}

function updateComputerNode(node, computer) {
  node._computer = computer;

  const lastStatus = computer.lastStatus || 'unknown';
  const waking = isWaking(computer);
  const statusEl = $('[data-status]', node);
  const statusLabelEl = $('.status-label', statusEl);
  const nextStatusKey = waking ? 'unknown' : lastStatus;
  const nextStatusText = waking ? '깨우는 중' : computerStatusLabel(lastStatus);
  if (statusEl.dataset.status !== nextStatusKey) statusEl.dataset.status = nextStatusKey;
  if (statusLabelEl.textContent !== nextStatusText) statusLabelEl.textContent = nextStatusText;

  const labelEl = $('[data-label]', node);
  const nextLabel = computer.label || computer.mac;
  if (labelEl.textContent !== nextLabel) labelEl.textContent = nextLabel;

  const macEl = $('[data-mac]', node);
  const ipDisplay = computer.ip || computer.lastSeenIp;
  const nextMac = computer.mac + (ipDisplay ? ` · ${ipDisplay}` : '');
  if (macEl.textContent !== nextMac) macEl.textContent = nextMac;

  const metaEl = $('[data-meta]', node);
  const metaParts = [`마지막 부팅 시도: ${formatTimestamp(computer.lastWakeAt)}`];
  if (computer.lastStatusAt) metaParts.push(`상태확인: ${formatTimestamp(computer.lastStatusAt)}`);
  const nextMeta = metaParts.join('\n');
  if (metaEl.textContent !== nextMeta) metaEl.textContent = nextMeta;

  const toggleBtn = $('[data-action="toggle"]', node);
  const statusBtn = $('[data-action="status"]', node);
  const shuttingDown = activeShutdowns.has(computer.id);
  const checking = activeChecks.has(computer.id);
  const shutdownReady = Boolean(computer.shutdown && computer.shutdown.enabled);

  let label, disabled, statusDisabled;
  let mode = '';
  let cls = '';
  let title = '';

  if (shuttingDown) {
    label = '끄는 중'; disabled = true; cls = 'btn-warn'; statusDisabled = true;
  } else if (waking) {
    label = '켜는 중'; disabled = true; cls = 'btn-primary'; statusDisabled = true;
  } else if (checking) {
    label = '확인 중'; disabled = true; cls = 'btn-primary'; statusDisabled = true;
  } else if (lastStatus === 'up') {
    if (shutdownReady) {
      label = '끄기'; disabled = false; cls = 'btn-warn'; mode = 'shutdown';
    } else {
      label = '✓ 켜짐'; disabled = true; cls = 'btn-primary';
      title = '끄기 기능: ⚙ 설정에서 SSH 활성화 필요';
    }
    statusDisabled = false;
  } else {
    label = '켜기'; disabled = false; cls = 'btn-primary'; mode = 'wake';
    statusDisabled = false;
  }

  if (toggleBtn.textContent !== label) toggleBtn.textContent = label;
  if (toggleBtn.disabled !== disabled) toggleBtn.disabled = disabled;
  if (toggleBtn.dataset.mode !== mode) toggleBtn.dataset.mode = mode;
  if (toggleBtn.title !== title) toggleBtn.title = title;
  toggleBtn.classList.toggle('btn-primary', cls === 'btn-primary');
  toggleBtn.classList.toggle('btn-warn', cls === 'btn-warn');
  if (statusBtn.disabled !== statusDisabled) statusBtn.disabled = statusDisabled;
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

  if (!computers.length) {
    // 노드 캐시 비우고 empty 상태로 교체.
    renderedById.clear();
    container.replaceChildren(emptyMessage());
    return;
  }

  // 빈/empty 상태에서 진입한 경우 등 캐시와 DOM 이 어긋날 수 있어 정합화.
  if (container.firstElementChild && !container.firstElementChild.dataset.id) {
    container.replaceChildren();
    renderedById.clear();
  }

  const nextIds = new Set(computers.map((c) => c.id));

  // 새 목록에서 빠진 row 는 제거.
  for (const [id, node] of renderedById) {
    if (!nextIds.has(id)) {
      node.remove();
      renderedById.delete(id);
    }
  }

  // 순서대로 update / 신규 생성 후 올바른 위치에 배치.
  let cursor = null; // 마지막으로 자리잡힌 row — 다음 노드를 그 뒤에 둔다.
  for (const c of computers) {
    let node = renderedById.get(c.id);
    if (!node) {
      node = createComputerNode(c.id);
      renderedById.set(c.id, node);
    }
    updateComputerNode(node, c);

    const expectedNext = cursor ? cursor.nextElementSibling : container.firstElementChild;
    if (expectedNext !== node) {
      if (cursor) cursor.after(node);
      else container.prepend(node);
    }
    cursor = node;
  }
}

function emptyMessage() {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = '등록된 컴퓨터가 없습니다.';
  return p;
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
  // 탭 진입 시 백엔드에 전체 상태 체크를 트리거만 한다. 결과는 5초 폴링이
  // 자연스럽게 흡수하므로 추가 setTimeout 새로고침은 불필요. (예전엔 3초/10초
  // 두 번을 더 새로고침했지만, 폴링과 겹쳐 같은 시점에 다중 fetch 발생.)
  try {
    await api('/api/computers/check-all', { method: 'POST' });
  } catch {
    /* ignore */
  }
}
