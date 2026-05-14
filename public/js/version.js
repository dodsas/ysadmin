import { $ } from './util.js';

let initialVersion = null;
let updateBannerShown = false;
let lastVersionWasDown = false;

export async function checkVersion() {
  try {
    const res = await fetch(`/api/version?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { version } = await res.json();
    if (!initialVersion) {
      initialVersion = version;
      console.log(`[version] 초기 버전: ${version}`);
      lastVersionWasDown = false;
      return;
    }
    const cameBackUp = lastVersionWasDown;
    lastVersionWasDown = false;
    if (version !== initialVersion && !updateBannerShown) {
      console.log(`[version] 변경 감지: ${initialVersion} → ${version}`);
      showUpdateBanner();
    } else if (cameBackUp && !updateBannerShown) {
      console.log(`[version] 서버 다운→업 감지 (현재 버전 ${version})`);
    }
  } catch (err) {
    if (!lastVersionWasDown) {
      console.warn(`[version] 폴링 실패 (서버 재시작 중?):`, err.message);
    }
    lastVersionWasDown = true;
  }
}

function showUpdateBanner() {
  const banner = $('#update-banner');
  if (!banner) return;
  banner.hidden = false;
  document.body.classList.add('has-update');
  updateBannerShown = true;
}

export function setupUpdateBanner() {
  $('#update-banner-reload').addEventListener('click', () => location.reload());
  $('#update-banner-dismiss').addEventListener('click', () => {
    $('#update-banner').hidden = true;
    document.body.classList.remove('has-update');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkVersion().catch(() => {});
    }
  });
}
