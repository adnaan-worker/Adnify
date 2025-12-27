/**
 * LLM 流式响应处理器
 * 处理来自 LLM 的流式事件（文本、工具调用、推理等）
 */

import { logger } from '@utils/Logger'
import { useAgentStore } from '../store/AgentStore'
import { useModeStore } from '@/renderer/modes'
import { getToolDefinitions, ToolDefinition } from '../tools'
import { parsePartialArgs, parseXMLToolCalls, removeXMLToolCallsFromContent, generateToolCallId } from '../utils/XMLToolParser'
import { LLMStreamChunk, LLMToolCall } from '@/renderer/types/electron'

/**
 * 流式处理器状态
 */
export interface StreamHandlerState {
  content: string
  toolCalls: LLMToolCall[]
  currentToolCall: { id: string; name: string; argsString: string } | null
  isReasoning: boolean
  contentBuffer: string
  activeStreamingToolCalls: Set<string>
  // 已完成的 XML 工具调用（避免重复处理）
  completedXMLToolCalls: Set<string>
  // 当前 reasoning part 的 id（用于追加内容）
  currentReasoningPartId: string | null
  reasoningStartTime: number | null
}

/**
 * 流式处理器回调
 */
export interface StreamHandlerCallbacks {
  onContentUpdate: (content: string) => void
  onToolCallStart: (id: string, name: string) => void
  onToolCallUpdate: (id: string, args: Record<string, unknown>) => void
  onToolCallEnd: (id: string, args: Record<string, unknown>) => void
}

/**
 * 创建初始状态
 */
export function createStreamHandlerState(): StreamHandlerState {
  return {
    content: '',
    toolCalls: [],
    currentToolCall: null,
    isReasoning: false,
    contentBuffer: '',
    activeStreamingToolCalls: new Set(),
    completedXMLToolCalls: new Set(),
    currentReasoningPartId: null,
    reasoningStartTime: null,
  }
}

/**
 * 验证工具名称是否合法
 */
export function isValidToolName(name: string): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false
  const isPlanMode = useModeStore.getState().currentMode === 'plan'
  return getToolDefinitions(isPlanMode).some((t: ToolDefinition) => t.name === name)
}

/**
 * 处理流式文本块
 */
export function handleTextChunk(
  chunk: LLMStreamChunk,
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (chunk.type !== 'text' || !chunk.content) return

  const store = useAgentStore.getState()
  state.content += chunk.content
  state.contentBuffer += chunk.content

  if (currentAssistantId) {
    store.appendToAssistant(currentAssistantId, chunk.content)
  }
}

/**
 * 处理推理/思考内容
 * 作为独立的 part 插入到 parts 数组中，按流式顺序显示
 */
export function handleReasoningChunk(
  chunk: LLMStreamChunk,
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (chunk.type !== 'reasoning') return
  
  // 忽略空内容
  if (!chunk.content || chunk.content.trim() === '') return

  const store = useAgentStore.getState()

  if (currentAssistantId) {
    if (!state.isReasoning) {
      // 新的推理开始，创建新的 reasoning part
      state.isReasoning = true
      state.reasoningStartTime = Date.now()
      state.currentReasoningPartId = store.addReasoningPart(currentAssistantId)
    }
    // 追加到当前 reasoning part
    if (state.currentReasoningPartId) {
      store.updateReasoningPart(currentAssistantId, state.currentReasoningPartId, chunk.content, true)
    }
  }
}

/**
 * 关闭推理（如果正在推理）
 * 标记当前 reasoning part 为完成状态
 * 如果 reasoning part 没有内容，则删除它
 */
export function closeReasoningIfNeeded(
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (!state.isReasoning) return

  const store = useAgentStore.getState()
  if (currentAssistantId && state.currentReasoningPartId) {
    // 检查 reasoning part 是否有内容
    const thread = store.getCurrentThread()
    if (thread) {
      const assistantMsg = thread.messages.find(
        m => m.id === currentAssistantId && m.role === 'assistant'
      )
      if (assistantMsg && assistantMsg.role === 'assistant') {
        const reasoningPart = (assistantMsg as any).parts?.find(
          (p: any) => p.type === 'reasoning' && p.id === state.currentReasoningPartId
        )
        if (reasoningPart && (!reasoningPart.content || reasoningPart.content.trim() === '')) {
          // 删除空的 reasoning part
          const newParts = (assistantMsg as any).parts.filter(
            (p: any) => !(p.type === 'reasoning' && p.id === state.currentReasoningPartId)
          )
          store.updateMessage(currentAssistantId, { parts: newParts } as any)
        } else {
          // 有内容，标记为完成
          store.finalizeReasoningPart(currentAssistantId, state.currentReasoningPartId)
        }
      }
    }
  }

  state.isReasoning = false
  state.currentReasoningPartId = null
}

/**
 * 处理工具调用开始事件
 */
export function handleToolCallStart(
  chunk: LLMStreamChunk,
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (chunk.type !== 'tool_call_start' || !chunk.toolCallDelta) return

  const store = useAgentStore.getState()
  const toolId = chunk.toolCallDelta.id || generateToolCallId('tool')
  const toolName = chunk.toolCallDelta.name || 'unknown'

  logger.agent.debug(`%c[Agent] ✅ Tool call START: ${toolName} (${toolId})`, 'color: #00ff00; font-weight: bold')

  if (toolName !== 'unknown' && !isValidToolName(toolName)) {
    logger.agent.warn(`[Agent] Invalid tool name detected: ${toolName}`)
    return
  }

  state.currentToolCall = { id: toolId, name: toolName, argsString: '' }

  if (currentAssistantId) {
    store.addToolCallPart(currentAssistantId, {
      id: toolId,
      name: toolName,
      arguments: { _streaming: true },
    })
  }
}

/**
 * 处理工具调用参数增量
 */
export function handleToolCallDelta(
  chunk: LLMStreamChunk,
  state: StreamHandlerState,
  currentAssistantId: string | null,
  throttleState: { lastUpdate: number; lastArgsLen: number }
): void {
  if (chunk.type !== 'tool_call_delta' || !chunk.toolCallDelta || !state.currentToolCall) return

  const store = useAgentStore.getState()
  logger.agent.debug(`%c[Agent] 📝 Tool call DELTA: +${chunk.toolCallDelta.args?.length || 0} chars`, 'color: #ffff00')

  if (chunk.toolCallDelta.name) {
    const newName = chunk.toolCallDelta.name
    if (isValidToolName(newName)) {
      state.currentToolCall.name = newName
      if (currentAssistantId) {
        store.updateToolCall(currentAssistantId, state.currentToolCall.id, { name: newName })
      }
    }
  }

  if (chunk.toolCallDelta.args) {
    state.currentToolCall.argsString += chunk.toolCallDelta.args
    const partialArgs = parsePartialArgs(state.currentToolCall.argsString)

    if (currentAssistantId) {
      const now = Date.now()
      const currentLen = state.currentToolCall.argsString.length

      // 节流：每 30ms 或内容增长超过 50 字符时更新
      if (now - throttleState.lastUpdate > 30 || currentLen - throttleState.lastArgsLen > 50) {
        store.updateToolCall(currentAssistantId, state.currentToolCall.id, {
          arguments: { ...partialArgs, _streaming: true },
        })
        throttleState.lastUpdate = now
        throttleState.lastArgsLen = currentLen
      }
    }
  }
}

/**
 * 处理工具调用结束事件
 */
export function handleToolCallEnd(
  chunk: LLMStreamChunk,
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (chunk.type !== 'tool_call_end' || !state.currentToolCall) return

  const store = useAgentStore.getState()
  logger.agent.debug(
    `%c[Agent] 🏁 Tool call END: ${state.currentToolCall.name} (total args: ${state.currentToolCall.argsString.length} chars)`,
    'color: #ff6600; font-weight: bold'
  )

  try {
    const args = JSON.parse(state.currentToolCall.argsString || '{}')
    state.toolCalls.push({
      id: state.currentToolCall.id,
      name: state.currentToolCall.name,
      arguments: args,
    })
    if (currentAssistantId) {
      store.updateToolCall(currentAssistantId, state.currentToolCall.id, {
        arguments: args,
        status: 'pending',
      })
    }
  } catch (e) {
    logger.agent.error(`[Agent] Failed to parse tool args for ${state.currentToolCall.name}:`, e)
    state.toolCalls.push({
      id: state.currentToolCall.id,
      name: state.currentToolCall.name,
      arguments: { _parseError: true, _rawArgs: state.currentToolCall.argsString },
    })
  }
  state.currentToolCall = null
}

/**
 * 处理完整工具调用（非流式）
 */
export function handleFullToolCall(
  chunk: LLMStreamChunk,
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (chunk.type !== 'tool_call' || !chunk.toolCall) return

  const store = useAgentStore.getState()
  logger.agent.debug(`%c[Agent] ⚡ FULL tool call (non-streaming): ${chunk.toolCall.name}`, 'color: #ff0000; font-weight: bold')

  if (!isValidToolName(chunk.toolCall.name)) return
  if (state.toolCalls.find(tc => tc.id === chunk.toolCall!.id)) return

  state.toolCalls.push(chunk.toolCall)
  if (currentAssistantId) {
    store.addToolCallPart(currentAssistantId, {
      id: chunk.toolCall.id,
      name: chunk.toolCall.name,
      arguments: chunk.toolCall.arguments,
    })
  }
}

/**
 * 处理非流式工具调用事件
 */
export function handleLLMToolCall(
  toolCall: LLMToolCall,
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (!isValidToolName(toolCall.name)) return
  if (state.toolCalls.find(tc => tc.id === toolCall.id)) return

  const store = useAgentStore.getState()
  state.toolCalls.push(toolCall)

  if (currentAssistantId) {
    store.addToolCallPart(currentAssistantId, {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    })
  }
}

/**
 * 处理 LLM 完成事件
 * 返回内容、工具调用和 token 使用统计
 * 注意：reasoning 已经作为 part 存储，不再单独返回
 */
export function handleLLMDone(
  result: { content?: string; toolCalls?: LLMToolCall[]; reasoning?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } },
  state: StreamHandlerState,
  currentAssistantId: string | null
): { content: string; toolCalls: LLMToolCall[]; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } } {
  closeReasoningIfNeeded(state, currentAssistantId)

  // 合并结果中的工具调用
  if (result.toolCalls) {
    for (const tc of result.toolCalls) {
      if (!state.toolCalls.find(t => t.id === tc.id)) {
        state.toolCalls.push(tc)
      }
    }
  }

  // 解析 XML 格式的工具调用
  let finalContent = state.content || result.content || ''
  if (finalContent) {
    const xmlToolCalls = parseXMLToolCalls(finalContent)
    if (xmlToolCalls.length > 0) {
      finalContent = removeXMLToolCallsFromContent(finalContent)

      const store = useAgentStore.getState()
      for (const tc of xmlToolCalls) {
        const existing = state.toolCalls.find(
          t => t.name === tc.name && JSON.stringify(t.arguments) === JSON.stringify(tc.arguments)
        )
        if (!existing) {
          state.toolCalls.push(tc)
          if (currentAssistantId) {
            store.addToolCallPart(currentAssistantId, {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            })
          }
        }
      }
    }
  }

  return {
    content: finalContent,
    toolCalls: state.toolCalls,
    usage: result.usage,
  }
}

/**
 * 检测流式 XML 工具调用
 */
export function detectStreamingXMLToolCalls(
  state: StreamHandlerState,
  currentAssistantId: string | null
): void {
  if (!currentAssistantId) return

  const store = useAgentStore.getState()
  const content = state.contentBuffer

  // 寻找最后一个 <function> 标签
  const funcStartRegex = /<function[=\s]+["']?([^"'>\s]+)["']?\s*>/gi
  let match
  let lastFunc: { name: string; index: number; fullMatch: string } | null = null

  while ((match = funcStartRegex.exec(content)) !== null) {
    lastFunc = {
      name: match[1],
      index: match.index,
      fullMatch: match[0],
    }
  }

  if (!lastFunc) return

  const remainingContent = content.slice(lastFunc.index + lastFunc.fullMatch.length)
  const isClosed = remainingContent.includes('</function>')

  // 提取参数
  const args: Record<string, unknown> = {}
  const paramRegex = /<parameter[=\s]+["']?([^"'>\s]+)["']?\s*>([\s\S]*?)(?:<\/parameter>|$)/gi
  let paramMatch
  while ((paramMatch = paramRegex.exec(remainingContent)) !== null) {
    const paramName = paramMatch[1]
    let paramValue: string | Record<string, unknown> = paramMatch[2].trim()

    if (paramValue.startsWith('{') || paramValue.startsWith('[')) {
      const parsed = parsePartialArgs(paramValue)
      if (parsed && Object.keys(parsed).length > 0) {
        paramValue = parsed
      }
    }

    args[paramName] = paramValue
  }

  const streamingId = `stream-xml-${lastFunc.name}-${lastFunc.index}`

  if (!state.activeStreamingToolCalls.has(streamingId)) {
    state.activeStreamingToolCalls.add(streamingId)
    store.addToolCallPart(currentAssistantId, {
      id: streamingId,
      name: lastFunc.name,
      arguments: { ...args, _streaming: true },
    })
  } else {
    store.updateToolCall(currentAssistantId, streamingId, {
      arguments: { ...args, _streaming: !isClosed },
    })
  }

  // 当工具调用完成时，立即加入 toolCalls 数组（避免等到 LLM done）
  if (isClosed && !state.completedXMLToolCalls.has(streamingId)) {
    state.completedXMLToolCalls.add(streamingId)

    // 移除 _streaming 标记
    const finalArgs = { ...args }
    delete (finalArgs as any)._streaming

    // 加入 toolCalls 数组
    state.toolCalls.push({
      id: streamingId,
      name: lastFunc.name,
      arguments: finalArgs,
    })

    // 更新 UI 状态为 pending
    store.updateToolCall(currentAssistantId, streamingId, {
      arguments: finalArgs,
      status: 'pending',
    })

    logger.agent.debug(`[XMLStreamParser] Tool call completed early: ${lastFunc.name} (${streamingId})`)
  }
}
