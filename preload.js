const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onLoad: (cb) => ipcRenderer.on('load', (_e, data) => cb(data)),
  onSaved: (cb) => ipcRenderer.on('saved', (_e, data) => cb(data)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),
  setDirty: (dirty) => ipcRenderer.send('dirty', dirty),
});
