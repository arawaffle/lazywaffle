// 아이콘 선명하게 그리기
// - 큰 이미지(예: 720px)를 50px 남짓으로 한 번에 줄이면 Chromium 이 디테일을 건너뛰어 계단 현상(깨짐)이 생긴다.
//   → 화면에 그릴 실제 픽셀 크기로 절반씩 여러 번 고품질 축소한 사본을 메모리에서 만든다(파일 생성 없음).
// - 작은 이미지는 정수 배율로만 키우고(흐림 방지) 나머지는 여백으로 둔다.
import { useState, useEffect } from '../lib.js';

const cache = new Map();

function load(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 정사각 타일(px) 에 맞춘 아이콘: { url, small, scale } */
async function build(src, target) {
  const img = await load(src);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const side = Math.min(nw, nh);
  if (!side) return { url: src, small: false };
  if (side < target * 0.9) {
    // 작은 이미지: 정수 배율(최대 4배)로만 확대
    const k = Math.max(1, Math.min(4, Math.floor((target * 0.95) / Math.max(nw, nh))));
    return { url: src, small: true, scale: k, w: nw * k, h: nh * k };
  }
  // 가운데 정사각 영역을 잘라 target 크기로 (object-fit: cover 와 같은 구도)
  const out = shrinkTo(img, (nw - side) / 2, (nh - side) / 2, side, side, target, target);
  const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
  return { url: URL.createObjectURL(blob), small: false };
}

/** 원본의 (sx, sy, sw, sh) 영역을 tw × th 캔버스로: 절반씩 여러 번 고품질 축소해 계단 현상을 막는다 */
export function shrinkTo(img, sx, sy, sw, sh, tw, th) {
  let canvas = document.createElement('canvas');
  let w = Math.max(tw, Math.round(sw));
  let h = Math.max(th, Math.round(sh));
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  while (w / 2 >= tw && h / 2 >= th) {
    const next = document.createElement('canvas');
    next.width = w = Math.floor(w / 2);
    next.height = h = Math.floor(h / 2);
    const nctx = next.getContext('2d');
    nctx.imageSmoothingQuality = 'high';
    nctx.drawImage(canvas, 0, 0, w, h);
    canvas = next;
  }
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, tw, th);
  return out;
}

/** cssSize: 타일의 CSS px 크기 */
export function useCrispIcon(src, cssSize) {
  const target = Math.round((cssSize || 0) * (window.devicePixelRatio || 1));
  const key = src && target > 0 ? `${target}|${src}` : null;
  const [result, setResult] = useState(() => (key && cache.get(key)) || null);
  useEffect(() => {
    if (!key) return undefined;
    if (cache.has(key)) {
      setResult(cache.get(key));
      return undefined;
    }
    let alive = true;
    build(src, target)
      .then((r) => {
        cache.set(key, r);
        if (alive) setResult(r);
      })
      .catch(() => alive && setResult({ url: src, small: false }));
    return () => {
      alive = false;
    };
  }, [key]);
  return result;
}

/** 아이콘 이미지 정보 (설정 화면의 크기 안내용) */
export async function imageSize(src) {
  const img = await load(src);
  return { w: img.naturalWidth, h: img.naturalHeight };
}
