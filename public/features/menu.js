// 메뉴 feature (프론트엔드) — 구내식당 식단 이미지
import {
  onEnterLunchTab,
  setupLunchRefreshButton,
  setupLunchImageZoom,
} from '../js/lunch.js';

export const menuFeature = {
  id: 'lunch',
  label: '메뉴',
  description: '구내식당 식단 이미지',
  panelId: 'lunch',
  init() {
    setupLunchRefreshButton();
    setupLunchImageZoom();
  },
  onEnter: onEnterLunchTab,
  // 식단은 탭 진입 시에만 갱신, 폴링 대상 아님
  refresh: null,
};
