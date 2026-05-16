import { $, $$ } from './js/util.js';
import {
  fetchAuthState,
  getAuthState,
  isAuthenticated,
  showAuthOverlay,
  showUserMenu,
  setupAuthForm,
  setupLogout,
  setOnAuthenticated,
} from './js/auth.js';
import { startVersionStream, setupUpdateBanner } from './js/version.js';
import { setupApiKeysDialog } from './js/api-keys.js';
import {
  initTabOrder,
  setupTabDragAndDrop,
  pollTabOrder,
} from './js/tabs.js';
import {
  features,
  initFeatures,
  onEnterFeature,
  refreshAll,
} from './features/index.js';

const POLL_INTERVAL_MS = 5000;
const DEFAULT_TAB = features[0]?.id ?? null;

let pollersStarted = false;

function setupTabs() {
  const tabs = $$('.tab');
  const panels = $$('.panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      // 같은 탭 재터치 시 panel display 재토글로 reflow 가 일어나면
      // body.scrollHeight 가 바뀌어 sticky header 가 한 프레임 깜빡일 수 있음.
      // 이미 활성 상태면 아무것도 하지 않는다.
      if (tab.classList.contains('is-active')) return;
      const target = tab.dataset.tab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      panels.forEach((p) => p.classList.toggle('is-active', p.dataset.panel === target));
      // 패널마다 컨텐츠 양 차이가 커서 body.scrollHeight 가 급변한다.
      // 스크롤 위치가 새 패널 끝을 넘어가 있으면 브라우저가 transient
      // scrollTop 보정을 하면서 sticky header 가 한 프레임 깜빡인다.
      // 탭 전환 시 즉시 최상단으로 이동시켜 transient state 를 없앤다.
      window.scrollTo({ top: 0, behavior: 'auto' });
      onEnterFeature(target);
    });
  });
}

function setupAddToggle({ buttonId, formId, openLabel, closeLabel }) {
  const btn = document.getElementById(buttonId);
  const form = document.getElementById(formId);
  if (!btn || !form) return;
  btn.textContent = openLabel;
  btn.addEventListener('click', () => {
    const wasCollapsed = form.classList.contains('is-collapsed-mobile');
    if (wasCollapsed) {
      form.classList.remove('is-collapsed-mobile');
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = closeLabel;
      const firstInput = form.querySelector('input');
      if (firstInput) firstInput.focus();
    } else {
      form.classList.add('is-collapsed-mobile');
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = openLabel;
    }
  });
}

async function onAuthenticated() {
  await initTabOrder();
  await refreshAll();
  if (DEFAULT_TAB) onEnterFeature(DEFAULT_TAB);
  if (pollersStarted) return;
  pollersStarted = true;
  startPollers();
}

// 탭이 백그라운드/스탠바이 (iOS PWA 가 홈으로 빠지면 document.hidden=true) 일
// 때는 폴링을 멈춰 배터리·네트워크를 절약하고, 복귀 시 즉시 1회 refresh.
function startPollers() {
  let timer = null;
  let lastTickAt = 0;

  const tick = () => {
    if (!isAuthenticated()) return;
    lastTickAt = Date.now();
    refreshAll();
    pollTabOrder().catch((err) => console.error(err));
  };

  const start = () => {
    if (timer != null) return;
    timer = setInterval(tick, POLL_INTERVAL_MS);
  };

  const stop = () => {
    if (timer == null) return;
    clearInterval(timer);
    timer = null;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
    } else {
      if (Date.now() - lastTickAt >= POLL_INTERVAL_MS) tick();
      start();
    }
  });

  if (!document.hidden) start();
}

setOnAuthenticated(onAuthenticated);

initFeatures();
setupTabs();
setupUpdateBanner();
startVersionStream();
setupAuthForm();
setupLogout();
setupApiKeysDialog();
setupTabDragAndDrop();
setupAddToggle({
  buttonId: 'add-toggle',
  formId: 'add-form',
  openLabel: '+ URL 추가',
  closeLabel: '− 닫기',
});
setupAddToggle({
  buttonId: 'add-computer-toggle',
  formId: 'add-computer-form',
  openLabel: '+ 컴퓨터 추가',
  closeLabel: '− 닫기',
});

(async () => {
  try {
    await fetchAuthState();
  } catch (err) {
    console.error('[auth] state fetch failed:', err);
    showAuthOverlay('login');
    return;
  }
  const state = getAuthState();
  if (!state.initialized) {
    showAuthOverlay('setup');
  } else if (!state.authenticated) {
    showAuthOverlay('login');
  } else {
    showUserMenu(state.username);
    await onAuthenticated();
  }
})();
