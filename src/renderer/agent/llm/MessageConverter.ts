/**
 * 消息转换器
 * 将内部消息格式转换为 LLM API 格式（OpenAI 兼容）
 */

import { ChatMessage, isUserMessage, isAssistantMessage, isToolResultMessage, MessageContent } from '../types'

// ===== OpenAI 格式消息 =====

export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: MessageContent | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

/**
 * 从 ChatMessage[] 和 AssistantMessage 的 toolCalls 构建完整的 OpenAI 消息
 */
export function buildOpenAIMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  const toolResultMap = new Map<string, ChatMessage>()
  for (const msg of messages) {
    if (isToolResultMessage(msg) && msg.toolCallId) {
      toolResultMap.set(msg.toolCallId, msg)
    }
  }

  for (const msg of messages) {
    if (isUserMessage(msg)) {
      result.push({
        role: 'user',
        content: msg.content,
      })
    } else if (isAssistantMessage(msg)) {
      const validToolCalls = (msg.toolCalls || []).filter(tc => toolResultMap.has(tc.id))

      if (validToolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: validToolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments || {}),
            },
          })),
        })

        for (const tc of validToolCalls) {
          const toolResult = toolResultMap.get(tc.id)!
          if (isToolResultMessage(toolResult)) {
            result.push({
              role: 'tool',
              content: toolResult.content,
              tool_call_id: tc.id,
            })
          }
        }
      } else if (msg.content) {
        result.push({
          role: 'assistant',
          content: msg.content,
        })
      }
    }
  }

  return result
}

/**
 * 验证消息序列是否符合 OpenAI API 要求
 */
export function validateOpenAIMessages(messages: OpenAIMessage[]): { valid: boolean; error?: string } {
  if (messages.length === 0) {
    return { valid: false, error: 'No messages' }
  }

  // 注意：最后一条消息可以是普通 assistant 回复（无 tool_calls），这是有效的

  // 检查 tool 消息是否有对应的 tool_call
  const toolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolCallIds.add(tc.id)
      }
    }
  }

  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (!toolCallIds.has(msg.tool_call_id)) {
        return { valid: false, error: `Tool message has no matching tool_call: ${msg.tool_call_id}` }
      }
    }
  }

  return { valid: true }
}
