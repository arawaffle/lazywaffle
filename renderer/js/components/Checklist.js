// 체크리스트: 매일 할 일 → 오늘 할 일 → 이후(완료 목표일 순)
import { html, useState, useMemo, cx, useNow, uid, bus, capture } from '../lib.js';
import { useApp } from '../store.js';
import { saveTask, deleteTask, toggleTask, toggleSubtask, setTaskStep, stepValue, reorderTasks } from '../actions.js';
import { ymd, diffDays, ddayLabel, fmtDate, addMonths, monthKey, pad } from '../util/date.js';
import { Popup, Confirm } from './Popup.js';
import { Field, Toggle } from './controls.js';
import { Icon, IconButton } from './icons.js';

function isDone(t, today) {
  return t.daily ? (t.doneDates || []).includes(today) : t.done;
}

function groupTasks(tasks, today, showCompletedToday) {
  const daily = [];
  const todays = [];
  const later = [];
  for (const t of tasks) {
    if (t.daily) {
      daily.push(t);
      continue;
    }
    const doneToday = t.done && t.doneAt && ymd(new Date(t.doneAt)) === today;
    if (t.done && !(doneToday && showCompletedToday)) continue;
    if (t.due && t.due <= today) todays.push(t);
    else if (doneToday) todays.push(t);
    else later.push(t);
  }
  // 끌어서 바꾼 순서(order)가 있으면 우선, 없으면 만든 순서 (새 항목은 맨 뒤)
  const ord = (t) => (t.order ?? 1e15 + t.createdAt);
  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
  daily.sort((a, b) => ord(a) - ord(b));
  todays.sort((a, b) => Number(a.done) - Number(b.done) || ord(a) - ord(b));
  later.sort((a, b) => byDue(a, b) || ord(a) - ord(b)); // '이후'는 완료 목표일 순 유지
  return { daily, todays, later };
}

function DueBadge({ task, today }) {
  if (task.daily) return html`<span class="badge badge-daily">매일</span>`;
  if (!task.due) return null;
  const diff = diffDays(today, task.due);
  if (diff === 0) return html`<span class="badge badge-today">오늘</span>`;
  return html`<span class=${cx('badge num', diff < 0 && !task.done && 'badge-over')} title=${fmtDate(task.due)}>${ddayLabel(diff)}</span>`;
}

/** 진도 도트: 누른 칸까지 채운다. 마지막 칸을 채우면 자동 완료 */
function StepDots({ task, today }) {
  const v = stepValue(task, today);
  return html`<div class="steps" role="group" aria-label=${`진도 ${task.steps}단계 중 ${v}단계`}>
    ${Array.from({ length: task.steps }, (_, i) => html`<button type="button" key=${i} class=${cx('step', i < v && 'is-on')}
        aria-pressed=${String(i < v)} aria-label=${`${i + 1}단계${i + 1 === task.steps ? ' (완료)' : ''}`}
        onClick=${() => setTaskStep(task.id, i + 1, today)}></button>`)}
    <span class="steps-count num" aria-hidden="true">${v}/${task.steps}</span>
  </div>`;
}

/**
 * 목록 끌어서 순서 바꾸기. '이후' 묶음은 목표일 순서를 지키기 위해 같은 목표일끼리만 옮길 수 있다.
 * 키보드: 항목 안에서 Alt+↑/↓
 */
function canPlace(group, list, from, to) {
  if (group !== 'later' || from === to) return true;
  const [a, b] = from < to ? [from, to] : [to, from];
  return list.slice(a, b + 1).every((t) => (t.due || '') === (list[from].due || ''));
}
function commitOrder(group, list, from, to) {
  if (from === to) return;
  if (!canPlace(group, list, from, to)) {
    bus.emit('toast', { text: '‘이후’ 목록은 완료 목표일 순이라, 같은 목표일끼리만 순서를 바꿀 수 있어요.' });
    return;
  }
  const ids = list.map((t) => t.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  reorderTasks(ids);
}
function useReorder(group, list) {
  const [drag, setDrag] = useState(null); // { from, to }
  function start(e, index) {
    if (e.button !== 0 || e.target.closest('input, button, label')) return;
    const row = e.currentTarget;
    const ul = row.closest('ul');
    const sy = e.clientY;
    let state = null;
    capture(row, e);
    const move = (ev) => {
      if (!state && Math.abs(ev.clientY - sy) < 5) return;
      const rows = [...ul.children];
      let to = rows.findIndex((r) => ev.clientY < r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2);
      if (to < 0) to = rows.length - 1;
      else if (to > index) to -= 1;
      if (!state || state.to !== to) {
        state = { from: index, to };
        setDrag(state);
      }
    };
    const up = () => {
      row.removeEventListener('pointermove', move);
      row.removeEventListener('pointerup', up);
      row.removeEventListener('pointercancel', up);
      if (state) commitOrder(group, list, state.from, state.to);
      setDrag(null);
    };
    row.addEventListener('pointermove', move);
    row.addEventListener('pointerup', up);
    row.addEventListener('pointercancel', up);
  }
  function onKey(e, index) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const to = Math.max(0, Math.min(list.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)));
    commitOrder(group, list, index, to);
  }
  return { drag, start, onKey, ok: drag ? canPlace(group, list, drag.from, drag.to) : true };
}

function TaskItem({ task, today, onEdit, onDelete, readonly, reorder, index }) {
  const [open, setOpen] = useState(false);
  const done = isDone(task, today);
  const subs = task.subtasks || [];
  const subDone = subs.filter((s) => s.done).length;
  const id = 'tk-' + task.id;
  const d = reorder && reorder.drag;
  return html`<li class=${cx('task', done && 'is-done', d && d.from === index && 'is-dragging', d && d.to === index && d.from !== index && (reorder.ok ? (d.to < d.from ? 'drop-before' : 'drop-after') : 'drop-no'))}
      onKeyDown=${(e) => reorder && reorder.onKey(e, index)}>
    <div class="task-row" onDblClick=${() => !readonly && onEdit(task)} onPointerDown=${(e) => reorder && reorder.start(e, index)}
      title=${readonly ? undefined : '끌어서 순서 변경 · 더블클릭하여 수정'}>
      <input type="checkbox" class="cbox" aria-labelledby=${id} checked=${done} onChange=${() => toggleTask(task.id, today)} />
      <span id=${id} class="task-text" title=${readonly ? undefined : '더블클릭하여 수정'}>${task.text}</span>
      ${subs.length > 0 && html`<button type="button" class="sub-toggle num" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}
        aria-label=${`하위 항목 ${subDone}/${subs.length}, ${open ? '접기' : '펼치기'}`}>${subDone}/${subs.length}
        <${Icon} name="chev-down" size=${12} /></button>`}
      <${DueBadge} task=${task} today=${today} />
      ${!readonly && html`<button type="button" class="task-edit" aria-label=${task.text + ' 수정'} title="수정" onClick=${() => onEdit(task)}><${Icon} name="edit" size=${12} /></button>`}
      <button type="button" class="task-del" aria-label=${task.text + ' 삭제'} title="삭제" onClick=${() => onDelete(task)}>x</button>
    </div>
    ${task.steps > 0 && html`<${StepDots} task=${task} today=${today} />`}
    ${open && subs.length > 0 && html`<ul class="subtasks">
      ${subs.map((s) => html`<li class=${cx('subtask', s.done && 'is-done')} key=${s.id}>
        <input type="checkbox" class="cbox cbox-sm" id=${'st-' + s.id} checked=${s.done} onChange=${() => toggleSubtask(task.id, s.id)} />
        <label for=${'st-' + s.id}>${s.text}</label>
      </li>`)}
    </ul>`}
  </li>`;
}

function TaskForm({ task, onClose, today }) {
  const [f, setF] = useState(() => task ? structuredClone(task) : { text: '', daily: false, due: today, subtasks: [], steps: 0 });
  const [newSub, setNewSub] = useState('');
  const [error, setError] = useState('');
  const set = (p) => setF((v) => ({ ...v, ...p }));

  function addSub() {
    if (!newSub.trim()) return;
    set({ subtasks: [...f.subtasks, { id: uid('st'), text: newSub.trim(), done: false }] });
    setNewSub('');
  }
  function submit(e) {
    e.preventDefault();
    if (!f.text.trim()) return setError('내용을 입력해 주세요.');
    saveTask({ ...f, text: f.text.trim(), due: f.daily ? null : f.due || null });
    onClose();
  }

  return html`<${Popup} title=${task ? '체크리스트 수정' : '체크리스트 추가'} onClose=${onClose} size="fill" backdropClose=${false}
    footer=${html`<button type="button" class="btn" onClick=${onClose}>취소</button>
      <button type="submit" form="task-form" class="btn btn-primary">${task ? '저장' : '추가'}</button>`}>
    <form id="task-form" class="form-grid" onSubmit=${submit} noValidate>
      <${Field} label="내용" className="span-2">${(id) => html`<input id=${id} class="input" value=${f.text} maxlength="120" data-autofocus
        onInput=${(e) => set({ text: e.currentTarget.value })} placeholder="할 일을 입력하세요" />`}<//>
      <div class="field">
        <span class="field-label">반복</span>
        <${Toggle} label="매일 해야 하는 일" checked=${f.daily} onChange=${(daily) => set({ daily })} />
      </div>
      ${f.daily ? html`<p class="field-hint field-check">매일 초기화, 맨 위에 표시</p>`
        : html`<${Field} label="완료 목표일 (비우면 맨 아래)">${(id) => html`<div class="input-with-btn">
        <input id=${id} type="date" class="input num" value=${f.due || ''} onInput=${(e) => set({ due: e.currentTarget.value })} />
        ${f.due && html`<button type="button" class="btn btn-sm" onClick=${() => set({ due: '' })}>지우기</button>`}</div>`}<//>`}
      <div class="field span-2">
        <span class="field-label" id="steps-label">진도 도트 (하위 체크리스트와 별개)</span>
        <div class="steps-pick" role="radiogroup" aria-labelledby="steps-label">
          ${[0, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => html`<button type="button" role="radio" key=${n} aria-checked=${String((f.steps || 0) === n)}
            class=${cx('steps-opt num', (f.steps || 0) === n && 'is-on')} onClick=${() => set({ steps: n, stepDone: Math.min(f.stepDone || 0, n) })}>${n || '없음'}</button>`)}
        </div>
      </div>
      <fieldset class="field span-2">
        <legend class="field-label">하위 체크리스트</legend>
        <ul class="sub-edit">
          ${f.subtasks.map((s, i) => html`<li key=${s.id}>
            <label class="sr-only" for=${'se-' + s.id}>하위 항목 ${i + 1}</label>
            <input id=${'se-' + s.id} class="input input-sm" value=${s.text}
              onInput=${(e) => set({ subtasks: f.subtasks.map((x) => (x.id === s.id ? { ...x, text: e.currentTarget.value } : x)) })} />
            <${IconButton} icon="x" label=${`하위 항목 ${i + 1} 삭제`} onClick=${() => set({ subtasks: f.subtasks.filter((x) => x.id !== s.id) })} />
          </li>`)}
        </ul>
        <div class="input-with-btn">
          <label class="sr-only" for="sub-new">하위 항목 추가</label>
          <input id="sub-new" class="input input-sm" value=${newSub} placeholder="하위 항목 입력 후 Enter"
            onInput=${(e) => setNewSub(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addSub(); } }} />
          <button type="button" class="btn btn-sm" onClick=${addSub}>추가</button>
        </div>
      </fieldset>
      ${error && html`<p class="form-error span-2" role="alert">${error}</p>`}
    </form>
  <//>`;
}

function DoneView({ tasks, today }) {
  const done = tasks.filter((t) => !t.daily && t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  if (!done.length) return html`<p class="empty">완료한 항목이 없습니다.</p>`;
  return html`<ul class="task-list">
    ${done.map((t) => html`<li class="task is-done" key=${t.id}>
      <div class="task-row">
        <input type="checkbox" class="cbox" id=${'dn-' + t.id} checked onChange=${() => toggleTask(t.id, today)} />
        <label for=${'dn-' + t.id} class="task-text">${t.text}</label>
        <span class="badge num" title="완료일">${fmtDate(ymd(new Date(t.doneAt)), { year: false, week: false })}</span>
        <button type="button" class="task-del" aria-label=${t.text + ' 삭제'} onClick=${() => deleteTask(t.id)}>x</button>
      </div>
    </li>`)}
  </ul>`;
}

function MonthView({ tasks, today }) {
  const [ym, setYm] = useState(() => ({ year: +today.slice(0, 4), month: +today.slice(5, 7) - 1 }));
  const key = `${ym.year}-${pad(ym.month + 1)}`;
  const daysInMonth = new Date(ym.year, ym.month + 1, 0).getDate();
  const items = tasks.filter((t) => !t.daily && ((t.due && monthKey(t.due) === key) || (t.doneAt && monthKey(ymd(new Date(t.doneAt))) === key)));
  const dailies = tasks.filter((t) => t.daily);
  const total = items.length;
  const doneN = items.filter((t) => t.done).length;
  return html`<div class="month-view">
    <div class="month-nav">
      <${IconButton} icon="chev-left" label="이전 달" onClick=${() => setYm((v) => addMonths(v.year, v.month, -1))} />
      <strong class="num" aria-live="polite">${ym.year}.${pad(ym.month + 1)}</strong>
      <${IconButton} icon="chev-right" label="다음 달" onClick=${() => setYm((v) => addMonths(v.year, v.month, 1))} />
      <span class="month-stat num">완료 ${doneN}/${total}</span>
    </div>
    ${dailies.length > 0 && html`<h4 class="group-title">매일</h4>
      <ul class="task-list">${dailies.map((t) => {
        const n = (t.doneDates || []).filter((d) => monthKey(d) === key).length;
        return html`<li class="task" key=${t.id}><div class="task-row">
          <span class="task-text">${t.text}</span>
          <span class="meter" aria-label=${`${daysInMonth}일 중 ${n}일 완료`}><span style=${{ width: (n / daysInMonth) * 100 + '%' }}></span></span>
          <span class="badge num">${n}/${daysInMonth}</span>
        </div></li>`;
      })}</ul>`}
    <h4 class="group-title">목표일 · 완료일 기준</h4>
    ${items.length ? html`<ul class="task-list">${items
      .sort((a, b) => (a.due || '').localeCompare(b.due || ''))
      .map((t) => html`<li class=${cx('task', t.done && 'is-done')} key=${t.id}><div class="task-row">
        <input type="checkbox" class="cbox" id=${'mv-' + t.id} checked=${t.done} onChange=${() => toggleTask(t.id, today)} />
        <label for=${'mv-' + t.id} class="task-text">${t.text}</label>
        <span class="badge num">${t.due ? fmtDate(t.due, { year: false, week: false }) : '-'}</span>
      </div></li>`)}</ul>` : html`<p class="empty">이 달의 항목이 없습니다.</p>`}
  </div>`;
}

export function Checklist() {
  const { tasks, settings } = useApp();
  const now = useNow(60000);
  const today = ymd(now);
  const [view, setView] = useState('main');
  const [form, setForm] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const groups = useMemo(() => groupTasks(tasks, today, settings.showCompletedToday), [tasks, today, settings.showCompletedToday]);

  const reorders = { daily: useReorder('daily', groups.daily), todays: useReorder('todays', groups.todays), later: useReorder('later', groups.later) };
  const item = (group) => (t, i) => html`<${TaskItem} key=${t.id} task=${t} today=${today} index=${i} reorder=${reorders[group]}
    onEdit=${(x) => setForm({ task: x })}
    onDelete=${(x) => (x.subtasks && x.subtasks.length) || x.daily ? setConfirmDel(x) : deleteTask(x.id)} />`;
  const sections = [
    ['매일 할 일', groups.daily, 'daily'],
    ['오늘', groups.todays, 'todays'],
    ['이후', groups.later, 'later'],
  ].filter(([, list]) => list.length);

  return html`<section class="widget w-checklist" aria-labelledby="cl-title">
    <header class="cl-head">
      <h2 class="cl-tab" id="cl-title">CHECKLIST</h2>
      <div class="cl-views" role="tablist" aria-label="체크리스트 보기">
        ${[['main', '진행'], ['done', '완료'], ['month', '월별']].map(([v, label]) => html`<button type="button" role="tab"
          aria-selected=${String(view === v)} class=${cx('cl-view', view === v && 'is-on')} onClick=${() => setView(v)}>${label}</button>`)}
      </div>
    </header>
    <div class="cl-panel" role="tabpanel" aria-labelledby="cl-title">
      <div class="cl-scroll">
        ${view === 'main' && (sections.length ? sections.map(([title, list, group], i) => html`
          ${i > 0 && html`<hr class="cl-sep" />`}
          <h3 class="sr-only">${title}</h3>
          <ul class="task-list" aria-label=${title}>${list.map(item(group))}</ul>`) : html`<p class="empty">할 일을 추가해 보세요.</p>`)}
        ${view === 'done' && html`<${DoneView} tasks=${tasks} today=${today} />`}
        ${view === 'month' && html`<${MonthView} tasks=${tasks} today=${today} />`}
      </div>
      <button type="button" class="cl-add" onClick=${() => setForm({ task: null })}>+ 할 일 추가</button>
    </div>
    ${form && html`<${TaskForm} task=${form.task} today=${today} onClose=${() => setForm(null)} />`}
    ${confirmDel && html`<${Confirm} title="체크리스트 삭제" danger confirmLabel="삭제" message=${`'${confirmDel.text}' 항목을 삭제할까요?`}
      onConfirm=${() => { deleteTask(confirmDel.id); setConfirmDel(null); }} onCancel=${() => setConfirmDel(null)} />`}
  </section>`;
}
