// 캘린더 팝업: 일정 등록/수정, 상세, 날짜별 목록, 카테고리 관리
import { html, useState, useRef, cx, capture } from '../lib.js';
import { useApp } from '../store.js';
import { saveEvent, deleteEvent, excludeOccurrence, detachOccurrence, saveCategory, deleteCategory, reorderCategories, toggleCategoryHidden, setDayImage } from '../actions.js';
import { todayStr, dow, WEEK_KO, fmtKoDate } from '../util/date.js';
import { KIND_LABEL, FREQ_LABEL, whenParts, ddayOf } from '../util/recur.js';
import { readableOn, EVENT_COLORS } from '../util/color.js';
import { Popup, Confirm } from './Popup.js';
import { Field, Segmented, Toggle, Check, ColorPicker } from './controls.js';
import { Icon, IconButton } from './icons.js';
import { DdayThumbField } from './DDay.js';
import { DayImagePanel } from './DayImage.js';

const KIND_OPTIONS = [
  { value: 'single', label: '단기' },
  { value: 'range', label: '장기' },
  { value: 'repeat', label: '반복' },
  { value: 'anniversary', label: '기념일' },
];

function emptyForm(preset = {}) {
  const start = preset.start || todayStr();
  return {
    title: '', kind: preset.kind || 'single', start, end: preset.end || start,
    allDay: true, startTime: '09:00', endTime: '10:00',
    repeat: { freq: 'weekly', days: [dow(start)], until: '' },
    yearly: true, dday: preset.kind === 'anniversary', ddayMode: 'until', ddayCountFirst: false,
    categoryId: null, color: null, memo: '',
    ...preset,
  };
}

function toForm(ev) {
  return {
    ...emptyForm({ start: ev.start }),
    ...ev,
    end: ev.end || ev.start,
    repeat: { freq: 'weekly', days: [dow(ev.start)], ...(ev.repeat || {}), until: (ev.repeat && ev.repeat.until) || '' },
  };
}

/** 폼 → 저장용 이벤트(유형별로 필요한 값만) */
function toEvent(f, id) {
  const ev = {
    id, title: f.title.trim(), kind: f.kind, start: f.start, categoryId: f.categoryId || null, color: f.color || null,
    memo: f.memo.trim(), dday: !!f.dday, ddayMode: f.ddayMode, ddayCountFirst: !!f.ddayCountFirst, ddayThumb: f.ddayThumb || null,
    allDay: f.kind === 'single' || f.kind === 'repeat' ? f.allDay : true,
    exdates: f.exdates || [], createdAt: f.createdAt,
  };
  if (!ev.allDay) {
    ev.startTime = f.startTime;
    ev.endTime = f.endTime;
  }
  if (f.kind === 'range') ev.end = f.end;
  if (f.kind === 'repeat') ev.repeat = { freq: f.repeat.freq, days: f.repeat.days, until: f.repeat.until || null };
  if (f.kind === 'anniversary') ev.yearly = f.yearly;
  return ev;
}

/** 복사할 일정 → 새 일정 폼 (id·생성일·반복 제외일은 새로) */
function copyForm(ev) {
  const { id, createdAt, updatedAt, exdates, ...rest } = toForm(ev);
  return rest;
}

/** copyOf: 이 일정 내용을 채운 새 일정 등록 폼 (일정 복사) */
export function EventForm({ preset, eventId, copyOf, occDate, onClose }) {
  const { events, categories, dayImages } = useApp();
  const original = eventId ? events.find((e) => e.id === eventId) : null;
  const source = copyOf ? events.find((e) => e.id === copyOf) : null;
  const [f, setF] = useState(() => (original ? toForm(original) : source ? copyForm(source) : emptyForm(preset)));
  const [scope, setScope] = useState('all');
  const [error, setError] = useState('');
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const setRepeat = (patch) => setF((v) => ({ ...v, repeat: { ...v.repeat, ...patch } }));
  const isRepeatEdit = original && original.kind === 'repeat' && occDate;
  // '칸 이미지' 탭: 등록 버튼을 누를 때 함께 저장 (undefined = 손대지 않음)
  const [tab, setTab] = useState(preset && preset.tab === 'image' ? 'image' : 'event');
  const [imgDraft, setImgDraft] = useState(undefined);
  const imgDate = occDate || f.start;
  const img = imgDraft !== undefined ? imgDraft : (dayImages || {})[imgDate] || null;

  function fail(msg) {
    setTab('event');
    setError(msg);
  }
  function submit(e) {
    e.preventDefault();
    const imgChanged = imgDraft !== undefined;
    if (!f.title.trim()) {
      if (!imgChanged) return fail('제목을 입력해 주세요.');
      setDayImage(imgDate, imgDraft); // 이미지만 바꾼 경우
      return onClose();
    }
    if (f.kind === 'range' && f.end < f.start) return fail('종료일이 시작일보다 빠릅니다.');
    if (f.kind === 'repeat' && ['weekly', 'biweekly'].includes(f.repeat.freq) && !f.repeat.days.length) return fail('반복할 요일을 하나 이상 선택해 주세요.');
    if (f.kind === 'repeat' && f.repeat.until && f.repeat.until < f.start) return fail('반복 종료일이 시작일보다 빠릅니다.');
    if (!f.allDay && f.endTime && f.endTime < f.startTime) return fail('종료 시간이 시작 시간보다 빠릅니다.');
    if (isRepeatEdit && scope === 'one') {
      detachOccurrence(original.id, occDate, { ...toEvent({ ...f, kind: 'single', start: occDate }, null), dday: f.dday });
    } else {
      saveEvent(toEvent(f, original ? original.id : undefined));
    }
    if (imgChanged) setDayImage(imgDate, imgDraft);
    onClose();
  }

  const toggleDay = (d) => setRepeat({ days: f.repeat.days.includes(d) ? f.repeat.days.filter((x) => x !== d) : [...f.repeat.days, d].sort() });
  const catColor = f.categoryId && (categories.find((c) => c.id === f.categoryId) || {}).color;
  const oneDay = isRepeatEdit && scope === 'one'; // 반복 일정 중 하루만 수정

  return html`<${Popup} title=${original ? '일정 수정' : source ? '일정 복사' : '일정 등록'} onClose=${onClose} size="lg" backdropClose=${false}
    footer=${html`<button type="button" class="btn" onClick=${onClose}>취소</button>
      <button type="submit" form="ev-form" class="btn btn-primary">${original ? '저장' : source ? '복사본 등록' : '등록'}</button>`}>
    <div class="pop-tabs" role="tablist" aria-label="등록 분류">
      ${[['event', '일정'], ['image', '칸 이미지']].map(([v, label]) => html`<button type="button" role="tab" aria-selected=${String(tab === v)}
        class=${cx('pop-tab', tab === v && 'is-on')} onClick=${() => setTab(v)}>${label}</button>`)}
    </div>
    ${tab === 'image' && html`<${DayImagePanel} date=${imgDate} value=${img} onChange=${setImgDraft} />`}
    <form id="ev-form" class="form-grid" onSubmit=${submit} noValidate hidden=${tab !== 'event'}>
      ${isRepeatEdit && html`<div class="span-2"><${Segmented} label="수정 범위" value=${scope} onChange=${setScope}
        options=${[{ value: 'one', label: `이 날짜만 (${occDate.slice(5).replace('-', '.')})` }, { value: 'all', label: '반복 전체' }]} /></div>`}
      <${Field} label="제목" className="span-2">${(id) => html`<input id=${id} class="input" value=${f.title} maxlength="80" required
        onInput=${(e) => set({ title: e.currentTarget.value })} placeholder="일정 제목" data-autofocus />`}<//>

      ${oneDay ? html`<div></div>` : html`<${Segmented} label="유형" value=${f.kind} options=${KIND_OPTIONS}
        onChange=${(kind) => set({ kind, dday: kind === 'anniversary' ? true : f.dday })} />`}
      <${Field} label="카테고리">${(id) => html`<select id=${id} class="input" value=${f.categoryId || ''} onChange=${(e) => set({ categoryId: e.currentTarget.value || null })}>
        <option value="">없음</option>
        ${categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
      </select>`}<//>

      ${!oneDay && f.kind !== 'range' && html`<${Field} label=${f.kind === 'repeat' ? '반복 시작일' : '날짜'}>${(id) => html`<input id=${id} type="date" class="input num" value=${f.start}
        onInput=${(e) => e.currentTarget.value && set({ start: e.currentTarget.value, end: f.end < e.currentTarget.value ? e.currentTarget.value : f.end })} />`}<//>`}
      ${!oneDay && f.kind === 'repeat' && html`<${Field} label="반복 종료일 (비우면 계속)">${(id) => html`<input id=${id} type="date" class="input num"
        value=${f.repeat.until} min=${f.start} onInput=${(e) => setRepeat({ until: e.currentTarget.value })} />`}<//>`}
      ${f.kind === 'range' && html`
        <${Field} label="시작일">${(id) => html`<input id=${id} type="date" class="input num" value=${f.start}
          onInput=${(e) => { const v = e.currentTarget.value; if (v) set({ start: v, end: f.end < v ? v : f.end }); }} />`}<//>
        <${Field} label="종료일">${(id) => html`<input id=${id} type="date" class="input num" value=${f.end} min=${f.start}
          onInput=${(e) => e.currentTarget.value && set({ end: e.currentTarget.value })} />`}<//>`}
      ${f.kind === 'anniversary' && html`<div class="field field-check"><${Check} label="매년 반복" checked=${f.yearly} onChange=${(yearly) => set({ yearly })} /></div>`}

      ${f.kind === 'repeat' && !oneDay && html`
        <${Segmented} label="반복 주기" size="sm" value=${f.repeat.freq} onChange=${(freq) => setRepeat({ freq })}
          options=${Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))} />
        ${['weekly', 'biweekly'].includes(f.repeat.freq) ? html`<fieldset class="field weekday-pick">
          <legend class="field-label">반복 요일</legend>
          <div class="weekday-row">
            ${WEEK_KO.map((w, d) => html`<label class=${cx('wd-chip', f.repeat.days.includes(d) && 'is-on', d === 0 && 'is-sun')}>
              <input type="checkbox" class="sr-only" checked=${f.repeat.days.includes(d)} onChange=${() => toggleDay(d)} />
              <span aria-hidden="true">${w}</span><span class="sr-only">${w}요일</span></label>`)}
          </div>
        </fieldset>` : html`<div></div>`}`}

      ${(f.kind === 'single' || f.kind === 'repeat') && html`<div class="field">
        <span class="field-label">시간</span>
        <div class="time-pair">
          <${Toggle} label="종일" checked=${f.allDay} onChange=${(allDay) => set({ allDay })} />
          ${!f.allDay && html`
            <label class="sr-only" for="ev-st">시작 시간</label>
            <input id="ev-st" type="time" class="input input-sm num" value=${f.startTime} onInput=${(e) => set({ startTime: e.currentTarget.value })} />
            <span aria-hidden="true">~</span>
            <label class="sr-only" for="ev-et">종료 시간</label>
            <input id="ev-et" type="time" class="input input-sm num" value=${f.endTime} onInput=${(e) => set({ endTime: e.currentTarget.value })} />`}
        </div>
      </div>`}

      <div class="span-2 ev-style-row">
        <${ColorPicker} label="색상" value=${f.color} onChange=${(color) => set({ color })} allowNone noneLabel=${catColor ? '카테고리 색 사용' : '기본 색'} savable />
        <div class="form-box ev-dday-box">
          <div class="ev-dday-head">
            <${Toggle} label="D-day 위젯에 표시" checked=${f.dday} onChange=${(dday) => set({ dday })} />
            ${f.dday && html`<${Segmented} label="표시 방식" hideLabel size="sm" value=${f.ddayMode} onChange=${(ddayMode) => set({ ddayMode })}
              options=${[{ value: 'until', label: '남은 날 D-n' }, { value: 'since', label: '지난 날 D+n' }]} />`}
          </div>
          ${f.dday && html`
            ${f.ddayMode === 'since' && html`<${Check} label="시작일을 1일로 (100일째)" checked=${f.ddayCountFirst} onChange=${(v) => set({ ddayCountFirst: v })} />`}            <${DdayThumbField} thumb=${f.ddayThumb || null} color=${f.color || catColor || '#d9d9d9'} onChange=${(ddayThumb) => set({ ddayThumb })} />`}
        </div>
      </div>

      <${Field} label="메모" className="span-2">${(id) => html`<textarea id=${id} class="input" rows="2" value=${f.memo} onInput=${(e) => set({ memo: e.currentTarget.value })} placeholder="상세 내용 (선택)"></textarea>`}<//>
      ${error && html`<p class="form-error span-2" role="alert">${error}</p>`}
    </form>
  <//>`;
}

/** 일정 삭제 확인. 반복 일정: 기본(Enter)은 누른 날짜 하루만 삭제, 전체 삭제는 따로 */
export function EventDelete({ eventId, date, onDone, onCancel }) {
  const { events } = useApp();
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return null;
  return ev.kind === 'repeat' && date
    ? html`<${Confirm} title="일정 삭제" danger confirmLabel=${`이 날짜만 삭제 (${date.slice(5).replace('-', '.')})`}
      message=${`'${ev.title}' 반복 일정을 어떻게 삭제할까요?`}
      extra=${html`<button type="button" class="btn btn-danger-ghost" onClick=${() => { deleteEvent(ev.id); onDone(); }}>반복 전체 삭제</button>`}
      onConfirm=${() => { excludeOccurrence(ev.id, date); onDone(); }} onCancel=${onCancel} />`
    : html`<${Confirm} title="일정 삭제" danger confirmLabel="삭제" message=${`'${ev.title}' 일정을 삭제할까요?`}
      onConfirm=${() => { deleteEvent(ev.id); onDone(); }} onCancel=${onCancel} />`;
}

export function EventDetail({ eventId, date, onEdit, onCopy, onClose }) {
  const { events, categories } = useApp();
  const [confirm, setConfirm] = useState(false);
  const ev = events.find((e) => e.id === eventId);
  if (!ev) return null;
  const cat = categories.find((c) => c.id === ev.categoryId);
  const color = ev.color || (cat && cat.color) || '#ececec';
  const dd = ev.dday ? ddayOf(ev, todayStr()) : null;
  const when = whenParts(ev, date);
  const repeat = ev.kind === 'repeat';
  const title = html`<span class="ev-title">
    ${cat && html`<span class="ev-chip" style=${{ background: color, color: readableOn(color) }}>${cat.name}</span>`}
    <span class="ev-title-text">${ev.title}</span>
  </span>`;

  if (confirm) return html`<${EventDelete} eventId=${ev.id} date=${date} onDone=${onClose} onCancel=${() => setConfirm(false)} />`;

  return html`<${Popup} title=${title} onClose=${onClose} size="sm"
    footer=${html`<button type="button" class="btn btn-danger-ghost" onClick=${() => setConfirm(true)}><${Icon} name="trash" size=${14} /> 삭제</button>
      ${onCopy && html`<button type="button" class="btn" onClick=${onCopy} title="Ctrl+끌기로도 복사"><${Icon} name="copy" size=${14} /> 복사</button>`}
      <button type="button" class="btn btn-primary" onClick=${onEdit}><${Icon} name="edit" size=${14} /> 수정</button>`}>
    <div class="ev-detail">
      <p class="ev-when num">
        <span class="ev-kind">${KIND_LABEL[ev.kind]}</span>
        <span>${repeat ? when.rule : when.date}</span>
        ${when.time && html`<span>${when.time}</span>`}
      </p>
      ${repeat && html`<p class="ev-repeat num">${when.date}</p>`}
      ${dd && html`<p class="ev-dday num">${dd.label}</p>`}
      ${ev.memo && html`<p class="ev-memo">${ev.memo}</p>`}
    </div>
  <//>`;
}

export function DayList({ date, occs, onOpen, onCreate, onClose }) {
  const { categories } = useApp();
  return html`<${Popup} title=${fmtKoDate(date)} onClose=${onClose} size="sm"
    footer=${html`<button type="button" class="btn btn-primary" onClick=${onCreate}><${Icon} name="plus" size=${14} /> 일정 추가</button>`}>
    ${occs.length ? html`<ul class="day-list">
      ${occs.map((o) => {
        const cat = categories.find((c) => c.id === o.ev.categoryId);
        const color = o.ev.color || (cat && cat.color) || '#ececec';
        return html`<li><button type="button" class="day-item" onClick=${() => onOpen(o)}>
          <span class="dot" style=${{ background: color }} aria-hidden="true"></span>
          <span class="day-item-title">${o.ev.title}</span>
          <span class="muted num">${o.ev.allDay === false ? o.ev.startTime : KIND_LABEL[o.ev.kind]}</span>
        </button></li>`;
      })}
    </ul>` : html`<p class="empty">등록된 일정이 없습니다.</p>`}
  <//>`;
}

/** 카테고리 줄을 손잡이로 끌어 순서 바꾸기 (Alt+↑↓ 로도) */
function useCategoryReorder(categories) {
  const [drag, setDrag] = useState(null); // { from, to }
  const listRef = useRef(null);
  function commit(from, to) {
    if (from === to) return;
    const ids = categories.map((c) => c.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorderCategories(ids);
  }
  function start(e, index) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    capture(el, e);
    let state = { from: index, to: index };
    setDrag(state);
    const move = (ev) => {
      const rows = [...listRef.current.querySelectorAll('.cat-row')];
      let to = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY < b.top + b.height / 2;
      });
      if (to < 0) to = rows.length - 1;
      else if (to > index) to -= 1;
      if (to !== state.to) {
        state = { from: index, to };
        setDrag(state);
      }
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      commit(state.from, state.to);
      setDrag(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function onKey(e, index) {
    const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (!e.altKey || !d) return;
    e.preventDefault();
    commit(index, Math.max(0, Math.min(categories.length - 1, index + d)));
  }
  return { drag, start, onKey, listRef };
}

export function CategoryManager({ onClose }) {
  const { categories, settings } = useApp();
  const reorder = useCategoryReorder(categories);
  const [name, setName] = useState('');
  const [color, setColor] = useState(EVENT_COLORS[categories.length % EVENT_COLORS.length]);
  const hidden = new Set(settings.hiddenCategories);

  function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    saveCategory({ name: name.trim(), color });
    setName('');
    setColor(EVENT_COLORS[(categories.length + 1) % EVENT_COLORS.length]);
  }

  return html`<${Popup} title="카테고리 관리" onClose=${onClose} size="md">
    <ul class="cat-list" ref=${reorder.listRef}>
      ${categories.map((c, i) => {
        const dr = reorder.drag;
        return html`<li key=${c.id} class=${cx('cat-row', dr && dr.from === i && 'is-dragging', dr && dr.from !== i && dr.to === i && (dr.to < dr.from ? 'drop-before' : 'drop-after'))}>
        <button type="button" class="cat-grip" aria-label=${c.name + ' 순서 바꾸기 (끌기 또는 Alt+위아래 방향키)'} title="끌어서 순서 바꾸기"
          onPointerDown=${(e) => reorder.start(e, i)} onKeyDown=${(e) => reorder.onKey(e, i)}><${Icon} name="grip" size=${14} /></button>
        <label class="cat-color" title="색상 변경" style=${{ background: c.color }}>
          <span class="sr-only">${c.name} 색상</span>
          <input type="color" value=${c.color} onInput=${(e) => saveCategory({ ...c, color: e.currentTarget.value })} />
        </label>
        <label class="sr-only" for=${'cat-' + c.id}>카테고리 이름</label>
        <input id=${'cat-' + c.id} class="input input-sm" value=${c.name} onChange=${(e) => e.currentTarget.value.trim() && saveCategory({ ...c, name: e.currentTarget.value.trim() })} />
        <${Check} label="표시" checked=${!hidden.has(c.id)} onChange=${() => toggleCategoryHidden(c.id)} />
        <${IconButton} icon="trash" label=${c.name + ' 삭제'} onClick=${() => deleteCategory(c.id)} />
      </li>`;
      })}
      ${!categories.length && html`<li class="empty">카테고리가 없습니다.</li>`}
    </ul>
    <form class="cat-add" onSubmit=${add}>
      <label class="cat-color" style=${{ background: color }} title="새 카테고리 색상">
        <span class="sr-only">새 카테고리 색상</span>
        <input type="color" value=${color} onInput=${(e) => setColor(e.currentTarget.value)} />
      </label>
      <label class="sr-only" for="cat-new">새 카테고리 이름</label>
      <input id="cat-new" class="input input-sm" value=${name} onInput=${(e) => setName(e.currentTarget.value)} placeholder="새 카테고리 이름" />
      <button type="submit" class="btn btn-primary btn-sm">추가</button>
    </form>
  <//>`;
}
