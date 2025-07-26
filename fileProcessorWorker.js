// fileProcessorWorker.js

const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs/promises');
const yauzl = require('yauzl');

/** Gera um ID único */
function generateUniqueId() {
    return 'c' + Date.now() + Math.random().toString(36).substring(2, 9);
}

/** Loga mensagens */
function logWorkerMessage(message, level = 'info', details = {}) {
    if (parentPort) {
        parentPort.postMessage({
            type: 'log',
            data: { message, level, details, timestamp: new Date().toISOString() }
        });
    } else {
        console.log(`[WORKER ${level.toUpperCase()}] ${message}`, details);
    }
}

function sendFileProgress(data) {
    if (parentPort) {
        parentPort.postMessage({ type: 'fileProgress', data });
    }
}

function sendOverallProgress(data) {
    if (parentPort) {
        parentPort.postMessage({ type: 'overallProgress', data });
    }
}

async function inferFileData(filePath) {
    logWorkerMessage(`Iniciando inferência para: ${filePath}`, 'debug');

    try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) throw new Error('Caminho não é um arquivo válido.');
        if (stats.size === 0) {
            logWorkerMessage(`Arquivo vazio: ${filePath}`, 'warn');
        }
    } catch (error) {
        logWorkerMessage(`Erro no acesso ao arquivo: ${filePath}`, 'error', { error });
        throw new Error(`Erro ao acessar: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const fileExtension = path.extname(filePath).toLowerCase();
    const title = fileName.replace(fileExtension, '').replace(/_/g, ' ').trim();
    const downloadUrl = `file://${filePath}`;
    let description = 'Um ativo digital gerado ou processado pelo Bibliotecário Autônomo.';
    let category = 'Uncategorized';
    let imageUrl = `https://via.placeholder.com/300x200/440000/FFFFFF?text=${encodeURIComponent(title.substring(0, 15).replace(/\s/g, '+'))}`;

    switch (fileExtension) {
        case '.zip':
        case '.unitypackage':
            logWorkerMessage(`Processando ZIP/Unitypackage: ${fileName}`, 'info');

            try {
                const zipEntries = await readZipEntries(filePath);

                if (!zipEntries.length) {
                    category = 'Empty Archive'; // FIX: identifica zip vazio
                    logWorkerMessage(`Arquivo compactado vazio: ${fileName}`, 'warn');
                    break;
                }

                const imageEntry = zipEntries.find(entry => {
                    const name = entry.entryName.toLowerCase();
                    return (name.includes('preview') || name.includes('thumbnail') || name.includes('cover')) &&
                        (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg'));
                });

                if (imageEntry) {
                    const tempDir = path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'autonomous-catalog-previews');
                    await fs.mkdir(tempDir, { recursive: true });
                    const tempImagePath = path.join(tempDir, `preview_${generateUniqueId()}${path.extname(imageEntry.entryName)}`);
                    await fs.writeFile(tempImagePath, imageEntry.getData());
                    imageUrl = `file://${tempImagePath}`;
                    logWorkerMessage(`Imagem extraída: ${imageEntry.entryName}`, 'debug');
                }

                const readmeEntry = zipEntries.find(entry => entry.entryName.toLowerCase().includes('readme') && entry.entryName.endsWith('.txt'));
                if (readmeEntry) {
                    try {
                        description = readmeEntry.getData().toString('utf8').trim().substring(0, 500);
                        if (description.length === 500) description += '...';
                        logWorkerMessage(`Descrição lida do README`, 'debug');
                    } catch (readErr) {
                        logWorkerMessage(`Erro ao ler README: ${readErr.message}`, 'warn');
                    }
                }

                // Categorias inferidas com base nos arquivos no ZIP
                const keywords = {
                    avatar: ['avatar', 'vrm', 'fbx'],
                    world: ['world', 'scene', 'map'],
                    prop: ['prop', 'object', 'item'],
                    outfit: ['outfit', 'clothing', 'costume'],
                    model: ['model', 'mesh', '3d', 'fbx', 'obj', 'gltf'],
                    texture: ['texture', 'material'],
                    shader: ['shader'],
                    animation: ['anim', 'bvh', 'mocap']
                };

                let bestMatch = { name: 'Uncategorized', score: 0 };
                for (const entry of zipEntries) {
                    const lower = entry.entryName.toLowerCase();
                    for (const [cat, words] of Object.entries(keywords)) {
                        for (const word of words) {
                            const matches = lower.match(new RegExp(word, 'g')) || [];
                            const score = matches.length;
                            if (score > bestMatch.score) {
                                bestMatch = { name: cat, score };
                            }
                        }
                    }
                }

                if (bestMatch.score > 0) {
                    category = `${bestMatch.name.charAt(0).toUpperCase()}${bestMatch.name.slice(1)} Assets`;
                    logWorkerMessage(`Categoria inferida: ${category}`, 'debug');
                }
            } catch (zipError) {
                logWorkerMessage(`Erro ao ler ZIP: ${zipError.message}`, 'warn');
                category = fileExtension === '.unitypackage' ? 'UnityPackage' : 'Compressed';
                description = fileExtension === '.unitypackage'
                    ? `Pacote Unity: ${title}. Contém ativos para importação no Unity.`
                    : `Arquivo ZIP: ${title}. Pode conter diversos ativos.`;
            }
            break;

        default:
            logWorkerMessage(`Extensão desconhecida: ${fileName}`, 'warn');
            break;
    }

    const result = {
        id: generateUniqueId(),
        title: title || 'Título Desconhecido',
        description: description || 'Nenhuma descrição disponível.',
        downloadUrl,
        category,
        imageUrl
    };

    logWorkerMessage(`Inferência concluída: ${fileName}`, 'debug', result);
    return result;
}

async function readZipEntries(filePath) {
    return new Promise((resolve, reject) => {
        const entries = [];
        yauzl.open(filePath, { lazyEntries: true }, (err, zipFile) => {
            if (err) {
                reject(err);
                return;
            }

            zipFile.on('entry', entry => {
                entries.push(entry);
                zipFile.readEntry();
            });

            zipFile.on('end', () => {
                resolve(entries);
            });

            zipFile.on('error', reject);

            zipFile.readEntry();
        });
    });
}

async function processBatch(filePaths) {
    const results = [];
    const total = filePaths.length;
    logWorkerMessage(`Iniciando processamento em lote (${total} arquivos)`, 'info');

    for (let i = 0; i < total; i++) {
        const filePath = filePaths[i];
        try {
            const data = await inferFileData(filePath);
            results.push({ success: true, data });
            sendFileProgress({ fileIndex: i, totalFiles: total, filePath, status: 'completed', data });
        } catch (err) {
            logWorkerMessage(`Erro ao processar: ${filePath} - ${err.message}`, 'error');
            results.push({ success: false, error: err.message, filePath });
            sendFileProgress({ fileIndex: i, totalFiles: total, filePath, status: 'failed', error: err.message });
        }
        sendOverallProgress({ completed: i + 1, total });
    }

    logWorkerMessage(`Processamento concluído. (${total} arquivos)`, 'info');
    return results;
}

if (parentPort) {
    parentPort.on('message', async (msg) => {
        logWorkerMessage(`Mensagem recebida: ${msg.type}`, 'debug', msg);
        if (msg.type === 'processFiles') {
            try {
                const data = await processBatch(msg.filePaths);
                parentPort.postMessage({ type: 'batchComplete', data });
            } catch (err) {
                logWorkerMessage(`Erro fatal: ${err.message}`, 'fatal', { err });
                parentPort.postMessage({ type: 'error', data: { message: 'Erro interno.', error: err.message } });
            }
        }
    });

    logWorkerMessage('Worker iniciado e aguardando mensagens.', 'info');
} else {
    logWorkerMessage('Worker
