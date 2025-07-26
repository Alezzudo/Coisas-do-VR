const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function log(message, level = 'info') {
    const timestamp = new Date().toLocaleString();
    console.log(`[${timestamp}][${level.toUpperCase()}] ${message}`);
    // Uncomment to enable file logging:
    // try {
    //     fs.appendFileSync(path.join(app.getPath('userData'), 'app.log'), `[${timestamp}][${level.toUpperCase()}] ${message}\n`);
    // } catch (err) {
    //     console.error('Failed to write log file:', err);
    // }
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            enableRemoteModule: false
        }
    });

    mainWindow.loadFile('index.html');

    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
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

// --- IPC Handlers ---

ipcMain.handle('dialog:openFile', async () => {
    log('IPC: dialog:openFile chamado');
    if (!mainWindow) {
        log('mainWindow is not available.', 'error');
        return [];
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Arquivos de Catálogo', extensions: ['zip', 'fbx', 'gltf', 'obj', 'blend', 'unitypackage', 'pdf', 'png', 'jpg', 'jpeg', 'gif'] },
            { name: 'Todos os Arquivos', extensions: ['*'] }
        ]
    });

    if (canceled) {
        log('Seleção de arquivo cancelada.');
        return [];
    } else {
        log(`Arquivos selecionados: ${filePaths.length}`);
        return filePaths;
    }
});

ipcMain.handle('shell:openFileOrFolder', async (event, filePath) => {
    log(`IPC: shell:openFileOrFolder chamado para: ${filePath}`);
    try {
        if (!fs.existsSync(filePath)) {
            log(`Erro: Caminho não encontrado: ${filePath}`, 'error');
            return false;
        }
        const result = await shell.openPath(filePath);
        if (result) {
            log(`Falha ao abrir ${filePath}: ${result}`, 'error');
            return false;
        }
        log(`Arquivo/Pasta aberta com sucesso: ${filePath}`, 'info');
        return true;
    } catch (error) {
        log(`Erro ao abrir arquivo/pasta ${filePath}: ${error.message}`, 'error');
        return false;
    }
});

ipcMain.handle('process:filesBatch', async (event, filePaths) => {
    log(`IPC: process:filesBatch chamado para ${filePaths.length} arquivos.`);
    const results = [];
    const totalFiles = filePaths.length;

    for (let i = 0; i < totalFiles; i++) {
        const filePath = filePaths[i];
        try {
            log(`Processando arquivo ${i + 1}/${totalFiles}: ${filePath}`);

            if (mainWindow) {
                mainWindow.webContents.send('processing-file-progress', {
                    fileIndex: i,
                    totalFiles: totalFiles,
                    filePath: filePath,
                    status: 'processing'
                });
            }

            const fileName = path.basename(filePath);
            const fileExt = path.extname(filePath).toLowerCase();
            const inferredTitle = fileName.replace(fileExt, '');
            let inferredCategory = 'Uncategorized';
            let inferredDescription = `Arquivo ${fileName} adicionado automaticamente.`;
            let inferredImageUrl = 'https://via.placeholder.com/300x200/440000/FFFFFF?text=Item';

            if (['.zip', '.rar', '.7z'].includes(fileExt)) {
                inferredDescription = `Pacote compactado contendo múltiplos arquivos ou um projeto.`;
                inferredCategory = 'UnityPackage';
                inferredImageUrl = 'https://via.placeholder.com/300x200/ff6600/ffffff?text=Pacote';
            } else if (['.fbx', '.obj', '.gltf', '.blend', '.vrm', '.pmx'].includes(fileExt)) {
                inferredCategory = 'Models';
                inferredDescription = `Modelo 3D de ${inferredTitle}.`;
                inferredImageUrl = 'https://via.placeholder.com/300x200/007bff/ffffff?text=Modelo+3D';
            } else if (['.unitypackage'].includes(fileExt)) {
                inferredCategory = 'UnityPackage';
                inferredDescription = `Pacote Unity para importação de assets ou projetos.`;
                inferredImageUrl = 'https://via.placeholder.com/300x200/00aaff/ffffff?text=UnityPackage';
            } else if (['.pdf', '.doc', '.docx', '.txt'].includes(fileExt)) {
                inferredCategory = 'Documents';
                inferredDescription = `Documento: ${inferredTitle}.`;
                inferredImageUrl = 'https://via.placeholder.com/300x200/008000/ffffff?text=Documento';
            } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExt)) {
                inferredCategory = 'Image Asset';
                inferredDescription = `Arquivo de imagem: ${inferredTitle}.`;
                inferredImageUrl = `file://${filePath.replace(/\\/g, '/')}`;
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            const itemData = {
                id: `c${Date.now()}-${i}`,
                imageUrl: inferredImageUrl,
                title: inferredTitle,
                description: inferredDescription,
                downloadUrl: `file://${filePath.replace(/\\/g, '/')}`,
                category: inferredCategory
            };

            results.push({ success: true, data: itemData });

            if (mainWindow) {
                mainWindow.webContents.send('processing-file-progress', {
                    fileIndex: i,
                    totalFiles: totalFiles,
                    filePath: filePath,
                    status: 'completed',
                    data: itemData
                });

                mainWindow.webContents.send('processing-overall-progress', {
                    completed: i + 1,
                    total: totalFiles
                });
            }

        } catch (error) {
            log(`Erro ao processar arquivo ${filePath}: ${error.message}`, 'error');
            results.push({ success: false, filePath: filePath, error: error.message });
            if (mainWindow) {
                mainWindow.webContents.send('processing-file-progress', {
                    fileIndex: i,
                    totalFiles: totalFiles,
                    filePath: filePath,
                    status: 'failed',
                    error: error.message
                });
            }
        }
    }

    if (mainWindow) {
        mainWindow.webContents.send('processing-batch-complete', results);
    }
    log(`IPC: process:filesBatch concluído. Total de itens processados: ${totalFiles}.`);
    return results;
});

ipcMain.on('log', (event, message, level) => {
    log(`RENDERER: ${message}`, level);
});
