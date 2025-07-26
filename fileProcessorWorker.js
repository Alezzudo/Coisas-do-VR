// fileProcessorWorker.js - Executa em uma thread separada para processamento pesado (Com Tratamento de Erros)
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs'); // Para operações de arquivo, se houver

// Função de processamento de conteúdo (AGORA DENTRO DO WORKER)
async function processFileContent(filePath, fileIndex, totalFiles) {
    try {
        // Envia uma mensagem de progresso "iniciado"
        parentPort.postMessage({
            type: 'progress',
            fileIndex,
            totalFiles,
            filePath,
            status: 'processing'
        });

        const fileName = path.basename(filePath);
        const fileExtension = path.extname(filePath).toLowerCase();

        // SIMULAÇÃO de processamento INTENSO (em um cenário real, aqui você usaria:
        // - bibliotecas de descompactação (ex: 'adm-zip', 'decompress')
        // - bibliotecas de análise de metadados de arquivos (ex: 'exiftool.js', 'image-size')
        // - lógica para interagir com APIs externas (Google, Booth, VRmodels)
        const processingTime = 500 + Math.random() * 1500; // 0.5 a 2 segundos por arquivo
        await new Promise(resolve => setTimeout(resolve, processingTime));

        let inferredTitle = fileName.split('.').slice(0, -1).join('.');
        let inferredDescription = `Item processado localmente: ${fileName}. Tipo: ${fileExtension}.`;
        let inferredImageUrl = 'https://via.placeholder.com/300x200/cc0000/ffffff?text=Item+Local';
        let inferredCategory = 'Uncategorized';
        let downloadUrl = `file://${filePath}`;

        // Lógica de inferência
        if (fileName.toLowerCase().includes('model') || ['.gltf', '.glb', '.fbx', '.obj', '.blend'].includes(fileExtension)) {
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
            inferredCategory = 'Image Asset';
            inferredDescription = `Imagem: ${inferredTitle}.`;
            inferredImageUrl = downloadUrl; // Para imagens, a própria imagem pode ser a capa
        }

        // Reporta o progresso de volta para o main thread
        parentPort.postMessage({
            type: 'progress',
            fileIndex,
            totalFiles,
            filePath,
            status: 'completed',
            data: {
                title: inferredTitle,
                description: inferredDescription,
                imageUrl: inferredImageUrl,
                downloadUrl: downloadUrl,
                category: inferredCategory
            }
        });

        return {
            success: true,
            data: {
                title: inferredTitle,
                description: inferredDescription,
                imageUrl: inferredImageUrl,
                downloadUrl: downloadUrl,
                category: inferredCategory
            }
        };

    } catch (error) {
        console.error(`[Worker] Erro ao processar arquivo ${filePath}:`, error);
        // Reporta erro de volta para o main thread
        parentPort.postMessage({
            type: 'progress',
            fileIndex,
            totalFiles,
            filePath,
            status: 'failed',
            error: error.message
        });
        return { success: false, error: error.message };
    }
}

// O worker recebe dados do thread principal via workerData
// E envia a resposta de volta ao thread principal via parentPort.postMessage
(async () => {
    const { filePath, fileIndex, totalFiles } = workerData;
    const result = await processFileContent(filePath, fileIndex, totalFiles);
    // Envia o resultado final (success/failure) de volta para o main thread
    parentPort.postMessage({ type: 'result', fileIndex, result });
})();
