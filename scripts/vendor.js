// node_modules 에서 렌더러가 쓰는 라이브러리·폰트를 renderer/vendor, renderer/fonts 로 복사한다.
// 빌드 도구 없이 ES 모듈로 바로 불러오기 위함. (npm install 후 한 번 실행: npm run vendor)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = (...p) => path.join(root, 'renderer', ...p);

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// 1) Preact + hooks + htm
copy(nm('preact/dist/preact.module.js'), out('vendor/preact.module.js'));
copy(nm('htm/dist/htm.module.js'), out('vendor/htm.module.js'));
// hooks 모듈의 'preact' import 를 상대 경로로 바꿔 import map(인라인 스크립트) 없이 동작하게 한다.
const hooks = fs.readFileSync(nm('preact/hooks/dist/hooks.module.js'), 'utf8')
  .replace(/from\s*["']preact["']/g, 'from"./preact.module.js"');
fs.writeFileSync(out('vendor/hooks.module.js'), hooks);
// 압축본에는 저작권 표시가 없으므로 라이선스 전문을 옆에 둔다 (MIT · Apache-2.0 은 재배포 시 포함 필요)
copy(nm('preact/LICENSE'), out('vendor/LICENSE-preact.txt'));
copy(nm('htm/LICENSE'), out('vendor/LICENSE-htm.txt'));

// 2) 본문·숫자·전광판 폰트(나눔스퀘어, 페이퍼로지, Mona12)는 renderer/fonts 에 직접 포함되어 있다.
//    라이선스(SIL OFL 1.1) 전문도 renderer/fonts/LICENSE-*.txt 로 함께 들어 있다.

// 3) Serif: Playfair Display(라틴) + Noto Serif KR(한글, unicode-range 분할)
const cssParts = [];
function fontsource(pkg, cssFiles, dirName, family) {
  // SIL OFL 1.1: 폰트 파일과 함께 저작권 표시 · 라이선스 전문을 배포해야 한다
  copy(nm('@fontsource', pkg, 'LICENSE'), out('fonts', dirName, 'LICENSE.txt'));
  for (const file of cssFiles) {
    let css = fs.readFileSync(nm('@fontsource', pkg, file), 'utf8');
    if (family) css = css.replace(/font-family: '[^']+'/g, `font-family: '${family}'`);
    css = css.replace(/url\(\.\/files\/([^)]+)\)/g, (m, name) => {
      if (name.endsWith('.woff')) return 'url(data:,)'; // woff2 만 사용
      copy(nm('@fontsource', pkg, 'files', name), out('fonts', dirName, name));
      return `url(./${dirName}/${name})`;
    });
    css = css.replace(/,\s*url\(data:,\) format\('woff'\)/g, '');
    cssParts.push(css);
  }
}
fontsource('playfair-display', ['latin-400.css', 'latin-600.css'], 'playfair');
// 한글 serif 는 600 한 굵기만 (다른 굵기는 브라우저가 가까운 굵기로 대신 씀 — 용량 절반)
fontsource('noto-serif-kr', ['600.css'], 'noto-serif-kr');
// 본문 굵기(400) 한글 serif: D-DAY 이름처럼 가는 글씨가 필요한 곳만 쓰도록 이름을 따로 둔다 (기존 제목들의 굵기는 그대로)
fontsource('noto-serif-kr', ['400.css'], 'noto-serif-kr', 'Noto Serif KR Text');
fs.writeFileSync(out('fonts/serif.css'), cssParts.join('\n'));

console.log('vendor done');
