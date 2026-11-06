// Win32 API 바인딩 (koffi FFI). 바탕화면(WorkerW/Progman) 임베딩, 포커스, Raw Input 에 사용.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// 구조체는 아래 함수 선언에서 이름('POINT' · 'RECT')으로 쓰이므로 먼저 등록해 둔다
const POINT = koffi.struct('POINT', { x: 'int32_t', y: 'int32_t' });
koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', { pt: POINT, mouseData: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', extra: 'uintptr_t' });
const LowLevelMouseProc = koffi.proto('intptr_t __stdcall LowLevelMouseProc(int code, uintptr_t wp, void *lp)');

const api = {
  FindWindowW: user32.func('intptr_t FindWindowW(const char16_t *cls, const char16_t *name)'),
  FindWindowExW: user32.func('intptr_t FindWindowExW(intptr_t parent, intptr_t after, const char16_t *cls, const char16_t *name)'),
  SendMessageTimeoutW: user32.func('intptr_t SendMessageTimeoutW(intptr_t hwnd, uint32_t msg, uintptr_t wp, intptr_t lp, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
  SetParent: user32.func('intptr_t SetParent(intptr_t child, intptr_t parent)'),
  SetWindowPos: user32.func('int SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
  GetWindowRect: user32.func('int GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
  GetCursorPos: user32.func('int GetCursorPos(_Out_ POINT *pt)'),
  WindowFromPoint: user32.func('intptr_t WindowFromPoint(POINT pt)'),
  GetAncestor: user32.func('intptr_t GetAncestor(intptr_t hwnd, uint32_t flags)'),
  GetClassNameW: user32.func('int GetClassNameW(intptr_t hwnd, _Out_ uint8_t *buf, int max)'),
  GetWindowLongPtrW: user32.func('intptr_t GetWindowLongPtrW(intptr_t hwnd, int index)'),
  SetWindowLongPtrW: user32.func('intptr_t SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
  IsWindow: user32.func('int IsWindow(intptr_t hwnd)'),
  GetForegroundWindow: user32.func('intptr_t GetForegroundWindow()'),
  SetForegroundWindow: user32.func('int SetForegroundWindow(intptr_t hwnd)'),
  BringWindowToTop: user32.func('int BringWindowToTop(intptr_t hwnd)'),
  GetWindowThreadProcessId: user32.func('uint32_t GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
  AttachThreadInput: user32.func('int AttachThreadInput(uint32_t a, uint32_t b, int attach)'),
  RegisterRawInputDevices: user32.func('int RegisterRawInputDevices(uint8_t *devices, uint32_t count, uint32_t size)'),
  GetRegisteredRawInputDevices: user32.func('uint32_t GetRegisteredRawInputDevices(_Out_ uint8_t *devices, _Inout_ uint32_t *count, uint32_t size)'),
  GetRawInputData: user32.func('uint32_t GetRawInputData(intptr_t h, uint32_t cmd, _Out_ uint8_t *data, _Inout_ uint32_t *size, uint32_t header)'),
  GetDoubleClickTime: user32.func('uint32_t GetDoubleClickTime()'),
  RegisterWindowMessageW: user32.func('uint32_t RegisterWindowMessageW(const char16_t *name)'),
  GetShellWindow: user32.func('intptr_t GetShellWindow()'),
  IsWindowVisible: user32.func('int IsWindowVisible(intptr_t hwnd)'),
  IsIconic: user32.func('int IsIconic(intptr_t hwnd)'),
  GetAsyncKeyState: user32.func('int16_t GetAsyncKeyState(int vk)'),
  ScreenToClient: user32.func('int ScreenToClient(intptr_t hwnd, _Inout_ POINT *pt)'),
  SetWindowsHookExW: user32.func('intptr_t SetWindowsHookExW(int id, LowLevelMouseProc *fn, intptr_t mod, uint32_t thread)'),
  CallNextHookEx: user32.func('intptr_t CallNextHookEx(intptr_t hook, int code, uintptr_t wp, void *lp)'),
  UnhookWindowsHookEx: user32.func('int UnhookWindowsHookEx(intptr_t hook)'),
  GetCurrentThreadId: kernel32.func('uint32_t GetCurrentThreadId()'),
  GetModuleHandleW: kernel32.func('intptr_t GetModuleHandleW(const char16_t *name)'),
  OpenProcess: kernel32.func('intptr_t OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
  CloseHandle: kernel32.func('int CloseHandle(intptr_t h)'),
  VirtualAllocEx: kernel32.func('intptr_t VirtualAllocEx(intptr_t proc, intptr_t addr, uintptr_t size, uint32_t type, uint32_t protect)'),
  WriteProcessMemory: kernel32.func('int WriteProcessMemory(intptr_t proc, intptr_t addr, const uint8_t *buf, uintptr_t size, _Out_ uintptr_t *written)'),
  ReadProcessMemory: kernel32.func('int ReadProcessMemory(intptr_t proc, intptr_t addr, _Out_ uint8_t *buf, uintptr_t size, _Out_ uintptr_t *read)'),
  K32EmptyWorkingSet: kernel32.func('int K32EmptyWorkingSet(intptr_t proc)'),
};

const C = {
  SMTO_NORMAL: 0,
  SWP_NOSIZE: 0x1, SWP_NOZORDER: 0x4, SWP_NOACTIVATE: 0x10, SWP_FRAMECHANGED: 0x20, SWP_SHOWWINDOW: 0x40,
  FRAME_STYLES: 0x00c00000 | 0x00040000 | 0x00080000 | 0x20000 | 0x10000, // CAPTION|THICKFRAME|SYSMENU|MIN|MAX
  GA_PARENT: 1, GA_ROOT: 2,
  GWL_STYLE: -16,
  WM_INPUT: 0x00ff,
  RID_INPUT: 0x10000003,
  RIDEV_INPUTSINK: 0x100,
  RI_MOUSE_LEFT_DOWN: 0x1, RI_MOUSE_LEFT_UP: 0x2,
  RI_MOUSE_WHEEL: 0x400, RI_MOUSE_HWHEEL: 0x800,
  WH_MOUSE_LL: 14, WM_LBUTTONDOWN: 0x201, WM_LBUTTONUP: 0x202, WM_LBUTTONDBLCLK: 0x203,
  SMTO_ABORTIFHUNG: 0x2,
  LVM_GETITEMCOUNT: 0x1004, LVM_HITTEST: 0x1012,
};

function className(hwnd) {
  if (!hwnd) return '';
  const buf = Buffer.alloc(512);
  const n = api.GetClassNameW(hwnd, buf, 256);
  return buf.toString('utf16le', 0, n * 2);
}

function cursorPos() {
  const pt = {};
  api.GetCursorPos(pt);
  return pt;
}

function windowRect(hwnd) {
  const r = {};
  api.GetWindowRect(hwnd, r);
  return r;
}

function hwndFromBuffer(buf) {
  return Number(buf.readBigUInt64LE(0));
}

/** 바탕화면 아이콘 레이어 아래(배경화면 레이어)에 붙일 부모 창을 찾는다. */
function findWallpaperHost() {
  const progman = api.FindWindowW('Progman', null);
  if (!progman) return null;
  const out = [0];
  // Progman 에 0x052C 를 보내면 배경화면용 WorkerW 가 생성된다.
  api.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, C.SMTO_NORMAL, 1000, out);
  api.SendMessageTimeoutW(progman, 0x052c, 0, 0, C.SMTO_NORMAL, 1000, out);

  // Windows 11 24H2 이후: WorkerW 가 Progman 의 자식. 아이콘(SHELLDLL_DefView) 바로 아래에 끼운다.
  const childWorker = api.FindWindowExW(progman, 0, 'WorkerW', null);
  const progmanDefView = api.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  if (childWorker) {
    return { kind: 'progman', parent: progman, insertAfter: progmanDefView || 0 };
  }

  // 이전 버전: SHELLDLL_DefView 를 가진 WorkerW 의 다음 WorkerW 가 배경 레이어.
  let w = 0;
  while ((w = api.FindWindowExW(0, w, 'WorkerW', null))) {
    if (api.FindWindowExW(w, 0, 'SHELLDLL_DefView', null)) {
      const worker = api.FindWindowExW(0, w, 'WorkerW', null);
      if (worker) return { kind: 'workerw', parent: worker, insertAfter: 0 };
    }
  }
  if (progmanDefView) return { kind: 'progman', parent: progman, insertAfter: progmanDefView };
  return null;
}

/** 커서 아래가 '바탕화면'인지 (다른 프로그램 창이 덮고 있지 않은지) */
const rootClassCache = new Map();
function isDesktopAt(pt, ownHwnd) {
  const h = api.WindowFromPoint(pt);
  if (!h) return false;
  const root = api.GetAncestor(h, C.GA_ROOT);
  if (root === ownHwnd || h === ownHwnd) return true;
  // 창 핸들별 클래스 이름은 바뀌지 않으므로 캐시 (오래된 핸들이 쌓이지 않게 가끔 비운다)
  let cls = rootClassCache.get(root);
  if (cls === undefined) {
    if (rootClassCache.size > 200) rootClassCache.clear();
    cls = className(root);
    rootClassCache.set(root, cls);
  }
  return cls === 'Progman' || cls === 'WorkerW';
}

/** 바탕화면 아이콘 목록 창(SysListView32): Progman 또는 WorkerW 아래 SHELLDLL_DefView 안에 있다 */
let iconListHwnd = 0;
function desktopListView() {
  if (iconListHwnd && api.IsWindow(iconListHwnd)) return iconListHwnd;
  const progman = api.FindWindowW('Progman', null);
  let defView = progman ? api.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null) : 0;
  let w = 0;
  while (!defView && (w = api.FindWindowExW(0, w, 'WorkerW', null))) defView = api.FindWindowExW(w, 0, 'SHELLDLL_DefView', null);
  iconListHwnd = defView ? api.FindWindowExW(defView, 0, 'SysListView32', null) : 0;
  return iconListHwnd;
}

// LVM_HITTEST 는 탐색기 프로세스 안의 메모리 주소를 받으므로, 탐색기 안에 작은 버퍼를 하나 잡아 둔다 (탐색기가 다시 시작되면 새로)
let remote = { pid: 0, proc: 0, mem: 0 };
function remoteBuffer(listView) {
  const pid = [0];
  api.GetWindowThreadProcessId(listView, pid);
  if (remote.pid === pid[0]) return remote;
  if (remote.proc) api.CloseHandle(remote.proc);
  const proc = api.OpenProcess(0x8 | 0x10 | 0x20, 0, pid[0]); // PROCESS_VM_OPERATION | VM_READ | VM_WRITE
  const mem = proc ? api.VirtualAllocEx(proc, 0, 64, 0x3000, 0x04) : 0; // MEM_COMMIT|MEM_RESERVE, PAGE_READWRITE
  remote = { pid: pid[0], proc, mem };
  return remote;
}

const hitInfo = Buffer.alloc(24); // LVHITTESTINFO { POINT pt; UINT flags; int iItem; int iSubItem; int iGroup; }
/**
 * 화면 좌표 pt 에 바탕화면 아이콘(그림·이름)이 있는지. 확인할 수 없으면 false.
 * 아이콘 위의 클릭은 앱에 전달하지 않기 위해 쓴다 (앱은 아이콘 아래 레이어).
 */
function desktopIconAt(pt) {
  const lv = desktopListView();
  if (!lv) return false;
  const r = remoteBuffer(lv);
  if (!r.mem) return false;
  const cp = { x: pt.x, y: pt.y };
  api.ScreenToClient(lv, cp);
  hitInfo.fill(0);
  hitInfo.writeInt32LE(cp.x, 0);
  hitInfo.writeInt32LE(cp.y, 4);
  if (!api.WriteProcessMemory(r.proc, r.mem, hitInfo, hitInfo.length, [0])) return false;
  const out = [0];
  // SMTO_BLOCK: 기다리는 동안 다른 메시지(다음 마우스 훅 호출 등)를 처리하지 않는다
  if (!api.SendMessageTimeoutW(lv, C.LVM_HITTEST, 0, r.mem, C.SMTO_ABORTIFHUNG | 0x1, 80, out)) return false;
  return BigInt.asIntN(32, BigInt(out[0])) >= 0n;
}

/** 지금 눌려 있는 보조 키 (바탕화면 모드에서 전달하는 마우스 입력에 붙인다: Ctrl+끌기 복사 등) */
function modifierKeys() {
  const down = (vk) => api.GetAsyncKeyState(vk) & 0x8000;
  const m = [];
  if (down(0x11)) m.push('control');
  if (down(0x10)) m.push('shift');
  if (down(0x12)) m.push('alt');
  return m;
}

/**
 * 저수준 마우스 훅 (왼쪽 버튼만 다룬다). handler(msg, pt) 가 true 를 돌려주면 그 입력을 다른 창에 보내지 않는다.
 * 앱이 처리할 클릭은 여기서 가로채, 탐색기 바탕화면이 선택 사각형을 그리거나 아이콘을 선택하지 않게 한다.
 */
const hook = { handle: 0, cb: null, handler: null };
function installMouseHook(handler) {
  hook.handler = handler;
  if (hook.handle) return true;
  if (!hook.cb) {
    hook.cb = koffi.register((code, wp, lp) => {
      try {
        const msg = Number(wp);
        if (code >= 0 && hook.handler && (msg === C.WM_LBUTTONDOWN || msg === C.WM_LBUTTONUP)) {
          const info = koffi.decode(lp, MSLLHOOKSTRUCT);
          if (hook.handler(msg, info.pt)) return 1;
        }
      } catch { /* 훅 안의 오류로 마우스가 막히지 않게 그대로 흘려보낸다 */ }
      return api.CallNextHookEx(0, code, wp, lp);
    }, koffi.pointer(LowLevelMouseProc));
  }
  hook.handle = api.SetWindowsHookExW(C.WH_MOUSE_LL, hook.cb, api.GetModuleHandleW(null), 0);
  return !!hook.handle;
}
function uninstallMouseHook() {
  if (hook.handle) api.UnhookWindowsHookEx(hook.handle);
  hook.handle = 0;
}
const mouseHookActive = () => !!hook.handle;

/**
 * 사용자가 직접 작업표시줄 버튼을 누르거나 Alt+Tab 으로 고른 것인지.
 * (Windows 는 시작할 때·다른 창이 사라질 때 등 저절로도 창을 활성화하므로, 그것과 구분한다)
 */
const TASKBAR_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'TaskListThumbnailWnd', 'XamlExplorerHostIslandWindow']);
function userPickedFromTaskbar() {
  const down = (vk) => api.GetAsyncKeyState(vk) & 0x8000;
  if (down(0x12) || down(0x5b) || down(0x5c)) return true; // Alt(Alt+Tab) · Win(Win+숫자)
  const root = api.GetAncestor(api.WindowFromPoint(cursorPos()), C.GA_ROOT);
  return TASKBAR_CLASSES.has(className(root));
}

/**
 * 이 앱 창이 전경이면 편집 모드 전에 쓰던 창(prev)으로, 없으면 바탕화면으로 넘긴다.
 * (바탕화면으로 내려간 뒤 작업표시줄 대리 창이 대신 활성화되어 다시 올라오지 않게)
 */
function yieldForeground(ownHwnds, prev = 0) {
  const fg = api.GetForegroundWindow();
  if (!ownHwnds.includes(fg)) return;
  const usable = prev && !ownHwnds.includes(prev) && api.IsWindow(prev) && api.IsWindowVisible(prev) && !api.IsIconic(prev);
  const target = usable ? prev : api.GetShellWindow();
  if (target) api.SetForegroundWindow(target);
}

function forceForeground(hwnd) {
  const fg = api.GetForegroundWindow();
  const me = api.GetCurrentThreadId();
  const other = fg ? api.GetWindowThreadProcessId(fg, [0]) : 0;
  const attach = other && other !== me;
  if (attach) api.AttachThreadInput(me, other, 1);
  api.BringWindowToTop(hwnd);
  api.SetForegroundWindow(hwnd);
  if (attach) api.AttachThreadInput(me, other, 0);
}

/** 마우스 Raw Input 등록 해제 (커서가 바탕화면 밖에 있을 때 이벤트 폭주를 막기 위해) */
function unregisterRawMouse() {
  const dev = Buffer.alloc(16);
  dev.writeUInt16LE(0x01, 0);
  dev.writeUInt16LE(0x02, 2);
  dev.writeUInt32LE(0x1, 4); // RIDEV_REMOVE
  return api.RegisterRawInputDevices(dev, 1, 16);
}

function registerRawMouse(hwnd) {
  // RAWINPUTDEVICE { USHORT usUsagePage; USHORT usUsage; DWORD dwFlags; HWND hwndTarget; } = 16 bytes(x64)
  const dev = Buffer.alloc(16);
  dev.writeUInt16LE(0x01, 0);
  dev.writeUInt16LE(0x02, 2);
  dev.writeUInt32LE(C.RIDEV_INPUTSINK, 4);
  dev.writeBigUInt64LE(BigInt(hwnd), 8);
  return api.RegisterRawInputDevices(dev, 1, 16);
}

/** 이 프로세스의 마우스 Raw Input 이 아직 우리 창으로 등록되어 있는지 (Chromium 이 바꿔 버릴 수 있음) */
function rawMouseTarget() {
  const buf = Buffer.alloc(16 * 16);
  const count = [16];
  const n = api.GetRegisteredRawInputDevices(buf, count, 16);
  if (n === 0xffffffff) return { ok: false, target: 0, flags: 0 };
  for (let i = 0; i < n; i++) {
    const page = buf.readUInt16LE(i * 16);
    const usage = buf.readUInt16LE(i * 16 + 2);
    if (page === 0x01 && usage === 0x02) return { ok: true, flags: buf.readUInt32LE(i * 16 + 4), target: Number(buf.readBigUInt64LE(i * 16 + 8)) };
  }
  return { ok: false, target: 0, flags: 0 };
}

const rawBuf = Buffer.alloc(64);
/** WM_INPUT lParam → { buttons, wheel } (마우스가 아니면 null) */
function readRawMouse(lParamBuf) {
  const h = hwndFromBuffer(lParamBuf);
  const size = [rawBuf.length];
  const n = api.GetRawInputData(h, C.RID_INPUT, rawBuf, size, 24);
  if (n === 0xffffffff || n < 32) return null;
  if (rawBuf.readUInt32LE(0) !== 0) return null; // RIM_TYPEMOUSE
  return { buttons: rawBuf.readUInt16LE(28), data: rawBuf.readInt16LE(30) };
}

/**
 * 프로세스가 지금 쥐고 있는 메모리 페이지를 Windows 에 돌려준다(EmptyWorkingSet).
 * 다시 필요한 페이지는 쓸 때 곧바로 올라오므로 동작에는 영향이 없다. 성공하면 true
 */
function trimWorkingSet(pid) {
  const h = api.OpenProcess(0x0100 | 0x1000, 0, pid); // PROCESS_SET_QUOTA | PROCESS_QUERY_LIMITED_INFORMATION
  if (!h) return false;
  try {
    return !!api.K32EmptyWorkingSet(h);
  } finally {
    api.CloseHandle(h);
  }
}

module.exports = {
  api, C, cursorPos, trimWorkingSet, windowRect, hwndFromBuffer,
  findWallpaperHost, isDesktopAt, forceForeground, userPickedFromTaskbar, yieldForeground, registerRawMouse, unregisterRawMouse, readRawMouse, rawMouseTarget,
  desktopIconAt, modifierKeys, installMouseHook, uninstallMouseHook, mouseHookActive,
};
