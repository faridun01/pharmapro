const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pharmaproDesktop', {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  controls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  authHeaders: () => ipcRenderer.invoke('desktop:get-auth-headers'),
});
