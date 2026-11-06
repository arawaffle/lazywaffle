import { html, useState, useMemo, useRef, useEffect, cx, useSize, useNow, useBus, capture } from '../lib.js';
import { useApp, layoutKey } from '../store.js';
import { setSetting, moveOccurrence, copyOccurrence } from '../actions.js';
import { monthMatrix, addMonths, addDays, ymd, parse, diffDays, weekStartOf, MONTH_EN, WEEK_KO, WEEK_KO_LONG, fmtKoDate, pad } from '../util/date.js';
import { occurrences, ddayOf } from '../util/recur.js';
import { readableOn, ddayChipOn } from '../util/color.js';
import { HOLIDAYS } from '../util/holidays-data.js';
import { Icon, IconButton } from './icons.js';
import { Popup } from './Popup.js';
import { EventForm, EventDetail, EventDelete, DayList, CategoryManager } from './EventPopups.js';
import { EventManager } from './EventManager.js';
import { showHoverCard, hideHoverCard } from './HoverCard.js';
import { DayImg, haloOf } from './DayImage.js';

/** 일정 막대·칩의 D-day 표시: 일정 색에 맞춘 같은 색상 계열 칩 (글자는 흰~검정 사이 회색) */
function DdayChip({ dd, bg }) {
  const c = ddayChipOn(bg);
  return html`<span class=${cx('bar-dday num', dd.diff === 0 && 'is-today')} style=${{ '--dd-bg': c.bg, '--dd-fg': c.fg }}>${dd.label}</span>`;
}

/** 용돈기입장 하루 합계 (수입 − 지출, 저축은 빼고). 칸이 좁으므로 10만 이상은 '만' 단위로 줄인다 */
function fmtMoney(n) {
  const a = Math.abs(n);
  const body = a < 100000 ? a.toLocaleString('ko-KR') : `${(a / 10000).toFixed(a < 1000000 ? 1 : 0).replace(/\.0$/, '')}만`;
  return (n < 0 ? '−' : n > 0 ? '+' : '') + body;
}
function MoneyTag({ day, className }) {
  if (!day) return null;
  const net = day.in - day.out;
  const title = [day.out && `지출 ${day.out.toLocaleString('ko-KR')}원`, day.in && `수입 ${day.in.toLocaleString('ko-KR')}원`].filter(Boolean).join(' · ');
  return html`<span class=${cx(className, 'num', net > 0 && 'is-plus')} title=${title}><span class="sr-only">용돈기입장 </span>${fmtMoney(net)}</span>`;
}

const EVENT_ACTIONS = [['dots-v', '끌어서 이동 (누르면 날짜 골라 이동)', 'move'], ['eye', '일정 확인', 'detail'], ['edit', '수정', 'edit'], ['copy', '복사', 'copy'], ['trash', '삭제', 'delete']];

/**
 * 일정에 마우스를 올리면 덮는 #333 버튼 줄: 이동(⋮ 손잡이) · 확인 · 수정 · 복사 · 삭제. 막대 폭 안에서만 (좁으면 버튼이 줄어든다)
 * 마우스 전용(Tab 으로 들어오지 않음) — 키보드는 일정을 눌러 여는 상세 창에서 같은 일을 한다.
 * 버튼 위에서 잡아도 끌어서 옮기기는 그대로 되고(부모가 처리), 버튼 사이 빈 자리를 누르면 상세 보기.
 */
function EventActions({ occ, onOpen }) {
  return html`<span class="ev-acts" aria-hidden="true">
    ${EVENT_ACTIONS.map(([icon, label, type]) => html`<button type="button" key=${type} class=${cx('ev-act', type === 'move' && 'ev-act-move')} tabindex="-1" title=${label}
        onClick=${(e) => { e.stopPropagation(); onOpen({ type, eventId: occ.ev.id, date: occ.start }); }}>
      <${Icon} name=${icon} size=${13} />
    </button>`)}
  </span>`;
}

/** 한 주에 걸치는 일정 막대 배치 (레인 할당) */
function layoutWeek(week, occs, maxLanes) {
  const ws = week[0];
  const we = week[6];
  const segs = occs
    .filter((o) => o.start <= we && o.end >= ws)
    .map((o) => {
      const s = o.start < ws ? ws : o.start;
      const e = o.end > we ? we : o.end;
      return { occ: o, c0: diffDays(ws, s), c1: diffDays(ws, e), contL: o.start < ws, contR: o.end > we };
    })
    .sort((a, b) => a.c0 - b.c0 || (b.c1 - b.c0) - (a.c1 - a.c0));
  const lanes = [];
  for (const seg of segs) {
    let l = 0;
    while (lanes[l] && lanes[l].some((x) => !(seg.c1 < x.c0 || seg.c0 > x.c1))) l++;
    (lanes[l] = lanes[l] || []).push(seg);
    seg.lane = l;
  }
  // 넘치는 일정 수는 날짜 옆 '+N' 으로 표시 (레인은 모두 막대에 사용)
  const more = Array(7).fill(0);
  const visible = [];
  for (const seg of segs) {
    if (seg.lane >= maxLanes) for (let c = seg.c0; c <= seg.c1; c++) more[c]++;
    else visible.push(seg);
  }
  return { visible, more };
}

/** 월 선택: 연도 이동 + 12개월 */
function MonthPicker({ year, month, onPick, onClose }) {
  const [y, setY] = useState(year);
  return html`<${Popup} title="월 선택" onClose=${onClose} size="sm">
    <div class="mp-year">
      <${IconButton} icon="chev-left" label="이전 해" onClick=${() => setY(y - 1)} />
      <strong class="num" aria-live="polite">${y}</strong>
      <${IconButton} icon="chev-right" label="다음 해" onClick=${() => setY(y + 1)} />
    </div>
    <div class="mp-grid">
      ${MONTH_EN.map((en, m) => html`<button type="button" key=${m} class=${cx('mp-month', y === year && m === month && 'is-on')}
          aria-pressed=${String(y === year && m === month)} onClick=${() => onPick(y, m)} data-autofocus=${y === year && m === month ? '' : undefined}>
        <span class="mp-num">${m + 1}월</span><span class="mp-en" aria-hidden="true">${en}</span>
      </button>`)}
    </div>
  <//>`;
}

/**
 * 일정 끌어서 날짜 옮기기 (월간 막대·주간 칩 공용). Ctrl 을 누른 채 놓으면 옮기지 않고 복사한다.
 * 드롭 대상은 data-drop-date 를 가진 요소. 5px 이상 움직여야 드래그로 보고, 그 전엔 평소 클릭(상세 열기).
 */
function useEventDrag(onMove) {
  const [moving, setMoving] = useState(null); // { key, occ, delta, copy }
  const suppressClick = useRef(false);
  const dateAt = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const t = el.closest && el.closest('[data-drop-date]');
      if (t) return t.dataset.dropDate;
    }
    return null;
  };
  function start(e, occ) {
    if (e.button !== 0) return;
    e.stopPropagation(); // 날짜 칸의 '기간 선택 드래그'와 겹치지 않게
    const el = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    const grab = dateAt(sx, sy) || occ.start;
    let state = null;
    // 포인터 캡처는 실제로 끌기 시작할 때 건다: 먼저 걸면 호버 버튼(수정 · 삭제 …)을 누른 click 이 버튼에 닿지 않는다
    // (그래서 리스너는 window 에 — 캡처 전에도 바깥으로 빨리 움직인 것까지 받는다)
    const move = (ev) => {
      if (!state && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!state) capture(el, ev);
      const over = dateAt(ev.clientX, ev.clientY);
      if (!over) return;
      const delta = diffDays(grab, over);
      const copy = ev.ctrlKey;
      if (!state || state.delta !== delta || state.copy !== copy) {
        state = { key: occ.key, occ, delta, copy };
        setMoving(state);
      }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (state) {
        suppressClick.current = true; // 드래그 직후 발생하는 click 은 무시
        setTimeout(() => (suppressClick.current = false), 0);
        const copy = ev.type === 'pointerup' ? ev.ctrlKey : state.copy;
        if (state.delta) onMove(state.occ, state.delta, copy);
      }
      setMoving(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  const isTarget = (date) => moving && moving.delta !== undefined
    && date >= addDays(moving.occ.start, moving.delta) && date <= addDays(moving.occ.end, moving.delta);
  // 복사 중에는 원래 일정을 흐리게 하지 않는다 (그 자리에 그대로 남으므로)
  const isDragging = (key) => moving && moving.key === key && !moving.copy;
  return { start, moving, isTarget, isDragging, clickOk: () => !suppressClick.current };
}

/** '+N' 에 마우스를 올리면 그날 일정을 간단히 보여주는 카드 */
function DayPeek({ date, occs, colorOf, today, onPick }) {
  const shown = occs.slice(0, 8);
  return html`<div class="peek" aria-label=${`${fmtKoDate(date)} 일정`}>
    <p class="peek-head"><strong>${fmtKoDate(date)}</strong><span class="peek-count num">${occs.length}개</span></p>
    <ul class="peek-list">
      ${shown.map((o) => {
        const ev = o.ev;
        const bg = colorOf(ev);
        const dd = ev.dday ? ddayOf(ev, today) : null;
        return html`<li key=${o.key}><button type="button" class="peek-item" onClick=${() => onPick(o)}>
          <span class="peek-dot" style=${{ background: bg }} aria-hidden="true"></span>
          <span class="peek-time num">${ev.allDay === false && ev.startTime ? ev.startTime : '종일'}</span>
          <span class="peek-title">${ev.title}</span>
          ${dd && html`<${DdayChip} dd=${dd} bg=${bg} />`}
        </button></li>`;
      })}
    </ul>
    ${occs.length > shown.length && html`<p class="peek-rest">외 ${occs.length - shown.length}개 · 눌러서 전체 보기</p>`}
  </div>`;
}

/** 칸 크기에 맞춘 일정 막대 치수: 칸이 좁아 일정이 1개밖에 안 보이면 막대를 얇게 해 더 많이 보여준다 */
function metrics(rowH, rem, footH = 0) {
  const normal = { headH: rem * 1.75, laneH: rem * 1.5, compact: false };
  const tight = { headH: rem * 1.35, laneH: rem * 1.12, compact: true };
  const lanes = (m) => Math.max(1, Math.floor((rowH - m.headH - footH - 2) / m.laneH));
  const m = lanes(normal) < 2 ? tight : normal;
  return { ...m, maxLanes: lanes(m) };
}

/** 월간: 날짜 격자 + 일정 막대 */
function MonthGrid({ ym, weeks, occs, today, colorOf, onOpen, onCreate, popupOpen, showDate, settings, onMoveEvent, money, dayImages, picking }) {
  const bodyRef = useRef(null);
  const gridRef = useRef(null);
  const { height } = useSize(bodyRef);
  const [drag, setDrag] = useState(null);
  // 날짜 버튼은 하나만 Tab 으로 들어오고(roving tabindex) 방향키로 이동 — Tab 42번을 누르지 않아도 된다
  const [focusDate, setFocusDate] = useState(today);
  const evDrag = useEventDrag(onMoveEvent);
  const from = weeks[0][0];
  const to = weeks[weeks.length - 1][6];
  const showHolidays = settings.showHolidays !== false;

  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  const rowH = height ? height / weeks.length : 80;
  // 용돈 합계를 칸 아래에 쓸 자리만큼 일정 줄 수를 줄인다
  const { headH, laneH, maxLanes, compact } = metrics(rowH, rem, money ? rem * 0.85 : 0);

  // 빈 칸을 끌면 기간 선택 → 장기 일정 등록 (리스너는 pointerdown 에서 바로 등록해야 빠른 클릭도 놓치지 않는다)
  const dragRef = useRef(null);
  function onDayDown(e, date) {
    if (e.button !== 0) return;
    // 복사할 날짜 고르기: 칸 아무 데나 누르면 그 날로 복사 (일정 막대 · 버튼은 CSS 로 클릭이 통과한다)
    if (picking) {
      e.preventDefault();
      return picking(date);
    }
    if (e.target.closest('.cal-bar, .cal-more') || popupOpen) return;
    const onNumber = !!e.target.closest('.cal-date');
    dragRef.current = { a: date, b: date };
    setDrag(dragRef.current);
    const up = () => {
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      const [a, b] = d.a <= d.b ? [d.a, d.b] : [d.b, d.a];
      if (a !== b) return onCreate({ kind: 'range', start: a, end: b });
      // 한 칸 클릭은 날짜 숫자를 눌렀을 때만 등록 (바탕화면을 누르다 실수로 열리는 것 방지)
      if (onNumber) onCreate({ start: a });
    };
    window.addEventListener('pointerup', up);
  }
  function onDayEnter(date) {
    if (!dragRef.current || dragRef.current.b === date) return;
    dragRef.current = { ...dragRef.current, b: date };
    setDrag(dragRef.current);
  }
  const inDrag = (date) => drag && drag.a !== drag.b && date >= (drag.a < drag.b ? drag.a : drag.b) && date <= (drag.a < drag.b ? drag.b : drag.a);

  function dayKeyNav(e, date) {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const target = addDays(date, moves[e.key]);
    setFocusDate(target);
    if (target < from || target > to) showDate(target);
    setTimeout(() => {
      const btn = gridRef.current && gridRef.current.querySelector(`[data-date="${target}"]`);
      if (btn) btn.focus();
    }, 0);
  }

  const inView = (d) => d >= from && d <= to;
  const firstOfMonth = `${ym.year}-${pad(ym.month + 1)}-01`;
  const activeDate = inView(focusDate) ? focusDate : inView(today) ? today : firstOfMonth;
  const weekdays = weeks[0].map((d) => parse(d).getDay());
  const occsOn = (date) => occs.filter((o) => o.start <= date && o.end >= date);
  const countOn = (date) => occsOn(date).length;

  // '+N' 호버 미리보기: 스쳐 지나갈 때 깜빡이지 않게 잠깐 머물러야 연다
  const peekTimer = useRef(null);
  function peekEnter(e, date) {
    const el = e.currentTarget;
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => showHoverCard(el, (close) => html`<${DayPeek} date=${date} occs=${occsOn(date)} colorOf=${colorOf} today=${today}
      onPick=${(o) => { close(); onOpen({ type: 'detail', eventId: o.ev.id, date: o.start }); }} />`), 120);
  }
  function peekLeave() {
    clearTimeout(peekTimer.current);
    hideHoverCard();
  }

  return html`<div class=${cx('cal-grid', compact && 'is-compact', evDrag.moving && 'is-moving', evDrag.moving && evDrag.moving.copy && 'is-copying', picking && 'is-picking')} role="grid" aria-labelledby="cal-title" ref=${gridRef}>
    <div class="cal-weekdays" role="row">
      ${weekdays.map((w) => html`<div role="columnheader" class=${cx('cal-wd', w === 0 && 'is-sun', w === 6 && 'is-sat')}>
        <abbr title=${WEEK_KO_LONG[w]}>${WEEK_KO_LONG[w]}</abbr></div>`)}
    </div>
    <div class="cal-body" ref=${bodyRef} style=${{ '--weeks': weeks.length, '--head-h': headH + 'px' }}>
      ${weeks.map((week) => {
        const { visible, more } = layoutWeek(week, occs, maxLanes);
        return html`<div class="cal-week" role="row" key=${week[0]}>
          ${week.map((date, col) => {
            const d = parse(date);
            const wd = d.getDay();
            const n = countOn(date);
            const holiday = showHolidays ? HOLIDAYS[date] : null;
            // 칸 이미지: 날짜 · +N · 용돈 합계 글자는 이미지에 맞춘 회색 (--day-ink)
            const img = dayImages && dayImages[date];
            const ink = img && (img.ink || img.tone);
            return html`<div role="gridcell" key=${date} data-drop-date=${date}
                class=${cx('cal-day', d.getMonth() !== ym.month && 'is-other', wd === 0 && 'is-sun', wd === 6 && 'is-sat', holiday && 'is-holiday',
                  date === today && 'is-today', inDrag(date) && 'is-selecting', evDrag.isTarget(date) && 'is-drop', img && 'has-img')}
                style=${img ? { '--day-ink': ink, '--day-halo': haloOf(ink) } : null}
                onPointerDown=${(e) => onDayDown(e, date)} onPointerEnter=${() => onDayEnter(date)}>
              ${img && html`<${DayImg} img=${img} className="cal-day-img" />`}
              <button type="button" class="cal-date num" data-date=${date}
                aria-label=${`${fmtKoDate(date)}${holiday ? ' ' + holiday : ''}${date === today ? ' (오늘)' : ''}, 일정 ${n}개. 눌러서 일정 추가`}
                tabindex=${date === activeDate ? 0 : -1} onFocus=${() => setFocusDate(date)}
                onKeyDown=${(e) => dayKeyNav(e, date)}
                onClick=${(e) => { if (e.detail === 0) (picking ? picking(date) : onCreate({ start: date })); }}>${d.getDate()}</button>
              ${holiday && html`<span class="cal-holiday" aria-hidden="true" title=${holiday}>${holiday}</span>`}
              ${more[col] > 0 && html`<button type="button" class="cal-more num"
                onPointerEnter=${(e) => peekEnter(e, date)} onPointerLeave=${peekLeave}
                onClick=${() => { peekLeave(); onOpen({ type: 'day', date }); }} aria-label=${`${fmtKoDate(date)} 일정 ${more[col]}개 더 보기`}>+${more[col]}</button>`}
              ${money && html`<${MoneyTag} day=${money.get(date)} className="cal-money" />`}
            </div>`;
          })}
          <div class="cal-bars">
            ${visible.map((seg) => {
              const ev = seg.occ.ev;
              const bg = colorOf(ev);
              const first = !seg.contL;
              const dd = ev.dday && first ? ddayOf(ev, today) : null;
              return html`<div key=${seg.occ.key + week[0]}
                  class=${cx('cal-bar', seg.contL && 'cont-l', seg.contR && 'cont-r', evDrag.isDragging(seg.occ.key) && 'is-dragging')}
                  style=${{ left: `${(seg.c0 / 7) * 100}%`, width: `${((seg.c1 - seg.c0 + 1) / 7) * 100}%`, top: headH + seg.lane * laneH + 'px', height: laneH - 3 + 'px', background: bg, color: readableOn(bg) }}
                  onPointerDown=${(e) => evDrag.start(e, seg.occ)}
                  onClick=${() => evDrag.clickOk() && onOpen({ type: 'detail', eventId: ev.id, date: seg.occ.start })}>
                <button type="button" class="cal-bar-main"
                  aria-label=${`${ev.title}, ${fmtKoDate(seg.occ.start)}${seg.occ.end !== seg.occ.start ? '부터 ' + fmtKoDate(seg.occ.end) + '까지' : ''}. 끌어서 날짜 이동, Ctrl 을 누른 채 끌면 복사`}>
                  ${ev.allDay === false && ev.startTime && first && html`<span class="bar-time num">${ev.startTime}</span>`}
                  <span class="bar-title">${ev.title}</span>
                  ${dd && html`<${DdayChip} dd=${dd} bg=${bg} />`}
                </button>
                <${EventActions} occ=${seg.occ} onOpen=${onOpen} />
              </div>`;
            })}
          </div>
        </div>`;
      })}
    </div>
  </div>`;
}

/** 주간 리스트: 7일을 세로 목록으로, 하루의 일정을 한 줄씩 (칩을 다른 요일로 끌어 옮길 수 있음) */
function WeekList({ days, occs, today, colorOf, onOpen, onCreate, settings, onMoveEvent, money, picking }) {
  const evDrag = useEventDrag(onMoveEvent);
  const showHolidays = settings.showHolidays !== false;
  return html`<ol class=${cx('wk-list', evDrag.moving && 'is-moving', evDrag.moving && evDrag.moving.copy && 'is-copying', picking && 'is-picking')} aria-labelledby="cal-title">
    ${days.map((date) => {
      const d = parse(date);
      const wd = d.getDay();
      const list = occs.filter((o) => o.start <= date && o.end >= date);
      const holiday = showHolidays ? HOLIDAYS[date] : null;
      return html`<li key=${date} data-drop-date=${date} onPointerDown=${(e) => { if (picking && e.button === 0) { e.preventDefault(); picking(date); } }}
          class=${cx('wk-day', wd === 0 && 'is-sun', wd === 6 && 'is-sat', holiday && 'is-holiday', date === today && 'is-today', evDrag.isTarget(date) && 'is-drop')}>
        <button type="button" class="wk-date" onClick=${(e) => { if (!picking) onCreate({ start: date }); else if (e.detail === 0) picking(date); }} aria-label=${`${fmtKoDate(date)}${holiday ? ' ' + holiday : ''}${date === today ? ' (오늘)' : ''}, 눌러서 일정 추가`}>
          <span class="wk-dow">${WEEK_KO[wd]}</span>
          <span class="wk-num num">${d.getDate()}</span>
        </button>
        <ul class="wk-events">
          ${holiday && html`<li class="wk-holiday">${holiday}</li>`}
          ${list.length ? list.map((o) => {
            const ev = o.ev;
            const bg = colorOf(ev);
            const dd = ev.dday ? ddayOf(ev, today) : null;
            const span = o.end !== o.start ? `${diffDays(o.start, date) + 1}/${diffDays(o.start, o.end) + 1}일` : '';
            // 글자색은 일정 배경색에 맞춰 흰/검정 중 대비가 큰 쪽 (월간 막대와 같은 규칙)
            return html`<li key=${o.key}><div class=${cx('wk-ev', evDrag.isDragging(o.key) && 'is-dragging')} style=${{ '--ev': bg, '--ev-text': readableOn(bg) }}
                onPointerDown=${(e) => evDrag.start(e, o)}
                onClick=${() => evDrag.clickOk() && onOpen({ type: 'detail', eventId: ev.id, date: o.start })}>
              <button type="button" class="wk-ev-main">
                <span class="wk-ev-dot" aria-hidden="true"></span>
                <span class="wk-ev-time num">${ev.allDay === false && ev.startTime ? ev.startTime : '종일'}</span>
                <span class="wk-ev-title">${ev.title}</span>
                ${span && html`<span class="wk-ev-meta num">${span}</span>`}
                ${dd && html`<${DdayChip} dd=${dd} bg=${bg} />`}
              </button>
              <${EventActions} occ=${o} onOpen=${onOpen} />
            </div></li>`;
          }) : !holiday && html`<li class="wk-empty">일정 없음</li>`}
        </ul>
        ${money && html`<${MoneyTag} day=${money.get(date)} className="wk-money" />`}
      </li>`;
    })}
  </ol>`;
}

export function Calendar() {
  const { events, categories, settings, ledger, dayImages } = useApp();
  const now = useNow(60000);
  const today = ymd(now);
  const view = settings.calendarView || 'month';
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [anchor, setAnchor] = useState(today); // 주간 보기 기준일
  const [popup, setPopup] = useState(null);
  const [managing, setManaging] = useState(false); // 전체 일정 관리 (그 위에 수정 · 복사 · 삭제 창이 뜬다)
  // 복사 · 이동 버튼을 누른 일정 { mode: 'copy' | 'move', eventId, date } → 날짜 칸을 누르면 그 날로 복사 · 이동
  const [copying, setCopying] = useState(null);

  const weeks = useMemo(() => monthMatrix(ym.year, ym.month, settings.weekStart), [ym.year, ym.month, settings.weekStart]);
  const weekDays = useMemo(() => {
    const s = weekStartOf(anchor, settings.weekStart);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [anchor, settings.weekStart]);
  const from = view === 'week' ? weekDays[0] : weeks[0][0];
  const to = view === 'week' ? weekDays[6] : weeks[weeks.length - 1][6];
  const occs = useMemo(() => occurrences(events, from, to, settings.hiddenCategories), [events, from, to, settings.hiddenCategories]);
  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  // 용돈기입장 위젯을 화면에 놓았을 때만 하루 합계 표시 (설정에서 끌 수 있음)
  const placed = (id) => (settings[layoutKey(settings)].find((l) => l.id === id) || {}).visible;
  const ledgerOn = placed('ledger');
  const money = useMemo(() => {
    if (!ledgerOn || settings.ledgerOnCalendar === false || !ledger || !ledger.length) return null;
    const m = new Map();
    for (const x of ledger) {
      // 저축은 쓴 돈이 아니므로 캘린더 합계에서 뺀다 (저축만 있는 날은 표시 안 함)
      if (x.date < from || x.date > to || x.type === 'save') continue;
      const day = m.get(x.date) || { in: 0, out: 0 };
      day[x.type === 'in' ? 'in' : 'out'] += x.amount;
      m.set(x.date, day);
    }
    return m;
  }, [ledger, from, to, settings.ledgerOnCalendar, ledgerOn]);
  const colorOf = (ev) => ev.color || (ev.categoryId && catMap[ev.categoryId] && catMap[ev.categoryId].color) || '#ececec';

  const showDate = (date) => {
    const d = parse(date);
    setYm({ year: d.getFullYear(), month: d.getMonth() });
    setAnchor(date);
  };
  const go = (n) => {
    if (view === 'week') {
      const next = addDays(anchor, n * 7);
      showDate(next);
    } else setYm((v) => addMonths(v.year, v.month, n));
  };
  const goToday = () => showDate(today);
  const shown = view === 'week' ? parse(weekDays[3]) : new Date(ym.year, ym.month, 1);
  const shownY = shown.getFullYear();
  const shownM = shown.getMonth();
  const unit = view === 'week' ? '주' : '달';

  useBus('calendar:open', (p) => {
    if (p.date) showDate(p.date);
    setPopup(p);
  });

  // 호버 · 상세 창의 '복사' · '이동'은 날짜 고르기로 (전체 일정 관리의 복사는 내용을 고치는 등록 창 그대로)
  const onOpen = (p) => {
    if (p.type !== 'copy' && p.type !== 'move') return setPopup(p);
    setPopup(null);
    setCopying({ mode: p.type, eventId: p.eventId, date: p.date });
  };
  const copyEv = copying && events.find((e) => e.id === copying.eventId);
  const pickCopy = (date) => {
    if (copyEv) {
      const start = copying.date || copyEv.start;
      const delta = diffDays(start, date);
      if (copying.mode === 'move') {
        if (delta) moveOccurrence({ ev: copyEv, start }, delta);
      } else copyOccurrence({ ev: copyEv, start }, delta);
    }
    setCopying(null);
  };
  // Esc 로 복사 취소 (다른 Esc 처리보다 먼저)
  useEffect(() => {
    if (!copying) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setCopying(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [copying]);
  const onCreate = (preset) => setPopup({ type: 'create', preset });
  const onMoveEvent = (occ, delta, copy) => (copy ? copyOccurrence(occ, delta) : moveOccurrence(occ, delta));

  return html`<section class=${cx('widget w-calendar', 'view-' + view)} aria-labelledby="cal-title">
    <header class="cal-head">
      <h2 class="cal-title-h" id="cal-title">
        <button type="button" class="cal-title" onClick=${() => setPopup({ type: 'month' })} aria-haspopup="dialog"
          aria-label=${`${shownY}년 ${shownM + 1}월${view === 'week' ? `, ${weekDays[0].slice(5).replace('-', '.')}–${weekDays[6].slice(5).replace('-', '.')} 주간` : ''}. 눌러서 월 선택`}>
          <span class="cal-month">${shownM + 1}</span>
          <span class="cal-mon-en" aria-hidden="true">${MONTH_EN[shownM]}</span>
          <span class="cal-year num" aria-hidden="true">${shownY}</span>
          ${view === 'week' && html`<span class="cal-range num" aria-hidden="true">${weekDays[0].slice(5).replace('-', '.')} – ${weekDays[6].slice(5).replace('-', '.')}</span>`}
          <${Icon} name="chev-down" size=${12} />
        </button>
      </h2>
      <div class="cal-tools">
        <div class="segmented segmented-sm segmented-tone cal-view" role="radiogroup" aria-label="보기 방식">
          ${[['month', '월'], ['week', '주']].map(([v, label]) => html`<button type="button" role="radio" aria-checked=${String(view === v)}
            class=${cx('seg', view === v && 'is-on')} onClick=${() => setSetting('calendarView', v)}>${label}</button>`)}
        </div>
        <${IconButton} icon="chev-left" label=${`이전 ${unit}`} onClick=${() => go(-1)} />
        <button type="button" class="btn btn-ghost btn-sm" onClick=${goToday}>오늘</button>
        <${IconButton} icon="chev-right" label=${`다음 ${unit}`} onClick=${() => go(1)} />
        <${IconButton} icon="tag" label="카테고리 관리" onClick=${() => setPopup({ type: 'categories' })} />
        <button type="button" class="btn btn-primary btn-sm" onClick=${() => onCreate({ start: today })}>
          <${Icon} name="plus" size=${14} /> 일정
        </button>
        <button type="button" class="btn btn-sm cal-manage" onClick=${() => setManaging(true)} aria-haspopup="dialog" title="등록된 일정 전체 관리">
          <${Icon} name="check-list" size=${14} /><span class="cal-manage-text"> 전체일정관리</span>
        </button>
      </div>
    </header>

    ${view === 'week'
      ? html`<${WeekList} days=${weekDays} occs=${occs} today=${today} colorOf=${colorOf} onOpen=${onOpen} onCreate=${onCreate} settings=${settings} onMoveEvent=${onMoveEvent} money=${money}
          picking=${copyEv ? pickCopy : null} />`
      : html`<${MonthGrid} ym=${ym} weeks=${weeks} occs=${occs} today=${today} colorOf=${colorOf} onOpen=${onOpen} onCreate=${onCreate}
          popupOpen=${!!popup} showDate=${showDate} settings=${settings} onMoveEvent=${onMoveEvent} money=${money} dayImages=${dayImages}
          picking=${copyEv ? pickCopy : null} />`}

    ${copyEv && html`<div class="cal-pick" role="status">
      <span class="cal-pick-dot" style=${{ background: colorOf(copyEv) }} aria-hidden="true"></span>
      <span class="cal-pick-text"><strong>${copyEv.title}</strong> ${copying.mode === 'move' ? '옮길' : '복사할'} 날짜를 누르세요</span>
      ${copying.mode === 'copy' && html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => { setPopup({ type: 'copy', eventId: copying.eventId, date: copying.date }); setCopying(null); }}>내용 고쳐 복사</button>`}
      <button type="button" class="btn btn-sm" onClick=${() => setCopying(null)}>취소</button>
    </div>`}

    ${managing && html`<${EventManager} onOpen=${setPopup} onClose=${() => setManaging(false)} />`}
    ${popup && popup.type === 'month' && html`<${MonthPicker} year=${shownY} month=${shownM} onClose=${() => setPopup(null)}
      onPick=${(y, m) => { showDate(`${y}-${pad(m + 1)}-01`); setPopup(null); }} />`}
    ${popup && popup.type === 'create' && html`<${EventForm} preset=${popup.preset} onClose=${() => setPopup(null)} />`}
    ${popup && popup.type === 'copy' && html`<${EventForm} copyOf=${popup.eventId} occDate=${popup.date} onClose=${() => setPopup(null)} />`}
    ${popup && popup.type === 'edit' && html`<${EventForm} eventId=${popup.eventId} occDate=${popup.date} onClose=${() => setPopup(null)} />`}
    ${popup && popup.type === 'detail' && html`<${EventDetail} eventId=${popup.eventId} date=${popup.date}
        onEdit=${() => setPopup({ type: 'edit', eventId: popup.eventId, date: popup.date })}
        onCopy=${() => onOpen({ type: 'copy', eventId: popup.eventId, date: popup.date })} onClose=${() => setPopup(null)} />`}
    ${popup && popup.type === 'day' && html`<${DayList} date=${popup.date} occs=${occs.filter((o) => o.start <= popup.date && o.end >= popup.date)}
        onOpen=${(o) => setPopup({ type: 'detail', eventId: o.ev.id, date: o.start })}
        onCreate=${() => onCreate({ start: popup.date })} onClose=${() => setPopup(null)} />`}
    ${popup && popup.type === 'delete' && html`<${EventDelete} eventId=${popup.eventId} date=${popup.date} onDone=${() => setPopup(null)} onCancel=${() => setPopup(null)} />`}
    ${popup && popup.type === 'categories' && html`<${CategoryManager} onClose=${() => setPopup(null)} />`}
  </section>`;
}
