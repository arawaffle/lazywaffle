// 바탕화면 모드에서는 키보드를 받을 수 없으므로, 입력이 필요한 순간에만 창을 앞으로 올린다.
// hold(key) 가 하나라도 있으면 편집 모드, 모두 풀리면 바탕화면으로 돌아간다.
const shell = window.desk || null; // storage.js 와의 순환 import 를 피하려고 직접 참조

const holds = new Set();
const subs = new Set();
let mode = shell ? 'wallpaper' : 'browser';
let releaseTimer = null;

function setMode(m) {
  mode = m;
  // 다른 창 클릭 등으로 바탕화면에 돌아가면 키보드가 닿지 않으므로 입력란 포커스와 'text-field' 보류를 놓는다
  // (남겨 두면 다음 편집 모드가 팝업을 닫아도 끝나지 않는다)
  if (m === 'wallpaper') {
    holds.delete('text-field');
    if (isTextField(document.activeElement)) document.activeElement.blur();
  }
  document.documentElement.dataset.mode = m;
  subs.forEach((fn) => fn(m));
}

if (shell) {
  shell.onMode(setMode);
  if (shell.onCovered) shell.onCovered((covered) => document.documentElement.classList.toggle('is-covered', covered));
  shell.info().then((info) => info && setMode(info.mode));
}
document.documentElement.dataset.mode = mode;

export const getMode = () => mode;
export function onModeChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

function sync() {
  clearTimeout(releaseTimer);
  if (!shell) return;
  if (holds.size) {
    if (mode === 'wallpaper') shell.requestFocus();
  } else {
    releaseTimer = setTimeout(() => {
      if (!holds.size && mode === 'edit') shell.releaseFocus();
    }, 220);
  }
}

export function hold(key) {
  holds.add(key);
  sync();
}
export function release(key) {
  if (!holds.delete(key)) return;
  sync();
}
export function requestKeyboard() {
  if (shell && mode === 'wallpaper') shell.requestFocus();
}
export function releaseAll() {
  holds.clear();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (shell && mode === 'edit') shell.releaseFocus();
}

const NON_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);
export function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NON_TEXT.has(el.type);
}

document.addEventListener('focusin', (e) => {
  if (isTextField(e.target)) hold('text-field');
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!isTextField(document.activeElement)) release('text-field');
  }, 0);
});
document.addEventListener('pointerdown', (e) => {
  if (isTextField(e.target) || (e.target.closest && e.target.closest('[data-keyboard]'))) requestKeyboard();
}, true);
