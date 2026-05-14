import { $$, api } from './util.js';

let isDragging = false;
let draggingId = null;

export function isDraggingActive() {
  return isDragging;
}

export function attachDragHandlers(node, id, ctx) {
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
