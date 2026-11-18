// 폼 컨트롤 (라벨 연결로 접근성 확보)
import { html, useId, useState, useRef, useEffect, Fragment, cx } from '../lib.js';
import { EVENT_COLORS } from '../util/color.js';
import { useApp } from '../store.js';
import { addSavedColor, removeSavedColor } from '../actions.js';

export function Field({ label, hint, children, inline, className }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return html`<div class=${cx('field', inline && 'field-inline', className)}>
    <label class="field-label" for=${id}>${label}</label>
    <div class="field-control">${child}</div>
    ${hint && html`<p class="field-hint">${hint}</p>`}
  </div>`;
}

/** 라디오 그룹 형태의 세그먼트 버튼 */
export function Segmented({ label, value, options, onChange, size, hideLabel }) {
  const id = useId();
  return html`<div class="field">
    <span class=${cx('field-label', hideLabel && 'sr-only')} id=${id}>${label}</span>
    <div class=${cx('segmented', size && 'segmented-' + size)} role="radiogroup" aria-labelledby=${id}>
      ${options.map((o) => html`<button type="button" role="radio" aria-checked=${String(value === o.value)}
          class=${cx('seg', value === o.value && 'is-on')} onClick=${() => onChange(o.value)}
          onKeyDown=${(e) => {
            const i = options.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value); }
          }}
          tabindex=${value === o.value ? 0 : -1}>${o.label}</button>`)}
    </div>
  </div>`;
}

export function Toggle({ label, checked, onChange, hint, disabled }) {
  const id = useId();
  return html`<div class=${cx('toggle-row', disabled && 'is-disabled')}>
    <label class="toggle" for=${id}>
      <input id=${id} type="checkbox" role="switch" checked=${checked} disabled=${disabled} onChange=${(e) => onChange(e.currentTarget.checked)} />
      <span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
      <span class="toggle-label">${label}</span>
    </label>
    ${hint && html`<p class="field-hint">${hint}</p>`}
  </div>`;
}

export function Check({ label, checked, onChange, className }) {
  const id = useId();
  return html`<label class=${cx('check', className)} for=${id}>
    <input id=${id} type="checkbox" checked=${checked} onChange=${(e) => onChange(e.currentTarget.checked)} />
    <span class="check-box" aria-hidden="true"></span>
    <span>${label}</span>
  </label>`;
}

/**
 * 색 고르기. 직접 고른 색은 '+' 로 저장해 두고 다음에도 쓴다 (저장한 색은 모든 색상란이 함께 씀, 마우스를 올리면 × 로 삭제)
 * compact: 좁은 칸용 작은 견본 · savable={false}: 저장 기능 끄기
 */
export function ColorPicker({ label, value, onChange, colors = EVENT_COLORS, allowNone, noneLabel = '카테고리 색', savable = true, compact, hideLabel }) {
  const id = useId();
  const { settings } = useApp();
  const lower = colors.map((c) => c.toLowerCase());
  const saved = savable ? (settings.savedColors || []).filter((c) => !lower.includes(c)) : [];
  const v = value && value.toLowerCase();
  const canSave = savable && v && !lower.includes(v) && !saved.includes(v);
  return html`<div class=${cx('field', compact && 'swatches-compact')}>
    <span class=${cx('field-label', hideLabel && 'sr-only')} id=${id}>${label}</span>
    <div class="swatches" role="radiogroup" aria-labelledby=${id}>
      ${allowNone && html`<button type="button" role="radio" aria-checked=${String(!value)} class=${cx('swatch swatch-none', !value && 'is-on')}
        onClick=${() => onChange(null)} title=${noneLabel} aria-label=${noneLabel}></button>`}
      ${colors.map((c, i) => html`<button type="button" role="radio" key=${c} aria-checked=${String(v === lower[i])} aria-label=${'색상 ' + c}
          class=${cx('swatch', v === lower[i] && 'is-on')} style=${{ background: c }} onClick=${() => onChange(c)}></button>`)}
      ${saved.map((c) => html`<span class="swatch-saved" key=${c}>
        <button type="button" role="radio" aria-checked=${String(v === c)} aria-label=${'저장한 색상 ' + c}
          class=${cx('swatch', v === c && 'is-on')} style=${{ background: c }} onClick=${() => onChange(c)}></button>
        <button type="button" class="swatch-del" aria-label=${'저장한 색상 ' + c + ' 삭제'} title="저장한 색 삭제" onClick=${() => removeSavedColor(c)}>×</button>
      </span>`)}
      <label class=${cx('swatch swatch-custom', canSave && 'is-on')} title="직접 선택">
        <span class="sr-only">직접 색상 선택</span>
        <input type="color" value=${value || '#ffffff'} onInput=${(e) => onChange(e.currentTarget.value)} />
      </label>
      ${canSave && html`<button type="button" class="swatch swatch-add" title="이 색 저장" aria-label=${'지금 색 ' + v + ' 저장'} onClick=${() => addSavedColor(v)}
        style=${{ '--c': v }}>+</button>`}
    </div>
  </div>`;
}

/**
 * 색 견본 하나 (목록 줄 안의 작은 색 칸). 누르면 바로 아래 줄에 ColorPicker 가 펼쳐져 저장한 색을 고르거나 지금 색을 저장할 수 있다.
 * 부모 줄은 flex-wrap(또는 grid) 이어야 펼친 칸이 한 줄을 다 차지한다. className: 견본 모양 (cat-color · tt-color · swatch …)
 */
export function ColorSwatch({ label, value, onChange, colors = EVENT_COLORS, className = 'cat-color' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (!pop.current || pop.current.contains(e.target) || (btn.current && btn.current.contains(e.target))) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    setOpen(false);
    btn.current && btn.current.focus();
  };
  return html`<${Fragment}>
    <button type="button" ref=${btn} class=${cx(className, open && 'is-open')} style=${{ background: value }} title=${label}
      aria-label=${label + ' ' + value} aria-expanded=${String(open)} onClick=${() => setOpen(!open)}></button>
    ${open && html`<div class="color-pop" ref=${pop} onKeyDown=${onKeyDown}>
      <${ColorPicker} label=${label} hideLabel compact colors=${colors} value=${value} onChange=${(c) => c && onChange(c)} />
    </div>`}
  <//>`;
}

/** 슬라이더: 라벨과 값은 위 한 줄, 슬라이더는 아래 — 좁은 2열 배치에서도 겹치지 않는다 */
export function Range({ label, value, min, max, step = 1, onChange, suffix = '' }) {
  const id = useId();
  return html`<div class="field range-field">
    <div class="range-head">
      <label class="field-label" for=${id}>${label}</label>
      <output for=${id} class="range-out num">${value}${suffix}</output>
    </div>
    <input id=${id} type="range" min=${min} max=${max} step=${step} value=${value} onInput=${(e) => onChange(+e.currentTarget.value)} />
  </div>`;
}
