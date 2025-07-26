// main.js - O Coração Autônomo com Workers e Concorrência Otimizada
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads'); // Importa worker_threads

// Configuração de concorrência (quantos arquivos processar em paralelo)
const MAX_CONCURRENT_WORKERS = require('os').cpus().length || 4; // Usa o número de CPUs, ou 4 como fallback
let activeWorkers = 0;
let fileQueue = []; // Fila de arquivos para processar
let processingResults = []; // Armazena resultados dos arquivos em processamento
let totalFilesToProcess = 0; // Total de arquivos na sessão atual de processamento

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
            webSecurity: false // Apenas para o estudo/desenvolvimento
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
        const { filePath, fileIndex } = fileQueue.shift(); // Pega o próximo arquivo da fila
        activeWorkers++;

        console.log(`[Main] Iniciando worker para: ${filePath} (Worker ${activeWorkers}/${MAX_CONCURRENT_WORKERS})`);
        
        const worker = new Worker(path.join(__dirname, 'fileProcessorWorker.js'), {
            workerData: { filePath, fileIndex, totalFiles: totalFilesToProcess }
        });

        // Eventos do Worker
        worker.on('message', (message) => {
            if (message.type === 'progress') {
                // Envia o progresso individual de volta ao frontend
                mainWindow.webContents.send('processing-file-progress', {
                    fileIndex: message.fileIndex,
                    filePath: message.filePath,
                    status: message.status,
                    error: message.error
                });
            } else if (message.type === 'result') {
                // O worker terminou o processamento de um arquivo
                const { fileIndex, result } = message;
                processingResults[fileIndex] = result; // Armazena o resultado

                // Calcula o progresso geral e envia para o frontend
                const completedCount = processingResults.filter(r => r !== undefined).length;
                mainWindow.webContents.send('processing-overall-progress', {
                    completed: completedCount,
                    total: totalFilesToProcess
                });

                console.log(`[Main] Worker para ${fileIndex} finalizado. Concluído: ${completedCount}/${totalFilesToProcess}`);
            }
        });

        worker.on('error', (err) => {
            console.error(`[Main] Erro no worker para o arquivo ${filePath}:`, err);
            processingResults[fileIndex] = { success: false, error: err.message };
            const completedCount = processingResults.filter(r => r !== undefined).length;
            mainWindow.webContents.send('processing-overall-progress', {
                completed: completedCount,
                total: totalFilesToProcess
            });
        });

        worker.on('exit', (code) => {
            activeWorkers--;
            console.log(`[Main] Worker para ${filePath} encerrou com código ${code}. Workers ativos: ${activeWorkers}`);
            
            // Tenta processar o próximo arquivo na fila
            processNextFileInQueue(mainWindow);

            // Verifica se todos os arquivos foram processados
            if (activeWorkers === 0 && fileQueue.length === 0) {
                console.log('[Main] Todos os arquivos foram processados!');
                // Envia todos os resultados de volta ao renderer para exibição
                mainWindow.webContents.send('processing-batch-complete', processingResults);
                // Limpa os resultados para a próxima sessão
                processingResults = [];
                totalFilesToProcess = 0;
            }
        });
    }
}

// --- IPC Main - Comunicação com o Processo de Renderização (Frontend) ---

// Listener para o evento de processamento de múltiplos arquivos do frontend
ipcMain.handle('process-files-batch', async (event, filePaths) => {
    fileQueue = []; // Limpa a fila existente
    processingResults = new Array(filePaths.length).fill(undefined); // Reset e preenche com undefined
    totalFilesToProcess = filePaths.length;

    console.log(`[Main] Recebido lote de ${totalFilesToProcess} arquivos para processar.`);
    
    // Adiciona todos os arquivos à fila
    filePaths.forEach((filePath, index) => {
        fileQueue.push({ filePath, fileIndex: index });
    });

    // Inicia o processamento dos primeiros arquivos (até o limite de concorrência)
    for (let i = 0; i < MAX_CONCURRENT_WORKERS; i++) {
        processNextFileInQueue(BrowserWindow.fromWebContents(event.sender));
    }

    return { success: true, message: `Processamento de ${totalFilesToProcess} arquivos iniciado.` };
});


// Listener para abrir a caixa de diálogo de seleção de arquivo (agora pode selecionar múltiplos)
ipcMain.handle('open-file-dialog', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'], // Permite seleção de múltiplos arquivos
        title: 'Selecione um ou mais arquivos para o Catálogo Autônomo',
        filters: [
            { name: 'Arquivos 3D/VR', extensions: ['gltf', 'glb', 'fbx', 'obj', 'blend', 'vrml', 'unitypackage', 'zip', 'rar', '7z'] },
            { name: 'Imagens', extensions: ['jpg', 'png', 'gif', 'webp'] },
            { name: 'Todos os Arquivos', extensions: ['*'] }
        ]
    });

    if (canceled) {
        return null; // Usuário cancelou
    } else {
        return filePaths; // Retorna array de caminhos de arquivos
    }
});
