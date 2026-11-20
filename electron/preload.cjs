const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('supermail', {
  isElectron: true,
  captureScreenshot: () => ipcRenderer.invoke('feedback:captureScreenshot'),

  invoke: (cmd, args = {}) => ipcRenderer.invoke('supermail:invoke', cmd, args),

  db: {
    select: (query, bindValues = []) => ipcRenderer.invoke('db:select', query, bindValues),
    execute: (query, bindValues = []) => ipcRenderer.invoke('db:execute', query, bindValues),
  },

  fs: {
    mkdir: (dir, options) => ipcRenderer.invoke('fs:mkdir', dir, options),
    writeFile: (file, data, options) => ipcRenderer.invoke('fs:writeFile', file, data, options),
    readFile: (file, options) => ipcRenderer.invoke('fs:readFile', file, options),
    readTextFile: (file, options) => ipcRenderer.invoke('fs:readTextFile', file, options),
    writeTextFile: (file, text, options) => ipcRenderer.invoke('fs:writeTextFile', file, text, options),
    remove: (path, options) => ipcRenderer.invoke('fs:remove', path, options),
    exists: (path, options) => ipcRenderer.invoke('fs:exists', path, options),
  },

  dialog: {
    save: (options) => ipcRenderer.invoke('dialog:save', options),
    open: (options) => ipcRenderer.invoke('dialog:open', options),
  },

  openUrl: (url) => ipcRenderer.invoke('shell:openExternal', url),

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    openThreadWindow: (threadId, accountId) => ipcRenderer.invoke('window:openThread', threadId, accountId),
  },

  on: (channel, callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
