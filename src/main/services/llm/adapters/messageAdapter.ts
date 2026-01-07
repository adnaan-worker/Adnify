/**
 * 消息格式适配器
 * 
 * 将统一的 LLMMessage 格式转换为各协议的消息格式
 */

import type { LLMMessage, MessageContent } from '@/shared/types'
import type { LLMAdapterConfig, ApiProtocol, VisionConfig, ImageFormatConfig } from '@/shared/config/providers'
import { OPENAI_IMAGE_FORMAT, ANTHROPIC_IMAGE_FORMAT } from '@/shared/config/providers'
import type { OpenAIMessage, AnthropicMessage, AnthropicContentBlock, ConvertedRequest } from './types'

/**
 * 消息适配器
 */
export class MessageAdapter {
  /**
   * 转换消息为目标协议格式
   */
  static convert(
    messages: LLMMessage[],
    systemPrompt: string | undefined,
    protocol: ApiProtocol,
    config?: LLMAdapterConfig,
    visionConfig?: VisionConfig
  ): ConvertedRequest {
    switch (protocol) {
      case 'anthropic':
        return this.convertToAnthropic(messages, systemPrompt, visionConfig)
      case 'custom':
        return this.convertToCustom(messages, systemPrompt, config, visionConfig)
      case 'openai':
      case 'gemini':
      default:
        return this.convertToOpenAI(messages, systemPrompt, config, visionConfig)
    }
  }

  /**
   * 转换为 OpenAI 格式
   */
  private static convertToOpenAI(
    messages: LLMMessage[],
    systemPrompt: string | undefined,
    config?: LLMAdapterConfig,
    visionConfig?: VisionConfig
  ): ConvertedRequest {
    const result: OpenAIMessage[] = []
    const supportsVision = visionConfig?.enabled !== false
    const imageFormat = visionConfig?.imageFormat || OPENAI_IMAGE_FORMAT

    // 系统消息处理
    const systemMode = config?.messageFormat?.systemMessageMode || 'message'
    const pendingSystemContent = this.collectSystemContent(messages, systemPrompt)

    if (pendingSystemContent && systemMode === 'message') {
      result.push({ role: 'system', content: pendingSystemContent })
    }

    // 转换消息
    let firstUserProcessed = false
    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'user') {
        const converted = supportsVision
          ? this.convertContent(msg.content, imageFormat) as OpenAIMessage['content']
          : this.extractTextContent(msg.content)

        let content = converted
        if (systemMode === 'first-user' && pendingSystemContent && !firstUserProcessed && typeof converted === 'string') {
          content = `${pendingSystemContent}\n\n${converted}`
          firstUserProcessed = true
        }

        result.push({ role: 'user', content })
      } else if (msg.role === 'assistant') {
        result.push(this.convertAssistantMessage(msg))
      } else if (msg.role === 'tool') {
        const toolCallId = msg.tool_call_id || msg.toolCallId
        if (toolCallId) {
          result.push({
            role: 'tool',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            tool_call_id: toolCallId,
          })
        }
      }
    }

    return {
      messages: result,
      systemPrompt: systemMode === 'parameter' ? pendingSystemContent : undefined,
    }
  }

  /**
   * 转换为自定义协议格式
   */
  private static convertToCustom(
    messages: LLMMessage[],
    systemPrompt: string | undefined,
    config?: LLMAdapterConfig,
    visionConfig?: VisionConfig
  ): ConvertedRequest {
    const messageFormat = config?.messageFormat
    const supportsVision = visionConfig?.enabled === true // 自定义协议默认不支持
    const imageFormat = visionConfig?.imageFormat || OPENAI_IMAGE_FORMAT
    const result: Array<Record<string, unknown>> = []

    // 系统消息处理
    const systemMode = messageFormat?.systemMessageMode || 'message'
    const pendingSystemContent = this.collectSystemContent(messages, systemPrompt)

    if (pendingSystemContent && systemMode === 'message') {
      result.push({ role: 'system', content: pendingSystemContent })
    }

    // 工具结果配置
    const toolResultRole = messageFormat?.toolResultRole || 'tool'
    const toolResultIdField = messageFormat?.toolResultIdField || 'tool_call_id'
    const toolResultWrapper = messageFormat?.toolResultWrapper

    // 转换消息
    let firstUserProcessed = false
    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'user') {
        let content = supportsVision
          ? this.convertContent(msg.content, imageFormat)
          : this.extractTextContent(msg.content)

        if (systemMode === 'first-user' && pendingSystemContent && !firstUserProcessed && typeof content === 'string') {
          content = `${pendingSystemContent}\n\n${content}`
          firstUserProcessed = true
        }

        result.push({ role: 'user', content })
      } else if (msg.role === 'assistant') {
        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: this.extractTextContent(msg.content),
        }

        if (msg.tool_calls?.length) {
          const toolCallField = messageFormat?.assistantToolCallField || 'tool_calls'
          assistantMsg[toolCallField] = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }))
        }

        result.push(assistantMsg)
      } else if (msg.role === 'tool') {
        result.push(this.convertToolMessage(msg, toolResultRole, toolResultIdField, toolResultWrapper))
      }
    }

    return {
      messages: result,
      systemPrompt: systemMode === 'parameter' ? pendingSystemContent : undefined,
    }
  }

  /**
   * 转换为 Anthropic 格式
   */
  private static convertToAnthropic(
    messages: LLMMessage[],
    systemPrompt: string | undefined,
    visionConfig?: VisionConfig
  ): ConvertedRequest {
    const result: AnthropicMessage[] = []
    const supportsVision = visionConfig?.enabled !== false
    const systemContent = this.collectSystemContent(messages, systemPrompt)

    for (const msg of messages) {
      if (msg.role === 'system') continue

      if (msg.role === 'user') {
        const content = supportsVision
          ? this.convertContent(msg.content, ANTHROPIC_IMAGE_FORMAT) as string | AnthropicContentBlock[]
          : this.extractTextContent(msg.content)
        result.push({ role: 'user', content })
      } else if (msg.role === 'assistant') {
        const contentBlocks = this.convertAssistantToAnthropic(msg)
        if (contentBlocks.length > 0) {
          result.push({ role: 'assistant', content: contentBlocks })
        }
      } else if (msg.role === 'tool') {
        const toolCallId = msg.tool_call_id || msg.toolCallId
        if (toolCallId) {
          result.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolCallId,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            }],
          })
        }
      }
    }

    return {
      messages: result,
      systemPrompt: systemContent ? [{ type: 'text', text: systemContent }] : undefined,
    }
  }

  // ============================================
  // 通用辅助方法
  // ============================================

  /** 收集系统消息内容 */
  private static collectSystemContent(messages: LLMMessage[], systemPrompt?: string): string {
    let content = systemPrompt || ''
    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = this.extractTextContent(msg.content)
        content = content ? `${content}\n\n${text}` : text
      }
    }
    return content
  }

  /** 提取文本内容 */
  private static extractTextContent(content: MessageContent): string {
    if (typeof content === 'string') return content
    if (!content?.length) return ''
    return content
      .filter(p => p.type === 'text')
      .map(p => (p as { type: 'text'; text: string }).text)
      .join('')
  }

  /** 转换内容（支持自定义图片格式） */
  private static convertContent(
    content: MessageContent,
    imageFormat: ImageFormatConfig
  ): string | Array<Record<string, unknown>> {
    if (typeof content === 'string') return content
    if (!content?.length) return ''

    return content.map(part => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text ?? '' }
      }

      // 图片处理 - 直接使用完整模板
      const isBase64 = part.source.type === 'base64'
      const url = isBase64
        ? `data:${part.source.media_type};base64,${part.source.data}`
        : part.source.data

      const vars = {
        '{{url}}': url,
        '{{base64}}': isBase64 ? part.source.data : '',
        '{{mediaType}}': part.source.media_type || 'image/png',
      }

      return this.processTemplate(imageFormat.template, vars) as Record<string, unknown>
    })
  }

  /** 处理模板变量 */
  private static processTemplate(obj: unknown, vars: Record<string, string>): unknown {
    if (typeof obj === 'string') {
      return Object.entries(vars).reduce((s, [k, v]) => s.replace(k, v), obj)
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.processTemplate(item, vars))
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.processTemplate(value, vars)
      }
      return result
    }
    return obj
  }

  /** 转换助手消息（OpenAI 格式） */
  private static convertAssistantMessage(msg: LLMMessage): OpenAIMessage {
    const assistantMsg: OpenAIMessage = {
      role: 'assistant',
      content: this.extractTextContent(msg.content),
    }

    if (msg.tool_calls?.length) {
      assistantMsg.tool_calls = msg.tool_calls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }))
    }

    return assistantMsg
  }

  /** 转换助手消息为 Anthropic 格式 */
  private static convertAssistantToAnthropic(msg: LLMMessage): AnthropicContentBlock[] {
    const blocks: AnthropicContentBlock[] = []

    const textContent = this.extractTextContent(msg.content)
    if (textContent) {
      blocks.push({ type: 'text', text: textContent })
    }

    if (msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        let input: Record<string, unknown> = {}
        try { input = JSON.parse(tc.function.arguments || '{}') } catch { /* ignore */ }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
    }

    // 兼容旧格式
    if (msg.toolName && msg.toolCallId) {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(typeof msg.content === 'string' ? msg.content : '{}') } catch { /* ignore */ }
      blocks.push({ type: 'tool_use', id: msg.toolCallId, name: msg.toolName, input })
    }

    return blocks
  }

  /** 转换工具消息（自定义协议） */
  private static convertToolMessage(
    msg: LLMMessage,
    role: string,
    idField: string,
    wrapper?: string
  ): Record<string, unknown> {
    const toolCallId = msg.tool_call_id || msg.toolCallId
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)

    if (wrapper) {
      return { role, content: [{ type: wrapper, [idField]: toolCallId, content }] }
    }
    if (role === 'function') {
      return { role: 'function', name: msg.toolName || toolCallId, content }
    }
    return { role, content, [idField]: toolCallId }
  }
}
