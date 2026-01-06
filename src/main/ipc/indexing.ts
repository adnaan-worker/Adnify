/**
 * 代码库索引 IPC handlers
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, BrowserWindow } from 'electron'
import { getIndexService, EmbeddingConfig, initIndexServiceWithConfig } from '../indexing'
import { ok, failFromError, Result } from '@shared/types/result'
import Store from 'electron-store'

// mainStore 引用
let _mainStore: Store | null = null

/**
 * 从 mainStore 获取保存的 embedding 配置
 */
function getSavedEmbeddingConfig(): Partial<EmbeddingConfig> | undefined {
  if (!_mainStore) return undefined
  const saved = _mainStore.get('embeddingConfig') as Partial<EmbeddingConfig> | undefined
  if (saved) {
    logger.index.info('[Indexing] Loaded saved embedding config:', { provider: saved.provider })
  }
  return saved
}

export function registerIndexingHandlers(getMainWindow: () => BrowserWindow | null, mainStore?: Store) {
  _mainStore = mainStore || null

  // 初始化索引服务
  ipcMain.handle('index:initialize', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      // 使用保存的配置初始化
      const savedConfig = getSavedEmbeddingConfig()
      const indexService = savedConfig 
        ? initIndexServiceWithConfig(workspacePath, { embedding: savedConfig as EmbeddingConfig })
        : getIndexService(workspacePath)
      
      const mainWindow = getMainWindow()
      if (mainWindow) {
        indexService.setMainWindow(mainWindow)
      }
      await indexService.initialize()
      return ok(undefined)
    } catch (e) {
      logger.ipc.error('[Index] Initialize failed:', e)
      return failFromError(e)
    }
  })

  // 开始全量索引
  ipcMain.handle('index:start', async (_, workspacePath: string): Promise<Result<void>> => {
    try {
      // 使用保存的配置
      const savedConfig = getSavedEmbeddingConfig()
      const indexService = savedConfig 
        ? initIndexServiceWithConfig(workspacePath, { embedding: savedConfig as EmbeddingConfig })
        : getIndexService(workspacePath)
      
      const mainWindow = getMainWindow()
      if (mainWindow) {
        indexService.setMainWindow(mainWindow)
      }
      await indexService.initialize()

      // 异步执行索引
      indexService.indexWorkspace().catch(e => {
        logger.ipc.error('[Index] Indexing failed:', e)
      })

      return ok(undefined)
    } catch (e) {
      logger.ipc.error('[Index] Start failed:', e)
      return failFromError(e)
    }
  })

  // 获取索引状态
  ipcMain.handle('index:status', async (_, workspacePath: string) => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.initialize()
      return indexService.getStatus()
    } catch {
      return { isIndexing: false, totalFiles: 0, indexedFiles: 0, totalChunks: 0 }
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

  // 语义搜索
  ipcMain.handle('index:search', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.initialize()
      return await indexService.search(query, topK || 10)
    } catch (e) {
      logger.ipc.error('[Index] Search failed:', e)
      return []
    }
  })

  // 混合搜索（向量 + 关键词）
  ipcMain.handle('index:hybridSearch', async (_, workspacePath: string, query: string, topK?: number) => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.initialize()
      return await indexService.hybridSearch(query, topK || 10)
    } catch (e) {
      logger.ipc.error('[Index] Hybrid search failed:', e)
      return []
    }
  })

  // 更新单个文件的索引
  ipcMain.handle('index:updateFile', async (_, workspacePath: string, filePath: string): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      await indexService.updateFile(filePath)
      return ok(undefined)
    } catch (e) {
      return failFromError(e)
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

  // 更新 Embedding 配置
  ipcMain.handle('index:updateEmbeddingConfig', async (
    _,
    workspacePath: string,
    config: Partial<EmbeddingConfig>
  ): Promise<Result<void>> => {
    try {
      const indexService = getIndexService(workspacePath)
      indexService.updateEmbeddingConfig(config)
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

  // 获取支持的 Embedding 提供商列表
  ipcMain.handle('index:getProviders', () => {
    return [
      { id: 'jina', name: 'Jina AI', description: '免费 100万 tokens/月，专为代码优化', free: true },
      { id: 'voyage', name: 'Voyage AI', description: '免费 5000万 tokens，代码专用模型', free: true },
      { id: 'cohere', name: 'Cohere', description: '免费 100次/分钟', free: true },
      { id: 'huggingface', name: 'HuggingFace', description: '免费，有速率限制', free: true },
      { id: 'ollama', name: 'Ollama', description: '本地运行，完全免费', free: true },
      { id: 'openai', name: 'OpenAI', description: '付费，质量最高', free: false },
    ]
  })
}
