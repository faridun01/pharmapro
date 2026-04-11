const { contextBridge, ipcRenderer } = require('electron');

const startupStartedAtArg = process.argv.find((arg) => arg.startsWith('--pharmapro-started-at='));
const startupStartedAt = startupStartedAtArg ? Number(startupStartedAtArg.split('=')[1]) : null;

contextBridge.exposeInMainWorld('pharmaproDesktop', {
  platform: process.platform,
  startupStartedAt: Number.isFinite(startupStartedAt) ? startupStartedAt : null,
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
  markRuntime: (name, details = {}) => ipcRenderer.send('runtime:mark', {
    name,
    details,
    rendererTs: Date.now(),
  }),
});
