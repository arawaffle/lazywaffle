// 오늘의 일정 전광판: 캘린더에 등록된 오늘 일정이 늘 흘러간다(일정이 없으면 멈춘 안내 문구). 밤 11시부터는 내일 일정.
// 부하 줄이기: CSS 애니메이션(60fps 로 창 전체를 다시 합성)을 쓰지 않고 초당 12번 정수 픽셀만큼 옮긴다.
// 옮기는 건 자체 레이어(will-change)의 transform 뿐이라 글자를 다시 그리지 않고, 화면이 가려졌거나
// 창이 숨겨졌거나 마우스를 올리면 아예 움직이지 않는다.
import { html, useMemo, useRef, useEffect, useNow, useSize, bus, cx } from '../lib.js';
import { useApp } from '../store.js';
import { ymd, diffDays, addDays } from '../util/date.js';
import { occurrences } from '../util/recur.js';

const TOMORROW_FROM_HOUR = 23;
const FPS = 12;

function label(o, day) {
  const ev = o.ev;
  const time = ev.allDay === false && ev.startTime ? `${ev.startTime} ` : '';
  const span = o.end !== o.start ? ` (${diffDays(o.start, day) + 1}/${diffDays(o.start, o.end) + 1}일차)` : '';
  return `${time}${ev.title}${span}`;
}

export function Ticker() {
  const { events, settings } = useApp();
  const now = useNow(60000);
  const tomorrow = now.getHours() >= TOMORROW_FROM_HOUR;
  const day = tomorrow ? addDays(ymd(now), 1) : ymd(now);
  const title = tomorrow ? '내일의 일정' : '오늘의 일정';
  const occs = useMemo(() => occurrences(events, day, day, settings.hiddenCategories), [events, day, settings.hiddenCategories]);
  const trackRef = useRef(null);
  const boxRef = useRef(null);
  const firstRef = useRef(null);
  const paused = useRef(false);
  const { width: boxW } = useSize(boxRef);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scroll = occs.length > 0 && !reduced; // 일정이 있으면 내용이 칸에 다 들어가도 흐른다

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
  }, [scroll, occs, boxW, settings.tickerSpeed]);

  const items = occs.length ? occs : null;
  const renderItems = (hidden) => (items
    ? items.map((o) => html`<button type="button" class="tick-item" tabindex=${hidden ? -1 : 0} aria-hidden=${hidden ? 'true' : undefined}
        onClick=${() => bus.emit('calendar:open', { type: 'detail', eventId: o.ev.id, date: o.start })}>${label(o, day)}</button>`)
    : html`<span class="tick-item is-empty">${tomorrow ? '내일' : '오늘'} 등록된 일정이 없습니다.</span>`);
  const hold = (v) => () => (paused.current = v);

  return html`<section class="widget w-ticker" aria-labelledby="ticker-title"
      onPointerEnter=${hold(true)} onPointerLeave=${hold(false)} onFocusIn=${hold(true)} onFocusOut=${hold(false)}>
    <h2 class="ticker-label" id="ticker-title">${title}</h2>
    <div class=${cx('ticker-box', items && 'is-scrolling')} ref=${boxRef}>
      <div class=${cx('ticker-track', scroll && 'is-moving')} ref=${trackRef}>
        <div class="ticker-seq" ref=${firstRef}>${renderItems(false)}</div>
        ${items && scroll && html`<div class="ticker-seq" aria-hidden="true">${renderItems(true)}</div>`}
      </div>
    </div>
  </section>`;
}
