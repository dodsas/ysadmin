import { $, api } from './util.js';

const MSG_PREVIEW_MAX = 220;

let lastEntries = [];

function formatTs(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function truncate(s, n) {
  if (typeof s !== 'string') return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function extraToCompact(extra) {
  if (!extra || typeof extra !== 'object') return '';
  try {
    const json = JSON.stringify(extra);
    return truncate(json, MSG_PREVIEW_MAX);
  } catch {
    return '';
  }
}

function renderEntry(entry) {
  const row = document.createElement('div');
  row.className = `log-row log-level-${entry.level || 'info'}`;

  const ts = document.createElement('span');
  ts.className = 'log-ts';
  ts.textContent = formatTs(entry.ts);

  const lvl = document.createElement('span');
  lvl.className = 'log-lvl';
  lvl.textContent = (entry.level || 'info').toUpperCase();

  const src = document.createElement('span');
  src.className = 'log-src';
  src.textContent = entry.source || '-';

  const msg = document.createElement('span');
  msg.className = 'log-msg';
  msg.textContent = truncate(String(entry.msg ?? ''), MSG_PREVIEW_MAX);

  row.appendChild(ts);
  row.appendChild(lvl);
  row.appendChild(src);
  row.appendChild(msg);

  if (entry.extra) {
    const extra = document.createElement('span');
    extra.className = 'log-extra';
    extra.textContent = extraToCompact(entry.extra);
    row.appendChild(extra);
  }

  return row;
}

export async function refreshLogs() {
  const limit = Number($('#logs-limit').value) || 200;
  const container = $('#logs-list');
  try {
    const { entries } = await api(`/api/logs?limit=${limit}`);
    lastEntries = entries || [];
    container.innerHTML = '';
    if (lastEntries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '로그가 없습니다.';
      container.appendChild(empty);
      return;
    }
    const frag = document.createDocumentFragment();
    lastEntries.forEach((e) => frag.appendChild(renderEntry(e)));
    container.appendChild(frag);
  } catch (err) {
    container.innerHTML = '';
    const e = document.createElement('p');
    e.className = 'empty';
    e.textContent = `로그 불러오기 실패: ${err.message}`;
    container.appendChild(e);
  }
}

function toCopyText() {
  return lastEntries
    .map((e) => {
      const ts = formatTs(e.ts);
      const lvl = (e.level || 'info').toUpperCase().padEnd(5);
      const src = e.source || '-';
      const msg = truncate(String(e.msg ?? ''), MSG_PREVIEW_MAX);
      const extra = e.extra ? ` ${extraToCompact(e.extra)}` : '';
      return `${ts} ${lvl} ${src} — ${msg}${extra}`;
    })
    .join('\n');
}

export function setupLogsTab() {
  $('#logs-refresh-btn').addEventListener('click', () => {
    refreshLogs().catch((err) => alert(err.message));
  });
  $('#logs-limit').addEventListener('change', () => {
    refreshLogs().catch((err) => alert(err.message));
  });
  $('#logs-copy-btn').addEventListener('click', async () => {
    const text = toCopyText();
    try {
      await navigator.clipboard.writeText(text);
      const btn = $('#logs-copy-btn');
      const orig = btn.textContent;
      btn.textContent = '복사됨';
      setTimeout(() => (btn.textContent = orig), 1500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
  });
}

export async function onEnterLogsTab() {
  await refreshLogs();
}
