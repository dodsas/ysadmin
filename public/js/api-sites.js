// OPENAPI feature (프론트엔드) — 사이트 디렉터리 표 렌더링
import { $, api } from './util.js';

const ctx = { tbody: null };

// favicon 로드 실패 시 보여줄 폴백 글로브 아이콘.
const FALLBACK_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="%238b93a7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  );

export function setApiSitesContainer(el) {
  ctx.tbody = el;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function renderRow(site) {
  const tr = document.createElement('tr');
  tr.dataset.id = site.id;

  const iconCell = document.createElement('td');
  iconCell.className = 'apisite-icon-cell';
  const img = document.createElement('img');
  img.className = 'apisite-favicon';
  img.alt = '';
  img.loading = 'lazy';
  img.width = 20;
  img.height = 20;
  img.src = `/api/apisites/${site.id}/favicon`;
  img.addEventListener('error', () => {
    if (img.src !== FALLBACK_ICON) img.src = FALLBACK_ICON;
  });
  iconCell.appendChild(img);

  const nameCell = document.createElement('td');
  nameCell.className = 'apisite-name-cell';
  const nameLink = document.createElement('a');
  nameLink.className = 'apisite-name';
  nameLink.href = site.url;
  nameLink.target = '_blank';
  nameLink.rel = 'noreferrer';
  nameLink.textContent = site.name || hostnameOf(site.url);
  nameCell.appendChild(nameLink);

  const urlCell = document.createElement('td');
  urlCell.className = 'apisite-url-cell';
  const urlLink = document.createElement('a');
  urlLink.className = 'apisite-url';
  urlLink.href = site.url;
  urlLink.target = '_blank';
  urlLink.rel = 'noreferrer';
  urlLink.textContent = site.url;
  urlCell.appendChild(urlLink);

  const purposeCell = document.createElement('td');
  purposeCell.className = 'apisite-purpose-cell';
  purposeCell.textContent = site.purpose || '—';

  const actionsCell = document.createElement('td');
  actionsCell.className = 'apisite-actions-cell';
  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost';
  editBtn.type = 'button';
  editBtn.title = '설정';
  editBtn.textContent = '⚙';
  editBtn.addEventListener('click', () => openApiSiteDialog(site));
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger';
  delBtn.type = 'button';
  delBtn.textContent = '삭제';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`정말 삭제하시겠습니까?\n${site.name || site.url}`)) return;
    try {
      await api(`/api/apisites/${site.id}`, { method: 'DELETE' });
      await refreshApiSites();
    } catch (err) {
      alert(err.message);
    }
  });
  actionsCell.append(editBtn, delBtn);

  tr.append(iconCell, nameCell, urlCell, purposeCell, actionsCell);
  return tr;
}

export async function refreshApiSites() {
  if (!ctx.tbody) return;
  const { sites } = await api('/api/apisites');
  const wrap = $('#apisites-table-wrap');
  const empty = $('#apisites-empty');
  ctx.tbody.innerHTML = '';
  if (!sites.length) {
    if (wrap) wrap.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  if (wrap) wrap.hidden = false;
  if (empty) empty.hidden = true;
  sites.forEach((s) => ctx.tbody.appendChild(renderRow(s)));
}

export function setupApiSiteRefreshButton() {
  const btn = $('#apisites-refresh-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    refreshApiSites().catch((err) => alert(err.message));
  });
}

export function setupApiSiteAddForm() {
  const form = $('#add-apisite-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = form.url.value.trim();
    if (!url) return;
    try {
      await api('/api/apisites', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.value.trim() || undefined,
          url,
          purpose: form.purpose.value.trim() || undefined,
        }),
      });
      form.reset();
      await refreshApiSites();
    } catch (err) {
      alert(err.message);
    }
  });
}

function openApiSiteDialog(site) {
  const dlg = $('#apisite-settings-dialog');
  const form = $('#apisite-settings-form');
  form.name.value = site.name || '';
  form.url.value = site.url || '';
  form.purpose.value = site.purpose || '';
  form.dataset.id = site.id;
  dlg.showModal();
}

export function setupApiSiteSettingsDialog() {
  const dlg = $('#apisite-settings-dialog');
  const form = $('#apisite-settings-form');
  if (!dlg || !form) return;
  form.querySelector('[data-dialog-cancel]').addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = form.dataset.id;
    if (!id) return;
    try {
      await api(`/api/apisites/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name.value.trim(),
          url: form.url.value.trim(),
          purpose: form.purpose.value.trim(),
        }),
      });
      dlg.close();
      await refreshApiSites();
    } catch (err) {
      alert(err.message);
    }
  });
}
