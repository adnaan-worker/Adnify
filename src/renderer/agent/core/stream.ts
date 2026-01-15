/**
 * 流式处理模块
 * 
 * 职责：
 * - 处理 LLM 流式响应
 * - 解析文本、推理、工具调用
 * - 发布事件到 EventBus
 */

import { api } from '@/renderer/services/electronAPI'
import { useAgentStore } from '../store/AgentStore'
import { parseXMLToolCalls } from '../utils/XMLToolParser'
import { EventBus } from './EventBus'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMCallResult } from './types'

// 解析部分 JSON 参数，提取已完成的字段
function parsePartialJsonArgs(argsString: string): Record<string, unknown> | null {
  if (!argsString) return null
  
  try {
    // 尝试直接解析完整 JSON
    return JSON.parse(argsString)
  } catch {
    // 尝试提取已完成的字段
    const result: Record<string, unknown> = {}
    
    // 匹配简单字符串字段（如 "path": "xxx"）
    // 使用更宽松的正则，支持转义字符
    const stringFieldRegex = /"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g
    let match
    while ((match = stringFieldRegex.exec(argsString)) !== null) {
      try {
        // 使用 JSON.parse 来正确处理转义字符
        result[match[1]] = JSON.parse(`"${match[2]}"`)
      } catch {
        // 如果解析失败，使用原始值
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

  // 工具调用流式状态 - 使用 Map 支持多个并行工具调用
  const streamingToolCalls = new Map<string, { id: string; name: string; argsString: string }>()

  // 清理函数列表
  const cleanups: (() => void)[] = []

  const cleanup = () => {
    for (const fn of cleanups) {
      try { fn() } catch {}
    }
    cleanups.length = 0
  }

  // 处理流式数据
  const handleStream = (data: {
    type: string
    content?: string
    reasoning?: string
    toolCall?: unknown
    toolCallDelta?: { id?: string; name?: string; args?: string }
    usage?: unknown
  }) => {
    switch (data.type) {
      case 'text':
      case 'content':
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
            if (!toolCalls.find(t => t.id === tc.id)) {
              const toolCall: ToolCall = { ...tc, status: 'pending' }
              toolCalls.push(toolCall)
              if (assistantId) {
                store.addToolCallPart(assistantId, toolCall)
              }
              EventBus.emit({ type: 'stream:tool_end', id: tc.id, args: tc.arguments })
            }
          }
        }
        break

      case 'reasoning': {
        // 后端发送的是 { type: 'reasoning', content: xxx }
        const reasoningContent = data.content || data.reasoning
        if (reasoningContent) {
          if (!isInReasoning) {
            isInReasoning = true
            if (assistantId) {
              // 创建 ReasoningPart 并获取 partId
              reasoningPartId = store.addReasoningPart(assistantId)
              store.updateMessage(assistantId, { 
                reasoningStartTime: Date.now() 
              } as Partial<import('../types').AssistantMessage>)
            }
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'start' })
          }
          reasoning += reasoningContent
          if (assistantId && reasoningPartId) {
            // 更新 ReasoningPart 内容
            store.updateReasoningPart(assistantId, reasoningPartId, reasoningContent, true)
            store.updateMessage(assistantId, { 
              reasoning 
            } as Partial<import('../types').AssistantMessage>)
          }
          EventBus.emit({ type: 'stream:reasoning', text: reasoningContent, phase: 'delta' })
        }
        break
      }

      case 'tool_call_start':
        if (data.toolCallDelta) {
          // 收到工具调用时，结束 reasoning 状态
          if (isInReasoning && assistantId && reasoningPartId) {
            store.finalizeReasoningPart(assistantId, reasoningPartId)
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
            isInReasoning = false
          }
          
          const toolId = data.toolCallDelta.id || `tool-${Date.now()}`
          const toolName = data.toolCallDelta.name || ''
          streamingToolCalls.set(toolId, { id: toolId, name: toolName, argsString: '' })
          
          // 立即添加到 UI
          if (assistantId) {
            store.addToolCallPart(assistantId, {
              id: toolId,
              name: toolName || '...',
              arguments: { _streaming: true },
            })
          }
          EventBus.emit({ type: 'stream:tool_start', id: toolId, name: toolName })
        }
        break

      case 'tool_call_delta':
        if (data.toolCallDelta?.id) {
          const tc = streamingToolCalls.get(data.toolCallDelta.id)
          if (tc) {
            if (data.toolCallDelta.args) {
              tc.argsString += data.toolCallDelta.args
              // 尝试解析参数并更新 UI（提取 path 等关键字段）
              if (assistantId) {
                const partialArgs = parsePartialJsonArgs(tc.argsString)
                if (partialArgs && Object.keys(partialArgs).length > 0) {
                  store.updateToolCall(assistantId, tc.id, {
                    arguments: { ...partialArgs, _streaming: true },
                  })
                }
              }
            }
            if (data.toolCallDelta.name && data.toolCallDelta.name !== tc.name) {
              tc.name = data.toolCallDelta.name
              if (assistantId) {
                store.updateToolCall(assistantId, tc.id, { name: data.toolCallDelta.name })
              }
            }
            EventBus.emit({ type: 'stream:tool_delta', id: tc.id, args: tc.argsString })
          }
        }
        break

      case 'tool_call_end':
        // 优先处理 data.toolCall（完整工具调用，包含正确的 name）
        if (data.toolCall) {
          const tc = data.toolCall as ToolCall
          // 清除流式状态
          streamingToolCalls.delete(tc.id)
          
          // 检查是否已存在于本地数组
          if (!toolCalls.find(t => t.id === tc.id)) {
            toolCalls.push({ ...tc, status: 'pending' })
          }
          
          // 更新 UI - 直接使用 updateToolCall，它会处理不存在的情况
          if (assistantId) {
            store.updateToolCall(assistantId, tc.id, {
              name: tc.name,
              arguments: tc.arguments,
              status: 'pending',
            })
          }
          EventBus.emit({ type: 'stream:tool_end', id: tc.id, args: tc.arguments })
        }
        break

      case 'usage':
        if (data.usage) {
          usage = data.usage as TokenUsage
        }
        break
    }
  }

  // 处理工具调用（通过 onToolCall 回调发送的完整工具调用）
  const handleToolCall = (tc: unknown) => {
    const toolCall = tc as ToolCall
    // 检查是否已存在于本地数组
    if (!toolCalls.find(t => t.id === toolCall.id)) {
      toolCalls.push(toolCall)
    }
    // 更新 UI - 直接使用 updateToolCall
    if (assistantId) {
      store.updateToolCall(assistantId, toolCall.id, {
        name: toolCall.name,
        arguments: toolCall.arguments,
        status: 'pending',
      })
    }
    EventBus.emit({ type: 'stream:tool_end', id: toolCall.id, args: toolCall.arguments })
  }

  // 订阅 IPC 事件
  const unsubStream = api.llm.onStream(handleStream)
  const unsubToolCall = api.llm.onToolCall(handleToolCall)
  const unsubError = api.llm.onError((err: string) => { error = err })

  cleanups.push(unsubStream, unsubToolCall, unsubError)

  // 等待完成
  const wait = (): Promise<LLMCallResult> => {
    return new Promise((resolve) => {
      let resolved = false
      
      const doResolve = (result: LLMCallResult) => {
        if (resolved) return
        resolved = true
        cleanup()
        resolve(result)
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

      // 处理错误事件 - 立即 resolve
      const handleError = (err: { message?: string; code?: string } | string) => {
        const errorMsg = typeof err === 'string' ? err : (err.message || 'Unknown error')
        finalizeReasoning()
        EventBus.emit({ type: 'llm:error', error: errorMsg })
        doResolve({ content, toolCalls, usage, error: errorMsg })
      }
      
      // 替换原来的错误处理
      const errorCleanupIdx = cleanups.findIndex(fn => fn === unsubError)
      if (errorCleanupIdx !== -1) {
        cleanups.splice(errorCleanupIdx, 1)
        unsubError()
      }
      const unsubErrorNew = api.llm.onError(handleError)
      cleanups.push(unsubErrorNew)

      const unsubDone = api.llm.onDone((result: { usage?: unknown }) => {
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
      })
      cleanups.push(unsubDone)
    })
  }

  EventBus.emit({ type: 'llm:start' })

  return { wait, cleanup }
}
