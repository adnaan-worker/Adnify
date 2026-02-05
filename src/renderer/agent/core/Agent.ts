/**
 * Agent 核心类
 * 
 * 职责：
 * - 提供统一的公共 API
 * - 管理 Agent 生命周期（运行状态、中止、清理）
 * - 协调所有子模块（MessageBuilder, runLoop, EventBus）
 * - 处理错误和异常情况
 * 
 * 使用示例：
 * ```typescript
 * await Agent.send(
 *   "你好",
 *   config,
 *   workspacePath,
 *   systemPrompt,
 *   'agent'
 * )
 * ```
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { CacheService } from '@shared/utils'
import { AppError, formatErrorMessage } from '@/shared/errors'
import { normalizePath } from '@shared/utils/pathUtils'
import { useAgentStore } from '../store/AgentStore'
import { buildLLMMessages, buildContextContent } from '../llm/MessageBuilder'
import { runLoop } from './loop'
import { approvalService } from './tools'
import { EventBus } from './EventBus'
import type { WorkMode } from '@/renderer/modes/types'
import type { MessageContent, TextContent, ImageContent } from '../types'
import type { CheckpointImage } from '../types'
import type { LLMConfig } from './types'

// 文件缓存：避免重复读取相同文件
const fileCache = new CacheService<string>('AgentFileCache', {
  maxSize: 200,
  maxMemory: 30 * 1024 * 1024,
  defaultTTL: 10 * 60 * 1000,
})

class AgentClass {
  /** 运行中的任务（按线程追踪） */
  private runningTasks: Map<string, {
    abortController: AbortController
    assistantId: string
  }> = new Map()

  // ===== 公共 API =====

  /**
   * 发送消息并运行 Agent
   * 
   * @param userMessage - 用户消息（文本或多模态内容）
   * @param config - LLM 配置
   * @param workspacePath - 工作区路径
   * @param systemPrompt - 系统提示词
   * @param chatMode - 工作模式（chat/agent/plan）
   */
  async send(
    userMessage: MessageContent,
    config: LLMConfig,
    workspacePath: string | null,
    systemPrompt: string,
    chatMode: WorkMode = 'agent'
  ): Promise<void> {
    const store = useAgentStore.getState()

    // 第一次对话时可能还没有 threadId，需要在 addUserMessage 后获取
    let threadId = store.currentThreadId

    // 防止同一线程重复运行
    if (threadId && this.runningTasks.has(threadId)) {
      logger.agent.warn('[Agent] Thread already running, ignoring new request')
      return
    }

    // 验证 API Key
    if (!config.apiKey) {
      this.showError('Please configure your API key in settings.')
      return
    }

    const abortController = new AbortController()

    try {
      // 1. 准备上下文
      const contextItems = store.getCurrentThread()?.contextItems || []
      const userQuery = this.extractUserQuery(userMessage)
      const contextContent = await buildContextContent(contextItems, userQuery)

      // 2. 添加用户消息（这可能会创建新线程）
      const userMessageId = store.addUserMessage(userMessage, contextItems)
      store.clearContextItems()

      // 重新获取 threadId（addUserMessage 可能创建了新线程）
      threadId = useAgentStore.getState().currentThreadId
      if (!threadId) {
        logger.agent.error('[Agent] No thread ID after addUserMessage')
        return
      }

      // 3. 记录任务（现在 threadId 一定存在）
      this.runningTasks.set(threadId, { abortController, assistantId: '' })

      // 4. 创建检查点（用于撤销）
      const checkpointImages = this.extractCheckpointImages(userMessage)
      const messageText = typeof userMessage === 'string' ? userMessage.slice(0, 50) : 'User message'
      await store.createMessageCheckpoint(userMessageId, messageText, checkpointImages, contextItems)

      // 5. 构建 LLM 消息（包含上下文压缩）
      const llmMessages = await buildLLMMessages(userMessage, contextContent, systemPrompt)

      // 6. 创建助手消息并开始流式响应
      const assistantId = store.addAssistantMessage(undefined, threadId)
      const task = this.runningTasks.get(threadId)
      if (task) task.assistantId = assistantId
      store.setStreamPhase('streaming', threadId)

      // 7. 运行主循环（传递 threadId 实现后台隔离）
      await runLoop(
        config,
        llmMessages,
        {
          workspacePath,
          chatMode,
          abortSignal: abortController.signal,
          threadId,
        },
        assistantId
      )
    } catch (error) {
      // 统一错误处理
      const appError = AppError.fromError(error)
      logger.agent.error('[Agent] Error:', appError.toJSON())
      this.showError(formatErrorMessage(appError))
    } finally {
      // 确保清理资源（threadId 现在一定存在）
      this.cleanupTask(threadId)
    }
  }

  /**
   * 中止当前运行的 Agent
   * 
   * 会：
   * - 中止 LLM 请求
   * - 拒绝待审批的工具
   * - 更新所有运行中的工具状态为 error
   * - 清理资源
   */
  abort(): void {
    const store = useAgentStore.getState()
    const currentThreadId = store.currentThreadId

    // 中止当前线程的任务
    if (currentThreadId && this.runningTasks.has(currentThreadId)) {
      const task = this.runningTasks.get(currentThreadId)!
      task.abortController.abort()

      // 更新所有运行中的工具状态
      if (task.assistantId) {
        const thread = store.getCurrentThread()
        if (thread) {
          const msg = thread.messages.find(m => m.id === task.assistantId)
          if (msg?.role === 'assistant') {
            const assistantMsg = msg as import('../types').AssistantMessage
            for (const tc of assistantMsg.toolCalls || []) {
              if (['running', 'awaiting', 'pending'].includes(tc.status)) {
                store.updateToolCall(task.assistantId, tc.id, {
                  status: 'error',
                  error: 'Aborted by user',
                })
              }
            }
          }
        }
        store.finalizeAssistant(task.assistantId)
      }

      this.runningTasks.delete(currentThreadId)
    }

    api.llm.abort()
    approvalService.reject()

    // 确保所有流式消息都被终止
    const thread = store.getCurrentThread()
    if (thread) {
      for (const msg of thread.messages) {
        if (msg.role === 'assistant') {
          const assistantMsg = msg as import('../types').AssistantMessage
          if (assistantMsg.isStreaming) {
            store.finalizeAssistant(msg.id)
          }
        }
      }
    }

    store.setStreamPhase('idle')
  }

  /**
   * 批准当前待审批的工具
   */
  approve(): void {
    approvalService.approve()
  }

  /**
   * 拒绝当前待审批的工具
   */
  reject(): void {
    approvalService.reject()
  }

  /**
   * 清除会话缓存
   * 
   * 用于：
   * - 切换工作区时清除缓存
   * - 手动刷新时清除缓存
   */
  clearSession(): void {
    fileCache.clear()
    EventBus.clear()
    logger.agent.info('[Agent] Session cleared')
  }

  /**
   * 获取诊断信息（用于调试）
   */
  getDiagnostics() {
    const { getActiveListenerCount } = require('./stream')
    return {
      runningTaskCount: this.runningTasks.size,
      runningThreadIds: Array.from(this.runningTasks.keys()),
      activeListeners: getActiveListenerCount(),
      cacheStats: fileCache.getStats(),
    }
  }

  /**
   * 检查是否有任务正在运行
   */
  get running(): boolean {
    return this.runningTasks.size > 0
  }

  /**
   * 检查指定线程是否正在运行
   */
  isThreadRunning(threadId: string): boolean {
    return this.runningTasks.has(threadId)
  }

  /**
   * 获取 EventBus（用于外部订阅）
   */
  get events() {
    return EventBus
  }

  // ===== 文件缓存 API =====

  /**
   * 检查文件是否有有效缓存
   */
  hasValidFileCache(filePath: string): boolean {
    return fileCache.has(normalizePath(filePath))
  }

  /**
   * 标记文件已读取（用于缓存）
   */
  markFileAsRead(filePath: string, content: string): void {
    fileCache.set(normalizePath(filePath), this.fnvHash(content))
  }

  /**
   * 获取文件缓存哈希
   */
  getFileCacheHash(filePath: string): string | null {
    return fileCache.get(normalizePath(filePath)) ?? null
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    return fileCache.getStats()
  }

  // ===== 私有方法 =====

  /**
   * 从消息中提取文本查询
   */
  private extractUserQuery(message: MessageContent): string {
    if (typeof message === 'string') return message
    if (Array.isArray(message)) {
      return message
        .filter(p => p.type === 'text')
        .map(p => (p as TextContent).text)
        .join('')
    }
    return ''
  }

  /**
   * 从消息中提取图片（用于检查点）
   */
  private extractCheckpointImages(message: MessageContent): CheckpointImage[] {
    if (typeof message === 'string') return []
    if (Array.isArray(message)) {
      return message
        .filter((p): p is ImageContent => p.type === 'image')
        .map(p => ({
          id: crypto.randomUUID(),
          mimeType: (p.source.media_type || 'image/png') as string,
          base64: p.source.data,
        }))
    }
    return []
  }

  /**
   * 显示错误消息给用户
   */
  private showError(message: string): void {
    const store = useAgentStore.getState()
    const id = store.addAssistantMessage()
    store.appendToAssistant(id, `❌ ${message}`)
    store.finalizeAssistant(id)
  }

  /**
   * 清理资源
   * 
   * 在以下情况调用：
   * - 正常完成（finally 块）
   * - 用户中止（abort 方法）
   * - 发生错误（finally 块）
   */
  /**
   * 清理指定线程的任务资源（唯一的"完成"处理点）
   * 
   * 职责：
   * - 完成助手消息（设置 isStreaming: false）
   * - 重置流状态（设置 phase: 'idle'）
   * - 清理任务记录
   */
  private cleanupTask(threadId: string | null): void {
    const store = useAgentStore.getState()

    if (threadId && this.runningTasks.has(threadId)) {
      const task = this.runningTasks.get(threadId)!
      if (task.assistantId) {
        store.finalizeAssistant(task.assistantId, threadId)
      }
      this.runningTasks.delete(threadId)
    }

    // 重置该线程的流状态
    if (threadId) {
      store.setStreamPhase('idle', threadId)
    }
  }

  /**
   * FNV-1a 哈希算法（用于文件内容哈希）
   */
  private fnvHash(str: string): string {
    let h1 = 0x811c9dc5
    let h2 = 0x811c9dc5
    const len = str.length
    const mid = len >> 1

    for (let i = 0; i < mid; i++) {
      h1 ^= str.charCodeAt(i)
      h1 = Math.imul(h1, 0x01000193)
    }

    for (let i = mid; i < len; i++) {
      h2 ^= str.charCodeAt(i)
      h2 = Math.imul(h2, 0x01000193)
    }

    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
  }
}

// 导出单例
export const Agent = new AgentClass()
