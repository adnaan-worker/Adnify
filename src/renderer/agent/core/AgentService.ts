/**
 * Agent 服务
 * 核心的 Agent 循环逻辑，处理 LLM 通信和工具执行
 * 
 * 架构设计（参考 Cursor/Void）：
 * 1. 内部使用 ChatMessage 格式存储消息
 * 2. 发送给 LLM 前，使用 MessageConverter 转换为 OpenAI API 格式
 * 3. 工具调用必须在 assistant 消息中声明，tool 结果必须紧跟其后
 * 4. 上下文文件内容在发送前异步读取并嵌入用户消息
 * 5. 流式响应实时更新 UI
 */

import { useAgentStore } from './AgentStore'
import { executeTool, getToolDefinitions, getToolApprovalType, WRITE_TOOLS } from './ToolExecutor'
import { buildOpenAIMessages, validateOpenAIMessages, OpenAIMessage } from './MessageConverter'
import { MessageContent, ToolStatus, ContextItem } from './types'
import { LLMStreamChunk, LLMToolCall } from '@/renderer/types/electron'
import { parsePartialJson, truncateToolResult } from '@/renderer/utils/partialJson'

// 读取类工具（可以并行执行）
const READ_TOOLS = [
  'read_file',
  'read_multiple_files',
  'list_directory',
  'get_dir_tree',
  'search_files',
  'codebase_search',
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  'get_lint_errors',
]

// ===== 配置常量 =====

const CONFIG = {
  maxToolLoops: 25,           // 最大工具调用循环次数
  maxHistoryMessages: 50,     // 历史消息最大数量
  maxToolResultChars: 10000,  // 工具结果最大字符数
  maxFileContentChars: 15000, // 单个文件内容最大字符数
  maxTotalContextChars: 50000, // 总上下文最大字符数
  // 重试配置
  maxRetries: 2,              // 最大重试次数
  retryDelayMs: 1000,         // 重试延迟（毫秒）
  retryBackoffMultiplier: 2,  // 重试延迟倍数
} as const

// 可重试的错误代码
const RETRYABLE_ERROR_CODES = new Set([
  'RATE_LIMIT',
  'TIMEOUT',
  'NETWORK_ERROR',
  'SERVER_ERROR',
])

// LLM 消息类型现在从 MessageConverter 导入

// ===== Agent 服务类 =====

class AgentServiceClass {
  private abortController: AbortController | null = null
  private approvalResolver: ((approved: boolean) => void) | null = null
  private currentAssistantId: string | null = null
  private isRunning = false

  // ===== 公共方法 =====

  /**
   * 发送消息并启动 Agent 循环
   */
  async sendMessage(
    userMessage: MessageContent,
    config: {
      provider: string
      model: string
      apiKey: string
      baseUrl?: string
    },
    workspacePath: string | null,
    systemPrompt: string
  ): Promise<void> {
    // 防止重复执行
    if (this.isRunning) {
      console.warn('[Agent] Already running, ignoring new request')
      return
    }

    const store = useAgentStore.getState()

    // 验证 API Key
    if (!config.apiKey) {
      this.showError('Please configure your API key in settings.')
      return
    }

    this.isRunning = true
    this.abortController = new AbortController()

    try {
      // 1. 获取并保存上下文
      const contextItems = store.getCurrentThread()?.contextItems || []

      // 2. 读取上下文文件内容
      const contextContent = await this.buildContextContent(contextItems)

      // 3. 添加用户消息到 store
      const userMessageId = store.addUserMessage(userMessage, contextItems)
      store.clearContextItems()

      // 4. 创建消息检查点（在执行任何操作之前保存当前状态）
      const messageText = typeof userMessage === 'string'
        ? userMessage.slice(0, 50)
        : 'User message'
      await store.createMessageCheckpoint(userMessageId, messageText)

      // 5. 构建 LLM 消息历史
      const llmMessages = await this.buildLLMMessages(userMessage, contextContent, systemPrompt)

      // 6. 创建助手消息占位
      this.currentAssistantId = store.addAssistantMessage()
      store.setStreamPhase('streaming')

      // 7. 执行 Agent 循环
      await this.runAgentLoop(config, llmMessages, workspacePath)

    } catch (error) {
      console.error('[Agent] Error:', error)
      this.showError(error instanceof Error ? error.message : 'Unknown error occurred')
    } finally {
      this.cleanup()
    }
  }

  /**
   * 批准当前等待的工具调用
   */
  approve(): void {
    if (this.approvalResolver) {
      this.approvalResolver(true)
      this.approvalResolver = null
    }
  }

  /**
   * 拒绝当前等待的工具调用
   */
  reject(): void {
    if (this.approvalResolver) {
      this.approvalResolver(false)
      this.approvalResolver = null
    }
  }

  /**
   * 中止当前执行
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    window.electronAPI.abortMessage()

    if (this.approvalResolver) {
      this.approvalResolver(false)
      this.approvalResolver = null
    }

    this.cleanup()
  }

  // ===== 私有方法：核心逻辑 =====

  /**
   * Agent 主循环
   * 
   * 循环逻辑（参考 Cursor/Void）：
   * 1. 调用 LLM 获取响应
   * 2. 如果有工具调用，执行工具并将结果添加到消息历史
   * 3. 如果没有工具调用，结束循环（LLM 认为任务完成）
   * 4. 如果用户拒绝工具调用，结束循环
   * 5. 如果达到最大循环次数，结束循环
   * 6. 检测重复调用，防止无限循环
   */
  private async runAgentLoop(
    config: { provider: string; model: string; apiKey: string; baseUrl?: string },
    llmMessages: OpenAIMessage[],
    workspacePath: string | null
  ): Promise<void> {
    const store = useAgentStore.getState()
    let loopCount = 0
    let shouldContinue = true

    // 用于检测重复调用
    const recentToolCalls: string[] = []
    const MAX_RECENT_CALLS = 5
    let consecutiveRepeats = 0
    const MAX_CONSECUTIVE_REPEATS = 2

    while (shouldContinue && loopCount < CONFIG.maxToolLoops && !this.abortController?.signal.aborted) {
      loopCount++
      shouldContinue = false // 默认不继续，只有成功执行工具后才继续

      console.log(`[Agent] Loop iteration ${loopCount}`)

      // 调用 LLM（带自动重试）
      const result = await this.callLLMWithRetry(config, llmMessages)

      if (this.abortController?.signal.aborted) break

      if (result.error) {
        store.appendToAssistant(this.currentAssistantId!, `\n\n❌ Error: ${result.error}`)
        break
      }

      // 如果没有工具调用，LLM 认为任务完成，结束循环
      if (!result.toolCalls || result.toolCalls.length === 0) {
        console.log('[Agent] No tool calls, task complete')
        break
      }

      // 检测重复调用
      const currentCallSignature = result.toolCalls
        .map(tc => `${tc.name}:${JSON.stringify(tc.arguments)}`)
        .sort()
        .join('|')

      if (recentToolCalls.includes(currentCallSignature)) {
        consecutiveRepeats++
        console.warn(`[Agent] Detected repeated tool call (${consecutiveRepeats}/${MAX_CONSECUTIVE_REPEATS}):`, currentCallSignature.slice(0, 100))

        if (consecutiveRepeats >= MAX_CONSECUTIVE_REPEATS) {
          console.error('[Agent] Too many repeated calls, stopping loop')
          store.appendToAssistant(this.currentAssistantId!, '\n\n⚠️ Detected repeated operations. Stopping to prevent infinite loop.')
          break
        }
      } else {
        consecutiveRepeats = 0
      }

      // 记录最近的调用
      recentToolCalls.push(currentCallSignature)
      if (recentToolCalls.length > MAX_RECENT_CALLS) {
        recentToolCalls.shift()
      }

      // 添加 assistant 消息（包含 tool_calls）到历史
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

      // 执行所有工具调用（只读工具并行，写入工具串行）
      let hasSuccessfulTool = false
      let userRejected = false

      console.log(`[Agent] Executing ${result.toolCalls.length} tool calls`)

      // 分离只读工具和写入工具
      const readToolCalls = result.toolCalls.filter(tc => READ_TOOLS.includes(tc.name))
      const writeToolCalls = result.toolCalls.filter(tc => !READ_TOOLS.includes(tc.name))

      // 并行执行只读工具
      if (readToolCalls.length > 0 && !this.abortController?.signal.aborted) {
        console.log(`[Agent] Executing ${readToolCalls.length} read tools in parallel`)
        const readResults = await Promise.all(
          readToolCalls.map(async (toolCall) => {
            console.log(`[Agent] Executing read tool: ${toolCall.name}`, toolCall.arguments)
            const toolResult = await this.executeToolCall(toolCall, workspacePath)
            return { toolCall, toolResult }
          })
        )

        // 按原始顺序添加结果到消息历史
        for (const { toolCall, toolResult } of readResults) {
          llmMessages.push({
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: toolResult.content,
          })

          console.log(`[Agent] Tool result (${toolCall.name}):`, {
            success: toolResult.success,
            contentLength: toolResult.content.length,
            contentPreview: toolResult.content.slice(0, 200),
          })

          if (toolResult.success) hasSuccessfulTool = true
          if (toolResult.rejected) userRejected = true
        }
      }

      // 串行执行写入工具（需要保持顺序和用户审批）
      for (const toolCall of writeToolCalls) {
        if (this.abortController?.signal.aborted || userRejected) break

        console.log(`[Agent] Executing write tool: ${toolCall.name}`, toolCall.arguments)
        const toolResult = await this.executeToolCall(toolCall, workspacePath)

        llmMessages.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: toolResult.content,
        })

        console.log(`[Agent] Tool result (${toolCall.name}):`, {
          success: toolResult.success,
          contentLength: toolResult.content.length,
          contentPreview: toolResult.content.slice(0, 200),
        })

        if (toolResult.success) hasSuccessfulTool = true
        if (toolResult.rejected) userRejected = true
      }

      console.log(`[Agent] After tool execution, message count: ${llmMessages.length}`)

      // 如果用户拒绝了工具调用，停止循环
      if (userRejected) {
        console.log('[Agent] User rejected tool call, stopping')
        break
      }

      // 如果所有工具都失败了，停止循环
      if (!hasSuccessfulTool) {
        console.log('[Agent] All tools failed, stopping')
        break
      }

      // 有成功的工具调用，继续下一轮让 LLM 决定是否还需要更多操作
      shouldContinue = true
      store.setStreamPhase('streaming')
    }

    // 如果达到最大循环次数，添加提示
    if (loopCount >= CONFIG.maxToolLoops) {
      store.appendToAssistant(this.currentAssistantId!, '\n\n⚠️ Reached maximum tool call limit. Please continue the conversation if more work is needed.')
    }

    console.log(`[Agent] Loop finished after ${loopCount} iterations`)
  }

  /**
   * 调用 LLM API（带自动重试）
   */
  private async callLLMWithRetry(
    config: { provider: string; model: string; apiKey: string; baseUrl?: string },
    messages: OpenAIMessage[]
  ): Promise<{ content?: string; toolCalls?: LLMToolCall[]; error?: string }> {
    let lastError: string | undefined
    let delay = CONFIG.retryDelayMs

    for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
      if (this.abortController?.signal.aborted) {
        return { error: 'Aborted' }
      }

      if (attempt > 0) {
        console.log(`[Agent] Retry attempt ${attempt}/${CONFIG.maxRetries} after ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
        delay *= CONFIG.retryBackoffMultiplier
      }

      const result = await this.callLLM(config, messages)

      // 成功或不可重试的错误
      if (!result.error) {
        return result
      }

      // 检查是否可重试
      const isRetryable = RETRYABLE_ERROR_CODES.has(result.error) ||
        result.error.includes('timeout') ||
        result.error.includes('rate limit') ||
        result.error.includes('network')

      if (!isRetryable || attempt === CONFIG.maxRetries) {
        return result
      }

      lastError = result.error
      console.warn(`[Agent] Retryable error: ${result.error}`)
    }

    return { error: lastError || 'Max retries exceeded' }
  }

  /**
   * 调用 LLM API
   */
  private async callLLM(
    config: { provider: string; model: string; apiKey: string; baseUrl?: string },
    messages: OpenAIMessage[]
  ): Promise<{ content?: string; toolCalls?: LLMToolCall[]; error?: string }> {
    const store = useAgentStore.getState()

    return new Promise((resolve) => {
      let content = ''
      const toolCalls: LLMToolCall[] = []
      let currentToolCall: { id: string; name: string; argsString: string } | null = null
      const unsubscribers: (() => void)[] = []

      const cleanup = () => {
        unsubscribers.forEach(unsub => unsub())
      }

      // 监听流式文本
      unsubscribers.push(
        window.electronAPI.onLLMStream((chunk: LLMStreamChunk) => {
          // 调试日志
          if (chunk.type !== 'text') {
            console.log('[Agent] Stream chunk:', chunk.type, chunk.toolCallDelta || chunk.toolCall)
          }

          if (chunk.type === 'text' && chunk.content) {
            content += chunk.content
            if (this.currentAssistantId) {
              store.appendToAssistant(this.currentAssistantId, chunk.content)
            }
          }

          // 验证工具名称是否合法 (防止 LLM 幻觉生成带空格的工具名)
          const isValidToolName = (name: string) => {
            return /^[a-zA-Z0-9_]+$/.test(name)
          }

          // 流式工具调用开始 - 立即显示工具卡片
          if (chunk.type === 'tool_call_start' && chunk.toolCallDelta) {
            const toolId = chunk.toolCallDelta.id || `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
            const toolName = chunk.toolCallDelta.name || 'unknown'

            // 过滤无效的工具名称
            if (!isValidToolName(toolName)) {
              console.warn('[Agent] Ignoring invalid tool name:', toolName)
              return
            }

            console.log('[Agent] Tool call start:', toolId, toolName)

            currentToolCall = {
              id: toolId,
              name: toolName,
              argsString: '',
            }

            // 立即在 UI 中显示工具调用卡片（内联到消息中）
            if (this.currentAssistantId) {
              store.addToolCallPart(this.currentAssistantId, {
                id: toolId,
                name: toolName,
                arguments: { _streaming: true },
              })
            }
          }

          // 流式工具调用参数 - 实时更新参数预览
          if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta && currentToolCall) {
            if (chunk.toolCallDelta.args) {
              currentToolCall.argsString += chunk.toolCallDelta.args

              // 尝试解析部分参数用于预览
              const partialArgs = this.parsePartialArgs(currentToolCall.argsString, currentToolCall.name)

              if (this.currentAssistantId && Object.keys(partialArgs).length > 0) {
                store.updateToolCall(this.currentAssistantId, currentToolCall.id, {
                  arguments: { ...partialArgs, _streaming: true },
                })
              }
            }
          }

          // 流式工具调用结束 - 完成参数解析
          if (chunk.type === 'tool_call_end' && currentToolCall) {
            console.log('[Agent] Tool call end:', currentToolCall.id)
            try {
              const args = JSON.parse(currentToolCall.argsString || '{}')
              toolCalls.push({
                id: currentToolCall.id,
                name: currentToolCall.name,
                arguments: args,
              })

              if (this.currentAssistantId) {
                store.updateToolCall(this.currentAssistantId, currentToolCall.id, {
                  arguments: args,
                  status: 'pending',
                })
              }
            } catch (e) {
              console.error('[Agent] Failed to parse tool args:', e, currentToolCall.argsString)
              // 即使解析失败也添加工具调用
              toolCalls.push({
                id: currentToolCall.id,
                name: currentToolCall.name,
                arguments: { _parseError: true },
              })
            }
            currentToolCall = null
          }

          // 处理完整的工具调用（非流式，某些 API 直接返回完整工具调用）
          if (chunk.type === 'tool_call' && chunk.toolCall) {
            console.log('[Agent] Complete tool call:', chunk.toolCall.id, chunk.toolCall.name)

            if (!isValidToolName(chunk.toolCall.name)) {
              console.warn('[Agent] Ignoring invalid tool name:', chunk.toolCall.name)
              return
            }

            if (!toolCalls.find(tc => tc.id === chunk.toolCall!.id)) {
              toolCalls.push(chunk.toolCall)
              if (this.currentAssistantId) {
                store.addToolCallPart(this.currentAssistantId, {
                  id: chunk.toolCall.id,
                  name: chunk.toolCall.name,
                  arguments: chunk.toolCall.arguments,
                })
              }
            }
          }
        })
      )

      // 监听非流式工具调用
      unsubscribers.push(
        window.electronAPI.onLLMToolCall((toolCall: LLMToolCall) => {
          // 验证工具名称
          if (!/^[a-zA-Z0-9_]+$/.test(toolCall.name)) {
            console.warn('[Agent] Ignoring invalid tool name:', toolCall.name)
            return
          }

          // 避免重复添加
          if (!toolCalls.find(tc => tc.id === toolCall.id)) {
            toolCalls.push(toolCall)
            if (this.currentAssistantId) {
              store.addToolCallPart(this.currentAssistantId, {
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
              })
            }
          }
        })
      )

      // 监听完成
      unsubscribers.push(
        window.electronAPI.onLLMDone((result) => {
          cleanup()

          // 合并结果中的工具调用
          if (result.toolCalls) {
            for (const tc of result.toolCalls) {
              if (!toolCalls.find(t => t.id === tc.id)) {
                toolCalls.push(tc)
              }
            }
          }

          resolve({ content: content || result.content, toolCalls })
        })
      )

      // 监听错误
      unsubscribers.push(
        window.electronAPI.onLLMError((error) => {
          cleanup()
          resolve({ error: error.message })
        })
      )

      // 发送请求
      window.electronAPI.sendMessage({
        config,
        messages: messages as any,
        tools: getToolDefinitions(),
        systemPrompt: '', // system prompt 已经在 messages 中
      }).catch((err) => {
        cleanup()
        resolve({ error: err.message || 'Failed to send message' })
      })
    })
  }

  /**
   * 执行单个工具调用
   */
  private async executeToolCall(
    toolCall: LLMToolCall,
    workspacePath: string | null
  ): Promise<{ success: boolean; content: string; rejected?: boolean }> {
    const store = useAgentStore.getState()
    const { id, name, arguments: args } = toolCall

    // 检查是否需要用户审批
    const approvalType = getToolApprovalType(name)
    const autoApprove = store.autoApprove
    const needsApproval = approvalType && !autoApprove[approvalType]

    // 更新工具状态
    if (this.currentAssistantId) {
      store.updateToolCall(this.currentAssistantId, id, {
        status: needsApproval ? 'awaiting' : 'running',
      })
    }

    // 等待用户审批
    if (needsApproval) {
      store.setStreamPhase('tool_pending', { id, name, arguments: args, status: 'awaiting' })
      const approved = await this.waitForApproval()

      if (!approved) {
        if (this.currentAssistantId) {
          store.updateToolCall(this.currentAssistantId, id, {
            status: 'rejected',
            error: 'Rejected by user',
          })
        }
        store.addToolResult(id, name, 'Tool call was rejected by the user. The agent will stop here.', 'rejected', args as Record<string, unknown>)
        return { success: false, content: 'Tool call was rejected by the user.', rejected: true }
      }

      if (this.currentAssistantId) {
        store.updateToolCall(this.currentAssistantId, id, { status: 'running' })
      }
    }

    store.setStreamPhase('tool_running', { id, name, arguments: args, status: 'running' })

    // 如果是文件修改工具，记录文件快照到当前检查点
    let originalContent: string | null = null
    let fullPath: string | null = null
    if (WRITE_TOOLS.includes(name) || name === 'delete_file_or_folder') {
      const filePath = args.path as string
      if (filePath && workspacePath) {
        fullPath = filePath.startsWith(workspacePath) ? filePath : `${workspacePath}/${filePath}`
        originalContent = await window.electronAPI.readFile(fullPath)

        // 将快照添加到当前消息检查点（用于 Restore 功能）
        store.addSnapshotToCurrentCheckpoint(fullPath, originalContent)
      }
    }

    // 执行工具
    const result = await executeTool(name, args, workspacePath || undefined)

    // 更新状态
    const status: ToolStatus = result.success ? 'success' : 'error'
    if (this.currentAssistantId) {
      store.updateToolCall(this.currentAssistantId, id, {
        status,
        result: result.result,
        error: result.error,
        arguments: {
          ...args,
          _meta: result.meta,
        },
      })
    }

    // 如果文件修改成功，添加到 pendingChanges 和 Composer
    if (result.success && fullPath && (WRITE_TOOLS.includes(name) || name === 'delete_file_or_folder')) {
      const meta = result.meta as { linesAdded?: number; linesRemoved?: number; newContent?: string; isNewFile?: boolean } | undefined

      // 添加到 pendingChanges (用于 UI 显示)
      store.addPendingChange({
        filePath: fullPath,
        toolCallId: id,
        toolName: name,
        snapshot: { fsPath: fullPath, content: originalContent },
        linesAdded: meta?.linesAdded || 0,
        linesRemoved: meta?.linesRemoved || 0,
      })

      // 同时添加到 Composer (用于批量操作)
      try {
        const { composerService } = await import('../composerService')
        const relativePath = workspacePath
          ? fullPath.replace(workspacePath, '').replace(/^[\\/]/, '')
          : fullPath

        composerService.addChange({
          filePath: fullPath,
          relativePath,
          oldContent: originalContent,
          newContent: meta?.newContent || null,
          changeType: name === 'delete_file_or_folder' ? 'delete' : (meta?.isNewFile ? 'create' : 'modify'),
          linesAdded: meta?.linesAdded || 0,
          linesRemoved: meta?.linesRemoved || 0,
          toolCallId: id,
        })
      } catch (e) {
        // Composer 是可选功能，失败不影响主流程
        console.warn('[Agent] Failed to add to composer:', e)
      }
    }

    // 添加工具结果到 store
    const resultContent = result.success
      ? result.result
      : `Error: ${result.error}`

    // 使用智能截断（根据工具类型）
    const truncatedContent = truncateToolResult(resultContent, name, CONFIG.maxToolResultChars)

    const resultType = result.success ? 'success' : 'tool_error'
    store.addToolResult(id, name, truncatedContent, resultType, args as Record<string, unknown>)

    return { success: result.success, content: truncatedContent, rejected: false }
  }

  // ===== 私有方法：消息构建 =====

  /**
   * 构建发送给 LLM 的消息数组
   * 
   * 使用 MessageConverter 将内部消息格式转换为 OpenAI API 格式
   * 参考 Void/Cursor 的架构设计
   */
  private async buildLLMMessages(
    currentMessage: MessageContent,
    contextContent: string,
    systemPrompt: string
  ): Promise<OpenAIMessage[]> {
    const store = useAgentStore.getState()

    // 1. 获取历史消息（不包括刚添加的用户消息，因为还没有 assistant 回复）
    const historyMessages = store.getMessages()
    // 过滤掉 checkpoint 消息，限制数量
    const filteredMessages = historyMessages
      .filter(m => m.role !== 'checkpoint')
      .slice(-CONFIG.maxHistoryMessages)

    // 2. 使用 MessageConverter 转换为 OpenAI 格式
    const openaiMessages = buildOpenAIMessages(filteredMessages, systemPrompt)

    // 3. 截断过长的 tool 结果（使用智能截断）
    for (const msg of openaiMessages) {
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        if (msg.content.length > CONFIG.maxToolResultChars) {
          // 尝试从 tool_call_id 推断工具名称，否则使用默认截断
          msg.content = truncateToolResult(msg.content, 'default', CONFIG.maxToolResultChars)
        }
      }
    }

    // 4. 添加当前用户消息（带上下文）
    const userContent = this.buildUserContent(currentMessage, contextContent)
    openaiMessages.push({
      role: 'user',
      content: userContent,
    })

    // 5. 验证消息格式
    const validation = validateOpenAIMessages(openaiMessages)
    if (!validation.valid) {
      console.warn('[Agent] Message validation warning:', validation.error)
    }

    return openaiMessages
  }

  /**
   * 构建上下文内容（读取文件等）
   */
  private async buildContextContent(contextItems: ContextItem[]): Promise<string> {
    if (!contextItems || contextItems.length === 0) {
      return ''
    }

    const parts: string[] = []
    let totalChars = 0

    for (const item of contextItems) {
      if (totalChars >= CONFIG.maxTotalContextChars) {
        parts.push('\n[Additional context truncated due to size limit]')
        break
      }

      if (item.type === 'File') {
        const filePath = (item as { uri: string }).uri
        try {
          const content = await window.electronAPI.readFile(filePath)
          if (content) {
            const truncated = content.length > CONFIG.maxFileContentChars
              ? content.slice(0, CONFIG.maxFileContentChars) + '\n...(file truncated)'
              : content

            const fileBlock = `\n### File: ${filePath}\n\`\`\`\n${truncated}\n\`\`\`\n`
            parts.push(fileBlock)
            totalChars += fileBlock.length
          } else {
            parts.push(`\n[File not found: ${filePath}]\n`)
          }
        } catch (e) {
          parts.push(`\n[Error reading file: ${filePath}]\n`)
        }
      } else if (item.type === 'Codebase') {
        parts.push('\n[Codebase context enabled - use search_files tool to find relevant code]\n')
      } else if (item.type === 'Git') {
        parts.push('\n[Git context enabled - use run_command with git commands]\n')
      } else if (item.type === 'Terminal') {
        parts.push('\n[Terminal context enabled - use run_command tool]\n')
      }
    }

    return parts.join('')
  }

  /**
   * 构建用户消息内容
   */
  private buildUserContent(message: MessageContent, contextContent: string): string {
    const textContent = this.extractTextContent(message)

    if (!contextContent) {
      return textContent
    }

    return `## Referenced Context\n${contextContent}\n\n## User Request\n${textContent}`
  }

  /**
   * 提取消息文本内容
   */
  private extractTextContent(content: MessageContent): string {
    if (typeof content === 'string') {
      return content
    }
    return content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('')
  }

  /**
   * 解析部分参数（用于流式预览）
   * 使用健壮的部分 JSON 解析器
   */
  private parsePartialArgs(argsString: string, _toolName: string): Record<string, unknown> {
    if (!argsString || argsString.length < 2) {
      return {}
    }

    // 使用新的部分 JSON 解析器
    const parsed = parsePartialJson(argsString)
    if (parsed && Object.keys(parsed).length > 0) {
      return parsed
    }

    return {}
  }

  // ===== 私有方法：辅助功能 =====

  /**
   * 等待用户审批
   */
  private waitForApproval(): Promise<boolean> {
    return new Promise((resolve) => {
      this.approvalResolver = resolve
    })
  }

  /**
   * 显示错误消息
   */
  private showError(message: string): void {
    const store = useAgentStore.getState()
    const id = store.addAssistantMessage()
    store.appendToAssistant(id, `❌ ${message}`)
    store.finalizeAssistant(id)
  }

  /**
   * 清理状态
   */
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
}

// 单例导出
export const AgentService = new AgentServiceClass()
