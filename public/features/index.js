// 프론트엔드 feature 레지스트리.
// 새로운 기능을 추가하려면 features/<name>.js 를 만들고 아래 배열에 등록만 하면 된다.
import { pcFeature } from './pc.js';
import { menuFeature } from './menu.js';
import { keepaliveFeature } from './keepalive.js';
import { logsFeature } from './logs.js';

export const features = [pcFeature, menuFeature, keepaliveFeature, logsFeature];

export function getFeature(id) {
  return features.find((f) => f.id === id) || null;
}

// 각 feature 의 일회성 setup (이벤트 바인딩 등) 을 실행.
export function initFeatures() {
  for (const f of features) {
    if (typeof f.init === 'function') {
      try {
        f.init();
      } catch (err) {
        console.error(`[features] ${f.id} init failed:`, err);
      }
    }
  }
}

// 탭 진입 시 호출.
export function onEnterFeature(id) {
  const f = getFeature(id);
  if (!f || typeof f.onEnter !== 'function') return Promise.resolve();
  return Promise.resolve()
    .then(() => f.onEnter())
    .catch((err) => console.error(`[features] ${id} onEnter failed:`, err));
}

// 주기 폴링 시 호출.
export function refreshAll() {
  return Promise.allSettled(
    features
      .filter((f) => typeof f.refresh === 'function')
      .map((f) =>
        Promise.resolve()
          .then(() => f.refresh())
          .catch((err) => console.error(`[features] ${f.id} refresh failed:`, err)),
      ),
  );
}

// 인증 직후 1회 fetch 로 모든 feature 데이터를 미리 채워둔다.
export function primeAll() {
  return refreshAll();
}
