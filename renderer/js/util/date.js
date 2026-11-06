// 날짜는 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다룬다.
export const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEK_KO_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
export const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr() {
  return ymd(new Date());
}

export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function addMonths(year, month, n) {
  const d = new Date(year, month + n, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** b - a (일) */
export function diffDays(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export const dow = (s) => parse(s).getDay();

export function weekStartOf(s, weekStart = 0) {
  const d = dow(s);
  return addDays(s, -((d - weekStart + 7) % 7));
}

/** 월 달력 행렬: 주 단위 배열 (필요한 만큼 4~6주) */
export function monthMatrix(year, month, weekStart = 0) {
  const first = ymd(new Date(year, month, 1));
  const last = ymd(new Date(year, month + 1, 0));
  let cur = weekStartOf(first, weekStart);
  const weeks = [];
  while (cur <= last) {
    const week = [];
    for (let i = 0; i < 7; i++) week.push(addDays(cur, i));
    weeks.push(week);
    cur = addDays(cur, 7);
  }
  return weeks;
}

export function fmtDate(s, { year = true, week = true } = {}) {
  if (!s) return '';
  const d = parse(s);
  const base = year ? `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : `${d.getMonth() + 1}.${d.getDate()}`;
  return week ? `${base} (${WEEK_KO[d.getDay()]})` : base;
}

export function fmtKoDate(s) {
  const d = parse(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK_KO_LONG[d.getDay()]}`;
}

export function ddayLabel(diff) {
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

export function monthKey(s) {
  return s.slice(0, 7);
}
