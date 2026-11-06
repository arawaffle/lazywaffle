// 캘린더 날짜 칸 이미지: 일정 등록 창의 '칸 이미지' 탭에서 넣는다.
// 날짜 · '+N' · 용돈 합계 글자는 이미지 색을 읽어 흰~검정 사이 회색으로 맞추고, 직접 고를 수도 있다.
import { html, cx, useState, useRef, useEffect, useSize } from '../lib.js';
import { pickAndCopyImage } from '../storage.js';
import { croppedAverage, grayOn, hexToRgb, rgbToHex } from '../util/color.js';
import { shrinkTo } from '../util/icon.js';
import { parse } from '../util/date.js';
import { Segmented, Range } from './controls.js';
import { Icon } from './icons.js';
import { useNaturalSize, imageLayout } from './Fill.js';
import { ImageEditor } from './ImageEditor.js';

const IMAGE_MAX = 1600; // 저장 크기 (긴 변)
const PREVIEW_W = 240; // 미리보기 너비(px) — 실제 칸을 그대로 키워 보여준다

/** 실제 날짜 칸 크기 (테두리 안쪽). 그 날짜 칸이 화면에 없으면 아무 칸이나 (칸 크기는 모두 같다) */
function cellSize(date) {
  const el = document.querySelector(`.cal-grid .cal-day[data-drop-date="${date}"]`) || document.querySelector('.cal-grid .cal-day');
  return el && el.clientWidth && el.clientHeight ? { w: el.clientWidth, h: el.clientHeight } : { w: 100, h: 72 };
}

/** 크롭한 부분의 평균색 위에서 읽히는 회색 (사진은 칸 안에서도 밝기가 달라 대비 7:1 로 넉넉히) */
export async function toneOf(image, view, aspect) {
  try {
    return grayOn(await croppedAverage(image, view, aspect), 7);
  } catch {
    return '#111111';
  }
}

/** 글자 회색 → 밝기 % (0 = 검정, 100 = 흰색) */
const lightOf = (hex) => Math.round((hexToRgb(hex)[0] / 255) * 100);
const grayAt = (pct) => {
  const v = Math.round((pct / 100) * 255);
  return rgbToHex([v, v, v]);
};

/** 칸 글자 둘레의 옅은 그림자: 글자와 반대쪽 색 */
export const haloOf = (ink) => (lightOf(ink) >= 50 ? 'rgba(0, 0, 0, .45)' : 'rgba(255, 255, 255, .6)');

const fillOf = (img) => ({ type: 'image', image: img.image, view: img.view || { zoom: 1, cx: 0.5, cy: 0.5 }, fit: img.fit || 'cover' });

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
}

/**
 * 칸 안에서 이미지가 그려질 자리(px, 정수)와 원본에서 잘라 올 부분.
 * size(%) 만큼 줄인 영역을 pos([0~1, 0~1]) 쪽에 두고, 그 안에 맞춤(채우기 · 전체 보기) · 크롭을 적용한다.
 */
function placeImage(img, nat, cell) {
  const k = (img.size || 100) / 100;
  const box = { width: cell.width * k, height: cell.height * k };
  const lay = imageLayout(nat, box, fillOf(img));
  if (!lay) return null;
  const [ax, ay] = img.pos || [0.5, 0.5];
  const rx = (cell.width - box.width) * ax;
  const ry = (cell.height - box.height) * ay;
  const x0 = Math.max(0, lay.x);
  const y0 = Math.max(0, lay.y);
  const x1 = Math.min(box.width, lay.x + lay.W);
  const y1 = Math.min(box.height, lay.y + lay.H);
  const s = lay.W / nat.w;
  return {
    left: Math.round(rx + x0), top: Math.round(ry + y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0),
    src: { x: (x0 - lay.x) / s, y: (y0 - lay.y) / s, w: (x1 - x0) / s, h: (y1 - y0) / s },
    css: { size: `${lay.W}px ${lay.H}px`, pos: `${lay.x - x0}px ${lay.y - y0}px` },
  };
}

/**
 * 보이는 부분만 실제 픽셀 크기로 미리 줄인 사본(blob URL).
 * 큰 이미지를 CSS 로 작은 칸에 한 번에 줄이면 계단 현상(깨짐)이 생겨서, 절반씩 고품질 축소한다.
 */
function useCrispCrop(image, place) {
  const [url, setUrl] = useState(null);
  const urlRef = useRef(null);
  const dpr = window.devicePixelRatio || 1;
  const tw = place ? Math.round(place.width * dpr) : 0;
  const th = place ? Math.round(place.height * dpr) : 0;
  const key = tw > 0 && th > 0 ? `${image}|${Object.values(place.src).map((n) => n.toFixed(2))}|${tw}x${th}` : null;
  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    const { x, y, w, h } = place.src;
    const timer = setTimeout(async () => {
      try {
        const canvas = shrinkTo(await loadImage(image), x, y, w, h, tw, th);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        if (!alive || !blob) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setUrl({ key, src: urlRef.current });
      } catch {
        // 실패하면 원본을 CSS 로 그린 화면 그대로
      }
    }, 120); // 창 크기를 바꾸는 동안에는 다시 그리지 않음
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key]);
  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), []);
  return url && url.key === key ? url.src : null;
}

/** 날짜 칸 이미지 면 (부모 상자를 채움) */
export function DayImg({ img, className }) {
  const ref = useRef(null);
  const cell = useSize(ref);
  const nat = useNaturalSize(img.image);
  const place = nat && cell.width > 0 ? placeImage(img, nat, cell) : null;
  const crisp = useCrispCrop(img.image, place);
  const style = place && {
    left: place.left + 'px', top: place.top + 'px', width: place.width + 'px', height: place.height + 'px',
    ...(crisp ? { backgroundImage: `url("${crisp}")`, backgroundSize: '100% 100%' }
      : { backgroundImage: `url("${img.image}")`, backgroundSize: place.css.size, backgroundPosition: place.css.pos }),
  };
  return html`<div ref=${ref} class=${cx('fill', className)} aria-hidden="true">
    ${style && html`<div class="day-img-pic" style=${style}></div>`}
  </div>`;
}

const POS = [0, 0.5, 1];
const POS_LABEL = [['왼쪽 위', '위', '오른쪽 위'], ['왼쪽', '가운데', '오른쪽'], ['왼쪽 아래', '아래', '오른쪽 아래']];

/** 칸 안 위치 (3×3) */
function PosPicker({ value, onChange }) {
  const [ax, ay] = value || [0.5, 0.5];
  return html`<div class="field">
    <span class="field-label" id="di-pos-label">위치</span>
    <div class="di-pos" role="radiogroup" aria-labelledby="di-pos-label">
      ${POS.map((y, r) => POS.map((x, c) => {
        const on = ax === x && ay === y;
        return html`<button type="button" role="radio" aria-checked=${String(on)} aria-label=${POS_LABEL[r][c]} title=${POS_LABEL[r][c]}
          class=${cx('di-pos-cell', on && 'is-on')} onClick=${() => onChange([x, y])}></button>`;
      }))}
    </div>
  </div>`;
}

/** 일정 등록 창의 '칸 이미지' 탭. value: { image, view, fit, size, pos, tone, ink } | null */
export function DayImagePanel({ date, value, onChange }) {
  const [cell] = useState(() => cellSize(date));
  const aspect = cell.w / cell.h;
  const k = Math.min(3, Math.max(1, PREVIEW_W / cell.w)); // 실제 칸 → 미리보기 배율 (글자도 같은 배율)
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const img = value;
  const ink = img ? img.ink || img.tone : '#111111';
  const size = img ? img.size || 100 : 100;

  async function change(next) {
    onChange({ ...next, tone: await toneOf(next.image, next.view, aspect) });
  }
  async function pick() {
    setBusy(true);
    try {
      const url = await pickAndCopyImage(IMAGE_MAX);
      if (!url) return;
      // 새 이미지는 칸을 꽉 채운 상태로 시작
      await change({ image: url, view: null, fit: 'cover', size: 100, pos: [0.5, 0.5], ink: img ? img.ink : null });
      setEditing(true); // 고른 직후 바로 크롭
    } finally {
      setBusy(false);
    }
  }

  return html`<div class="di-wrap">
    <div class="di-preview" style=${{ width: cell.w * k + 'px', height: cell.h * k + 'px', '--k': k, '--day-ink': ink, '--day-halo': haloOf(ink) }}>
      ${img ? html`<${DayImg} img=${img} />` : html`<span class="di-empty muted">이미지 없음</span>`}
      <span class="di-date num" aria-hidden="true">${parse(date).getDate()}</span>
      ${img && html`<span class="di-more num" aria-hidden="true">+1</span><span class="di-money num" aria-hidden="true">−12,000</span>`}
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-sm" onClick=${pick} disabled=${busy}><${Icon} name="image" size=${14} /> ${busy ? '여는 중…' : img ? '다른 이미지' : '이미지 선택'}</button>
      ${img && html`<button type="button" class="btn btn-sm" onClick=${() => setEditing(true)}><${Icon} name="edit" size=${14} /> 크롭</button>
        <button type="button" class="btn btn-sm btn-danger-ghost" onClick=${() => onChange(null)}><${Icon} name="trash" size=${14} /> 제거</button>`}
    </div>
    ${img && html`<div class="di-controls">
      <${Segmented} label="맞춤" size="sm" value=${img.fit || 'cover'} onChange=${(fit) => onChange({ ...img, fit })}
        options=${[{ value: 'cover', label: '영역 채우기' }, { value: 'contain', label: '전체 보기' }]} />
      <${Range} label="칸 안 크기" value=${size} min=${30} max=${100} step=${5} suffix="%" onChange=${(v) => onChange({ ...img, size: v })} />
      ${size < 100 && html`<${PosPicker} value=${img.pos} onChange=${(pos) => onChange({ ...img, pos })} />`}
      <${Segmented} label="글자색" size="sm" value=${img.ink ? 'manual' : 'auto'}
        onChange=${(v) => onChange({ ...img, ink: v === 'manual' ? img.tone : null })}
        options=${[{ value: 'auto', label: '자동' }, { value: 'manual', label: '직접' }]} />
      ${img.ink && html`<${Range} label="글자 밝기" value=${lightOf(img.ink)} min=${0} max=${100} suffix="%"
        onChange=${(v) => onChange({ ...img, ink: grayAt(v) })} />`}
    </div>`}
    ${editing && img && html`<${ImageEditor} fill=${fillOf(img)} aspect=${aspect} title="칸 이미지 크롭" plain
      onApply=${(f) => change({ ...img, view: f.view, fit: f.fit })} onClose=${() => setEditing(false)} />`}
  </div>`;
}
