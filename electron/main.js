// LazyWaffle 메인 프로세스
// - 창을 바탕화면 아이콘 아래(배경화면 레이어)에 붙인다(wallpaper 모드).
// - 배경화면 레이어는 마우스 입력을 받지 못하므로 Raw Input 으로 받은 클릭/휠을 웹 콘텐츠로 전달한다.
// - 글자 입력이 필요할 때(팝업·에디터)는 잠시 일반 창으로 올려 키보드/IME 를 받는다(edit 모드).
const { app, BaseWindow, BrowserWindow, ImageView, protocol, ipcMain, Tray, Menu, screen, shell, dialog, nativeImage, Notification, globalShortcut, powerMonitor, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { Storage, resolveDataDir, isInstalled, MIME, LOCAL_PREFIX } = require('./storage');
const { createUpdater } = require('./updater');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const ICON = path.join(ROOT, 'build', 'icon.png');
// 개발 실행(npm start · npm run dev)만 별도 데이터 폴더를 쓴다. 빌드한 exe 에 --dev 를 붙이면 개발자 도구만 켠다
const isDev = !app.isPackaged;
const devTools = isDev || process.argv.includes('--dev');
const isWin = process.platform === 'win32';

let w32 = null;
if (isWin) {
  try {
    w32 = require('./win32');
  } catch (err) {
    console.error('[win32] koffi 로드 실패, 일반 창 모드로 동작합니다.', err);
  }
}

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// 네트워크는 로컬 파일(app://)과 외부 링크 열기뿐이라, 따로 프로세스를 두지 않고 메인 프로세스 안에서 돌린다 (메모리 절약)
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');
// 빌드본은 원격 디버깅 인자를 받지 않는다 (다른 프로그램이 그 포트로 앱 화면을 조종하지 못하게). 개발 실행은 그대로 허용
if (!isDev) {
  for (const sw of ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address']) app.commandLine.removeSwitch(sw);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// 개발 실행은 별도 프로필을 써서, 사용 중인 빌드 앱과 단일 실행 잠금·캐시가 겹치지 않게 한다.
if (isDev) app.setPath('userData', path.join(ROOT, '.devdata', 'chromium'));
// 설치형은 시작 메뉴 바로가기와 같은 앱 ID 를 써야 Windows 알림이 뜨고 작업표시줄 고정이 바로가기와 묶인다
if (app.isPackaged && isInstalled()) app.setAppUserModelId('local.lazywaffle');

if (!app.requestSingleInstanceLock()) {
  app.exit(0); // quit() 은 비동기라 그 사이 whenReady 가 돌 수 있으므로 바로 끝낸다
}

let storage;
let config = { wallpaperMode: true, autostart: true };
let win = null;
let tray = null;
let quitting = false;
let updater = null;

// 'wallpaper' | 'edit' | 'window'
let mode = 'window';
let host = null;
let hwnd = 0;
let dialogOpen = false;

/* ───────── config ───────── */
function configFile() {
  return path.join(storage.dir, 'config.json');
}
function loadConfig() {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configFile(), 'utf8')) };
  } catch { /* 기본값 */ }
}
function saveConfig() {
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}
function applyAutostart() {
  if (!app.isPackaged) return; // 개발 중에는 레지스트리를 건드리지 않는다
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: !!config.autostart, path: exe, args: [] });
}

/* ───────── display helpers ───────── */
/**
 * 설정에서 고른 모니터. 재부팅·절전 후 Windows 가 모니터 번호(\\.\DISPLAYn → Electron display id)를 바꾸는 일이 있어
 * id 로만 찾으면 못 찾고 주 모니터로 떴다. 고를 때 위치·크기(물리 픽셀)도 저장해 두고 그것부터 맞춘다.
 */
function findTarget() {
  const all = screen.getAllDisplays();
  const want = config.displayRect;
  const sameRect = (d) => { const p = physicalBounds(d); return p.x === want.x && p.y === want.y && p.width === want.width && p.height === want.height; };
  const samePos = (d) => { const p = physicalBounds(d); return p.x === want.x && p.y === want.y; };
  let d;
  if (want && (d = all.find(sameRect))) return { display: d, how: 'rect' };
  if ((d = all.find((x) => String(x.id) === String(config.displayId)))) return { display: d, how: 'id' };
  if (want && (d = all.find(samePos))) return { display: d, how: 'pos' };
  return { display: screen.getPrimaryDisplay(), how: 'primary' };
}
function targetDisplay() {
  return findTarget().display;
}
/**
 * 설정 갱신: 위치·크기가 같은 모니터의 id 가 바뀌었으면 새 id 로, 예전 설정이라 위치가 없으면 id 로 찾은 모니터의 위치를 채운다.
 * (모니터가 빠진 사이 다른 모니터 값으로 덮어쓰지 않도록 그 밖의 경우는 그대로 둔다)
 */
function refreshRememberedDisplay() {
  if (!config.displayId) return;
  const t = findTarget();
  if (t.how === 'rect' || (t.how === 'id' && !config.displayRect)) rememberDisplay(t.display);
}
function rememberDisplay(d) {
  const rect = physicalBounds(d);
  const prev = config.displayRect;
  if (String(config.displayId) === String(d.id) && prev && prev.x === rect.x && prev.y === rect.y && prev.width === rect.width && prev.height === rect.height) return;
  config.displayId = String(d.id);
  config.displayRect = rect;
  saveConfig();
}
let placedOn = null; // 창을 마지막으로 맞춘 모니터 id
function displayList() {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays()
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d, i) => {
      const phys = physicalBounds(d);
      return {
        id: String(d.id),
        label: `모니터 ${i + 1} (${phys.width}×${phys.height}${d.id === primary ? ', 주 모니터' : ''})`,
        primary: d.id === primary,
      };
    });
}

/** 다른 모니터로 옮긴다. DPI 가 다를 수 있으니 일반 창 상태에서 옮긴 뒤 다시 붙인다. */
function moveToDisplay() {
  if (!win || win.isDestroyed()) return;
  const wasWallpaper = mode === 'wallpaper';
  if (wasWallpaper && w32) {
    w32.api.SetParent(hwnd, 0);
    setFrameStyles(true);
    mode = 'window';
  }
  const d = targetDisplay();
  win.setBounds(d.bounds);
  placedOn = String(d.id);
  if (wasWallpaper || config.wallpaperMode) setTimeout(embed, 150);
  win.webContents.send('desk:info', info());
}
function physicalBounds(display) {
  return isWin ? screen.dipToScreenRect(null, display.bounds) : display.bounds;
}
function insets() {
  const d = targetDisplay();
  const b = d.bounds;
  const wa = d.workArea;
  return {
    top: wa.y - b.y,
    left: wa.x - b.x,
    right: b.x + b.width - (wa.x + wa.width),
    bottom: b.y + b.height - (wa.y + wa.height),
  };
}

/* ───────── wallpaper embedding ───────── */
function setMode(next, why = '') {
  if (mode !== next) log(`mode ${mode} -> ${next}${why ? ` (${why})` : ''}`);
  mode = next;
  if (win && !win.isDestroyed()) {
    win.webContents.send('desk:mode', mode);
    win.setSkipTaskbar(true);
  }
  refreshTray();
}

function placeInHost() {
  const d = targetDisplay();
  placedOn = String(d.id);
  const phys = physicalBounds(d);
  const pr = w32.windowRect(host.parent);
  const { SWP_NOACTIVATE, SWP_SHOWWINDOW, SWP_NOZORDER } = w32.C;
  const flags = SWP_NOACTIVATE | SWP_SHOWWINDOW | w32.C.SWP_FRAMECHANGED | (host.insertAfter ? 0 : SWP_NOZORDER);
  w32.api.SetWindowPos(hwnd, host.insertAfter || 0, phys.x - pr.left, phys.y - pr.top, phys.width, phys.height, flags);
  geoCache.rect = null;
}

/**
 * 지금 바탕화면 레이어에 제대로 붙어 있는지.
 * GetParent 는 WS_CHILD 가 없는 이 창에 대해 항상 0 을 돌려주므로 실제 부모(GA_PARENT)를 본다.
 */
function attached() {
  return !!host && w32.api.IsWindow(host.parent) && w32.api.GetAncestor(hwnd, w32.C.GA_PARENT) === host.parent;
}

/** 이미 붙어 있을 때: 모니터 크기·위치가 달라졌을 때만 맞춘다 (테두리 재계산·레이어 재생성 없이) */
function refit() {
  const phys = physicalBounds(targetDisplay());
  const pr = w32.windowRect(host.parent);
  const r = w32.windowRect(hwnd);
  if (r.left === phys.x && r.top === phys.y && r.right - r.left === phys.width && r.bottom - r.top === phys.height) return;
  log('refit');
  w32.api.SetWindowPos(hwnd, 0, phys.x - pr.left, phys.y - pr.top, phys.width, phys.height, w32.C.SWP_NOACTIVATE | w32.C.SWP_NOZORDER);
  geoCache.rect = null;
}

/** 자식 창이 되면 보이지 않던 리사이즈 테두리가 실제 여백이 되므로 프레임 스타일을 뗐다 붙인다. */
let originalStyle = null;
function setFrameStyles(on) {
  const { GWL_STYLE, FRAME_STYLES } = w32.C;
  if (originalStyle === null) originalStyle = Number(w32.api.GetWindowLongPtrW(hwnd, GWL_STYLE));
  const style = on ? originalStyle : originalStyle & ~FRAME_STYLES;
  w32.api.SetWindowLongPtrW(hwnd, GWL_STYLE, style >>> 0);
}

function embed(why = '') {
  if (!win || win.isDestroyed()) return false;
  if (!w32 || !config.wallpaperMode) {
    toWindowMode();
    return false;
  }
  // 이미 붙어 있으면 다시 붙이지 않는다: 바탕화면 레이어를 다시 만들고(0x052C) 테두리를 다시 계산하면 화면이 깜빡인다
  if (mode === 'wallpaper' && attached()) {
    refit();
    return true;
  }
  if (mode === 'wallpaper') log(`re-embed (${why})`);
  host = w32.findWallpaperHost();
  if (!host) {
    console.warn('[wallpaper] 바탕화면 레이어를 찾지 못했습니다. 일반 창 모드로 전환합니다.');
    toWindowMode();
    return false;
  }
  setFrameStyles(false);
  // Chromium 내부 상태도 '보임'이 되도록 Electron API 로 먼저 띄운다(그렇지 않으면 렌더링을 멈춘다).
  // 깜빡임이 보이지 않게 화면 밖에서 띄운다. (setOpacity 는 WS_EX_LAYERED 를 붙여 합성이 깨지므로 쓰지 않는다)
  if (!win.isVisible()) {
    w32.api.SetWindowPos(hwnd, 0, -32000, -32000, 0, 0, w32.C.SWP_NOSIZE | w32.C.SWP_NOACTIVATE | w32.C.SWP_NOZORDER);
    win.showInactive();
  }
  w32.api.SetParent(hwnd, host.parent);
  placeInHost();
  // 포커스를 쓰던 창에 돌려준다 (그대로 두면 Windows 가 작업표시줄 대리 창을 활성화해 편집 모드로 다시 올라온다)
  w32.yieldForeground([hwnd, taskbarHwnd], prevForeground || lastOtherWindow());
  prevForeground = 0;
  setMode('wallpaper', why);
  return true;
}

/**
 * 최근에 쓰던 다른 프로그램 창(앱 자신 제외, 최근 것부터 5개). Windows 가 저절로 이 앱을 활성화했을 때
 * 포커스를 바탕화면이 아니라 쓰던 창(브라우저 등)으로 돌려주기 위해 기억한다.
 * (팝업 창이 닫히면 그 창은 사라지므로 바로 앞에 쓰던 창까지 본다)
 */
const fgHistory = [];
function noteForeground() {
  const fg = w32.api.GetForegroundWindow();
  if (!fg || fg === hwnd || fg === taskbarHwnd || fgHistory[0] === fg) return;
  const i = fgHistory.indexOf(fg);
  if (i >= 0) fgHistory.splice(i, 1);
  fgHistory.unshift(fg);
  fgHistory.length = Math.min(fgHistory.length, 5);
}
function lastOtherWindow() {
  return fgHistory.find((h) => w32.api.IsWindow(h) && w32.api.IsWindowVisible(h) && !w32.api.IsIconic(h)) || 0;
}

/** 키보드 입력을 위해 일반 창으로 띄운다. */
let prevForeground = 0; // 편집 모드로 올리기 직전에 쓰던 창: 바탕화면으로 돌아갈 때 그 창에 포커스를 돌려준다
function lift(why = '') {
  lastEditAt = Date.now();
  noteUse();
  if (!win || win.isDestroyed()) return;
  if (mode === 'wallpaper' && w32) {
    const fg = w32.api.GetForegroundWindow();
    if (fg !== hwnd && fg !== taskbarHwnd) prevForeground = fg;
    w32.api.SetParent(hwnd, 0);
    setFrameStyles(true);
    const phys = physicalBounds(targetDisplay());
    w32.api.SetWindowPos(hwnd, 0, phys.x, phys.y, phys.width, phys.height, w32.C.SWP_SHOWWINDOW | w32.C.SWP_FRAMECHANGED);
    setMode('edit', why);
  }
  if (!win.isVisible()) win.show();
  if (w32) w32.forceForeground(hwnd);
  win.focus();
  win.webContents.focus();
}

function toWindowMode() {
  if (w32 && hwnd && mode === 'wallpaper') {
    w32.api.SetParent(hwnd, 0);
    setFrameStyles(true);
  }
  const d = targetDisplay();
  win.setBounds(d.bounds);
  placedOn = String(d.id);
  win.show();
  setMode('window');
}

/** edit 모드를 끝내고 바탕화면으로 돌아간다. onlyIfBlurred: 포커스가 남아 있으면 유지 */
function scheduleEmbed(onlyIfBlurred) {
  setTimeout(() => {
    if (!win || win.isDestroyed() || mode !== 'edit' || dialogOpen) return;
    if (onlyIfBlurred && win.isFocused()) return;
    embed(onlyIfBlurred ? 'blur' : 'release');
  }, onlyIfBlurred ? 160 : 0);
}

/* ───────── mouse forwarding (wallpaper 모드 전용) ───────── */
const mouse = { pressed: false, viaHook: false, hookSeenAt: 0, hovering: false, lastDown: 0, lastX: 0, lastY: 0, clicks: 0, moveTimer: null };

// 창 위치·배율은 거의 바뀌지 않으므로 잠깐 캐시한다 (마우스가 움직일 때마다 Win32/Electron 호출을 줄임)
let geoCache = { at: 0, rect: null, scale: 1 };
function geometry() {
  const now = Date.now();
  if (!geoCache.rect || now - geoCache.at > 1000) geoCache = { at: now, rect: w32.windowRect(hwnd), scale: targetDisplay().scaleFactor || 1 };
  return geoCache;
}
function toClient(pt) {
  const { rect: r, scale } = geometry();
  return {
    x: Math.round((pt.x - r.left) / scale),
    y: Math.round((pt.y - r.top) / scale),
    inside: pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom,
  };
}

function send(ev) {
  if (win && !win.isDestroyed()) win.webContents.sendInputEvent(ev);
}

/** 이 지점의 왼쪽 클릭을 앱이 받아야 하는지: 바탕화면 모드 · 다른 창이 덮지 않음 · 바탕화면 아이콘 위가 아님 */
function appOwnsClick(pt, c) {
  // 아이콘 위의 클릭은 탐색기 몫(선택·실행·끌기) — 아이콘 밑의 위젯이 눌리지 않게 한다
  return mode === 'wallpaper' && c.inside && w32.isDesktopAt(pt, hwnd) && !w32.desktopIconAt(pt);
}

function pressDown(c, viaHook) {
  const now = Date.now();
  noteUse();
  const near = Math.abs(c.x - mouse.lastX) < 5 && Math.abs(c.y - mouse.lastY) < 5;
  mouse.clicks = now - mouse.lastDown < w32.api.GetDoubleClickTime() && near ? mouse.clicks + 1 : 1;
  mouse.lastDown = now;
  mouse.lastX = c.x;
  mouse.lastY = c.y;
  mouse.pressed = true;
  mouse.viaHook = viaHook;
  const modifiers = w32.modifierKeys();
  send({ type: 'mouseMove', x: c.x, y: c.y, modifiers });
  send({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: mouse.clicks, modifiers });
}
function pressUp(c) {
  mouse.pressed = false;
  mouse.viaHook = false;
  send({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: mouse.clicks, modifiers: w32.modifierKeys() });
}

/**
 * 저수준 마우스 훅에서 받은 왼쪽 버튼: 앱이 처리할 클릭이면 앱에 전달하고 탐색기에는 보내지 않는다(true).
 * 탐색기가 같은 클릭으로 선택 사각형을 그려 앱 안의 끌기와 겹치지 않게 하기 위함.
 */
function onHookButton(msg, pt) {
  mouse.hookSeenAt = Date.now();
  const c = toClient(pt);
  if (msg === w32.C.WM_LBUTTONUP) {
    if (!mouse.pressed || !mouse.viaHook) return false;
    pressUp(c);
    return true;
  }
  if (!appOwnsClick(pt, c)) return false;
  pressDown(c, true);
  return true;
}

function onRawMouse(raw) {
  // 버튼/휠 변화가 없는 순수 이동은 아래 60fps 묶음 처리에서만 다룬다
  const hasButtons = raw.buttons !== 0;
  if (!hasButtons) return scheduleMove();
  const pt = w32.cursorPos();
  const c = toClient(pt);
  const overDesktop = c.inside && w32.isDesktopAt(pt, hwnd);
  const { RI_MOUSE_LEFT_DOWN, RI_MOUSE_LEFT_UP, RI_MOUSE_WHEEL, RI_MOUSE_HWHEEL } = w32.C;

  // 훅이 켜져 있으면 왼쪽 버튼은 훅이 맡는다 (훅이 가로챈 클릭도 Raw Input 은 그대로 오므로 두 번 보내지 않게)
  if (raw.buttons & RI_MOUSE_LEFT_DOWN && !w32.mouseHookActive() && appOwnsClick(pt, c)) pressDown(c, false);
  if (raw.buttons & RI_MOUSE_LEFT_UP && mouse.pressed && !mouse.viaHook) pressUp(c);
  // 안전망: Windows 는 응답이 늦은 훅을 알리지 않고 떼어 버린다. 훅이 이 클릭을 못 봤으면 다시 건다 (rawGate 가 곧 다시 설치)
  if (raw.buttons & RI_MOUSE_LEFT_DOWN && w32.mouseHookActive()) {
    const at = Date.now();
    setTimeout(() => {
      if (mouse.hookSeenAt >= at - 150 || !w32.mouseHookActive()) return;
      log('mouse hook lost, reinstalling');
      w32.uninstallMouseHook();
      mouse.viaHook = false; // 눌린 상태가 남지 않게 떼는 것은 Raw Input 이 맡는다
    }, 150);
  }
  if (raw.buttons & (RI_MOUSE_WHEEL | RI_MOUSE_HWHEEL) && overDesktop && mode === 'wallpaper') {
    const delta = raw.data;
    const horizontal = raw.buttons & RI_MOUSE_HWHEEL;
    send({
      type: 'mouseWheel', x: c.x, y: c.y, canScroll: true,
      deltaX: horizontal ? -delta : 0, deltaY: horizontal ? 0 : delta,
      wheelTicksX: horizontal ? -delta / 120 : 0, wheelTicksY: horizontal ? 0 : delta / 120,
    });
  }
  scheduleMove();
}

/** 이동은 묶어서 전달: 드래그 중 60fps, 그 외(hover) 30fps. 창 밖이면 아무것도 보내지 않는다 */
function scheduleMove() {
  if (mouse.moveTimer) return;
  mouse.moveTimer = setTimeout(() => {
    mouse.moveTimer = null;
    if (mode !== 'wallpaper' && !mouse.pressed) return;
    const p = w32.cursorPos();
    const cc = toClient(p);
    const over = cc.inside && w32.isDesktopAt(p, hwnd);
    if (mouse.pressed || over) {
      mouse.hovering = true;
      const modifiers = w32.modifierKeys();
      if (mouse.pressed) modifiers.push('leftButtonDown');
      send({ type: 'mouseMove', x: cc.x, y: cc.y, modifiers });
    } else if (mouse.hovering) {
      mouse.hovering = false;
      send({ type: 'mouseLeave', x: cc.x, y: cc.y });
    }
  }, mouse.pressed ? 16 : 33);
}

function installMouseForwarding() {
  if (!w32) return;
  const ok = w32.registerRawMouse(hwnd);
  if (!ok) console.warn('[wallpaper] Raw Input 등록 실패');
  // 감시: 다른 코드(Chromium 내부 등)가 마우스 Raw Input 등록을 바꾸면 바탕화면 클릭 전달이 끊기므로 되돌린다
  clearInterval(rawWatch);
  rawWatch = setInterval(() => {
    if (!win || win.isDestroyed() || !rawWanted) return;
    const cur = w32.rawMouseTarget();
    if (!cur.ok || cur.target !== hwnd || !(cur.flags & w32.C.RIDEV_INPUTSINK)) {
      log('raw input restored ' + JSON.stringify(cur));
      w32.registerRawMouse(hwnd);
    }
  }, 2000);

  // 커서가 이 앱이 붙은 바탕화면 위에 있을 때만 Raw Input · 마우스 훅을 켠다.
  // (다른 프로그램을 쓰는 동안 마우스가 움직일 때마다 처리하던 부하를 없앰. 10번/초 가벼운 확인)
  // 훅은 시스템 전체 마우스 입력을 이 프로세스가 먼저 보게 하므로, 바탕화면 위에 있을 때만 잠깐 건다.
  clearInterval(rawGate);
  rawGate = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    noteForeground();
    let want = mouse.pressed;
    if (!want && mode === 'wallpaper') {
      const pt = w32.cursorPos();
      const c = toClient(pt);
      want = c.inside && w32.isDesktopAt(pt, hwnd);
    }
    if (want && mode === 'wallpaper' && !w32.mouseHookActive() && !w32.installMouseHook(onHookButton)) log('mouse hook install failed');
    if (!want && !mouse.pressed && w32.mouseHookActive()) w32.uninstallMouseHook();
    if (want === rawWanted) return;
    rawWanted = want;
    if (want) w32.registerRawMouse(hwnd);
    else {
      w32.unregisterRawMouse();
      if (mouse.hovering) {
        mouse.hovering = false;
        send({ type: 'mouseLeave', x: -1, y: -1 });
      }
    }
  }, 100);

  // 다른 창이 앱 화면을 덮고 있으면 애니메이션을 멈추도록 화면에 알린다 (1초마다)
  clearInterval(coverWatch);
  coverWatch = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const c = isCovered();
    if (c !== covered) {
      covered = c;
      win.webContents.send('desk:covered', c);
      log(c ? 'covered: animations paused' : 'visible: animations resumed');
    }
  }, 1000);
  win.hookWindowMessage(w32.C.WM_INPUT, (wParam, lParam) => {
    if (mode !== 'wallpaper' && !mouse.pressed) return;
    try {
      const raw = w32.readRawMouse(lParam);
      if (raw) onRawMouse(raw);
    } catch (err) {
      log('mouse forward error ' + err.message);
    }
  });
  // 탐색기 재시작 시 바탕화면 레이어가 새로 만들어지므로 다시 붙인다.
  const taskbarCreated = w32.api.RegisterWindowMessageW('TaskbarCreated');
  win.hookWindowMessage(taskbarCreated, () => setTimeout(() => mode === 'wallpaper' && embed(), 1500));
}

let rawWatch = null;
let rawGate = null;
let rawWanted = true;
let coverWatch = null;
let covered = false;

/**
 * 이 앱의 모니터가 다른 창에 완전히 가려졌는지: 작업 영역의 다섯 지점 모두에서 바탕화면이 안 보이면 가려진 것.
 * (앞에 있는 창이 아니어도 — 다른 모니터에서 작업 중일 때 뒤에 최대화된 창 등 — 감지)
 */
function isCovered() {
  if (mode === 'edit') return false;
  const wa = screen.dipToScreenRect(null, targetDisplay().workArea);
  const pts = [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]];
  return pts.every(([fx, fy]) => !w32.isDesktopAt({ x: Math.round(wa.x + wa.width * fx), y: Math.round(wa.y + wa.height * fy) }, hwnd));
}

/* ───────── window ───────── */
function createWindow() {
  const d = targetDisplay();
  placedOn = String(d.id);
  win = new BrowserWindow({
    ...d.bounds,
    frame: false,
    thickFrame: false,
    show: false,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    backgroundColor: '#ffffff',
    title: 'LazyWaffle',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      spellcheck: false,
      contextIsolation: true,
    },
  });
  hwnd = w32 ? w32.hwndFromBuffer(win.getNativeWindowHandle()) : 0;
  win.loadURL('app://desk/index.html');
  win.webContents.setVisualZoomLevelLimits(1, 1);

  win.once('ready-to-show', () => {
    installMouseForwarding();
    if (!embed()) win.show();
  });

  // 화면이 응답하지 않거나 렌더러가 죽으면 기록하고 복구
  win.on('unresponsive', () => log('renderer unresponsive'));
  win.on('responsive', () => log('renderer responsive again'));
  win.webContents.on('render-process-gone', (e, d) => {
    log('render process gone ' + d.reason);
    if (!quitting && win && !win.isDestroyed()) win.webContents.reload();
  });
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') log('renderer error ' + String(e.message).slice(0, 300));
  });
  win.on('blur', () => {
    noteUse();
    if (mode === 'edit') scheduleEmbed(true);
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' && devTools) win.webContents.toggleDevTools();
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) win.webContents.reload();
    if (input.control && ['+', '-', '=', '0'].includes(input.key)) e.preventDefault();
  });

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) {
      e.preventDefault();
      openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
    hwnd = 0;
    // 탐색기 재시작 등으로 창이 사라진 경우 다시 만든다.
    if (!quitting) setTimeout(createWindow, 1500);
  });
}

function openExternal(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return log('open: invalid url');
  }
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return;
  // 마우스 입력 전달 처리 중에 바로 브라우저를 띄우지 않고 다음 틱에 (입력 큐가 꼬이지 않도록)
  setImmediate(() => {
    const t0 = Date.now();
    shell.openExternal(u.toString()).then(
      () => log(`open ok ${u.host} ${Date.now() - t0}ms mode=${mode}`),
      (err) => log(`open fail ${u.host} ${err.message}`),
    );
  });
}

/* ───────── 진단 로그 (data/logs/desk.log, 256KB 넘으면 교체) ───────── */
function log(msg) {
  try {
    const dir = path.join(storage.dir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'desk.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
  } catch { /* 로그 실패는 무시 */ }
}

/* ───────── 메모리 정리 ─────────
 * 바탕화면 위젯은 대부분 가만히 떠 있으므로, 앱을 쓰지 않는 동안 시작 · 화면 그리기 때 한 번 쓰고 놀고 있는
 * 메모리 페이지를 Windows 에 돌려준다(앱의 모든 프로세스). 다시 쓰는 페이지는 그때 곧바로 올라오므로 기능 · 화면은 그대로다.
 * 마지막으로 앱을 쓴(클릭 · 편집 모드) 뒤 1분이 지나면 한 번, 계속 쓰지 않으면 10분마다. */
const TRIM_IDLE = 60 * 1000;
const TRIM_EVERY = 10 * 60 * 1000;
let lastUse = Date.now();
let trimmedAt = 0;
function noteUse() {
  lastUse = Date.now();
}
function maybeTrim() {
  if (!w32 || !win || win.isDestroyed() || mode === 'edit' || win.isFocused() || dialogOpen || mouse.pressed) return;
  const now = Date.now();
  if (now - lastUse < TRIM_IDLE) return;
  if (trimmedAt > lastUse && now - trimmedAt < TRIM_EVERY) return;
  for (const m of app.getAppMetrics()) w32.trimWorkingSet(m.pid);
  trimmedAt = now;
}

/* ───────── tray ───────── */
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '편집 모드로 열기', click: () => lift('tray') },
    { label: '바탕화면으로 보내기', enabled: mode !== 'wallpaper' && config.wallpaperMode, click: () => embed('tray') },
    { label: '화면 설정', click: () => { lift('tray'); win && win.webContents.send('desk:command', 'open-settings'); } },
    { type: 'separator' },
    {
      label: '바탕화면 모드 (아이콘 아래에 배치)', type: 'checkbox', checked: config.wallpaperMode,
      click: (item) => { setWallpaperMode(item.checked); },
    },
    {
      label: '시작 시 자동 실행', type: 'checkbox', checked: config.autostart, enabled: app.isPackaged,
      click: (item) => { setAutostart(item.checked); },
    },
    { label: '데이터 폴더 열기', click: () => shell.openPath(storage.dir) },
    { label: '새로고침', click: () => win && win.webContents.reload() },
    ...updateMenu(),
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
}

/** 트레이 메뉴의 업데이트 항목 (설치형에서만) */
function updateMenu() {
  const u = updater && updater.state();
  if (!u || !u.enabled) return [];
  if (u.status === 'ready') return [{ type: 'separator' }, { label: `업데이트 후 다시 시작 (v${u.version})`, click: () => updater.install() }];
  const busy = u.status === 'checking' || u.status === 'downloading';
  const label = u.status === 'checking' ? '업데이트 확인 중…' : u.status === 'downloading' ? `업데이트 받는 중… (v${u.version})` : '업데이트 확인';
  return [{ label, enabled: !busy, click: () => updater.check() }];
}

/* ───────── 자동 업데이트 ───────── */
function setupUpdater() {
  let trayStatus = null;
  updater = createUpdater({
    enabled: app.isPackaged && isInstalled(),
    log,
    onChange: () => {
      const s = updater.state().status;
      // 받는 중 진행률은 설정 화면에만 알리고, 트레이 메뉴는 상태가 바뀔 때만 다시 만든다
      if (s !== trayStatus) {
        trayStatus = s;
        refreshTray();
      }
      if (win) win.webContents.send('desk:info', info());
    },
    onReady: (version) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: `LazyWaffle v${version} 업데이트 준비 완료`,
        body: '트레이 메뉴나 화면 설정에서 다시 시작하면 적용됩니다. 그냥 두면 다음에 앱을 끌 때 설치됩니다.',
        icon: ICON,
      });
      n.on('click', () => { lift('update'); win && win.webContents.send('desk:command', 'open-settings'); });
      n.show();
    },
    beforeInstall: () => { quitting = true; },
  });
  updater.start();
}

function setWallpaperMode(on) {
  config.wallpaperMode = !!on;
  saveConfig();
  if (on) embed();
  else toWindowMode();
  refreshTray();
  if (win) win.webContents.send('desk:info', info());
}
function setAutostart(on) {
  config.autostart = !!on;
  saveConfig();
  applyAutostart();
  refreshTray();
  if (win) win.webContents.send('desk:info', info());
}

function info() {
  return {
    version: app.getVersion(),
    insets: insets(),
    wallpaperMode: config.wallpaperMode,
    autostart: config.autostart,
    autostartAvailable: app.isPackaged,
    dataDir: storage.dir,
    update: updater ? updater.state() : null,
    mode,
    displayId: String(targetDisplay().id),
    displays: displayList(),
  };
}

function dirSize(dir) {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch { /* 없음 */ }
  return total;
}

/** 불필요한 캐시 정리: Chromium 캐시 + 쓰이지 않는 이미지 + 임시 파일 */
async function clearCache(state) {
  const ses = win.webContents.session;
  const userData = app.getPath('userData');
  const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Service Worker'].map((d) => path.join(userData, d));
  const before = cacheDirs.reduce((n, d) => n + dirSize(d), 0);
  await ses.clearCache();
  await ses.clearCodeCaches({});
  await ses.clearStorageData({ storages: ['shadercache', 'cachestorage', 'serviceworkers'] });
  const after = cacheDirs.reduce((n, d) => n + dirSize(d), 0);
  const assets = storage.gc(state, { force: true });
  return { browserCache: Math.max(0, before - after), assets };
}

/* ───────── IPC ───────── */
async function withDialog(fn) {
  // 바탕화면 레이어에 붙은 상태에서는 대화상자가 제대로 뜨지 않으므로 먼저 앞으로 올린다.
  if (mode === 'wallpaper') lift('dialog');
  dialogOpen = true;
  try {
    return await fn();
  } finally {
    dialogOpen = false;
    if (win) win.focus();
  }
}

function registerIpc() {
  ipcMain.handle('desk:info', () => info());
  ipcMain.handle('desk:load', () => storage.load());
  ipcMain.handle('desk:save', (e, state) => {
    storage.save(state);
    return true;
  });
  ipcMain.handle('desk:putAsset', (e, bytes, ext) => storage.putAsset(bytes, ext));
  ipcMain.handle('desk:pickFile', (e, opts = {}) => withDialog(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: opts.title || '파일 선택',
      properties: ['openFile'],
      filters: opts.filters || [{ name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = res.filePaths[0];
    // pathOnly: 복사하지 않고 원본 파일 경로를 그대로 참조 (불필요한 파일 생성 방지)
    if (opts.pathOnly) return { name: path.basename(file), url: LOCAL_PREFIX + encodeURIComponent(file) };
    return { name: path.basename(file), data: fs.readFileSync(file) };
  }));
  ipcMain.handle('desk:clearCache', (e, state) => clearCache(state));
  ipcMain.on('desk:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.on('desk:setDisplay', (e, id) => {
    const d = screen.getAllDisplays().find((x) => String(x.id) === String(id));
    if (!d) return;
    rememberDisplay(d);
    moveToDisplay();
  });
  ipcMain.handle('desk:exportBackup', (e, state) => withDialog(async () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const res = await dialog.showSaveDialog(win, {
      title: '백업 파일 저장',
      defaultPath: path.join(app.getPath('documents'), `LazyWaffle-backup-${stamp}.json`),
      filters: [{ name: 'LazyWaffle 백업', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, JSON.stringify(storage.buildBackup(state)));
    return res.filePath;
  }));
  ipcMain.handle('desk:importBackup', () => withDialog(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: '백업 파일 불러오기',
      properties: ['openFile'],
      filters: [{ name: 'LazyWaffle 백업', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return storage.restoreBackup(JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')));
  }));
  ipcMain.on('desk:openExternal', (e, url) => openExternal(url));
  ipcMain.on('desk:requestFocus', () => lift('renderer'));
  ipcMain.on('desk:releaseFocus', () => scheduleEmbed(false));
  ipcMain.on('desk:setWallpaperMode', (e, on) => setWallpaperMode(on));
  ipcMain.on('desk:setAutostart', (e, on) => setAutostart(on));
  ipcMain.on('desk:openDataDir', () => shell.openPath(storage.dir));
  ipcMain.on('desk:checkUpdate', () => updater && updater.check());
  ipcMain.on('desk:installUpdate', () => updater && updater.install());
  ipcMain.on('desk:notify', (e, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show();
  });
}

/* ───────── app:// 프로토콜 (렌더러 파일 + 저장된 이미지) ───────── */
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/json', woff: 'font/woff', woff2: 'font/woff2', ico: 'image/x-icon',
  ...MIME,
};
function registerProtocol() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    let file;
    if (p.startsWith('/assets/')) {
      file = storage.assetPath(p.slice('/assets/'.length));
    } else if (p.startsWith('/local/')) {
      // 사용자가 고른 원본 이미지 파일 (이미지 확장자만 허용)
      file = p.slice('/local/'.length);
      if (!MIME[path.extname(file).slice(1).toLowerCase()]) return new Response('forbidden', { status: 403 });
    } else {
      if (p === '/' || p === '') p = '/index.html';
      file = path.normalize(path.join(RENDERER, p));
      if (!file.startsWith(RENDERER)) return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fs.promises.readFile(file);
      const ext = path.extname(file).slice(1).toLowerCase();
      // no-store: 새 버전 exe 로 바꿨을 때 예전 화면 코드가 캐시에서 나오지 않도록
      return new Response(data, { headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/* ───────── lifecycle ───────── */
// 두 번째 실행(아이콘 더블클릭·점프 목록)은 실행 중인 앱에 명령만 전달
app.on('second-instance', (e, argv) => runCommand((argv.find((a) => a.startsWith('--desk-cmd=')) || '').slice(11) || 'show'));

function runCommand(cmd) {
  if (cmd === 'quit') {
    quitting = true;
    app.quit();
  } else if (cmd === 'settings') {
    lift('command');
    if (win) win.webContents.send('desk:command', 'open-settings');
  } else lift('command');
}

/* ───────── 작업표시줄 버튼 ─────────
 * 바탕화면 모드의 본 창은 바탕화면 레이어의 자식이라 작업표시줄에 버튼을 가질 수 없다.
 * 그래서 화면 밖의 작은 대리 창이 버튼을 맡는다: 클릭 → 앞으로/다시 바탕화면으로, '창 닫기' → 종료.
 * (멈췄을 때도 작업 관리자의 '앱' 목록과 작업표시줄에서 바로 끝낼 수 있게)
 * 웹 화면이 없는 BaseWindow 에 미리보기 이미지만 띄워, 렌더러 프로세스를 하나 더 만들지 않는다. */
let taskbarWin = null;
let taskbarHwnd = 0;
function createTaskbarButton() {
  const W = 320;
  const H = 180;
  taskbarWin = new BaseWindow({
    x: -32000, y: -32000, width: W, height: H,
    frame: false, resizable: false, show: false, skipTaskbar: false,
    title: 'LazyWaffle', icon: ICON, backgroundColor: '#111111',
  });
  // 작업표시줄 미리보기에 보일 안내 화면 (scripts/make-taskbar-preview.js 로 만든 이미지, @2x 는 자동으로 함께 읽힘)
  const preview = new ImageView();
  preview.setImage(nativeImage.createFromPath(path.join(ROOT, 'build', 'taskbar-preview.png')));
  preview.setBounds({ x: 0, y: 0, width: W, height: H });
  taskbarWin.contentView.addChildView(preview);
  taskbarHwnd = w32 ? w32.hwndFromBuffer(taskbarWin.getNativeWindowHandle()) : 0;
  taskbarWin.showInactive();
  let lastToggle = 0;
  // 작업표시줄 버튼 클릭: 이 창이 활성화되거나(평소) 최소화된다(이미 활성 상태일 때 누르면 Windows 가 최소화)
  const onActivate = () => {
    const now = Date.now();
    if (now - lastToggle < 400) return;
    // 사용자가 누른 게 아니라 Windows 가 저절로 활성화한 경우(첫 실행, 앞 창이 사라질 때, 모든 창 내리기 등)는 무시한다.
    if (w32 && !w32.userPickedFromTaskbar()) {
      const back = lastOtherWindow();
      log(`auto-activated taskbar proxy -> focus back to ${back || 'desktop'}`);
      w32.yieldForeground([taskbarHwnd], back);
      return;
    }
    lastToggle = now;
    // 이미 앞에 올라와 있으면(편집 모드) 다시 누른 것으로 보고 바탕화면으로 보낸다
    if (mode === 'edit' && now - lastEditAt > 600) embed('taskbar');
    else lift('taskbar');
  };
  taskbarWin.on('focus', onActivate);
  // 최소화는 '바탕화면 보기'·모든 창 내리기로도 일어나므로, 편집 모드를 끝내는 쪽으로만 쓴다
  taskbarWin.on('minimize', () => mode === 'edit' && onActivate());
  taskbarWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    app.quit();
  });
  taskbarWin.on('closed', () => (taskbarWin = null));
}
let lastEditAt = 0;

/** 작업표시줄 우클릭(점프 목록) 메뉴 */
function setJumpList() {
  if (!isWin) return;
  const program = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const base = app.isPackaged ? '' : `"${app.getAppPath()}" `;
  app.setUserTasks([
    { program, arguments: base + '--desk-cmd=show', iconPath: program, iconIndex: 0, title: '편집 모드로 열기', description: '바탕화면에서 앞으로 가져옵니다' },
    { program, arguments: base + '--desk-cmd=settings', iconPath: program, iconIndex: 0, title: '화면 설정', description: '화면 설정을 엽니다' },
    { program, arguments: base + '--desk-cmd=quit', iconPath: program, iconIndex: 0, title: 'LazyWaffle 종료', description: '앱을 끝냅니다' },
  ]);
}
process.on('uncaughtException', (err) => log('main error ' + (err && err.stack || err)));
process.on('unhandledRejection', (err) => log('main rejection ' + (err && err.stack || err)));

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  storage = new Storage(resolveDataDir({ app, isDev, root: ROOT }));
  loadConfig();
  storage.gc(storage.load());
  // 버전이 바뀌었으면 예전 화면 코드 캐시를 한 번 비운다
  if (config.lastVersion !== app.getVersion()) {
    await session.defaultSession.clearCache().catch(() => {});
    config.lastVersion = app.getVersion();
    saveConfig();
  }
  log(`start v${app.getVersion()} wallpaper=${config.wallpaperMode} display=${config.displayId || 'primary'} rect=${JSON.stringify(config.displayRect || null)}`);
  log('displays ' + JSON.stringify(screen.getAllDisplays().map((d) => ({ id: d.id, ...physicalBounds(d), scale: d.scaleFactor }))) + ` -> ${findTarget().how}`);
  refreshRememberedDisplay();
  applyAutostart();
  registerProtocol();
  registerIpc();
  createWindow();

  createTaskbarButton();
  setJumpList();
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('LazyWaffle');
  tray.on('click', () => lift('tray'));
  setupUpdater();
  refreshTray();

  globalShortcut.register('Control+Alt+D', () => (mode === 'edit' ? embed('shortcut') : lift('shortcut')));

  const reposition = (why) => {
    if (!win) return;
    refreshRememberedDisplay();
    const d = targetDisplay();
    // 붙일 모니터가 바뀌었으면(늦게 켜진 모니터 등) 배율이 다를 수 있으니 떼었다가 옮겨 붙인다
    if (placedOn && String(d.id) !== placedOn) log(`display ${placedOn} -> ${d.id} (${why})`);
    if (mode === 'wallpaper' && placedOn && String(d.id) !== placedOn) return moveToDisplay();
    if (mode === 'wallpaper') embed(why);
    else {
      win.setBounds(d.bounds);
      placedOn = String(d.id);
    }
    win.webContents.send('desk:info', info());
  };
  // 로그인 직후 자동 실행되면 보조 모니터가 아직 준비되지 않아 주 모니터에 뜨는 일이 있다: 잠시 동안 몇 번 다시 확인한다
  [3000, 8000, 20000, 45000].forEach((ms) => setTimeout(() => reposition('startup-check'), ms));
  screen.on('display-metrics-changed', (e, d, changed) => {
    // 작업 영역만 바뀐 경우(작업표시줄 크기·자동 숨김 등)는 창은 그대로 두고 여백 정보만 알린다
    if (changed.every((m) => m === 'workArea')) return win && win.webContents.send('desk:info', info());
    log(`display-metrics-changed ${d.id} [${changed}]`);
    reposition('display:' + changed);
  });
  screen.on('display-added', () => reposition('display-added'));
  screen.on('display-removed', () => reposition('display-removed'));
  powerMonitor.on('resume', () => setTimeout(() => reposition('resume'), 2000));
  powerMonitor.on('unlock-screen', () => setTimeout(() => reposition('unlock'), 1000));

  setInterval(maybeTrim, 15000);

  // 안전망: 바탕화면 레이어에서 떨어졌으면 다시 붙인다.
  setInterval(() => {
    if (!win || mode !== 'wallpaper' || !w32 || !host) return;
    if (!attached()) {
      log(`watchdog: parent=${w32.api.GetAncestor(hwnd, w32.C.GA_PARENT)} host=${host.parent} alive=${w32.api.IsWindow(host.parent)}`);
      embed('watchdog');
    }
  }, 30000);
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (w32) w32.uninstallMouseHook();
});
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
