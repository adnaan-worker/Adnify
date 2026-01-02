/**
 * Agent 服务
 * 核心的 Agent 循环逻辑，处理 LLM 通信和工具执行
 */

import { logger } from '@utils/Logger'
import { performanceMonitor } from '@shared/utils/PerformanceMonitor'
import { AppError, formatErrorMessage } from '@/shared/errors'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { WorkMode } from '@/renderer/modes/types'
import { toolRegistry, toolManager, initializeToolProviders, setToolLoadingContext } from '../tools'
import { OpenAIMessage } from '../llm/MessageConverter'
import {
  ContextItem,
  MessageContent,
  TextContent,
} from '../types'
import { LLMStreamChunk, LLMToolCall } from '@/renderer/types/electron'
import { getReadOnlyTools } from '@/shared/config/tools'

// 导入拆分的模块
import {
  getAgentConfig,
  READ_TOOLS,
  RETRYABLE_ERROR_CODES,
} from '../utils/AgentConfig'
import { LoopDetector } from '../utils/LoopDetector'
import {
  createStreamHandlerState,
  StreamHandlerState,
  handleTextChunk,
  handleReasoningChunk,
  closeReasoningIfNeeded,
  handleToolCallStart,
  handleToolCallDelta,
  handleToolCallEnd,
  handleFullToolCall,
  handleLLMToolCall,
  handleLLMDone,
  detectStreamingXMLToolCalls,
} from '../llm/LLMStreamHandler'
import {
  buildContextContent,
  calculateContextStats,
} from '../llm/ContextBuilder'

// 导入新的服务模块
import { toolExecutionService } from './ToolExecutionService'
import { buildLLMMessages, compressContext } from '../llm/MessageBuilder'
import { executeToolCallsIntelligently } from './ParallelToolExecutor'
import { composerService } from './composerService'

export interface LLMCallConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  timeout?: number
  maxTokens?: number
  temperature?: number
  topP?: number
  adapterConfig?: import('@/shared/config/providers').LLMAdapterConfig
  advanced?: import('@/shared/config/providers').AdvancedConfig
}

// ===== Agent 服务类 =====

class AgentServiceClass {
  private abortController: AbortController | null = null
  private currentAssistantId: string | null = null
  private isRunning = false
  private unsubscribers: (() => void)[] = []
  private streamState: StreamHandlerState = createStreamHandlerState()
  private throttleState = { lastUpdate: 0, lastArgsLen: 0 }

  // 文件读取缓存（简化版：只记录哈希，不做复杂的 TTL 管理）
  private fileReadCache = new Map<string, string>() // path -> contentHash

  /**
   * 检查文件缓存是否有效
   */
  hasValidFileCache(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
    return this.fileReadCache.has(normalizedPath)
  }

  /**
   * 标记文件已读取
   */
  markFileAsRead(filePath: string, content: string): void {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
    this.fileReadCache.set(normalizedPath, this.fnvHash(content))
  }

  /**
   * 获取文件的缓存内容哈希
   */
  getFileCacheHash(filePath: string): string | null {
    const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
    return this.fileReadCache.get(normalizedPath) || null
  }

  /**
   * 清除会话缓存
   */
  clearSession(): void {
    this.fileReadCache.clear()
    logger.agent.info('[Agent] Session cleared')
  }

  /**
   * FNV-1a 哈希算法 - 比简单位运算哈希碰撞率更低
   * 使用 64 位分两部分计算，避免 JS 整数精度问题
   */
  private fnvHash(str: string): string {
    // FNV-1a 32-bit
    let h1 = 0x811c9dc5
    let h2 = 0x811c9dc5
    const len = str.length
    const mid = len >> 1

    // 分两部分计算，增加熵
    for (let i = 0; i < mid; i++) {
      h1 ^= str.charCodeAt(i)
      h1 = Math.imul(h1, 0x01000193)
    }
    for (let i = mid; i < len; i++) {
      h2 ^= str.charCodeAt(i)
      h2 = Math.imul(h2, 0x01000193)
    }

    // 组合两个哈希值
    return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36))
  }

  async calculateContextStats(contextItems: ContextItem[], currentInput: string): Promise<void> {
    return calculateContextStats(contextItems, currentInput)
  }

  // ===== 公共方法 =====

  async sendMessage(
    userMessage: MessageContent,
    config: LLMCallConfig,
    workspacePath: string | null,
    systemPrompt: string,
    chatMode: WorkMode = 'agent'
  ): Promise<void> {
    if (this.isRunning) {
      logger.agent.warn('[Agent] Already running, ignoring new request')
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
      const contextItems = store.getCurrentThread()?.contextItems || []
      const userQuery = typeof userMessage === 'string' ? userMessage :
        (Array.isArray(userMessage) ? userMessage.filter(p => p.type === 'text').map(p => (p as TextContent).text).join('') : '')

      const contextContent = await buildContextContent(contextItems, userQuery)
      const userMessageId = store.addUserMessage(userMessage, contextItems)
      store.clearContextItems()

      const messageText = typeof userMessage === 'string'
        ? userMessage.slice(0, 50)
        : 'User message'
      await store.createMessageCheckpoint(userMessageId, messageText)

      const llmMessages = await buildLLMMessages(userMessage, contextContent, systemPrompt)
      this.currentAssistantId = store.addAssistantMessage()
      store.setStreamPhase('streaming')

      // 启动 Composer Session 用于多文件变更追踪
      composerService.startSession(
        userQuery.slice(0, 50) || 'Agent Task',
        `Started at ${new Date().toLocaleTimeString()}`
      )

      await this.runAgentLoop(config, llmMessages, workspacePath, chatMode)
    } catch (error) {
      const appError = AppError.fromError(error)
      logger.agent.error('[Agent] Error:', appError.toJSON())
      this.showError(formatErrorMessage(appError))
    } finally {
      this.cleanup()
    }
  }

  // 委托给 ToolExecutionService 处理审批
  approve(): void {
    toolExecutionService.approve()
  }

  reject(): void {
    toolExecutionService.reject()
  }



  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    window.electronAPI.abortMessage()

    // 通知 ToolExecutionService 拒绝当前等待的审批
    toolExecutionService.reject()

    const store = useAgentStore.getState()
    
    // 确保当前助手消息的工具调用状态被更新
    if (this.currentAssistantId) {
      const thread = store.getCurrentThread()
      if (thread) {
        const assistantMsg = thread.messages.find(
          m => m.id === this.currentAssistantId && m.role === 'assistant'
        )
        if (assistantMsg && assistantMsg.role === 'assistant') {
          for (const tc of (assistantMsg as any).toolCalls || []) {
            if (['running', 'awaiting', 'pending'].includes(tc.status)) {
              store.updateToolCall(this.currentAssistantId, tc.id, {
                status: 'error',
                error: 'Aborted by user',
              })
            }
          }
        }
      }
      
      // 确保消息的 isStreaming 被设置为 false
      store.finalizeAssistant(this.currentAssistantId)
    }
    
    // 额外检查：确保所有正在流式输出的消息都被终止
    const thread = store.getCurrentThread()
    if (thread) {
      for (const msg of thread.messages) {
        if (msg.role === 'assistant' && (msg as any).isStreaming) {
          store.finalizeAssistant(msg.id)
        }
      }
    }

    this.cleanup()
  }

  // ===== 私有方法：核心逻辑 =====

  private async runAgentLoop(
    config: LLMCallConfig,
    llmMessages: OpenAIMessage[],
    workspacePath: string | null,
    chatMode: WorkMode
  ): Promise<void> {
    const store = useAgentStore.getState()
    let loopCount = 0
    let shouldContinue = true

    // 增强的循环检测器
    const loopDetector = new LoopDetector()

    const agentLoopConfig = getAgentConfig()

    while (shouldContinue && loopCount < agentLoopConfig.maxToolLoops && !this.abortController?.signal.aborted) {
      loopCount++
      shouldContinue = false

      logger.agent.info(`[Agent] Loop iteration ${loopCount}`)

      // 使用 MessageBuilder 的 compressContext
      await compressContext(llmMessages, agentLoopConfig.contextCompressThreshold)

      const result = await this.callLLMWithRetry(config, llmMessages, chatMode)

      if (this.abortController?.signal.aborted) break

      if (result.error) {
        store.appendToAssistant(this.currentAssistantId!, `\n\n❌ Error: ${result.error}`)
        break
      }

      // 注意：消息内容的更新已在 handleLLMDone 中处理（包括 XML 工具调用清理）
      // 这里不再重复更新，避免内容不一致

      if (!result.toolCalls || result.toolCalls.length === 0) {
        // 只有在 plan 模式下才提醒更新 plan
        if (chatMode === 'plan' && store.plan) {
          const readOnlyTools = getReadOnlyTools()
          const hasWriteOps = llmMessages.some(m => m.role === 'assistant' && m.tool_calls?.some((tc: any) => !readOnlyTools.includes(tc.function.name)))
          const hasUpdatePlan = llmMessages.some(m => m.role === 'assistant' && m.tool_calls?.some((tc: any) => tc.function.name === 'update_plan'))

          if (hasWriteOps && !hasUpdatePlan && loopCount < agentLoopConfig.maxToolLoops) {
            logger.agent.info('[Agent] Plan mode detected: Reminding AI to update plan status')
            llmMessages.push({
              role: 'user' as const,
              content: 'Reminder: You have performed some actions. Please use `update_plan` to update the plan status (e.g., mark the current step as completed) before finishing your response.',
            })
            shouldContinue = true
            continue
          }
        }

        logger.agent.info('[Agent] No tool calls, task complete')
        break
      }

      // 使用增强的循环检测
      const loopResult = loopDetector.checkLoop(result.toolCalls)
      if (loopResult.isLoop) {
        logger.agent.warn(`[Agent] Loop detected: ${loopResult.reason}`)
        const suggestion = loopResult.suggestion ? `\n💡 ${loopResult.suggestion}` : ''
        store.appendToAssistant(this.currentAssistantId!, `\n\n⚠️ ${loopResult.reason}${suggestion}`)
        break
      }

      if (this.currentAssistantId) {
        const currentMsg = store.getMessages().find(m => m.id === this.currentAssistantId)
        if (currentMsg && currentMsg.role === 'assistant') {
          const existingToolCalls = (currentMsg as any).toolCalls || []

          for (const tc of result.toolCalls) {
            const existing = existingToolCalls.find((e: any) => e.id === tc.id)
            if (!existing) {
              store.addToolCallPart(this.currentAssistantId, {
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              })
            } else if (!existing.status) {
              store.updateToolCall(this.currentAssistantId, tc.id, { status: 'pending' })
            }
          }
        }
      }

      llmMessages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      })

      let userRejected = false

      logger.agent.info(`[Agent] Executing ${result.toolCalls.length} tool calls intelligently`)

      // 使用智能并行执行器
      const { results: toolResults, userRejected: rejected } = await executeToolCallsIntelligently(
        result.toolCalls,
        {
          workspacePath,
          currentAssistantId: this.currentAssistantId,
        },
        this.abortController?.signal
      )

      userRejected = rejected

      // 将工具结果添加到消息历史
      for (const { toolCall, result: toolResult } of toolResults) {
        llmMessages.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: toolResult.content,
        })

        // 更新 LoopDetector 的内容哈希（用于检测文件内容是否真正变化）
        const meta = toolResult.meta
        if (meta?.filePath && typeof meta.filePath === 'string' && typeof meta.newContent === 'string') {
          loopDetector.updateContentHash(meta.filePath, meta.newContent)
        }
      }

      // 收集写操作用于自动检查
      const writeToolCalls = result.toolCalls.filter(tc => !READ_TOOLS.includes(tc.name))

      const { agentConfig } = useStore.getState()
      if (agentConfig.enableAutoFix && !userRejected && writeToolCalls.length > 0 && workspacePath) {
        const observation = await this.observeChanges(workspacePath, writeToolCalls)
        if (observation.hasErrors && observation.errors.length > 0) {
          const observeMessage = `[Observation] 检测到以下代码问题，请修复：\n\n${observation.errors.slice(0, 3).join('\n\n')}`
          llmMessages.push({
            role: 'user' as const,
            content: observeMessage,
          })
          store.appendToAssistant(this.currentAssistantId!, `\n\n🔍 **Auto-check**: Detected ${observation.errors.length} issue(s). Attempting to fix...`)
        }
      }

      // 检查是否显示安全警告
      const { securitySettings } = useStore.getState()
      if (securitySettings.showSecurityWarnings !== false) {
        const recentMessages = store.getMessages()
        const hasWhitelistError = recentMessages.some(msg =>
          msg.role === 'tool' && (msg.content.includes('whitelist') || msg.content.includes('白名单'))
        )
        if (hasWhitelistError) {
          store.appendToAssistant(this.currentAssistantId!, '\n\n💡 **Tip**: You can add commands to the whitelist in Settings > Security > Shell Command Whitelist.')
        }
      }

      if (userRejected) break

      shouldContinue = true
      store.setStreamPhase('streaming')
    }

    if (loopCount >= agentLoopConfig.maxToolLoops) {
      store.appendToAssistant(this.currentAssistantId!, '\n\n⚠️ Reached maximum tool call limit.')
    }
  }

  private async callLLMWithRetry(
    config: LLMCallConfig,
    messages: OpenAIMessage[],
    chatMode: WorkMode
  ): Promise<{ content?: string; toolCalls?: LLMToolCall[]; error?: string }> {
    let lastError: string | undefined
    const retryConfig = getAgentConfig()
    let delay = retryConfig.retryDelayMs

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      if (this.abortController?.signal.aborted) return { error: 'Aborted' }

      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= retryConfig.retryBackoffMultiplier
      }

      const result = await this.callLLM(config, messages, chatMode)
      if (!result.error) return result

      const canRetry = RETRYABLE_ERROR_CODES.has(result.error) ||
        result.error.includes('timeout') ||
        result.error.includes('rate limit') ||
        result.error.includes('network')

      if (!canRetry || attempt === retryConfig.maxRetries) return result
      lastError = result.error
    }

    return { error: lastError || 'Max retries exceeded' }
  }

  private async callLLM(
    config: LLMCallConfig,
    messages: OpenAIMessage[],
    chatMode: WorkMode
  ): Promise<{ content?: string; toolCalls?: LLMToolCall[]; reasoning?: string; reasoningStartTime?: number; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; error?: string }> {
    // 开始性能监控
    performanceMonitor.start(`llm:${config.model}`, 'llm', {
      provider: config.provider,
      messageCount: messages.length,
    })

    return new Promise((resolve) => {
      // 重置流式状态
      this.streamState = createStreamHandlerState()
      this.throttleState = { lastUpdate: 0, lastArgsLen: 0 }

      const cleanupListeners = () => {
        this.unsubscribers.forEach(unsub => unsub())
        this.unsubscribers = []
      }

      // 监听流式文本
      this.unsubscribers.push(
        window.electronAPI.onLLMStream((chunk: LLMStreamChunk) => {
          // 如果正在推理但收到非推理内容，关闭推理标签
          if (this.streamState.isReasoning && chunk.type !== 'reasoning') {
            closeReasoningIfNeeded(this.streamState, this.currentAssistantId)
          }

          // 处理各类流式事件
          handleTextChunk(chunk, this.streamState, this.currentAssistantId)
          
          if (chunk.type === 'text' && this.currentAssistantId) {
            detectStreamingXMLToolCalls(this.streamState, this.currentAssistantId)
          }

          handleReasoningChunk(chunk, this.streamState, this.currentAssistantId)
          handleToolCallStart(chunk, this.streamState, this.currentAssistantId)
          handleToolCallDelta(chunk, this.streamState, this.currentAssistantId, this.throttleState)
          handleToolCallEnd(chunk, this.streamState, this.currentAssistantId)
          handleFullToolCall(chunk, this.streamState, this.currentAssistantId)
        })
      )

      // 监听非流式工具调用
      this.unsubscribers.push(
        window.electronAPI.onLLMToolCall((toolCall: LLMToolCall) => {
          handleLLMToolCall(toolCall, this.streamState, this.currentAssistantId)
        })
      )

      // 监听完成
      this.unsubscribers.push(
        window.electronAPI.onLLMDone((result) => {
          // 结束性能监控
          performanceMonitor.end(`llm:${config.model}`, true)

          cleanupListeners()
          const finalResult = handleLLMDone(result, this.streamState, this.currentAssistantId)
          // 更新 store 中的 usage 信息
          if (this.currentAssistantId && finalResult.usage) {
            useAgentStore.getState().updateMessage(this.currentAssistantId, {
              usage: finalResult.usage,
            } as any)
          }
          resolve(finalResult)
        })
      )

      // 监听错误
      this.unsubscribers.push(
        window.electronAPI.onLLMError((error) => {
          // 结束性能监控（失败）
          performanceMonitor.end(`llm:${config.model}`, false, { error: error.message })

          closeReasoningIfNeeded(this.streamState, this.currentAssistantId)
          cleanupListeners()
          resolve({ error: error.message })
        })
      )

      // 发送请求
      // 初始化工具提供者并获取所有工具定义
      initializeToolProviders()
      
      // 设置工具加载上下文（根据模式和角色加载不同工具）
      const templateId = useStore.getState().promptTemplateId
      setToolLoadingContext({
        mode: chatMode === 'plan' ? 'plan' : chatMode === 'chat' ? 'chat' : 'code',
        templateId,
      })
      
      const allTools = chatMode === 'chat' ? [] : toolManager.getAllToolDefinitions()
      
      window.electronAPI.sendMessage({
        config,
        messages: messages as any,
        tools: allTools,
        systemPrompt: '',
      }).catch((err) => {
        cleanupListeners()
        resolve({ error: err.message || 'Failed to send message' })
      })
    })
  }


  private showError(message: string): void {
    const store = useAgentStore.getState()
    const id = store.addAssistantMessage()
    store.appendToAssistant(id, `❌ ${message}`)
    store.finalizeAssistant(id)
  }

  private cleanup(): void {
    this.unsubscribers.forEach(unsub => unsub())
    this.unsubscribers = []

    const store = useAgentStore.getState()
    if (this.currentAssistantId) store.finalizeAssistant(this.currentAssistantId)
    store.setStreamPhase('idle')
    this.currentAssistantId = null
    this.abortController = null
    this.isRunning = false
    this.streamState = createStreamHandlerState()
    
    // 完成 Composer Session（但不自动关闭，让用户决定是否接受变更）
    const composerState = composerService.getState()
    if (composerState.currentSession) {
      // 检查是否有待处理的变更
      const hasPending = composerState.currentSession.changes.some(c => c.status === 'pending')
      if (!hasPending) {
        // 如果没有待处理的变更，完成 session
        composerService.completeSession()
      }
      // 如果有待处理的变更，保持 session 打开，让用户在 UI 中处理
    }
  }

  private async observeChanges(
    workspacePath: string,
    writeToolCalls: LLMToolCall[]
  ): Promise<{ hasErrors: boolean; errors: string[] }> {
    const errors: string[] = []
    const editedFiles = writeToolCalls
      .filter(tc => ['edit_file', 'write_file', 'create_file_or_folder'].includes(tc.name))
      .map(tc => {
        const filePath = tc.arguments.path as string
        return filePath.startsWith(workspacePath) ? filePath : `${workspacePath}/${filePath}`.replace(/\/+/g, '/')
      })
      .filter(path => !path.endsWith('/'))

    for (const filePath of editedFiles) {
      try {
        const lintResult = await toolRegistry.execute('get_lint_errors', { path: filePath }, { workspacePath })
        if (lintResult.success && lintResult.result) {
          const result = lintResult.result.trim()
          if (result && result !== '[]' && result !== 'No diagnostics found') {
            const hasActualError = /\[error\]/i.test(result) ||
              result.toLowerCase().includes('failed to compile') ||
              result.toLowerCase().includes('syntax error')

            if (hasActualError) {
              errors.push(`File: ${filePath}\n${result}`)
            }
          }
        }
      } catch (e) { }
    }
    return { hasErrors: errors.length > 0, errors }
  }
}

export const AgentService = new AgentServiceClass()
