// 도메인 액션 (상태 변경은 모두 여기서)
import { update } from './store.js';
import { uid, bus } from './lib.js';
import { todayStr, addDays, fmtKoDate } from './util/date.js';
import { extractPalette, averageColor } from './util/color.js';

/**
 * 목록에서 하나를 지우고 '되돌리기' 알림을 띄운다. 되돌리면 원래 자리에 다시 넣는다.
 * after(s, removed): 지울 때 함께 바꿀 것 / restore(s, removed): 되돌릴 때 함께 되돌릴 것
 */
function removeWithUndo(listKey, id, describe, { after, restore } = {}) {
  let removed = null;
  let index = -1;
  update((s) => {
    index = s[listKey].findIndex((x) => x.id === id);
    if (index < 0) return;
    removed = s[listKey][index];
    s[listKey].splice(index, 1);
    if (after) after(s, removed);
  });
  if (!removed) return;
  bus.emit('toast', {
    text: `${describe(removed)} 삭제했습니다.`,
    undo: () => update((s) => {
      if (s[listKey].some((x) => x.id === id)) return;
      s[listKey].splice(Math.min(index, s[listKey].length), 0, removed);
      if (restore) restore(s, removed);
    }),
  });
}
const quote = (t) => `'${String(t || '').slice(0, 20)}'`;

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

export function setSetting(path, value) {
  update((s) => setPath(s.settings, path, value));
}

/** 테마 변경: 기본 단색(흰/검정 계열)을 쓰고 있으면 테마에 맞는 색으로 함께 바꾼다 */
const THEME_COLORS = {
  light: { background: '#ffffff', banner: '#d9d9d9' },
  dark: { background: '#141414', banner: '#2b2b2b' },
};
export function setTheme(theme) {
  update((s) => {
    const from = THEME_COLORS[s.settings.theme] || THEME_COLORS.light;
    const to = THEME_COLORS[theme];
    s.settings.theme = theme;
    for (const area of ['background', 'banner']) {
      const fill = s.settings[area].fill;
      if (fill.color && fill.color.toLowerCase() === from[area]) fill.color = to[area];
    }
  });
}

/** 이미지에서 팔레트를 뽑아 메시 그라데이션에 적용 (새 시드로 랜덤 배치) */
export async function applyImagePalette(url) {
  const palette = await extractPalette(url, 6);
  if (!palette.length) return false;
  update((s) => {
    s.settings.mesh = { ...s.settings.mesh, palette, seed: Math.floor(Math.random() * 1e9) };
  });
  return true;
}

/** 이미지 평균색 기록 (콘텐츠 글자색을 밝게/어둡게 정할 때 사용) */
export async function measureImageFill(path, url) {
  const avg = await averageColor(url);
  update((s) => {
    const fill = s.settings[path].fill;
    if (fill.image === url) fill.avg = avg;
  });
}

/** 이미지 영역(배너·배경)에 이미지 등록 */
export function setImageFill(path, url) {
  update((s) => {
    const area = s.settings[path];
    area.fill = { ...area.fill, image: url, type: 'image', avg: null, view: null };
  });
  applyImagePalette(url).catch(() => {});
  measureImageFill(path, url).catch(() => {});
}

/* ───────── 저장한 색 (색상란 '+') ───────── */
const SAVED_COLORS_MAX = 24;
export function addSavedColor(color) {
  update((s) => {
    const list = (s.settings.savedColors || []).filter((c) => c !== color);
    s.settings.savedColors = [...list, color].slice(-SAVED_COLORS_MAX);
  });
}
export function removeSavedColor(color) {
  update((s) => {
    s.settings.savedColors = (s.settings.savedColors || []).filter((c) => c !== color);
  });
}

/* ───────── 일정 ───────── */
export function saveEvent(ev) {
  let id = ev.id;
  update((s) => {
    const i = s.events.findIndex((e) => e.id === ev.id);
    if (i >= 0) s.events[i] = { ...ev, updatedAt: Date.now() };
    else {
      id = uid('ev');
      s.events.push({ ...ev, id, createdAt: Date.now(), updatedAt: Date.now() });
    }
  });
  return id;
}

export function deleteEvent(id) {
  removeWithUndo('events', id, (e) => '일정 ' + quote(e.title));
}

/** 여러 일정에 같은 값을 한 번에 (전체 일정 관리) */
export function patchEvents(ids, patch) {
  const set = new Set(ids);
  update((s) => {
    s.events.forEach((e, i) => {
      if (set.has(e.id)) s.events[i] = { ...e, ...patch, updatedAt: Date.now() };
    });
  });
}

/** 여러 일정 한 번에 삭제 (되돌리면 원래 자리로) */
export function deleteEvents(ids) {
  const set = new Set(ids);
  let removed = [];
  update((s) => {
    removed = s.events.map((e, i) => [i, e]).filter(([, e]) => set.has(e.id));
    s.events = s.events.filter((e) => !set.has(e.id));
  });
  if (!removed.length) return;
  bus.emit('toast', {
    text: removed.length === 1 ? `일정 ${quote(removed[0][1].title)} 삭제했습니다.` : `일정 ${removed.length}개를 삭제했습니다.`,
    undo: () => update((s) => {
      for (const [i, e] of removed) if (!s.events.some((x) => x.id === e.id)) s.events.splice(Math.min(i, s.events.length), 0, e);
    }),
  });
}

/**
 * 일정을 끌어서 delta 일 옮김. 반복 일정은 그 날짜만 따로 떼어 옮긴다(나머지 반복은 그대로).
 * 6초 동안 '되돌리기' 가능.
 */
export function moveOccurrence(occ, delta) {
  let prev = null;
  let createdId = null;
  update((s) => {
    const e = s.events.find((x) => x.id === occ.ev.id);
    if (!e) return;
    prev = structuredClone(e);
    if (e.kind === 'repeat') {
      e.exdates = [...new Set([...(e.exdates || []), occ.start])];
      const { repeat, exdates, ...rest } = structuredClone(e);
      createdId = uid('ev');
      const day = addDays(occ.start, delta);
      s.events.push({ ...rest, id: createdId, kind: 'single', start: day, end: day, createdAt: Date.now(), updatedAt: Date.now() });
    } else {
      e.start = addDays(e.start, delta);
      if (e.end) e.end = addDays(e.end, delta);
      e.updatedAt = Date.now();
    }
  });
  if (!prev) return;
  const how = prev.kind === 'repeat' ? '이 날짜만 ' : '';
  bus.emit('toast', {
    text: `${quote(prev.title)} ${how}${Math.abs(delta)}일 ${delta > 0 ? '뒤로' : '앞으로'} 옮겼습니다.`,
    undo: () => update((s) => {
      const i = s.events.findIndex((x) => x.id === prev.id);
      if (i >= 0) s.events[i] = prev;
      if (createdId) s.events = s.events.filter((x) => x.id !== createdId);
    }),
  });
}

/**
 * 일정을 Ctrl+끌기로 delta 일 옮긴 자리에 복사. 반복 일정은 그 날짜 하루만 단기 일정으로 복사한다(반복 전체를 복제하지 않음).
 * 6초 동안 '되돌리기' 가능.
 */
export function copyOccurrence(occ, delta) {
  let createdId = null;
  let title = '';
  const day = addDays(occ.start, delta);
  update((s) => {
    const e = s.events.find((x) => x.id === occ.ev.id);
    if (!e) return;
    title = e.title;
    const { repeat, exdates, ...rest } = structuredClone(e);
    const moved = e.kind === 'repeat'
      ? { kind: 'single', start: day, end: day }
      : { start: addDays(e.start, delta), ...(e.end ? { end: addDays(e.end, delta) } : {}) };
    createdId = uid('ev');
    s.events.push({ ...rest, ...moved, id: createdId, createdAt: Date.now(), updatedAt: Date.now() });
  });
  if (!createdId) return;
  bus.emit('toast', {
    text: `${quote(title)} 일정을 ${fmtKoDate(day)}에 복사했습니다.`,
    undo: () => update((s) => {
      s.events = s.events.filter((x) => x.id !== createdId);
    }),
  });
}

/** 반복 일정 중 하루만 제외 */
export function excludeOccurrence(id, date) {
  update((s) => {
    const ev = s.events.find((e) => e.id === id);
    if (ev) ev.exdates = [...new Set([...(ev.exdates || []), date])];
  });
}

/** 반복 일정 중 하루만 별도 일정으로 수정 */
export function detachOccurrence(id, date, edited) {
  let newId = null;
  update((s) => {
    const ev = s.events.find((e) => e.id === id);
    if (!ev) return;
    ev.exdates = [...new Set([...(ev.exdates || []), date])];
    newId = uid('ev');
    const { repeat, exdates, ...rest } = edited;
    s.events.push({ ...rest, id: newId, kind: 'single', start: edited.start || date, end: edited.start || date, createdAt: Date.now(), updatedAt: Date.now() });
  });
  return newId;
}

export function saveCategory(cat) {
  update((s) => {
    const i = s.categories.findIndex((c) => c.id === cat.id);
    if (i >= 0) s.categories[i] = cat;
    else s.categories.push({ ...cat, id: uid('cat') });
  });
}

export function deleteCategory(id) {
  update((s) => {
    s.categories = s.categories.filter((c) => c.id !== id);
    s.events.forEach((e) => {
      if (e.categoryId === id) e.categoryId = null;
    });
    s.settings.hiddenCategories = s.settings.hiddenCategories.filter((c) => c !== id);
  });
}

/** 카테고리 순서 바꾸기 (끌어서) */
export function reorderCategories(ids) {
  update((s) => {
    const rank = new Map(ids.map((id, i) => [id, i]));
    s.categories = [...s.categories].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  });
}

export function toggleCategoryHidden(id) {
  update((s) => {
    const set = new Set(s.settings.hiddenCategories);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    s.settings.hiddenCategories = [...set];
  });
}

/* ───────── 체크리스트 ───────── */
export function saveTask(task) {
  update((s) => {
    const i = s.tasks.findIndex((t) => t.id === task.id);
    if (i >= 0) s.tasks[i] = task;
    else s.tasks.push({ doneDates: [], subtasks: [], done: false, doneAt: null, ...task, id: uid('tk'), createdAt: Date.now() });
  });
}

/** 체크리스트 순서 저장: ids 순서대로 order 부여 */
export function reorderTasks(ids) {
  update((s) => {
    ids.forEach((id, i) => {
      const t = s.tasks.find((x) => x.id === id);
      if (t) t.order = i;
    });
  });
}

export function deleteTask(id) {
  removeWithUndo('tasks', id, (t) => '할 일 ' + quote(t.text));
}

export function toggleTask(id, date = todayStr()) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.daily) {
      const set = new Set(t.doneDates || []);
      const on = !set.has(date);
      if (on) set.add(date);
      else set.delete(date);
      t.doneDates = [...set].sort();
      if (t.steps) setStepValue(t, on ? t.steps : Math.min(stepValue(t, date), t.steps - 1), date);
    } else {
      t.done = !t.done;
      t.doneAt = t.done ? new Date().toISOString() : null;
      if (t.done && t.subtasks) t.subtasks.forEach((st) => (st.done = true));
      if (t.steps) t.stepDone = t.done ? t.steps : Math.min(t.stepDone || 0, t.steps - 1);
    }
  });
}

/* 진도 도트: 일반 항목은 stepDone, 매일 항목은 날짜별 stepLog */
export function stepValue(t, date) {
  return t.daily ? (t.stepLog && t.stepLog[date]) || 0 : t.stepDone || 0;
}
function setStepValue(t, k, date) {
  if (t.daily) {
    t.stepLog = { ...(t.stepLog || {}), [date]: k };
    // 지난 기록은 31일치만 남긴다
    const keys = Object.keys(t.stepLog).sort();
    keys.slice(0, Math.max(0, keys.length - 31)).forEach((d) => delete t.stepLog[d]);
  } else t.stepDone = k;
}

/** 도트 k 번째를 누름: 같은 칸을 다시 누르면 한 칸 되돌림. 끝까지 채우면 자동 완료 */
export function setTaskStep(id, k, date = todayStr()) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t || !t.steps) return;
    const cur = stepValue(t, date);
    const next = cur === k ? k - 1 : k;
    setStepValue(t, next, date);
    const full = next >= t.steps;
    if (t.daily) {
      const set = new Set(t.doneDates || []);
      if (full) set.add(date);
      else set.delete(date);
      t.doneDates = [...set].sort();
    } else if (full !== t.done) {
      t.done = full;
      t.doneAt = full ? new Date().toISOString() : null;
    }
  });
}

export function toggleSubtask(taskId, subId) {
  update((s) => {
    const t = s.tasks.find((x) => x.id === taskId);
    const st = t && t.subtasks.find((x) => x.id === subId);
    if (!st) return;
    st.done = !st.done;
    if (!t.daily) {
      const all = t.subtasks.length && t.subtasks.every((x) => x.done);
      if (all && !t.done) {
        t.done = true;
        t.doneAt = new Date().toISOString();
      } else if (!all && t.done) {
        t.done = false;
        t.doneAt = null;
      }
    }
  });
}

/* ───────── 메모 ───────── */
export function saveMemo({ id, html }) {
  let savedId = id;
  update((s) => {
    const now = Date.now();
    const m = id && s.memos.find((x) => x.id === id);
    if (m) {
      m.html = html;
      m.updatedAt = now;
    } else {
      savedId = uid('memo');
      s.memos.unshift({ id: savedId, html, createdAt: now, updatedAt: now });
    }
    s.memoDraft = null;
  });
  return savedId;
}

export function deleteMemo(id) {
  let favAt = -1;
  removeWithUndo('memos', id, () => '메모를', {
    after: (s) => {
      favAt = (s.favMemoIds || []).indexOf(id);
      if (favAt >= 0) s.favMemoIds = s.favMemoIds.filter((x) => x !== id);
    },
    restore: (s) => {
      if (favAt >= 0 && !s.favMemoIds.includes(id)) s.favMemoIds.splice(Math.min(favAt, s.favMemoIds.length), 0, id);
    },
  });
}

/** 즐겨찾기 켜고 끄기 (여러 개면 메인 화면에서 슬라이드로 넘겨 본다) */
export function toggleFavMemo(id) {
  update((s) => {
    const list = s.favMemoIds || [];
    s.favMemoIds = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  });
}

/** 메모 제목 (비우면 첫 줄을 제목으로) */
export function renameMemo(id, title) {
  update((s) => {
    const m = s.memos.find((x) => x.id === id);
    if (m) m.title = title.trim().slice(0, 60) || null;
  });
}

export function setMemoDraft(draft) {
  update((s) => {
    s.memoDraft = draft;
  });
}

/* ───────── 바로가기 / 스티커 ───────── */
export function saveLink(link) {
  update((s) => {
    const i = s.links.findIndex((l) => l.id === link.id);
    if (i >= 0) s.links[i] = link;
    else s.links.push({ ...link, id: uid('ln') });
  });
}
export function deleteLink(id) {
  removeWithUndo('links', id, (l) => '바로가기 ' + quote(l.title));
}
export function moveLink(id, dir) {
  update((s) => {
    const i = s.links.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.links.length) return;
    [s.links[i], s.links[j]] = [s.links[j], s.links[i]];
  });
}

export function addSticker(sticker) {
  update((s) => {
    s.stickers.push({ x: 40, y: 30, w: 12, rot: 0, flipX: false, flipY: false, url: '', label: '', ...sticker, id: uid('stk'), z: s.stickers.length + 1 });
  });
}
export function patchSticker(id, patch) {
  update((s) => {
    const st = s.stickers.find((x) => x.id === id);
    if (st) Object.assign(st, patch);
  });
}
export function deleteSticker(id) {
  removeWithUndo('stickers', id, () => '스티커를');
}
export function bringStickerFront(id) {
  update((s) => {
    const max = Math.max(0, ...s.stickers.map((x) => x.z || 0));
    const st = s.stickers.find((x) => x.id === id);
    if (st) st.z = max + 1;
  });
}

/* ───────── D-DAY ───────── */
export function reorderDday(ids) {
  update((s) => {
    s.ddayOrder = ids;
  });
}

/** D-DAY 도트 하트: null(없음) · { type: 'heart', name, num } (색이 null 이면 일정 색) */
export function setDdayThumb(eventId, thumb) {
  update((s) => {
    const ev = s.events.find((e) => e.id === eventId);
    if (ev) ev.ddayThumb = thumb;
  });
}

/* ───────── 캘린더 날짜 칸 이미지 ───────── */
/** img: { image, view, fit, size, pos, tone, ink } · null 이면 지운다 */
export function setDayImage(date, img) {
  update((s) => {
    s.dayImages = { ...(s.dayImages || {}) };
    if (img) s.dayImages[date] = img;
    else delete s.dayImages[date];
  });
}

/* ───────── 용돈기입장 ───────── */
export function saveLedgerEntry(entry) {
  update((s) => {
    const i = s.ledger.findIndex((x) => x.id === entry.id);
    if (i >= 0) s.ledger[i] = entry;
    else s.ledger.push({ ...entry, id: uid('lg'), createdAt: Date.now() });
  });
}
/** 같은 날짜의 여러 기록을 한 번에 추가 */
export function addLedgerEntries(entries) {
  update((s) => {
    const now = Date.now();
    entries.forEach((x, i) => s.ledger.push({ ...x, id: uid('lg'), createdAt: now + i }));
  });
}
export function deleteLedgerEntry(id) {
  removeWithUndo('ledger', id, (x) => '기록 ' + quote(x.memo || x.amount.toLocaleString('ko-KR') + '원'));
}

/* ───────── 뽀모도로 ───────── */
export function patchPomodoro(patch) {
  update((s) => {
    Object.assign(s.pomodoro, typeof patch === 'function' ? patch(s.pomodoro) : patch);
  });
}

/* ───────── 테마: 이미지 배너 · 콘텐츠 배경(메시 팔레트 포함) · 스티커를 한 벌로 저장 ───────── */
const themeOf = (s) => structuredClone({
  bannerFill: s.settings.banner.fill,
  background: s.settings.background,
  mesh: s.settings.mesh,
  stickers: s.stickers,
});
function putTheme(s, t) {
  s.settings.banner.fill = t.bannerFill;
  s.settings.background = t.background;
  s.settings.mesh = t.mesh;
  s.stickers = t.stickers;
}

export function saveTheme(name) {
  update((s) => {
    s.themes.push({ id: uid('thm'), name: name.trim() || `테마 ${s.themes.length + 1}`, createdAt: Date.now(), ...themeOf(s) });
  });
}
/** 지금 화면으로 테마 내용을 덮어쓴다 (이름은 그대로) */
export function overwriteTheme(id) {
  let before = null;
  update((s) => {
    const t = s.themes.find((x) => x.id === id);
    if (!t) return;
    before = structuredClone(t);
    Object.assign(t, themeOf(s));
  });
  if (!before) return;
  bus.emit('toast', {
    text: `${quote(before.name)} 테마를 지금 화면으로 바꿨습니다.`,
    undo: () => update((s) => {
      const t = s.themes.find((x) => x.id === id);
      if (t) Object.assign(t, before);
    }),
  });
}
/** 테마 적용. 되돌리기를 누르면 적용 전 화면으로 */
export function applyTheme(id) {
  let before = null;
  let name = '';
  update((s) => {
    const t = s.themes.find((x) => x.id === id);
    if (!t) return;
    before = themeOf(s);
    name = t.name;
    putTheme(s, structuredClone(t));
  });
  if (!before) return;
  bus.emit('toast', { text: `${quote(name)} 테마를 적용했습니다.`, undo: () => update((s) => putTheme(s, before)) });
}
export function renameTheme(id, name) {
  update((s) => {
    const t = s.themes.find((x) => x.id === id);
    if (t && name.trim()) t.name = name.trim().slice(0, 30);
  });
}
export function deleteTheme(id) {
  removeWithUndo('themes', id, (t) => `${quote(t.name)} 테마를`);
}
