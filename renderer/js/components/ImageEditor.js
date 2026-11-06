// 이미지 간단 편집: 실제 영역과 같은 비율의 틀 안에서 끌어서 위치, 휠/슬라이더로 확대(=크롭)
import { html, useState, useRef, useSize, capture } from '../lib.js';
import { setSetting } from '../actions.js';
import { Popup } from './Popup.js';
import { Segmented, Range } from './controls.js';
import { Icon } from './icons.js';
import { ImageSurface, useNaturalSize, imageLayout } from './Fill.js';

const AREA_SELECTOR = { banner: '.banner', background: '.content' };

/**
 * path: 'banner' | 'background' (설정에 바로 저장)
 * 또는 onApply(fill) + aspect(가로/세로 비율) + title — 다른 곳의 이미지(날짜 칸 이미지 등). popover: 위젯 옆에 띄울 위치
 * plain: 전체 보기의 빈 곳을 흐린 배경 없이 (실제로 그렇게 그려지는 곳)
 */
export function ImageEditor({ path, fill, onClose, onApply, aspect, title, popover, plain }) {
  const area = !aspect && document.querySelector(AREA_SELECTOR[path]);
  const ar = aspect ? { width: aspect, height: 1 } : area ? area.getBoundingClientRect() : { width: 16, height: 9 };
  const nat = useNaturalSize(fill.image);
  const [view, setView] = useState(() => fill.view || { zoom: 1, cx: (fill.posX ?? 50) / 100, cy: (fill.posY ?? 50) / 100 });
  const [fit, setFit] = useState(fill.fit || 'cover');
  const frameRef = useRef(null);
  const box = useSize(frameRef);
  const draft = { ...fill, fit, view };

  function startPan(e) {
    if (e.button !== 0 || !nat) return;
    e.preventDefault();
    const el = e.currentTarget;
    capture(el, e);
    const lay = imageLayout(nat, box, draft);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = view;
    const move = (ev) => {
      setView({
        ...start,
        cx: Math.min(1, Math.max(0, start.cx - (ev.clientX - sx) / lay.W)),
        cy: Math.min(1, Math.max(0, start.cy - (ev.clientY - sy) / lay.H)),
      });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function onKey(e) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      setView((v) => ({ ...v, cx: Math.min(1, Math.max(0, v.cx + d[0])), cy: Math.min(1, Math.max(0, v.cy + d[1])) }));
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      setView((v) => ({ ...v, zoom: Math.min(4, Math.max(1, v.zoom + (e.key === '-' ? -0.1 : 0.1))) }));
    }
  }

  const zoomPct = Math.round(view.zoom * 100);
  function apply() {
    const r = (n) => Math.round(n * 1000) / 1000;
    const next = { ...fill, fit, view: { zoom: r(view.zoom), cx: r(view.cx), cy: r(view.cy) } };
    if (onApply) onApply(next);
    else setSetting(path + '.fill', next);
    onClose();
  }

  return html`<${Popup} title=${title || (path === 'banner' ? '배너 이미지 편집' : '배경 이미지 편집')} onClose=${onClose} size="lg" backdropClose=${false} popover=${popover}
    footer=${html`<button type="button" class="btn btn-ghost" onClick=${() => { setView({ zoom: 1, cx: 0.5, cy: 0.5 }); setFit('cover'); }}>
        <${Icon} name="reset" size=${14} /> 초기화</button>
      <span class="foot-space"></span>
      <button type="button" class="btn" onClick=${onClose}>취소</button>
      <button type="button" class="btn btn-primary" onClick=${apply}>적용</button>`}>
    <div class="ie-wrap">
      <div class="ie-frame" ref=${frameRef} style=${{ aspectRatio: (ar.width / ar.height).toFixed(4), width: `min(100%, ${(18 * ar.width / ar.height).toFixed(2)}rem)` }}
        tabindex="0" role="application" aria-label="이미지 위치 조절: 끌거나 방향키로 이동, +/- 로 확대"
        onPointerDown=${startPan} onKeyDown=${onKey}
        onWheel=${(e) => { e.preventDefault(); setView((v) => ({ ...v, zoom: Math.min(4, Math.max(1, v.zoom - Math.sign(e.deltaY) * 0.1)) })); }}>
        <${ImageSurface} fill=${draft} box=${box} nat=${nat} plain=${plain} />
        <span class="ie-grid" aria-hidden="true"></span>
      </div>
      <div class="ie-controls">
        <${Segmented} label="맞춤" size="sm" value=${fit} onChange=${setFit}
          options=${[{ value: 'cover', label: '영역 채우기 (크롭)' }, { value: 'contain', label: '전체 보기' }]} />
        <${Range} label="확대" value=${zoomPct} min=${100} max=${400} step=${5} suffix="%" onChange=${(v) => setView({ ...view, zoom: v / 100 })} />
      </div>
    </div>
  <//>`;
}
