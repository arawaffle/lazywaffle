// 렌더러에 노출하는 최소 API (window.desk)
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const handler = (e, ...args) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('desk', {
  isElectron: true,
  info: () => ipcRenderer.invoke('desk:info'),
  load: () => ipcRenderer.invoke('desk:load'),
  save: (state) => ipcRenderer.invoke('desk:save', state),
  putAsset: (bytes, ext) => ipcRenderer.invoke('desk:putAsset', bytes, ext),
  pickFile: (opts) => ipcRenderer.invoke('desk:pickFile', opts),
  exportBackup: (state) => ipcRenderer.invoke('desk:exportBackup', state),
  importBackup: () => ipcRenderer.invoke('desk:importBackup'),
  openExternal: (url) => ipcRenderer.send('desk:openExternal', url),
  requestFocus: () => ipcRenderer.send('desk:requestFocus'),
  releaseFocus: () => ipcRenderer.send('desk:releaseFocus'),
  setWallpaperMode: (on) => ipcRenderer.send('desk:setWallpaperMode', on),
  setAutostart: (on) => ipcRenderer.send('desk:setAutostart', on),
  openDataDir: () => ipcRenderer.send('desk:openDataDir'),
  clearCache: (state) => ipcRenderer.invoke('desk:clearCache', state),
  setDisplay: (id) => ipcRenderer.send('desk:setDisplay', id),
  checkUpdate: () => ipcRenderer.send('desk:checkUpdate'),
  installUpdate: () => ipcRenderer.send('desk:installUpdate'),
  quit: () => ipcRenderer.send('desk:quit'),
  notify: (title, body) => ipcRenderer.send('desk:notify', title, body),
  onMode: (cb) => on('desk:mode', cb),
  onInfo: (cb) => on('desk:info', cb),
  onCommand: (cb) => on('desk:command', cb),
  onCovered: (cb) => on('desk:covered', cb),
});
