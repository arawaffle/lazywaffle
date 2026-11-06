// 설치형 자동 업데이트 (GitHub Releases · electron-updater)
// - 설치형(setup.exe 로 설치한 앱)에서만 동작한다. 포터블 · zip · 개발 실행은 건드리지 않는다.
// - 시작하고 조금 뒤 한 번, 그 뒤로 몇 시간마다 새 버전을 확인하고, 있으면 조용히 받아 둔다.
// - 받아 두면 '다시 시작해 업데이트'로 바로 적용하거나, 다음에 앱을 끌 때 자동으로 설치된다.

const FIRST_CHECK = 30 * 1000;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

/**
 * @param {object} o
 * @param {boolean} o.enabled    설치형 빌드인지
 * @param {(msg: string) => void} o.log
 * @param {() => void} o.onChange        상태가 바뀔 때 (트레이 · 설정 화면 갱신)
 * @param {(version: string) => void} o.onReady  새 버전을 다 받았을 때 (알림)
 * @param {() => void} o.beforeInstall   설치를 위해 앱을 끄기 직전
 */
function createUpdater({ enabled, log, onChange, onReady, beforeInstall }) {
  // status: idle | checking | none | downloading | ready | error
  const state = { enabled, status: 'idle', version: null, percent: 0, error: null, checkedAt: null };
  if (!enabled) return { state: () => ({ ...state }), check() {}, install() {}, start() {} };

  // 포터블에서는 불러오지도 않도록 여기서 require 한다
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  // 오류는 아래 'error' 이벤트에서 한 줄로 남긴다 (응답 헤더 · 스택까지 찍혀 로그가 금방 차지 않게)
  autoUpdater.logger = {
    info: (m) => log('updater ' + m),
    warn: (m) => log('updater warn ' + m),
    error: () => {},
    debug: () => {},
  };

  const set = (patch) => {
    Object.assign(state, patch);
    onChange();
  };

  autoUpdater.on('checking-for-update', () => {
    if (state.status !== 'ready') set({ status: 'checking', error: null });
  });
  autoUpdater.on('update-not-available', () => set({ status: 'none', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0, checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent || 0);
    if (percent !== state.percent) set({ percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    const first = state.status !== 'ready';
    set({ status: 'ready', version: info.version, percent: 100 });
    if (first) onReady(info.version);
  });
  autoUpdater.on('error', (err) => {
    log('updater error ' + String(err && err.message || err).split('\n')[0].slice(0, 300));
    // 이미 받아 둔 업데이트가 있으면 그 상태를 유지한다
    if (state.status !== 'ready') set({ status: 'error', error: shortError(err), checkedAt: Date.now() });
  });

  function check() {
    if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => { /* 'error' 이벤트에서 처리 */ });
  }

  function install() {
    if (state.status !== 'ready') return;
    log(`updater install v${state.version}`);
    beforeInstall();
    // 조용히 설치하고(isSilent) 끝나면 새 버전을 다시 실행한다(isForceRunAfter)
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  function start() {
    setTimeout(check, FIRST_CHECK);
    setInterval(check, CHECK_EVERY);
  }

  return { state: () => ({ ...state }), check, install, start };
}

/** 사용자에게 보여줄 짧은 오류 문구 */
function shortError(err) {
  const msg = String(err && err.message || err || '');
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|net::ERR_/i.test(msg)) return '인터넷에 연결할 수 없습니다.';
  if (/\b404\b/.test(msg)) return '업데이트 정보를 찾을 수 없습니다.';
  if (/\b40[13]\b|rate limit/i.test(msg)) return '업데이트 서버가 요청을 거절했습니다. 잠시 후 다시 시도하세요.';
  return '업데이트를 확인하지 못했습니다.';
}

module.exports = { createUpdater };
