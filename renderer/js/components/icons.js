import { html } from '../lib.js';

const P = {
  'chev-left': 'M15 18l-6-6 6-6',
  'chev-right': 'M9 18l6-6-6-6',
  'chev-down': 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  skip: 'M5 5v14l10-7zM19 5v14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  sticker: 'M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.5L21 14.5V5a2 2 0 0 0-2-2zM15 21v-4a2 2 0 0 1 2-2h4',
  layout: 'M3 3h18v18H3zM3 9h18M9 21V9',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22zM7.5 10.5h.01M12 7.5h.01M16.5 10.5h.01',
  refresh: 'M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5',
  external: 'M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  'list-ul': 'M9 6h12M9 12h12M9 18h12M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  'list-ol': 'M10 6h11M10 12h11M10 18h11M4 4v4M3 8h2M3 12.5a1 1 0 0 1 2 0c0 1-2 1.5-2 2.5h2M3 17h2v4H3',
  quote: 'M6 17h3l2-4V7H5v6h3M14 17h3l2-4V7h-6v6h3',
  eraser: 'M20 20H7L3 16l10-10 7 7-7 7M9 10l6 6',
  flipx: 'M12 3v18M8 7l-4 5 4 5zM16 7l4 5-4 5z',
  rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  front: 'M8 8h12v12H8zM4 16V4h12',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
  sub: 'M5 4v10a2 2 0 0 0 2 2h12M15 12l4 4-4 4',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.8 0',
  'dots-v': 'M12 4.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6zM12 10.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6zM12 17.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 1 0 0-2.6z',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  back: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  chart: 'M3 21h18M6 17v-6M11 17V5M16 17v-9M21 17v-4',
  'align-left': 'M3 6h18M3 10h12M3 14h18M3 18h12',
  'align-center': 'M3 6h18M6 10h12M3 14h18M6 18h12',
  'align-right': 'M3 6h18M9 10h12M3 14h18M9 18h12',
  'check-list': 'M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17',
};

export function Icon({ name, size = 16, filled = false, label }) {
  return html`<svg class="icon" width=${size} height=${size} viewBox="0 0 24 24" fill=${filled ? 'currentColor' : 'none'}
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden=${label ? undefined : 'true'} role=${label ? 'img' : undefined} aria-label=${label}>
    <path d=${P[name] || ''} />
  </svg>`;
}

/** 아이콘 버튼 (aria-label 필수) */
export function IconButton({ icon, label, onClick, size = 16, className = '', pressed, disabled, filled, ...rest }) {
  return html`<button type="button" class=${'icon-btn ' + className} aria-label=${label} title=${label}
    aria-pressed=${pressed === undefined ? undefined : String(!!pressed)} disabled=${disabled} onClick=${onClick} ...${rest}>
    <${Icon} name=${icon} size=${size} filled=${filled} />
  </button>`;
}
