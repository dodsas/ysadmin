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
import { checkVersion, setupUpdateBanner } from './js/version.js';
import {
  refreshTargets,
  setupAddForm,
  setupRefreshButton,
  setTargetsContainer,
  setupTargetSettingsDialog,
  setupTargetFrameDialog,
} from './js/targets.js';
import {
  refreshComputers,
  onEnterComputersTab,
  setupAddComputerForm,
  setupRefreshComputersButton,
  setupSettingsDialog,
  setComputersContainer,
} from './js/computers.js';
import {
  onEnterLunchTab,
  setupLunchRefreshButton,
  setupLunchImageDialog,
} from './js/lunch.js';
import {
  initTabOrder,
  setupTabDragAndDrop,
  pollTabOrder,
} from './js/tabs.js';

const POLL_INTERVAL_MS = 5000;
const VERSION_POLL_MS = 10000;

let pollersStarted = false;

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
      } else if (target === 'lunch') {
        onEnterLunchTab();
      }
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
  await Promise.allSettled([refreshTargets(), refreshComputers(), checkVersion()]);
  onEnterComputersTab();
  if (pollersStarted) return;
  pollersStarted = true;
  setInterval(() => {
    if (!isAuthenticated()) return;
    refreshTargets().catch((err) => console.error(err));
    refreshComputers().catch((err) => console.error(err));
    pollTabOrder().catch((err) => console.error(err));
  }, POLL_INTERVAL_MS);
  setInterval(() => {
    if (!isAuthenticated()) return;
    checkVersion().catch((err) => console.error(err));
  }, VERSION_POLL_MS);
}

setOnAuthenticated(onAuthenticated);

setTargetsContainer($('#targets'));
setComputersContainer($('#computers'));

setupTabs();
setupAddForm();
setupRefreshButton();
setupAddComputerForm();
setupRefreshComputersButton();
setupUpdateBanner();
setupSettingsDialog();
setupTargetSettingsDialog();
setupTargetFrameDialog();
setupAuthForm();
setupLogout();
setupLunchRefreshButton();
setupLunchImageDialog();
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
