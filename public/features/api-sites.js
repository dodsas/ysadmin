// OPENAPI feature (프론트엔드) — 사이트 디렉터리 표
import {
  refreshApiSites,
  setApiSitesContainer,
  setupApiSiteAddForm,
  setupApiSiteRefreshButton,
  setupApiSiteSettingsDialog,
} from '../js/api-sites.js';
import { $ } from '../js/util.js';

export const apiSitesFeature = {
  id: 'apisites',
  label: 'OPENAPI',
  description: '자주 쓰는 OpenAPI 사이트 디렉터리',
  panelId: 'apisites',
  init() {
    setApiSitesContainer($('#apisites-tbody'));
    setupApiSiteAddForm();
    setupApiSiteRefreshButton();
    setupApiSiteSettingsDialog();
  },
  onEnter: refreshApiSites,
  refresh: refreshApiSites,
};
