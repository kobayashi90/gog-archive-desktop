// Preload — the only bridge between the sandboxed renderer and main.
// Exposes an API shaped like the Tauri surface the frontend already uses:
//   invoke(cmd, args)      → Promise (throws the error *string*, Tauri-style)
//   listen(channel, cb)    → Promise<unlisten>, cb receives { payload }
//   window.*               → BrowserWindow controls
//   pickFolder()           → native directory picker (plugin-dialog replacement)

const { contextBridge, ipcRenderer } = require('electron')

const EVENTS = ['torrent-status', 'tray-action', 'download-progress']

contextBridge.exposeInMainWorld('gog', {
  invoke: (cmd, args) => ipcRenderer.invoke('gog-command', cmd, args ?? {}),

  listen (channel, cb) {
    if (!EVENTS.includes(channel)) return Promise.resolve(() => {})
    const handler = (_event, payload) => cb({ payload })
    ipcRenderer.on(channel, handler)
    return Promise.resolve(() => ipcRenderer.removeListener(channel, handler))
  },

  window: {
    minimize: () => ipcRenderer.invoke('win-ctl', 'minimize'),
    unminimize: () => ipcRenderer.invoke('win-ctl', 'unminimize'),
    toggleMaximize: () => ipcRenderer.invoke('win-ctl', 'toggleMaximize'),
    show: () => ipcRenderer.invoke('win-ctl', 'show'),
    setFocus: () => ipcRenderer.invoke('win-ctl', 'setFocus'),
    close: () => ipcRenderer.invoke('win-ctl', 'close')
  },

  pickFolder: () => ipcRenderer.invoke('pick-folder')
})
