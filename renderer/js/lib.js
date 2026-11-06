// Preact + htm (빌드 없이 JSX 와 비슷한 템플릿 사용)
import { h, render, Fragment, createContext } from '../vendor/preact.module.js';
import {
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer, useId,
} from '../vendor/hooks.module.js';
import htm from '../vendor/htm.module.js';

export const html = htm.bind(h);
export {
  h, render, Fragment, createContext,
  useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext, useReducer, useId,
};

/** class 이름 조합 */
export function cx(...args) {
  return args.flat().filter(Boolean).join(' ');
}

/** 고유 id */
export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 간단한 이벤트 버스 (위젯 간 통신: D-day/전광판 → 캘린더 상세 열기 등) */
const listeners = new Map();
export const bus = {
  on(name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  },
  emit(name, payload) {
    (listeners.get(name) || []).forEach((fn) => fn(payload));
  },
};

export function useBus(name, fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => bus.on(name, (p) => ref.current(p)), [name]);
}

/** 요소 크기 추적 */
export function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    // 처음 크기는 바로 잰다 (ResizeObserver 는 화면이 그려질 때까지 늦게 올 수 있음)
    const first = ref.current.getBoundingClientRect();
    setSize({ width: first.width, height: first.height });
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return size;
}

/** 지정 간격(기본 30초)마다 갱신되는 현재 시각 */
export function useNow(interval = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

/** 포인터 캡처 (이미 사라진 포인터 등으로 실패해도 드래그 처리는 계속되게) */
export function capture(el, e) {
  try {
    el.setPointerCapture(e.pointerId);
  } catch { /* 캡처 없이도 window 기준으로 동작 */ }
}
