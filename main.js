// main.js

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip'); // Para ler arquivos .zip

// Função para gerar um ID único simples
function generateUniqueId() {
    return 'c' + Date.now() + Math.random().toString(36).substring(2, 9);
}

// Função para inferir dados de um arquivo
async function inferFileData(filePath) {
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    const title = fileName.replace(fileExtension, '').replace(/_/g, ' ').trim(); // Título básico do nome do arquivo
    let description = "Descrição gerada automaticamente pelo Bibliotecário Autônomo.";
    let category = "Uncategorized";
    let imageUrl = `https://via.placeholder.com/300x200/440000/FFFFFF?text=${encodeURIComponent(title.substring(0, Math.min(title.length, 15)))}`; // Imagem placeholder

    // Tentar encontrar uma imagem de pré-visualização para unitypackage e zip
    if (fileExtension === '.unitypackage' || fileExtension === '.zip') {
        try {
            const zip = new AdmZip(filePath);
            const zipEntries = zip.getEntries(); // get all entries from the zip

            // Procurar por imagens comuns (preview, thumbnail) dentro do zip
            const imageEntry = zipEntries.find(entry => {
                const entryNameLower = entry.entryName.toLowerCase();
                return (entryNameLower.includes('preview') || entryNameLower.includes('thumbnail')) &&
                       (entryNameLower.endsWith('.png') || entryNameLower.endsWith('.jpg') || entryNameLower.endsWith('.jpeg'));
            });

            if (imageEntry) {
                // Extrair a imagem para um local temporário e usar a URL local
                const tempDir = app.getPath('temp');
                const tempImagePath = path.join(tempDir, generateUniqueId() + path.extname(imageEntry.entryName));
                fs.writeFileSync(tempImagePath, imageEntry.getData());
                imageUrl = `file://${tempImagePath}`;
            }

            // Tentar inferir descrição de README.txt ou similar
            const readmeEntry = zipEntries.find(entry => entry.entryName.toLowerCase().includes('readme.txt') || entry.entryName.toLowerCase().includes('description.txt'));
            if (readmeEntry) {
                description = readmeEntry.getData().toString('utf8').trim().substring(0, 500); // Limita a 500 caracteres
                if (description.length === 500) description += '...';
            }

        } catch (zipError) {
            console.warn(`Não foi possível ler o conteúdo do ZIP/UnityPackage ${fileName}: ${zipError.message}`);
            // Continua com as inferências baseadas na extensão
        }
    } else if (['.png', '.jpg', '.jpeg', '.gif'].includes(fileExtension)) {
        imageUrl = `file://${filePath}`; // Se for uma imagem, usa ela como pré-visualização
        category = 'Image Asset';
    }


    // Inferência de Categoria e Descrição baseada na extensão
    switch (fileExtension) {
        case '.fbx':
        case '.obj':
        case '.gltf':
        case '.blend':
            category = 'Models';
            if (description === "Descrição gerada automaticamente pelo Bibliotecário Autônomo.") {
                description = `Modelo 3D: ${title}. Um ativo tridimensional de ${fileExtension.substring(1).toUpperCase()}.`;
            }
            break;
        case '.vrm':
            category = 'Models'; // Avatares VRM são modelos
            if (description === "Descrição gerada automaticamente pelo Bibliotecário Autônomo.") {
                description = `Avatar VRM: ${title}. Um modelo de avatar otimizado para realidade virtual.`;
            }
            break;
        case '.unitypackage':
            category = 'Uncategorized'; // Pode ser avatar, mundo, asset, etc. O usuário confirmará.
            if (description === "Descrição gerada automaticamente pelo Bibliotecário Autônomo.") {
                description = `Pacote Unity: ${title}. Contém recursos para importação no Unity Engine.`;
            }
            break;
        case '.zip':
            category = 'Uncategorized'; // Conteúdo de um zip é genérico.
            if (description === "Descrição gerada automaticamente pelo Bibliotecário Autônomo.") {
                description = `Arquivo ZIP: ${title}. Um arquivo compactado que pode conter diversos tipos de ativos.`;
            }
            break;
        case '.world': // Exemplo para VRChat world files (se aplicável)
            category = 'Worlds';
            if (description === "Descrição gerada automaticamente pelo Bibliotecário Autônomo.") {
                description = `Arquivo de Mundo VR: ${title}. Um cenário interativo para ambientes virtuais.`;
            }
            break;
        // Adicione mais casos para outras extensões de arquivo que você espera
        default:
            // A categoria e descrição padrão já foram definidas no início
            break;
    }

    // O downloadUrl é sempre o caminho local do arquivo original
    const downloadUrl = `file://${filePath}`;

    return {
        id: generateUniqueId(),
        title: title,
        description: description,
        downloadUrl: downloadUrl,
        category: category,
        imageUrl: imageUrl
    };
}

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
            { name: 'Arquivos de Catálogo', extensions: ['zip', 'fbx', 'gltf', 'obj', 'blend', 'unitypackage', 'vrm', 'png', 'jpg', 'jpeg', 'gif', 'world'] },
            { name: 'Todos os Arquivos', extensions: ['*'] }
        ]
    });
    return canceled ? [] : filePaths;
});

ipcMain.handle('process-files-batch', async (event, filePaths) => {
    const results = [];
    const totalFiles = filePaths.length;

    // Adicione validação básica aqui também, caso o frontend não passe corretamente
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        console.warn('processFilesBatch no main.js recebeu caminhos de arquivo inválidos.');
        event.sender.send('processing-batch-complete', []); // Notifica o frontend
        return { success: false, message: 'Nenhum arquivo para processar.' };
    }

    for (let i = 0; i < totalFiles; i++) {
        const filePath = filePaths[i];
        try {
            const itemData = await inferFileData(filePath); // Sua função de inferência existente
            results.push({ success: true, data: itemData });
            event.sender.send('processing-file-progress', {
                fileIndex: i,
                totalFiles: totalFiles,
                filePath: filePath,
                status: 'completed'
            });
        } catch (error) {
            console.error(`Falha ao processar arquivo ${filePath}:`, error);
            results.push({ success: false, error: error.message, filePath: filePath });
            event.sender.send('processing-file-progress', {
                fileIndex: i,
                totalFiles: totalFiles,
                filePath: filePath,
                status: 'failed',
                error: error.message
            });
        }
        event.sender.send('processing-overall-progress', {
            completed: i + 1,
            total: totalFiles
        });
    }

    event.sender.send('processing-batch-complete', results);
    return { success: true, message: 'Processamento em lote concluído.' };
});

// NOVO: Manipulador IPC para abrir arquivo ou revelar na pasta
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

// NOVO: Manipulador IPC para logs do renderer (opcional, mas bom para depuração)
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
