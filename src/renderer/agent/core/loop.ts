/**
 * Agent 主循环
 * 
 * 职责：
 * - 管理 LLM 调用循环
 * - 基于真实 token 使用量的上下文压缩
 * - 工具执行协调
 * - 循环检测
 * - 发布事件到 EventBus
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { performanceMonitor, withRetry, isRetryableError } from '@shared/utils'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { toolManager, initializeToolProviders, setToolLoadingContext, initializeTools } from '../tools'
import { toolRegistry } from '../tools/registry'
import { getAgentConfig, READ_TOOLS } from '../utils/AgentConfig'
import { LoopDetector } from '../utils/LoopDetector'
import { getReadOnlyTools, isFileEditTool } from '@/shared/config/tools'
import { pathStartsWith, joinPath } from '@shared/utils/pathUtils'
import { createStreamProcessor } from './stream'
import { executeTools } from './tools'
import { EventBus } from './EventBus'
import {
  generateSummary,
  generateHandoffDocument,
} from '../context'
import { updateStats, LEVEL_NAMES, estimateMessagesTokens } from '../context/CompressionManager'
import type { ChatMessage } from '../types'
import type { LLMMessage } from '@/shared/types'
import type { WorkMode } from '@/renderer/modes/types'
import type { LLMConfig, LLMCallResult, ExecutionContext } from './types'

// ===== 模式后处理钩子 =====

/**
 * 执行模式后处理钩子
 */
function executeModePostProcessHook(
  mode: WorkMode,
  context: Parameters<import('@shared/config/agentConfig').ModePostProcessHook>[0]
): ReturnType<import('@shared/config/agentConfig').ModePostProcessHook> {
  const agentConfig = getAgentConfig()
  const hookConfig = agentConfig.modePostProcessHooks?.[mode]

  if (!hookConfig?.enabled || !hookConfig.hook) {
    return null
  }

  try {
    return hookConfig.hook(context)
  } catch (error) {
    logger.agent.error(`[Loop] Mode post-process hook error for ${mode}:`, error)
    return null
  }
}

// ===== LLM 调用 =====

/**
 * 调用 LLM 并处理流式响应
 * 
 * @param config - LLM 配置
 * @param messages - 消息历史
 * @param chatMode - 工作模式
 * @param assistantId - 助手消息 ID
 * @returns LLM 调用结果
 */
async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  chatMode: WorkMode,
  assistantId: string | null
): Promise<LLMCallResult> {
  performanceMonitor.start(`llm:${config.model}`, 'llm', { provider: config.provider, messageCount: messages.length })

  const processor = createStreamProcessor(assistantId)

  try {
    // 初始化工具
    initializeToolProviders()
    await initializeTools()
    const templateId = useStore.getState().promptTemplateId
    setToolLoadingContext({
      mode: chatMode,
      templateId,
    })
    const tools = chatMode === 'chat' ? [] : toolManager.getAllToolDefinitions()

    // 动态工具控制：根据上下文限制可用工具
    let activeTools: string[] | undefined

    if (tools.length > 0) {
      const allToolNames = tools.map(t => t.name)
      const store = useAgentStore.getState()

      // 场景1: Chat 模式 - 禁用所有工具（已在上面处理）
      // 场景2: Plan 模式 - 启用所有工具（包括 plan 相关工具）
      // 场景3: Code 模式 - 根据压缩等级动态调整

      // 当上下文压缩等级较高时，限制工具以减少 token 使用
      const compressionLevel = store.compressionStats?.level || 0
      if (compressionLevel >= 3) {
        // L3/L4: 只保留核心工具，移除 AI 辅助工具（节省 token）
        const coreTools = allToolNames.filter(name =>
          !['analyze_code', 'suggest_refactoring', 'suggest_fixes', 'generate_tests'].includes(name)
        )
        activeTools = coreTools
        logger.agent.info(`[Loop] Compression L${compressionLevel}: ${activeTools.length}/${allToolNames.length} tools active (AI tools disabled)`)
      }

      // 未来可扩展的场景：
      // - 只读模式：activeTools = allToolNames.filter(name => getReadOnlyTools().includes(name))
      // - 安全模式：activeTools = allToolNames.filter(name => !getDangerousTools().includes(name))
      // - 特定任务：activeTools = getToolsForTask(taskType)
    }

    // 发送请求
    await api.llm.send({
      config: config as import('@shared/types/llm').LLMConfig,
      messages: messages as LLMMessage[],
      tools,
      systemPrompt: '',
      activeTools
    })

    // 等待流式响应完成
    const result = await processor.wait()
    performanceMonitor.end(`llm:${config.model}`, !result.error)

    // 更新 usage
    if (assistantId && result.usage) {
      useAgentStore.getState().updateMessage(assistantId, {
        usage: result.usage
      } as Partial<import('../types').AssistantMessage>)
    } else if (assistantId && !result.usage) {
      logger.agent.warn('[Loop] No usage data in LLM result')
    }

    processor.cleanup()
    return result
  } catch (error) {
    processor.cleanup()
    logger.agent.error('[Loop] Error in callLLM:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    return { error: errorMsg }
  }
}

async function callLLMWithRetry(
  config: LLMConfig,
  messages: LLMMessage[],
  chatMode: WorkMode,
  assistantId: string | null,
  abortSignal?: AbortSignal
): Promise<LLMCallResult> {
  const retryConfig = getAgentConfig()
  try {
    return await withRetry(
      async () => {
        if (abortSignal?.aborted) throw new Error('Aborted')
        const result = await callLLM(config, messages, chatMode, assistantId)

        // 工具调用解析错误不应该导致重试，而是返回给 AI 让它反思
        // 只有真正的 LLM 错误（网络、API 等）才需要重试
        if (result.error) {
          const errorMsg = result.error.toLowerCase()
          const isToolParseError = errorMsg.includes('tool call parse') ||
            errorMsg.includes('invalid input for tool') ||
            errorMsg.includes('type validation failed')

          if (isToolParseError) {
            // 工具解析错误：不重试，返回结果让 loop 处理
            logger.agent.warn('[Loop] Tool parse error, will be handled in loop:', result.error)
            return result
          }

          // 其他错误：抛出以触发重试
          throw new Error(result.error)
        }

        return result
      },
      {
        maxRetries: retryConfig.maxRetries,
        initialDelayMs: retryConfig.retryDelayMs,
        backoffMultiplier: retryConfig.retryBackoffMultiplier,
        isRetryable: error => {
          const msg = error instanceof Error ? error.message : String(error)
          return isRetryableError(error) && msg !== 'Aborted'
        },
        onRetry: (attempt, error, delay) =>
          logger.agent.info(`[Loop] LLM retry ${attempt}, waiting ${delay}ms...`, error),
      }
    )
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

// ===== 自动修复 =====

async function autoFix(
  toolCalls: any[],
  workspacePath: string,
  assistantId: string | null
): Promise<void> {
  const store = useAgentStore.getState()
  const writeToolCalls = toolCalls.filter(tc => !READ_TOOLS.includes(tc.name))
  if (writeToolCalls.length === 0) return

  const editedFiles = writeToolCalls
    .filter(tc => isFileEditTool(tc.name))
    .map(tc => {
      const path = tc.arguments.path as string
      return pathStartsWith(path, workspacePath) ? path : joinPath(workspacePath, path)
    })
    .filter(path => !path.endsWith('/'))

  if (editedFiles.length === 0) return

  // 并行检查所有文件的 lint 错误
  const results = await Promise.all(
    editedFiles.map(async (filePath) => {
      try {
        const result = await toolRegistry.execute('get_lint_errors', { path: filePath }, { workspacePath })
        if (result.success && result.result) {
          const text = result.result.trim()
          if (text && text !== '[]' && text !== 'No diagnostics found') {
            if (/\[error\]/i.test(text) || text.includes('failed to compile') || text.includes('syntax error')) {
              return `File: ${filePath}\n${text}`
            }
          }
        }
      } catch { /* ignore */ }
      return null
    })
  )

  const errors = results.filter((e): e is string => e !== null)

  if (errors.length > 0 && assistantId) {
    store.appendToAssistant(assistantId, `\n\n🔍 **Auto-check**: Detected ${errors.length} issue(s). Attempting to fix...`)
  }
}

// ===== 压缩检查与处理 =====

interface CompressionCheckResult {
  level: 0 | 1 | 2 | 3 | 4
  needsHandoff: boolean
}

/**
 * 检查并处理压缩
 * 
 * 在 LLM 返回后调用，根据真实 token 使用量更新压缩统计
 */
async function checkAndHandleCompression(
  usage: { input: number; output: number },
  contextLimit: number,
  store: ReturnType<typeof useAgentStore.getState>,
  context: ExecutionContext,
  assistantId: string,
  enableLLMSummary: boolean,
  autoHandoff: boolean
): Promise<CompressionCheckResult> {
  const thread = store.getCurrentThread()
  const messageCount = thread?.messages.length || 0

  // 使用 CompressionManager 更新统计（使用真实 usage）
  const previousStats = store.compressionStats
  const newStats = updateStats(
    { promptTokens: usage.input, completionTokens: usage.output },
    contextLimit,
    previousStats,
    messageCount
  )

  // 使用真实 usage 计算的等级（不再强制"只升不降"）
  const calculatedLevel = newStats.level

  logger.agent.info(
    `[Compression] L${calculatedLevel} (${LEVEL_NAMES[calculatedLevel]}), ` +
    `ratio: ${(newStats.ratio * 100).toFixed(1)}%, ` +
    `tokens: ${newStats.inputTokens + newStats.outputTokens}/${contextLimit}`
  )

  // 更新 store
  store.setCompressionStats(newStats as import('../context/CompressionManager').CompressionStats)
  store.setCompressionPhase('idle')

  // L3 预警：提前通知用户上下文即将满
  if (calculatedLevel === 3 && (!previousStats || previousStats.level < 3)) {
    const remainingRatio = 1 - newStats.ratio
    const estimatedRemainingTurns = Math.floor(remainingRatio * contextLimit / (usage.input + usage.output))
    EventBus.emit({
      type: 'context:warning',
      level: 3,
      message: `Context usage is high (${(newStats.ratio * 100).toFixed(1)}%). Estimated ${estimatedRemainingTurns} turns remaining.`,
    })
  }

  // L3: 生成 LLM 摘要
  if (calculatedLevel >= 3 && enableLLMSummary && thread) {
    store.setCompressionPhase('summarizing')
    try {
      const userTurns = thread.messages.filter(m => m.role === 'user').length
      const summaryResult = await generateSummary(thread.messages, { type: 'detailed' })
      store.setContextSummary({
        objective: summaryResult.objective,
        completedSteps: summaryResult.completedSteps,
        pendingSteps: summaryResult.pendingSteps,
        decisions: [],
        fileChanges: summaryResult.fileChanges,
        errorsAndFixes: [],
        userInstructions: [],
        generatedAt: Date.now(),
        turnRange: [0, userTurns],
      })
      EventBus.emit({ type: 'context:summary', summary: summaryResult.summary })
    } catch {
      // 摘要生成失败，不影响主流程
    }
    store.setCompressionPhase('idle')
  }

  // L4: 生成 Handoff 文档
  if (calculatedLevel >= 4) {
    if (autoHandoff && thread && context.workspacePath) {
      store.setCompressionPhase('summarizing')
      try {
        const handoff = await generateHandoffDocument(thread.id, thread.messages, context.workspacePath)
        store.setHandoffDocument(handoff)
        EventBus.emit({ type: 'context:handoff', document: handoff })
      } catch {
        // Handoff 生成失败，不影响主流程
      }
      store.setCompressionPhase('idle')
    }

    const { language } = useStore.getState()
    const msg = language === 'zh'
      ? '⚠️ **上下文已满**\n\n当前对话已达到上下文限制。请开始新会话继续。'
      : '⚠️ **Context Limit Reached**\n\nPlease start a new session to continue.'
    store.appendToAssistant(assistantId, msg)
    store.setHandoffRequired(true)
  }

  EventBus.emit({ type: 'context:level', level: calculatedLevel, tokens: newStats.inputTokens + newStats.outputTokens, ratio: newStats.ratio })

  return { level: calculatedLevel, needsHandoff: calculatedLevel >= 4 }
}

// ===== 主循环 =====

export async function runLoop(
  config: LLMConfig,
  llmMessages: LLMMessage[],
  context: ExecutionContext,
  assistantId: string
): Promise<void> {
  const store = useAgentStore.getState()
  const mainStore = useStore.getState()

  // 一次性获取所有配置，避免重复调用 getState()
  const agentConfig = getAgentConfig()
  const maxIterations = mainStore.agentConfig.maxToolLoops || agentConfig.maxToolLoops
  const enableAutoFix = mainStore.agentConfig.enableAutoFix
  const enableLLMSummary = mainStore.agentConfig.enableLLMSummary
  const autoHandoff = mainStore.agentConfig.autoHandoff ?? agentConfig.autoHandoff

  // 获取模型上下文限制（默认 128k）
  const contextLimit = config.contextLimit || 128_000

  const loopDetector = new LoopDetector()
  let iteration = 0
  let shouldContinue = true

  EventBus.emit({ type: 'loop:start' })

  while (shouldContinue && iteration < maxIterations && !context.abortSignal?.aborted) {
    iteration++
    shouldContinue = false
    EventBus.emit({ type: 'loop:iteration', count: iteration })

    // 检查中止信号
    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted' })
      break
    }

    if (llmMessages.length === 0) {
      logger.agent.error('[Loop] No messages to send')
      store.appendToAssistant(assistantId, '\n\n❌ Error: No messages to send')
      EventBus.emit({ type: 'loop:end', reason: 'no_messages' })
      break
    }

    // 调用 LLM
    const result = await callLLMWithRetry(config, llmMessages, context.chatMode, assistantId, context.abortSignal)

    // 再次检查中止信号（LLM 调用后）
    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted' })
      break
    }

    // 处理错误
    if (result.error) {
      const errorMsg = result.error.toLowerCase()
      const isToolParseError = errorMsg.includes('tool call parse') ||
        errorMsg.includes('invalid input for tool') ||
        errorMsg.includes('type validation failed')

      if (isToolParseError) {
        // 工具解析错误：作为用户消息返回给 AI，让它反思和重试
        logger.agent.warn('[Loop] Tool parse error, adding as feedback:', result.error)

        llmMessages.push({
          role: 'user',
          content: `❌ Tool Call Error: ${result.error}

Please fix the tool call and try again. Make sure:
1. All required parameters are provided
2. Parameter types are correct
3. Parameter names match exactly

Try again with the corrected tool call.`
        })

        shouldContinue = true
        continue
      } else {
        // 其他错误：中止循环
        logger.agent.error('[Loop] LLM error:', result.error)
        store.appendToAssistant(assistantId, `\n\n❌ Error: ${result.error}`)
        EventBus.emit({ type: 'loop:end', reason: 'error' })
        break
      }
    }

    // 在 LLM 调用后立即检查压缩
    // 处理 usage 可能是数组或对象的情况
    const usageData = Array.isArray(result.usage) ? result.usage[0] : result.usage

    if (usageData && usageData.totalTokens > 0) {
      const usage = {
        input: usageData.promptTokens || 0,
        output: usageData.completionTokens || 0,
      }

      const compressionResult = await checkAndHandleCompression(
        usage,
        contextLimit,
        store,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff
      )

      // L4 需要中断循环
      if (compressionResult.needsHandoff) {
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required' })
        break
      }
    } else {
      // 兜底：使用精确估算值更新统计
      logger.agent.warn('[Loop] No valid usage data from LLM, using estimated tokens')

      const estimatedTokens = estimateMessagesTokens(llmMessages as ChatMessage[])

      // 假设 90% 是输入，10% 是输出（保守估计）
      const usage = {
        input: Math.floor(estimatedTokens * 0.9),
        output: Math.floor(estimatedTokens * 0.1),
      }

      // 更新消息的 usage（使用估算值）
      if (assistantId) {
        store.updateMessage(assistantId, {
          usage: {
            promptTokens: usage.input,
            completionTokens: usage.output,
            totalTokens: usage.input + usage.output,
          }
        } as Partial<import('../types').AssistantMessage>)
      }

      const compressionResult = await checkAndHandleCompression(
        usage,
        contextLimit,
        store,
        context,
        assistantId,
        enableLLMSummary,
        autoHandoff
      )

      // L4 需要中断循环
      if (compressionResult.needsHandoff) {
        EventBus.emit({ type: 'loop:end', reason: 'handoff_required' })
        break
      }
    }

    // 没有工具调用 - Chat 模式或 LLM 决定结束
    if (!result.toolCalls || result.toolCalls.length === 0) {
      // 模式后处理钩子
      const hookResult = executeModePostProcessHook(context.chatMode, {
        mode: context.chatMode,
        messages: llmMessages,
        hasWriteOps: llmMessages.some(m => {
          const readOnlyTools = getReadOnlyTools()
          return m.role === 'assistant' && m.tool_calls?.some((tc: any) => !readOnlyTools.includes(tc.function.name))
        }),
        hasSpecificTool: (toolName: string) => llmMessages.some(m =>
          m.role === 'assistant' && m.tool_calls?.some((tc: any) => tc.function.name === toolName)
        ),
        iteration,
        maxIterations,
      })

      if (hookResult?.shouldContinue && hookResult.reminderMessage) {
        llmMessages.push({ role: 'user', content: hookResult.reminderMessage })
        shouldContinue = true
        continue
      }
      EventBus.emit({ type: 'loop:end', reason: 'complete' })
      break
    }

    // 循环检测
    const loopCheck = loopDetector.checkLoop(result.toolCalls)
    if (loopCheck.isLoop) {
      logger.agent.warn(`[Loop] Loop detected: ${loopCheck.reason}`)
      const suggestion = loopCheck.suggestion ? `\n💡 ${loopCheck.suggestion}` : ''
      store.appendToAssistant(assistantId, `\n\n⚠️ ${loopCheck.reason}${suggestion}`)
      EventBus.emit({ type: 'loop:warning', message: loopCheck.reason || 'Loop detected' })
      EventBus.emit({ type: 'loop:end', reason: 'loop_detected' })
      break
    }

    // 添加工具调用到 UI
    const currentMsg = store.getMessages().find(m => m.id === assistantId)
    if (currentMsg?.role === 'assistant') {
      const assistantMsg = currentMsg as import('../types').AssistantMessage
      const existing = assistantMsg.toolCalls || []
      for (const tc of result.toolCalls) {
        if (!existing.find((e) => e.id === tc.id)) {
          store.addToolCallPart(assistantId, { id: tc.id, name: tc.name, arguments: tc.arguments })
        }
      }
    }

    // 添加到消息历史
    llmMessages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    })

    // 执行工具
    const { results: toolResults, userRejected } = await executeTools(
      result.toolCalls,
      { workspacePath: context.workspacePath, currentAssistantId: assistantId, chatMode: context.chatMode },
      context.abortSignal
    )

    // 检查中止信号（工具执行后）
    if (context.abortSignal?.aborted) {
      EventBus.emit({ type: 'loop:end', reason: 'aborted' })
      break
    }

    // 检查 ask_user
    const waitingResult = toolResults.find(r => r.result.meta?.waitingForUser)
    if (waitingResult) {
      // 从 meta 中提取 interactive 数据并设置到 store
      const interactive = waitingResult.result.meta?.interactive as import('../types').InteractiveContent | undefined
      if (interactive) {
        store.setInteractive(assistantId, interactive)
      } else {
        // 兜底：如果没有 interactive 数据，至少要 finalize
        store.finalizeAssistant(assistantId)
      }
      store.setStreamPhase('idle')
      EventBus.emit({ type: 'loop:end', reason: 'waiting_for_user' })
      break
    }

    // 添加工具结果
    for (const { toolCall, result: toolResult } of toolResults) {
      llmMessages.push({
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: toolResult.content,
      })

      // 记录工具执行结果到循环检测器
      const success = !toolResult.content.startsWith('Error:')
      loopDetector.recordResult(toolCall.id, success)

      const meta = toolResult.meta
      if (meta?.filePath && typeof meta.filePath === 'string' && typeof meta.newContent === 'string') {
        loopDetector.updateContentHash(meta.filePath, meta.newContent)

        // 添加待确认的文件变更
        store.addPendingChange({
          filePath: meta.filePath,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          changeType: meta.oldContent ? 'modify' : 'create',
          snapshot: {
            path: meta.filePath,
            content: (meta.oldContent as string) || null,
            timestamp: Date.now(),
          },
          newContent: meta.newContent,
          linesAdded: (meta.linesAdded as number) || 0,
          linesRemoved: (meta.linesRemoved as number) || 0,
        })
      }
    }

    // 自动修复（并行检查）
    if (enableAutoFix && !userRejected && context.workspacePath) {
      await autoFix(result.toolCalls, context.workspacePath, assistantId)
    }

    if (userRejected) {
      EventBus.emit({ type: 'loop:end', reason: 'user_rejected' })
      break
    }

    shouldContinue = true
    store.setStreamPhase('streaming')
  }

  // 达到最大迭代次数
  if (iteration >= maxIterations) {
    logger.agent.warn('[Loop] Reached maximum iterations')
    store.appendToAssistant(assistantId, '\n\n⚠️ Reached maximum tool call limit.')
    EventBus.emit({ type: 'loop:warning', message: 'Max iterations reached' })
    EventBus.emit({ type: 'loop:end', reason: 'max_iterations' })
  }
}
