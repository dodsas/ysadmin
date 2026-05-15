// 모니터링 feature (프론트엔드) — 외부 URL Keep-Alive 핑
import {
  refreshTargets,
  setupAddForm,
  setupRefreshButton,
  setTargetsContainer,
  setupTargetSettingsDialog,
  setupTargetFrameDialog,
} from '../js/targets.js';
import { $ } from '../js/util.js';

export const keepaliveFeature = {
  id: 'keepalive',
  label: '모니터링',
  description: 'render.com 등 외부 URL 주기 핑',
  panelId: 'keepalive',
  init() {
    setTargetsContainer($('#targets'));
    setupAddForm();
    setupRefreshButton();
    setupTargetSettingsDialog();
    setupTargetFrameDialog();
  },
  onEnter: null,
  refresh: refreshTargets,
};
