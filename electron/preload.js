const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // State
  getState: () => ipcRenderer.invoke("get-state"),

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),
  updateConfig: (patch) => ipcRenderer.invoke("update-config", patch),

  // Cache
  getCache: () => ipcRenderer.invoke("get-cache"),
  clearCache: () => ipcRenderer.invoke("clear-cache"),
  removeCacheEntry: (key) => ipcRenderer.invoke("remove-cache-entry", key),

  // Logs
  getLogs: () => ipcRenderer.invoke("get-logs"),

  // Event subscriptions
  onStateChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("state-changed", handler);
    return () => ipcRenderer.removeListener("state-changed", handler);
  },
  onLog: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("log", handler);
    return () => ipcRenderer.removeListener("log", handler);
  },
  onActivityUpdated: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("activity-updated", handler);
    return () => ipcRenderer.removeListener("activity-updated", handler);
  },
  onCacheChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("cache-changed", handler);
    return () => ipcRenderer.removeListener("cache-changed", handler);
  },

  // Auto-launch
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("set-auto-launch", enabled),

  // Window controls
  windowMinimize: () => ipcRenderer.send("window-minimize"),
  windowMaximize: () => ipcRenderer.send("window-maximize"),
  windowClose: () => ipcRenderer.send("window-close"),
});
