// main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
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
    if (canceled) {
        return [];
    } else {
        return filePaths;
    }
});

ipcMain.handle('process-files-batch', async (event, filePaths) => {
    const results = [];
    const totalFiles = filePaths.length;

    for (let i = 0; i < totalFiles; i++) {
        const filePath = filePaths[i];
        try {
            // Inferir os dados do arquivo
            const itemData = await inferFileData(filePath);
            results.push({ success: true, data: itemData });

            // Enviar progresso do arquivo individual
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
        // Enviar progresso geral do lote
        event.sender.send('processing-overall-progress', {
            completed: i + 1,
            total: totalFiles
        });
    }

    // Enviar sinal de lote completo com os resultados finais
    event.sender.send('processing-batch-complete', results);

    return { success: true, message: 'Processamento em lote iniciado. Verifique o console para resultados.' };
});
