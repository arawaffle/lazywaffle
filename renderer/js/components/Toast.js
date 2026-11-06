// 전역 알림: 삭제 후 '되돌리기' 등 (6초 뒤 자동으로 사라짐)
import { html, useState, useEffect, useBus } from '../lib.js';

export function Toast() {
  const [toast, setToast] = useState(null);
  useBus('toast', (t) => setToast({ ...t, at: Date.now() }));
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return html`<div class="app-toast" role="status">
    <span>${toast.text}</span>
    ${toast.undo && html`<button type="button" class="app-toast-btn" onClick=${() => { toast.undo(); setToast(null); }}>되돌리기</button>`}
  </div>`;
}
