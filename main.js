// main.js

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads'); // Importa Worker para usar o thread separado

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'icon.png'), // Opcional: Adicione um ícone (ex: icon.png) na raiz
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // Descomente para abrir as ferramentas de desenvolvedor automaticamente
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

// --- IPC Handlers (Comunicação entre Renderer e Main Process) ---

ipcMain.handle('open-file-dialog', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Arquivos de Catálogo', extensions: ['zip', 'fbx', 'gltf', 'obj', 'blend', 'unitypackage', 'vrm', 'png', 'jpg', 'jpeg', 'gif', 'world', 'pdf'] },
            { name: 'Todos os Arquivos', extensions: ['*'] }
        ]
    });
    return canceled ? [] : filePaths;
});

// Manipulador IPC para processar arquivos usando um Worker Thread
ipcMain.handle('process-files-batch', async (event, filePaths) => {
    const webContents = event.sender; // Captura o webContents para enviar feedback

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        console.warn('processFilesBatch no main.js recebeu caminhos de arquivo inválidos.');
        webContents.send('processing-batch-complete', []);
        return { success: false, message: 'Nenhum arquivo para processar.' };
    }

    return new Promise((resolve, reject) => {
        // Cria um novo worker thread para processar os arquivos
        const worker = new Worker(path.join(__dirname, 'fileProcessorWorker.js'));

        // Listener para mensagens do worker
        worker.on('message', (message) => {
            if (message.type === 'log') {
                // Repassa logs do worker para o console do main process
                const { level, message: logMsg, details } = message.data;
                switch (level) {
                    case 'info': console.info(`[WORKER LOG] ${logMsg}`, details); break;
                    case 'warn': console.warn(`[WORKER WARN] ${logMsg}`, details); break;
                    case 'error': console.error(`[WORKER ERROR] ${logMsg}`, details); break;
                    case 'debug': console.debug(`[WORKER DEBUG] ${logMsg}`, details); break;
                    case 'fatal': console.error(`[WORKER FATAL] ${logMsg}`, details); break;
                    default: console.log(`[WORKER] ${logMsg}`, details);
                }
            } else if (message.type === 'fileProgress') {
                // Envia o progresso de arquivo individual de volta para o renderer
                webContents.send('processing-file-progress', message.data);
            } else if (message.type === 'overallProgress') {
                // Envia o progresso geral do lote de volta para o renderer
                webContents.send('processing-overall-progress', message.data);
            } else if (message.type === 'batchComplete') {
                // Envia os resultados completos do lote de volta para o renderer
                webContents.send('processing-batch-complete', message.data);
                worker.terminate(); // Termina o worker após a conclusão bem-sucedida
                resolve({ success: true, message: 'Processamento em lote concluído pelo worker.' });
            } else if (message.type === 'error') {
                // Lida com erros reportados pelo worker
                console.error(`[MAIN] Erro do worker: ${message.data.message}`, message.data.error);
                webContents.send('processing-batch-complete', [{ success: false, error: message.data.message }]);
                worker.terminate();
                reject(new Error(message.data.message));
            }
        });

        // Listener para erros no worker thread
        worker.on('error', (err) => {
            console.error('[MAIN] Erro não capturado no worker thread:', err);
            webContents.send('processing-batch-complete', [{ success: false, error: 'Erro interno no processador de arquivos.' }]);
            reject(err);
        });

        // Listener para quando o worker thread é finalizado
        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`[MAIN] Worker thread exited with code ${code}`);
                // Se o worker não terminou por um `resolve` ou `reject` explícito,
                // isso pode indicar um erro não tratado ou um término abrupto.
            }
        });

        // Envia a mensagem para o worker iniciar o processamento dos arquivos
        worker.postMessage({ type: 'processFiles', filePaths: filePaths });
    });
});

// Manipulador IPC para abrir arquivo ou revelar na pasta
ipcMain.handle('open-file-or-folder', async (event, filePath) => {
    try {
        // Verifica se o caminho existe para evitar erros desnecessários
        if (!fs.existsSync(filePath)) {
            console.warn(`Arquivo não encontrado para abrir: ${filePath}`);
            return false;
        }

        // Tenta abrir o arquivo com o aplicativo padrão
        const result = await shell.openPath(filePath);
        if (result) {
            console.error(`Erro ao abrir ${filePath}: ${result}`);
            return false; // Retorna false se houver um erro (result conterá a mensagem de erro)
        }
        return true; // Sucesso
    } catch (error) {
        console.error(`Erro inesperado ao tentar abrir o arquivo/pasta ${filePath}:`, error);
        return false;
    }
});

// Manipulador IPC para logs do renderer (opcional, mas bom para depuração)
ipcMain.on('log-message', (event, { message, level }) => {
    switch (level) {
        case 'info':
            console.log(`[Renderer INFO] ${message}`);
            break;
        case 'warn':
            console.warn(`[Renderer WARN] ${message}`);
            break;
        case 'error':
            console.error(`[Renderer ERROR] ${message}`);
            break;
        default:
            console.log(`[Renderer LOG] ${message}`);
    }
});
