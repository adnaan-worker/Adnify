/**
 * OpenAI Provider
 * 支持 OpenAI API 及兼容的第三方 API
 */

import OpenAI from 'openai'
import { BaseProvider } from './base'
import { ChatParams, ToolDefinition, ToolCall, MessageContent } from '../types'
import { adapterService } from '../adapterService'

export class OpenAIProvider extends BaseProvider {
  private client: OpenAI

  constructor(apiKey: string, baseUrl?: string, timeout?: number) {
    super('OpenAI')
    const timeoutMs = timeout || 120000
    this.log('info', 'Initializing', { baseUrl: baseUrl || 'default', timeout: timeoutMs })
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      timeout: timeoutMs,
      maxRetries: 0,
    })
  }

  private convertContent(
    content: MessageContent
  ): string | Array<OpenAI.Chat.Completions.ChatCompletionContentPart> {
    if (typeof content === 'string') return content
    return content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text }
      } else {
        const url =
          part.source.type === 'base64'
            ? `data:${part.source.media_type};base64,${part.source.data}`
            : part.source.data
        return { type: 'image_url', image_url: { url } }
      }
    })
  }

  private convertTools(tools?: ToolDefinition[], adapterId?: string): unknown[] | undefined {
    if (!tools?.length) return undefined
    // 使用适配器服务根据 adapterId 转换工具定义
    // 如果没有指定 adapterId，使用默认的 OpenAI 格式
    return adapterService.convertTools(tools, adapterId || 'openai')
  }

  async chat(params: ChatParams): Promise<void> {
    const {
      model,
      messages,
      tools,
      systemPrompt,
      maxTokens,
      signal,
      adapterConfig,
      onStream,
      onToolCall,
      onComplete,
      onError,
    } = params

    try {
      this.log('info', 'Starting chat', { model, messageCount: messages.length })

      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = []

      if (systemPrompt) {
        openaiMessages.push({ role: 'system', content: systemPrompt })
      }

      for (const msg of messages) {
        if (msg.role === 'user') {
          openaiMessages.push({
            role: 'user',
            content: this.convertContent(msg.content),
          })
        } else if (msg.role === 'assistant') {
          let assistantContent: string | null = null
          if (typeof msg.content === 'string') {
            assistantContent = msg.content
          } else if (Array.isArray(msg.content)) {
            assistantContent = msg.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
          }

          if (msg.tool_calls && msg.tool_calls.length > 0) {
            openaiMessages.push({
              role: 'assistant',
              content: assistantContent,
              tool_calls: msg.tool_calls,
            })
          } else {
            openaiMessages.push({
              role: 'assistant',
              content: assistantContent || '',
            })
          }
        } else if (msg.role === 'tool') {
          const toolCallId = msg.tool_call_id || msg.toolCallId
          if (!toolCallId) {
            this.log('warn', 'Tool message missing toolCallId, skipping')
            continue
          }
          openaiMessages.push({
            role: 'tool',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            tool_call_id: toolCallId,
          })
        } else if (msg.role === 'system') {
          openaiMessages.push({
            role: 'system',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          })
        }
      }

      const convertedTools = this.convertTools(tools, adapterConfig?.id)

      // 构建请求体 - bodyTemplate 优先
      let requestBody: Record<string, unknown>

      if (adapterConfig?.request?.bodyTemplate) {
        // 使用 bodyTemplate 作为基础
        requestBody = JSON.parse(JSON.stringify(adapterConfig.request.bodyTemplate))

        // 替换占位符
        for (const [key, value] of Object.entries(requestBody)) {
          if (value === '{{model}}') requestBody[key] = model
          else if (value === '{{messages}}') requestBody[key] = openaiMessages
          else if (value === '{{tools}}' && convertedTools?.length) requestBody[key] = convertedTools
        }

        // 确保核心字段存在
        if (!('model' in requestBody)) requestBody.model = model
        if (!('messages' in requestBody)) requestBody.messages = openaiMessages
        if (!('stream' in requestBody)) requestBody.stream = true
      } else {
        // 没有 bodyTemplate，使用默认结构
        requestBody = {
          model,
          messages: openaiMessages,
          stream: true,
          max_tokens: maxTokens || 8192,
        }
      }

      // 添加工具（如果有且未在 bodyTemplate 中设置）
      if (convertedTools?.length && !('tools' in requestBody)) {
        requestBody.tools = convertedTools
      }

      // 调试日志：打印最终请求体（排除 messages 减少噪音）
      const debugBody = { ...requestBody, messages: `[${openaiMessages.length} messages]` }
      this.log('info', 'Final request body:', debugBody)

      const stream = await this.client.chat.completions.create(
        requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming,
        { signal }
      )

      let fullContent = ''
      let fullReasoning = ''

      // 从适配器配置获取 reasoning 字段名
      const toolCalls: ToolCall[] = []
      let currentToolCall: { id?: string; name?: string; argsString: string } | null = null

      for await (const chunk of stream) {
        // 动态 delta 类型，支持不同厂商的字段名
        interface ExtendedDelta {
          content?: string
          [key: string]: unknown  // 支持动态字段如 reasoning, thinking 等
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        const delta = chunk.choices[0]?.delta as ExtendedDelta | undefined

        if (delta?.content) {
          fullContent += delta.content
          onStream({ type: 'text', content: delta.content })
        }

        // 使用适配器配置的 reasoning 字段名
        // 字段路径相对于 delta 对象（如 'reasoning_content'）
        const reasoningField = adapterConfig?.response?.reasoningField || 'reasoning'

        // 简单的嵌套路径解析函数
        const getNestedValue = (obj: any, path: string): any => {
          return path.split('.').reduce((acc, part) => acc && acc[part], obj)
        }

        const reasoningContent = getNestedValue(delta, reasoningField) as string | undefined
        if (reasoningContent) {
          fullReasoning += reasoningContent
          onStream({ type: 'reasoning', content: reasoningContent })
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (tc.id) {
                if (currentToolCall?.id) {
                  const finalToolCall = this.finalizeToolCall(currentToolCall)
                  if (finalToolCall) {
                    toolCalls.push(finalToolCall)
                    onStream({ type: 'tool_call_end', toolCall: finalToolCall })
                    onToolCall(finalToolCall)
                  }
                }
                currentToolCall = {
                  id: tc.id,
                  name: tc.function?.name,
                  argsString: tc.function?.arguments || '',
                }
                onStream({
                  type: 'tool_call_start',
                  toolCallDelta: { id: tc.id, name: tc.function?.name },
                })
                if (tc.function?.arguments) {
                  onStream({
                    type: 'tool_call_delta',
                    toolCallDelta: { id: tc.id, args: tc.function.arguments },
                  })
                }
              } else if (currentToolCall) {
                if (tc.function?.name) {
                  currentToolCall.name = tc.function.name
                  onStream({
                    type: 'tool_call_delta',
                    toolCallDelta: { id: currentToolCall.id, name: tc.function.name },
                  })
                }
                if (tc.function?.arguments) {
                  currentToolCall.argsString += tc.function.arguments
                  onStream({
                    type: 'tool_call_delta',
                    toolCallDelta: { id: currentToolCall.id, args: tc.function.arguments },
                  })
                }
              }
            }
          }
        }
      }

      if (currentToolCall?.id) {
        const finalToolCall = this.finalizeToolCall(currentToolCall)
        if (finalToolCall) {
          toolCalls.push(finalToolCall)
          onStream({ type: 'tool_call_end', toolCall: finalToolCall })
          onToolCall(finalToolCall)
        }
      }

      const finalContent = fullContent || (fullReasoning ? `[Reasoning]\n${fullReasoning}` : '')
      this.log('info', 'Chat complete', {
        contentLength: fullContent.length,
        toolCallCount: toolCalls.length,
      })

      onComplete({
        content: finalContent,
        reasoning: fullReasoning || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      })
    } catch (error: unknown) {
      const llmError = this.parseError(error)
      this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
      onError(llmError)
    }
  }

  private finalizeToolCall(tc: {
    id?: string
    name?: string
    argsString: string
  }): ToolCall | null {
    if (!tc.id || !tc.name) return null

    let argsStr = tc.argsString || '{}'
    argsStr = this.cleanToolCallArgs(argsStr)

    try {
      const args = JSON.parse(argsStr)
      return { id: tc.id, name: tc.name, arguments: args }
    } catch {
      try {
        const fixed = this.fixUnescapedNewlines(argsStr)
        const args = JSON.parse(fixed)
        return { id: tc.id, name: tc.name, arguments: args }
      } catch {
        try {
          const fixed = this.fixMalformedJson(argsStr)
          const args = JSON.parse(fixed)
          return { id: tc.id, name: tc.name, arguments: args }
        } catch {
          this.log('error', 'Failed to parse tool call arguments')
          return null
        }
      }
    }
  }

  private cleanToolCallArgs(argsStr: string): string {
    let cleaned = argsStr.trimStart()
    cleaned = cleaned.replace(/<\|[^|]+\|>/g, '')
    cleaned = cleaned.trimEnd()

    if (cleaned.length > 0 && !cleaned.endsWith('}')) {
      let braceCount = 0
      let lastValidEnd = -1
      let inString = false
      let escaped = false

      for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i]
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\' && inString) {
          escaped = true
          continue
        }
        if (char === '"') {
          inString = !inString
          continue
        }
        if (!inString) {
          if (char === '{') braceCount++
          else if (char === '}') {
            braceCount--
            if (braceCount === 0) lastValidEnd = i
          }
        }
      }

      if (lastValidEnd !== -1) {
        cleaned = cleaned.slice(0, lastValidEnd + 1)
      }
    }

    return cleaned
  }

  private fixUnescapedNewlines(argsStr: string): string {
    let inString = false
    let escaped = false
    let result = ''

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i]
      const charCode = char.charCodeAt(0)

      if (escaped) {
        result += char
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        result += char
        continue
      }
      if (char === '"') {
        inString = !inString
        result += char
        continue
      }

      if (inString) {
        if (char === '\n') {
          result += '\\n'
          continue
        }
        if (char === '\r') {
          result += '\\r'
          continue
        }
        if (char === '\t') {
          result += '\\t'
          continue
        }
        if (charCode < 32) {
          result += `\\u${charCode.toString(16).padStart(4, '0')}`
          continue
        }
      }

      result += char
    }

    return result
  }

  private fixMalformedJson(argsStr: string): string {
    let result = ''
    let inString = false
    let escaped = false
    let i = 0

    while (i < argsStr.length) {
      const char = argsStr[i]
      const charCode = char.charCodeAt(0)

      if (escaped) {
        result += char
        escaped = false
        i++
        continue
      }
      if (char === '\\') {
        escaped = true
        result += char
        i++
        continue
      }
      if (char === '"') {
        inString = !inString
        result += char
        i++
        continue
      }

      if (inString) {
        if (char === '\n') result += '\\n'
        else if (char === '\r') result += '\\r'
        else if (char === '\t') result += '\\t'
        else if (charCode < 32) result += `\\u${charCode.toString(16).padStart(4, '0')}`
        else result += char
      } else {
        result += char
      }

      i++
    }

    if (inString) result += '"'

    let braceCount = 0
    let bracketCount = 0
    inString = false
    escaped = false

    for (let j = 0; j < result.length; j++) {
      const c = result[j]
      if (escaped) {
        escaped = false
        continue
      }
      if (c === '\\') {
        escaped = true
        continue
      }
      if (c === '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (c === '{') braceCount++
        else if (c === '}') braceCount--
        else if (c === '[') bracketCount++
        else if (c === ']') bracketCount--
      }
    }

    while (bracketCount > 0) {
      result += ']'
      bracketCount--
    }
    while (braceCount > 0) {
      result += '}'
      braceCount--
    }

    return result
  }
}
