// THIRD_PARTY_NOTICES.txt 를 만든다: 앱에 함께 배포되는 제3자 구성 요소의 저작권 표시와 라이선스 전문.
// - npm 의존성(dependencies)은 node_modules 의 LICENSE 파일을 그대로 모은다.
// - 렌더러에 복사해 둔 라이브러리(preact · htm)와 폰트는 renderer/ 안의 LICENSE 파일을 읽는다.
// 빌드 스크립트(npm run build:* · dist · release)가 먼저 실행하므로 의존성이 바뀌어도 자동으로 맞춰진다.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8').replace(/\r\n/g, '\n').trim();
const pkg = JSON.parse(read('package.json'));
const LINE = '='.repeat(78);
const SUB = '-'.repeat(78);

/** 패키지 폴더의 라이선스 파일 (LICENSE, LICENSE.txt, license.md …) */
function licenseText(dir) {
  const file = fs.readdirSync(dir).find((f) => /^licen[cs]e(\.(txt|md))?$/i.test(f));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : null;
}
function repoUrl(p) {
  let r = p.repository && (p.repository.url || p.repository);
  if (!r) return p.homepage || '';
  r = String(r).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? `https://github.com/${r}` : r;
}

// 라이선스 파일을 싣지 않은 패키지: 같은 저작권자의 상위 패키지 전문을 쓰거나, 라이선스 종류만 밝힌다
const FALLBACK = {
  '@koromix/koffi-win32-x64': { sameAs: 'koffi' },
  'lazy-val': { note: 'MIT License. This package does not ship a license file; see the repository for the copyright notice.' },
};

const out = [];
const section = (title) => out.push('', LINE, title, LINE);
const entry = (title, meta, body) => {
  out.push('', SUB, title, ...meta.filter(Boolean), SUB, '', body);
};

out.push(
  `${pkg.productName} v${pkg.version} - Third-Party Notices (제3자 구성 요소 고지)`,
  '',
  '이 앱에는 아래 오픈소스 소프트웨어와 글꼴이 포함되어 있습니다. 각 구성 요소의 저작권은 해당 저작권자에게 있으며,',
  '아래에 적힌 라이선스에 따라 사용 · 재배포됩니다.',
  'This application includes the following third-party software and fonts, each licensed as noted below.',
);

/* 1. Electron / Chromium */
section('1. Electron runtime');
out.push(
  '',
  'Electron (MIT License, https://github.com/electron/electron) and Chromium with its bundled components.',
  'The full license texts are installed next to the application executable:',
  '  - LICENSE.electron.txt',
  '  - LICENSES.chromium.html',
);

/* 2. npm dependencies */
section('2. npm packages bundled with the app');
const dirs = cp.execSync('npm ls --all --parseable --omit=dev', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split(/\r?\n/).slice(1).filter(Boolean);
const seen = new Set();
const texts = {};
const deps = [];
for (const dir of dirs) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const id = `${p.name}@${p.version}`;
  if (seen.has(id)) continue;
  seen.add(id);
  texts[p.name] = licenseText(dir);
  deps.push({ p, id });
}
deps.sort((a, b) => a.p.name.localeCompare(b.p.name));
for (const { p, id } of deps) {
  const fb = FALLBACK[p.name];
  let body = texts[p.name];
  if (!body && fb && fb.sameAs) body = `Same license as ${fb.sameAs}:\n\n${texts[fb.sameAs]}`;
  if (!body && fb && fb.note) body = fb.note;
  if (!body) throw new Error(`라이선스 파일이 없는 패키지: ${id} (scripts/make-notices.js 의 FALLBACK 에 추가하세요)`);
  entry(id, [`License: ${p.license}`, repoUrl(p) && `Source: ${repoUrl(p)}`], body);
}

/* 3. renderer libraries */
section('3. Libraries in renderer/vendor');
for (const [name, file] of [['preact', 'LICENSE-preact.txt'], ['htm', 'LICENSE-htm.txt']]) {
  const p = JSON.parse(read('node_modules', name, 'package.json'));
  entry(`${name}@${p.version}`, [`License: ${p.license}`, `Source: ${repoUrl(p)}`, `File: renderer/vendor/${file}`], read('renderer', 'vendor', file));
}

/* 4. fonts (SIL OFL 1.1) */
section('4. Fonts (SIL Open Font License 1.1)');
const fonts = [
  ['NanumSquare (나눔스퀘어)', 'renderer/fonts/LICENSE-NanumSquare.txt'],
  ['Paperlogy (페이퍼로지)', 'renderer/fonts/LICENSE-Paperlogy.txt'],
  ['DeskPixel (modified version of Mona12, renamed per the Reserved Font Name "Mona")', 'renderer/fonts/LICENSE-Mona.txt'],
  ['Noto Serif KR', 'renderer/fonts/noto-serif-kr/LICENSE.txt'],
  ['Playfair Display', 'renderer/fonts/playfair/LICENSE.txt'],
];
for (const [name, file] of fonts) entry(name, [`License: OFL-1.1`, `File: ${file}`], read(file));

/* 5. data */
section('5. Data');
const klc = JSON.parse(read('node_modules', 'korean-lunar-calendar', 'package.json'));
entry(`korean-lunar-calendar@${klc.version}`, [
  `License: ${klc.license}`,
  `Source: ${repoUrl(klc)}`,
  'Used at build time (scripts/make-holidays.js) to precompute lunar holidays in renderer/js/util/holidays-data.js.',
], licenseText(path.join(root, 'node_modules', 'korean-lunar-calendar')));

fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), out.join('\n') + '\n');
console.log(`THIRD_PARTY_NOTICES.txt: npm ${deps.length}개, 라이브러리 2개, 글꼴 ${fonts.length}개`);
