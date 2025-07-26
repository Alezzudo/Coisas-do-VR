// preload.js

const { contextBridge, ipcRenderer } = require('electron');

// Expõe APIs para o processo de renderização (index.html) de forma segura.
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Abre um diálogo de seleção de arquivo(s).
     * @returns {Promise<string[]>} Uma promessa que resolve com um array de caminhos de arquivo selecionados, ou um array vazio se cancelado.
     */
    openFileDialog: async () => {
        try {
            return await ipcRenderer.invoke('open-file-dialog');
        } catch (error) {
            console.error('Erro ao invocar open-file-dialog:', error);
            // Poderíamos emitir um evento para o renderer ou rejeitar a promessa para ser capturado no frontend
            throw new Error('Não foi possível abrir o diálogo de arquivos.');
        }
    },

    /**
     * Inicia o processamento em lote de arquivos.
     * @param {string[]} filePaths - Um array de caminhos de arquivo a serem processados.
     * @returns {Promise<any>} Uma promessa que resolve quando o pedido de processamento é recebido pelo main process.
     */
    processFilesBatch: async (filePaths) => {
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            console.warn('processFilesBatch chamado sem caminhos de arquivo válidos.');
            return Promise.resolve({ success: false, message: 'Nenhum arquivo para processar.' });
        }
        try {
            return await ipcRenderer.invoke('process-files-batch', filePaths);
        } catch (error) {
            console.error('Erro ao invocar process-files-batch:', error);
            throw new Error('Falha ao iniciar o processamento em lote.');
        }
    },

    /**
     * Assina um evento para receber atualizações de progresso de arquivos individuais.
     * @param {function(Object): void} callback - A função a ser chamada com os dados de progresso.
     */
    onProcessingFileProgress: (callback) => {
        ipcRenderer.on('processing-file-progress', (event, ...args) => callback(...args));
    },

    /**
     * Assina um evento para receber atualizações de progresso geral do lote.
     * @param {function(Object): void} callback - A função a ser chamada com os dados de progresso.
     */
    onProcessingOverallProgress: (callback) => {
        ipcRenderer.on('processing-overall-progress', (event, ...args) => callback(...args));
    },

    /**
     * Assina um evento para ser notificado quando o processamento em lote estiver completo.
     * @param {function(Object[]): void} callback - A função a ser chamada com os resultados de todos os arquivos processados.
     */
    onProcessingBatchComplete: (callback) => {
        ipcRenderer.on('processing-batch-complete', (event, ...args) => callback(...args));
    },

    /**
     * Abre o arquivo no seu aplicativo padrão ou revela-o no explorador de arquivos.
     * @param {string} filePath - O caminho completo do arquivo a ser aberto/revelado.
     * @returns {Promise<boolean>} Uma promessa que resolve para true se a operação foi bem-sucedida, false caso contrário.
     */
    openFileOrFolder: async (filePath) => {
        if (!filePath || typeof filePath !== 'string') {
            console.warn('openFileOrFolder chamado sem caminho de arquivo válido.');
            return false;
        }
        try {
            // Usa 'start' ou 'open' dependendo do sistema para tentar abrir o arquivo
            // ou revela-o na pasta, o que é mais seguro para arquivos que não são executáveis.
            return await ipcRenderer.invoke('open-file-or-folder', filePath);
        } catch (error) {
            console.error('Erro ao invocar open-file-or-folder:', error);
            throw new Error('Não foi possível abrir o arquivo ou pasta.');
        }
    },

    /**
     * Exemplo de API para logs (útil para depuração ou mensagens de usuário).
     * Você pode expandir isso para enviar logs para o main process para serem salvos em arquivo, etc.
     * @param {string} message - A mensagem de log.
     * @param {'info'|'warn'|'error'} level - O nível do log.
     */
    log: (message, level = 'info') => {
        ipcRenderer.send('log-message', { message, level });
    }
});
