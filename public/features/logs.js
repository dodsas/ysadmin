// 로그 feature (프론트엔드) — 서버 로그 조회
import { onEnterLogsTab, setupLogsTab } from '../js/logs.js';

export const logsFeature = {
  id: 'logs',
  label: '로그',
  description: '서버 로그 (logs/ysadmin.log)',
  panelId: 'logs',
  init() {
    setupLogsTab();
  },
  onEnter: onEnterLogsTab,
  refresh: null,
};
