// 작업표시줄 미리보기 이미지(build/taskbar-preview.png, @2x)를 만든다. 실행: npm run taskbar-preview
// 앱의 작업표시줄 대리 창은 웹 화면(렌더러 프로세스) 없이 이 이미지만 보여 줘 메모리를 아낀다.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 320;
const H = 180;
const PAGE = '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#fff;font:600 22px sans-serif">'
  + '<div style="text-align:center">LazyWaffle<div style="font:400 13px sans-serif;opacity:.7;margin-top:6px">클릭: 앞으로 · 다시 클릭: 바탕화면</div></div></body>';

async function render(scale) {
  const win = new BrowserWindow({
    width: W * scale, height: H * scale, show: false, frame: false, useContentSize: true, backgroundColor: '#111111',
    webPreferences: { zoomFactor: scale },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE)).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const img = (await win.webContents.capturePage()).resize({ width: W * scale, height: H * scale, quality: 'best' });
  win.destroy();
  return img.toPNG();
}

app.on('window-all-closed', () => {}); // 첫 창을 닫아도 끝나지 않게
app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', 'build');
  fs.writeFileSync(path.join(out, 'taskbar-preview.png'), await render(1));
  fs.writeFileSync(path.join(out, 'taskbar-preview@2x.png'), await render(2));
  console.log('taskbar preview:', out);
  app.quit();
});
