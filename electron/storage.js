// 로컬 파일 저장소: data/state.json + data/assets/* (DB 없음). 백업은 이미지까지 포함한 단일 JSON.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml' };
const ASSET_PREFIX = 'app://desk/assets/';
const LOCAL_PREFIX = 'app://desk/local/';
const LOCAL_RE = /app:\/\/desk\/local\/[^"\s)]+/g;
const APP_NAME = 'LazyWaffle';
const OLD_NAME = 'DeskCalendar'; // 이전 앱 이름: 예전 백업 파일과 데이터 폴더를 그대로 이어받는다

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

class Storage {
  constructor(dir) {
    this.dir = dir;
    this.assets = path.join(dir, 'assets');
    this.backups = path.join(dir, 'backups');
    this.file = path.join(dir, 'state.json');
    fs.mkdirSync(this.assets, { recursive: true });
    fs.mkdirSync(this.backups, { recursive: true });
  }

  load() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch { /* 다음 후보 */ }
    }
    return null;
  }

  save(state) {
    const json = JSON.stringify(state);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, json);
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(tmp, this.file);
    this.dailyBackup(json);
  }

  /** 하루 한 번 자동 백업(최근 14개 보관) */
  dailyBackup(json) {
    const d = new Date();
    const name = `state-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    const file = path.join(this.backups, name);
    if (fs.existsSync(file)) return;
    fs.writeFileSync(file, json);
    const list = fs.readdirSync(this.backups).filter((n) => n.startsWith('state-')).sort();
    for (const old of list.slice(0, Math.max(0, list.length - 14))) fs.unlinkSync(path.join(this.backups, old));
  }

  putAsset(bytes, ext) {
    ext = String(ext || 'png').toLowerCase().replace(/[^a-z]/g, '');
    if (!MIME[ext]) ext = 'png';
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(this.assets, name), Buffer.from(bytes));
    return ASSET_PREFIX + name;
  }

  assetPath(name) {
    const safe = path.basename(decodeURIComponent(name));
    return path.join(this.assets, safe);
  }

  /** state 에서 참조되지 않는 이미지·임시 파일 정리. force 가 아니면 하루 이상 된 파일만. 지운 용량(byte) 반환 */
  gc(state, { force = false } = {}) {
    const json = JSON.stringify(state || {});
    const now = Date.now();
    let freed = 0;
    const remove = (file) => {
      try {
        const st = fs.statSync(file);
        if (!force && now - st.mtimeMs < 86400000) return;
        fs.unlinkSync(file);
        freed += st.size;
      } catch { /* 무시 */ }
    };
    for (const name of fs.readdirSync(this.assets)) if (!json.includes(name)) remove(path.join(this.assets, name));
    for (const name of fs.readdirSync(this.dir)) if (name.endsWith('.tmp')) remove(path.join(this.dir, name));
    return freed;
  }

  /** 백업에는 복사본(assets)과 원본 경로로 참조한 이미지(local)를 모두 담는다 */
  buildBackup(state) {
    const json = JSON.stringify(state);
    const assets = {};
    for (const name of fs.readdirSync(this.assets)) {
      if (!json.includes(name)) continue;
      assets[name] = fs.readFileSync(path.join(this.assets, name)).toString('base64');
    }
    const local = {};
    for (const url of new Set(json.match(LOCAL_RE) || [])) {
      try {
        local[url] = fs.readFileSync(decodeURIComponent(url.slice(LOCAL_PREFIX.length))).toString('base64');
      } catch { /* 원본이 사라진 이미지는 건너뜀 */ }
    }
    return { app: APP_NAME, format: 2, exportedAt: new Date().toISOString(), state, assets, local };
  }

  restoreBackup(backup) {
    if (!backup || ![APP_NAME, OLD_NAME].includes(backup.app) || !backup.state) throw new Error('백업 파일 형식이 올바르지 않습니다.');
    for (const [name, b64] of Object.entries(backup.assets || {})) {
      fs.writeFileSync(this.assetPath(name), Buffer.from(b64, 'base64'));
    }
    let json = JSON.stringify(backup.state);
    // 원본 경로 이미지: 그 파일이 이 PC 에 그대로 있으면 경로 유지, 없으면 백업 내용을 assets 로 복원
    for (const [url, b64] of Object.entries(backup.local || {})) {
      if (fs.existsSync(decodeURIComponent(url.slice(LOCAL_PREFIX.length)))) continue;
      const ext = path.extname(decodeURIComponent(url)).slice(1);
      json = json.split(url).join(this.putAsset(Buffer.from(b64, 'base64'), ext));
    }
    const state = JSON.parse(json);
    this.save(state);
    return state;
  }
}

/** 설치형(NSIS)으로 설치된 실행인지: exe 옆에 제거 프로그램이 있다 */
function isInstalled() {
  return fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${APP_NAME}.exe`));
}

/** 폴더를 통째로 복사 (이미 있는 파일은 건드리지 않음).
 *  fs.cpSync 는 Windows 에서 한글이 든 경로(사용자 이름 등)를 만나면 프로세스째 죽어서 직접 돈다 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else if (ent.isFile() && !fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

/** 새 데이터 폴더가 비어 있고 예전 이름의 데이터 폴더가 있으면 내용을 복사해 온다 (원본은 남겨 둔다) */
function migrateFrom(oldDir, newDir) {
  try {
    if (fs.existsSync(path.join(newDir, 'state.json'))) return;
    if (!fs.existsSync(path.join(oldDir, 'state.json'))) return;
    copyDir(oldDir, newDir);
  } catch { /* 옮기지 못해도 빈 데이터로 시작한다 */ }
}

/**
 * 데이터 폴더
 * - 개발 실행: 프로젝트의 .devdata/
 * - 설치형: %APPDATA%\LazyWaffle\data (설치 폴더는 업데이트·제거 때 통째로 지워지므로 쓰지 않는다)
 * - 단일 exe 포터블: exe 옆 LazyWaffle-data/ · 압축(zip) 포터블: exe 옆 data/
 * - 쓸 수 없는 위치면 %APPDATA%\LazyWaffle\data
 * 예전 이름(DeskCalendar)으로 쓰던 데이터가 있으면 처음 실행할 때 복사해 온다.
 */
function resolveDataDir({ app, isDev, root }) {
  if (isDev) return path.join(root, '.devdata');
  const userData = path.join(app.getPath('userData'), 'data');
  const oldUserData = path.join(app.getPath('appData'), OLD_NAME, 'data');
  const pick = () => {
    if (isInstalled()) return userData;
    const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    if (portableDir) {
      const dir = path.join(portableDir, `${APP_NAME}-data`);
      if (isWritable(dir)) {
        migrateFrom(path.join(portableDir, `${OLD_NAME}-data`), dir);
        return dir;
      }
    }
    const zipDir = path.join(path.dirname(process.execPath), 'data');
    return isWritable(zipDir) ? zipDir : userData;
  };
  const dir = pick();
  if (dir === userData) migrateFrom(oldUserData, userData);
  return dir;
}

module.exports = { Storage, resolveDataDir, isInstalled, MIME, LOCAL_PREFIX };
