/**
 * Agent 核心类
 * 
 * 唯一的公共入口，协调所有子模块
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
import type { MessageContent, TextContent } from '../types'
import type { LLMConfig } from './types'

// 文件缓存
const fileCache = new CacheService<string>('AgentFileCache', {
  maxSize: 200,
  maxMemory: 30 * 1024 * 1024,
  defaultTTL: 10 * 60 * 1000,
})

class AgentClass {
  private abortController: AbortController | null = null
  private currentAssistantId: string | null = null
  private isRunning = false

  // ===== 公共 API =====

  /**
   * 发送消息并运行 Agent
   */
  async send(
    userMessage: MessageContent,
    config: LLMConfig,
    workspacePath: string | null,
    systemPrompt: string,
    chatMode: WorkMode = 'agent'
  ): Promise<void> {
    if (this.isRunning) {
      logger.agent.warn('[Agent] Already running')
      return
    }

    const store = useAgentStore.getState()

    if (!config.apiKey) {
      this.showError('Please configure your API key in settings.')
      return
    }

    this.isRunning = true
    this.abortController = new AbortController()

    try {
      // 准备上下文
      const contextItems = store.getCurrentThread()?.contextItems || []
      const userQuery = this.extractUserQuery(userMessage)
      const contextContent = await buildContextContent(contextItems, userQuery)

      // 添加用户消息
      const userMessageId = store.addUserMessage(userMessage, contextItems)
      store.clearContextItems()

      // 创建检查点
      const messageText = typeof userMessage === 'string' ? userMessage.slice(0, 50) : 'User message'
      await store.createMessageCheckpoint(userMessageId, messageText)

      // 构建 LLM 消息
      const llmMessages = await buildLLMMessages(userMessage, contextContent, systemPrompt)

      // 创建助手消息
      this.currentAssistantId = store.addAssistantMessage()
      store.setStreamPhase('streaming')

      // 运行主循环
      await runLoop(
        config,
        llmMessages,
        {
          workspacePath,
          chatMode,
          abortSignal: this.abortController.signal,
        },
        this.currentAssistantId
      )
    } catch (error) {
      const appError = AppError.fromError(error)
      logger.agent.error('[Agent] Error:', appError.toJSON())
      this.showError(formatErrorMessage(appError))
    } finally {
      this.cleanup()
    }
  }

  /**
   * 中止运行
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    api.llm.abort()
    approvalService.reject()

    const store = useAgentStore.getState()

    // 更新所有运行中的工具状态
    if (this.currentAssistantId) {
      const thread = store.getCurrentThread()
      if (thread) {
        const msg = thread.messages.find(m => m.id === this.currentAssistantId)
        if (msg?.role === 'assistant') {
          const assistantMsg = msg as import('../types').AssistantMessage
          for (const tc of assistantMsg.toolCalls || []) {
            if (['running', 'awaiting', 'pending'].includes(tc.status)) {
              store.updateToolCall(this.currentAssistantId, tc.id, {
                status: 'error',
                error: 'Aborted by user',
              })
            }
          }
        }
      }
      store.finalizeAssistant(this.currentAssistantId)
    }

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

    this.cleanup()
  }

  /**
   * 批准工具执行
   */
  approve(): void {
    approvalService.approve()
  }

  /**
   * 拒绝工具执行
   */
  reject(): void {
    approvalService.reject()
  }

  /**
   * 清除会话缓存
   */
  clearSession(): void {
    fileCache.clear()
    EventBus.clear()
    logger.agent.info('[Agent] Session cleared')
  }

  /**
   * 检查是否正在运行
   */
  get running(): boolean {
    return this.isRunning
  }

  /**
   * 获取 EventBus（用于外部订阅）
   */
  get events() {
    return EventBus
  }

  // ===== 文件缓存 API =====

  hasValidFileCache(filePath: string): boolean {
    return fileCache.has(normalizePath(filePath))
  }

  markFileAsRead(filePath: string, content: string): void {
    fileCache.set(normalizePath(filePath), this.fnvHash(content))
  }

  getFileCacheHash(filePath: string): string | null {
    return fileCache.get(normalizePath(filePath)) ?? null
  }

  getCacheStats() {
    return fileCache.getStats()
  }

  // ===== 私有方法 =====

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

  private showError(message: string): void {
    const store = useAgentStore.getState()
    const id = store.addAssistantMessage()
    store.appendToAssistant(id, `❌ ${message}`)
    store.finalizeAssistant(id)
  }

  private cleanup(): void {
    const store = useAgentStore.getState()
    if (this.currentAssistantId) {
      store.finalizeAssistant(this.currentAssistantId)
    }
    store.setStreamPhase('idle')
    this.currentAssistantId = null
    this.abortController = null
    this.isRunning = false
  }

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

export const Agent = new AgentClass()
