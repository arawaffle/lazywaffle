// 앱 상태 + 액션 + 자동 저장
import { createContext, useContext, useEffect, useState, uid } from './lib.js';
import { loadState, saveState } from './storage.js';
import { todayStr, addDays, dow } from './util/date.js';

export const GRID = { cols: 12, rows: 20 };

export const WIDGETS = {
  pomodoro: { name: '뽀모도로 타이머', min: [3, 2] },
  dday: { name: 'D-DAY', min: [2, 2] },
  ticker: { name: '오늘의 일정 전광판', min: [3, 1] },
  calendar: { name: '캘린더', min: [5, 7] },
  checklist: { name: '체크리스트', min: [2, 5] },
  memo: { name: '메모', min: [3, 4] },
  links: { name: '바로가기', min: [1, 2] },
  timetable: { name: '하루 타임테이블', min: [3, 3] },
  ledger: { name: '용돈기입장', min: [3, 4] },
};

export const DEFAULT_LAYOUT = [
  { id: 'pomodoro', x: 0, y: 0, w: 4, h: 2, visible: true },
  { id: 'dday', x: 8, y: 0, w: 4, h: 2, visible: true },
  { id: 'ticker', x: 0, y: 2, w: 12, h: 1, visible: true },
  { id: 'calendar', x: 0, y: 3, w: 8, h: 10, visible: true },
  { id: 'checklist', x: 8, y: 3, w: 4, h: 10, visible: true },
  { id: 'memo', x: 0, y: 13, w: 5, h: 7, visible: true },
  { id: 'links', x: 11, y: 13, w: 1, h: 7, visible: true },
  { id: 'timetable', x: 5, y: 13, w: 6, h: 7, visible: true },
  { id: 'ledger', x: 8, y: 3, w: 4, h: 7, visible: false },
];

/** 배너가 위/아래일 때(가로로 넓은 콘텐츠): 캘린더 · 체크리스트 · 메모를 3열로 */
export const DEFAULT_LAYOUT_WIDE = [
  { id: 'pomodoro', x: 0, y: 0, w: 3, h: 3, visible: true },
  { id: 'ticker', x: 3, y: 0, w: 6, h: 3, visible: true },
  { id: 'dday', x: 9, y: 0, w: 3, h: 3, visible: true },
  { id: 'calendar', x: 0, y: 3, w: 5, h: 17, visible: true },
  { id: 'checklist', x: 5, y: 3, w: 4, h: 11, visible: true },
  { id: 'timetable', x: 5, y: 14, w: 4, h: 6, visible: true },
  { id: 'memo', x: 9, y: 3, w: 3, h: 14, visible: true },
  { id: 'links', x: 9, y: 17, w: 3, h: 3, visible: true },
  { id: 'ledger', x: 5, y: 14, w: 4, h: 6, visible: false },
];

/** 현재 배너 위치에 맞는 레이아웃 키 (배너 위치마다 배치를 따로 기억한다) */
export function layoutKey(settings) {
  return settings.banner.position === 'top' || settings.banner.position === 'bottom' ? 'layoutWide' : 'layout';
}

const DEFAULT_FILL = { type: 'color', color: '#d9d9d9', image: null, fit: 'cover', posX: 50, posY: 50 };

export const DEFAULT_SETTINGS = {
  theme: 'light',
  weekStart: 0,
  banner: { position: 'left', size: 36, fill: { ...DEFAULT_FILL } },
  background: { fill: { ...DEFAULT_FILL, color: '#ffffff' }, panel: 82 },
  mesh: { palette: ['#e9e9e9', '#c9c9c9', '#9d9d9d', '#f7f7f7', '#7a7a7a'], seed: 20261025, animate: false },
  layout: DEFAULT_LAYOUT,
  layoutWide: DEFAULT_LAYOUT_WIDE,
  hiddenCategories: [],
  tickerSpeed: 50,
  linksBg: true,
  calendarView: 'month',
  showHolidays: true,
  linksMode: 'list',
  showCompletedToday: true,
  ddayDirection: 'auto', // D-DAY 나열 방향: auto(위젯 모양에 맞춤) · row · column
  ledgerOnCalendar: true, // 용돈기입장 하루 합계를 캘린더 날짜에 표시
};

/** 타임테이블: 요일 묶음(평일·주말 등)마다 일과 목록. 한 요일은 한 묶음에만 속한다 */
export const DEFAULT_TIMETABLE = {
  view: 'bar',
  showEvents: true,
  groups: [{
    id: 'tg-all',
    name: '매일',
    days: [0, 1, 2, 3, 4, 5, 6],
    blocks: [
      { id: 'tb-sleep', label: '수면', start: '23:00', end: '07:00', color: '#dde4ff' },
      { id: 'tb-work1', label: '업무', start: '09:00', end: '12:00', color: '#cdeefc' },
      { id: 'tb-lunch', label: '점심', start: '12:00', end: '13:00', color: '#fff3bf' },
      { id: 'tb-work2', label: '업무', start: '13:00', end: '18:00', color: '#cdeefc' },
      { id: 'tb-gym', label: '운동', start: '19:00', end: '20:00', color: '#dff5d8' },
    ],
  }],
};

export const DEFAULT_POMODORO = {
  focus: 25, short: 5, long: 15, longEvery: 4, autoNext: false, sound: true,
  phase: 'focus', running: false, endAt: 0, remaining: 25 * 60000, round: 1, doneCount: 0, doneDate: '',
};

function sampleData() {
  const t = todayStr();
  return {
    categories: [
      { id: 'cat-work', name: '업무', color: '#cdeefc' },
      { id: 'cat-life', name: '개인', color: '#fde0e0' },
      { id: 'cat-anniv', name: '기념일', color: '#eadcff' },
    ],
    events: [
      { id: uid('ev'), title: '예시 · 장기 일정', kind: 'range', start: t, end: addDays(t, 2), allDay: true, categoryId: 'cat-work', color: null, memo: '여러 날에 걸친 일정은 막대로 이어져 표시됩니다.', dday: false },
      { id: uid('ev'), title: '예시 · 반복 일정', kind: 'repeat', start: addDays(t, -14), allDay: true, repeat: { freq: 'weekly', days: [dow(t) === 0 ? 1 : dow(t)], until: null }, categoryId: 'cat-life', color: null, memo: '', dday: false, exdates: [] },
      { id: uid('ev'), title: '예시 · 처음 만난 날', kind: 'anniversary', start: addDays(t, -400), yearly: true, allDay: true, categoryId: 'cat-anniv', color: null, memo: '', dday: true, ddayMode: 'since', ddayCountFirst: true },
      { id: uid('ev'), title: '예시 · 시험', kind: 'single', start: addDays(t, 30), allDay: false, startTime: '10:00', endTime: '12:00', categoryId: 'cat-work', color: null, memo: '', dday: true, ddayMode: 'until' },
    ],
    tasks: [
      { id: uid('tk'), text: '물 2L 마시기', daily: true, due: null, done: false, doneAt: null, doneDates: [], subtasks: [], createdAt: Date.now() },
      { id: uid('tk'), text: '예시 · 오늘 할 일 (더블클릭하면 수정)', daily: false, due: t, done: false, doneAt: null, doneDates: [], subtasks: [], createdAt: Date.now() },
      {
        id: uid('tk'), text: '예시 · 보고서 제출', daily: false, due: addDays(t, 3), done: false, doneAt: null, doneDates: [], createdAt: Date.now(),
        subtasks: [{ id: uid('st'), text: '자료 조사', done: true }, { id: uid('st'), text: '초안 작성', done: false }],
      },
    ],
  };
}

export function defaultState() {
  return {
    version: 1,
    settings: structuredClone(DEFAULT_SETTINGS),
    categories: [],
    events: [],
    tasks: [],
    memos: [],
    favMemoIds: [], // 즐겨찾기한 메모 (메인 화면에 슬라이드로)
    memoDraft: null,
    links: [],
    stickers: [],
    themes: [], // 저장한 테마 { id, name, createdAt, bannerFill, background, mesh, stickers } — 배경 설정 아래 목록
    pomodoro: { ...DEFAULT_POMODORO },
    timetable: structuredClone(DEFAULT_TIMETABLE),
    ddayOrder: [], // D-DAY 위젯에서 끌어 정한 순서 (일정 id). 없는 일정은 가까운 날 순으로 뒤에
    ledger: [], // 용돈기입장 { id, date, amount, memo, method: card|check|cash(현금/페이), type: out|in|save(저축) }
    dayImages: {}, // 캘린더 날짜 칸 이미지 { 'YYYY-MM-DD': { image, view, fit, size, pos, tone(자동 글자색), ink(직접 고른 글자색 | null) } }
    ...sampleData(),
  };
}

/** 저장된 상태에 새 기본값을 채워 넣는다(버전 업그레이드 대비) */
function migrate(saved) {
  const base = defaultState();
  if (!saved || typeof saved !== 'object') return base;
  const s = { ...base, ...saved };
  s.settings = { ...base.settings, ...(saved.settings || {}) };
  // 없앤 설정 (캘린더 표시 밀도는 항상 자동, 새 일정은 항상 날짜 숫자 클릭)
  delete s.settings.calendarDensity;
  delete s.settings.calendarClick;
  delete s.settings.ledgerShowRemain; // 용돈기입장 '남은 돈' 표시는 없앰
  // 메인 메모 하나 → 즐겨찾기 여러 개
  if (!Array.isArray(saved.favMemoIds)) s.favMemoIds = saved.mainMemoId ? [saved.mainMemoId] : [];
  delete s.mainMemoId;
  s.settings.banner = { ...base.settings.banner, ...(s.settings.banner || {}) };
  s.settings.banner.fill = { ...DEFAULT_FILL, ...(s.settings.banner.fill || {}) };
  s.settings.background = { ...base.settings.background, ...(s.settings.background || {}) };
  s.settings.background.fill = { ...DEFAULT_FILL, color: '#ffffff', ...(s.settings.background.fill || {}) };
  s.settings.mesh = { ...base.settings.mesh, ...(s.settings.mesh || {}) };
  for (const [key, defaults] of [['layout', DEFAULT_LAYOUT], ['layoutWide', DEFAULT_LAYOUT_WIDE]]) {
    const layout = Array.isArray(s.settings[key]) ? s.settings[key] : [];
    s.settings[key] = defaults.map((d) => ({ ...d, ...(layout.find((l) => l.id === d.id) || {}) }));
    // 새로 생긴 위젯이 사용자가 바꾼 배치와 겹치면 일단 숨긴다(설정에서 켜면 빈 자리를 찾아 놓음)
    for (const d of defaults) {
      if (layout.length && !layout.some((l) => l.id === d.id)) {
        const me = s.settings[key].find((l) => l.id === d.id);
        const hit = s.settings[key].some((o) => o.id !== d.id && o.visible && o.x < me.x + me.w && me.x < o.x + o.w && o.y < me.y + me.h && me.y < o.y + o.h);
        if (hit) me.visible = false;
      }
    }
  }
  s.timetable = { ...structuredClone(DEFAULT_TIMETABLE), ...(saved.timetable || {}) };
  // 이전 형식(요일 구분 없는 blocks 하나) → '매일' 묶음 하나로
  if (saved.timetable && Array.isArray(saved.timetable.blocks) && !Array.isArray(saved.timetable.groups)) {
    s.timetable.groups = [{ id: 'tg-all', name: '매일', days: [0, 1, 2, 3, 4, 5, 6], blocks: saved.timetable.blocks }];
  }
  delete s.timetable.blocks;
  s.pomodoro = { ...DEFAULT_POMODORO, ...(saved.pomodoro || {}) };
  // 결제 수단은 카드 · 체크 · 현금/페이 (현금과 페이는 한 칸 'cash'. 잠깐 쓰던 'pay' 는 거기로)
  s.ledger = (s.ledger || []).map((x) => (['card', 'check', 'cash'].includes(x.method) ? x : { ...x, method: x.method === 'pay' ? 'cash' : 'card' }));
  // D-DAY 아이콘: 이전 형식의 컬러칩은 같은 색 하트로, 이미지는 없앤다
  s.events = (s.events || []).map((e) => {
    const t = e.ddayThumb;
    if (!t || t.type === 'heart') return e;
    return { ...e, ddayThumb: t.type === 'color' ? { type: 'heart', name: t.color || null, num: t.color || null } : null };
  });
  return s;
}

/* ───────── store ───────── */
let state = null;
const subs = new Set();
let saveTimer = null;

export function getState() {
  return state;
}

export function setState(next, { persist = true } = {}) {
  state = next;
  subs.forEach((fn) => fn(state));
  if (persist) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveState(state);
    }, 400);
  }
}

/** draft 를 직접 수정하는 방식의 갱신 */
export function update(fn) {
  const draft = structuredClone(state);
  fn(draft);
  setState(draft);
}

export async function initStore() {
  const saved = await loadState();
  state = migrate(saved);
  if (!saved) saveState(state);
  window.addEventListener('beforeunload', () => {
    if (saveTimer) saveState(state);
  });
  return state;
}

export function replaceState(next) {
  setState(migrate(next));
}

export function resetState() {
  const fresh = defaultState();
  fresh.categories = [];
  fresh.events = [];
  fresh.tasks = [];
  setState(fresh);
}

export const StoreContext = createContext(null);

export function useStoreState() {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    return () => subs.delete(setS);
  }, []);
  return s;
}

export function useApp() {
  return useContext(StoreContext);
}

