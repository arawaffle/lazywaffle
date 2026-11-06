import { html, useState, useEffect, useLayoutEffect, useRef, cx, useBus, bus } from '../lib.js';
import { useStoreState, StoreContext, layoutKey } from '../store.js';
import { shell, pickAndStoreImage } from '../storage.js';
import { setImageFill, measureImageFill } from '../actions.js';
import { textOn, averageHex, panelOn, mutedOn, meshSampler, rgbToHex } from '../util/color.js';
import { onModeChange, getMode, releaseAll, hold, release } from '../focus.js';
import { Fill } from './Fill.js';
import { Icon } from './icons.js';
import { Calendar } from './Calendar.js';
import { Checklist } from './Checklist.js';
import { Memo } from './Memo.js';
import { Pomodoro } from './Pomodoro.js';
import { DDay } from './DDay.js';
import { Ticker } from './Ticker.js';
import { Links, FreeLinks } from './Links.js';
import { Timetable } from './Timetable.js';
import { Ledger } from './Ledger.js';
import { Tooltip } from './Tooltip.js';
import { HoverCard } from './HoverCard.js';
import { Toast } from './Toast.js';
import { Stickers } from './Stickers.js';
import { Settings } from './Settings.js';

/** 콘텐츠 배경의 대표색 → 배경 위 글자를 흰색/검정 중 대비가 큰 쪽으로 (WCAG 명도 대비) */
function contentTone(s) {
  const f = s.background.fill;
  let hex = f.color || '#ffffff';
  if (f.type === 'mesh') hex = averageHex(s.mesh.palette);
  else if (f.type === 'image' && f.image) hex = f.avg || '#808080';
  const text = textOn(hex);
  return { hex, text, dark: text === '#ffffff' };
}

/** 배경 대표색 → 그 위 글자 · 패널 색 변수 (콘텐츠 전체 · 위젯 칸마다 같은 식) */
function toneVars(hex, panel) {
  const text = textOn(hex);
  const dark = text === '#ffffff';
  const panel2 = panelOn(hex);
  return {
    '--content-bg': hex,
    '--panel': panel2,
    '--text-2': mutedOn(text, [hex, panel2], 5.2),
    '--text-3': mutedOn(text, [hex, panel2], 4.7),
    '--glass': `${Math.round(panel * (dark ? 0.34 : 0.6))}%`,
  };
}

/**
 * 메시 그라데이션 배경: 색이 자리마다 달라 평균색 하나로는 어두운 곳의 글자가 안 보인다.
 * 위젯 칸마다 뒤에 깔린 실제 색(5×5 지점 평균)을 계산해 글자색을 #000 / #fff 로 따로 정한다.
 */
function useMeshTones(s, contentRef) {
  const [tones, setTones] = useState({});
  const on = s.background.fill.type === 'mesh';
  const key = on ? JSON.stringify([s.mesh.palette, s.mesh.seed, s[layoutKey(s)], s.banner.position, s.banner.size]) : '';
  useLayoutEffect(() => {
    if (!on || !contentRef.current) return undefined;
    const el = contentRef.current;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // .mesh-layer 는 콘텐츠보다 사방 20% 크게 깔린다 (layout.css)
      const sample = meshSampler(s.mesh.palette, (s.mesh.seed || 1) + 97, r.width * 1.4, r.height * 1.4);
      const next = {};
      el.querySelectorAll('.grid > .cell').forEach((cell) => {
        const b = cell.getBoundingClientRect();
        const acc = [0, 0, 0];
        for (let i = 0; i < 5; i++) {
          for (let j = 0; j < 5; j++) {
            const c = sample(b.left - r.left + (b.width * (i + 0.5)) / 5 + r.width * 0.2, b.top - r.top + (b.height * (j + 0.5)) / 5 + r.height * 0.2);
            for (let k = 0; k < 3; k++) acc[k] += c[k] / 25;
          }
        }
        next[cell.dataset.id] = rgbToHex(acc);
      });
      setTones((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);
  return on ? tones : {};
}

const COMPONENTS = { calendar: Calendar, checklist: Checklist, memo: Memo, pomodoro: Pomodoro, dday: DDay, ticker: Ticker, links: Links, timetable: Timetable, ledger: Ledger };

function useShellInfo() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!shell) return undefined;
    shell.info().then(setInfo);
    return shell.onInfo(setInfo);
  }, []);
  return info;
}

export function App() {
  const state = useStoreState();
  const info = useShellInfo();
  const [mode, setMode] = useState(getMode());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stickerEdit, setStickerEdit] = useState(false);
  const s = state.settings;

  useEffect(() => onModeChange(setMode), []);
  useEffect(() => (shell ? shell.onCommand((cmd) => cmd === 'open-settings' && setSettingsOpen(true)) : undefined), []);
  const [settingsTab, setSettingsTab] = useState(null);
  useBus('settings:open', (tab) => {
    setSettingsTab(tab || null);
    setSettingsOpen(true);
  });
  useBus('stickers:edit', (on) => setStickerEdit(on));

  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
  }, [s.theme]);

  // Esc (팝업 안에서 누르면 팝업이 먼저 처리한다) → 스티커 편집 · 열린 팝업 · 설정을 차례로 닫고, 없으면 바탕화면으로.
  // 입력 중인 팝업은 내용이 사라지지 않게 닫지 않고 포커스만 돌려준다 — 그 안에서 한 번 더 Esc 를 누르면 닫힌다
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const popups = document.querySelectorAll('.popup-layer .popup, .popover .popup');
      const top = popups[popups.length - 1];
      if (stickerEdit) setStickerEdit(false);
      else if (top && top.dataset.dirty) (top.querySelector('input, textarea, select, [contenteditable="true"]') || top.querySelector('.popup-close')).focus();
      else if (top) top.querySelector('.popup-close').click();
      else if (settingsOpen) setSettingsOpen(false);
      else releaseAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stickerEdit, settingsOpen]);

  const [confirmQuit, setConfirmQuit] = useState(false);
  // 종료 확인이 떠 있는 동안 Esc 로 닫을 수 있게 키보드를 받는다
  useEffect(() => {
    if (!confirmQuit) return undefined;
    hold('quit-confirm');
    const t = setTimeout(() => setConfirmQuit(false), 8000); // 실수로 눌렀을 때 저절로 닫힘
    const onKey = (e) => e.key === 'Escape' && setConfirmQuit(false);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      release('quit-confirm');
    };
  }, [confirmQuit]);

  const [picking, setPicking] = useState(false);
  async function addBannerImage() {
    setPicking(true);
    try {
      const url = await pickAndStoreImage(2560);
      if (url) {
        setImageFill('banner', url);
        bus.emit('settings:open', { tab: 'background', edit: 'banner' });
      }
    } finally {
      setPicking(false);
    }
  }

  // 평균색이 없는 배경 이미지(이전 버전 데이터)는 한 번 계산해 둔다
  const bgFill = s.background.fill;
  useEffect(() => {
    if (bgFill.type === 'image' && bgFill.image && !bgFill.avg) measureImageFill('background', bgFill.image).catch(() => {});
  }, [bgFill.type, bgFill.image, bgFill.avg]);

  const insets = (info && info.insets) || { top: 0, right: 0, bottom: 0, left: 0 };
  const banner = s.banner;
  const hasBanner = banner.position !== 'none';
  const bgMedia = bgFill.type === 'mesh' || (bgFill.type === 'image' && !!bgFill.image);
  const tone = contentTone(s);
  const freeLinks = s.linksMode === 'free';
  const contentRef = useRef(null);
  const cellTones = useMeshTones(s, contentRef);

  const style = {
    '--inset-top': insets.top + 'px',
    '--inset-right': insets.right + 'px',
    '--inset-bottom': insets.bottom + 'px',
    '--inset-left': insets.left + 'px',
    '--banner-size': banner.size + '%',
  };
  // 글래스 패널 진하기: 설정의 '위젯 바탕 불투명도'를 톤에 맞게 환산
  const panel = s.background.panel ?? 82;
  const contentStyle = toneVars(tone.hex, panel);

  // 스티커 편집 중에는 같은 자리의 스티커 패널(완료 · Esc)이 편집 모드 배지를 대신한다
  const showBadge = mode === 'edit' && !stickerEdit;
  // 배지의 '바탕화면으로': 설정을 연 채 내려가면 입력이 안 되는 설정 창만 남으므로 함께 닫는다
  function toDesktop() {
    setSettingsOpen(false);
    releaseAll();
  }

  return html`<${StoreContext.Provider} value=${state}>
    <div class=${cx('app', `banner-${hasBanner ? banner.position : 'none'}`, bgMedia && 'has-media-bg', !s.linksBg && 'no-links-bg', stickerEdit && 'is-sticker-edit')} style=${style}>
      ${hasBanner && html`<aside class="banner" aria-label="이미지 배너">
        <${Fill} fill=${banner.fill} mesh=${s.mesh} seedOffset=${0} label=${banner.fill.type === 'image' ? '배너 이미지' : undefined} />
        ${!banner.fill.image && html`<button type="button" class="banner-add" disabled=${picking} onClick=${addBannerImage}>
          <${Icon} name="plus" size=${15} /> 이미지 추가</button>`}
      </aside>`}
      <main class="content" aria-label="바탕화면 위젯" data-tone=${tone.dark ? 'dark' : 'light'} style=${contentStyle} ref=${contentRef}>
        <${Fill} fill=${s.background.fill} mesh=${s.mesh} seedOffset=${97} className="content-bg" />
        <div class="grid">
          ${s[layoutKey(s)].filter((l) => l.visible && COMPONENTS[l.id] && !(l.id === 'links' && freeLinks)).map((l) => {
            const C = COMPONENTS[l.id];
            const cellHex = cellTones[l.id];
            return html`<div class=${'cell cell-' + l.id} key=${l.id} data-id=${l.id}
                data-tone=${cellHex ? (textOn(cellHex) === '#ffffff' ? 'dark' : 'light') : undefined}
                style=${{ gridColumn: `${l.x + 1} / span ${l.w}`, gridRow: `${l.y + 1} / span ${l.h}`, ...(cellHex ? toneVars(cellHex, panel) : {}) }}>
              <${C} layout=${l} />
            </div>`;
          })}
        </div>
        ${settingsOpen && html`<${Settings} info=${info} initialTab=${settingsTab} onClose=${() => setSettingsOpen(false)} />`}
      </main>
      ${freeLinks && html`<${FreeLinks} editing=${stickerEdit} />`}
      <${Stickers} editing=${stickerEdit} onExitEdit=${() => setStickerEdit(false)} />
      <${Tooltip} />
      <${HoverCard} />
      <${Toast} />
      <div class="corner-tools" role="toolbar" aria-label="화면 도구">
        <button type="button" class="corner-btn" onClick=${() => setStickerEdit(!stickerEdit)} aria-pressed=${String(stickerEdit)} title="스티커 편집">
          <${Icon} name="sticker" /><span class="sr-only">스티커 편집</span>
        </button>
        <button type="button" class="corner-btn" onClick=${() => setSettingsOpen(!settingsOpen)} aria-expanded=${String(settingsOpen)} title="화면 설정">
          <${Icon} name="gear" /><span class="sr-only">화면 설정</span>
        </button>
        ${shell && html`<button type="button" class="corner-btn corner-quit" onClick=${() => setConfirmQuit(true)} aria-expanded=${String(confirmQuit)} title="앱 종료">
          <${Icon} name="power" /><span class="sr-only">앱 종료</span>
        </button>`}
        ${confirmQuit && html`<div class="quit-confirm" role="alertdialog" aria-labelledby="quit-msg">
          <span id="quit-msg">LazyWaffle을 종료할까요?</span>
          <button type="button" class="btn btn-sm" onClick=${() => setConfirmQuit(false)}>취소</button>
          <button type="button" class="btn btn-sm btn-primary" onClick=${() => shell.quit()} data-autofocus>종료</button>
        </div>`}
      </div>
      ${showBadge && html`<div class="mode-badge" role="status">
        <span>편집 모드</span>
        <button type="button" onClick=${toDesktop}>바탕화면으로 <kbd>Esc</kbd></button>
      </div>`}
    </div>
  <//>`;
}

