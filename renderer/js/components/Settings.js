// 화면 설정 패널 (콘텐츠 영역 오른쪽 서랍 — 머리를 끌어 옮기거나 접어서 뒤 화면을 볼 수 있다)
import { html, useState, useEffect, useRef, cx, useBus, bus, capture } from '../lib.js';
import { useApp, WIDGETS, DEFAULT_LAYOUT, DEFAULT_LAYOUT_WIDE, layoutKey, replaceState, resetState, getState, update } from '../store.js';
import { setSetting, addSticker, deleteSticker, saveLink, deleteLink, moveLink, patchSticker, applyImagePalette, setImageFill, setTheme,
  saveTheme, applyTheme, overwriteTheme, renameTheme, deleteTheme } from '../actions.js';
import { pickAndStoreImage, exportBackup, importBackup, isElectron, shell, clearCache } from '../storage.js';
import { meshBackground } from '../util/color.js';
import { hold, release } from '../focus.js';
import { Segmented, Toggle, Field, Range } from './controls.js';
import { Icon, IconButton } from './icons.js';
import { Confirm } from './Popup.js';
import { LayoutEditor, findSlot } from './LayoutEditor.js';
import { ImageEditor } from './ImageEditor.js';
import { setLinksMode } from './Links.js';
import { imageSize } from '../util/icon.js';

/** 상태 안의 쓰지 않는 찌꺼기 정리: 메모 초안, 반복 범위를 벗어난 제외일, 없는 카테고리 참조 */
function cleanupState() {
  update((s) => {
    s.memoDraft = null;
    const cats = new Set(s.categories.map((c) => c.id));
    s.settings.hiddenCategories = s.settings.hiddenCategories.filter((id) => cats.has(id));
    s.events.forEach((e) => {
      if (e.categoryId && !cats.has(e.categoryId)) e.categoryId = null;
      if (e.exdates) e.exdates = e.exdates.filter((d) => d >= e.start && (!e.repeat || !e.repeat.until || d <= e.repeat.until));
    });
  });
}

const TABS = [
  { id: 'background', label: '배경', icon: 'palette' },
  { id: 'layout', label: '레이아웃', icon: 'layout' },
  { id: 'stickers', label: '스티커·바로가기', icon: 'sticker' },
  { id: 'general', label: '일반·백업', icon: 'gear' },
];

const MONO = ['#ffffff', '#f4f4f4', '#e6e6e6', '#d9d9d9', '#bdbdbd', '#8c8c8c', '#4d4d4d', '#1f1f1f', '#111111'];

function FillEditor({ title, path, fill, onPicked, autoEdit }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!!autoEdit && !!fill.image);
  const set = (patch) => setSetting(path + '.fill', { ...fill, ...patch });

  async function pick() {
    setBusy(true);
    try {
      const url = await pickAndStoreImage(2560);
      if (!url) return;
      setImageFill(path, url);
      onPicked();
      setEditing(true); // 고른 직후 바로 크롭·위치 편집
    } finally {
      setBusy(false);
    }
  }

  return html`<fieldset class="set-group">
    <legend class="set-title">${title}</legend>
    <${Segmented} label="채우기" hideLabel value=${fill.type} onChange=${(type) => set({ type })}
      options=${[{ value: 'image', label: '이미지' }, { value: 'color', label: '단색' }, { value: 'mesh', label: '메시 그라데이션' }]} />
    ${fill.type === 'image' && html`<div class="img-pick">
      <div class="img-thumb" style=${fill.image ? { backgroundImage: `url("${fill.image}")` } : null}>${!fill.image && html`<span class="muted">이미지 없음</span>`}</div>
      <div class="img-pick-actions">
        <div class="btn-row">
          <button type="button" class="btn btn-sm" onClick=${pick} disabled=${busy}><${Icon} name="image" size=${14} /> ${busy ? '여는 중…' : '이미지 선택'}</button>
          ${fill.image && html`<button type="button" class="btn btn-sm btn-danger-ghost" onClick=${() => set({ image: null, type: 'color' })}>제거</button>`}
        </div>
        ${fill.image && html`<button type="button" class="btn btn-sm btn-primary" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${14} /> 크롭 · 위치 편집</button>`}
      </div>
    </div>
    ${path === 'background' && fill.image && html`<${Range} label="이미지 흐림" value=${fill.blur || 0} min=${0} max=${40} suffix="px"
      onChange=${(v) => set({ blur: v })} />`}
    ${editing && fill.image && html`<${ImageEditor} path=${path} fill=${fill} onClose=${() => setEditing(false)} />`}`}
    ${fill.type === 'color' && html`<div class="swatches" role="group" aria-label="색상">
        ${MONO.map((c) => html`<button type="button" class=${cx('swatch', fill.color === c && 'is-on')} style=${{ background: c }}
          aria-label=${'색상 ' + c} aria-pressed=${String(fill.color === c)} onClick=${() => set({ color: c })}></button>`)}
        <label class="swatch swatch-custom" title="직접 선택"><span class="sr-only">직접 색상 선택</span>
          <input type="color" value=${fill.color} onInput=${(e) => set({ color: e.currentTarget.value })} /></label>
    </div>`}
  </fieldset>`;
}

/** 테마 미리보기 한 칸: 이미지 · 단색 · 메시를 작은 상자로 */
function fillStyle(fill, mesh) {
  if (fill.type === 'image' && fill.image) return { backgroundImage: `url("${fill.image}")`, backgroundSize: 'cover', backgroundPosition: `${fill.posX ?? 50}% ${fill.posY ?? 50}%` };
  if (fill.type === 'mesh') return { background: meshBackground(mesh.palette, mesh.seed) };
  return { background: fill.color };
}

/** 저장한 테마 목록: 적용 · 이름 수정 · 지금 화면으로 바꾸기 · 삭제 */
function ThemeList() {
  const { themes } = useApp();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [overwrite, setOverwrite] = useState(null);

  function save(e) {
    e.preventDefault();
    saveTheme(e.currentTarget.querySelector('input').value);
    setName('');
  }
  function finishRename(id, value) {
    renameTheme(id, value);
    setRenaming(null);
  }

  return html`<fieldset class="set-group">
    <legend class="set-title">테마</legend>
    <form class="theme-form" onSubmit=${save}>
      <label class="sr-only" for="theme-name">테마 이름</label>
      <input id="theme-name" class="input input-sm" placeholder=${`테마 ${themes.length + 1}`} maxlength="30" value=${name}
        onInput=${(e) => setName(e.currentTarget.value)} />
      <button type="submit" class="btn btn-primary btn-sm"><${Icon} name="plus" size=${14} /> 저장</button>
    </form>
    ${themes.length ? html`<ul class="theme-list">
      ${themes.map((t) => html`<li class="theme-item" key=${t.id}>
        <span class="theme-thumb" aria-hidden="true">
          <span style=${fillStyle(t.bannerFill, t.mesh)}></span>
          <span style=${fillStyle(t.background.fill, t.mesh)}></span>
        </span>
        ${renaming === t.id
          ? html`<${ThemeRename} theme=${t} onDone=${(value) => (value === null ? setRenaming(null) : finishRename(t.id, value))} />`
          : html`<span class="theme-text">
              <strong class="theme-name">${t.name}</strong>
              <span class="muted">스티커 ${t.stickers.length}개</span>
            </span>`}
        <button type="button" class="btn btn-sm" onClick=${() => applyTheme(t.id)}>적용</button>
        <${IconButton} icon="edit" size=${14} label=${t.name + ' 이름 수정'} onClick=${() => setRenaming(t.id)} />
        <${IconButton} icon="refresh" size=${14} label=${t.name + '을(를) 지금 화면으로 바꾸기'} onClick=${() => setOverwrite(t)} />
        <${IconButton} icon="trash" size=${14} label=${t.name + ' 삭제'} onClick=${() => deleteTheme(t.id)} />
      </li>`)}
    </ul>` : html`<p class="field-hint">지금 화면의 배너 · 배경 · 스티커를 테마로 저장해 두고 언제든 다시 적용할 수 있습니다.</p>`}
    ${overwrite && html`<${Confirm} title="테마 바꾸기" confirmLabel="바꾸기" message=${`'${overwrite.name}' 테마를 지금 화면의 배너 · 배경 · 스티커로 바꿀까요?`}
      onConfirm=${() => { overwriteTheme(overwrite.id); setOverwrite(null); }} onCancel=${() => setOverwrite(null)} />`}
  </fieldset>`;
}

/** 테마 이름 고치기 — Enter · 바깥 누르기 저장(onDone(값)), Esc 취소(onDone(null)) */
function ThemeRename({ theme, onDone }) {
  const ref = useRef(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current.focus();
    ref.current.select();
  }, []);
  const finish = (value) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return html`<input ref=${ref} class="input input-sm theme-rename" value=${theme.name} maxlength="30" aria-label="테마 이름"
    onKeyDown=${(e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
    }}
    onBlur=${(e) => finish(e.currentTarget.value)} />`;
}

function BackgroundTab({ s, edit }) {
  const [msg, setMsg] = useState('');
  async function applyPalette(url) {
    try {
      setMsg((await applyImagePalette(url)) ? '이미지에서 팔레트를 추출했습니다.' : '팔레트를 추출하지 못했습니다.');
    } catch {
      setMsg('팔레트를 추출하지 못했습니다.');
    }
  }
  const images = [
    s.banner.fill.image && { label: '배너 이미지', url: s.banner.fill.image },
    s.background.fill.image && { label: '배경 이미지', url: s.background.fill.image },
  ].filter(Boolean);
  const mesh = s.mesh;

  return html`<div class="set-tab">
    <${FillEditor} title="이미지 배너 영역" path="banner" fill=${s.banner.fill} autoEdit=${edit === 'banner'} onPicked=${() => setMsg('이미지에서 팔레트를 추출했습니다.')} />
    <${FillEditor} title="콘텐츠 배경" path="background" fill=${s.background.fill} onPicked=${() => setMsg('이미지에서 팔레트를 추출했습니다.')} />

    <fieldset class="set-group">
      <legend class="set-title">메시 그라데이션</legend>
      <div class="mesh-preview" style=${{ background: meshBackground(mesh.palette, mesh.seed) }} aria-hidden="true"></div>
      <div class="swatches" role="group" aria-label="팔레트">
        ${mesh.palette.map((c, i) => html`<label class="swatch swatch-edit" style=${{ background: c }} title=${c} key=${i}>
          <span class="sr-only">팔레트 색 ${i + 1} (${c}) 변경</span>
          <input type="color" value=${c} onInput=${(e) => setSetting('mesh.palette', mesh.palette.map((x, j) => (j === i ? e.currentTarget.value : x)))} />
        </label>`)}
      </div>
      <div class="btn-row">
        ${images.map((im) => html`<button type="button" class="btn btn-sm" onClick=${() => applyPalette(im.url)}>
          <${Icon} name="palette" size=${14} /> ${im.label}에서 추출</button>`)}
        <button type="button" class="btn btn-sm" onClick=${() => setSetting('mesh.seed', Math.floor(Math.random() * 1e9))}>
          <${Icon} name="refresh" size=${14} /> 랜덤 생성</button>
      </div>
      ${!images.length && html`<p class="field-hint">배너·배경 이미지 색으로도 만들 수 있습니다.</p>`}
      <${Toggle} label="천천히 움직이기" checked=${mesh.animate} onChange=${(v) => setSetting('mesh.animate', v)} />
      ${s.background.fill.type !== 'color' && html`<${Range} label="글래스 패널 진하기" value=${s.background.panel} min=${0} max=${100} suffix="%"
        onChange=${(v) => setSetting('background.panel', v)} />`}
      <p class="sr-only" aria-live="polite">${msg}</p>
      ${msg && html`<p class="field-hint" aria-hidden="true">${msg}</p>`}
    </fieldset>
    <${ThemeList} />
  </div>`;
}

function LayoutTab({ s }) {
  const [warn, setWarn] = useState('');

  // 배너가 위/아래일 때와 좌/우일 때의 배치를 따로 기억한다
  const key = layoutKey(s);
  const wide = key === 'layoutWide';
  const layout = s[key];

  function toggle(id, on) {
    if (!on) return setSetting(key, layout.map((l) => (l.id === id ? { ...l, visible: false } : l)));
    const cur = layout.find((l) => l.id === id);
    const others = layout.filter((l) => l.id !== id);
    const fits = !others.some((o) => o.visible && o.x < cur.x + cur.w && cur.x < o.x + o.w && o.y < cur.y + cur.h && cur.y < o.y + o.h);
    const slot = fits ? cur : findSlot(others, id);
    if (!slot) return setWarn(`${WIDGETS[id].name}을(를) 놓을 빈 공간이 없습니다. 다른 위젯 크기를 줄여 주세요.`);
    setWarn('');
    setSetting(key, layout.map((l) => (l.id === id ? { ...l, ...slot, visible: true } : l)));
  }

  return html`<div class="set-tab">
    <fieldset class="set-group">
      <legend class="set-title">이미지 배너 위치</legend>
      <${Segmented} label="위치" hideLabel value=${s.banner.position} onChange=${(v) => setSetting('banner.position', v)}
        options=${[{ value: 'left', label: '왼쪽' }, { value: 'right', label: '오른쪽' }, { value: 'top', label: '위' }, { value: 'bottom', label: '아래' }, { value: 'none', label: '숨김' }]} />
    </fieldset>
    <fieldset class="set-group">
      <legend class="set-title">위젯 배치 <span id="le-help" class="muted set-sub">끌어서 이동 · 다른 위젯 위에 놓으면 자리 교체 · 가장자리를 끌어 크기 조절</span></legend>
      <${LayoutEditor} layout=${layout} banner=${s.banner} onBannerSize=${(v) => setSetting('banner.size', v)} onChange=${(l) => setSetting(key, l)} />
      <div class="widget-toggles">
        ${layout.map((l) => html`<${Toggle} key=${l.id} label=${WIDGETS[l.id].name} checked=${l.visible} onChange=${(v) => toggle(l.id, v)} />`)}
      </div>
      ${warn && html`<p class="form-error" role="alert">${warn}</p>`}
      <button type="button" class="btn btn-sm btn-block" onClick=${() => { setSetting(key, wide ? DEFAULT_LAYOUT_WIDE : DEFAULT_LAYOUT); setWarn(''); }}>
        <${Icon} name="reset" size=${14} /> 기본 배치로 되돌리기</button>
    </fieldset>
    <fieldset class="set-group">
      <legend class="set-title">D-DAY 정렬 <span class="muted set-sub">순서는 D-DAY 위젯에서 끌어서 바꿉니다.</span></legend>
      <${Segmented} label="나열 방향" hideLabel value=${s.ddayDirection || 'auto'} onChange=${(v) => setSetting('ddayDirection', v)}
        options=${[{ value: 'auto', label: '자동' }, { value: 'row', label: '가로' }, { value: 'column', label: '세로' }]} />
      <${Range} label="D-DAY 속도 (칸을 넘칠 때 흐르는 속도)" value=${s.ddaySpeed ?? s.tickerSpeed ?? 50} min=${20} max=${120} step=${5}
        onChange=${(v) => setSetting('ddaySpeed', v)} />
    </fieldset>
  </div>`;
}

function StickersTab({ onClose }) {
  const { stickers, links, settings } = useApp();
  const [form, setForm] = useState({ title: '', url: '', icon: null });
  const [err, setErr] = useState('');

  async function addImageSticker() {
    const src = await pickAndStoreImage(1200);
    if (src) addSticker({ src, x: 50, y: 45, w: 10 });
  }
  async function pickIcon() {
    const icon = await pickAndStoreImage(256);
    if (!icon) return;
    setForm({ ...form, icon });
    // 너무 작은 이미지는 흐려지지 않게 정수배로만 키워 표시되므로 안내
    const { w, h } = await imageSize(icon).catch(() => ({ w: 0, h: 0 }));
    setErr(w && Math.min(w, h) < 96 ? `작은 이미지(${w}×${h})입니다. 128px 이상을 권장합니다.` : '');
  }
  function addLink(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.url.trim()) return setErr('이름과 주소를 입력해 주세요.');
    saveLink({ title: form.title.trim(), url: form.url.trim(), icon: form.icon });
    setForm({ title: '', url: '', icon: null });
    setErr('');
  }

  return html`<div class="set-tab">
    <fieldset class="set-group">
      <legend class="set-title">스티커</legend>
      <div class="btn-row">
        <button type="button" class="btn btn-sm" onClick=${addImageSticker}><${Icon} name="image" size=${14} /> 이미지 스티커 추가</button>
        <button type="button" class="btn btn-primary btn-sm" onClick=${() => { bus.emit('stickers:edit', true); onClose(); }}>
          <${Icon} name="move" size=${14} /> 화면에서 편집하기</button>
      </div>
      ${stickers.length > 0 && html`<ul class="thumb-list">
        ${stickers.map((st) => html`<li key=${st.id}>
          <img src=${st.src} alt="" />
          <label class="sr-only" for=${'sl-' + st.id}>스티커 링크</label>
          <input id=${'sl-' + st.id} class="input input-sm" placeholder="링크(선택)" value=${st.url}
            onChange=${(e) => patchSticker(st.id, { url: e.currentTarget.value.trim() })} />
          <${IconButton} icon="trash" label="스티커 삭제" onClick=${() => deleteSticker(st.id)} />
        </li>`)}
      </ul>`}
    </fieldset>
    <fieldset class="set-group">
      <legend class="set-title">바로가기</legend>
      <${Segmented} label="배치 방식" hideLabel value=${settings.linksMode || 'list'} onChange=${setLinksMode}
        options=${[{ value: 'list', label: '리스트형 (위젯)' }, { value: 'free', label: '자유형 (스티커처럼)' }]} />
      ${settings.linksMode === 'free' && html`<p class="field-hint">오른쪽 위 스티커 편집 버튼을 누른 뒤 끌어서 옮깁니다.</p>`}
      <form class="link-form" onSubmit=${addLink}>
        <button type="button" class="link-icon-pick" onClick=${pickIcon} aria-label="아이콘 이미지 선택(선택 사항)" title="아이콘 이미지(선택)">
          ${form.icon ? html`<img src=${form.icon} alt="" />` : html`<${Icon} name="image" />`}
        </button>
        <label class="sr-only" for="ln-title">이름</label>
        <input id="ln-title" class="input input-sm" placeholder="이름" value=${form.title} onInput=${(e) => setForm({ ...form, title: e.currentTarget.value })} />
        <label class="sr-only" for="ln-url">주소</label>
        <input id="ln-url" class="input input-sm" placeholder="https://" value=${form.url} onInput=${(e) => setForm({ ...form, url: e.currentTarget.value })} />
        <button type="submit" class="btn btn-primary btn-sm">추가</button>
      </form>
      ${err && html`<p class="form-error" role="alert">${err}</p>`}
      <div class="links-bg-row"><${Toggle} label="아이콘 바탕 표시" checked=${settings.linksBg} onChange=${(v) => setSetting('linksBg', v)} /></div>
      <ul class="thumb-list">
        ${links.map((l, i) => html`<li key=${l.id}>
          ${l.icon ? html`<img src=${l.icon} alt="" />` : html`<span class="link-letter" aria-hidden="true">${l.title.charAt(0).toUpperCase()}</span>`}
          <span class="thumb-text"><strong>${l.title}</strong><span class="muted">${l.url}</span></span>
          <${IconButton} icon="arrow-up" label=${l.title + ' 위로'} disabled=${i === 0} onClick=${() => moveLink(l.id, -1)} />
          <${IconButton} icon="arrow-down" label=${l.title + ' 아래로'} disabled=${i === links.length - 1} onClick=${() => moveLink(l.id, 1)} />
          <${IconButton} icon="trash" label=${l.title + ' 삭제'} onClick=${() => deleteLink(l.id)} />
        </li>`)}
      </ul>
    </fieldset>
  </div>`;
}

/** 자동 업데이트 상태 (설치형에서만 보인다) */
function updateText(u) {
  switch (u.status) {
    case 'checking': return '새 버전을 확인하고 있습니다…';
    case 'downloading': return `v${u.version} 받는 중… ${u.percent}%`;
    case 'ready': return `v${u.version} 준비 완료 · 다시 시작하면 적용됩니다. 그냥 두면 다음에 앱을 끌 때 설치됩니다.`;
    case 'none': return '최신 버전입니다.';
    case 'error': return u.error || '업데이트를 확인하지 못했습니다.';
    default: return '새 버전이 나오면 자동으로 받아 둡니다.';
  }
}
function UpdateGroup({ u }) {
  const busy = u.status === 'checking' || u.status === 'downloading';
  return html`<fieldset class="set-group">
    <legend class="set-title">업데이트</legend>
    <p class="field-hint" role="status">${updateText(u)}</p>
    <div class="btn-row">
      ${u.status === 'ready'
        ? html`<button type="button" class="btn btn-sm" onClick=${() => shell.installUpdate()}><${Icon} name="refresh" size=${14} /> 다시 시작해 업데이트</button>`
        : html`<button type="button" class="btn btn-sm" disabled=${busy} onClick=${() => shell.checkUpdate()}><${Icon} name="refresh" size=${14} /> ${u.status === 'downloading' ? '받는 중…' : busy ? '확인 중…' : '업데이트 확인'}</button>`}
    </div>
  </fieldset>`;
}

function GeneralTab({ s, info }) {
  const [confirm, setConfirm] = useState(null);
  const [msg, setMsg] = useState('');

  async function doExport() {
    const res = await exportBackup(getState());
    if (res) setMsg(`백업을 저장했습니다: ${res}`);
  }
  const [cleaning, setCleaning] = useState(false);
  async function doClean() {
    setCleaning(true);
    try {
      cleanupState();
      const res = await clearCache(getState());
      const mb = (n) => (n / 1048576).toFixed(1);
      setMsg(res
        ? `캐시 ${mb(res.browserCache)}MB · 쓰지 않는 이미지 ${mb(res.assets)}MB를 정리했습니다.`
        : '임시 데이터를 정리했습니다.');
    } catch {
      setMsg('정리 중 문제가 발생했습니다.');
    } finally {
      setCleaning(false);
    }
  }
  async function doImport() {
    try {
      const st = await importBackup();
      if (st) {
        replaceState(st);
        setMsg('백업을 불러왔습니다.');
      }
    } catch (err) {
      setMsg(err.message || '불러오기에 실패했습니다.');
    }
  }

  return html`<div class="set-tab">
    <fieldset class="set-group">
      <legend class="set-title">표시</legend>
      <${Segmented} label="테마" value=${s.theme} onChange=${setTheme}
        options=${[{ value: 'light', label: '라이트' }, { value: 'dark', label: '다크' }]} />
      <${Segmented} label="한 주의 시작" value=${s.weekStart} onChange=${(v) => setSetting('weekStart', v)}
        options=${[{ value: 0, label: '일요일' }, { value: 1, label: '월요일' }]} />
    </fieldset>
    <fieldset class="set-group">
      <legend class="set-title">캘린더</legend>
      <${Toggle} label="한국 공휴일 표시 (음력·대체공휴일 포함)" checked=${s.showHolidays !== false} onChange=${(v) => setSetting('showHolidays', v)}
        hint="임시공휴일은 확정된 것만 표시합니다." />
      <${Toggle} label="용돈기입장 하루 합계를 날짜에 표시" checked=${s.ledgerOnCalendar !== false} onChange=${(v) => setSetting('ledgerOnCalendar', v)}
        hint="수입 − 지출. 10만 원 이상은 ‘만’ 단위." />
    </fieldset>
    <fieldset class="set-group">
      <legend class="set-title">전광판 · 체크리스트</legend>
      <${Range} label="전광판 속도" value=${s.tickerSpeed} min=${20} max=${120} step=${5} onChange=${(v) => setSetting('tickerSpeed', v)} />
      <${Toggle} label="오늘 완료한 항목을 체크리스트에 남겨두기" checked=${s.showCompletedToday} onChange=${(v) => setSetting('showCompletedToday', v)} />
    </fieldset>
    ${isElectron && info && html`<fieldset class="set-group">
      <legend class="set-title">바탕화면</legend>
      <${Toggle} label="바탕화면 모드 (아이콘 아래에 배치)" checked=${info.wallpaperMode} onChange=${(v) => shell.setWallpaperMode(v)}
        hint="단축키 Ctrl+Alt+D" />
      <${Toggle} label="컴퓨터를 켜면 자동 실행" checked=${info.autostart} disabled=${!info.autostartAvailable} onChange=${(v) => shell.setAutostart(v)}
        hint=${info.autostartAvailable ? undefined : '실행 파일에서만 설정할 수 있습니다.'} />
      ${info.displays && info.displays.length > 1 && html`<${Field} label="표시할 모니터">${(id) => html`<select id=${id} class="input"
          value=${info.displayId} onChange=${(e) => shell.setDisplay(e.currentTarget.value)}>
          ${info.displays.map((d) => html`<option value=${d.id}>${d.label}</option>`)}
        </select>`}<//>`}
      <div class="btn-row">
        <button type="button" class="btn btn-sm btn-danger-ghost" onClick=${() => setConfirm('quit')}><${Icon} name="power" size=${14} /> 앱 종료</button>
      </div>
    </fieldset>`}
    <fieldset class="set-group">
      <legend class="set-title">데이터 · 백업</legend>
      <p class="field-hint">이 컴퓨터에만 저장 · 하루 한 번 자동 백업${info ? html` (<span class="path">${info.dataDir}</span>)` : ''}</p>
      <div class="btn-row">
        <button type="button" class="btn btn-sm" onClick=${doExport}><${Icon} name="arrow-down" size=${14} /> 백업 내보내기</button>
        <button type="button" class="btn btn-sm" onClick=${() => setConfirm('import')}><${Icon} name="arrow-up" size=${14} /> 백업 불러오기</button>
        ${isElectron && html`<button type="button" class="btn btn-sm" onClick=${() => shell.openDataDir()}><${Icon} name="external" size=${14} /> 데이터 폴더</button>`}
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-sm" onClick=${doClean} disabled=${cleaning}><${Icon} name="eraser" size=${14} /> ${cleaning ? '정리 중…' : '불필요한 캐시 삭제'}</button>
        <button type="button" class="btn btn-sm btn-danger-ghost" onClick=${() => setConfirm('reset')}><${Icon} name="trash" size=${14} /> 모든 데이터 초기화</button>
      </div>
      ${msg && html`<p class="field-hint" role="status">${msg}</p>`}
    </fieldset>
    ${isElectron && info && info.update && info.update.enabled && html`<${UpdateGroup} u=${info.update} />`}
    ${info && html`<p class="muted ver num">LazyWaffle v${info.version}</p>`}
    ${confirm === 'import' && html`<${Confirm} title="백업 불러오기" confirmLabel="불러오기" message="현재 데이터가 백업 파일 내용으로 바뀝니다. 계속할까요?"
      onConfirm=${() => { setConfirm(null); doImport(); }} onCancel=${() => setConfirm(null)} />`}
    ${confirm === 'quit' && html`<${Confirm} title="앱 종료" confirmLabel="종료" message="LazyWaffle을 종료할까요?"
      onConfirm=${() => shell.quit()} onCancel=${() => setConfirm(null)} />`}
    ${confirm === 'reset' && html`<${Confirm} title="초기화" danger confirmLabel="초기화" message="모든 데이터가 삭제됩니다. 계속할까요?"
      onConfirm=${() => { resetState(); setConfirm(null); setMsg('초기화했습니다.'); }} onCancel=${() => setConfirm(null)} />`}
  </div>`;
}

/* 설정 창 위치: 머리를 끌어 옮기고, 더블클릭하면 제자리. 이 컴퓨터에만 기억 */
const POS_KEY = 'deskcal:settings-pos';
function loadPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY));
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  } catch { /* 기억한 위치 없음 */ }
  return { x: 0, y: 0 };
}
function savePos(p) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch { /* 저장 못 해도 이번엔 그대로 */ }
}
/** 창이 화면 밖으로 나가지 않게 (p = 제자리에서 옮긴 거리) */
function clampPos(p, el) {
  if (!el) return p;
  const r = el.getBoundingClientRect();
  const cur = { x: parseFloat(el.style.getPropertyValue('--sx')) || 0, y: parseFloat(el.style.getPropertyValue('--sy')) || 0 };
  const left = r.left - cur.x;
  const top = r.top - cur.y;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 14;
  // 펼친 창은 아래 끝이 고정이라 내리면 짧아진다(최소 12rem) · 접은 창은 머리가 화면 안에만 있으면 된다
  const maxY = el.classList.contains('is-folded') ? window.innerHeight - r.height - top : r.bottom - top - rem * 12;
  return {
    x: Math.round(Math.min(window.innerWidth - r.width - left, Math.max(-left, p.x))),
    y: Math.round(Math.min(maxY, Math.max(-top, p.y))),
  };
}

export function Settings({ info, initialTab, onClose }) {
  const { settings } = useApp();
  // initialTab: '탭 이름' 또는 { tab, edit } (배너 이미지 추가 직후 편집기 열기)
  const init = typeof initialTab === 'object' && initialTab ? initialTab : { tab: initialTab };
  const initialEdit = init.edit;
  const [tab, setTab] = useState(init.tab || 'background');
  const ref = useRef(null);
  const [pos, setPos] = useState(loadPos);
  const [folded, setFolded] = useState(false); // 접으면 머리만 남아 뒤의 화면(바뀐 레이아웃)이 보인다
  useBus('settings:open', (t) => {
    setFolded(false);
    if (t) setTab(typeof t === 'object' ? t.tab : t);
  });
  // 모니터 · 창 크기가 바뀌었거나 탭이 넓어져 화면 밖으로 나갔으면 안으로
  useEffect(() => {
    const fit = () => setPos((p) => {
      const next = clampPos(p, ref.current);
      return next.x === p.x && next.y === p.y ? p : next;
    });
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [tab, folded]);

  function startMove(e) {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const el = e.currentTarget;
    capture(el, e);
    const sx = e.clientX;
    const sy = e.clientY;
    const start = pos;
    let last = start;
    const move = (ev) => {
      last = clampPos({ x: start.x + ev.clientX - sx, y: start.y + ev.clientY - sy }, ref.current);
      setPos(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      savePos(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  function resetPos(e) {
    if (e.target.closest('button')) return;
    setPos({ x: 0, y: 0 });
    savePos({ x: 0, y: 0 });
  }

  useEffect(() => {
    hold('settings');
    ref.current && ref.current.querySelector('[role=tab][aria-selected=true]').focus();
    return () => release('settings');
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape' && !e.target.closest('.popup-layer')) {
      e.stopPropagation();
      onClose();
    }
  }
  function tabKey(e) {
    const i = TABS.findIndex((t) => t.id === tab);
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(i + d + TABS.length) % TABS.length].id;
    setTab(next);
    setTimeout(() => ref.current.querySelector(`#st-tab-${next}`).focus(), 0);
  }

  return html`<aside class=${cx('settings', tab === 'layout' && 'is-wide', folded && 'is-folded')} ref=${ref} role="dialog" aria-modal="false" aria-labelledby="settings-title"
      onKeyDown=${onKeyDown} style=${{ '--sx': pos.x + 'px', '--sy': pos.y + 'px' }}>
    <header class="settings-head" onPointerDown=${startMove} onDblClick=${resetPos} title="끌어서 옮기기 · 더블클릭하면 제자리">
      <h2 id="settings-title" class="w-title">화면 설정</h2>
      <div class="settings-head-tools">
        <${IconButton} icon=${folded ? 'chev-down' : 'eye'} label=${folded ? '설정 펼치기' : '설정 접고 화면 보기'} pressed=${folded} onClick=${() => setFolded(!folded)} />
        <${IconButton} icon="x" label="설정 닫기" onClick=${onClose} />
      </div>
    </header>
    <div class="settings-tabs" role="tablist" aria-label="설정 분류" onKeyDown=${tabKey} hidden=${folded}>
      ${TABS.map((t) => html`<button type="button" role="tab" id=${'st-tab-' + t.id} aria-selected=${String(tab === t.id)} aria-controls="settings-panel"
        tabindex=${tab === t.id ? 0 : -1} class=${cx('settings-tab', tab === t.id && 'is-on')} onClick=${() => setTab(t.id)}>
        <${Icon} name=${t.icon} size=${15} /> ${t.label}</button>`)}
    </div>
    <div class="settings-body" id="settings-panel" role="tabpanel" aria-labelledby=${'st-tab-' + tab} hidden=${folded}>
      ${tab === 'background' && html`<${BackgroundTab} s=${settings} edit=${initialEdit} />`}
      ${tab === 'layout' && html`<${LayoutTab} s=${settings} />`}
      ${tab === 'stickers' && html`<${StickersTab} onClose=${onClose} />`}
      ${tab === 'general' && html`<${GeneralTab} s=${settings} info=${info} />`}
    </div>
  </aside>`;
}
