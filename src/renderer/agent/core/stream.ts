/**
 * 流式处理模块
 *
 * 职责：
 * - 处理 LLM 流式响应（AI SDK 事件格式）
 * - 解析文本、推理、工具调用
 * - 发布事件到 EventBus
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { parseXMLToolCalls } from '../utils/XMLToolParser'
import { EventBus } from './EventBus'
import { getErrorMessage, ErrorCode } from '@shared/utils/errorHandler'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMCallResult } from './types'

// 全局监听器计数器（用于调试内存泄漏）
let activeListenerCount = 0

export function getActiveListenerCount(): number {
  return activeListenerCount
}

// 解析部分 JSON 参数，提取已完成的字段
function parsePartialJsonArgs(argsString: string): Record<string, unknown> | null {
  if (!argsString) return null

  try {
    return JSON.parse(argsString)
  } catch {
    const result: Record<string, unknown> = {}

    // 匹配简单字符串字段
    const stringFieldRegex = /"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g
    let match
    while ((match = stringFieldRegex.exec(argsString)) !== null) {
      try {
        result[match[1]] = JSON.parse(`"${match[2]}"`)
      } catch {
        result[match[1]] = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
    }

    // 匹配布尔值字段
    const boolFieldRegex = /"(\w+)":\s*(true|false)/g
    while ((match = boolFieldRegex.exec(argsString)) !== null) {
      result[match[1]] = match[2] === 'true'
    }

    // 匹配数字字段
    const numFieldRegex = /"(\w+)":\s*(-?\d+(?:\.\d+)?)/g
    while ((match = numFieldRegex.exec(argsString)) !== null) {
      result[match[1]] = parseFloat(match[2])
    }

    return Object.keys(result).length > 0 ? result : null
  }
}

// ===== 流式处理器 =====

export interface StreamProcessor {
  wait: () => Promise<LLMCallResult>
  cleanup: () => void
}

export function createStreamProcessor(assistantId: string | null): StreamProcessor {
  const store = useAgentStore.getState()

  let content = ''
  let reasoning = ''
  let isInReasoning = false
  let reasoningPartId: string | null = null
  let toolCalls: ToolCall[] = []
  let usage: TokenUsage | undefined
  let error: string | undefined
  let isCleanedUp = false

  // 工具调用流式状态
  const streamingToolCalls = new Map<string, { id: string; name: string; argsString: string; lastUpdateTime: number }>()
  
  // 节流：工具参数更新（避免过于频繁的状态更新）
  const TOOL_UPDATE_THROTTLE_MS = 50 // 每 50ms 最多更新一次

  // 清理函数列表
  const cleanups: (() => void)[] = []

  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true
    
    for (const fn of cleanups) {
      try {
        fn()
        activeListenerCount--
      } catch (err) {
        logger.agent.error('[StreamProcessor] Cleanup error:', err)
      }
    }
    cleanups.length = 0
    logger.agent.info('[StreamProcessor] Active listeners remaining:', activeListenerCount)
  }

  // 处理流式数据（AI SDK 格式）
  const handleStream = (data: {
    type: string
    content?: string
    id?: string
    name?: string
    arguments?: unknown
    argumentsDelta?: string
    usage?: unknown
  }) => {
    switch (data.type) {
      case 'text':
        if (data.content) {
          // 收到文本内容时，结束 reasoning 状态
          if (isInReasoning && assistantId && reasoningPartId) {
            store.finalizeReasoningPart(assistantId, reasoningPartId)
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
            isInReasoning = false
          }

          content += data.content
          if (assistantId) {
            store.appendToAssistant(assistantId, data.content)
          }
          EventBus.emit({ type: 'stream:text', text: data.content })

          // 检测 XML 工具调用
          const detected = parseXMLToolCalls(content)
          for (const tc of detected) {
            if (!toolCalls.find((t) => t.id === tc.id)) {
              const toolCall: ToolCall = { ...tc, status: 'pending' }
              toolCalls.push(toolCall)
              if (assistantId) {
                store.addToolCallPart(assistantId, toolCall)
              }
              EventBus.emit({ type: 'stream:tool_available', id: tc.id, name: tc.name, args: tc.arguments })
            }
          }
        }
        break

      case 'reasoning': {
        const reasoningContent = data.content
        if (reasoningContent) {
          if (!isInReasoning) {
            isInReasoning = true
            if (assistantId) {
              reasoningPartId = store.addReasoningPart(assistantId)
              store.updateMessage(assistantId, {
                reasoningStartTime: Date.now(),
              } as Partial<import('../types').AssistantMessage>)
            }
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'start' })
          }
          reasoning += reasoningContent
          if (assistantId && reasoningPartId) {
            store.updateReasoningPart(assistantId, reasoningPartId, reasoningContent, true)
            store.updateMessage(assistantId, {
              reasoning,
            } as Partial<import('../types').AssistantMessage>)
          }
          EventBus.emit({ type: 'stream:reasoning', text: reasoningContent, phase: 'delta' })
        }
        break
      }

      case 'tool_call_start': {
        const toolId = data.id || `tool-${Date.now()}`
        const toolName = data.name || '...'

        // 收到工具调用时，结束 reasoning 状态
        if (isInReasoning && assistantId && reasoningPartId) {
          store.finalizeReasoningPart(assistantId, reasoningPartId)
          EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
          isInReasoning = false
        }

        streamingToolCalls.set(toolId, { id: toolId, name: toolName, argsString: '', lastUpdateTime: 0 })

        // 立即添加到 UI（使用 streamingState 而非污染 arguments）
        if (assistantId) {
          store.addToolCallPart(assistantId, {
            id: toolId,
            name: toolName,
            arguments: {},
            streamingState: {
              isStreaming: true,
              partialArgs: {},
            },
          })
        }
        EventBus.emit({ type: 'stream:tool_start', id: toolId, name: toolName })
        break
      }

      case 'tool_call_delta': {
        const tcId = data.id
        const argsDelta = data.argumentsDelta

        if (tcId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            if (argsDelta) {
              tc.argsString += argsDelta
              
              // 节流更新：第一次立即更新，后续根据时间间隔节流
              if (assistantId) {
                const now = Date.now()
                const timeSinceLastUpdate = now - tc.lastUpdateTime
                
                // 第一次更新（lastUpdateTime === 0）或距离上次更新超过阈值时，立即更新
                if (tc.lastUpdateTime === 0 || timeSinceLastUpdate >= TOOL_UPDATE_THROTTLE_MS) {
                  tc.lastUpdateTime = now
                  const partialArgs = parsePartialJsonArgs(tc.argsString)
                  if (partialArgs && Object.keys(partialArgs).length > 0) {
                    store.updateToolCall(assistantId, tc.id, {
                      streamingState: {
                        isStreaming: true,
                        partialArgs,
                        lastUpdateTime: now,
                      },
                    })
                  }
                }
                // 否则跳过此次更新（节流）
              }
            }
            if (data.name && data.name !== tc.name) {
              tc.name = data.name
              if (assistantId) {
                store.updateToolCall(assistantId, tc.id, { name: data.name })
              }
            }
            EventBus.emit({ type: 'stream:tool_delta', id: tc.id, args: tc.argsString })
          }
        }
        break
      }

      case 'tool_call_delta_end': {
        const tcId = data.id
        if (tcId && assistantId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            // 参数传输完成，立即解析并更新最终参数（清除 streamingState）
            const finalArgs = parsePartialJsonArgs(tc.argsString)
            if (finalArgs) {
              store.updateToolCall(assistantId, tc.id, {
                arguments: finalArgs,
                streamingState: undefined,  // 清除流式状态
              })
            }
            
            // 添加到 toolCalls 数组（用于返回给 loop.ts）
            const toolCall: ToolCall = {
              id: tc.id,
              name: tc.name,
              arguments: finalArgs || {},
              status: 'pending',
            }
            
            // 检查是否已存在（避免重复）
            if (!toolCalls.find(t => t.id === tc.id)) {
              toolCalls.push(toolCall)
            }
          }
        }
        break
      }

      case 'tool_call_available': {
        const tcId = data.id || ''
        const toolName = data.name || ''
        const args = data.arguments as Record<string, unknown>

        // 清除流式状态
        if (tcId) {
          streamingToolCalls.delete(tcId)
        }

        // 添加到 toolCalls 数组（用于返回给 loop.ts）
        const toolCall: ToolCall = {
          id: tcId,
          name: toolName,
          arguments: args,
          status: 'pending',
        }
        
        // 检查是否已存在（避免重复）
        if (!toolCalls.find(tc => tc.id === tcId)) {
          toolCalls.push(toolCall)
        }

        // 更新为最终参数（清除 streamingState）
        if (assistantId && tcId) {
          store.updateToolCall(assistantId, tcId, {
            name: toolName,
            arguments: args,
            status: 'pending',
            streamingState: undefined,  // 清除流式状态
          })
        }

        EventBus.emit({ type: 'stream:tool_available', id: tcId, name: toolName, args })
        break
      }

      case 'usage':
        if (data.usage) {
          usage = data.usage as TokenUsage
        }
        break
    }
  }

  // 结束推理的辅助函数
  const finalizeReasoning = () => {
    if (isInReasoning) {
      if (assistantId && reasoningPartId) {
        store.finalizeReasoningPart(assistantId, reasoningPartId)
      }
      EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
      isInReasoning = false
    }
  }

  // Promise resolve 函数（在外部定义，避免在 Promise 内部创建监听器）
  let resolveWait: ((result: LLMCallResult) => void) | null = null
  let isResolved = false

  // 立即创建 Promise，避免竞态条件
  // 这确保即使 done 事件在 wait() 被调用之前到达，也能正确 resolve
  const waitPromise = new Promise<LLMCallResult>((resolve) => {
    resolveWait = resolve
  })

  const doResolve = (result: LLMCallResult) => {
    if (isResolved) return
    isResolved = true
    
    // 先 resolve Promise，再 cleanup
    if (resolveWait) {
      resolveWait(result)
    }
    
    // cleanup 放在最后
    cleanup()
  }

  // 处理错误事件
  const handleError = (err: { message?: string; code?: string } | string) => {
    let errorMsg: string
    
    if (typeof err === 'string') {
      errorMsg = err
    } else {
      // 如果有错误码，使用国际化消息
      if (err.code && err.code in ErrorCode) {
        const language = useStore.getState().language
        errorMsg = getErrorMessage(err.code as ErrorCode, language)
      } else {
        errorMsg = err.message || 'Unknown error'
      }
    }
    
    logger.agent.error('[StreamProcessor] Error:', errorMsg)
    error = errorMsg
    finalizeReasoning()
    EventBus.emit({ type: 'llm:error', error: errorMsg })
    doResolve({ content, toolCalls, usage, error: errorMsg })
  }

  // 处理完成事件
  const handleDone = (result: { usage?: unknown }) => {
    if (result?.usage) {
      usage = result.usage as TokenUsage
    }
    finalizeReasoning()

    if (error) {
      EventBus.emit({ type: 'llm:error', error })
    } else {
      EventBus.emit({ type: 'llm:done', content, toolCalls, usage })
    }
    doResolve({ content, toolCalls, usage, error })
  }

  // 一次性订阅所有 IPC 事件（在 Promise 外部）
  const unsubStream = api.llm.onStream(handleStream)
  const unsubError = api.llm.onError(handleError)
  const unsubDone = api.llm.onDone(handleDone)

  cleanups.push(unsubStream, unsubError, unsubDone)
  activeListenerCount += 3

  // 等待完成 - 返回已创建的 Promise
  const wait = (): Promise<LLMCallResult> => waitPromise

  EventBus.emit({ type: 'llm:start' })

  return { wait, cleanup }
}
