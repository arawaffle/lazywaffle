// 스티커: 화면 어디에나 붙이는 이미지. 링크를 넣으면 클릭 시 웹사이트로 이동한다.
// 편집 모드에서 드래그(이동) · 모서리(크기) · 상단 손잡이(회전) · 좌우반전 · 앞으로 · 삭제
import { html, useState, useEffect, useRef, cx, capture } from '../lib.js';
import { useApp } from '../store.js';
import { patchSticker, deleteSticker, bringStickerFront, addSticker } from '../actions.js';
import { openExternal, pickAndStoreImage } from '../storage.js';
import { hold, release } from '../focus.js';
import { Icon, IconButton } from './icons.js';
import { setLinksMode } from './Links.js';

function StickerItem({ st, editing, selected, onSelect }) {
  const [live, setLive] = useState(null); // 드래그 중 임시 값
  const ref = useRef(null);
  const v = { ...st, ...(live || {}) };

  function startDrag(e, kind) {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(st.id);
    const el = ref.current;
    capture(el, e);
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cxp = (v.x / 100) * W;
    const cyp = (v.y / 100) * H;
    const start = { px: e.clientX, py: e.clientY, x: v.x, y: v.y, w: v.w, rot: v.rot || 0 };
    const dist0 = Math.hypot(e.clientX - cxp, e.clientY - cyp) || 1;
    const ang0 = Math.atan2(e.clientY - cyp, e.clientX - cxp);
    let latest = null;
    const move = (ev) => {
      if (kind === 'move') {
        latest = {
          x: Math.min(100, Math.max(0, start.x + ((ev.clientX - start.px) / W) * 100)),
          y: Math.min(100, Math.max(0, start.y + ((ev.clientY - start.py) / H) * 100)),
        };
      } else if (kind === 'resize') {
        const d = Math.hypot(ev.clientX - cxp, ev.clientY - cyp);
        latest = { w: Math.min(80, Math.max(2, start.w * (d / dist0))) };
      } else if (kind === 'rotate') {
        const a = Math.atan2(ev.clientY - cyp, ev.clientX - cxp);
        let rot = start.rot + ((a - ang0) * 180) / Math.PI;
        if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
        latest = { rot: Math.round(rot) };
      }
      setLive(latest);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (latest) patchSticker(st.id, latest);
      setLive(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onKeyDown(e) {
    if (!editing) return;
    const step = e.shiftKey ? 5 : 1;
    const map = {
      ArrowLeft: { x: Math.max(0, v.x - step) }, ArrowRight: { x: Math.min(100, v.x + step) },
      ArrowUp: { y: Math.max(0, v.y - step) }, ArrowDown: { y: Math.min(100, v.y + step) },
      '+': { w: Math.min(80, v.w + 1) }, '=': { w: Math.min(80, v.w + 1) }, '-': { w: Math.max(2, v.w - 1) },
      '[': { rot: (v.rot || 0) - 15 }, ']': { rot: (v.rot || 0) + 15 },
    };
    if (map[e.key]) {
      e.preventDefault();
      patchSticker(st.id, map[e.key]);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      deleteSticker(st.id);
    }
  }

  const style = {
    left: v.x + '%', top: v.y + '%', width: v.w + 'vw', zIndex: v.z || 1,
    transform: `translate(-50%, -50%) rotate(${v.rot || 0}deg) scale(${v.flipX ? -1 : 1}, ${v.flipY ? -1 : 1})`,
  };
  const img = html`<img src=${st.src} alt="" draggable="false" />`;

  if (!editing) {
    if (!st.url) return html`<div class="sticker" style=${style} aria-hidden="true">${img}</div>`;
    return html`<button type="button" class="sticker is-link" style=${style} onClick=${() => openExternal(st.url)}
      title=${st.label || st.url} aria-label=${`${st.label || st.url} 열기, 새 창`}>${img}</button>`;
  }

  return html`<div ref=${ref} class=${cx('sticker is-editing', selected && 'is-selected')} style=${style} tabindex="0" role="group"
      aria-label=${`스티커 ${st.label || ''} (방향키 이동, +/- 크기, [ ] 회전, Delete 삭제)`}
      onPointerDown=${(e) => startDrag(e, 'move')} onFocus=${() => onSelect(st.id)} onKeyDown=${onKeyDown}>
    ${img}
    <span class="stk-handle stk-resize" onPointerDown=${(e) => startDrag(e, 'resize')} aria-hidden="true"></span>
    <span class="stk-handle stk-rotate" onPointerDown=${(e) => startDrag(e, 'rotate')} aria-hidden="true"></span>
  </div>`;
}

function StickerToolbar({ st, onClose }) {
  const [url, setUrl] = useState(st.url || '');
  const [label, setLabel] = useState(st.label || '');
  useEffect(() => {
    setUrl(st.url || '');
    setLabel(st.label || '');
  }, [st.id]);
  const commit = () => patchSticker(st.id, { url: url.trim(), label: label.trim() });
  // Enter·Esc 도 저장 (Esc 로 편집을 끝내면 입력란이 blur 없이 사라지므로)
  const onKey = (e) => (e.key === 'Enter' || e.key === 'Escape') && commit();
  return html`<div class="stk-toolbar" role="toolbar" aria-label="선택한 스티커">
    <${IconButton} icon="flipx" label="좌우 반전" onClick=${() => patchSticker(st.id, { flipX: !st.flipX })} />
    <${IconButton} icon="rotate" label="회전 초기화" onClick=${() => patchSticker(st.id, { rot: 0 })} />
    <${IconButton} icon="front" label="맨 앞으로" onClick=${() => bringStickerFront(st.id)} />
    <span class="tool-sep" aria-hidden="true"></span>
    <label class="sr-only" for="stk-label">이름</label>
    <input id="stk-label" class="input input-sm" placeholder="이름(선택)" value=${label} onInput=${(e) => setLabel(e.currentTarget.value)} onBlur=${commit} onKeyDown=${onKey} />
    <label class="sr-only" for="stk-url">링크 주소</label>
    <input id="stk-url" class="input input-sm stk-url" placeholder="https:// 링크(선택)" value=${url} onInput=${(e) => setUrl(e.currentTarget.value)}
      onBlur=${commit} onKeyDown=${onKey} />
    <span class="tool-sep" aria-hidden="true"></span>
    <${IconButton} icon="trash" label="스티커 삭제" onClick=${() => { deleteSticker(st.id); onClose(); }} />
  </div>`;
}

export function Stickers({ editing, onExitEdit }) {
  const { stickers, settings } = useApp();
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!editing) {
      setSelected(null);
      return undefined;
    }
    hold('sticker-edit');
    return () => release('sticker-edit');
  }, [editing]);

  async function add() {
    const src = await pickAndStoreImage(1200);
    if (src) addSticker({ src, x: 50, y: 45, w: 10 });
  }

  const sel = stickers.find((s) => s.id === selected);
  // 스티커 밖을 누르면 선택 해제 (레이어가 클릭을 막지 않으므로 문서 전체에서 감지)
  useEffect(() => {
    if (!editing) return undefined;
    const off = (e) => { if (!e.target.closest('.sticker, .stk-panel')) setSelected(null); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [editing]);

  // 편집 패널은 스티커 레이어(클릭 통과, z-index 30) 밖에 두어야 클릭을 받고 팝업·배지 아래에 깔리지 않는다
  return html`<div class=${cx('sticker-layer', editing && 'is-editing')}>
      ${stickers.map((st) => html`<${StickerItem} key=${st.id} st=${st} editing=${editing} selected=${selected === st.id} onSelect=${setSelected} />`)}
    </div>
    ${editing && html`<div class="stk-panel" role="region" aria-label="스티커 편집">
      <strong class="stk-panel-title">스티커 · 바로가기 편집 중</strong>
      <span class="muted stk-hint">끝내려면 완료 또는 Esc</span>
      <button type="button" class="btn btn-sm" onClick=${add}><${Icon} name="image" size=${14} /> 이미지 스티커 추가</button>
      ${sel && html`<${StickerToolbar} st=${sel} onClose=${() => setSelected(null)} />`}
      ${!sel && html`<span class="muted stk-hint">${stickers.length ? '스티커를 선택해 편집' : ''}</span>`}
      ${settings.linksMode === 'free' && html`<button type="button" class="btn btn-sm" onClick=${() => setLinksMode('list')}><${Icon} name="list" size=${14} /> 바로가기 리스트형으로</button>`}
      <button type="button" class="btn btn-primary btn-sm" onClick=${onExitEdit}>완료</button>
    </div>`}`;
}
