/**
 * 消息转换器
 * 参考 Void/Cursor 的架构，将内部消息格式转换为 LLM API 格式
 * 
 * 架构设计：
 * 1. 内部使用 SimpleLLMMessage 格式存储消息
 * 2. 发送给 LLM 前，根据 provider 类型转换为对应格式
 * 3. OpenAI 格式：assistant 消息带 tool_calls，后跟 tool 结果
 * 4. Anthropic 格式：assistant 消息带 tool_use，user 消息带 tool_result
 */

import { ChatMessage, isUserMessage, isAssistantMessage, isToolResultMessage, isToolCallPart } from './types'

// ===== 简化的 LLM 消息格式（内部使用）=====

export interface SimpleLLMMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  // tool 消息专用
  toolCallId?: string
  toolName?: string
  rawParams?: Record<string, unknown>
}

// ===== OpenAI 格式消息 =====

export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | null
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

// ===== 转换函数 =====

/**
 * 将 ChatMessage[] 转换为 SimpleLLMMessage[]
 * 过滤掉 checkpoint 等非对话消息
 */
export function chatMessagesToSimple(messages: ChatMessage[]): SimpleLLMMessage[] {
  const result: SimpleLLMMessage[] = []

  for (const msg of messages) {
    if (isUserMessage(msg)) {
      // 提取文本内容
      let content: string
      if (typeof msg.content === 'string') {
        content = msg.content
      } else {
        content = msg.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
      }
      result.push({ role: 'user', content })
    } else if (isAssistantMessage(msg)) {
      result.push({
        role: 'assistant',
        content: msg.content || '',
      })
      // 如果有 toolCalls，为每个 toolCall 添加占位（后面会被 tool 结果替换）
      // 这里不添加，因为 tool 结果会单独作为消息存储
    } else if (isToolResultMessage(msg)) {
      result.push({
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolName: msg.name,
        rawParams: {}, // 原始参数在 assistant 消息的 toolCalls 中
      })
    }
    // checkpoint 消息跳过
  }

  return result
}

/**
 * 将 SimpleLLMMessage[] 转换为 OpenAI API 格式
 * 
 * 关键逻辑（参考 Void）：
 * 遇到 tool 消息时，修改前一个 assistant 消息添加 tool_calls
 */
export function prepareMessagesForOpenAI(
  messages: SimpleLLMMessage[],
  systemPrompt?: string
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // 添加 system 消息
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  // 预处理：收集每个 assistant 消息后面的 tool 结果
  // 这样可以正确构建 tool_calls
  const toolResultsMap = new Map<number, SimpleLLMMessage[]>()
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'tool') {
      // 找到前面最近的 assistant 消息
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'assistant') {
          if (!toolResultsMap.has(j)) {
            toolResultsMap.set(j, [])
          }
          toolResultsMap.get(j)!.push(msg)
          break
        }
      }
    }
  }

  // 转换消息
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: msg.content || '(empty)',
      })
    } else if (msg.role === 'assistant') {
      const toolResults = toolResultsMap.get(i)
      
      if (toolResults && toolResults.length > 0) {
        // 有 tool 调用的 assistant 消息
        result.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: toolResults.map(tr => ({
            id: tr.toolCallId!,
            type: 'function' as const,
            function: {
              name: tr.toolName!,
              arguments: JSON.stringify(tr.rawParams || {}),
            },
          })),
        })
        
        // 紧跟 tool 结果消息
        for (const tr of toolResults) {
          result.push({
            role: 'tool',
            content: tr.content,
            tool_call_id: tr.toolCallId,
          })
        }
      } else {
        // 普通 assistant 消息
        result.push({
          role: 'assistant',
          content: msg.content || '(empty)',
        })
      }
    }
    // tool 消息已经在 assistant 处理时添加了，这里跳过
  }

  return result
}

/**
 * 从 ChatMessage[] 和 AssistantMessage 的 toolCalls 构建完整的 OpenAI 消息
 * 这个版本使用 assistant 消息中存储的 toolCalls 信息
 */
export function buildOpenAIMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []

  // 添加 system 消息
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }

  // 构建 toolCallId -> tool 结果的映射
  const toolResultMap = new Map<string, ChatMessage>()
  for (const msg of messages) {
    if (isToolResultMessage(msg) && msg.toolCallId) {
      toolResultMap.set(msg.toolCallId, msg)
    }
  }

  // 转换消息
  for (const msg of messages) {
    if (isUserMessage(msg)) {
      let content: string
      if (typeof msg.content === 'string') {
        content = msg.content
      } else {
        content = msg.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
      }
      result.push({
        role: 'user',
        content: content || '(empty)',
      })
    } else if (isAssistantMessage(msg)) {
      // 检查是否有 toolCalls 且有对应的 tool 结果
      const validToolCalls = (msg.toolCalls || []).filter(tc => toolResultMap.has(tc.id))

      if (validToolCalls.length > 0) {
        // 有 tool 调用的 assistant 消息
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

        // 紧跟 tool 结果消息
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
        // 普通 assistant 消息（无 tool 调用或 tool 调用没有结果）
        result.push({
          role: 'assistant',
          content: msg.content,
        })
      }
      // 如果既没有内容也没有有效的 tool 调用，跳过这条消息
    }
    // tool 消息已经在 assistant 处理时添加了，checkpoint 消息跳过
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

  // 检查最后一条消息
  const lastMsg = messages[messages.length - 1]
  if (lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
    return { valid: false, error: 'Last message cannot be assistant without tool_calls' }
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
