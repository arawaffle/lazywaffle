// 바로가기: 클릭하면 등록한 웹사이트로 이동 (등록은 화면 설정 > 스티커·바로가기)
// - 리스트형: 레이아웃 격자 안의 독 위젯
// - 자유형: 스티커처럼 화면 어디에나 놓는다 (끌어서 이동)
import { html, useRef, useSize, cx, capture } from '../lib.js';
import { useApp, update } from '../store.js';
import { openExternal } from '../storage.js';
import { useCrispIcon } from '../util/icon.js';

/** 타일 실제 크기에 맞춰 고품질로 줄인 아이콘 (작은 이미지는 정수배 확대 + 여백) */
function LinkFace({ link }) {
  const ref = useRef(null);
  const { width } = useSize(ref);
  const icon = useCrispIcon(link.icon, width);
  if (!link.icon) return html`<span class="link-letter" aria-hidden="true">${(link.title || '?').trim().charAt(0).toUpperCase()}</span>`;
  const dpr = window.devicePixelRatio || 1;
  return html`<span class="link-face" ref=${ref}>
    ${!icon && html`<img src=${link.icon} alt="" draggable="false" />`}
    ${icon && (icon.small
      ? html`<img class="is-small" src=${icon.url} alt="" draggable="false"
          style=${{ width: icon.w / dpr + 'px', height: icon.h / dpr + 'px', imageRendering: icon.scale > 1 ? 'pixelated' : 'auto' }} />`
      : html`<img src=${icon.url} alt="" draggable="false" />`)}
  </span>`;
}

/** 리스트형 → 자유형 전환: 지금 독에 보이는 위치 그대로 화면 좌표(%)로 옮긴다 */
export function setLinksMode(mode) {
  const pos = {};
  if (mode === 'free') {
    document.querySelectorAll('.w-links [data-link-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      pos[el.dataset.linkId] = { fx: ((r.left + r.width / 2) / window.innerWidth) * 100, fy: ((r.top + r.height / 2) / window.innerHeight) * 100 };
    });
  }
  update((s) => {
    s.settings.linksMode = mode;
    s.links.forEach((l, i) => {
      if (pos[l.id]) Object.assign(l, pos[l.id]);
      else if (l.fx == null) Object.assign(l, { fx: 92, fy: 40 + i * 9 });
    });
  });
}

export function Links() {
  const { links } = useApp();
  const ref = useRef(null);
  const { width, height } = useSize(ref);
  const vertical = height >= width;
  return html`<section class=${cx('widget w-links', vertical ? 'is-vertical' : 'is-horizontal')} aria-labelledby="links-title" ref=${ref}>
    <h2 class="sr-only" id="links-title">바로가기</h2>
    <ul class="link-list">
      ${links.map((l) => html`<li key=${l.id}>
        <button type="button" class="link-tile" data-link-id=${l.id} data-tip=${l.title} onClick=${() => openExternal(l.url)} aria-label=${`${l.title} 열기, 새 창`}>
          <${LinkFace} link=${l} />
        </button>
      </li>`)}
    </ul>
  </section>`;
}

/**
 * 자유형 바로가기 레이어: 바탕화면 아이콘처럼 언제든 끌어서 옮긴다 (짧게 누르면 열기).
 * 드래그가 중간에 끊겨도(pointercancel · 캡처 해제) 그 자리에서 끝낸다.
 */
export function FreeLinks({ editing }) {
  const { links } = useApp();
  const dragged = useRef(false);

  function startDrag(e, link) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    capture(el, e);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = link.fx ?? 92;
    const oy = link.fy ?? 50;
    let latest = null;
    const move = (ev) => {
      if (!latest && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; // 조금 흔들린 건 클릭
      if (!latest) el.classList.add('is-dragging');
      latest = {
        fx: Math.min(98, Math.max(2, ox + ((ev.clientX - sx) / window.innerWidth) * 100)),
        fy: Math.min(97, Math.max(3, oy + ((ev.clientY - sy) / window.innerHeight) * 100)),
      };
      el.style.left = latest.fx + '%';
      el.style.top = latest.fy + '%';
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      el.classList.remove('is-dragging');
      if (latest) {
        dragged.current = true; // 끈 직후의 click 은 열지 않음
        setTimeout(() => (dragged.current = false), 0);
        const pos = latest;
        latest = null;
        update((s) => Object.assign(s.links.find((l) => l.id === link.id), pos));
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  function onKey(e, link) {
    if (!editing) return;
    const step = e.shiftKey ? 5 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    update((s) => {
      const l = s.links.find((x) => x.id === link.id);
      l.fx = Math.min(98, Math.max(2, l.fx + d[0]));
      l.fy = Math.min(97, Math.max(3, l.fy + d[1]));
    });
  }

  return html`<div class=${cx('free-links', editing && 'is-editing')} role="region" aria-label="바로가기">
    ${links.map((l) => html`<button type="button" key=${l.id} class="link-tile free-link" data-tip=${editing ? `${l.title} — 누르면 열기 · 끌면 이동` : l.title}
        draggable="false"
        style=${{ left: (l.fx ?? 92) + '%', top: (l.fy ?? 50) + '%' }}
        onPointerDown=${(e) => startDrag(e, l)} onKeyDown=${(e) => onKey(e, l)}
        onClick=${() => !dragged.current && openExternal(l.url)}
        aria-label=${editing ? `${l.title} 열기, 새 창 (방향키로 위치 이동)` : `${l.title} 열기, 새 창 (끌어서 위치 이동)`}>
      <${LinkFace} link=${l} />
    </button>`)}
  </div>`;
}
