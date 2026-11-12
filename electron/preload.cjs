// Minimal, typed bridge between the interface and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cerchio', {
  version: ipcRenderer.sendSync('app:version'),
  openExternal: (url) => ipcRenderer.invoke('open', url),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onPickSource: (cb) => {
    ipcRenderer.removeAllListeners('screen:pick');
    ipcRenderer.on('screen:pick', (_e, sources) => cb(sources));
  },
  pickSource: (id) => ipcRenderer.send('screen:picked', id),
  setBackground: (background) => ipcRenderer.send('background', !!background),
  // Minimized/hidden window: the interface stops drawing videos.
  onWindowHidden: (cb) => {
    ipcRenderer.removeAllListeners('window:hidden');
    ipcRenderer.on('window:hidden', (_e, hidden) => cb(!!hidden));
  },
});
