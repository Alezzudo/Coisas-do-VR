// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
    processFilesBatch: (filePaths) => ipcRenderer.invoke('process-files-batch', filePaths),
    onProcessingFileProgress: (callback) => ipcRenderer.on('processing-file-progress', (event, ...args) => callback(...args)),
    onProcessingOverallProgress: (callback) => ipcRenderer.on('processing-overall-progress', (event, ...args) => callback(...args)),
    onProcessingBatchComplete: (callback) => ipcRenderer.on('processing-batch-complete', (event, ...args) => callback(...args)),
});
