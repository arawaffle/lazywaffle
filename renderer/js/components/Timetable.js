// 하루 타임테이블: 반복하는 일과(블록) + 오늘 캘린더의 시간 일정을 24시간 위에 표시
// 일과는 요일 묶음(평일·주말 등)마다 따로 둘 수 있고, 오늘 요일이 속한 묶음을 보여준다.
// 보기: 가로 막대(기본) / 원형 그래프. SVG·퍼센트 배치라 위젯 크기가 바뀌어도 깨지지 않는다.
import { html, useState, useRef, useMemo, useNow, useSize, cx, uid, bus } from '../lib.js';
import { useApp, update } from '../store.js';
import { ymd, pad, WEEK_KO } from '../util/date.js';
import { occurrences } from '../util/recur.js';
import { EVENT_COLORS, readableOn } from '../util/color.js';
import { Popup, popoverPlacement } from './Popup.js';
import { Toggle } from './controls.js';
import { Icon, IconButton } from './icons.js';

const DAY = 1440;
const toMin = (t) => {
  const [h, m] = (t || '0:0').split(':').map(Number);
  return Math.min(DAY, h * 60 + m);
};
const fmt = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

/** 블록을 0~1440 구간 조각으로 (자정을 넘기면 두 조각) */
function segments(start, end) {
  const s = toMin(start);
  let e = toMin(end);
  if (e === 0) e = DAY;
  if (e === s) return []; // 시작과 끝이 같으면 길이 0
  return e > s ? [[s, e]] : [[s, DAY], [0, e]];
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월요일부터

/** 이 요일(0=일)이 속한 일과 묶음 */
const groupFor = (timetable, dow) => (timetable.groups || []).find((g) => g.days.includes(dow)) || null;

/** 요일 목록 → '매일' · '평일' · '주말' · '월·수·금' */
function daysLabel(days) {
  const key = [...days].sort().join(',');
  if (key === '0,1,2,3,4,5,6') return '매일';
  if (key === '1,2,3,4,5') return '평일';
  if (key === '0,6') return '주말';
  return days.length ? WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEK_KO[d]).join('·') : '요일 없음';
}

function useItems() {
  const { timetable, events, categories, settings } = useApp();
  const now = useNow(60000);
  const today = ymd(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const group = groupFor(timetable, now.getDay());
  const items = useMemo(() => {
    const blocks = ((group && group.blocks) || []).map((b) => ({ ...b, kind: 'block' }));
    if (!timetable.showEvents) return blocks;
    const cat = Object.fromEntries(categories.map((c) => [c.id, c]));
    const evs = occurrences(events, today, today, settings.hiddenCategories)
      .filter((o) => o.ev.allDay === false && o.ev.startTime)
      .map((o) => ({
        id: o.key, label: o.ev.title, start: o.ev.startTime, end: o.ev.endTime || fmt(Math.min(DAY - 1, toMin(o.ev.startTime) + 60)),
        color: o.ev.color || (cat[o.ev.categoryId] && cat[o.ev.categoryId].color) || '#cdeefc', kind: 'event', eventId: o.ev.id, date: o.start,
      }));
    return [...blocks, ...evs];
  }, [group, timetable.showEvents, events, categories, settings.hiddenCategories, today]);
  const current = items.filter((it) => segments(it.start, it.end).some(([s, e]) => nowMin >= s && nowMin < e));
  // 묶음이 둘 이상일 때만 오늘 묶음 이름을 보여준다
  const groupName = (timetable.groups || []).length > 1 && group ? group.name || daysLabel(group.days) : '';
  return { items, nowMin, current, groupName, view: timetable.view || 'bar' };
}

function openItem(it) {
  if (it.kind === 'event') bus.emit('calendar:open', { type: 'detail', eventId: it.eventId, date: it.date });
}

function BarView({ items, nowMin }) {
  const trackRef = useRef(null);
  const { width } = useSize(trackRef);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  // 조각 너비가 글자를 담을 만큼일 때만 이름 표시 (좁으면 말풍선으로)
  const fits = (label, s, e) => ((e - s) / DAY) * width >= Math.min(label.length, 4) * rem * 0.8 + rem * 0.6;
  const blocks = items.filter((i) => i.kind === 'block');
  const evs = items.filter((i) => i.kind === 'event');
  const piece = (it, [s, e], i) => html`<button type="button" key=${it.id + i} class=${cx('tt-seg', it.kind === 'event' && 'is-event')}
      style=${{ left: (s / DAY) * 100 + '%', width: ((e - s) / DAY) * 100 + '%', '--c': it.color, '--c-text': readableOn(it.color) }}
      data-tip=${`${it.label} ${it.start}–${it.end}`} aria-label=${`${it.label}, ${it.start}부터 ${it.end}까지`}
      onClick=${() => openItem(it)} tabindex=${it.kind === 'event' ? 0 : -1}>
    ${fits(it.label, s, e) && html`<span class="tt-seg-label">${it.label}</span>`}
  </button>`;
  return html`<div class="tt-bar">
    <div class="tt-track" ref=${trackRef}>
      ${blocks.map((it) => segments(it.start, it.end).map((sg, i) => piece(it, sg, i)))}
      <span class="tt-now" style=${{ left: (nowMin / DAY) * 100 + '%' }} aria-hidden="true"></span>
    </div>
    ${evs.length > 0 && html`<div class="tt-track tt-track-ev">${evs.map((it) => segments(it.start, it.end).map((sg, i) => piece(it, sg, i)))}</div>`}
    <ul class="sr-only">
      ${items.slice().sort((a, b) => toMin(a.start) - toMin(b.start)).map((it) => html`<li key=${it.id}>${it.start}–${it.end} ${it.label}</li>`)}
    </ul>
    <div class="tt-scale" aria-hidden="true">
      ${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => html`<span class=${cx('num', h % 6 && 'tt-minor')} style=${{ left: (h / 24) * 100 + '%' }}>${h}</span>`)}
    </div>
  </div>`;
}

/** 원형: 12시 방향이 자정, 시계 방향으로 24시간 */
function arc(r, s, e) {
  const a0 = (s / DAY) * Math.PI * 2 - Math.PI / 2;
  const a1 = (e / DAY) * Math.PI * 2 - Math.PI / 2;
  const large = e - s > DAY / 2 ? 1 : 0;
  const p = (a) => `${(50 + r * Math.cos(a)).toFixed(3)} ${(50 + r * Math.sin(a)).toFixed(3)}`;
  if (e - s >= DAY) return `M ${p(a0)} A ${r} ${r} 0 1 1 ${p(a0 + Math.PI)} A ${r} ${r} 0 1 1 ${p(a0)}`;
  return `M ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

function DonutView({ items, nowMin, current }) {
  const blocks = items.filter((i) => i.kind === 'block');
  const evs = items.filter((i) => i.kind === 'event');
  const hand = (nowMin / DAY) * Math.PI * 2 - Math.PI / 2;
  return html`<div class="tt-donut">
    <svg viewBox="0 0 100 100" class="tt-svg" role="img" aria-label=${`24시간 원형 일과표, 현재 ${fmt(nowMin)}`}>
      <circle cx="50" cy="50" r="38" class="tt-ring-bg" />
      ${blocks.map((it) => segments(it.start, it.end).map(([s, e], i) => html`<path key=${it.id + i} d=${arc(38, s, e)} class="tt-arc" style=${{ stroke: it.color }}>
        <title>${it.label} ${it.start}–${it.end}</title></path>`))}
      ${evs.map((it) => segments(it.start, it.end).map(([s, e], i) => html`<path key=${it.id + i} d=${arc(29, s, e)} class="tt-arc tt-arc-ev" style=${{ stroke: it.color }}>
        <title>${it.label} ${it.start}–${it.end}</title></path>`))}
      ${[0, 6, 12, 18].map((h) => {
        const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
        return html`<text key=${h} x=${50 + 47 * Math.cos(a)} y=${50 + 47 * Math.sin(a)} class="tt-hour">${h}</text>`;
      })}
      <line x1="50" y1="50" x2=${50 + 33 * Math.cos(hand)} y2=${50 + 33 * Math.sin(hand)} class="tt-hand" />
      <circle cx="50" cy="50" r="1.6" class="tt-hub" />
      <text x="50" y="60" class="tt-center-time">${fmt(nowMin)}</text>
    </svg>
    <ul class="tt-legend">
      ${items.slice().sort((a, b) => toMin(a.start) - toMin(b.start)).map((it) => html`<li key=${it.id} class=${cx(current.includes(it) && 'is-now')}>
        <span class="tt-dot" style=${{ background: it.color }} aria-hidden="true"></span>
        <span class="tt-leg-time num">${it.start}</span>
        <span class="tt-leg-label">${it.label}</span>
      </li>`)}
    </ul>
  </div>`;
}

/** 매일 하나의 일과인지 (묶음 하나가 7요일 전부) */
const isDaily = (gs) => !!gs && gs.length === 1 && gs[0].days.length === 7;
const copyBlocks = (blocks) => blocks.map((x) => ({ ...x, id: uid('tb') }));
const dailyOf = (blocks) => [{ id: uid('tg'), name: '매일', days: [...ALL_DAYS], blocks: copyBlocks(blocks) }];
/** 평일 · 주말 두 묶음 (일과는 양쪽에 복사해 두고 각자 고친다) */
const splitOf = (blocks) => [
  { id: uid('tg'), name: '평일', days: [1, 2, 3, 4, 5], blocks: copyBlocks(blocks) },
  { id: uid('tg'), name: '주말', days: [0, 6], blocks: copyBlocks(blocks) },
];
const cleanGroups = (gs) => gs.map((x) => ({
  ...x,
  name: x.name.trim() || daysLabel(x.days),
  blocks: x.blocks.filter((b) => b.label.trim()).map((b) => ({ ...b, label: b.label.trim() })),
}));

/**
 * 일과 편집: [매일일과 | 분할일과] 두 방식. 고르지 않은 쪽 내용도 timetable.spare 에 남겨 두어
 * 다시 바꾸면 그대로 돌아온다. 분할일과는 요일 묶음(평일 · 주말 · 직접 만든 묶음)마다 따로 고친다.
 * 한 요일은 한 묶음에만 속하므로, 다른 묶음의 요일을 고르면 그쪽에서 빠진다.
 */
function Editor({ onClose, placement }) {
  const { timetable } = useApp();
  const [sets, setSets] = useState(() => {
    const cur = structuredClone(timetable.groups || []);
    const spare = structuredClone(timetable.spare || []);
    const daily = isDaily(cur) ? cur : isDaily(spare) ? spare : dailyOf((cur[0] || { blocks: [] }).blocks);
    const split = !isDaily(cur) && cur.length ? cur : spare.length && !isDaily(spare) ? spare : splitOf(daily[0].blocks);
    return { daily, split };
  });
  const [mode, setMode] = useState(isDaily(timetable.groups) ? 'daily' : 'split');
  const groups = sets[mode];
  const setGroups = (next) => setSets((st) => ({ ...st, [mode]: typeof next === 'function' ? next(st[mode]) : next }));
  const [selId, setSelId] = useState(() => (groupFor({ groups: sets.split }, new Date().getDay()) || sets.split[0] || {}).id);
  const [showEvents, setShowEvents] = useState(timetable.showEvents !== false);
  const g = mode === 'daily' ? groups[0] : groups.find((x) => x.id === selId) || groups[0];
  const setGroup = (id, fn) => setGroups((gs) => gs.map((x) => (x.id === id ? { ...x, ...fn(x) } : x)));
  const patchBlock = (bid, p) => setGroup(g.id, (x) => ({ blocks: x.blocks.map((b) => (b.id === bid ? { ...b, ...p } : b)) }));
  const unassigned = mode === 'split' ? ALL_DAYS.filter((d) => !groups.some((x) => x.days.includes(d))) : [];

  function toggleDay(d) {
    const on = g.days.includes(d);
    setGroups((gs) => gs.map((x) => {
      if (x.id === g.id) return { ...x, days: on ? x.days.filter((y) => y !== d) : [...x.days, d].sort() };
      return on ? x : { ...x, days: x.days.filter((y) => y !== d) };
    }));
  }
  function addGroup() {
    const ng = { id: uid('tg'), name: '', days: [], blocks: [] };
    setGroups([...groups, ng]);
    setSelId(ng.id);
  }
  function removeGroup() {
    const rest = groups.filter((x) => x.id !== g.id);
    setGroups(rest);
    setSelId(rest[0].id);
  }
  function save() {
    update((s) => {
      s.timetable.groups = cleanGroups(sets[mode]);
      s.timetable.spare = cleanGroups(sets[mode === 'daily' ? 'split' : 'daily']);
      s.timetable.showEvents = showEvents;
    });
    onClose();
  }

  return html`<${Popup} title="일과 편집" onClose=${onClose} popover=${placement} backdropClose=${false}
    footer=${html`<button type="button" class="btn" onClick=${onClose}>취소</button><button type="button" class="btn btn-primary" onClick=${save}>저장</button>`}>
    <div class="tt-groups" role="tablist" aria-label="일과 방식">
      ${[['daily', '매일일과'], ['split', '분할일과']].map(([v, label]) => html`<button type="button" role="tab" key=${v} aria-selected=${String(mode === v)}
          class=${cx('tt-group-tab', 'tt-mode-tab', mode === v && 'is-on')} onClick=${() => setMode(v)}>${label}</button>`)}
    </div>
    ${mode === 'split' && html`<div class="tt-subgroups" role="tablist" aria-label="요일 묶음">
      ${groups.map((x) => html`<button type="button" role="tab" key=${x.id} aria-selected=${String(x.id === g.id)}
          class=${cx('tt-group-tab', x.id === g.id && 'is-on')} onClick=${() => setSelId(x.id)}>
        ${x.name.trim() || daysLabel(x.days)}</button>`)}
      <button type="button" class="btn btn-ghost btn-sm" onClick=${addGroup}><${Icon} name="plus" size=${13} /> 묶음</button>
    </div>`}
    ${g && html`<div class="tt-group-edit" role="tabpanel">
      ${mode === 'split' && html`<div class="tt-group-meta">
        <label class="sr-only" for="tg-name">묶음 이름</label>
        <input id="tg-name" class="input input-sm" value=${g.name} placeholder=${daysLabel(g.days)} maxlength="12"
          onInput=${(e) => setGroup(g.id, () => ({ name: e.currentTarget.value }))} />
        <fieldset class="weekday-row" aria-label="이 묶음의 요일">
          ${WEEK_ORDER.map((d) => html`<label key=${d} class=${cx('wd-chip', g.days.includes(d) && 'is-on', d === 0 && 'is-sun')}>
            <input type="checkbox" class="sr-only" checked=${g.days.includes(d)} onChange=${() => toggleDay(d)} />
            <span aria-hidden="true">${WEEK_KO[d]}</span><span class="sr-only">${WEEK_KO[d]}요일</span></label>`)}
        </fieldset>
        ${groups.length > 1 && html`<${IconButton} icon="trash" label="이 묶음 삭제" onClick=${removeGroup} />`}
      </div>`}
      <ul class="tt-edit">
        ${g.blocks.map((b, i) => html`<li key=${b.id}>
          <label class="tt-color" style=${{ background: b.color }} title="색상"><span class="sr-only">${b.label || i + 1} 색상</span>
            <input type="color" value=${b.color} onInput=${(e) => patchBlock(b.id, { color: e.currentTarget.value })} /></label>
          <label class="sr-only" for=${'tl-' + b.id}>이름</label>
          <input id=${'tl-' + b.id} class="input input-sm" value=${b.label} placeholder="예: 업무" onInput=${(e) => patchBlock(b.id, { label: e.currentTarget.value })} />
          <label class="sr-only" for=${'ts-' + b.id}>시작</label>
          <input id=${'ts-' + b.id} type="time" class="input input-sm num" value=${b.start} onInput=${(e) => patchBlock(b.id, { start: e.currentTarget.value })} />
          <span aria-hidden="true">~</span>
          <label class="sr-only" for=${'te-' + b.id}>끝</label>
          <input id=${'te-' + b.id} type="time" class="input input-sm num" value=${b.end} onInput=${(e) => patchBlock(b.id, { end: e.currentTarget.value })} />
          <${IconButton} icon="trash" label=${`${b.label || '일과'} 삭제`} onClick=${() => setGroup(g.id, (x) => ({ blocks: x.blocks.filter((y) => y.id !== b.id) }))} />
        </li>`)}
      </ul>
      <div class="tt-edit-foot">
        <button type="button" class="btn btn-sm" onClick=${() => setGroup(g.id, (x) => ({ blocks: [...x.blocks, { id: uid('tb'), label: '', start: '09:00', end: '10:00', color: EVENT_COLORS[x.blocks.length % EVENT_COLORS.length] }] }))}>
          <${Icon} name="plus" size=${14} /> 일과 추가</button>
        <${Toggle} label="오늘 캘린더의 시간 일정도 함께 표시" checked=${showEvents} onChange=${setShowEvents} />
      </div>
    </div>`}
    ${unassigned.length > 0 && html`<p class="field-hint"><strong class="tt-warn">${unassigned.map((d) => WEEK_KO[d]).join('·')}요일은 묶음에 없어 표시되지 않습니다.</strong></p>`}
  <//>`;
}

export function Timetable() {
  const { items, nowMin, current, groupName, view } = useItems();
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(null);
  const ref = useRef(null);
  const setView = (v) => update((s) => { s.timetable.view = v; });

  function openEditor() {
    // 항상 위젯 바깥(옆 → 위·아래)에 띄운다. 화면 아래쪽 위젯이면 팝업 아랫변을 위젯 아랫변에 맞춰 작업표시줄에 가리지 않게
    setPlacement(popoverPlacement(ref.current, 30));
    setOpen(true);
  }

  return html`<section ref=${ref} class=${cx('widget w-timetable', 'view-' + view)} aria-labelledby="tt-title">
    <header class="tt-head">
      <h2 class="w-title" id="tt-title">TIMETABLE</h2>
      <p class="tt-current" aria-live="polite">
        ${groupName && html`<span class="tt-group">${groupName}</span>`}
        ${current.length ? current.map((c) => c.label).join(' · ') : '쉬는 시간'}</p>
      <div class="tt-tools">
        <div class="segmented segmented-sm segmented-tone" role="radiogroup" aria-label="보기 방식">
          ${[['bar', '가로'], ['donut', '원형']].map(([v, label]) => html`<button type="button" role="radio" aria-checked=${String(view === v)}
            class=${cx('seg', view === v && 'is-on')} onClick=${() => setView(v)}>${label}</button>`)}
        </div>
        <${IconButton} icon="edit" label="하루 일과 편집" onClick=${openEditor} aria-expanded=${String(open)} />
      </div>
    </header>
    <div class="tt-body">
      ${items.length === 0
        ? html`<button type="button" class="tt-empty" onClick=${openEditor}>일과를 추가하면 하루 시간표가 표시됩니다 +</button>`
        : view === 'donut' ? html`<${DonutView} items=${items} nowMin=${nowMin} current=${current} />` : html`<${BarView} items=${items} nowMin=${nowMin} />`}
    </div>
    ${open && html`<${Editor} placement=${placement} onClose=${() => setOpen(false)} />`}
  </section>`;
}
