// 이미지 팔레트 추출(k-means) + 메시 그라데이션 생성

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 대비율 */
export function contrastRatio(a, b) {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 배경색 위에서 대비가 더 큰 글자색(#fff / #000) — 웹접근성 명도 대비 기준 */
export function textOn(hex) {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000';
}

/** 배경색 위에서 읽기 좋은 글자색 (일정 막대 등) */
export function readableOn(hex) {
  return textOn(hex) === '#ffffff' ? '#ffffff' : '#111111';
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}

/**
 * 일정 막대 위 D-day 칩 색: 막대 색과 같은 색상(hue)으로, 밝은 막대엔 진한 칩 · 어두운 막대엔 옅은 칩.
 * 칩 글자는 흰~검정 사이 회색으로, 막대 색의 명도를 따라가되 대비 4.5:1 을 지킨다.
 */
export function ddayChipOn(bg) {
  const [h, s] = rgbToHsl(hexToRgb(bg));
  const dark = textOn(bg) === '#ffffff';
  // 회색 계열은 채도를 올리지 않는다 (아무 색이나 끼어든 것처럼 보이지 않게)
  const sat = s < 0.08 ? 0 : Math.min(0.72, Math.max(0.42, s * 0.75));
  let chip = hslToHex(h, sat, dark ? 0.9 : 0.3);
  for (let l = dark ? 0.9 : 0.3; contrastRatio(chip, bg) < 4.5 && l > 0.08 && l < 0.97; l += dark ? 0.02 : -0.03) chip = hslToHex(h, sat, l);
  // 칩 글자는 흰~검정 사이 회색으로만: 막대 색과 같은 명도의 회색에서 출발해 대비가 될 때까지 흰/검정 쪽으로
  return { bg: chip, fg: grayOn(chip, 4.5, bg) };
}

/** 색과 같은 명도(상대 휘도)의 회색 */
export function grayOf(hex) {
  const L = luminance(hexToRgb(hex));
  const c = L <= 0.0031308 ? L * 12.92 : 1.055 * L ** (1 / 2.4) - 0.055;
  const v = Math.round(Math.min(1, Math.max(0, c)) * 255);
  return rgbToHex([v, v, v]);
}

/**
 * 배경 위 글자색을 #fff ~ #000 사이 회색으로 고른다: from(기본 배경) 과 같은 명도의 회색에서 출발해
 * 대비 target 이 될 때까지 흰/검정 쪽으로 옮긴다. (배경 색을 따라가되 항상 읽히게)
 */
export function grayOn(bg, target = 4.5, from = bg) {
  const end = textOn(bg);
  const start = grayOf(from);
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mixHex(start, end, t);
    if (contrastRatio(c, bg) >= target) return c;
  }
  return end;
}

/** a 를 b 쪽으로 t(0~1) 만큼 섞기 */
export function mixHex(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}

/**
 * 단색 배경 위 패널(체크리스트·메모·뽀모도로) 색: 배경과 구분되면서 글자 대비 7:1 이상이 되는 쪽으로
 * 밝히거나 어둡게 한다.
 */
export function panelOn(bg) {
  const text = textOn(bg);
  const toward = text === '#ffffff' ? ['#ffffff', '#000000'] : ['#000000', '#ffffff'];
  const first = mixHex(bg, toward[0], text === '#ffffff' ? 0.08 : 0.06);
  if (contrastRatio(first, text) >= 7) return first;
  return mixHex(bg, toward[1], 0.14);
}

/**
 * 보조 글자색: 본문 글자색을 배경 쪽으로 최대한 흐리게 하되, 주어진 모든 바탕에서 대비 target 이상 유지.
 * (target 을 못 넘는 배경이면 본문 글자색 그대로)
 */
export function mutedOn(text, bgs, target) {
  const ok = (c) => bgs.every((b) => contrastRatio(c, b) >= target);
  let lo = 0;
  let hi = 0.6;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mixHex(text, bgs[0], mid))) lo = mid;
    else hi = mid;
  }
  return mixHex(text, bgs[0], lo);
}

/** 여러 색의 평균 (첫 색에 가중치 — 메시 그라데이션의 바탕색) */
export function averageHex(colors, firstWeight = 2) {
  if (!colors || !colors.length) return '#808080';
  let r = 0; let g = 0; let b = 0; let n = 0;
  colors.forEach((c, i) => {
    const w = i === 0 ? firstWeight : 1;
    const [cr, cg, cb] = hexToRgb(c);
    r += cr * w; g += cg * w; b += cb * w; n += w;
  });
  return rgbToHex([r / n, g / n, b / n]);
}

/** 시드 기반 난수 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** 이미지 전체 평균색 (배경 명도 판단용) */
export async function averageColor(src) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return n ? rgbToHex([r / n, g / n, b / n]) : '#808080';
}

/**
 * 크롭한 부분의 평균색 (가로/세로 비율 aspect 인 칸에 cover 로 채웠을 때 보이는 부분).
 * view = { zoom, cx, cy } — 이미지 편집기 형식. 날짜 칸 이미지의 글자색 고르기용
 */
export async function croppedAverage(src, view, aspect = 1) {
  const img = await loadImage(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const v = view || { zoom: 1, cx: 0.5, cy: 0.5 };
  // cover: 칸 비율에 맞춘 가장 큰 영역을 zoom 만큼 줄인 것이 보이는 부분
  const w = Math.min(W, H * aspect) / (v.zoom || 1);
  const h = w / aspect;
  const x = Math.min(W - w, Math.max(0, v.cx * W - w / 2));
  const y = Math.min(H - h, Math.max(0, v.cy * H - h / 2));
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, x, y, w, h, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let r = 0; let g = 0; let b = 0; let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return n ? rgbToHex([r / n, g / n, b / n]) : '#808080';
}

/** 이미지에서 대표 색상 k개 추출 (빈도순) */
export async function extractPalette(src, k = 6) {
  const img = await loadImage(src);
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    px.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!px.length) return [];
  // 초기 중심: 가장 먼 색부터 고르는 방식(farthest-first)으로 뚜렷한 색을 놓치지 않게 한다
  const dist2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  let centers = [px[Math.floor(px.length / 2)].slice()];
  while (centers.length < k) {
    let best = px[0];
    let bestD = -1;
    for (let i = 0; i < px.length; i += 3) {
      const d = Math.min(...centers.map((c) => dist2(px[i], c)));
      if (d > bestD) {
        bestD = d;
        best = px[i];
      }
    }
    centers.push(best.slice());
  }
  let assign = new Array(px.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    px.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      assign[i] = best;
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3]++;
    });
    centers = sums.map((s, j) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[j]));
  }
  const counts = centers.map(() => 0);
  assign.forEach((a) => counts[a]++);
  const result = centers
    .map((c, i) => ({ c, n: counts[i] }))
    .filter((x) => x.n > px.length * 0.015)
    .sort((a, b) => b.n - a.n);
  // 너무 비슷한 색 제거
  const picked = [];
  for (const r of result) {
    if (picked.every((p) => Math.hypot(p[0] - r.c[0], p[1] - r.c[1], p[2] - r.c[2]) > 28)) picked.push(r.c);
  }
  return picked.map(rgbToHex);
}

/** 팔레트 + 시드 → 메시 레이어 (바탕색 + 원형 그라데이션들, 앞쪽이 위) */
function meshLayers(palette, seed = 1) {
  const colors = palette && palette.length ? palette : ['#e6e6e6', '#bdbdbd', '#8a8a8a', '#f5f5f5'];
  const rnd = mulberry32(seed);
  const layers = [];
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const c = colors[(i + 1) % colors.length];
    const x = Math.round(rnd() * 100);
    const y = Math.round(rnd() * 100);
    const s = Math.round(38 + rnd() * 40);
    layers.push({ c, x, y, s });
  }
  return { base: colors[0], layers };
}

/** 팔레트 + 시드 → 메시 그라데이션 CSS background */
export function meshBackground(palette, seed = 1) {
  const { base, layers } = meshLayers(palette, seed);
  return `${layers.map((l) => `radial-gradient(at ${l.x}% ${l.y}%, ${l.c} 0px, transparent ${l.s}%)`).join(', ')}, ${base}`;
}

/**
 * 메시 그라데이션의 한 점 색을 계산 (CSS 와 같은 식: 타원 farthest-corner, 색 → 투명 직선 보간을 아래 레이어부터 덧칠).
 * w · h: 그라데이션 상자 크기. 돌려주는 함수는 상자 안 (x, y) 의 [r, g, b].
 */
export function meshSampler(palette, seed, w, h) {
  const { base, layers } = meshLayers(palette, seed);
  const geo = layers.map((l) => {
    const cx = (l.x / 100) * w;
    const cy = (l.y / 100) * h;
    return { rgb: hexToRgb(l.c), cx, cy, rx: Math.max(cx, w - cx) * Math.SQRT2, ry: Math.max(cy, h - cy) * Math.SQRT2, stop: l.s / 100 };
  });
  const baseRgb = hexToRgb(base);
  return (x, y) => {
    let out = baseRgb.slice();
    for (let i = geo.length - 1; i >= 0; i--) {
      const g = geo[i];
      const t = Math.hypot((x - g.cx) / (g.rx || 1), (y - g.cy) / (g.ry || 1));
      const a = Math.max(0, Math.min(1, 1 - t / g.stop));
      if (a) out = out.map((v, k) => g.rgb[k] * a + v * (1 - a));
    }
    return out;
  };
}

export const EVENT_COLORS = [
  '#fde0e0', '#ffe7cc', '#fff3bf', '#dff5d8', '#cdf0ea', '#cdeefc', '#dde4ff', '#eadcff', '#f1f1f1', '#d6d6d6',
];
