// 메모: 즐겨찾기한 메모가 있으면 그 메모(여러 개면 화살표 · 점으로 넘겨 보는 슬라이드)를, 없으면 에디터를 첫 화면으로 보여준다.
// 목록에서 제목 옆 연필(마우스를 올리면 보임)로 제목을 고칠 수 있다 (비우면 첫 줄이 제목). 에디터의 이미지는 눌러서 크기를 바꾼다.
import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { useApp } from '../store.js';
import { saveMemo, deleteMemo, toggleFavMemo, renameMemo, setMemoDraft } from '../actions.js';
import { pickImageFile, storeImage } from '../storage.js';
import { fmtDate, ymd } from '../util/date.js';
import { Confirm } from './Popup.js';
import { Icon, IconButton } from './icons.js';

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'H3', 'BLOCKQUOTE', 'IMG']);
// 메모 이미지: 앱이 저장한 이미지(app://desk/assets/…, 브라우저 실행은 data:image)만 허용
const IMG_SRC = /^(app:\/\/desk\/assets\/[\w.-]+|data:image\/(png|jpeg|webp|gif);base64,[\w+/=]+)$/;
const MEMO_IMAGE_MAX = 1600;
// 이미지 크기: 메모 폭에 대한 % (style="width: N%" 만 남긴다)
const IMG_WIDTH = /^(\d{1,3})(\.\d+)?%$/;
const IMG_MIN = 10;
// 글자 정렬: 문단 태그의 style="text-align: …" 만 남긴다
const ALIGN_TAGS = new Set(['P', 'DIV', 'H3', 'BLOCKQUOTE', 'LI']);
const ALIGNS = new Set(['center', 'right', 'justify']);

/** 허용된 태그만 남기고 속성은 모두 제거 (이미지는 허용된 src와 너비, 문단은 정렬만 남긴다) */
export function sanitize(dirty) {
  const doc = new DOMParser().parseFromString(`<body>${dirty}</body>`, 'text/html');
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === 1) {
        walk(child);
        if (!ALLOWED.has(child.tagName)) return child.replaceWith(...child.childNodes);
        const src = child.tagName === 'IMG' ? child.getAttribute('src') || '' : null;
        const width = src !== null ? child.style.width : '';
        const align = ALIGN_TAGS.has(child.tagName) ? child.style.textAlign : '';
        [...child.attributes].forEach((a) => child.removeAttribute(a.name));
        if (ALIGNS.has(align)) child.style.textAlign = align;
        if (src === null) return;
        if (IMG_SRC.test(src)) {
          child.setAttribute('src', src);
          child.setAttribute('alt', '');
          const m = IMG_WIDTH.exec(width);
          if (m && +m[1] >= IMG_MIN && +m[1] < 100) child.style.width = `${Math.round(parseFloat(width))}%`;
        } else child.remove();
      } else if (child.nodeType !== 3) child.remove();
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function memoTitle(m) {
  if (m.title) return m.title;
  const withBreaks = m.html.replace(/<(br|\/div|\/p|\/li|\/h3|\/blockquote)[^>]*>|<div>/gi, '\n');
  const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent || '';
  const line = text.split('\n').map((s) => s.trim()).find(Boolean);
  return line ? line.slice(0, 40) : /<img/i.test(m.html) ? '(이미지 메모)' : '(빈 메모)';
}

const TOOLS = [
  { cmd: 'bold', icon: 'B', label: '굵게', cls: 'b' },
  { cmd: 'italic', icon: 'I', label: '기울임', cls: 'i' },
  { cmd: 'underline', icon: 'U', label: '밑줄', cls: 'u' },
  { cmd: 'strikeThrough', icon: 'S', label: '취소선', cls: 's' },
  { sep: true },
  { cmd: 'formatBlock', arg: 'H3', icon: 'H', label: '제목' },
  { cmd: 'insertUnorderedList', iconName: 'list-ul', label: '글머리 목록' },
  { cmd: 'insertOrderedList', iconName: 'list-ol', label: '번호 목록' },
  { cmd: 'formatBlock', arg: 'BLOCKQUOTE', iconName: 'quote', label: '인용' },
  { align: true },
  { cmd: 'removeFormat', iconName: 'eraser', label: '서식 지우기', clear: true },
  { sep: true },
  { image: true, iconName: 'image', label: '이미지 넣기' },
];
// 글자 정렬은 버튼 하나: 누를 때마다 왼쪽 → 가운데 → 오른쪽
const ALIGN_STEPS = [
  { value: 'left', cmd: 'justifyLeft', label: '왼쪽' },
  { value: 'center', cmd: 'justifyCenter', label: '가운데' },
  { value: 'right', cmd: 'justifyRight', label: '오른쪽' },
];

function alignOf(el) {
  const v = getComputedStyle(el).textAlign;
  return v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : 'left';
}

function AlignTool({ align, onClick }) {
  const i = ALIGN_STEPS.findIndex((a) => a.value === align);
  const label = `글자 정렬: ${ALIGN_STEPS[i].label} (누르면 ${ALIGN_STEPS[(i + 1) % ALIGN_STEPS.length].label})`;
  return html`<button type="button" class=${cx('tool', align !== 'left' && 'is-on')} aria-label=${label} title=${label}
    onMouseDown=${(e) => e.preventDefault()} onClick=${onClick}><${Icon} name=${'align-' + align} size=${14} /></button>`;
}

const hasContent = (el) => !!(el.textContent.trim() || el.querySelector('li, img'));

/** 에디터에서 누른 이미지 둘레의 크기 조절 틀: 오른쪽 아래 손잡이를 끌거나 25 · 50 · 75 · 100% 버튼 */
function ImageSizer({ img, area, onChange }) {
  const now = parseFloat(img.style.width) || 100;
  const areaWidth = () => {
    const cs = getComputedStyle(area);
    return area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const setPct = (p) => {
    const v = Math.max(IMG_MIN, Math.min(100, Math.round(p)));
    img.style.width = v >= 100 ? '' : v + '%';
    if (!img.getAttribute('style')) img.removeAttribute('style');
    onChange(false);
  };
  function drag(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* 캡처 없이도 동작 */ }
    const sx = e.clientX;
    const sw = img.getBoundingClientRect().width;
    const aw = areaWidth();
    const move = (ev) => setPct(((sw + ev.clientX - sx) / aw) * 100);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onChange(true);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  const box = { top: img.offsetTop + 'px', left: img.offsetLeft + 'px', width: img.offsetWidth + 'px', height: img.offsetHeight + 'px' };
  return html`<div class="img-sizer" style=${box}>
    <div class="img-sizer-bar" role="group" aria-label="이미지 크기" onMouseDown=${(e) => e.preventDefault()}>
      ${[25, 50, 75, 100].map((p) => html`<button type="button" key=${p} class=${cx('img-sizer-btn', Math.round(now) === p && 'is-on')}
        onClick=${() => { setPct(p); onChange(true); }}>${p}%</button>`)}
    </div>
    <span class="img-sizer-handle" title="끌어서 크기 조절" onPointerDown=${drag}></span>
    <span class="img-sizer-pct num" aria-hidden="true">${Math.round(now)}%</span>
  </div>`;
}

function Editor({ initial, onSave, onCancel, onDraft }) {
  const ref = useRef(null);
  const [active, setActive] = useState({});
  const [empty, setEmpty] = useState(!initial);
  const draftTimer = useRef(null);
  const savedRange = useRef(null); // 파일 선택 창이 뜨면 커서 위치를 잃으므로 이미지를 넣을 자리를 기억
  const [busy, setBusy] = useState(false);
  const [imgSel, setImgSel] = useState(null); // 크기 조절 중인 이미지
  const [, setTick] = useState(0); // 이미지 크기 · 글이 바뀌면 조절 틀 위치 다시 계산
  const selImg = imgSel && ref.current && ref.current.contains(imgSel) ? imgSel : null;
  const align = selImg ? alignOf(selImg.parentElement) : active.align || 'left';

  useEffect(() => {
    // 저장할 때와 같은 규칙으로 정리해서 넣는다 (초안 · 백업에서 불러온 메모에 허용하지 않은 태그 · 속성이 있어도)
    ref.current.innerHTML = sanitize(initial || '');
    setEmpty(!hasContent(ref.current));
    const onSel = () => {
      if (!ref.current || !ref.current.contains(document.getSelection().anchorNode)) return;
      const st = {};
      TOOLS.forEach((t) => {
        if (!t.cmd || t.arg || t.clear) return;
        try { st[t.cmd] = document.queryCommandState(t.cmd); } catch { /* 무시 */ }
      });
      st.align = (ALIGN_STEPS.find((a) => a.value !== 'left' && document.queryCommandState(a.cmd)) || ALIGN_STEPS[0]).value;
      const block = (document.queryCommandValue('formatBlock') || '').toUpperCase();
      st.H3 = block === 'H3';
      st.BLOCKQUOTE = block === 'BLOCKQUOTE';
      setActive(st);
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      clearTimeout(draftTimer.current);
    };
  }, []);

  function rememberCaret() {
    const sel = document.getSelection();
    savedRange.current = sel.rangeCount && ref.current.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  }

  /** 이미지를 줄여서(긴 변 1600px) 앱 데이터에 저장하고, 기억해 둔 커서 자리(없으면 끝)에 넣는다 */
  async function insertImages(blobs) {
    const files = blobs.filter((b) => b && /^image\/(png|jpeg|webp|gif)$/.test(b.type));
    if (!files.length) return;
    setBusy(true);
    try {
      for (const blob of files) {
        const url = await storeImage(blob, MEMO_IMAGE_MAX);
        if (!url || !ref.current) continue;
        ref.current.focus();
        const sel = document.getSelection();
        sel.removeAllRanges();
        if (savedRange.current) sel.addRange(savedRange.current);
        else {
          const end = document.createRange();
          end.selectNodeContents(ref.current);
          end.collapse(false);
          sel.addRange(end);
        }
        document.execCommand('insertImage', false, url);
        rememberCaret();
      }
      changed();
    } finally {
      setBusy(false);
    }
  }

  async function pickImage() {
    rememberCaret();
    const blob = await pickImageFile();
    if (blob) await insertImages([blob]);
  }

  function exec(t) {
    if (t.image) return pickImage();
    ref.current.focus();
    if (t.align) {
      const i = ALIGN_STEPS.findIndex((a) => a.value === align);
      const next = ALIGN_STEPS[(i + 1) % ALIGN_STEPS.length];
      // 눌러 둔 이미지가 있으면 그 이미지 줄만 정렬 (브라우저가 이미지를 새로 만들 수 있어 몇 번째 이미지인지로 다시 찾는다)
      const imgAt = selImg ? [...ref.current.querySelectorAll('img')].indexOf(selImg) : -1;
      const selectImg = (img) => {
        const r = document.createRange();
        r.selectNode(img);
        const sel = document.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      };
      if (selImg) selectImg(selImg);
      document.execCommand(next.cmd, false, null);
      setActive((st) => ({ ...st, align: next.value }));
      const img = imgAt >= 0 && ref.current.querySelectorAll('img')[imgAt];
      if (img) {
        selectImg(img);
        setImgSel(img);
      }
    } else if (t.cmd === 'formatBlock') {
      const cur = (document.queryCommandValue('formatBlock') || '').toUpperCase();
      document.execCommand('formatBlock', false, cur === t.arg ? 'P' : t.arg);
    } else {
      document.execCommand(t.cmd, false, null);
      if (t.clear) document.execCommand('formatBlock', false, 'P');
    }
    changed();
  }

  function changed() {
    setTick((n) => n + 1);
    setEmpty(!hasContent(ref.current));
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => onDraft(ref.current.innerHTML), 800);
  }

  function save() {
    const clean = sanitize(ref.current.innerHTML);
    if (!hasContent(ref.current)) return;
    clearTimeout(draftTimer.current);
    onSave(clean);
  }

  return html`<div class="editor">
    <div class="editor-tools" role="toolbar" aria-label="글자 서식">
      ${TOOLS.map((t, i) => t.sep ? html`<span class="tool-sep" key=${i} aria-hidden="true"></span>` : t.align ? html`<${AlignTool} key=${i} align=${align} onClick=${() => exec(t)} />` : html`<button type="button" key=${i}
          class=${cx('tool', t.cls && 'tool-' + t.cls, (t.arg ? active[t.arg] : active[t.cmd]) && 'is-on')}
          aria-label=${t.label} title=${t.label} aria-pressed=${t.clear || t.image ? undefined : String(!!(t.arg ? active[t.arg] : active[t.cmd]))}
          disabled=${t.image && busy} onMouseDown=${(e) => e.preventDefault()} onClick=${() => exec(t)}>
          ${t.iconName ? html`<${Icon} name=${t.iconName} size=${14} />` : html`<span aria-hidden="true">${t.icon}</span>`}
        </button>`)}
    </div>
    <div class="editor-area-wrap">
      <div ref=${ref} class="editor-area" contenteditable="true" role="textbox" aria-multiline="true" aria-label="메모 내용"
        onClick=${(e) => setImgSel(e.target.tagName === 'IMG' ? e.target : null)}
        onKeyUp=${() => imgSel && setImgSel(null)}
        onInput=${changed}
        onPaste=${(e) => {
          e.preventDefault();
          const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (images.length) {
            rememberCaret();
            insertImages(images);
          } else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        onDragOver=${(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith('image/'))) e.preventDefault(); }}
        onDrop=${(e) => {
          const images = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
          if (!images.length) return;
          e.preventDefault();
          const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
          savedRange.current = pos && ref.current.contains(pos.startContainer) ? pos : null;
          insertImages(images);
        }}
        onKeyDown=${(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
        }}></div>
      ${empty && html`<span class="editor-placeholder" aria-hidden="true">메모 (Ctrl+S 저장)</span>`}
      ${selImg && html`<${ImageSizer} img=${selImg} area=${ref.current} onChange=${(done) => (done ? changed() : setTick((n) => n + 1))} />`}
    </div>
    <div class="editor-actions">
      ${onCancel && html`<button type="button" class="btn btn-sm" onClick=${onCancel}>취소</button>`}
      <button type="button" class="btn btn-primary btn-sm" onClick=${save}>저장</button>
    </div>
  </div>`;
}

/** 제목 고치기 (목록의 연필 버튼 · F2) — Enter · 바깥 누르기 저장, Esc 취소, 비우면 첫 줄이 제목 */
function RenameInput({ memo, onDone }) {
  const done = useRef(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current.focus();
    inputRef.current.select();
  }, []);
  const finish = (save, value) => {
    if (done.current) return;
    done.current = true;
    if (save) renameMemo(memo.id, value);
    onDone();
  };
  return html`<input ref=${inputRef} class="input input-sm memo-rename" value=${memo.title || ''} placeholder=${memoTitle({ ...memo, title: null })}
    maxlength="60" aria-label="메모 제목 (비우면 첫 줄)"
    onKeyDown=${(e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true, e.currentTarget.value); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    }}
    onBlur=${(e) => finish(true, e.currentTarget.value)} />`;
}

/**
 * 즐겨찾기 메모 보기: 여러 개면 좌우 화살표 · 점으로 넘긴다 (자동으로 넘어가지 않음).
 * 보고 있던 메모(currentId)는 위젯이 기억한다 — 수정하고 돌아와도 그 메모가 그대로 보이게.
 */
function FavSlider({ favs, currentId, onPick, onEdit }) {
  const [dir, setDir] = useState(0);
  const i = Math.max(0, favs.findIndex((f) => f.id === currentId));
  const m = favs[i];
  const many = favs.length > 1;
  const show = (j, d) => {
    setDir(d);
    onPick(favs[j].id);
  };
  const go = (n) => show((i + n + favs.length) % favs.length, n);
  return html`<article class="memo-main" aria-label="즐겨찾기 메모" aria-roledescription=${many ? '슬라이드' : undefined}
      onKeyDown=${(e) => {
        if (!many || e.target.closest('input, textarea')) return;
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      }}>
    <div class="memo-slide">
      <div class=${cx('memo-content', dir > 0 && 'slide-next', dir < 0 && 'slide-prev')} key=${m.id}
        dangerouslySetInnerHTML=${{ __html: sanitize(m.html) }}></div>
    </div>
    ${many && html`<div class="memo-dots" role="group" aria-label="메모 고르기">
      <button type="button" class="memo-arrow" aria-label="이전 메모" onClick=${() => go(-1)}><${Icon} name="chev-left" size=${14} /></button>
      ${favs.map((f, j) => html`<button type="button" key=${f.id} class=${cx('memo-dot', j === i && 'is-on')} aria-label=${`${j + 1}번째 메모: ${memoTitle(f)}`}
        aria-current=${j === i ? 'true' : undefined} onClick=${() => show(j, j > i ? 1 : j < i ? -1 : 0)}></button>`)}
      <button type="button" class="memo-arrow" aria-label="다음 메모" onClick=${() => go(1)}><${Icon} name="chev-right" size=${14} /></button>
    </div>`}
    <footer class="memo-main-foot">
      <strong class="memo-main-title" title=${memoTitle(m)}>${memoTitle(m)}</strong>
      <span class="memo-main-meta">
        <span class="muted num">${fmtDate(ymd(new Date(m.updatedAt)), { week: false })}</span>
        <button type="button" class="btn btn-sm" onClick=${() => onEdit(m.id)}><${Icon} name="edit" size=${13} /> 수정</button>
      </span>
    </footer>
  </article>`;
}

export function Memo() {
  const { memos, favMemoIds, memoDraft } = useApp();
  const favs = (favMemoIds || []).map((id) => memos.find((m) => m.id === id)).filter(Boolean);
  const hasFav = favs.length > 0;
  const [view, setView] = useState(hasFav ? 'main' : 'editor');
  const [editingId, setEditingId] = useState(memoDraft ? memoDraft.id || null : null);
  const [editorKey, setEditorKey] = useState(0);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [slideId, setSlideId] = useState(null); // 즐겨찾기 슬라이드에서 보고 있는 메모

  useEffect(() => {
    if (view === 'main' && !hasFav) setView('editor');
  }, [hasFav, view]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const editing = editingId ? memos.find((m) => m.id === editingId) : null;
  const initial = memoDraft && (memoDraft.id || null) === (editingId || null) ? memoDraft.html : editing ? editing.html : '';

  function openEditor(id) {
    setEditingId(id);
    setEditorKey((k) => k + 1);
    setView('editor');
  }
  function onSave(cleanHtml) {
    saveMemo({ id: editingId, html: cleanHtml });
    if (editingId) setSlideId(editingId); // 즐겨찾기 메모를 고쳤으면 돌아가서 그 메모를 보여준다
    setToast('저장되었습니다.');
    setEditingId(null);
    setEditorKey((k) => k + 1);
    if (hasFav) setView('main');
  }
  function cancelEdit() {
    setMemoDraft(null);
    setEditingId(null);
    setEditorKey((k) => k + 1);
    setView(hasFav ? 'main' : 'list');
  }

  return html`<section class="widget w-memo" aria-labelledby="memo-title">
    <header class="memo-head">
      <h2 id="memo-title" class="w-title">MEMO</h2>
      <div class="memo-tools">
        ${view !== 'list' && html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => setView('list')}>
          <${Icon} name="list" size=${14} /> 목록보기 <span class="count num">${memos.length}</span></button>`}
        ${view === 'list' && html`<button type="button" class="btn btn-ghost btn-sm" onClick=${() => (hasFav ? setView('main') : openEditor(null))}>
          <${Icon} name="chev-left" size=${14} /> 돌아가기</button>`}
        ${(view === 'main' || view === 'list') && html`<button type="button" class="btn btn-primary btn-sm" onClick=${() => openEditor(null)}>
          <${Icon} name="plus" size=${14} /> 메모 입력</button>`}
      </div>
    </header>

    <div class="memo-body">
      ${view === 'main' && hasFav && html`<${FavSlider} favs=${favs} currentId=${slideId} onPick=${setSlideId} onEdit=${openEditor} />`}

      ${view === 'editor' && html`<${Editor} key=${editorKey} initial=${initial}
        onSave=${onSave} onDraft=${(h) => setMemoDraft({ id: editingId, html: h })}
        onCancel=${editingId || hasFav || memos.length ? cancelEdit : null} />`}

      ${view === 'list' && html`${memos.length ? html`<ul class="memo-list">
        ${memos.map((m) => {
          const fav = (favMemoIds || []).includes(m.id);
          // 날짜 · 빈 자리를 눌러도 연다 (버튼 · 입력칸 제외)
          return html`<li class="memo-item" key=${m.id} onClick=${(e) => !renaming && !e.target.closest('button, input') && openEditor(m.id)}>
            ${renaming === m.id
              ? html`<${RenameInput} memo=${m} onDone=${() => setRenaming(null)} />`
              : html`<button type="button" class="memo-open" onClick=${() => openEditor(m.id)}
                  onKeyDown=${(e) => { if (e.key === 'F2') { e.preventDefault(); setRenaming(m.id); } }}>
                <span class="memo-item-title">${memoTitle(m)}</span>
              </button>
              <${IconButton} icon="edit" size=${13} label="제목 수정" className="memo-rename-btn" onClick=${() => setRenaming(m.id)} />
              <span class="memo-date muted num">${fmtDate(ymd(new Date(m.updatedAt)), { week: false })}</span>`}
            <${IconButton} icon="star" filled=${fav} pressed=${fav} className=${cx('star', fav && 'is-on')}
              label=${fav ? '즐겨찾기 해제' : '즐겨찾기 (메인에서 보기)'} onClick=${() => toggleFavMemo(m.id)} />
            <${IconButton} icon="trash" label="메모 삭제" className="memo-del" onClick=${() => setConfirm(m)} />
          </li>`;
        })}
      </ul>` : html`<p class="empty">저장된 메모가 없습니다.</p>`}`}
    </div>
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
    ${confirm && html`<${Confirm} title="메모 삭제" danger confirmLabel="삭제" message=${`'${memoTitle(confirm)}' 메모를 삭제할까요?`}
      onConfirm=${() => { deleteMemo(confirm.id); setConfirm(null); }} onCancel=${() => setConfirm(null)} />`}
  </section>`;
}
