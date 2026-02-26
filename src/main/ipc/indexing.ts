/**
 * 代码库索引 IPC handlers
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, BrowserWindow } from 'electron'
import { getIndexService, initIndexServiceWithConfig, EmbeddingConfig, IndexMode, IndexConfig } from '../indexing'
import { ok, failFromError, Result } from '@shared/types/result'
import Store from 'electron-store'

let _configStore: Store | null = null

function getSavedConfig(): Partial<IndexConfig> | undefined {
  if (!_configStore) return undefined
  return _configStore.get('indexConfig') as Partial<IndexConfig> | undefined
}

function saveConfig(updates: Partial<IndexConfig>): void {
  if (!_configStore) return
  const current = getSavedConfig() || {}
  _configStore.set('indexConfig', { ...current, ...updates })
}

export function registerIndexingHandlers(getMainWindow: () => BrowserWindow | null, configStore?: Store) {
  _configStore = configStore || null

  // 初始化
  ipcMain.handle('index:initialize', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)

      const mainWindow = getMainWindow()
      if (mainWindow) indexService.setMainWindow(mainWindow)
      await indexService.initialize()
      return ok(undefined)
    } catch (e) {
      logger.ipc.error('[Index] Initialize failed:', e)
      return failFromError(e)
    }
  })

  // 开始索引
  ipcMain.handle('index:start', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)

      const mainWindow = getMainWindow()
      if (mainWindow) indexService.setMainWindow(mainWindow)
      await indexService.initialize()
      indexService.indexWorkspace().catch(e => logger.ipc.error('[Index] Indexing failed:', e))
      return ok(undefined)
    } catch (e) {
      logger.ipc.error('[Index] Start failed:', e)
      return failFromError(e)
    }
  })

  // 获取状态
  ipcMain.handle('index:status', async (_, workspacePath: string) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getStatus()
    } catch {
      return { mode: 'structural', isIndexing: false, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
    }
  })

  // 检查是否有索引
  ipcMain.handle('index:hasIndex', async (_, workspacePath: string) => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.hasIndex()
    } catch {
      return false
    }
  })

  // 搜索
  ipcMain.handle('index:search', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return await indexService.search(query, topK || 10)
    } catch (e) {
      logger.ipc.error('[Index] Search failed:', e)
      return []
    }
  })

  // 混合搜索
  ipcMain.handle('index:hybridSearch', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return await indexService.hybridSearch(query, topK || 10)
    } catch (e) {
      logger.ipc.error('[Index] Hybrid search failed:', e)
      return []
    }
  })

  // 符号搜索
  ipcMain.handle('index:searchSymbols', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const indexService = getIndexService(workspacePath)
      return indexService.searchSymbols(query, topK || 20)
    } catch (e) {
      logger.ipc.error('[Index] Symbol search failed:', e)
      return []
    }
  })

  // 获取项目摘要
  ipcMain.handle('index:getProjectSummary', async (_, workspacePath: string) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getProjectSummary()
    } catch {
      return null
    }
  })

  // 获取项目摘要文本
  ipcMain.handle('index:getProjectSummaryText', async (_, workspacePath: string) => {
    try {
      const saved = getSavedConfig()
      const indexService = saved
        ? initIndexServiceWithConfig(workspacePath, saved)
        : getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getProjectSummaryText()
    } catch {
      return ''
    }
  })

  // 清空索引
  ipcMain.handle('index:clear', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.clearIndex()
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 切换索引模式
  ipcMain.handle('index:setMode', async (_, workspacePath: string, mode: IndexMode): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.setMode(mode)
      saveConfig({ mode })
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 更新 Embedding 配置
  ipcMain.handle('index:updateEmbeddingConfig', async (_, workspacePath: string, config: Partial<EmbeddingConfig>): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      indexService.updateEmbeddingConfig(config)
      const saved = getSavedConfig() || {}
      saveConfig({ embedding: { ...saved.embedding, ...config } as EmbeddingConfig })
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 测试 Embedding 连接
  ipcMain.handle('index:testConnection', async (_, workspacePath: string) => {
    try {
      const indexService = getIndexService(workspacePath)
      return await indexService.testEmbeddingConnection()
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 获取支持的 Embedding 提供商
  ipcMain.handle('index:getProviders', () => {
    return [
      { id: 'jina', name: 'Jina AI', description: '免费 100万 tokens/月', free: true },
      { id: 'voyage', name: 'Voyage AI', description: '免费 5000万 tokens', free: true },
      { id: 'cohere', name: 'Cohere', description: '免费 100次/分钟', free: true },
      { id: 'huggingface', name: 'HuggingFace', description: '免费，有速率限制', free: true },
      { id: 'ollama', name: 'Ollama', description: '本地运行，完全免费', free: true },
      { id: 'openai', name: 'OpenAI', description: '付费，质量最高', free: false },
    ]
  })

  // 更新单个文件索引（用于文件监听）
  ipcMain.handle('index:updateFile', async (_, workspacePath: string, filePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.updateFiles([filePath])
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 批量更新文件索引（用于文件监听）
  ipcMain.handle('index:updateFiles', async (_, workspacePath: string, filePaths: string[]): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.updateFiles(filePaths)
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })

  // 删除文件索引（用于文件监听）
  ipcMain.handle('index:deleteFile', async (_, workspacePath: string, filePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.deleteFileIndex(filePath)
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
    }
  })
}
