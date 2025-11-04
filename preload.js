const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

contextBridge.exposeInMainWorld('selectionCopy', {
  getActiveApp: () => invoke('selection-copy:get-active-app'),
  readConfig: () => invoke('selection-copy:read-config'),
  onConfigUpdated: (callback) => {
    const handler = (_event, config) => callback(config);
    ipcRenderer.on('selection-copy:config-updated', handler);
    return () => ipcRenderer.removeListener('selection-copy:config-updated', handler);
  },
  onNativeTheme: (callback) => {
    const handler = (_event, mode) => callback(mode);
    ipcRenderer.on('selection-copy:native-theme', handler);
    return () => ipcRenderer.removeListener('selection-copy:native-theme', handler);
  },
  openConfigFolder: () => invoke('selection-copy:open-config-folder'),
  determineToolbarSize: (width, height) =>
    invoke('selection-copy:determine-toolbar-size', Number(width), Number(height)),
  writeToClipboard: (text) => invoke('selection-copy:write-to-clipboard', text),
  onShowBubble: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('selection-copy:show-bubble', handler);
    return () => ipcRenderer.removeListener('selection-copy:show-bubble', handler);
  },
  onHideBubble: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('selection-copy:hide-bubble', handler);
    return () => ipcRenderer.removeListener('selection-copy:hide-bubble', handler);
  },
  logError: (payload) => send('selection-copy:log-error', payload)
});
