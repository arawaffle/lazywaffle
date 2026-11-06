// 전체 일정 관리: 등록된 모든 일정을 한 화면에서 찾고(검색 · 기간 · 카테고리 · 유형), 줄에서 바로 고치고, 골라서 한 번에 바꾸거나 지운다.
// 일정 수정 · 복사 · 삭제 창은 캘린더가 이 창 위에 띄운다 (onOpen).
import { html, useState, useMemo, cx } from '../lib.js';
import { useApp } from '../store.js';
import { patchEvents, deleteEvents } from '../actions.js';
import { todayStr } from '../util/date.js';
import { FREQ_LABEL } from '../util/recur.js';
import { readableOn } from '../util/color.js';
import { Popup, Confirm } from './Popup.js';
import { IconButton } from './icons.js';

const KINDS = [
  { value: 'single', label: '단기' },
  { value: 'range', label: '장기' },
  { value: 'repeat', label: '반복' },
  { value: 'anniversary', label: '기념일' },
];
const KIND_SHORT = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));
const PERIODS = [['all', '전체'], ['upcoming', '예정'], ['past', '지난']];
const SORTS = [['date', '날짜 빠른 순'], ['date-desc', '날짜 늦은 순'], ['created', '최근 등록 순']];

/** 일정이 끝나는 날 (계속 반복 · 매년 기념일은 끝이 없음) */
function lastDate(ev) {
  if (ev.kind === 'range') return ev.end || ev.start;
  if (ev.kind === 'repeat') return (ev.repeat && ev.repeat.until) || '9999-12-31';
  if (ev.kind === 'anniversary' && ev.yearly !== false) return '9999-12-31';
  return ev.start;
}

/** 줄 안의 날짜 칸: 단기 · 기념일은 날짜 하나, 장기는 시작~끝, 반복은 요약 글 (자세한 건 수정 창에서) */
function DateCell({ ev }) {
  if (ev.kind === 'repeat') {
    const r = ev.repeat || {};
    return html`<span class="em-when num" title="반복 설정은 수정 창에서">${FREQ_LABEL[r.freq] || '반복'} · ${ev.start.slice(2).replace(/-/g, '.')}~${r.until ? r.until.slice(2).replace(/-/g, '.') : ''}</span>`;
  }
  if (ev.kind === 'range') {
    return html`<span class="em-when em-range">
      <input type="date" class="input input-sm num" aria-label=${ev.title + ' 시작일'} value=${ev.start}
        onChange=${(e) => { const v = e.currentTarget.value; if (v) patchEvents([ev.id], { start: v, end: (ev.end || v) < v ? v : ev.end }); }} />
      <span aria-hidden="true">~</span>
      <input type="date" class="input input-sm num" aria-label=${ev.title + ' 종료일'} value=${ev.end || ev.start} min=${ev.start}
        onChange=${(e) => { const v = e.currentTarget.value; if (v && v >= ev.start) patchEvents([ev.id], { end: v }); }} />
    </span>`;
  }
  return html`<span class="em-when">
    <input type="date" class="input input-sm num" aria-label=${ev.title + ' 날짜'} value=${ev.start}
      onChange=${(e) => { const v = e.currentTarget.value; if (v) patchEvents([ev.id], { start: v, end: v }); }} />
    ${ev.allDay === false && ev.startTime && html`<span class="em-time num">${ev.startTime}</span>`}
  </span>`;
}

export function EventManager({ onOpen, onClose }) {
  const { events, categories } = useApp();
  const today = todayStr();
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState('all');
  const [cat, setCat] = useState('*'); // * 전체 · '' 없음 · 카테고리 id
  const [kind, setKind] = useState('*');
  const [sort, setSort] = useState('date');
  const [sel, setSel] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // 지울 id 목록
  const catMap = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const colorOf = (ev) => ev.color || (ev.categoryId && catMap[ev.categoryId] && catMap[ev.categoryId].color) || '#ececec';

  const list = useMemo(() => {
    const word = q.trim().toLowerCase();
    const out = events.filter((e) => {
      if (word && !`${e.title} ${e.memo || ''}`.toLowerCase().includes(word)) return false;
      if (kind !== '*' && e.kind !== kind) return false;
      if (cat !== '*' && (e.categoryId || '') !== cat) return false;
      if (period === 'upcoming' && lastDate(e) < today) return false;
      if (period === 'past' && lastDate(e) >= today) return false;
      return true;
    });
    if (sort === 'created') return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const dir = sort === 'date-desc' ? -1 : 1;
    return out.sort((a, b) => dir * (a.start.localeCompare(b.start) || a.title.localeCompare(b.title)));
  }, [events, q, kind, cat, period, sort, today]);

  // 고른 것 중 지금 목록에 보이는 것만 한꺼번에 바꾼다
  const picked = list.filter((e) => sel.has(e.id));
  const pickedIds = picked.map((e) => e.id);
  const allOn = list.length > 0 && picked.length === list.length;
  const toggle = (id) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSel(allOn ? new Set() : new Set(list.map((e) => e.id)));

  // 확인 창은 관리 창 밖(위젯 기준)에 띄운다 — 관리 창 본문 안에 두면 스크롤 영역에 갇힌다
  return html`<${Popup} title="전체 일정 관리" onClose=${onClose} size="fill" className="em-popup">
    <div class="em">
      <div class="em-filters">
        <label class="sr-only" for="em-q">일정 검색</label>
        <input id="em-q" class="input input-sm em-search" type="search" value=${q} placeholder="제목 · 메모 검색" onInput=${(e) => setQ(e.currentTarget.value)} />
        <div class="segmented segmented-sm" role="radiogroup" aria-label="기간">
          ${PERIODS.map(([v, label]) => html`<button type="button" role="radio" key=${v} aria-checked=${String(period === v)}
            class=${cx('seg', period === v && 'is-on')} onClick=${() => setPeriod(v)}>${label}</button>`)}
        </div>
        <select class="input input-sm" aria-label="카테고리로 거르기" value=${cat} onChange=${(e) => setCat(e.currentTarget.value)}>
          <option value="*">모든 카테고리</option>
          <option value="">카테고리 없음</option>
          ${categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
        <select class="input input-sm" aria-label="유형으로 거르기" value=${kind} onChange=${(e) => setKind(e.currentTarget.value)}>
          <option value="*">모든 유형</option>
          ${KINDS.map((k) => html`<option value=${k.value}>${k.label}</option>`)}
        </select>
        <select class="input input-sm" aria-label="정렬" value=${sort} onChange=${(e) => setSort(e.currentTarget.value)}>
          ${SORTS.map(([v, label]) => html`<option value=${v}>${label}</option>`)}
        </select>
      </div>

      <div class=${cx('em-bulk', picked.length && 'is-on')} role="group" aria-label="고른 일정 한꺼번에 바꾸기">
        <label class="check em-check">
          <input type="checkbox" checked=${allOn} disabled=${!list.length} onChange=${toggleAll} aria-label="목록 전체 고르기" />
          <span class="check-box" aria-hidden="true"></span>
        </label>
        <span class="em-count num">${picked.length ? `${picked.length}개 선택` : `일정 ${list.length}개${list.length !== events.length ? ` / 전체 ${events.length}개` : ''}`}</span>
        ${picked.length > 0 && html`
          <select class="input input-sm" aria-label="고른 일정의 카테고리 바꾸기" value="-"
            onChange=${(e) => { const v = e.currentTarget.value; if (v !== '-') patchEvents(pickedIds, { categoryId: v || null }); e.currentTarget.value = '-'; }}>
            <option value="-" disabled>카테고리 변경</option>
            <option value="">없음</option>
            ${categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
          </select>
          <button type="button" class="btn btn-sm" onClick=${() => patchEvents(pickedIds, { dday: true })}>D-day 켜기</button>
          <button type="button" class="btn btn-sm" onClick=${() => patchEvents(pickedIds, { dday: false })}>D-day 끄기</button>
          <button type="button" class="btn btn-sm" onClick=${() => patchEvents(pickedIds, { color: null })} title="직접 고른 색을 지우고 카테고리 색으로">색 초기화</button>
          <span class="foot-space"></span>
          <button type="button" class="btn btn-sm btn-danger-ghost" onClick=${() => setConfirm(pickedIds)}>삭제</button>
          <button type="button" class="btn btn-sm btn-ghost" onClick=${() => setSel(new Set())}>선택 해제</button>`}
      </div>

      ${list.length ? html`<ul class="em-list">
        ${list.map((ev) => {
          const bg = colorOf(ev);
          const on = sel.has(ev.id);
          const past = lastDate(ev) < today;
          return html`<li key=${ev.id} class=${cx('em-row', on && 'is-on', past && 'is-past')}>
            <label class="check em-check">
              <input type="checkbox" checked=${on} onChange=${() => toggle(ev.id)} aria-label=${ev.title + ' 고르기'} />
              <span class="check-box" aria-hidden="true"></span>
            </label>
            <span class="em-title">
              <span class="em-dot" style=${{ background: bg }} aria-hidden="true"></span>
              <input class="input input-sm" value=${ev.title} maxlength="80" aria-label="제목"
                onChange=${(e) => { const v = e.currentTarget.value.trim(); if (v) patchEvents([ev.id], { title: v }); else e.currentTarget.value = ev.title; }} />
            </span>
            <span class="em-meta">
              <span class="em-kind" style=${{ background: bg, color: readableOn(bg) }}>${KIND_SHORT[ev.kind]}</span>
              <${DateCell} ev=${ev} />
              <select class="input input-sm em-cat" aria-label=${ev.title + ' 카테고리'} value=${ev.categoryId || ''}
                onChange=${(e) => patchEvents([ev.id], { categoryId: e.currentTarget.value || null })}>
                <option value="">카테고리 없음</option>
                ${categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
              </select>
              <button type="button" class=${cx('em-dday', ev.dday && 'is-on')} aria-pressed=${String(!!ev.dday)} title="D-day 위젯에 표시"
                onClick=${() => patchEvents([ev.id], { dday: !ev.dday })}>D-day</button>
            </span>
            <span class="em-acts">
              <${IconButton} icon="edit" size=${14} label=${ev.title + ' 수정'} onClick=${() => onOpen({ type: 'edit', eventId: ev.id })} />
              <${IconButton} icon="copy" size=${14} label=${ev.title + ' 복사'} onClick=${() => onOpen({ type: 'copy', eventId: ev.id })} />
              <${IconButton} icon="trash" size=${14} label=${ev.title + ' 삭제'} onClick=${() => setConfirm([ev.id])} />
            </span>
          </li>`;
        })}
      </ul>` : html`<p class="empty">${events.length ? '조건에 맞는 일정이 없습니다.' : '등록된 일정이 없습니다.'}</p>`}
    </div>
  <//>
  ${confirm && html`<${Confirm} title="일정 삭제" danger confirmLabel="삭제"
      message=${confirm.length === 1
        ? `'${(events.find((e) => e.id === confirm[0]) || {}).title}' 일정을 삭제할까요?${(events.find((e) => e.id === confirm[0]) || {}).kind === 'repeat' ? ' (반복 전체)' : ''}`
        : `고른 일정 ${confirm.length}개를 삭제할까요? 반복 일정은 반복 전체가 지워집니다.`}
      onConfirm=${() => { deleteEvents(confirm); setSel((s) => new Set([...s].filter((id) => !confirm.includes(id)))); setConfirm(null); }}
      onCancel=${() => setConfirm(null)} />`}`;
}
