import { $ } from './util.js';

const SETUP_WATCH_INTERVAL_MS = 3000;

let authState = { initialized: false, authenticated: false, username: null };
let setupWatchTimer = null;
let onAuthenticatedCallback = async () => {};

export function getAuthState() {
  return authState;
}

export function isAuthenticated() {
  return authState.authenticated;
}

export function setOnAuthenticated(fn) {
  onAuthenticatedCallback = fn;
}

export async function fetchAuthState() {
  const res = await fetch('/api/auth/state', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`auth state ${res.status}`);
  authState = await res.json();
  return authState;
}

function startSetupWatch() {
  stopSetupWatch();
  setupWatchTimer = setInterval(async () => {
    try {
      const state = await fetchAuthState();
      if (state.authenticated) {
        stopSetupWatch();
        hideAuthOverlay();
        showUserMenu(state.username);
        await onAuthenticatedCallback();
      } else if (state.initialized) {
        stopSetupWatch();
        showAuthOverlay('login');
      }
    } catch {
      /* 일시적 네트워크 오류는 무시 */
    }
  }, SETUP_WATCH_INTERVAL_MS);
}

function stopSetupWatch() {
  if (setupWatchTimer) {
    clearInterval(setupWatchTimer);
    setupWatchTimer = null;
  }
}

export function showAuthOverlay(mode) {
  const overlay = $('#auth-overlay');
  const title = $('#auth-title');
  const desc = $('#auth-desc');
  const submit = $('#auth-submit');
  const confirmWrap = $('#auth-password-confirm-wrap');
  const confirmInput = $('#auth-password-confirm');
  const rememberWrap = $('#auth-remember-wrap');
  const err = $('#auth-error');

  err.hidden = true;
  err.textContent = '';
  $('#auth-form').reset();

  if (mode === 'setup') {
    title.textContent = '초기 설정';
    desc.textContent = '관리자 아이디와 비밀번호를 설정해주세요. 이후 이 정보로 로그인합니다.';
    submit.textContent = '계정 만들기';
    confirmWrap.hidden = false;
    confirmInput.required = true;
    rememberWrap.style.display = '';
  } else {
    title.textContent = '로그인';
    desc.textContent = '아이디와 비밀번호를 입력하세요.';
    submit.textContent = '로그인';
    confirmWrap.hidden = true;
    confirmInput.required = false;
    rememberWrap.style.display = '';
  }
  overlay.dataset.mode = mode;
  overlay.hidden = false;
  document.body.classList.add('is-auth-blocked');
  setTimeout(() => $('#auth-username').focus(), 0);
  if (mode === 'setup') {
    startSetupWatch();
  } else {
    stopSetupWatch();
  }
}

export function hideAuthOverlay() {
  $('#auth-overlay').hidden = true;
  document.body.classList.remove('is-auth-blocked');
  stopSetupWatch();
}

export function showUserMenu(username) {
  void username;
  const btn = document.getElementById('logout-link');
  if (btn) btn.hidden = false;
}

export function hideUserMenu() {
  const btn = document.getElementById('logout-link');
  if (btn) btn.hidden = true;
}

function setAuthError(message) {
  const err = $('#auth-error');
  err.textContent = message;
  err.hidden = !message;
}

function onUnauthorized() {
  if (!authState.authenticated) return;
  authState.authenticated = false;
  authState.username = null;
  hideUserMenu();
  showAuthOverlay('login');
}

export function setupAuthForm() {
  const form = $('#auth-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = $('#auth-overlay').dataset.mode;
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    const remember = $('#auth-remember').checked;
    setAuthError('');

    if (mode === 'setup') {
      const confirmVal = $('#auth-password-confirm').value;
      if (password !== confirmVal) {
        setAuthError('비밀번호가 일치하지 않습니다.');
        return;
      }
    }

    const submit = $('#auth-submit');
    submit.disabled = true;
    try {
      const path = mode === 'setup' ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && mode === 'setup') {
          showAuthOverlay('login');
          setAuthError('이미 다른 곳에서 초기 설정이 완료되었습니다. 로그인해주세요.');
          return;
        }
        setAuthError(data.error || '요청 실패');
        return;
      }
      authState = { initialized: true, authenticated: true, username: data.username };
      hideAuthOverlay();
      showUserMenu(data.username);
      await onAuthenticatedCallback();
    } catch (err) {
      setAuthError(err.message || '요청 실패');
    } finally {
      submit.disabled = false;
    }
  });
}

export function setupLogout() {
  const btn = document.getElementById('logout-link');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      /* ignore */
    }
    authState = { initialized: true, authenticated: false, username: null };
    hideUserMenu();
    showAuthOverlay('login');
  });
}

window.addEventListener('auth:unauthorized', onUnauthorized);
