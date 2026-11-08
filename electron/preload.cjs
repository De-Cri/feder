// Ponte minimo e tipizzato tra l'interfaccia e il processo principale.
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
});
