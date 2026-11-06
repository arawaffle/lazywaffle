// 말풍선 툴팁: data-tip 속성이 있는 요소에 마우스를 올리거나 포커스하면 위(공간이 없으면 아래)에 표시.
// 화면 하나에 하나만 그리며, 화면 밖으로 나가지 않도록 위치를 보정한다. (스크린리더는 aria-label 로 읽음)
import { html, useState, useEffect, useLayoutEffect, useRef } from '../lib.js';

export function Tooltip() {
  const [tip, setTip] = useState(null);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    let current = null;
    const show = (e) => {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (!el || el === current || !el.dataset.tip) return;
      if (e.buttons) return; // 끄는 중에는 띄우지 않는다 (옮긴 뒤 원래 자리에 말풍선이 남지 않게)
      current = el;
      setTip({ text: el.dataset.tip, rect: el.getBoundingClientRect() });
    };
    const hide = (e) => {
      if (!current) return;
      const to = e.relatedTarget;
      if (to && current.contains(to)) return;
      current = null;
      setTip(null);
    };
    const clear = () => {
      current = null;
      setTip(null);
    };
    document.addEventListener('pointerover', show);
    document.addEventListener('pointerout', hide);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('pointerover', show);
      document.removeEventListener('pointerout', hide);
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null);
    const { width: w, height: h } = ref.current.getBoundingClientRect();
    const r = tip.rect;
    const gap = 8;
    const below = r.top - h - gap < 4;
    const cxp = r.left + r.width / 2;
    const left = Math.min(window.innerWidth - w - 4, Math.max(4, cxp - w / 2));
    setPos({ left, top: below ? r.bottom + gap : r.top - h - gap, arrow: cxp - left, below });
  }, [tip]);

  if (!tip) return null;
  return html`<div ref=${ref} class=${'tooltip' + (pos && pos.below ? ' is-below' : '')} aria-hidden="true"
    style=${pos ? { left: pos.left + 'px', top: pos.top + 'px', '--arrow': pos.arrow + 'px' } : { visibility: 'hidden', left: 0, top: 0 }}>${tip.text}</div>`;
}
