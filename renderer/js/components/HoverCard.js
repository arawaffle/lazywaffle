// 마우스를 올리면 뜨는 작은 카드 (캘린더 '+N' 미리보기 등).
// 위젯은 overflow 로 잘리므로 툴팁처럼 앱 최상단 레이어에 하나만 그린다. 카드 위로 마우스를 옮겨도 닫히지 않아 항목을 누를 수 있다.
import { html, useState, useEffect, useLayoutEffect, useRef, useBus, bus } from '../lib.js';

let hideTimer = null;

/** anchor 요소 아래(공간이 없으면 위)에 카드를 띄운다. render(): 카드 내용 */
export function showHoverCard(anchor, render) {
  clearTimeout(hideTimer);
  bus.emit('hovercard', { rect: anchor.getBoundingClientRect(), render });
}

/** 잠깐 기다렸다 닫는다 (그 사이 카드로 마우스가 들어오면 유지) */
export function hideHoverCard(delay = 160) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bus.emit('hovercard', null), delay);
}

export function HoverCard() {
  const [card, setCard] = useState(null);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  useBus('hovercard', setCard);

  // 카드 밖을 누르거나 창이 포커스를 잃으면 닫는다
  useEffect(() => {
    if (!card) return undefined;
    const close = (e) => {
      if (!ref.current || !ref.current.contains(e.target)) setCard(null);
    };
    const closeNow = () => setCard(null);
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', closeNow);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', closeNow);
    };
  }, [card]);

  useLayoutEffect(() => {
    if (!card || !ref.current) return setPos(null);
    const { width: w, height: h } = ref.current.getBoundingClientRect();
    const r = card.rect;
    const gap = 6;
    const above = r.bottom + gap + h > window.innerHeight - 4 && r.top - gap - h >= 4;
    const left = Math.min(window.innerWidth - w - 4, Math.max(4, r.right - w));
    setPos({ left, top: above ? r.top - gap - h : Math.min(r.bottom + gap, window.innerHeight - h - 4) });
  }, [card]);

  if (!card) return null;
  return html`<div ref=${ref} class="hover-card"
      style=${pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { visibility: 'hidden', left: 0, top: 0 }}
      onPointerEnter=${() => clearTimeout(hideTimer)} onPointerLeave=${() => hideHoverCard()}>
    ${card.render(() => setCard(null))}
  </div>`;
}
