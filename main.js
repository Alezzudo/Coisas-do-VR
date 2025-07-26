// main.js - O Coração Autônomo com Workers e Concorrência Otimizada (Com Tratamento de Erros)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');
const fs = require('fs'); // Para logging de erros, se necessário

// --- Tratamento de Erros Globais no Processo Principal ---
process.on('uncaughtException', (error) => {
    console.error('[Main Process - Uncaught Exception]', error);
    // Em um ambiente de produção, você pode logar isso em um arquivo ou serviço de monitoramento.
    // Para o usuário, pode exibir um dialog simples.
    dialog.showErrorBox('Erro Inesperado no Sistema', 'Um erro grave ocorreu e a aplicação pode precisar ser reiniciada. Detalhes: ' + error.message);
    app.quit(); // Pode ser agressivo, mas evita estados corrompidos.
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Main Process - Unhandled Rejection]', reason);
    // Log do erro, pode ser útil para depuração de promessas não tratadas.
    // Semelhante ao uncaughtException, mas para promessas.
});

// Configuração de concorrência (quantos arquivos processar em paralelo)
const MAX_CONCURRENT_WORKERS = require('os').cpus().length || 4; // Usa o número de CPUs, ou 4 como fallback
let activeWorkers = 0;
let fileQueue = [];
let processingResults = [];
let totalFilesToProcess = 0;

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false // Apenas para o estudo/desenvolvimento - CUIDADO EM PRODUÇÃO
        }
    });

    mainWindow.loadFile('index.html');

    // Opcional: Abrir DevTools para depuração
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// --- Gerenciamento da Fila de Processamento de Arquivos ---
function processNextFileInQueue(mainWindow) {
    if (fileQueue.length > 0 && activeWorkers < MAX_CONCURRENT_WORKERS) {
        const { filePath, fileIndex } = fileQueue.shift();
        activeWorkers++;

        console.log(`[Main] Iniciando worker para: ${filePath} (Worker ${activeWorkers}/${MAX_CONCURRENT_WORKERS})`);
        
        try { // Captura erros ao criar o worker
            const worker = new Worker(path.join(__dirname, 'fileProcessorWorker.js'), {
                workerData: { filePath, fileIndex, totalFiles: totalFilesToProcess }
            });

            worker.on('message', (message) => {
                if (message.type === 'progress') {
                    mainWindow.webContents.send('processing-file-progress', {
                        fileIndex: message.fileIndex,
                        filePath: message.filePath,
                        status: message.status,
                        error: message.error
                    });
                } else if (message.type === 'result') {
                    const { fileIndex, result } = message;
                    processingResults[fileIndex] = result;

                    const completedCount = processingResults.filter(r => r !== undefined).length;
                    mainWindow.webContents.send('processing-overall-progress', {
                        completed: completedCount,
                        total: totalFilesToProcess
                    });

                    console.log(`[Main] Worker para ${fileIndex} finalizado. Concluído: ${completedCount}/${totalFilesToProcess}`);
                }
            });

            worker.on('error', (err) => {
                console.error(`[Main] Erro fatal no worker para o arquivo ${filePath}:`, err);
                processingResults[fileIndex] = { success: false, error: `Erro interno ao processar: ${err.message}` };
                mainWindow.webContents.send('processing-file-progress', {
                    fileIndex: fileIndex,
                    filePath: filePath,
                    status: 'failed',
                    error: err.message
                });
                // Garante que o contador de concluídos seja atualizado
                const completedCount = processingResults.filter(r => r !== undefined).length;
                mainWindow.webContents.send('processing-overall-progress', {
                    completed: completedCount,
                    total: totalFilesToProcess
                });
            });

            worker.on('exit', (code) => {
                activeWorkers--;
                console.log(`[Main] Worker para ${filePath} encerrou com código ${code}. Workers ativos: ${activeWorkers}`);
                
                processNextFileInQueue(mainWindow);

                if (activeWorkers === 0 && fileQueue.length === 0) {
                    console.log('[Main] Todos os arquivos foram processados!');
                    mainWindow.webContents.send('processing-batch-complete', processingResults);
                    processingResults = [];
                    totalFilesToProcess = 0;
                }
            });
        } catch (error) {
            console.error(`[Main] Erro ao tentar criar worker para ${filePath}:`, error);
            activeWorkers--; // Certifica-se de que o contador de workers é decrementado
            processingResults[fileIndex] = { success: false, error: `Falha ao iniciar processamento: ${error.message}` };
            
            // Tenta processar o próximo arquivo na fila
            processNextFileInQueue(mainWindow);

            // Garante que o contador de concluídos seja atualizado
            const completedCount = processingResults.filter(r => r !== undefined).length;
            mainWindow.webContents.send('processing-overall-progress', {
                completed: completedCount,
                total: totalFilesToProcess
            });
            // Se for o último, enviar o batch completo
            if (activeWorkers === 0 && fileQueue.length === 0) {
                mainWindow.webContents.send('processing-batch-complete', processingResults);
                processingResults = [];
                totalFilesToProcess = 0;
            }
        }
    }
}

// --- IPC Main - Comunicação com o Processo de Renderização (Frontend) ---

ipcMain.handle('process-files-batch', async (event, filePaths) => {
    try {
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            throw new Error("Caminhos de arquivo inválidos ou vazios para processamento.");
        }

        fileQueue = [];
        processingResults = new Array(filePaths.length).fill(undefined);
        totalFilesToProcess = filePaths.length;

        console.log(`[Main] Recebido lote de ${totalFilesToProcess} arquivos para processar.`);
        
        filePaths.forEach((filePath, index) => {
            fileQueue.push({ filePath, fileIndex: index });
        });

        for (let i = 0; i < MAX_CONCURRENT_WORKERS; i++) {
            processNextFileInQueue(BrowserWindow.fromWebContents(event.sender));
        }

        return { success: true, message: `Processamento de ${totalFilesToProcess} arquivos iniciado.` };
    } catch (error) {
        console.error('[Main] Erro em process-files-batch:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-file-dialog', async (event) => {
    try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            title: 'Selecione um ou mais arquivos para o Catálogo Autônomo',
            filters: [
                { name: 'Arquivos 3D/VR', extensions: ['gltf', 'glb', 'fbx', 'obj', 'blend', 'vrml', 'unitypackage', 'zip', 'rar', '7z'] },
                { name: 'Imagens', extensions: ['jpg', 'png', 'gif', 'webp'] },
                { name: 'Todos os Arquivos', extensions: ['*'] }
            ]
        });

        if (canceled) {
            return null;
        } else {
            return filePaths;
        }
    } catch (error) {
        console.error('[Main] Erro em open-file-dialog:', error);
        return { success: false, error: error.message };
    }
});
