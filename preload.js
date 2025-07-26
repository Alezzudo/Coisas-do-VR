const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // API para abrir diálogo de arquivo
    openFileDialog: () => {
        console.log("preload: openFileDialog chamado");
        return ipcRenderer.invoke('dialog:openFile');
    },

    // API para abrir arquivo/pasta
    openFileOrFolder: (filePath) => {
        console.log("preload: openFileOrFolder chamado para", filePath);
        return ipcRenderer.invoke('shell:openFileOrFolder', filePath);
    },

    // API para processar arquivos em lote
    processFilesBatch: (filePaths) => {
        console.log("preload: processFilesBatch chamado para", filePaths.length, "arquivos.");
        return ipcRenderer.invoke('process:filesBatch', filePaths);
    },

    // Listeners para comunicação do main para o renderer (progresso)
    onProcessingFileProgress: (callback) => {
        ipcRenderer.on('processing-file-progress', (event, args) => callback(args));
    },
    onProcessingOverallProgress: (callback) => {
        ipcRenderer.on('processing-overall-progress', (event, args) => callback(args));
    },
    onProcessingBatchComplete: (callback) => {
        ipcRenderer.on('processing-batch-complete', (event, args) => callback(args));
    },

    // API para logging do renderer para o main
    log: (message, level = 'info') => {
        ipcRenderer.send('log', message, level);
    }
});

// Listener para erros globais no processo de renderização (para debug)
window.addEventListener('DOMContentLoaded', () => {
    console.log("preload: DOMContentLoaded");
    process.on('uncaughtException', (err) => {
        console.error("Uncaught Exception in preload:", err);
        ipcRenderer.send('log', `Uncaught Exception in preload: ${err.message}`, 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error("Unhandled Rejection in preload:", event.reason);
        ipcRenderer.send('log', `Unhandled Rejection in preload: ${event.reason.message || event.reason}`, 'error');
    });
});
