// main.js - O Coração Autônomo
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs'); // Módulo Node.js para acesso ao sistema de arquivos
const util = require('util'); // Para promisify fs.readdir

// Funções Node.js para simular processamento de arquivos
// HINT: Em um cenário real, estas funções seriam muito mais complexas,
// usando bibliotecas para descompactação (ex: 'adm-zip'),
// análise de imagem (ex: 'sharp'), etc.
async function processFileContent(filePath) {
    const fileName = path.basename(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();

    // Simulação de leitura de metadados e inferência
    let inferredTitle = fileName.split('.').slice(0, -1).join('.');
    let inferredDescription = `Item processado localmente: ${fileName}. Tipo: ${fileExtension}.`;
    let inferredImageUrl = 'https://via.placeholder.com/300x200/cc0000/ffffff?text=Item+Local';
    let inferredCategory = 'Uncategorized';
    let downloadUrl = `file://${filePath}`; // URL direta para o arquivo local!

    // Lógica de inferência SIMULADA (pode ser aprimorada com IA no futuro)
    if (fileName.toLowerCase().includes('model') || ['.gltf', '.fbx', '.obj', '.blend'].includes(fileExtension)) {
        inferredCategory = 'Models';
        inferredDescription = `Modelo 3D (${fileExtension}): ${inferredTitle}.`;
        inferredImageUrl = 'https://via.placeholder.com/300x200/660000/FFFFFF?text=MODEL';
    } else if (fileName.toLowerCase().includes('world') || ['.vrml', '.unitypackage'].includes(fileExtension)) {
        inferredCategory = 'Worlds';
        inferredDescription = `Cenário/Mundo Virtual (${fileExtension}): ${inferredTitle}.`;
        inferredImageUrl = 'https://via.placeholder.com/300x200/880000/FFFFFF?text=WORLD';
    } else if (fileName.toLowerCase().includes('prop') || ['.fbx', '.obj', '.zip'].includes(fileExtension)) {
        inferredCategory = 'Props';
        inferredDescription = `Prop/Objeto (${fileExtension}): ${inferredTitle}.`;
        inferredImageUrl = 'https://via.placeholder.com/300x200/aa0000/FFFFFF?text=PROP';
    } else if (fileName.toLowerCase().includes('outfit') || ['.zip', '.rar'].includes(fileExtension)) {
        inferredCategory = 'Outfits';
        inferredDescription = `Roupa/Vestimenta (${fileExtension}): ${inferredTitle}.`;
        inferredImageUrl = 'https://via.placeholder.com/300x200/bb0000/FFFFFF?text=OUTFIT';
    } else if (fileName.toLowerCase().includes('avatar') || ['.zip', '.fbx', '.blend'].includes(fileExtension)) {
        inferredCategory = 'Avatar Assets';
        inferredDescription = `Asset para avatar (${fileExtension}): ${inferredTitle}.`;
        inferredImageUrl = 'https://via.placeholder.com/300x200/cc0000/FFFFFF?text=AVATAR+ASSET';
    } else if (fileName.toLowerCase().includes('world asset') || ['.zip', '.unitypackage'].includes(fileExtension)) {
        inferredCategory = 'World Assets';
        inferredDescription = `Asset para mundo (${fileExtension}): ${inferredTitle}.`;
        inferredImageUrl = 'https://via.placeholder.com/300x200/ee0000/FFFFFF?text=WORLD+ASSET';
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(fileExtension)) {
        inferredCategory = 'Image Asset'; // Nova categoria para imagens
        inferredDescription = `Imagem: ${inferredTitle}.`;
        inferredImageUrl = downloadUrl; // Se for uma imagem, ela mesma é a pré-visualização
    }
    
    // HINT: Integração real com APIs externas como Google, Booth, VRModels
    // Isso exigiria chaves de API e um parser para as respostas.
    // Exemplo conceitual (não funcional aqui sem as chaves e lógica de API):
    // const googleResults = await fetch(`https://api.google.com/search?q=${encodeURIComponent(inferredTitle)}`).then(res => res.json());
    // if (googleResults.someData) { inferredDescription += ` Encontrado via Google.`; }


    return {
        title: inferredTitle,
        description: inferredDescription,
        imageUrl: inferredImageUrl,
        downloadUrl: downloadUrl,
        category: inferredCategory
    };
}


function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1400, // Largura maior
    height: 900, // Altura maior
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // É falso, pois estamos usando preload para segurança
      contextIsolation: true, // Importante para segurança
      webSecurity: false // Apenas para o estudo, permite carregar file:// URLs de imagens. Em produção, use um servidor local ou ajuste de segurança.
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


// --- IPC Main - Comunicação com o Processo de Renderização (Frontend) ---

// Listener para o evento de processamento de arquivo do frontend
ipcMain.handle('process-file', async (event, filePath) => {
    try {
        console.log('Recebido arquivo para processar:', filePath);
        const fileStats = fs.statSync(filePath);
        if (!fileStats.isFile()) {
            throw new Error('Caminho não aponta para um arquivo válido.');
        }

        const result = await processFileContent(filePath);
        return { success: true, data: result };
    } catch (error) {
        console.error('Erro ao processar arquivo:', error.message);
        dialog.showErrorBox('Erro de Processamento', `Não foi possível processar o arquivo: ${error.message}`);
        return { success: false, error: error.message };
    }
});

// Listener para abrir a caixa de diálogo de seleção de arquivo
ipcMain.handle('open-file-dialog', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Selecione um arquivo para o Catálogo Autônomo',
        // Filtros opcionais de tipo de arquivo
        filters: [
            { name: 'Arquivos 3D/VR', extensions: ['gltf', 'glb', 'fbx', 'obj', 'blend', 'vrml', 'unitypackage', 'zip', 'rar', '7z'] },
            { name: 'Imagens', extensions: ['jpg', 'png', 'gif', 'webp'] },
            { name: 'Todos os Arquivos', extensions: ['*'] }
        ]
    });

    if (canceled) {
        return null; // Usuário cancelou
    } else {
        return filePaths[0]; // Retorna o caminho do primeiro arquivo selecionado
    }
});

// HINT: Adicionar mais IPC listeners para outras operações de sistema de arquivos se necessário
// Ex: ipcMain.handle('list-directory', async (event, dirPath) => { /* fs.readdir logic */ });