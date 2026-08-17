'use strict'

// 设置页（control.html）的 preload 桥：最小暴露面，contextIsolation + sandbox 保持开启。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  getState: () => ipcRenderer.invoke('dsh:get-state'),
  saveSettings: (settings) => ipcRenderer.invoke('dsh:save-settings', settings),
  restartWeb: () => ipcRenderer.invoke('dsh:restart-web'),
  backToWeb: () => ipcRenderer.invoke('dsh:back-to-web'),
  checkUpdates: () => ipcRenderer.invoke('dsh:check-updates'),
  openLog: () => ipcRenderer.invoke('dsh:open-log'),
  openDataDir: () => ipcRenderer.invoke('dsh:open-data-dir'),
  showTitleBarMenu: () => ipcRenderer.send('dsh:titlebar-menu'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on('dsh:update-status', listener)
    return () => ipcRenderer.removeListener('dsh:update-status', listener)
  },
})
