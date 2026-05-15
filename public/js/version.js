import { $ } from './util.js';

let initialVersion = null;
let updateBannerShown = false;
let eventSource = null;
let lastWasError = false;

function handleVersion(version) {
  if (!initialVersion) {
    initialVersion = version;
    console.log(`[version] 초기 버전: ${version}`);
    lastWasError = false;
    return;
  }
  if (lastWasError) {
    console.log(`[version] 서버 재연결 (현재 버전 ${version})`);
    lastWasError = false;
  }
  if (version !== initialVersion && !updateBannerShown) {
    console.log(`[version] 변경 감지: ${initialVersion} → ${version}`);
    showUpdateBanner();
  }
}

// SSE 로 버전 스트림 구독. EventSource 가 disconnect 시 자동 재연결 해주므로
// 폴링 루프 불필요. 컨테이너 재시작 → 연결 끊김 → 자동 재연결 → 새 VERSION 수신.
export function startVersionStream() {
  if (eventSource) return;
  try {
    eventSource = new EventSource('/api/version/stream');
  } catch (err) {
    console.warn('[version] EventSource 생성 실패:', err.message);
    return;
  }
  eventSource.addEventListener('version', (e) => {
    try {
      const { version } = JSON.parse(e.data);
      handleVersion(version);
    } catch (err) {
      console.warn('[version] 데이터 파싱 실패:', err.message);
    }
  });
  eventSource.addEventListener('error', () => {
    // EventSource 가 자동 재연결. 로그만 한 번 남기고 마킹.
    if (!lastWasError) {
      console.warn('[version] SSE 연결 끊김 (서버 재시작 중?) — 자동 재연결 대기');
    }
    lastWasError = true;
  });
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
}

// 폴링 시절 호출 지점 호환용 — 이제 no-op.
export async function checkVersion() {
  // SSE 가 모든 변경 감지를 담당. 이 함수는 더 이상 의미 없음.
}
