// 일정 반복 규칙 전개
// kind: 'single'(단기) | 'range'(장기) | 'repeat'(반복) | 'anniversary'(기념일)
import { addDays, diffDays, dow, parse, weekStartOf, WEEK_KO, fmtDate, ddayLabel } from './date.js';

export const KIND_LABEL = { single: '단기 일정', range: '장기 일정', repeat: '반복 일정', anniversary: '기념일' };
export const FREQ_LABEL = { daily: '매일', weekly: '매주', biweekly: '격주', monthly: '매월', yearly: '매년' };

function sameMonthDay(a, b) {
  return a.slice(5) === b.slice(5);
}

/** 해당 날짜가 반복 일정의 발생일인지 */
function repeatMatches(ev, date) {
  const r = ev.repeat || {};
  if (date < ev.start) return false;
  if (r.until && date > r.until) return false;
  switch (r.freq) {
    case 'daily':
      return true;
    case 'weekly':
      return (r.days && r.days.length ? r.days : [dow(ev.start)]).includes(dow(date));
    case 'biweekly': {
      const days = r.days && r.days.length ? r.days : [dow(ev.start)];
      if (!days.includes(dow(date))) return false;
      const weeks = diffDays(weekStartOf(ev.start), weekStartOf(date)) / 7;
      return weeks % 2 === 0;
    }
    case 'monthly':
      return parse(date).getDate() === parse(ev.start).getDate();
    case 'yearly':
      return sameMonthDay(date, ev.start);
    default:
      return false;
  }
}

/** 이벤트의 [from, to] 구간 발생 목록: { ev, start, end, key } */
export function expand(ev, from, to) {
  const out = [];
  const ex = new Set(ev.exdates || []);
  const push = (start, end) => {
    if (ex.has(start)) return;
    out.push({ ev, start, end, key: `${ev.id}@${start}` });
  };
  if (ev.kind === 'single') {
    if (ev.start >= from && ev.start <= to) push(ev.start, ev.start);
  } else if (ev.kind === 'range') {
    const end = ev.end && ev.end >= ev.start ? ev.end : ev.start;
    if (ev.start <= to && end >= from) push(ev.start, end);
  } else if (ev.kind === 'repeat') {
    let d = ev.start > from ? ev.start : from;
    const last = ev.repeat && ev.repeat.until && ev.repeat.until < to ? ev.repeat.until : to;
    for (; d <= last; d = addDays(d, 1)) if (repeatMatches(ev, d)) push(d, d);
  } else if (ev.kind === 'anniversary') {
    if (ev.yearly === false) {
      if (ev.start >= from && ev.start <= to) push(ev.start, ev.start);
    } else {
      const fy = +from.slice(0, 4);
      const ty = +to.slice(0, 4);
      for (let y = fy; y <= ty; y++) {
        const d = `${y}${ev.start.slice(4)}`;
        if (d >= ev.start && d >= from && d <= to && parse(d).getMonth() === +ev.start.slice(5, 7) - 1) push(d, d);
      }
    }
  }
  return out;
}

export function occurrences(events, from, to, hiddenCategories = []) {
  const hidden = new Set(hiddenCategories);
  const list = [];
  for (const ev of events) {
    if (ev.categoryId && hidden.has(ev.categoryId)) continue;
    list.push(...expand(ev, from, to));
  }
  return list.sort(compareOcc);
}

export function compareOcc(a, b) {
  const la = diffDays(a.start, a.end);
  const lb = diffDays(b.start, b.end);
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (la !== lb) return lb - la;
  const ta = a.ev.allDay === false ? a.ev.startTime || '' : '';
  const tb = b.ev.allDay === false ? b.ev.startTime || '' : '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (a.ev.title || '').localeCompare(b.ev.title || '');
}

export function whenParts(ev, occStart) {
  const timed = ev.kind === 'single' || ev.kind === 'repeat';
  const time = !timed ? '' : ev.allDay === false && ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : '종일';
  switch (ev.kind) {
    case 'range':
      return { date: `${fmtDate(ev.start)} – ${fmtDate(ev.end || ev.start)}`, time };
    case 'repeat': {
      const r = ev.repeat || {};
      const days = (r.freq === 'weekly' || r.freq === 'biweekly') && r.days && r.days.length
        ? ` ${r.days.slice().sort().map((d) => WEEK_KO[d]).join('·')}요일` : '';
      const date = `${fmtDate(ev.start, { week: false })} ~ ${r.until ? fmtDate(r.until, { week: false }) : '계속'}`;
      return { rule: `${FREQ_LABEL[r.freq] || ''}${days}`, date, time };
    }
    case 'anniversary':
      return { date: `${fmtDate(occStart || ev.start)}${ev.yearly === false ? '' : ' · 매년'}`, time };
    default:
      return { date: fmtDate(ev.start), time };
  }
}

/** D-day 계산: 기념일 'until' 모드는 다음 기념일까지, 'since' 는 시작일부터 경과일 */
export function ddayOf(ev, today) {
  const mode = ev.ddayMode || 'until';
  if (mode === 'since') {
    const n = diffDays(ev.start, today);
    const count = ev.ddayCountFirst ? n + 1 : n;
    return { target: ev.start, diff: -n, label: ev.ddayCountFirst ? `${count}일째` : ddayLabel(-n), count };
  }
  let target = ev.start;
  if (ev.kind === 'anniversary' && ev.yearly !== false && target < today) {
    const y = +today.slice(0, 4);
    target = `${y}${ev.start.slice(4)}`;
    if (target < today) target = `${y + 1}${ev.start.slice(4)}`;
  } else if (ev.kind === 'repeat') {
    // 다음 발생일
    const next = expand(ev, today, addDays(today, 400))[0];
    if (next) target = next.start;
  }
  const diff = diffDays(today, target);
  return { target, diff, label: ddayLabel(diff) };
}
