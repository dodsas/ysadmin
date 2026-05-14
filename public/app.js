const POLL_INTERVAL_MS = 5000;
const VERSION_POLL_MS = 10000;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let isDragging = false;
let draggingId = null;

function setupTabs() {
  const tabs = $$('.tab');
  const panels = $$('.panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === target));
      if (target === 'computers') {
        onEnterComputersTab();
      }
    });
  });
}

async function onEnterComputersTab() {
  try {
    const result = await api('/api/computers/check-all', { method: 'POST' });
    // 서버가 실제로 시작했으면 결과 반영을 위해 잠시 뒤 리프레시
    if (result && result.ok) {
      setTimeout(() => refreshComputers().catch(() => {}), 3000);
      setTimeout(() => refreshComputers().catch(() => {}), 10000);
    }
  } catch {
    /* ignore */
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function formatTimestamp(iso) {
  if (!iso) return '아직 체크 전';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { hour12: false });
}

function statusLabel(status) {
  switch (status) {
    case 'up':
      return '정상';
    case 'down':
      return '응답 없음';
    default:
      return '확인 중';
  }
}

function attachDragHandlers(node, id, ctx) {
  node.addEventListener('dragstart', (e) => {
    isDragging = true;
    draggingId = id;
    node.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  });

  node.addEventListener('dragend', () => {
    isDragging = false;
    draggingId = null;
    node.classList.remove('is-dragging');
    $$('.target.is-drop-target', ctx.container).forEach((el) =>
      el.classList.remove('is-drop-target'),
    );
  });

  node.addEventListener('dragover', (e) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    $$('.target.is-drop-target', ctx.container).forEach((el) => {
      if (el !== node) el.classList.remove('is-drop-target');
    });
    node.classList.add('is-drop-target');
  });

  node.addEventListener('dragleave', (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    node.classList.remove('is-drop-target');
  });

  node.addEventListener('drop', async (e) => {
    e.preventDefault();
    node.classList.remove('is-drop-target');
    const sourceId = e.dataTransfer.getData('text/plain') || draggingId;
    if (!sourceId || sourceId === id) return;
    await moveItem(sourceId, id, ctx);
  });
}

async function moveItem(sourceId, targetId, ctx) {
  const items = $$('.target', ctx.container);
  const order = items.map((el) => el.dataset.id).filter(Boolean);
  const fromIdx = order.indexOf(sourceId);
  const toIdx = order.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, sourceId);
  reorderDom(ctx.container, order);
  try {
    await api(ctx.orderEndpoint, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  } catch (err) {
    alert(err.message);
    await ctx.refresh();
  }
}

function reorderDom(container, orderedIds) {
  const map = new Map();
  $$('.target', container).forEach((el) => map.set(el.dataset.id, el));
  orderedIds.forEach((id) => {
    const el = map.get(id);
    if (el) container.appendChild(el);
  });
}

// ===== Keep-Alive targets =====

const targetsCtx = {
  container: null,
  orderEndpoint: '/api/targets/order',
  refresh: () => refreshTargets(),
};

function renderTarget(target) {
  const tpl = $('#target-row');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = target.id;

  const statusEl = $('[data-status]', node);
  statusEl.dataset.status = target.status || 'unknown';
  $('.status-label', statusEl).textContent = statusLabel(target.status);

  $('[data-label]', node).textContent = target.label || target.url;
  const urlEl = $('[data-url]', node);
  urlEl.textContent = target.url;
  urlEl.href = target.url;

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

  $('[data-action="delete"]', node).addEventListener('click', async () => {
    if (!confirm(`정말 삭제하시겠습니까?\n${target.url}`)) return;
    try {
      await api(`/api/targets/${target.id}`, { method: 'DELETE' });
      await refreshTargets();
    } catch (err) {
      alert(err.message);
    }
  });

  attachDragHandlers(node, target.id, targetsCtx);

  return node;
}

async function refreshTargets() {
  if (isDragging) return;
  const { targets } = await api('/api/targets');
  const container = targetsCtx.container;
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

function setupAddForm() {
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

function setupRefreshButton() {
  $('#refresh-btn').addEventListener('click', () => {
    refreshTargets().catch((err) => alert(err.message));
  });
}

// ===== Computers (WoL) =====

const computersCtx = {
  container: null,
  orderEndpoint: '/api/computers/order',
  refresh: () => refreshComputers(),
};

const WAKE_WINDOW_MS = 60000;
const WAKE_POLL_INTERVAL_MS = 5000;
const SHUTDOWN_WINDOW_MS = 60000;
const activePolls = new Set();
const activeShutdowns = new Set();

function isWaking(computer) {
  if (computer.lastStatus === 'up') return false;
  if (!computer.lastWakeAt) return false;
  return Date.now() - new Date(computer.lastWakeAt).getTime() < WAKE_WINDOW_MS;
}

function computerStatusLabel(s) {
  if (s === 'up') return '켜짐';
  if (s === 'down') return '꺼짐';
  return '미확인';
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
  $('[data-meta]', node).textContent = metaParts.join(' · ');

  const wakeBtn = $('[data-action="wake"]', node);
  const statusBtn = $('[data-action="status"]', node);
  const shutdownBtn = $('[data-action="shutdown"]', node);
  const shuttingDown = activeShutdowns.has(computer.id);

  if (shuttingDown) {
    wakeBtn.textContent = '전원 켜기';
    wakeBtn.disabled = true;
    shutdownBtn.textContent = '끄는 중...';
    shutdownBtn.disabled = true;
    statusBtn.disabled = true;
  } else if (lastStatus === 'up') {
    wakeBtn.textContent = '✓ 켜짐';
    wakeBtn.disabled = true;
    shutdownBtn.disabled = !(computer.shutdown && computer.shutdown.enabled);
    if (!shutdownBtn.disabled) shutdownBtn.title = '';
    else shutdownBtn.title = '설정에서 SSH 끄기 활성화 필요';
  } else if (waking) {
    wakeBtn.textContent = '켜는 중...';
    wakeBtn.disabled = true;
    statusBtn.disabled = true;
    shutdownBtn.disabled = true;
  } else {
    wakeBtn.textContent = '전원 켜기';
    wakeBtn.disabled = false;
    shutdownBtn.disabled = true; // 꺼져있을 땐 끄기 불가
    shutdownBtn.title = '컴퓨터가 켜져있을 때만 끌 수 있습니다';
  }

  $('[data-action="wake"]', node).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '전송 중...';
    try {
      await api(`/api/computers/${computer.id}/wake`, { method: 'POST' });
      await refreshComputers();
      pollComputerStatus(computer.id, WAKE_WINDOW_MS, WAKE_POLL_INTERVAL_MS);
    } catch (err) {
      alert(err.message);
      await refreshComputers();
    }
  });

  $('[data-action="shutdown"]', node).addEventListener('click', async () => {
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
  });

  $('[data-action="settings"]', node).addEventListener('click', () => {
    openSettingsDialog(computer);
  });

  $('[data-action="status"]', node).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '확인 중...';
    try {
      await api(`/api/computers/${computer.id}/status`);
      await refreshComputers();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = original;
      btn.disabled = false;
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

  attachDragHandlers(node, computer.id, computersCtx);

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

function setupSettingsDialog() {
  const dlg = $('#computer-settings-dialog');
  const form = $('#computer-settings-form');
  form.querySelector('[data-dialog-cancel]').addEventListener('click', () => dlg.close());

  // OS 변경 시 명령어 자동 채워넣기 (사용자가 비워둔 경우만)
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
        sshPassword: form.sshPassword.value, // 그대로 (trim 없이)
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

// Wake 직후에만 호출. up 으로 확인되거나 maxDurationMs 경과 시 종료.
// refresh 에서는 자동 재개하지 않음 — 사용자가 다시 wake 누르거나 상태확인 눌러야 다시 확인됨.
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

async function refreshComputers() {
  if (isDragging) return;
  const { computers } = await api('/api/computers');
  const container = computersCtx.container;
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

function setupAddComputerForm() {
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

function setupRefreshComputersButton() {
  $('#refresh-computers-btn').addEventListener('click', () => {
    refreshComputers().catch((err) => alert(err.message));
  });
}

// ===== 버전 갱신 감지 =====

let initialVersion = null;
let updateBannerShown = false;
let lastVersionWasDown = false;

async function checkVersion() {
  try {
    // 캐시버스터로 강제 새 요청
    const res = await fetch(`/api/version?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { version } = await res.json();
    if (!initialVersion) {
      initialVersion = version;
      console.log(`[version] 초기 버전: ${version}`);
      lastVersionWasDown = false;
      return;
    }
    const cameBackUp = lastVersionWasDown;
    lastVersionWasDown = false;
    if (version !== initialVersion && !updateBannerShown) {
      console.log(`[version] 변경 감지: ${initialVersion} → ${version}`);
      showUpdateBanner();
    } else if (cameBackUp && !updateBannerShown) {
      // 서버가 잠시 끊겼다가 돌아옴 — 버전이 같아도 재시작했을 가능성
      console.log(`[version] 서버 다운→업 감지 (현재 버전 ${version})`);
    }
  } catch (err) {
    if (!lastVersionWasDown) {
      console.warn(`[version] 폴링 실패 (서버 재시작 중?):`, err.message);
    }
    lastVersionWasDown = true;
  }
}

function showUpdateBanner() {
  const banner = $('#update-banner');
  if (!banner) return;
  banner.hidden = false;
  document.body.classList.add('has-update');
  updateBannerShown = true;
}

function setupUpdateBanner() {
  $('#update-banner-reload').addEventListener('click', () => location.reload());
  $('#update-banner-dismiss').addEventListener('click', () => {
    $('#update-banner').hidden = true;
    document.body.classList.remove('has-update');
  });
  // 탭이 다시 활성화되면 즉시 1회 체크 (백그라운드에서 setInterval throttled 됐을 수 있음)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkVersion().catch(() => {});
    }
  });
}

// ===== Bootstrap =====

targetsCtx.container = $('#targets');
computersCtx.container = $('#computers');

setupTabs();
setupAddForm();
setupRefreshButton();
setupAddComputerForm();
setupRefreshComputersButton();
setupUpdateBanner();
setupSettingsDialog();

refreshTargets().catch((err) => console.error(err));
refreshComputers().catch((err) => console.error(err));
checkVersion().catch((err) => console.error(err));

setInterval(() => {
  refreshTargets().catch((err) => console.error(err));
  refreshComputers().catch((err) => console.error(err));
}, POLL_INTERVAL_MS);

setInterval(() => {
  checkVersion().catch((err) => console.error(err));
}, VERSION_POLL_MS);
