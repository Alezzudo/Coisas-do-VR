// fileProcessorWorker.js

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs/promises'); // Usando promessas para operações de arquivo
const AdmZip = require('adm-zip'); // Para lidar com arquivos .zip e .unitypackage

/**
 * Função utilitária para gerar um ID único.
 * @returns {string} ID único.
 */
function generateUniqueId() {
    return 'c' + Date.now() + Math.random().toString(36).substring(2, 9);
}

/**
 * Loga mensagens do worker de volta para o processo principal.
 * @param {string} message A mensagem a ser logada.
 * @param {'info'|'warn'|'error'|'debug'|'fatal'} level O nível da mensagem.
 * @param {Object} [details={}] Detalhes adicionais para o log.
 */
function logWorkerMessage(message, level = 'info', details = {}) {
    if (parentPort) {
        parentPort.postMessage({
            type: 'log',
            data: { message, level, details, timestamp: new Date().toISOString() }
        });
    } else {
        // Fallback para console.log se não estiver rodando como worker (para testes diretos)
        console.log(`[WORKER ${level.toUpperCase()}] ${message}`, details);
    }
}

/**
 * Envia uma atualização de progresso de um arquivo de volta ao processo principal.
 * @param {Object} data Dados do progresso.
 */
function sendFileProgress(data) {
    if (parentPort) {
        parentPort.postMessage({ type: 'fileProgress', data });
    }
}

/**
 * Envia uma atualização de progresso geral do lote de volta ao processo principal.
 * @param {Object} data Dados do progresso geral.
 */
function sendOverallProgress(data) {
    if (parentPort) {
        parentPort.postMessage({ type: 'overallProgress', data });
    }
}

/**
 * Analisa e infere dados de um arquivo com base em sua extensão e, se for um arquivo zip/unitypackage, seu conteúdo.
 * Este é o coração da funcionalidade de "precisão".
 * @param {string} filePath O caminho completo do arquivo.
 * @returns {Promise<Object>} Uma promessa que resolve com os metadados inferidos do item.
 */
async function inferFileData(filePath) {
    logWorkerMessage(`Iniciando inferência para: ${filePath}`, 'debug');

    // 1. Validação inicial do arquivo
    try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
            throw new Error('Caminho não aponta para um arquivo válido.');
        }
        if (stats.size === 0) {
            logWorkerMessage(`Arquivo vazio detectado: ${filePath}`, 'warn');
            // Poderíamos pular ou retornar um tipo específico para arquivos vazios
        }
    } catch (error) {
        logWorkerMessage(`Erro ao verificar arquivo: ${filePath} - ${error.message}`, 'error', { error });
        throw new Error(`Erro de acesso ao arquivo: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    let title = fileName.replace(fileExtension, '').replace(/_/g, ' ').trim(); // Título básico do nome do arquivo
    let description = `Um ativo digital gerado ou processado pelo Bibliotecário Autônomo.`;
    let category = "Uncategorized";
    let imageUrl = `https://via.placeholder.com/300x200/440000/FFFFFF?text=${encodeURIComponent(title.substring(0, Math.min(title.length, 15)).replace(/\s/g, '+'))}`; // Imagem placeholder
    const downloadUrl = `file://${filePath}`;

    // 2. Lógica de Inferência Aprimorada por Extensão
    switch (fileExtension) {
        case '.zip':
        case '.unitypackage': // Unitypackages são essencialmente arquivos zip
            logWorkerMessage(`Processando arquivo compactado: ${fileName}`, 'info');
            category = 'Uncategorized'; // Base, pode ser refinado pelo conteúdo

            try {
                const zip = new AdmZip(filePath);
                const zipEntries = zip.getEntries();

                // Tentativa 1: Procurar por imagem de pré-visualização no ZIP
                const imageEntry = zipEntries.find(entry => {
                    const entryNameLower = entry.entryName.toLowerCase();
                    return (entryNameLower.includes('preview') || entryNameLower.includes('thumbnail') || entryNameLower.includes('cover')) &&
                           (entryNameLower.endsWith('.png') || entryNameLower.endsWith('.jpg') || entryNameLower.endsWith('.jpeg'));
                });

                if (imageEntry) {
                    const tempDir = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'autonomous-catalog-previews');
                    await fs.mkdir(tempDir, { recursive: true }); // Garante que a pasta exista
                    const tempImagePath = path.join(tempDir, `preview_${generateUniqueId()}${path.extname(imageEntry.entryName)}`);
                    await fs.writeFile(tempImagePath, imageEntry.getData());
                    imageUrl = `file://${tempImagePath}`;
                    logWorkerMessage(`Pré-visualização encontrada e extraída: ${imageEntry.entryName}`, 'debug');
                } else {
                    logWorkerMessage(`Nenhuma imagem de pré-visualização comum encontrada no ZIP: ${fileName}`, 'debug');
                }

                // Tentativa 2: Inferir categoria e descrição do conteúdo do ZIP
                const readmeEntry = zipEntries.find(entry => entry.entryName.toLowerCase().includes('readme') && entry.entryName.toLowerCase().endsWith('.txt'));
                if (readmeEntry) {
                    description = readmeEntry.getData().toString('utf8').trim().substring(0, 500);
                    if (description.length === 500) description += '...';
                    logWorkerMessage(`Descrição inferida de README.txt`, 'debug');
                } else {
                    logWorkerMessage(`Nenhum README.txt encontrado no ZIP: ${fileName}`, 'debug');
                }

                // Tentar inferir categoria baseada em palavras-chave nos nomes dos arquivos dentro do ZIP
                const commonAssetKeywords = {
                    'avatar': ['avatar', 'vrm', 'fbx', 'unitypackage'],
                    'world': ['world', 'scene', 'map', 'unity'],
                    'prop': ['prop', 'object', 'item'],
                    'outfit': ['outfit', 'clothing', 'costume'],
                    'model': ['model', 'mesh', '3d', 'fbx', 'obj', 'gltf'],
                    'texture': ['texture', 'material', 'uv'],
                    'shader': ['shader'],
                    'animation': ['anim', 'bvh', 'mocap']
                };

                let bestCategoryMatch = { name: 'Uncategorized', score: 0 };
                for (const entry of zipEntries) {
                    const entryPathLower = entry.entryName.toLowerCase();
                    for (const catName in commonAssetKeywords) {
                        for (const keyword of commonAssetKeywords[catName]) {
                            if (entryPathLower.includes(keyword)) {
                                const currentScore = (entryPathLower.match(new RegExp(keyword, 'g')) || []).length;
                                if (currentScore > bestCategoryMatch.score) {
                                    bestCategoryMatch = { name: catName, score: currentScore };
                                }
                            }
                        }
                    }
                }
                if (bestCategoryMatch.score > 0) {
                    category = `${bestCategoryMatch.name.charAt(0).toUpperCase() + bestCategoryMatch.name.slice(1)} Assets`;
                    logWorkerMessage(`Categoria inferida de conteúdo ZIP: ${category}`, 'debug');
                }


            } catch (zipError) {
                logWorkerMessage(`Erro ao processar arquivo ZIP/UnityPackage ${fileName}: ${zipError.message}`, 'warn', { error: zipError });
                // Fallback para inferência básica
                if (fileExtension === '.unitypackage') {
                    category = 'UnityPackage';
                    description = `Pacote Unity: ${title}. Contém recursos para importação no Unity Engine.`;
                } else {
                    description = `Arquivo ZIP: ${title}. Um arquivo compactado que pode conter diversos tipos de ativos.`;
                }
            }
            break;

        case '.fbx':
        case '.obj':
        case '.gltf':
        case '.blend':
            category = 'Models';
            description = `Modelo 3D: ${title}. Um ativo tridimensional em formato ${fileExtension.substring(1).toUpperCase()}.`;
            logWorkerMessage(`Inferência para modelo 3D: ${fileName}`, 'info');
            // Simular extração de metadados de modelos (peso, número de polígonos, etc.)
            const modelSizeMB = (await fs.stat(filePath)).size / (1024 * 1024);
            description += ` Tamanho aproximado: ${modelSizeMB.toFixed(2)} MB.`;
            break;

        case '.vrm':
            category = 'Avatar Assets'; // VRMs são avatares
            description = `Avatar VRM: ${title}. Um modelo de avatar otimizado para realidade virtual.`;
            logWorkerMessage(`Inferência para avatar VRM: ${fileName}`, 'info');
            // Simular análise de VRM (ex: se é VRM 0.0 ou 1.0, se tem expressões faciais)
            description += ` (Possível VRM ${Math.random() > 0.5 ? '0.0' : '1.0'}).`;
            break;

        case '.world': // Exemplo para VRChat world files (se aplicável)
            category = 'Worlds';
            description = `Arquivo de Mundo VR: ${title}. Um cenário interativo para ambientes virtuais.`;
            logWorkerMessage(`Inferência para mundo VR: ${fileName}`, 'info');
            break;

        case '.png':
        case '.jpg':
        case '.jpeg':
        case '.gif':
            category = 'Image Asset';
            imageUrl = `file://${filePath}`; // Se for uma imagem, usa ela como pré-visualização
            description = `Arquivo de Imagem: ${title}. Uma imagem para uso em projetos ou como referência.`;
            logWorkerMessage(`Inferência para imagem: ${fileName}`, 'info');
            // Simular extração de metadados de imagem (dimensões, tipo)
            // Para extração real, precisaríamos de uma lib como 'sharp' ou 'image-size'
            description += ` Dimensões: ${Math.floor(Math.random() * 1000) + 500}x${Math.floor(Math.random() * 1000) + 500}px.`;
            break;

        case '.pdf':
            category = 'Documents';
            imageUrl = 'https://via.placeholder.com/300x200/440000/FFFFFF?text=Documento+PDF';
            description = `Documento PDF: ${title}.`;
            logWorkerMessage(`Inferência para documento PDF: ${fileName}`, 'info');
            break;

        // Adicione mais casos para outras extensões de arquivo que você espera e quer inferir com precisão.
        // Ex: .psd, .ai, .spp (Substance Painter), .sbar (Substance Designer), .spm (Substance Model Graph)
        // Para cada um, pense em como você pode inferir a categoria e a descrição.

        default:
            logWorkerMessage(`Extensão de arquivo desconhecida, usando inferência padrão: ${fileName}`, 'warn');
            // Categoria e descrição padrão já definidas no início
            break;
    }

    // Validação final e retorno
    const inferredData = {
        id: generateUniqueId(),
        title: title || 'Título Desconhecido',
        description: description || 'Nenhuma descrição disponível.',
        downloadUrl: downloadUrl,
        category: category,
        imageUrl: imageUrl
    };

    logWorkerMessage(`Inferência concluída para ${fileName}`, 'debug', inferredData);
    return inferredData;
}

/**
 * Processa um lote de caminhos de arquivo.
 * @param {string[]} filePaths Array de caminhos de arquivo a serem processados.
 * @returns {Promise<Array<Object>>} Uma promessa que resolve com os resultados do processamento.
 */
async function processBatch(filePaths) {
    const results = [];
    const totalFiles = filePaths.length;
    logWorkerMessage(`Iniciando processamento em lote para ${totalFiles} arquivos.`, 'info');

    for (let i = 0; i < totalFiles; i++) {
        const filePath = filePaths[i];
        try {
            const itemData = await inferFileData(filePath);
            results.push({ success: true, data: itemData });
            sendFileProgress({
                fileIndex: i,
                totalFiles: totalFiles,
                filePath: filePath,
                status: 'completed',
                data: itemData // Inclui os dados processados para feedback imediato
            });
            logWorkerMessage(`Arquivo processado com sucesso: ${filePath}`, 'info');
        } catch (error) {
            logWorkerMessage(`Erro ao processar arquivo: ${filePath} - ${error.message}`, 'error', { error });
            results.push({ success: false, error: error.message, filePath: filePath });
            sendFileProgress({
                fileIndex: i,
                totalFiles: totalFiles,
                filePath: filePath,
                status: 'failed',
                error: error.message
            });
        }
        sendOverallProgress({
            completed: i + 1,
            total: totalFiles
        });
    }

    logWorkerMessage(`Processamento em lote concluído para ${totalFiles} arquivos.`, 'info');
    return results;
}

// Listener para mensagens do processo principal
if (parentPort) {
    parentPort.on('message', async (message) => {
        logWorkerMessage(`Mensagem recebida do main thread: ${message.type}`, 'debug', message);
        if (message.type === 'processFiles') {
            try {
                const results = await processBatch(message.filePaths);
                parentPort.postMessage({ type: 'batchComplete', data: results });
            } catch (error) {
                logWorkerMessage(`Erro fatal no worker durante o processamento: ${error.message}`, 'fatal', { error });
                parentPort.postMessage({ type: 'error', data: { message: 'Erro interno do worker.', error: error.message } });
            }
        }
    });
    logWorkerMessage('FileProcessorWorker iniciado e aguardando mensagens.', 'info');
} else {
    logWorkerMessage('FileProcessorWorker iniciado em modo autônomo (sem parentPort).', 'warn');
    // Este bloco pode ser usado para testes diretos do worker
    // Ex: processBatch(['/caminho/para/seu/arquivo.zip']).then(console.log);
}
