// 용돈기입장: 지출 · 수입 · 저축 / 날짜 · 금액 · 쓰임새 · 결제 수단(카드 · 체크 · 현금/페이). 달마다 합계와 수단별 지출을 보여준다.
// 하루 합계(저축 제외)는 캘린더 날짜 칸에도 표시된다 (설정 · 위젯에서 끄기). '연간' 버튼으로 한 해 합계 화면으로 넘어간다.
import { html, useState, useMemo, useRef, useEffect, cx } from '../lib.js';
import { useApp } from '../store.js';
import { saveLedgerEntry, addLedgerEntries, deleteLedgerEntry, setSetting } from '../actions.js';
import { todayStr, addMonths, parse, pad, WEEK_KO } from '../util/date.js';
import { Popup, popoverPlacement } from './Popup.js';
import { Field, Segmented } from './controls.js';
import { Icon, IconButton } from './icons.js';

const METHODS = [
  { value: 'card', label: '카드' },
  { value: 'check', label: '체크' },
  { value: 'cash', label: '현금/페이' },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));
const TYPES = [
  { value: 'out', label: '지출' },
  { value: 'in', label: '수입' },
  { value: 'save', label: '저축' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));
const PLACEHOLDER = { out: '예) 점심, 교통비', in: '예) 용돈, 알바비', save: '예) 적금, 비상금' };
const won = (n) => n.toLocaleString('ko-KR');
const MAX_AMOUNT = 9999999999;
const toAmount = (s) => Math.min(MAX_AMOUNT, +s.replace(/[^\d]/g, '') || 0);

/** 기록 목록 합계: 수입 · 지출 · 저축 + 결제 수단별 지출 */
function sumOf(list) {
  const sum = { in: 0, out: 0, save: 0, card: 0, check: 0, cash: 0 };
  for (const x of list) {
    if (x.type === 'in') sum.in += x.amount;
    else if (x.type === 'save') sum.save += x.amount;
    else {
      sum.out += x.amount;
      sum[x.method] = (sum[x.method] || 0) + x.amount;
    }
  }
  return sum;
}

/** 기록 수정 (하나) */
function EntryForm({ entry, placement, onClose }) {
  const [f, setF] = useState(entry);
  const [error, setError] = useState('');
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  function submit(e) {
    e.preventDefault();
    if (!f.amount) return setError('금액을 입력해 주세요.');
    if (!f.date) return setError('날짜를 골라 주세요.');
    saveLedgerEntry({ ...f, memo: f.memo.trim() });
    onClose();
  }

  return html`<${Popup} title="기록 수정" onClose=${onClose} popover=${placement} size="sm" backdropClose=${false}
    footer=${html`<button type="button" class="btn btn-danger-ghost" onClick=${() => { deleteLedgerEntry(entry.id); onClose(); }}>
        <${Icon} name="trash" size=${14} /> 삭제</button><span class="foot-space"></span>
      <button type="button" class="btn" onClick=${onClose}>취소</button>
      <button type="submit" form="lg-form" class="btn btn-primary">저장</button>`}>
    <form id="lg-form" class="lg-form" onSubmit=${submit} noValidate>
      <${Segmented} label="구분" value=${f.type} onChange=${(type) => set({ type })} options=${TYPES} />
      <${Field} label="날짜">${(id) => html`<input id=${id} type="date" class="input num" value=${f.date}
        onInput=${(e) => set({ date: e.currentTarget.value })} />`}<//>
      <${Field} label="금액 (원)">${(id) => html`<input id=${id} class="input num lg-amount" inputmode="numeric" autocomplete="off"
        value=${f.amount ? won(f.amount) : ''} placeholder="0" data-autofocus
        onInput=${(e) => {
          const n = toAmount(e.currentTarget.value);
          set({ amount: n });
          e.currentTarget.value = n ? won(n) : '';
        }} />`}<//>
      <${Field} label="쓰임새">${(id) => html`<input id=${id} class="input" maxlength="40" value=${f.memo} placeholder=${PLACEHOLDER[f.type]}
        onInput=${(e) => set({ memo: e.currentTarget.value })} />`}<//>
      ${f.type === 'out' && html`<${Segmented} label="결제 수단" value=${f.method} onChange=${(method) => set({ method })} options=${METHODS} />`}
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
    </form>
  <//>`;
}

/** 기록 추가: 한 날짜에 여러 항목을 줄마다 적어 한 번에 등록 (새 줄은 윗줄의 구분 · 결제 수단을 따라간다) */
function MultiEntryForm({ date: initialDate, placement, onClose }) {
  const seq = useRef(0);
  const row = (prev) => ({ key: ++seq.current, type: prev ? prev.type : 'out', amount: 0, memo: '', method: prev ? prev.method : 'card' });
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState(() => [row()]);
  const [error, setError] = useState('');
  const listRef = useRef(null);
  const setRow = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addRow() {
    setRows((list) => [...list, row(list[list.length - 1])]);
    setTimeout(() => {
      const inputs = listRef.current && listRef.current.querySelectorAll('.lg-amount');
      if (inputs && inputs.length) inputs[inputs.length - 1].focus();
    }, 0);
  }
  const removeRow = (key) => setRows((list) => (list.length > 1 ? list.filter((r) => r.key !== key) : [row()]));

  function submit(e) {
    e.preventDefault();
    if (!date) return setError('날짜를 골라 주세요.');
    const filled = rows.filter((r) => r.amount || r.memo.trim());
    const missing = rows.findIndex((r) => !r.amount && r.memo.trim());
    if (missing >= 0) return setError(`${missing + 1}번째 항목의 금액을 입력해 주세요.`);
    if (!filled.length) return setError('금액을 입력해 주세요.');
    addLedgerEntries(filled.map(({ key, ...r }) => ({ ...r, date, memo: r.memo.trim() })));
    onClose();
  }

  const total = sumOf(rows);
  const count = rows.filter((r) => r.amount).length;

  return html`<${Popup} title="기록 추가" onClose=${onClose} popover=${placement} size="md" backdropClose=${false}
    footer=${html`<span class="lg-mtotal num">${count ? `${count}개 · 지출 ${won(total.out)}${total.in ? ` · 수입 ${won(total.in)}` : ''}${total.save ? ` · 저축 ${won(total.save)}` : ''}` : ''}</span>
      <span class="foot-space"></span>
      <button type="button" class="btn" onClick=${onClose}>취소</button>
      <button type="submit" form="lg-form" class="btn btn-primary">${count > 1 ? `${count}개 추가` : '추가'}</button>`}>
    <form id="lg-form" class="lg-form" onSubmit=${submit} noValidate>
      <${Field} label="날짜">${(id) => html`<input id=${id} type="date" class="input num" value=${date}
        onInput=${(e) => setDate(e.currentTarget.value)} />`}<//>
      <div class="lg-multi">
        <div class="lg-mrow lg-mhead" aria-hidden="true"><span>구분</span><span>금액 (원)</span><span>쓰임새</span><span>결제 수단</span><span></span></div>
        <ol class="lg-mlist" ref=${listRef}>
          ${rows.map((r, i) => html`<li class="lg-mrow" key=${r.key}>
            <select class="input input-sm lg-mtype" aria-label=${`${i + 1}번째 구분`} value=${r.type} onChange=${(e) => setRow(r.key, { type: e.currentTarget.value })}>
              ${TYPES.map((t) => html`<option value=${t.value}>${t.label}</option>`)}
            </select>
            <input class="input input-sm num lg-amount" inputmode="numeric" autocomplete="off" aria-label=${`${i + 1}번째 금액 (원)`}
              value=${r.amount ? won(r.amount) : ''} placeholder="0" data-autofocus=${i === 0 ? '' : undefined}
              onInput=${(e) => {
                const n = toAmount(e.currentTarget.value);
                setRow(r.key, { amount: n });
                e.currentTarget.value = n ? won(n) : '';
              }} />
            <input class="input input-sm lg-mmemo" maxlength="40" aria-label=${`${i + 1}번째 쓰임새`} value=${r.memo} placeholder=${PLACEHOLDER[r.type]}
              onInput=${(e) => setRow(r.key, { memo: e.currentTarget.value })} />
            ${r.type !== 'out' ? html`<span class="lg-mmethod lg-mnone muted" aria-hidden="true">—</span>`
              : html`<select class="input input-sm lg-mmethod" aria-label=${`${i + 1}번째 결제 수단`} value=${r.method} onChange=${(e) => setRow(r.key, { method: e.currentTarget.value })}>
                ${METHODS.map((m) => html`<option value=${m.value}>${m.label}</option>`)}
              </select>`}
            <${IconButton} icon="x" size=${14} label=${`${i + 1}번째 항목 빼기`} className="lg-mdel" onClick=${() => removeRow(r.key)} />
          </li>`)}
        </ol>
        <button type="button" class="btn btn-ghost btn-sm lg-madd" onClick=${addRow}><${Icon} name="plus" size=${14} /> 항목 추가</button>
      </div>
      ${error && html`<p class="form-error" role="alert">${error}</p>`}
    </form>
  <//>`;
}

/** 연간 합계: 한 해 지출 · 저축 총액과 달별 내역 (달을 누르면 그 달 화면으로) */
function YearView({ ledger, year, today, onPickMonth }) {
  const data = useMemo(() => {
    const list = (ledger || []).filter((x) => x.date.startsWith(year + '-'));
    const months = Array.from({ length: 12 }, (_, m) => sumOf(list.filter((x) => +x.date.slice(5, 7) === m + 1)));
    return { sum: sumOf(list), months, max: Math.max(1, ...months.map((s) => s.out)) };
  }, [ledger, year]);
  const { sum, months, max } = data;
  const thisKey = today.slice(0, 7);
  const listRef = useRef(null);
  // 위젯이 작아 열두 달이 다 안 보이면 이번 달이 보이게 스크롤
  useEffect(() => {
    const now = listRef.current && listRef.current.querySelector('.is-now');
    if (now) now.scrollIntoView({ block: 'nearest' });
  }, [year]);

  return html`<div class="lg-year">
    <div class="lg-sum">
      <div class="lg-year-totals">
        <p class="lg-total"><span class="lg-total-label">지출</span><strong class="num">${won(sum.out)}</strong><span class="lg-unit">원</span></p>
        <p class="lg-total is-save"><span class="lg-total-label">저축</span><strong class="num">${won(sum.save)}</strong><span class="lg-unit">원</span></p>
      </div>
      <p class="lg-sub num">수입 ${won(sum.in)}</p>
      <div class="lg-methods" aria-label="결제 수단별 지출">
        ${METHODS.map((m) => html`<p class=${cx('lg-method', 'm-' + m.value)}>
          <span class="lg-method-name">${m.label}</span><span class="num">${won(sum[m.value] || 0)}</span>
        </p>`)}
      </div>
    </div>
    <div class="lg-mon-head" aria-hidden="true"><span>월</span><span></span><span>지출</span><span>저축</span></div>
    <ul class="lg-months" ref=${listRef}>
      ${months.map((s, m) => {
        const key = `${year}-${pad(m + 1)}`;
        const empty = !s.out && !s.save && !s.in;
        return html`<li key=${m}><button type="button" class=${cx('lg-mon-row', key === thisKey && 'is-now', empty && 'is-empty')} onClick=${() => onPickMonth(m)}
            aria-label=${`${m + 1}월 지출 ${won(s.out)}원, 저축 ${won(s.save)}원. 눌러서 이 달 보기`}>
          <span class="lg-mon-name num">${m + 1}월</span>
          <span class="lg-mon-bar" aria-hidden="true"><span style=${{ width: (s.out / max) * 100 + '%' }}></span></span>
          <span class="lg-mon-out num">${s.out ? won(s.out) : '—'}</span>
          <span class="lg-mon-save num">${s.save ? won(s.save) : '—'}</span>
        </button></li>`;
      })}
    </ul>
  </div>`;
}

export function Ledger() {
  const { ledger, settings } = useApp();
  const today = todayStr();
  const [view, setView] = useState('month'); // month · year
  const [ym, setYm] = useState(() => ({ year: +today.slice(0, 4), month: +today.slice(5, 7) - 1 }));
  const [filter, setFilter] = useState(null); // 결제 수단 거르기
  const [form, setForm] = useState(null); // { entry?, date, placement, n }
  const ref = useRef(null);
  const key = `${ym.year}-${pad(ym.month + 1)}`;
  const isThisMonth = today.startsWith(key);
  const thisYear = +today.slice(0, 4);

  const month = useMemo(() => {
    const list = (ledger || []).filter((x) => x.date.startsWith(key));
    // 날짜별로 묶어 최근 날짜가 위로 (같은 날은 적은 순서대로)
    const days = new Map();
    list.filter((x) => !filter || (x.type === 'out' && x.method === filter))
      .sort((a, b) => b.date.localeCompare(a.date) || (a.createdAt || 0) - (b.createdAt || 0))
      .forEach((x) => {
        if (!days.has(x.date)) days.set(x.date, []);
        days.get(x.date).push(x);
      });
    return { sum: sumOf(list), days: [...days], count: list.length };
  }, [ledger, key, filter]);

  function open(entry) {
    // 위젯이 작으면 옆에, 넉넉하면 위젯 안에 띄운다 (여러 줄 추가 창은 더 넓게)
    // n: 열 때마다 새 폼 (열린 채로 다시 눌러도 이전 입력이 남지 않게)
    const placement = entry ? popoverPlacement(ref.current, 20, 22) : popoverPlacement(ref.current, 30, 22);
    setForm((v) => ({ entry, date: isThisMonth ? today : `${key}-01`, placement, n: (v ? v.n : 0) + 1 }));
  }
  const go = (n) => (view === 'year' ? setYm((v) => ({ ...v, year: v.year + n })) : setYm((v) => addMonths(v.year, v.month, n)));
  const onCalendar = settings.ledgerOnCalendar !== false;

  return html`<section class=${cx('widget w-ledger', 'lg-view-' + view)} aria-labelledby="lg-title" ref=${ref}>
    <header class="lg-head">
      <h2 class="w-title" id="lg-title">용돈기입장</h2>
      <div class="lg-nav">
        <${IconButton} icon="chev-left" label=${view === 'year' ? '이전 해' : '이전 달'} onClick=${() => go(-1)} />
        ${view === 'year'
          ? html`<button type="button" class="lg-month num" onClick=${() => setYm((v) => ({ ...v, year: thisYear }))}
              title="올해로" aria-label=${`${ym.year}년. 눌러서 올해로`}>${ym.year}</button>`
          : html`<button type="button" class="lg-month num" onClick=${() => setYm({ year: thisYear, month: +today.slice(5, 7) - 1 })}
              title="이번 달로" aria-label=${`${ym.year}년 ${ym.month + 1}월. 눌러서 이번 달로`}>${ym.year}.${pad(ym.month + 1)}</button>`}
        <${IconButton} icon="chev-right" label=${view === 'year' ? '다음 해' : '다음 달'} onClick=${() => go(1)} />
      </div>
      ${view === 'year'
        ? html`<div class="lg-tools"><${IconButton} icon="back" label="달별 화면으로 돌아가기" className="lg-tool lg-view-btn" onClick=${() => setView('month')} /></div>`
        : html`<div class="lg-tools">
          <${IconButton} icon="chart" label="연간 합계 보기" className="lg-tool" onClick=${() => setView('year')} />
          <${IconButton} icon="calendar" label=${onCalendar ? '캘린더에 하루 합계 숨기기' : '캘린더에 하루 합계 표시'}
            className="lg-tool lg-cal-toggle" pressed=${onCalendar} onClick=${() => setSetting('ledgerOnCalendar', !onCalendar)} />
          <${IconButton} icon="plus" label="기록 추가" className="lg-tool lg-add" onClick=${() => open(null)} />
        </div>`}
    </header>

    ${view === 'year' ? html`<${YearView} ledger=${ledger} year=${ym.year} today=${today}
      onPickMonth=${(m) => { setYm({ year: ym.year, month: m }); setView('month'); }} />` : html`
    <div class="lg-sum">
      <div class="lg-sum-row">
        <p class="lg-total"><span class="lg-total-label">지출</span><strong class="num">${won(month.sum.out)}</strong><span class="lg-unit">원</span></p>
        <p class="lg-sub num">수입 ${won(month.sum.in)}${month.sum.save > 0 && ` · 저축 ${won(month.sum.save)}`}</p>
      </div>
      <div class="lg-methods" role="group" aria-label="결제 수단별 지출 (눌러서 거르기)">
        ${METHODS.map((m) => html`<button type="button" class=${cx('lg-method', 'm-' + m.value, filter === m.value && 'is-on')} aria-pressed=${String(filter === m.value)}
            onClick=${() => setFilter(filter === m.value ? null : m.value)}>
          <span class="lg-method-name">${m.label}</span><span class="num">${won(month.sum[m.value] || 0)}</span>
        </button>`)}
      </div>
    </div>

    <ul class="lg-days">
      ${month.days.map(([date, list]) => {
        const net = list.reduce((n, x) => n + (x.type === 'in' ? x.amount : -x.amount), 0);
        const d = parse(date);
        return html`<li class="lg-day" key=${date}>
          <p class=${cx('lg-day-head', date === today && 'is-today')}>
            <span class="num">${d.getMonth() + 1}.${d.getDate()}</span> <span class="lg-dow">${WEEK_KO[d.getDay()]}</span>
            <span class=${cx('lg-day-sum num', net > 0 && 'is-plus')}>${net > 0 ? '+' : net < 0 ? '−' : ''}${won(Math.abs(net))}</span>
          </p>
          <ul>
            ${list.map((x) => html`<li key=${x.id}><button type="button" class="lg-row" onClick=${() => open(x)}
                aria-label=${`${x.memo || '쓰임새 없음'}, ${x.type === 'out' ? METHOD_LABEL[x.method] + ', ' : ''}${TYPE_LABEL[x.type]} ${won(x.amount)}원. 눌러서 수정`}>
              <span class=${cx('lg-badge', x.type === 'out' ? 'm-' + x.method : 'm-' + x.type)}>${x.type === 'out' ? METHOD_LABEL[x.method] : TYPE_LABEL[x.type]}</span>
              <span class="lg-memo">${x.memo || html`<span class="muted">—</span>`}</span>
              <span class=${cx('lg-amt num', x.type === 'in' && 'is-plus')}>${x.type === 'in' ? '+' : '−'}${won(x.amount)}</span>
            </button></li>`)}
          </ul>
        </li>`;
      })}
      ${!month.days.length && html`<li class="lg-empty">${filter ? `${METHOD_LABEL[filter]} 지출이 없습니다.` : html`<button type="button" class="lg-empty-btn" onClick=${() => open(null)}>
        ${isThisMonth ? '오늘 쓴 돈을 적어 보세요 +' : '이 달의 기록이 없습니다 +'}</button>`}</li>`}
    </ul>`}
    ${form && (form.entry
      ? html`<${EntryForm} key=${form.n} entry=${form.entry} placement=${form.placement} onClose=${() => setForm(null)} />`
      : html`<${MultiEntryForm} key=${form.n} date=${form.date} placement=${form.placement} onClose=${() => setForm(null)} />`)}
  </section>`;
}
