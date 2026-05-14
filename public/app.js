const POLL_INTERVAL_MS = 5000;

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
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  $('[data-action="delete"]', node).addEventListener('click', async () => {
    if (!confirm(`정말 삭제하시겠습니까?\n${target.url}`)) return;
    try {
      await api(`/api/targets/${target.id}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });

  attachDragHandlers(node, target.id);

  return node;
}

function attachDragHandlers(node, id) {
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
    $$('.target.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
  });

  node.addEventListener('dragover', (e) => {
    if (!draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    $$('.target.is-drop-target').forEach((el) => {
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
    await moveTarget(sourceId, id);
  });
}

async function moveTarget(sourceId, targetId) {
  const container = $('#targets');
  const items = $$('.target', container);
  const order = items.map((el) => el.dataset.id).filter(Boolean);
  const fromIdx = order.indexOf(sourceId);
  const toIdx = order.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, sourceId);
  reorderDom(container, order);
  try {
    await api('/api/targets/order', {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
  } catch (err) {
    alert(err.message);
    await refresh();
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

async function refresh() {
  if (isDragging) return;
  const { targets } = await api('/api/targets');
  const container = $('#targets');
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
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
}

function setupRefreshButton() {
  $('#refresh-btn').addEventListener('click', () => {
    refresh().catch((err) => alert(err.message));
  });
}

setupTabs();
setupAddForm();
setupRefreshButton();
refresh().catch((err) => console.error(err));
setInterval(() => {
  refresh().catch((err) => console.error(err));
}, POLL_INTERVAL_MS);
