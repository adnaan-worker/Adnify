/**
 * LLM IPC handlers - 重构版
 * 
 * 支持功能：
 * - 流式对话
 * - 同步生成（后台任务）
 * - 结构化输出（代码分析、重构、修复、测试生成）
 * - Embeddings（向量嵌入、语义搜索）
 * - 多窗口隔离
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, BrowserWindow } from 'electron'
import { LLMService, LLMError } from '../services/llm'
import type { TokenUsage as LLMTokenUsage } from '../services/llm/types'

// 按窗口 webContents.id 管理独立的 LLM 服务
const llmServices = new Map<number, LLMService>()
const compactionServices = new Map<number, LLMService>()

/**
 * 转换 TokenUsage 格式
 * LLM 服务使用 inputTokens/outputTokens
 * 前端 Agent 使用 promptTokens/completionTokens
 */
function convertTokenUsage(usage: LLMTokenUsage | undefined): {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
} | undefined {
  if (!usage) return undefined
  
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
  }
}

/**
 * 获取或创建 LLM 服务实例
 */
function getOrCreateService(webContentsId: number, window: BrowserWindow): LLMService {
  if (!llmServices.has(webContentsId)) {
    logger.ipc.info('[LLMService] Creating new service for window:', webContentsId)
    llmServices.set(webContentsId, new LLMService(window))
  }
  return llmServices.get(webContentsId)!
}

/**
 * 获取或创建压缩服务实例
 */
function getOrCreateCompactionService(webContentsId: number, window: BrowserWindow): LLMService {
  if (!compactionServices.has(webContentsId)) {
    logger.ipc.info('[LLMService] Creating compaction service for window:', webContentsId)
    compactionServices.set(webContentsId, new LLMService(window))
  }
  return compactionServices.get(webContentsId)!
}

/**
 * 统一错误处理 - 记录日志并抛出 LLMError
 */
function logAndThrowError(error: unknown, operation: string): never {
  const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
  
  logger.ipc.error(`[LLMService] ${operation} failed:`, {
    code: llmError.code,
    message: llmError.message,
    retryable: llmError.retryable,
  })
  
  throw llmError
}

export function registerLLMHandlers(_getMainWindow: () => BrowserWindow | null) {
  // ============================================
  // 流式对话
  // ============================================

  ipcMain.handle('llm:sendMessage', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found for LLM request')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      await service.sendMessage(params)
      // 流式响应通过事件发送，不需要返回值
    } catch (error) {
      // 流式错误已通过 llm:error 事件发送到前端
      // 这里只记录日志，不抛出，避免 IPC 包装错误消息
      const llmError = error instanceof LLMError ? error : LLMError.fromError(error)
      logger.ipc.error('[LLMService] Send message failed:', {
        code: llmError.code,
        message: llmError.message,
        retryable: llmError.retryable,
      })
    }
  })

  ipcMain.on('llm:abort', (event) => {
    llmServices.get(event.sender.id)?.abort()
  })

  // ============================================
  // 同步生成
  // ============================================

  ipcMain.handle('llm:compactContext', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found for compaction request')

    const service = getOrCreateCompactionService(event.sender.id, window)
    
    try {
      const response = await service.sendMessageSync(params)
      return {
        content: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      if (error instanceof LLMError) {
        return { error: error.message, code: error.code }
      }
      return { error: (error as Error).message }
    }
  })

  // ============================================
  // 结构化输出 - 代码分析
  // ============================================

  ipcMain.handle('llm:analyzeCode', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.analyzeCode(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Code analysis')
    }
  })

  ipcMain.handle('llm:analyzeCodeStream', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.analyzeCodeStream(params, (partial) => {
        if (!window.isDestroyed()) {
          window.webContents.send('llm:analyzeCodePartial', partial)
        }
      })
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Code analysis stream')
    }
  })

  // ============================================
  // 结构化输出 - 代码重构
  // ============================================

  ipcMain.handle('llm:suggestRefactoring', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.suggestRefactoring(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Refactoring suggestion')
    }
  })

  // ============================================
  // 结构化输出 - 错误修复
  // ============================================

  ipcMain.handle('llm:suggestFixes', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.suggestFixes(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Fix suggestion')
    }
  })

  // ============================================
  // 结构化输出 - 测试生成
  // ============================================

  ipcMain.handle('llm:generateTests', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.generateTests(params)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
        metadata: response.metadata,
      }
    } catch (error) {
      logAndThrowError(error, 'Test generation')
    }
  })

  // ============================================
  // Embeddings
  // ============================================

  ipcMain.handle('llm:embedText', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.embedText(params.text, params.config)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
      }
    } catch (error) {
      logAndThrowError(error, 'Text embedding')
    }
  })

  ipcMain.handle('llm:embedMany', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const response = await service.embedMany(params.texts, params.config)
      return {
        data: response.data,
        usage: convertTokenUsage(response.usage),
      }
    } catch (error) {
      logAndThrowError(error, 'Batch embedding')
    }
  })

  ipcMain.handle('llm:findSimilar', async (event, params) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) throw new Error('Window not found')

    const service = getOrCreateService(event.sender.id, window)
    
    try {
      const result = await service.findSimilar(
        params.query,
        params.candidates,
        params.config,
        params.topK
      )
      return result
    } catch (error) {
      logAndThrowError(error, 'Similarity search')
    }
  })
}

/**
 * 清理指定窗口的 LLM 服务（窗口关闭时调用）
 */
export function cleanupLLMService(webContentsId: number) {
  const service = llmServices.get(webContentsId)
  if (service) {
    logger.ipc.info('[LLMService] Cleaning up service for window:', webContentsId)
    service.destroy()
    llmServices.delete(webContentsId)
  }

  const compactionService = compactionServices.get(webContentsId)
  if (compactionService) {
    compactionService.destroy()
    compactionServices.delete(webContentsId)
  }
}
