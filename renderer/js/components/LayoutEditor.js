// 레이아웃 조립: 12 x 20 격자 위에서 위젯을 끌어 옮기고(이동) 모서리로 크기를 바꾼다.
import { html, useState, useRef, useSize, cx, capture } from '../lib.js';
import { GRID, WIDGETS } from '../store.js';

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function clampBox(box) {
  const [mw, mh] = WIDGETS[box.id].min;
  const w = Math.max(mw, Math.min(GRID.cols, box.w));
  const h = Math.max(mh, Math.min(GRID.rows, box.h));
  return { ...box, w, h, x: Math.max(0, Math.min(GRID.cols - w, box.x)), y: Math.max(0, Math.min(GRID.rows - h, box.y)) };
}

export function validPlacement(layout, box) {
  return !layout.some((o) => o.id !== box.id && o.visible && overlaps(o, box));
}

/** 빈 자리 찾기 (최소 크기 기준) */
export function findSlot(layout, id) {
  const [w, h] = WIDGETS[id].min;
  for (let y = 0; y <= GRID.rows - h; y++)
    for (let x = 0; x <= GRID.cols - w; x++) {
      const box = { id, x, y, w, h };
      if (validPlacement(layout, box)) return box;
    }
  return null;
}

const rectOf = ({ x, y, w, h }) => ({ x, y, w, h });
const fitsMin = (id, r) => r.w >= WIDGETS[id].min[0] && r.h >= WIDGETS[id].min[1];

/** (ax, ay) 에서 가장 가까운 빈 자리 (크기는 그대로 — 밀려난 위젯이 멋대로 작아지지 않게) */
function nearestSlot(layout, item, ax, ay) {
  let best = null;
  for (let y = 0; y <= GRID.rows - item.h; y++)
    for (let x = 0; x <= GRID.cols - item.w; x++) {
      const d = Math.abs(x - ax) + Math.abs(y - ay);
      if ((!best || d < best.d) && validPlacement(layout, { id: item.id, x, y, w: item.w, h: item.h })) best = { x, y, d };
    }
  return best && { x: best.x, y: best.y };
}

/**
 * 한 축에서 움직이는 가장자리의 후보: 원하는 위치부터 최소 크기 쪽으로 한 칸씩 (반대쪽 가장자리는 고정)
 * side: 'end'(오른쪽·아래) · 'start'(왼쪽·위) · null(이 축은 그대로)
 */
function edgeSteps(pos, len, min, max, d, side) {
  if (!side) return { want: len, steps: [{ p: pos, l: len }] };
  const steps = [];
  if (side === 'end') {
    for (let e = Math.max(pos + min, Math.min(max, pos + len + d)); e >= pos + min; e--) steps.push({ p: pos, l: e - pos });
    return { want: len + d, steps };
  }
  const end = pos + len;
  for (let s = Math.min(end - min, Math.max(0, pos + d)); s <= end - min; s++) steps.push({ p: s, l: end - s });
  return { want: len - d, steps };
}

/**
 * 크기 조절: dir 의 가장자리(n·s·e·w, 모서리는 둘을 합친 se 등)만 움직이고 반대쪽은 고정한다.
 * 화면 끝이나 다른 위젯에 닿으면 거기까지만 늘린다. 다른 위젯은 건드리지 않는다.
 */
export function fitResize(layout, item, dir, dx, dy) {
  const [mw, mh] = WIDGETS[item.id].min;
  const h = edgeSteps(item.x, item.w, mw, GRID.cols, dx, dir.includes('e') ? 'end' : dir.includes('w') ? 'start' : null);
  const v = edgeSteps(item.y, item.h, mh, GRID.rows, dy, dir.includes('s') ? 'end' : dir.includes('n') ? 'start' : null);
  let best = null;
  h.steps.forEach((hc, i) => {
    const j = v.steps.findIndex((vc) => validPlacement(layout, { ...item, x: hc.p, w: hc.l, y: vc.p, h: vc.l }));
    if (j >= 0 && (!best || i + j < best.d)) best = { x: hc.p, w: hc.l, y: v.steps[j].p, h: v.steps[j].l, d: i + j };
  });
  if (!best) return { ...item, limited: true };
  return { ...item, x: best.x, y: best.y, w: best.w, h: best.h, limited: best.w < h.want || best.h < v.want };
}

/**
 * 두 위젯 자리 맞바꾸기 후보 (앞의 것부터 시도): 크기는 그대로 두는 방법을 먼저 쓴다.
 * 1) 나란히 붙어 있으면 순서만  2) 서로의 위치(왼쪽 위)만  3) 위치·크기 통째로 (최소 크기를 만족할 때만)
 */
function swapCandidates(a, b) {
  const out = [];
  if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)) {
    const x0 = Math.min(a.x, b.x);
    out.push(a.x < b.x ? { [b.id]: { x: x0 }, [a.id]: { x: x0 + b.w } } : { [a.id]: { x: x0 }, [b.id]: { x: x0 + a.w } });
  }
  if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) {
    const y0 = Math.min(a.y, b.y);
    out.push(a.y < b.y ? { [b.id]: { y: y0 }, [a.id]: { y: y0 + b.h } } : { [a.id]: { y: y0 }, [b.id]: { y: y0 + a.h } });
  }
  out.push({ [a.id]: { x: b.x, y: b.y }, [b.id]: { x: a.x, y: a.y } });
  if (fitsMin(a.id, b) && fitsMin(b.id, a)) out.push({ [a.id]: rectOf(b), [b.id]: rectOf(a) });
  return out;
}

const inGrid = (l) => l.x >= 0 && l.y >= 0 && l.x + l.w <= GRID.cols && l.y + l.h <= GRID.rows;
const noOverlap = (layout) => layout.every((a, i) => !a.visible || (inGrid(a) && layout.slice(i + 1).every((b) => !b.visible || !overlaps(a, b))));

/**
 * 위젯을 box 로 옮긴 결과 배치. 겹치면 자동으로 자리를 정리한다:
 * 1) 포인터(point) 아래 위젯과 자리 맞바꾸기  2) 놓은 자리에 두고 밀려난 위젯은 원래 자리 근처 빈 곳으로(크기 유지)
 * 둘 다 안 되면 null. 결과에 swapped(맞바꾼 위젯 id) 를 붙인다.
 */
export function arrange(layout, box, point) {
  const me = layout.find((l) => l.id === box.id);
  const apply = (changes) => layout.map((l) => (changes[l.id] ? { ...l, ...changes[l.id] } : l));
  const others = layout.filter((o) => o.id !== box.id && o.visible);
  const hits = others.filter((o) => overlaps(o, box));
  if (!hits.length) return apply({ [box.id]: rectOf(box) });

  const target = point && others.find((o) => point.x >= o.x && point.x < o.x + o.w && point.y >= o.y && point.y < o.y + o.h);
  for (const swap of target ? swapCandidates(me, target) : []) {
    const next = apply(swap);
    if (noOverlap(next)) return Object.assign(next, { swapped: target.id });
  }

  let next = apply({ [box.id]: rectOf(box) });
  const pending = new Set(hits.map((h) => h.id));
  for (const hit of [...hits].sort((a, b) => b.w * b.h - a.w * a.h)) {
    pending.delete(hit.id);
    const slot = nearestSlot(next.filter((l) => !pending.has(l.id)), hit, me.x, me.y);
    if (!slot) return null;
    next = next.map((l) => (l.id === hit.id ? { ...l, ...slot } : l));
  }
  return next;
}

/**
 * 화면 전체 미리보기: 이미지 배너 + 위젯 격자.
 * 배너와 격자 사이 경계선을 끌어(또는 방향키로) 배너 너비/높이를 조절한다.
 */
function BannerSplit({ banner, screenRef, onSize }) {
  const vertical = banner.position === 'left' || banner.position === 'right';
  function start(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    capture(el, e);
    let frame = 0;
    const move = (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = screenRef.current.getBoundingClientRect();
        const ratio = {
          left: (ev.clientX - r.left) / r.width,
          right: (r.right - ev.clientX) / r.width,
          top: (ev.clientY - r.top) / r.height,
          bottom: (r.bottom - ev.clientY) / r.height,
        }[banner.position];
        onSize(Math.round(Math.min(60, Math.max(15, ratio * 100))));
      });
    };
    const up = () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }
  function onKey(e) {
    const grow = { left: 'ArrowRight', right: 'ArrowLeft', top: 'ArrowDown', bottom: 'ArrowUp' }[banner.position];
    const shrink = { left: 'ArrowLeft', right: 'ArrowRight', top: 'ArrowUp', bottom: 'ArrowDown' }[banner.position];
    const step = e.shiftKey ? 5 : 1;
    if (e.key === grow) onSize(Math.min(60, banner.size + step));
    else if (e.key === shrink) onSize(Math.max(15, banner.size - step));
    else return;
    e.preventDefault();
  }
  return html`<div class=${cx('le-split', vertical ? 'is-v' : 'is-h')} role="separator" tabindex="0"
    aria-orientation=${vertical ? 'vertical' : 'horizontal'} aria-label="이미지 배너 크기" aria-valuemin="15" aria-valuemax="60" aria-valuenow=${banner.size}
    title="끌어서 배너 크기 조절" onPointerDown=${start} onKeyDown=${onKey}><span aria-hidden="true"></span></div>`;
}

const HANDLES = ['n', 's', 'e', 'w', 'se']; // 위·아래·오른쪽·왼쪽 가장자리 + 오른쪽 아래 모서리

export function LayoutEditor({ layout, onChange, banner, onBannerSize }) {
  const screenRef = useRef(null);
  const ref = useRef(null);
  const { width, height } = useSize(ref);
  const [live, setLive] = useState(null); // 드래그 중 { box: 포인터를 따라가는 상자, plan: 놓으면 될 배치 }
  const [invalid, setInvalid] = useState(null);
  const [msg, setMsg] = useState('');
  const cw = width / GRID.cols;
  const ch = height / GRID.rows;

  function commit(id, plan) {
    const name = WIDGETS[id].name;
    if (!plan) {
      setInvalid(id);
      setMsg(`${name}: 놓을 자리가 없습니다.`);
      setTimeout(() => setInvalid(null), 500);
      return;
    }
    const me = plan.find((l) => l.id === id);
    setMsg(plan.swapped
      ? `${name} ↔ ${WIDGETS[plan.swapped].name} 자리를 바꿨습니다.`
      : `${name}: 위치 ${me.x + 1},${me.y + 1} · 크기 ${me.w}×${me.h}${plan.limited ? ' (더 늘릴 수 없음)' : ''}`);
    onChange([...plan]);
  }

  /** 크기 조절 결과 배치: 다른 위젯은 그대로 */
  function resized(item, dir, dx, dy) {
    const box = fitResize(layout, item, dir, dx, dy);
    return Object.assign(layout.map((l) => (l.id === item.id ? { ...l, ...rectOf(box) } : l)), { limited: box.limited, box });
  }

  /** kind: 'move' 또는 크기 조절 가장자리('n'·'s'·'e'·'w'·'se') */
  function start(e, item, kind) {
    if (e.button !== 0 || !cw || !ch) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    capture(el, e);
    const board = ref.current.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    let latest = null;
    let lastKey = '';
    const move = (ev) => {
      // 조금 흔들린 것은 클릭으로 본다
      if (!latest && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      const dx = Math.round((ev.clientX - sx) / cw);
      const dy = Math.round((ev.clientY - sy) / ch);
      let box;
      let plan;
      if (kind === 'move') {
        box = clampBox({ ...item, x: item.x + dx, y: item.y + dy });
        // 포인터가 가리키는 칸의 위젯과 자리를 바꾼다
        const point = { x: Math.floor((ev.clientX - board.left) / cw), y: Math.floor((ev.clientY - board.top) / ch) };
        const key = `${box.x},${box.y},${point.x},${point.y}`;
        if (key === lastKey) return; // 칸이 바뀔 때만 다시 계산·그리기
        lastKey = key;
        plan = arrange(layout, box, point);
      } else {
        plan = resized(item, kind, dx, dy);
        box = plan.box;
        const key = `${box.x},${box.y},${box.w},${box.h}`;
        if (key === lastKey) return;
        lastKey = key;
      }
      latest = { box, plan };
      setLive(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      const moved = latest && (latest.box.x !== item.x || latest.box.y !== item.y || latest.box.w !== item.w || latest.box.h !== item.h);
      if (moved) commit(item.id, latest.plan);
      setLive(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onKey(e, item) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    if (e.shiftKey) {
      const plan = resized(item, d[0] ? 'e' : 's', d[0], d[1]);
      if (plan.box.w !== item.w || plan.box.h !== item.h) commit(item.id, plan);
      else setMsg(`${WIDGETS[item.id].name}: 더 늘릴 수 없습니다.`);
      return;
    }
    const box = clampBox({ ...item, x: item.x + d[0], y: item.y + d[1] });
    if (box.x === item.x && box.y === item.y) return;
    commit(item.id, arrange(layout, box, null));
  }

  const bannerOn = banner && banner.position !== 'none';
  return html`<div class="layout-editor">
    <div class=${cx('le-screen', 'pos-' + (bannerOn ? banner.position : 'none'))} ref=${screenRef}
      style=${{ aspectRatio: `${window.innerWidth} / ${window.innerHeight}` }}>
      ${bannerOn && html`<div class="le-banner" style=${{ flexBasis: banner.size + '%' }}>
        <span class="le-banner-label">이미지 영역<br /><span class="num">${banner.size}%</span></span>
      </div>
      <${BannerSplit} banner=${banner} screenRef=${screenRef} onSize=${onBannerSize} />`}
    <div class="le-board" ref=${ref} aria-describedby="le-help">
      <div class="le-gridlines" aria-hidden="true" style=${{ backgroundSize: `${100 / GRID.cols}% ${100 / GRID.rows}%` }}></div>
      ${live && live.plan && (() => {
        // 놓으면 들어갈 자리 미리보기 (맞바꾸기면 포인터를 따라가는 상자와 다르다)
        const g = live.plan.find((l) => l.id === live.box.id);
        return html`<div class="le-ghost" aria-hidden="true"
          style=${{ left: (g.x / GRID.cols) * 100 + '%', top: (g.y / GRID.rows) * 100 + '%', width: (g.w / GRID.cols) * 100 + '%', height: (g.h / GRID.rows) * 100 + '%' }}></div>`;
      })()}
      ${layout.filter((l) => l.visible).map((l) => {
        const dragging = live && live.box.id === l.id;
        // 끄는 위젯은 포인터를 따라가고, 나머지는 놓았을 때의 자리로 미리 옮겨 보여준다
        const b = dragging ? live.box : (live && live.plan && live.plan.find((p) => p.id === l.id)) || l;
        const bad = (dragging && !live.plan) || invalid === l.id;
        return html`<button type="button" key=${l.id} class=${cx('le-block', 'le-' + l.id, bad && 'is-bad', dragging && 'is-dragging')}
            style=${{ left: (b.x / GRID.cols) * 100 + '%', top: (b.y / GRID.rows) * 100 + '%', width: (b.w / GRID.cols) * 100 + '%', height: (b.h / GRID.rows) * 100 + '%' }}
            onPointerDown=${(e) => start(e, l, 'move')} onKeyDown=${(e) => onKey(e, l)}
            aria-label=${`${WIDGETS[l.id].name}, 위치 ${l.x + 1}열 ${l.y + 1}행, 크기 ${l.w}×${l.h}`}>
          <span class="le-label"><span class="le-name">${WIDGETS[l.id].name}</span><span class="le-size num" aria-hidden="true">${b.w}×${b.h}</span></span>
          ${HANDLES.map((d) => html`<span class=${'le-h le-h-' + d} aria-hidden="true" onPointerDown=${(e) => start(e, l, d)}></span>`)}
        </button>`;
      })}
    </div>
    </div>
    <p class="sr-only" aria-live="polite">${msg}</p>
  </div>`;
}
