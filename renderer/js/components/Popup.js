// 위젯 영역 안에서만 열리는 팝업(대화상자).
// 기본: 부모 위젯(.widget, position:relative) 을 덮는 레이어로 렌더링되어 영역을 벗어나지 않는다.
// popover: 위젯이 너무 작을 때 위젯 옆에 붙어 뜨는 작은 창 (style 로 위치 지정).
//   머리를 끌어 옮길 수 있고, 닫았다 다시 열면 처음 자리에서 열린다 (옮긴 거리는 기억하지 않음)
import { html, useEffect, useRef, useState, useId, cx, capture } from '../lib.js';
import { hold, release } from '../focus.js';
import { IconButton } from './icons.js';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

export function Popup({ title, onClose, children, footer, className, size = 'md', backdropClose = true, popover = null }) {
  const ref = useRef(null);
  const id = useId();
  const key = useRef('popup-' + id);
  const [shift, setShift] = useState({ x: 0, y: 0 }); // 팝오버를 끌어 옮긴 거리

  useEffect(() => {
    const prev = document.activeElement;
    hold(key.current);
    const el = ref.current;
    const first = el && (el.querySelector('[data-autofocus]') || el.querySelector('input:not([type=checkbox]):not([type=radio]), textarea, select') || el.querySelector(FOCUSABLE));
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    // 팝오버는 바깥을 누르면 닫힌다
    const outside = (e) => {
      if (popover && backdropClose && el && !el.contains(e.target)) onClose && onClose();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      release(key.current);
      if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose && onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** 팝오버 머리 끌기: 콘텐츠 영역(잘리지 않는 범위) 밖으로는 나가지 않게 */
  function startMove(e) {
    if (!popover || e.button !== 0 || e.target.closest('button')) return;
    const box = ref.current && ref.current.parentElement;
    if (!box) return;
    e.preventDefault();
    const head = e.currentTarget;
    capture(head, e);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = shift;
    const r = box.getBoundingClientRect();
    const area = (box.closest('.content') || document.documentElement).getBoundingClientRect();
    const lim = {
      x0: area.left - r.left, x1: area.right - r.right,
      y0: area.top - r.top, y1: Math.min(area.bottom, window.innerHeight) - r.bottom,
    };
    const clamp = (v, a, b) => Math.min(Math.max(v, Math.min(a, 0)), Math.max(b, 0));
    const move = (ev) => setShift({
      x: Math.round(start.x + clamp(ev.clientX - sx, lim.x0, lim.x1)),
      y: Math.round(start.y + clamp(ev.clientY - sy, lim.y0, lim.y1)),
    });
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  }

  // 입력을 시작한 팝업 표시: 바깥에서 누른 Esc 로는 닫지 않는다 (App.js)
  const markDirty = () => ref.current && (ref.current.dataset.dirty = '1');
  const dialog = html`<div ref=${ref} class=${cx('popup', 'popup-' + size, className)} role="dialog" aria-modal=${popover ? 'false' : 'true'}
      aria-labelledby=${id + '-t'} onKeyDown=${onKeyDown} onInput=${markDirty} onChange=${markDirty}>
    <header class=${cx('popup-head', popover && 'is-movable')} onPointerDown=${popover ? startMove : undefined}
        title=${popover ? '끌어서 옮기기' : undefined}>
      <h3 id=${id + '-t'} class="popup-title">${title}</h3>
      <${IconButton} icon="x" label="닫기" onClick=${onClose} className="popup-close" />
    </header>
    <div class="popup-body">${children}</div>
    ${footer && html`<footer class="popup-foot">${footer}</footer>`}
  </div>`;

  if (popover) {
    const moved = shift.x || shift.y ? { translate: `${shift.x}px ${shift.y}px` } : null;
    return html`<div class="popover" style=${{ ...popover, ...moved }}>${dialog}</div>`;
  }
  return html`<div class="popup-layer" onMouseDown=${(e) => { if (backdropClose && e.target === e.currentTarget) onClose && onClose(); }}>${dialog}</div>`;
}

/**
 * 위젯 옆 빈 쪽(오른쪽 → 왼쪽 → 아래·위 중 넓은 쪽)에 띄울 팝오버 위치 (Popup 의 popover prop 으로 전달)
 * 옆에 띄울 때 화면 아래쪽 위젯이면 팝오버 아랫변을 위젯 아랫변에 맞추고, 높이는 작업표시줄을 뺀 화면 안으로 제한한다.
 * widthRem: 팝오버 너비, minHeightRem: 위젯이 이보다 크면 null (= 위젯 안에 일반 팝업)
 */
export function popoverPlacement(el, widthRem = 20, minHeightRem = 0) {
  const r = el.getBoundingClientRect();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  if (minHeightRem && r.height >= minHeightRem * rem && r.width >= widthRem * rem) return null;
  // 팝오버는 콘텐츠 영역(배너 제외) 밖으로 나가면 잘리므로 그 안, 그리고 작업표시줄을 뺀 화면 안에 들어가야 한다
  const app = el.closest('.app');
  const inset = (name) => (app ? parseFloat(getComputedStyle(app).getPropertyValue(name)) || 0 : 0);
  const area = (el.closest('.content') || document.documentElement).getBoundingClientRect();
  const left = area.left + 8;
  const right = area.right - 8;
  const top = Math.max(area.top, inset('--inset-top')) + 8;
  const bottom = Math.min(area.bottom, window.innerHeight - inset('--inset-bottom')) - 8;
  const w = Math.min(widthRem * rem, (right - left) * 0.95);
  const out = 'calc(100% + 8px)';
  const width = w + 'px';
  const maxH = (px) => ({ '--pop-max-h': Math.max(160, Math.round(px)) + 'px' });
  const lower = (r.top + r.bottom) / 2 > (top + bottom) / 2;
  const v = lower ? { bottom: 0, ...maxH(Math.min(r.bottom, bottom) - top) } : { top: 0, ...maxH(bottom - Math.max(r.top, top)) };
  if (r.right + 8 + w <= right) return { left: out, width, ...v };
  if (r.left - 8 - w >= left) return { right: out, width, ...v };
  const h = r.left + w <= right ? { left: 0 } : { right: 0 };
  const below = bottom - r.bottom - 8;
  const above = r.top - top - 8;
  return below >= above ? { ...h, top: out, width, ...maxH(below) } : { ...h, bottom: out, width, ...maxH(above) };
}

/** 확인 대화상자 */
export function Confirm({ title = '확인', message, confirmLabel = '확인', danger, onConfirm, onCancel, extra }) {
  return html`<${Popup} title=${title} onClose=${onCancel} size="sm" footer=${html`
      <button type="button" class="btn" onClick=${onCancel}>취소</button>
      ${extra}
      <button type="button" class=${cx('btn', danger ? 'btn-danger' : 'btn-primary')} onClick=${onConfirm} data-autofocus>${confirmLabel}</button>`}>
    <p class="confirm-msg">${message}</p>
  <//>`;
}
