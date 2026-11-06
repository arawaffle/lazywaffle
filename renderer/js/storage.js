// 저장소 어댑터: Electron(window.desk) 이면 로컬 파일, 브라우저면 localStorage 로 동작한다.
import { hold, release } from './focus.js';
import { shrinkTo } from './util/icon.js';

const desk = window.desk;
export const isElectron = !!(desk && desk.isElectron);
const LS_KEY = 'lazywaffle-state';
const OLD_LS_KEY = 'deskcalendar-state'; // 이전 앱 이름으로 저장된 브라우저 데이터

export async function loadState() {
  if (isElectron) return desk.load();
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? localStorage.getItem(OLD_LS_KEY));
  } catch {
    return null;
  }
}

export async function saveState(state) {
  if (isElectron) return desk.save(state);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('저장 실패(용량 초과 가능)', err);
  }
  return true;
}

function pickWithInput(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

/** 이미지 파일 선택 → Blob */
export async function pickImageFile() {
  if (isElectron) {
    const f = await desk.pickFile({ title: '이미지 선택' });
    if (!f) return null;
    const ext = f.name.split('.').pop().toLowerCase();
    const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' }[ext] || 'image/png';
    return new Blob([f.data], { type });
  }
  return pickWithInput('image/*');
}

/** 큰 이미지는 줄여서(webp) 저장하고 URL 을 돌려준다. gif/svg 는 원본 유지 */
export async function storeImage(blob, maxSize = 2560) {
  let out = blob;
  let ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  if (!['image/gif', 'image/svg+xml'].includes(blob.type)) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    const canvas = shrinkTo(bmp, 0, 0, bmp.width, bmp.height, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    out = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.92));
    ext = 'webp';
  }
  if (isElectron) {
    const bytes = new Uint8Array(await out.arrayBuffer());
    return desk.putAsset(bytes, ext);
  }
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(out);
  });
}

/**
 * 이미지 선택 → URL.
 * Electron: 파일을 복사하지 않고 원본 경로를 참조한다(app://desk/local/...). 불필요한 파일이 생기지 않는다.
 * 브라우저: 경로 접근이 불가하므로 어쩔 수 없이 줄인 data URL 로 저장한다.
 */
export async function pickAndStoreImage(maxSize) {
  hold('file-dialog');
  try {
    if (isElectron) {
      const f = await desk.pickFile({ title: '이미지 선택', pathOnly: true });
      return f ? f.url : null;
    }
    const blob = await pickImageFile();
    return blob ? storeImage(blob, maxSize) : null;
  } finally {
    release('file-dialog');
  }
}

/** 이미지 선택 → 줄여서 데이터 폴더에 복사한 URL (원본을 옮기거나 지워도 남아야 하는 작은 이미지용) */
export async function pickAndCopyImage(maxSize) {
  hold('file-dialog');
  try {
    const blob = await pickImageFile();
    return blob ? await storeImage(blob, maxSize) : null;
  } finally {
    release('file-dialog');
  }
}

export async function clearCache(state) {
  return isElectron ? desk.clearCache(state) : null;
}

export function openExternal(url) {
  if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url;
  if (isElectron) desk.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

export async function exportBackup(state) {
  if (isElectron) return desk.exportBackup(state);
  const blob = new Blob([JSON.stringify({ app: 'LazyWaffle', format: 1, exportedAt: new Date().toISOString(), state, assets: {} })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `LazyWaffle-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return a.download;
}

export async function importBackup() {
  if (isElectron) return desk.importBackup();
  const file = await pickWithInput('application/json,.json');
  if (!file) return null;
  const data = JSON.parse(await file.text());
  if (!data || !['LazyWaffle', 'DeskCalendar'].includes(data.app) || !data.state) throw new Error('백업 파일 형식이 올바르지 않습니다.');
  return data.state;
}

export function notify(title, body) {
  if (isElectron) return desk.notify(title, body);
  if ('Notification' in window) {
    if (Notification.permission === 'granted') new Notification(title, { body });
    else if (Notification.permission !== 'denied') Notification.requestPermission();
  }
}

export const shell = desk || null;
