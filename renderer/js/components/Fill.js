// 영역 배경: 이미지 / 단색 / 메시 그라데이션
import { html, cx, useRef, useState, useEffect, useSize } from '../lib.js';
import { meshBackground } from '../util/color.js';

/**
 * 이미지 배치 계산 (화면과 편집기 미리보기가 같은 함수를 쓴다)
 * - fill.view = { zoom, cx, cy } : 편집기에서 정한 확대 배율과 화면 가운데에 올 이미지 지점(0~1). 보이는 영역 = 크롭
 * - view 가 없을 때: 영역보다 작은 이미지는 늘리지 않고 원래 크기로, 뒤에 같은 이미지를 흐리게 깐다
 * - '전체 보기'(contain) 는 이미지 전체가 보이게 하고 빈 곳은 흐린 배경
 */
export function imageLayout(nat, box, fill) {
  if (!nat || !box.width || !box.height) return null;
  const contain = fill.fit === 'contain';
  const view = fill.view;
  if (!view) {
    const small = nat.w < box.width || nat.h < box.height;
    if (small || contain) {
      const s = Math.min(contain ? Infinity : 1, box.width / nat.w, box.height / nat.h);
      return { size: `${Math.round(nat.w * s)}px ${Math.round(nat.h * s)}px`, pos: `${fill.posX ?? 50}% ${fill.posY ?? 50}%`, backdrop: true };
    }
    return { size: 'cover', pos: `${fill.posX ?? 50}% ${fill.posY ?? 50}%`, backdrop: false };
  }
  const base = contain ? Math.min(box.width / nat.w, box.height / nat.h) : Math.max(box.width / nat.w, box.height / nat.h);
  const s = base * (view.zoom || 1);
  const W = nat.w * s;
  const H = nat.h * s;
  let x = box.width / 2 - view.cx * W;
  let y = box.height / 2 - view.cy * H;
  // 이미지가 영역보다 크면 가장자리가 비지 않도록 범위 안으로
  if (W >= box.width) x = Math.min(0, Math.max(box.width - W, x));
  if (H >= box.height) y = Math.min(0, Math.max(box.height - H, y));
  return { size: `${W}px ${H}px`, pos: `${x}px ${y}px`, backdrop: W < box.width - 1 || H < box.height - 1, W, H, x, y };
}

export function useNaturalSize(src) {
  const [nat, setNat] = useState(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setNat({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => alive && setNat(null);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return nat;
}

/** 이미지 면 (흐린 배경 + 이미지) — 크기는 부모 상자 기준. plain: 흐린 배경 없이 (빈 곳은 비워 둠) */
export function ImageSurface({ fill, box, nat, plain }) {
  const lay = imageLayout(nat, box, fill);
  const url = `url("${fill.image}")`;
  return html`${lay && lay.backdrop && !plain && html`<div class="fill-blur" style=${{ backgroundImage: url }}></div>`}
    <div class="fill-fg" style=${lay ? { backgroundImage: url, backgroundSize: lay.size, backgroundPosition: lay.pos } : null}></div>`;
}

function ImageFill({ fill, className, a11y }) {
  const ref = useRef(null);
  const box = useSize(ref);
  const nat = useNaturalSize(fill.image);
  const blur = fill.blur || 0;
  if (!blur) {
    return html`<div ref=${ref} class=${cx('fill fill-image', className)} ...${a11y}>
      <${ImageSurface} fill=${fill} box=${box} nat=${nat} />
    </div>`;
  }
  // 흐림: 가장자리가 투명하게 번지지 않도록 흐림 반경의 2배만큼 넓게 그리고 바깥은 잘라낸다
  const pad = blur * 2;
  return html`<div ref=${ref} class=${cx('fill fill-image', className)} ...${a11y}>
    <div class="fill-soft" style=${{ inset: -pad + 'px', filter: `blur(${blur}px)` }}>
      <${ImageSurface} fill=${fill} box=${{ width: box.width + pad * 2, height: box.height + pad * 2 }} nat=${nat} />
    </div>
  </div>`;
}

export function Fill({ fill, mesh, seedOffset = 0, className, label }) {
  const type = fill.type === 'image' && !fill.image ? 'color' : fill.type;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' };
  if (type === 'image') return html`<${ImageFill} fill=${fill} className=${className} a11y=${a11y} />`;
  if (type === 'mesh') {
    return html`<div class=${cx('fill fill-mesh', className)} ...${a11y}>
      <div class=${cx('mesh-layer', mesh.animate && 'is-animated')} style=${{ background: meshBackground(mesh.palette, (mesh.seed || 1) + seedOffset) }}></div>
    </div>`;
  }
  return html`<div class=${cx('fill', className)} ...${a11y} style=${{ background: fill.color || '#ffffff' }}></div>`;
}
