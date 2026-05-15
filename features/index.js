// Feature 레지스트리 — 탭별 기능을 플러그형 모듈로 노출.
// 새로운 기능을 추가하려면 features/<name>.js 를 만들고 아래 배열에 등록만 하면 된다.
import { pcFeature } from './pc.js';
import { menuFeature } from './menu.js';
import { keepaliveFeature } from './keepalive.js';
import { logsFeature } from './logs.js';
import { publicApiFeature } from './public-api.js';

export const features = [pcFeature, menuFeature, keepaliveFeature, logsFeature, publicApiFeature];

export const featureIds = features.map((f) => f.id);

export function getFeature(id) {
  return features.find((f) => f.id === id) || null;
}

export function registerFeatures(app) {
  for (const f of features) {
    if (typeof f.register === 'function') f.register(app);
  }
}

export function startFeatureSchedulers() {
  for (const f of features) {
    if (typeof f.startSchedulers === 'function') f.startSchedulers();
  }
}
