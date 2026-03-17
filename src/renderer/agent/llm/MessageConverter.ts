/**
 * 消息转换器
 * 将内部消息格式转换为 LLM API 格式
 */

import { ChatMessage, isUserMessage, isAssistantMessage, isToolResultMessage, ToolResultMessage } from '../types'
import { logger } from '@shared/utils/Logger'
import type { LLMMessage } from '@/shared/types'

/**
 * 从 ChatMessage[] 构建 LLM API 消息
 */
export function buildLLMApiMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): LLMMessage[] {
  const result: LLMMessage[] = []

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
      // 验证用户消息内容
      if (msg.content === undefined || msg.content === null) {
        logger.agent.warn('[MessageConverter] Skipping user message with invalid content:', { messageId: msg.id })
        continue
      }
      result.push({
        role: 'user',
        content: msg.content,
      })
    } else if (isAssistantMessage(msg)) {
      // 从 parts 中提取 toolCalls（如果 toolCalls 字段为空）
      let toolCalls = msg.toolCalls || []
      if (toolCalls.length === 0 && msg.parts) {
        toolCalls = msg.parts
          .filter((p): p is import('../types').ToolCallPart => p.type === 'tool_call')
          .map(p => p.toolCall)
      }

      const validToolCalls = toolCalls.filter(tc => toolResultMap.has(tc.id))

      if (validToolCalls.length > 0) {
        const assistantMsg: LLMMessage = {
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
        }
        if (msg.reasoning) assistantMsg.reasoning_content = msg.reasoning
        result.push(assistantMsg)

        for (const tc of validToolCalls) {
          const toolResult = toolResultMap.get(tc.id)!
          if (isToolResultMessage(toolResult)) {
            // 处理压缩的工具结果
            const content = (toolResult as ToolResultMessage).compactedAt
              ? '[Old tool result content cleared]'
              : toolResult.content
            result.push({
              role: 'tool',
              content,
              tool_call_id: tc.id,
              name: toolResult.name,
            })
          }
        }
      } else if (msg.content) {
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: msg.content,
        }
        if (msg.reasoning) assistantMsg.reasoning_content = msg.reasoning
        result.push(assistantMsg)
      }
    }
    // 注意：isToolResultMessage 在 for 循环中被静默跳过
    // 孤立的工具结果消息会在上下文压缩后出现，这里不需要处理
  }

  return result
}

/**
 * 验证消息序列是否符合 LLM API 要求
 */
export function validateLLMMessages(messages: LLMMessage[]): { valid: boolean; error?: string } {
  if (messages.length === 0) {
    return { valid: false, error: 'No messages' }
  }

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
