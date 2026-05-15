// 피씨 feature (프론트엔드) — 컴퓨터 켜기/끄기 UI
import {
  refreshComputers,
  onEnterComputersTab,
  setupAddComputerForm,
  setupRefreshComputersButton,
  setupSettingsDialog,
  setComputersContainer,
} from '../js/computers.js';
import { $ } from '../js/util.js';

export const pcFeature = {
  id: 'computers',
  label: '피씨',
  description: '컴퓨터 원격 켜기/끄기 (Wake-on-LAN + SSH shutdown)',
  panelId: 'computers',
  init() {
    setComputersContainer($('#computers'));
    setupAddComputerForm();
    setupRefreshComputersButton();
    setupSettingsDialog();
  },
  onEnter: onEnterComputersTab,
  refresh: refreshComputers,
};
