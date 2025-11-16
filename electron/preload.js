const { contextBridge, ipcMain } = require('electron');

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
  // Add any APIs you need here
  // Example: openFile: () => ipcRenderer.invoke('dialog:openFile')
});
