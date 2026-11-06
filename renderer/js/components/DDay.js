// D-day: 캘린더에서 'D-day 표시'를 켠 일정을 보여준다. 클릭하면 캘린더 상세 팝업, 끌면 순서 변경.
// 이름 · 날짜 옆에 아이콘 두 개(상단 · 하단, 하트 · 별 · 꽃 …)를 세로로 붙일 수 있다. 테마는 도트 · 라인 · 채움 (모양은 같이, 색은 따로).
import { html, useMemo, useNow, useState, useRef, useEffect, useLayoutEffect, useId, bus, cx, capture } from '../lib.js';
import { useApp } from '../store.js';
import { reorderDday, setDdayThumb } from '../actions.js';
import { ymd, fmtKoDate } from '../util/date.js';
import { ddayOf } from '../util/recur.js';
import { Popup, popoverPlacement } from './Popup.js';
import { Segmented, ColorPicker } from './controls.js';
import { Icon } from './icons.js';

/** 일정 색: 직접 고른 색 → 카테고리 색 → 기본 */
function eventColor(ev, categories) {
  const cat = ev.categoryId && categories.find((c) => c.id === ev.categoryId);
  return ev.color || (cat && cat.color) || '#d9d9d9';
}

// 도트 아이콘 모양 (X = 칠한 칸). 칸 사이의 옅은 선으로 도트 느낌
const SHAPES = {
  heart: { label: '하트', rows: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'] },
  star: { label: '별', rows: ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', '.X...X.'] },
  circle: { label: '동그라미', rows: ['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'] },
  flower: { label: '꽃', rows: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XX.XX.'] },
  diamond: { label: '다이아', rows: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'] },
  spade: { label: '스페이드', rows: ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '.XX.XX.', '...X...', '..XXX..'] },
  clover: { label: '클로버', rows: ['..XXX..', '..XXX..', 'XX.X.XX', 'XXXXXXX', 'XX.X.XX', '...X...', '..XXX..'] },
  ribbon: { label: '리본', rows: ['XX...XX', 'XXX.XXX', 'XXXXXXX', 'XXX.XXX', 'XX...XX', '..X.X..', '.X...X.'] },
};
const SHAPE_CELLS = Object.fromEntries(Object.entries(SHAPES).map(([k, s]) => [k, {
  w: s.rows[0].length,
  h: s.rows.length,
  cells: s.rows.flatMap((row, y) => [...row].map((c, x) => (c === 'X' ? [x, y] : null)).filter(Boolean)),
}]));

/** 도트 아이콘: 높이는 CSS 로, 너비는 모양 비율대로 */
export function DotIcon({ shape = 'heart', color, className }) {
  const s = SHAPE_CELLS[shape] || SHAPE_CELLS.heart;
  return html`<svg class=${cx('dot-icon', className)} viewBox=${`0 0 ${s.w} ${s.h}`} style=${{ aspectRatio: `${s.w} / ${s.h}` }}
      aria-hidden="true" shape-rendering="crispEdges">
    <g fill=${color} stroke="#fff" stroke-opacity=".45" stroke-width=".1">
      ${s.cells.map(([x, y]) => html`<rect x=${x} y=${y} width="1" height="1" />`)}
    </g>
  </svg>`;
}

// 라인 · 채움 테마: 도트와 같은 모양을 매끈한 선으로 (24×24)
const VECTOR = {
  heart: 'M12 21s-7.5-4.6-9.5-9.3C1.1 8.4 3 5 6.5 5c2.1 0 3.6 1.2 5.5 3.3C13.9 6.2 15.4 5 17.5 5 21 5 22.9 8.4 21.5 11.7 19.5 16.4 12 21 12 21z',
  star: 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z',
  circle: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z',
  flower: 'M9 9A4.2 4.2 0 1 1 15 9A4.2 4.2 0 1 1 15 15A4.2 4.2 0 1 1 9 15A4.2 4.2 0 1 1 9 9zM12 10.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 1 0 0-3.6z',
  diamond: 'M12 2.5L20 12 12 21.5 4 12z',
  spade: 'M12 2.5C9 6.5 3.5 9.5 3.5 13.6c0 2.6 2 4.4 4.3 4.4 1.6 0 2.9-.8 3.6-2C11 18.5 10 20.3 8.5 21.5h7c-1.5-1.2-2.5-3-2.9-5.5.7 1.2 2 2 3.6 2 2.3 0 4.3-1.8 4.3-4.4C20.5 9.5 15 6.5 12 2.5z',
  clover: 'M8.75 9.18A3.8 3.8 0 1 1 15.25 9.18A3.8 3.8 0 1 1 12.83 14.09L13 20.5H11L11.17 14.09A3.8 3.8 0 1 1 8.75 9.18z',
  ribbon: 'M12 11C9.5 8 4.5 5.5 3.5 8c-.8 2 .2 6 3 6.3 2 .2 4-1.4 5.5-3.3 1.5 1.9 3.5 3.5 5.5 3.3 2.8-.3 3.8-4.3 3-6.3-1-2.5-6 0-8.5 3zM11.2 12L8 20.5l2.2-.7L12 12.5zM12.8 12l3.2 8.5-2.2-.7L12 12.5z',
};
export const ICON_STYLES = [
  { value: 'dot', label: '도트' },
  { value: 'line', label: '라인' },
  { value: 'fill', label: '채움' },
];

/** D-DAY 아이콘: 테마(도트 · 라인 · 채움) × 모양 */
export function DdayIcon({ shape = 'heart', variant = 'dot', color, className }) {
  if (variant !== 'line' && variant !== 'fill') return html`<${DotIcon} shape=${shape} color=${color} className=${className} />`;
  const line = variant === 'line';
  return html`<svg class=${cx('dot-icon vec-icon', className)} viewBox="0 0 24 24" style=${{ aspectRatio: '1 / 1' }} aria-hidden="true"
      fill=${line ? 'none' : color} fill-rule="evenodd" stroke=${color} stroke-width=${line ? 2 : 0.6} stroke-linejoin="round" stroke-linecap="round">
    <path d=${VECTOR[shape] || VECTOR.heart} />
  </svg>`;
}

/** 아이콘 두 개(상단 · 하단)를 한 덩어리로 세로로 붙여 글자 묶음 옆에 둔다 */
function DdayIcons({ thumb, color }) {
  return html`<span class="dday-icons" aria-hidden="true">
    <${DdayIcon} shape=${thumb.shape} variant=${thumb.style} color=${thumb.name || color} />
    <${DdayIcon} shape=${thumb.shape} variant=${thumb.style} color=${thumb.num || color} />
  </span>`;
}

const HEART_RED = '#ff2d55';
const HEART_COLORS = [HEART_RED, '#ff7eb3', '#ff8a3d', '#f5c518', '#34c759', '#3b82f6', '#8b5cf6', '#222222'];

/**
 * 아이콘 설정: null(없음) · { type: 'heart', style, shape, name, num } — name = 상단 아이콘 색, num = 하단 아이콘 색 (비어 있으면 일정 색)
 * (type · name · num 은 이전 버전 데이터와 맞추려고 이름을 그대로 둔다)
 */
export function DdayThumbField({ thumb, color, onChange }) {
  const on = !!(thumb && thumb.type === 'heart');
  const set = (patch) => onChange({ type: 'heart', style: 'dot', shape: 'heart', name: HEART_RED, num: HEART_RED, ...(on ? thumb : {}), ...patch });
  const shape = (on && thumb.shape) || 'heart';
  const variant = (on && thumb.style) || 'dot';
  const shapeLabel = useId();
  return html`<div class="dday-thumb-field">
    <${Segmented} label="D-DAY 아이콘" size="sm" value=${on ? variant : 'none'} onChange=${(v) => (v === 'none' ? onChange(null) : set({ style: v }))}
      options=${[{ value: 'none', label: '없음' }, ...ICON_STYLES]} />
    ${on && html`<div class="dday-shape-row">
        <div class="field">
          <span class="field-label" id=${shapeLabel}>모양</span>
          <div class="dday-shapes" role="radiogroup" aria-labelledby=${shapeLabel}>
            ${Object.entries(SHAPES).map(([k, s]) => html`<button type="button" role="radio" key=${k} aria-checked=${String(shape === k)}
                class=${cx('dday-shape', shape === k && 'is-on')} title=${s.label} aria-label=${s.label} onClick=${() => set({ shape: k })}>
              <${DdayIcon} shape=${k} variant=${variant} color=${thumb.num || color} />
            </button>`)}
          </div>
        </div>
        <div class="dday-heart-preview dday-text has-icon" aria-hidden="true">
          <${DdayIcons} thumb=${{ ...thumb, shape, style: variant }} color=${color} />
          <span class="dday-lines"><span class="dday-name">이름</span><span class="dday-num num">100<span class="dday-suffix">일째</span></span></span>
        </div>
      </div>
      <div class="dday-color-cols">
        <${ColorPicker} label="상단 아이콘" colors=${HEART_COLORS} value=${thumb.name} allowNone noneLabel="일정 색 사용" savable compact onChange=${(c) => set({ name: c })} />
        <${ColorPicker} label="하단 아이콘" colors=${HEART_COLORS} value=${thumb.num} allowNone noneLabel="일정 색 사용" savable compact onChange=${(c) => set({ num: c })} />
      </div>`}
  </div>`;
}

/** 위젯에서 바로 꾸미기 (위젯 옆 팝오버) — 바꾸면 바로 반영 */
function DdayStyle({ ev, color, placement, onClose }) {
  return html`<${Popup} title=${ev.title} onClose=${onClose} popover=${placement}
    footer=${html`<button type="button" class="btn btn-sm" onClick=${() => { onClose(); bus.emit('calendar:open', { type: 'edit', eventId: ev.id, date: ev.start }); }}>
        <${Icon} name="edit" size=${14} /> 일정 수정</button>
      <button type="button" class="btn btn-sm btn-primary" onClick=${onClose}>완료</button>`}>
    <${DdayThumbField} thumb=${ev.ddayThumb || null} color=${color} onChange=${(t) => setDdayThumb(ev.id, t)} />
  <//>`;
}

/** '2251일째' → 숫자는 그대로, '일째'만 작게 */
function DdayLabel({ label }) {
  const m = /^(.*?)(일째)$/.exec(label);
  return m ? html`${m[1]}<span class="dday-suffix">${m[2]}</span>` : label;
}

/** 끌어서 순서 바꾸기: 가로·세로 나열 모두 (목록 방향은 화면에 그려진 대로 읽는다) */
function useReorder(items) {
  const [drag, setDrag] = useState(null); // { from, to }
  const moved = useRef(false);

  function commit(from, to) {
    if (from === to) return;
    const ids = items.map((x) => x.ev.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorderDday(ids);
  }
  function start(e, index) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const list = el.closest('.dday-list');
    const vertical = getComputedStyle(list).flexDirection === 'column';
    const sx = e.clientX;
    const sy = e.clientY;
    let state = null;
    capture(el, e);
    const move = (ev) => {
      if (!state && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; // 조금 흔들린 건 클릭
      const p = vertical ? ev.clientY : ev.clientX;
      const rows = [...list.children].filter((r) => !r.classList.contains('is-clone'));
      let to = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return p < (vertical ? b.top + b.height / 2 : b.left + b.width / 2);
      });
      if (to < 0) to = rows.length - 1;
      else if (to > index) to -= 1;
      if (!state || state.to !== to) {
        state = { from: index, to };
        setDrag(state);
      }
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      if (state) {
        moved.current = true; // 끈 직후의 click 은 상세를 열지 않음
        setTimeout(() => (moved.current = false), 0);
        commit(state.from, state.to);
      }
      state = null;
      setDrag(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }
  function onKey(e, index) {
    const d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!e.altKey || !d) return;
    e.preventDefault();
    commit(index, Math.max(0, Math.min(items.length - 1, index + d)));
  }
  return { drag, start, onKey, clickOk: () => !moved.current };
}

/**
 * 위젯 칸을 넘치면 오늘의 일정 전광판처럼 흘려 보낸다 (가로 나열은 옆으로, 세로 나열은 위로).
 * 목록 뒤에 같은 항목을 한 벌 더 붙여 두고(is-clone) 한 벌 길이만큼 가면 처음으로 — 끊김 없이 돈다.
 * 전광판과 같은 속도 · 방식(초당 12번 정수 픽셀). 마우스를 올리거나 포커스가 있으면 멈춘다 (누르기 · 끌어 순서 바꾸기).
 */
const FLOW_FPS = 12;
function useFlow(listRef, items, speed) {
  const [flow, setFlow] = useState(null); // null · 'x' · 'y'
  const paused = useRef(false);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return setFlow(null);
    const measure = () => {
      const vertical = getComputedStyle(list).flexDirection === 'column';
      const real = [...list.children].filter((c) => !c.classList.contains('is-clone'));
      if (!real.length) return setFlow(null);
      const a = real[0].getBoundingClientRect();
      const b = real[real.length - 1].getBoundingClientRect();
      const over = vertical ? b.bottom - a.top > list.clientHeight + 1 : b.right - a.left > list.clientWidth + 1;
      setFlow(over && !reduced ? (vertical ? 'y' : 'x') : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [items]);

  useEffect(() => {
    const list = listRef.current;
    if (!flow || !list) return undefined;
    const real = [...list.children].filter((c) => !c.classList.contains('is-clone'));
    const clone = list.querySelector('.is-clone');
    if (!real.length || !clone) return undefined;
    const loop = flow === 'y' ? clone.offsetTop - real[0].offsetTop : clone.offsetLeft - real[0].offsetLeft;
    if (loop <= 0) return undefined;
    const step = (speed || 50) / FLOW_FPS;
    const key = flow === 'y' ? 'scrollTop' : 'scrollLeft';
    let pos = list[key] % loop;
    let shown = -1;
    const timer = setInterval(() => {
      if (document.hidden || document.documentElement.classList.contains('is-covered')) return;
      if (paused.current) {
        pos = list[key] % loop; // 멈춘 사이 휠로 옮긴 자리에서 이어 간다
        return;
      }
      pos = (pos + step) % loop;
      const px = Math.round(pos);
      if (px === shown) return;
      shown = px;
      list[key] = px;
    }, 1000 / FLOW_FPS);
    return () => {
      clearInterval(timer);
      list[key] = 0;
    };
  }, [flow, items, speed]);

  const hold = (v) => () => (paused.current = v);
  return { flow, pause: { onPointerEnter: hold(true), onPointerLeave: hold(false), onFocusIn: hold(true), onFocusOut: hold(false) } };
}

export function DDay() {
  const { events, categories, ddayOrder, settings } = useApp();
  const today = ymd(useNow(60000));
  const ref = useRef(null);
  const [styling, setStyling] = useState(null); // { id, placement }
  // 끌어 정한 순서 → 순서에 없는(새로 추가한) 것은 가까운 날 순으로 뒤에
  // '남은 날 D-n' 은 그날(D-DAY)까지만 보이고 다음 날부터 위젯에서 빠진다 (일정 · D-day 설정은 그대로라 날짜를 미루면 다시 보임)
  const items = useMemo(() => {
    const rank = new Map((ddayOrder || []).map((id, i) => [id, i]));
    return events
      .filter((e) => e.dday)
      .map((e) => ({ ev: e, d: ddayOf(e, today) }))
      .filter(({ ev, d }) => (ev.ddayMode || 'until') !== 'until' || d.diff >= 0)
      .sort((a, b) => (rank.get(a.ev.id) ?? Infinity) - (rank.get(b.ev.id) ?? Infinity) || Math.abs(a.d.diff) - Math.abs(b.d.diff));
  }, [events, ddayOrder, today]);
  const reorder = useReorder(items);
  const listRef = useRef(null);
  // 설정 › 레이아웃 › D-DAY 속도 (따로 정하기 전에는 전광판 속도를 따른다)
  const { flow, pause } = useFlow(listRef, items, settings.ddaySpeed ?? settings.tickerSpeed);
  const dir = settings.ddayDirection || 'auto';
  const styled = styling && items.find((x) => x.ev.id === styling.id);

  // 휠로 넘겨 보기: 가로 나열은 세로 휠을 옆으로, 세로 나열은 위아래로 (흐르는 중엔 마우스를 올리면 멈추므로 그 자리에서 이어 흐른다)
  function onWheel(e) {
    const el = e.currentTarget;
    if (!e.deltaY) return;
    if (getComputedStyle(el).flexDirection === 'column') {
      if (el.scrollHeight <= el.clientHeight) return;
      e.preventDefault();
      el.scrollTop += e.deltaY;
    } else if (el.scrollWidth > el.clientWidth) {
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    }
  }

  return html`<section class=${cx('widget w-dday', 'dir-' + dir)} aria-labelledby="dday-title" ref=${ref}>
    <h2 class="sr-only" id="dday-title">D-DAY</h2>
    ${items.length ? html`<ul class=${cx('dday-list', flow && 'is-flowing flow-' + flow)} onWheel=${onWheel} ref=${listRef} ...${pause}>
      ${items.map(({ ev, d }, i) => {
        const dr = reorder.drag;
        const color = eventColor(ev, categories);
        const heart = ev.ddayThumb && ev.ddayThumb.type === 'heart' ? ev.ddayThumb : null;
        return html`<li key=${ev.id} class=${cx('dday-li', dr && dr.from === i && 'is-dragging', dr && dr.to === i && dr.from !== i && (dr.to < dr.from ? 'drop-before' : 'drop-after'))}>
          <button type="button" class="dday-item"
            onPointerDown=${(e) => reorder.start(e, i)} onKeyDown=${(e) => reorder.onKey(e, i)}
            onClick=${() => reorder.clickOk() && bus.emit('calendar:open', { type: 'detail', eventId: ev.id, date: d.target })}
            aria-label=${`${ev.title} ${d.label}, ${fmtKoDate(d.target)}. 끌거나 Alt+방향키로 순서 변경`}>
            <span class=${cx('dday-text', heart && 'has-icon')}>
              ${heart && html`<${DdayIcons} thumb=${heart} color=${color} />`}
              <span class="dday-lines">
                <span class="dday-name">${ev.title}</span>
                <span class="dday-num"><${DdayLabel} label=${d.label} /></span>
              </span>
            </span>
          </button>
          <button type="button" class="dday-edit" aria-label=${ev.title + ' 아이콘 꾸미기'} title="D-DAY 아이콘"
            onClick=${() => setStyling({ id: ev.id, placement: popoverPlacement(ref.current, 20) })}>
            <${Icon} name="palette" size=${13} />
          </button>
        </li>`;
      })}
      ${flow && items.map(({ ev, d }) => {
        const color = eventColor(ev, categories);
        const heart = ev.ddayThumb && ev.ddayThumb.type === 'heart' ? ev.ddayThumb : null;
        return html`<li key=${'clone-' + ev.id} class="dday-li is-clone" aria-hidden="true">
          <button type="button" class="dday-item" tabindex="-1" onClick=${() => bus.emit('calendar:open', { type: 'detail', eventId: ev.id, date: d.target })}>
            <span class=${cx('dday-text', heart && 'has-icon')}>
              ${heart && html`<${DdayIcons} thumb=${heart} color=${color} />`}
              <span class="dday-lines">
                <span class="dday-name">${ev.title}</span>
                <span class="dday-num"><${DdayLabel} label=${d.label} /></span>
              </span>
            </span>
          </button>
        </li>`;
      })}
    </ul>` : html`<p class="dday-empty">표시할 D-day가 없습니다.</p>`}
    ${styled && html`<${DdayStyle} ev=${styled.ev} color=${eventColor(styled.ev, categories)} placement=${styling.placement} onClose=${() => setStyling(null)} />`}
  </section>`;
}
