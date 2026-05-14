import { $, $$, api } from './util.js';

let isDragging = false;
let draggingKey = null;
let currentOrder = [];

export function isTabDragging() {
  return isDragging;
}

function tabBar() {
  return $('.tabs');
}

export function applyTabOrder(order) {
  const bar = tabBar();
  const main = document.querySelector('main');
  if (!bar || !main) return;
  const tabMap = new Map($$('.tab', bar).map((t) => [t.dataset.tab, t]));
  const panelMap = new Map($$('.panel', main).map((p) => [p.dataset.panel, p]));
  // 로그아웃 등 .tabbar-action 은 항상 탭 뒤(우측 끝)에 머물러야 하므로 탭은 그 앞에 삽입한다
  const trailing = bar.querySelector('.tabbar-action');
  order.forEach((key) => {
    const t = tabMap.get(key);
    const p = panelMap.get(key);
    if (t) bar.insertBefore(t, trailing);
    if (p) main.appendChild(p);
  });
  currentOrder = order.slice();
}

export async function fetchTabOrder() {
  const { order } = await api('/api/tabs/order');
  return order;
}

async function persistOrder(order) {
  const { order: confirmed } = await api('/api/tabs/order', {
    method: 'PUT',
    body: JSON.stringify({ order }),
  });
  return confirmed;
}

function attachDragHandlers(tab) {
  tab.draggable = true;

  tab.addEventListener('dragstart', (e) => {
    isDragging = true;
    draggingKey = tab.dataset.tab;
    tab.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tab.dataset.tab);
  });

  tab.addEventListener('dragend', () => {
    isDragging = false;
    draggingKey = null;
    tab.classList.remove('is-dragging');
    $$('.tab.is-drop-target').forEach((el) => el.classList.remove('is-drop-target'));
  });

  tab.addEventListener('dragover', (e) => {
    if (!draggingKey || draggingKey === tab.dataset.tab) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    $$('.tab.is-drop-target').forEach((el) => {
      if (el !== tab) el.classList.remove('is-drop-target');
    });
    tab.classList.add('is-drop-target');
  });

  tab.addEventListener('dragleave', (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    tab.classList.remove('is-drop-target');
  });

  tab.addEventListener('drop', async (e) => {
    e.preventDefault();
    tab.classList.remove('is-drop-target');
    const sourceKey = e.dataTransfer.getData('text/plain') || draggingKey;
    if (!sourceKey || sourceKey === tab.dataset.tab) return;
    const targetKey = tab.dataset.tab;
    const order = $$('.tab', tabBar()).map((t) => t.dataset.tab);
    const fromIdx = order.indexOf(sourceKey);
    const toIdx = order.indexOf(targetKey);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, sourceKey);
    applyTabOrder(order);
    try {
      const confirmed = await persistOrder(order);
      applyTabOrder(confirmed);
    } catch (err) {
      alert(err.message);
      try {
        const fresh = await fetchTabOrder();
        applyTabOrder(fresh);
      } catch {
        /* swallow */
      }
    }
  });
}

export function setupTabDragAndDrop() {
  $$('.tab').forEach(attachDragHandlers);
}

export async function initTabOrder() {
  try {
    const order = await fetchTabOrder();
    applyTabOrder(order);
  } catch (err) {
    console.warn('[tabs] order fetch failed:', err.message);
  }
}

export async function pollTabOrder() {
  if (isDragging) return;
  try {
    const order = await fetchTabOrder();
    if (order.join(',') !== currentOrder.join(',')) {
      applyTabOrder(order);
    }
  } catch {
    /* ignore polling errors */
  }
}
