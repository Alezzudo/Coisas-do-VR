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
        const listener = (event, args) => callback(args);
        ipcRenderer.on('processing-file-progress', listener);
        // Return unsubscribe function
        return () => ipcRenderer.removeListener('processing-file-progress', listener);
    },
    onProcessingOverallProgress: (callback) => {
        const listener = (event, args) => callback(args);
        ipcRenderer.on('processing-overall-progress', listener);
        return () => ipcRenderer.removeListener('processing-overall-progress', listener);
    },
    onProcessingBatchComplete: (callback) => {
        const listener = (event, args) => callback(args);
        ipcRenderer.on('processing-batch-complete', listener);
        return () => ipcRenderer.removeListener('processing-batch-complete', listener);
    },

    // API para logging do renderer para o main
    log: (message, level = 'info') => {
        ipcRenderer.send('log', message, level);
    }
});

// Listener para erros globais no processo de renderização (para debug)
window.addEventListener('DOMContentLoaded', () => {
    console.log("preload: DOMContentLoaded");

    // Captura erros não tratados em Promises
    window.addEventListener('unhandledrejection', (event) => {
        console.error("Unhandled Rejection in preload:", event.reason);
        ipcRenderer.send('log', `Unhandled Rejection in preload: ${event.reason && event.reason.message ? event.reason.message : event.reason}`, 'error');
    });

    // Captura erros globais de execução
    window.onerror = (message, source, lineno, colno, error) => {
        console.error("Uncaught Exception in preload:", message, error);
        ipcRenderer.send('log', `Uncaught Exception in preload: ${message}`, 'error');
    };
});
