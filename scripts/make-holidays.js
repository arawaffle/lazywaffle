// 한국 공휴일 표 생성 (빌드 시 1회 실행: npm run holidays)
// - 음력 → 양력 변환은 korean-lunar-calendar(한국천문연구원 데이터)로 이 스크립트에서만 한다.
//   앱에는 결과 표(renderer/js/util/holidays-data.js)만 들어가므로 실행 중 계산·용량 부담이 없다.
// - 대체공휴일: 2014~ 설·추석·어린이날 / 2021~ 삼일절·광복절·개천절·한글날 / 2023~ 부처님오신날·성탄절
// - 임시공휴일·선거일은 미리 알 수 없어서 확정된 것만 EXTRA 에 적는다.
const fs = require('fs');
const path = require('path');
const KoreanLunarCalendar = require('korean-lunar-calendar');

const FROM = 2000;
const TO = 2050;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
};
const dow = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

const cal = new KoreanLunarCalendar();
function lunar(y, m, d) {
  cal.setLunarDate(y, m, d, false);
  const s = cal.getSolarCalendar();
  return `${s.year}-${pad(s.month)}-${pad(s.day)}`;
}

// 확정된 임시공휴일·선거일 (필요하면 여기에 추가)
const EXTRA = {
  '2017-05-09': '대통령선거', '2017-10-02': '임시공휴일',
  '2018-06-13': '지방선거', '2020-04-15': '국회의원선거', '2020-08-17': '임시공휴일',
  '2022-03-09': '대통령선거', '2022-06-01': '지방선거', '2023-10-02': '임시공휴일',
  '2024-04-10': '국회의원선거', '2024-10-01': '임시공휴일',
  '2025-01-27': '임시공휴일', '2025-06-03': '대통령선거',
  '2026-06-03': '지방선거',
};

const table = {};
for (let y = FROM; y <= TO; y++) {
  const days = new Map(); // date -> [name]
  const put = (date, name) => days.set(date, [...(days.get(date) || []), name]);
  const fixed = [['01-01', '신정'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['06-06', '현충일'], ['08-15', '광복절'], ['10-03', '개천절'], ['12-25', '성탄절']];
  if (y >= 2013) fixed.push(['10-09', '한글날']);
  for (const [md, name] of fixed) put(`${y}-${md}`, name);
  const seol = lunar(y, 1, 1);
  const seolDays = [addDays(seol, -1), seol, addDays(seol, 1)];
  seolDays.forEach((d) => put(d, '설날'));
  const buddha = lunar(y, 4, 8);
  put(buddha, '부처님오신날');
  const chu = lunar(y, 8, 15);
  const chuDays = [addDays(chu, -1), chu, addDays(chu, 1)];
  chuDays.forEach((d) => put(d, '추석'));
  for (const [d, name] of Object.entries(EXTRA)) if (d.startsWith(`${y}-`)) put(d, name);

  // 대체공휴일
  const isHoliday = (d) => days.has(d) || dow(d) === 0;
  const subs = [];
  const nextFree = (from) => {
    let d = addDays(from, 1);
    while (isHoliday(d) || dow(d) === 6 || subs.includes(d)) d = addDays(d, 1);
    return d;
  };
  if (y >= 2014) {
    // 설·추석 연휴: 일요일 또는 다른 공휴일과 겹친 날 수만큼
    for (const block of [seolDays, chuDays]) {
      const overlaps = block.filter((d) => dow(d) === 0 || days.get(d).length > 1).length;
      let last = block[block.length - 1];
      for (let i = 0; i < overlaps; i++) {
        last = nextFree(last);
        subs.push(last);
      }
    }
  }
  const handled = new Set(); // 같은 날 여러 공휴일이 겹쳐도 대체공휴일은 하루 (예: 2025-05-05)
  const weekendRule = (date, since) => {
    if (y < since || !days.has(date) || handled.has(date)) return;
    handled.add(date);
    const others = days.get(date).length > 1;
    if (dow(date) === 0 || dow(date) === 6 || others) subs.push(nextFree(date));
  };
  weekendRule(`${y}-05-05`, 2014); // 어린이날
  for (const md of ['03-01', '08-15', '10-03', '10-09']) weekendRule(`${y}-${md}`, 2021);
  weekendRule(buddha, 2023);
  weekendRule(`${y}-12-25`, 2023);
  [...new Set(subs)].forEach((d) => put(d, '대체공휴일'));

  for (const [d, names] of [...days.entries()].sort()) {
    if (!d.startsWith(`${y}-`)) continue; // 설 전날이 전년도에 걸치는 경우는 그 해 표에 포함
    table[d] = [...new Set(names)].join('·');
  }
  // 전년도 12월에 걸친 설 연휴
  for (const d of seolDays) if (!d.startsWith(`${y}-`)) table[d] = '설날';
}

const out = `// 자동 생성 파일: scripts/make-holidays.js (${FROM}~${TO}년, 한국천문연구원 음력 기준)
// 임시공휴일·선거일은 확정된 것만 포함됩니다.
export const HOLIDAYS = ${JSON.stringify(table)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'renderer', 'js', 'util', 'holidays-data.js'), out);
console.log('holidays:', Object.keys(table).length, 'days,', (out.length / 1024).toFixed(1), 'KB');
