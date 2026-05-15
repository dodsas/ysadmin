import { $, api } from './util.js';

function fmtDate(s) {
  if (!s) return '미사용';
  try {
    return new Date(s).toLocaleString('ko-KR', { hour12: false });
  } catch {
    return s;
  }
}

async function refresh() {
  const list = $('#api-keys-list');
  list.innerHTML = '';
  try {
    const { keys } = await api('/api/admin/api-keys');
    if (!keys.length) {
      list.innerHTML = '<li class="empty">발급된 키 없음</li>';
      return;
    }
    for (const k of keys) {
      const li = document.createElement('li');
      li.className = 'api-key-row';
      li.innerHTML = `
        <div class="api-key-info">
          <div class="api-key-label"></div>
          <div class="api-key-meta">
            <code class="api-key-hint"></code>
            · 발급 <span data-created></span>
            · 최근 <span data-last></span>
          </div>
        </div>
        <button class="btn btn-danger" type="button" data-revoke>폐기</button>`;
      li.querySelector('.api-key-label').textContent = k.label;
      li.querySelector('.api-key-hint').textContent = k.hint;
      li.querySelector('[data-created]').textContent = fmtDate(k.createdAt);
      li.querySelector('[data-last]').textContent = fmtDate(k.lastUsedAt);
      li.querySelector('[data-revoke]').addEventListener('click', async () => {
        if (!confirm(`정말 폐기하시겠습니까?\n${k.label}`)) return;
        await api(`/api/admin/api-keys/${k.id}`, { method: 'DELETE' });
        await refresh();
      });
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = `<li class="empty">${err.message}</li>`;
  }
}

export function setupApiKeysDialog() {
  const dlg = $('#api-keys-dialog');
  const btn = $('#api-keys-link');
  const form = $('#api-key-create-form');
  const issued = $('#api-key-issued');

  if (!dlg || !btn) return;

  btn.addEventListener('click', async () => {
    issued.hidden = true;
    issued.textContent = '';
    form.label.value = '';
    await refresh();
    dlg.showModal();
  });

  dlg.querySelector('[data-dialog-close]').addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = form.label.value.trim();
    if (!label) return;
    try {
      const { key } = await api('/api/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({ label }),
      });
      issued.hidden = false;
      issued.textContent = key;
      form.label.value = '';
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  });
}
