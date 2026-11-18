// 전광판: 오늘의 일정 + 이번 주 · 이번 달 목표. 내용이 늘 흘러간다(없으면 멈춘 안내 문구).
// 오늘의 일정은 캘린더에 등록된 일정(밤 11시부터는 내일 일정), 목표는 전광판에서 바로 적는다.
// 부하 줄이기: CSS 애니메이션(60fps 로 창 전체를 다시 합성)을 쓰지 않고 초당 12번 정수 픽셀만큼 옮긴다.
// 옮기는 건 자체 레이어(will-change)의 transform 뿐이라 글자를 다시 그리지 않고, 화면이 가려졌거나
// 창이 숨겨졌거나 마우스를 올리면 아예 움직이지 않는다.
import { html, useState, useMemo, useRef, useEffect, useNow, useSize, bus, cx } from '../lib.js';
import { useApp } from '../store.js';
import { addGoal, deleteGoal, setTickerColor } from '../actions.js';
import { ymd, diffDays, addDays, goalPeriod } from '../util/date.js';
import { occurrences } from '../util/recur.js';
import { textOn, extractPalette, EVENT_COLORS } from '../util/color.js';
import { Popup, popoverPlacement } from './Popup.js';
import { ColorPicker } from './controls.js';
import { Icon, IconButton } from './icons.js';

const TOMORROW_FROM_HOUR = 23;
const FPS = 12;
const TICKER_COLORS = ['#000000', '#2b2b2b', '#ffffff', ...EVENT_COLORS.slice(0, 8)];
const GOALS = {
  week: { id: 'goalWeek', title: '이번 주 목표', empty: '이번 주 목표를 적어 보세요 +' },
  month: { id: 'goalMonth', title: '이번 달 목표', empty: '이번 달 목표를 적어 보세요 +' },
};

function label(o, day) {
  const ev = o.ev;
  const time = ev.allDay === false && ev.startTime ? `${ev.startTime} ` : '';
  const span = o.end !== o.start ? ` (${diffDays(o.start, day) + 1}/${diffDays(o.start, o.end) + 1}일차)` : '';
  return `${time}${ev.title}${span}`;
}

/** 전광판 배경색: 고른 색 + 배너 이미지에서 뽑은 추천 색. 글자색은 배경에 맞춰 자동(흰색 · 검정) */
function TickerColor({ id }) {
  const { settings } = useApp();
  const value = (settings.tickerColors || {})[id] || null;
  const fill = settings.banner.fill;
  const image = fill.type === 'image' ? fill.image : null;
  const [palette, setPalette] = useState([]);
  useEffect(() => {
    let alive = true;
    setPalette([]);
    if (image) extractPalette(image, 6).then((p) => alive && setPalette(p), () => {});
    return () => {
      alive = false;
    };
  }, [image]);
  return html`<div class="tick-color">
    <${ColorPicker} label="전광판 배경색 (글자색은 자동)" colors=${TICKER_COLORS} value=${value} allowNone noneLabel="기본 색"
      onChange=${(c) => setTickerColor(id, c)} />
    ${palette.length > 0 && html`<div class="field">
      <span class="field-label">배너 이미지 추천 색</span>
      <div class="swatches" role="group" aria-label="배너 이미지 추천 색">
        ${palette.map((c) => html`<button type="button" key=${c} class=${cx('swatch', value === c && 'is-on')} style=${{ background: c }}
          aria-label=${'추천 색 ' + c} aria-pressed=${String(value === c)} onClick=${() => setTickerColor(id, c)}></button>`)}
      </div>
    </div>`}
  </div>`;
}

/**
 * 전광판 한 줄. items: [{ key, text, onClick }] (onClick 이 없으면 설정 창을 연다) · 비어 있으면 empty 문구
 * tool: 오른쪽 끝 버튼 { icon, label } — 누르면 위젯 옆에 설정 창(children + 배경색)이 뜬다. editable: 빈 문구를 눌러도 연다
 */
function Marquee({ id, title, items, empty, editable, tool, children }) {
  const { settings } = useApp();
  const ref = useRef(null);
  const trackRef = useRef(null);
  const boxRef = useRef(null);
  const firstRef = useRef(null);
  const paused = useRef(false);
  const [placement, setPlacement] = useState(null);
  const { width: boxW } = useSize(boxRef);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scroll = items.length > 0 && !reduced; // 내용이 있으면 칸에 다 들어가도 흐른다
  const bg = (settings.tickerColors || {})[id];
  const open = () => setPlacement(popoverPlacement(ref.current, 22));
  const close = () => setPlacement(null);

  useEffect(() => {
    const track = trackRef.current;
    const first = firstRef.current;
    if (!scroll || !track || !first || !boxW) return undefined;
    // 한 묶음을 칸 너비 이상으로 늘려 두 묶음을 이어 붙이면, 한 묶음 너비만큼 간 뒤 0 으로 돌아가도 끊김이 없다
    track.style.setProperty('--box-w', boxW + 'px');
    const loop = first.offsetWidth;
    const step = (settings.tickerSpeed || 50) / FPS;
    let x = 0;
    let shown = -1;
    const timer = setInterval(() => {
      if (paused.current || document.hidden || document.documentElement.classList.contains('is-covered')) return;
      x = (x + step) % loop;
      const px = Math.round(x);
      if (px === shown) return; // 같은 자리면 다시 합성하지 않음
      shown = px;
      track.style.transform = `translate3d(${-px}px, 0, 0)`;
    }, 1000 / FPS);
    return () => {
      clearInterval(timer);
      track.style.transform = '';
    };
  }, [scroll, items, boxW, settings.tickerSpeed]);

  const renderItems = (hidden) => (items.length
    ? items.map((it) => html`<button type="button" key=${it.key} class="tick-item" tabindex=${hidden ? -1 : 0} aria-hidden=${hidden ? 'true' : undefined}
        onClick=${it.onClick || open}>${it.text}</button>`)
    : editable
      ? html`<button type="button" class="tick-item is-empty" onClick=${open}>${empty}</button>`
      : html`<span class="tick-item is-empty">${empty}</span>`);
  const hold = (v) => () => (paused.current = v);
  const titleId = 'ticker-title-' + id;

  return html`<section ref=${ref} class="widget w-ticker" aria-labelledby=${titleId}
      style=${bg ? { '--ticker-bg': bg, '--ticker-fg': textOn(bg) } : null}
      onPointerEnter=${hold(true)} onPointerLeave=${hold(false)} onFocusIn=${hold(true)} onFocusOut=${hold(false)}>
    <h2 class="ticker-label" id=${titleId}>${title}</h2>
    <div class=${cx('ticker-box', items.length > 0 && 'is-scrolling')} ref=${boxRef}>
      <div class=${cx('ticker-track', scroll && 'is-moving')} ref=${trackRef}>
        <div class="ticker-seq" ref=${firstRef}>${renderItems(false)}</div>
        ${scroll && html`<div class="ticker-seq" aria-hidden="true">${renderItems(true)}</div>`}
      </div>
    </div>
    <${IconButton} icon=${tool.icon} size=${13} label=${tool.label} className="ticker-tool" onClick=${open} aria-expanded=${String(!!placement)} />
    ${placement && html`<${Popup} title=${title} onClose=${close} popover=${placement} className="tick-popup"
        footer=${html`<button type="button" class="btn btn-sm btn-primary" onClick=${close}>완료</button>`}>
      ${children}
      <${TickerColor} id=${id} />
    <//>`}
  </section>`;
}

export function Ticker() {
  const { events, settings } = useApp();
  const now = useNow(60000);
  const tomorrow = now.getHours() >= TOMORROW_FROM_HOUR;
  const day = tomorrow ? addDays(ymd(now), 1) : ymd(now);
  const items = useMemo(() => occurrences(events, day, day, settings.hiddenCategories).map((o) => ({
    key: o.key,
    text: label(o, day),
    onClick: () => bus.emit('calendar:open', { type: 'detail', eventId: o.ev.id, date: o.start }),
  })), [events, day, settings.hiddenCategories]);
  return html`<${Marquee} id="ticker" title=${tomorrow ? '내일의 일정' : '오늘의 일정'} items=${items}
    empty=${`${tomorrow ? '내일' : '오늘'} 등록된 일정이 없습니다.`} tool=${{ icon: 'palette', label: '전광판 배경색' }} />`;
}

/** 이번 주 · 이번 달 목표 전광판: 목표는 위젯에서 바로 적고, 주 · 달이 바뀌면 지난 목표는 사라진다 */
function GoalTicker({ scope }) {
  const { goals, settings } = useApp();
  const today = ymd(useNow(60000));
  const { id, title, empty } = GOALS[scope];
  const period = goalPeriod(scope, today, settings.weekStart);
  const list = useMemo(() => (goals || []).filter((g) => g.scope === scope && goalPeriod(scope, g.date, settings.weekStart) === period),
    [goals, scope, period, settings.weekStart]);
  const items = useMemo(() => list.map((g) => ({ key: g.id, text: g.text })), [list]);
  const [text, setText] = useState('');

  function add(e) {
    e.preventDefault();
    if (!text.trim()) return;
    addGoal(scope, text);
    setText('');
  }

  return html`<${Marquee} id=${id} title=${title} items=${items} empty=${empty} editable
      tool=${{ icon: 'edit', label: `${title} 추가 · 배경색` }}>
    <form class="goal-form" onSubmit=${add}>
      <label class="sr-only" for=${'goal-new-' + scope}>목표 내용</label>
      <input id=${'goal-new-' + scope} class="input input-sm" value=${text} maxlength="60" placeholder="목표 내용" data-autofocus
        onInput=${(e) => setText(e.currentTarget.value)} />
      <button type="submit" class="btn btn-primary btn-sm"><${Icon} name="plus" size=${14} /> 목표 추가</button>
    </form>
    ${list.length > 0 && html`<ul class="goal-list">
      ${list.map((g) => html`<li key=${g.id}>
        <span class="goal-text">${g.text}</span>
        <${IconButton} icon="x" size=${13} label=${g.text + ' 삭제'} onClick=${() => deleteGoal(g.id)} />
      </li>`)}
    </ul>`}
  <//>`;
}

export const GoalWeek = () => html`<${GoalTicker} scope="week" />`;
export const GoalMonth = () => html`<${GoalTicker} scope="month" />`;
