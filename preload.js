// preload.js - A Ponte Segura (Atualizado para Batch e Progresso)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Agora envia um array de caminhos de arquivos
    processFilesBatch: (filePaths) => ipcRenderer.invoke('process-files-batch', filePaths),
    // Abre a caixa de diálogo de seleção de arquivo (agora para múltiplos)
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

    // Eventos para receber progresso do processo principal
    onProcessingFileProgress: (callback) => ipcRenderer.on('processing-file-progress', (_event, value) => callback(value)),
    onProcessingOverallProgress: (callback) => ipcRenderer.on('processing-overall-progress', (_event, value) => callback(value)),
    onProcessingBatchComplete: (callback) => ipcRenderer.on('processing-batch-complete', (_event, value) => callback(value)),
});