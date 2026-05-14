const POLL_INTERVAL_MS = 5000;
const VERSION_POLL_MS = 30000;

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
    });
  });
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

function renderComputer(computer) {
  const tpl = $('#computer-row');
  const node = tpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = computer.id;

  const statusEl = $('[data-status]', node);
  statusEl.dataset.status = 'unknown';
  $('.status-label', statusEl).textContent = '미확인';

  $('[data-label]', node).textContent = computer.label || computer.mac;
  $('[data-mac]', node).textContent = computer.mac + (computer.ip ? ` · ${computer.ip}` : '');

  $('[data-meta]', node).textContent = `마지막 부팅 시도: ${formatTimestamp(computer.lastWakeAt)}`;

  $('[data-action="wake"]', node).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '전송 중...';
    try {
      await api(`/api/computers/${computer.id}/wake`, { method: 'POST' });
      btn.textContent = '✓ 전송됨';
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
      pollComputerStatus(node, computer.id, 12, 5000);
      await refreshComputers();
    } catch (err) {
      alert(err.message);
      btn.textContent = original;
      btn.disabled = false;
    }
  });

  $('[data-action="status"]', node).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '확인 중...';
    try {
      const { status } = await api(`/api/computers/${computer.id}/status`);
      applyStatusToNode(node, status);
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

function applyStatusToNode(node, status) {
  const statusEl = $('[data-status]', node);
  if (status.up) {
    statusEl.dataset.status = 'up';
    $('.status-label', statusEl).textContent = '켜짐';
  } else {
    statusEl.dataset.status = 'down';
    $('.status-label', statusEl).textContent = '꺼짐';
  }
}

async function pollComputerStatus(node, id, attempts, intervalMs) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const { status } = await api(`/api/computers/${id}/status`);
      applyStatusToNode(node, status);
      if (status.up) return;
    } catch {
      /* keep polling */
    }
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

async function checkVersion() {
  try {
    const { version } = await api('/api/version');
    if (!initialVersion) {
      initialVersion = version;
      return;
    }
    if (version !== initialVersion && !updateBannerShown) {
      showUpdateBanner();
    }
  } catch {
    /* 일시적 오류는 무시 — 다음 폴링 때 재시도 */
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

refreshTargets().catch((err) => console.error(err));
refreshComputers().catch((err) => console.error(err));
checkVersion().catch((err) => console.error(err));

setInterval(() => {
  refreshTargets().catch((err) => console.error(err));
}, POLL_INTERVAL_MS);

setInterval(() => {
  checkVersion().catch((err) => console.error(err));
}, VERSION_POLL_MS);
