/**
 * 统一 Provider 实现
 * 
 * 基于协议类型（protocol）路由到不同的处理逻辑
 * 支持 OpenAI、Anthropic、Gemini（原生SDK）、自定义协议
 */

import { BaseProvider } from './base'
import { MessageAdapter } from '../adapters/messageAdapter'
import { ToolAdapter } from '../adapters/toolAdapter'
import { ResponseParser } from '../adapters/responseParser'
import { ChatParams, LLMToolCall, LLMErrorClass, LLMErrorCode, LLMConfig } from '../types'
import { LLM_DEFAULTS } from '@shared/config/defaults'
import { getBuiltinProvider, type LLMAdapterConfig, type ApiProtocol, type VisionConfig } from '@shared/config/providers'
import { logger } from '@shared/utils/Logger'

// SDK imports
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI, Content, SchemaType, type Tool as GeminiTool } from '@google/generative-ai'

/**
 * 统一 Provider
 * 根据协议类型自动选择处理方式
 */
export class UnifiedProvider extends BaseProvider {
  private config: LLMConfig
  private protocol: ApiProtocol
  private adapterConfig: LLMAdapterConfig
  private visionConfig: VisionConfig

  // SDK 客户端（按需创建）
  private openaiClient?: OpenAI
  private anthropicClient?: Anthropic
  private geminiClient?: GoogleGenerativeAI

  constructor(config: LLMConfig) {
    const providerDef = getBuiltinProvider(config.provider)
    const protocol = config.adapterConfig?.protocol || providerDef?.protocol || 'openai'
    super(`Unified:${protocol}`)

    this.config = config
    this.protocol = protocol
    this.adapterConfig = config.adapterConfig || providerDef?.adapter || this.getDefaultAdapter()
    
    // 构建 visionConfig：优先使用用户配置，否则使用 provider 默认值
    const defaultVisionEnabled = providerDef?.features?.vision ?? (protocol !== 'custom')
    this.visionConfig = {
      enabled: config.advanced?.vision?.enabled ?? defaultVisionEnabled,
      imageFormat: config.advanced?.vision?.imageFormat,
    }

    this.log('info', 'Initialized', {
      provider: config.provider,
      protocol: this.protocol,
      baseUrl: config.baseUrl || 'default',
    })
  }

  private getDefaultAdapter(): LLMAdapterConfig {
    return {
      id: 'default',
      name: 'Default',
      protocol: 'openai',
      request: {
        endpoint: '/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        bodyTemplate: { stream: true },
      },
      response: {
        contentField: 'delta.content',
        toolCallField: 'delta.tool_calls',
        toolNamePath: 'function.name',
        toolArgsPath: 'function.arguments',
        toolIdPath: 'id',
        doneMarker: '[DONE]',
      },
    }
  }

  async chat(params: ChatParams): Promise<void> {
    // 根据协议类型路由
    switch (this.protocol) {
      case 'anthropic':
        return this.chatWithAnthropic(params)
      case 'gemini':
        return this.chatWithGemini(params)
      case 'openai':
        return this.chatWithOpenAI(params)
      case 'custom':
        return this.chatWithCustom(params)
      default:
        return this.chatWithOpenAI(params)
    }
  }

  // ============================================
  // OpenAI 协议处理
  // ============================================

  private getOpenAIClient(): OpenAI {
    if (!this.openaiClient) {
      const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
        apiKey: this.config.apiKey || 'ollama',
        baseURL: this.config.baseUrl,
        timeout: this.config.timeout || LLM_DEFAULTS.timeout,
        maxRetries: 0,
      }

      // 应用高级配置
      if (this.config.advanced?.request?.headers) {
        clientOptions.defaultHeaders = this.config.advanced.request.headers
      }

      this.openaiClient = new OpenAI(clientOptions)
    }
    return this.openaiClient
  }

  private async chatWithOpenAI(params: ChatParams): Promise<void> {
    const { model, messages, tools, systemPrompt, maxTokens, temperature, topP, stream = true, signal, onStream, onToolCall, onComplete, onError } = params

    try {
      this.log('info', 'Chat (OpenAI)', { model, messageCount: messages.length, stream })

      const client = this.getOpenAIClient()

      // 转换消息和工具
      const converted = MessageAdapter.convert(messages, systemPrompt, 'openai', this.adapterConfig, this.visionConfig)
      const convertedTools = ToolAdapter.convert(tools, 'openai')

      // 构建请求
      const requestBody: Record<string, unknown> = {
        model,
        messages: converted.messages,
        max_tokens: maxTokens || LLM_DEFAULTS.maxTokens,
        stream,
      }

      if (temperature !== undefined) requestBody.temperature = temperature
      if (topP !== undefined) requestBody.top_p = topP
      if (convertedTools?.length) requestBody.tools = convertedTools
      if (stream) requestBody.stream_options = { include_usage: true }

      // 应用 bodyTemplate
      this.applyBodyTemplate(requestBody)

      if (stream) {
        await this.handleOpenAIStream(client, requestBody as unknown as OpenAI.ChatCompletionCreateParamsStreaming, signal, onStream, onToolCall, onComplete)
      } else {
        await this.handleOpenAINonStream(client, requestBody as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming, signal, onStream, onToolCall, onComplete)
      }
    } catch (error) {
      onError(this.parseError(error))
    }
  }

  private async handleOpenAIStream(
    client: OpenAI,
    requestBody: OpenAI.ChatCompletionCreateParamsStreaming,
    signal: AbortSignal | undefined,
    onStream: ChatParams['onStream'],
    onToolCall: ChatParams['onToolCall'],
    onComplete: ChatParams['onComplete']
  ): Promise<void> {
    const stream = await client.chat.completions.create(requestBody, { signal })

    let fullContent = ''
    let fullReasoning = ''
    const toolCalls: LLMToolCall[] = []
    let currentToolCall: { id?: string; name?: string; argsString: string } | null = null
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

    for await (const chunk of stream) {
      // Usage
      if ((chunk as any).usage) {
        const u = (chunk as any).usage
        usage = {
          promptTokens: u.prompt_tokens || 0,
          completionTokens: u.completion_tokens || 0,
          totalTokens: u.total_tokens || 0,
        }
      }

      const delta = chunk.choices[0]?.delta as Record<string, unknown> | undefined

      // 文本内容
      if (delta?.content) {
        fullContent += delta.content as string
        onStream({ type: 'text', content: delta.content as string })
      }

      // 推理内容（使用配置的字段名）
      const reasoningField = this.adapterConfig.response?.reasoningField
      if (reasoningField) {
        const reasoning = this.getNestedValue(delta, reasoningField)
        if (reasoning) {
          fullReasoning += reasoning
          onStream({ type: 'reasoning', content: reasoning })
        }
      }

      // 工具调用
      const deltaToolCalls = delta?.tool_calls as Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }> | undefined

      if (deltaToolCalls) {
        for (const tc of deltaToolCalls) {
          if (tc.id) {
            // 完成上一个工具调用
            if (currentToolCall?.id) {
              const finalToolCall = this.finalizeToolCall(currentToolCall)
              if (finalToolCall) {
                toolCalls.push(finalToolCall)
                onStream({ type: 'tool_call_end', toolCall: finalToolCall })
                onToolCall(finalToolCall)
              }
            }
            // 开始新的工具调用
            currentToolCall = {
              id: tc.id,
              name: tc.function?.name,
              argsString: tc.function?.arguments || '',
            }
            onStream({
              type: 'tool_call_start',
              toolCallDelta: { id: tc.id, name: tc.function?.name },
            })
          } else if (currentToolCall) {
            // 累加参数
            if (tc.function?.name) currentToolCall.name = tc.function.name
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

    // 完成最后一个工具调用
    if (currentToolCall?.id) {
      const finalToolCall = this.finalizeToolCall(currentToolCall)
      if (finalToolCall) {
        toolCalls.push(finalToolCall)
        onStream({ type: 'tool_call_end', toolCall: finalToolCall })
        onToolCall(finalToolCall)
      }
    }

    onComplete({
      content: fullContent,
      reasoning: fullReasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    })
  }

  private async handleOpenAINonStream(
    client: OpenAI,
    requestBody: OpenAI.ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal | undefined,
    onStream: ChatParams['onStream'],
    onToolCall: ChatParams['onToolCall'],
    onComplete: ChatParams['onComplete']
  ): Promise<void> {
    const response = await client.chat.completions.create(requestBody, { signal })

    const message = response.choices[0]?.message
    const content = message?.content || ''

    if (content) onStream({ type: 'text', content })

    const toolCalls: LLMToolCall[] = []
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === 'function') {
          let args: Record<string, unknown> = {}
          try {
            args = JSON.parse(tc.function.arguments || '{}')
          } catch { /* ignore */ }
          const toolCall: LLMToolCall = { id: tc.id, name: tc.function.name, arguments: args }
          toolCalls.push(toolCall)
          onToolCall(toolCall)
        }
      }
    }

    const usage = response.usage ? {
      promptTokens: response.usage.prompt_tokens || 0,
      completionTokens: response.usage.completion_tokens || 0,
      totalTokens: response.usage.total_tokens || 0,
    } : undefined

    onComplete({ content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage })
  }

  // ============================================
  // Anthropic 协议处理
  // ============================================

  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      const providerDef = getBuiltinProvider(this.config.provider)
      let baseUrl = this.config.baseUrl?.replace(/\/v1\/?$/, '') || undefined

      // 判断认证方式
      const authConfig = this.config.advanced?.auth || providerDef?.auth
      const useBearer = authConfig?.type === 'bearer' || (!!baseUrl && authConfig?.type !== 'api-key')

      const defaultHeaders: Record<string, string> = {
        'x-app': 'cli',
        'User-Agent': 'claude-cli/2.0.76 (external, cli)',
        'anthropic-beta': 'claude-code-20250219,interleaved-thinking-2025-05-14',
        ...(useBearer ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        ...this.config.advanced?.request?.headers,
      }

      this.anthropicClient = new Anthropic({
        apiKey: this.config.apiKey,
        timeout: this.config.timeout || LLM_DEFAULTS.timeout,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        defaultHeaders,
      })
    }
    return this.anthropicClient
  }

  private async chatWithAnthropic(params: ChatParams): Promise<void> {
    const { model, messages, tools, systemPrompt, maxTokens, temperature, topP, stream = true, signal, onStream, onToolCall, onComplete, onError } = params

    try {
      this.log('info', 'Chat (Anthropic)', { model, messageCount: messages.length, stream })

      const client = this.getAnthropicClient()

      // 转换消息和工具
      const converted = MessageAdapter.convert(messages, systemPrompt, 'anthropic', undefined, this.visionConfig)
      const convertedTools = ToolAdapter.convert(tools, 'anthropic') as Anthropic.Tool[] | undefined

      // 构建请求
      const requestParams: Record<string, unknown> = {
        model,
        max_tokens: maxTokens || LLM_DEFAULTS.maxTokens,
        messages: converted.messages,
      }

      if (temperature !== undefined) requestParams.temperature = temperature
      if (topP !== undefined) requestParams.top_p = topP
      if (converted.systemPrompt) requestParams.system = converted.systemPrompt
      if (convertedTools?.length) requestParams.tools = convertedTools

      // 应用 bodyTemplate
      this.applyBodyTemplate(requestParams)

      // thinking 模式下移除 temperature 和 top_p
      if (requestParams.thinking) {
        delete requestParams.temperature
        delete requestParams.top_p
      }

      this.logRequest(requestParams, stream, convertedTools?.length || 0)

      if (stream) {
        await this.handleAnthropicStream(client, requestParams as unknown as Anthropic.MessageCreateParamsStreaming, signal, onStream, onToolCall, onComplete)
      } else {
        await this.handleAnthropicNonStream(client, requestParams as unknown as Anthropic.MessageCreateParamsNonStreaming, signal, onStream, onToolCall, onComplete)
      }
    } catch (error) {
      const llmError = this.parseError(error)
      if (llmError.code !== LLMErrorCode.ABORTED) {
        this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
      }
      onError(llmError)
    }
  }

  private async handleAnthropicStream(
    client: Anthropic,
    requestParams: Anthropic.MessageCreateParamsStreaming,
    signal: AbortSignal | undefined,
    onStream: ChatParams['onStream'],
    onToolCall: ChatParams['onToolCall'],
    onComplete: ChatParams['onComplete']
  ): Promise<void> {
    const streamResponse = client.messages.stream(requestParams, { signal })

    let fullContent = ''
    const toolCalls: LLMToolCall[] = []

    streamResponse.on('text', (text) => {
      fullContent += text
      onStream({ type: 'text', content: text })
    })

    // thinking 块支持
    streamResponse.on('streamEvent', (event) => {
      if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
        onStream({ type: 'reasoning', content: (event.delta as { thinking?: string }).thinking || '' })
      }
    })

    const finalMessage = await streamResponse.finalMessage()

    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        const toolCall: LLMToolCall = {
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        }
        toolCalls.push(toolCall)
        onToolCall(toolCall)
      }
    }

    onComplete({
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      },
    })
  }

  private async handleAnthropicNonStream(
    client: Anthropic,
    requestParams: Anthropic.MessageCreateParamsNonStreaming,
    signal: AbortSignal | undefined,
    onStream: ChatParams['onStream'],
    onToolCall: ChatParams['onToolCall'],
    onComplete: ChatParams['onComplete']
  ): Promise<void> {
    const response = await client.messages.create(requestParams, { signal })

    let fullContent = ''
    const toolCalls: LLMToolCall[] = []

    for (const block of response.content) {
      if (block.type === 'text') {
        fullContent += block.text
        onStream({ type: 'text', content: block.text })
      } else if (block.type === 'tool_use') {
        const toolCall: LLMToolCall = {
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        }
        toolCalls.push(toolCall)
        onToolCall(toolCall)
      }
    }

    onComplete({
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    })
  }

  // ============================================
  // Gemini 原生 SDK 处理
  // ============================================

  private getGeminiClient(): GoogleGenerativeAI {
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenerativeAI(this.config.apiKey)
    }
    return this.geminiClient
  }

  private async chatWithGemini(params: ChatParams): Promise<void> {
    const { model, messages, tools, systemPrompt, stream = true, signal, onStream, onToolCall, onComplete, onError } = params

    try {
      this.log('info', 'Chat (Gemini)', { model, messageCount: messages.length, stream })

      if (signal?.aborted) {
        onError(new LLMErrorClass('Request aborted', LLMErrorCode.ABORTED, undefined, false))
        return
      }

      const client = this.getGeminiClient()

      // 构建请求选项
      const requestOptions = this.config.baseUrl ? { baseUrl: this.config.baseUrl } : undefined

      // 转换工具为 Gemini 格式
      const geminiTools = this.convertToolsToGemini(tools)

      // 构建模型配置
      const modelConfig = {
        model,
        systemInstruction: systemPrompt,
        tools: geminiTools,
      }

      const genModel = client.getGenerativeModel(modelConfig, requestOptions)

      // 转换消息历史
      const { history, lastUserMessage } = this.convertMessagesToGemini(messages)

      const chat = genModel.startChat({ history })

      let fullContent = ''
      const toolCalls: LLMToolCall[] = []

      if (stream) {
        const result = await chat.sendMessageStream(lastUserMessage)

        for await (const chunk of result.stream) {
          if (signal?.aborted) {
            this.log('info', 'Stream aborted by user')
            onError(new LLMErrorClass('Request aborted', LLMErrorCode.ABORTED, undefined, false))
            return
          }

          const text = chunk.text()
          if (text) {
            fullContent += text
            onStream({ type: 'text', content: text })
          }

          // 处理工具调用
          const candidate = chunk.candidates?.[0]
          if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
              if ('functionCall' in part && part.functionCall) {
                const toolCall: LLMToolCall = {
                  id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  name: part.functionCall.name,
                  arguments: part.functionCall.args as Record<string, unknown>,
                }
                toolCalls.push(toolCall)
                onToolCall(toolCall)
              }
            }
          }
        }

        // 获取 usage
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
        try {
          const response = await result.response
          if (response.usageMetadata) {
            usage = {
              promptTokens: response.usageMetadata.promptTokenCount || 0,
              completionTokens: response.usageMetadata.candidatesTokenCount || 0,
              totalTokens: response.usageMetadata.totalTokenCount || 0,
            }
          }
        } catch { /* ignore */ }

        onComplete({
          content: fullContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
        })
      } else {
        const result = await chat.sendMessage(lastUserMessage)
        const response = result.response

        fullContent = response.text()
        if (fullContent) {
          onStream({ type: 'text', content: fullContent })
        }

        // 处理工具调用
        const candidate = response.candidates?.[0]
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if ('functionCall' in part && part.functionCall) {
              const toolCall: LLMToolCall = {
                id: `gemini-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: part.functionCall.name,
                arguments: part.functionCall.args as Record<string, unknown>,
              }
              toolCalls.push(toolCall)
              onToolCall(toolCall)
            }
          }
        }

        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
        if (response.usageMetadata) {
          usage = {
            promptTokens: response.usageMetadata.promptTokenCount || 0,
            completionTokens: response.usageMetadata.candidatesTokenCount || 0,
            totalTokens: response.usageMetadata.totalTokenCount || 0,
          }
        }

        onComplete({
          content: fullContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
        })
      }
    } catch (error) {
      const llmError = this.parseError(error)
      if (llmError.code !== LLMErrorCode.ABORTED) {
        this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
      }
      onError(llmError)
    }
  }

  private convertToolsToGemini(tools?: import('../types').ToolDefinition[]): GeminiTool[] | undefined {
    if (!tools?.length) return undefined

    const functionDeclarations = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => {
            const prop: Record<string, unknown> = {
              type: this.mapTypeToGeminiSchemaType(value.type),
              description: value.description,
            }
            if (value.enum && value.enum.length > 0) {
              prop.enum = value.enum
            }
            return [key, prop]
          })
        ),
        required: tool.parameters.required,
      },
    }))

    return [{ functionDeclarations }] as unknown as GeminiTool[]
  }

  private mapTypeToGeminiSchemaType(type: string): SchemaType {
    switch (type) {
      case 'string': return SchemaType.STRING
      case 'number': return SchemaType.NUMBER
      case 'integer': return SchemaType.INTEGER
      case 'boolean': return SchemaType.BOOLEAN
      case 'array': return SchemaType.ARRAY
      case 'object': return SchemaType.OBJECT
      default: return SchemaType.STRING
    }
  }

  private convertMessagesToGemini(messages: import('../types').LLMMessage[]): { history: Content[]; lastUserMessage: string } {
    const history: Content[] = []
    let lastUserMessage = ''

    const contentToString = (content: import('../types').LLMMessage['content']): string => {
      if (typeof content === 'string') return content
      return content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('')
    }

    // 找到第一条用户消息的位置
    let startIndex = 0
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'user') {
        startIndex = i
        break
      }
    }

    // 收集连续的工具结果，用于合并到同一个 function 消息
    let pendingToolResults: Array<{ name: string; result: string }> = []

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        // Gemini 支持在一个 function 消息中包含多个 functionResponse
        history.push({
          role: 'function',
          parts: pendingToolResults.map(tr => ({
            functionResponse: {
              name: tr.name,
              response: { result: tr.result },
            },
          })),
        })
        pendingToolResults = []
      }
    }

    for (let i = startIndex; i < messages.length; i++) {
      const msg = messages[i]
      
      if (msg.role === 'user') {
        flushToolResults() // 先处理待处理的工具结果
        
        const isLastUser = messages.slice(i + 1).every((m) => m.role !== 'user')
        if (isLastUser) {
          lastUserMessage = contentToString(msg.content)
        } else {
          history.push({
            role: 'user',
            parts: [{ text: contentToString(msg.content) }],
          })
        }
      } else if (msg.role === 'assistant') {
        flushToolResults() // 先处理待处理的工具结果
        
        // 检查是否有工具调用（通过 toolCalls 字段或 toolName）
        const toolCalls = (msg as any).toolCalls as Array<{ name: string; arguments: Record<string, unknown> }> | undefined
        
        if (toolCalls && toolCalls.length > 0) {
          // 多个工具调用：合并到同一个 model 消息
          const parts: any[] = []
          
          // 如果有文本内容，先添加
          const textContent = contentToString(msg.content)
          if (textContent && textContent.trim()) {
            parts.push({ text: textContent })
          }
          
          // 添加所有工具调用
          for (const tc of toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments,
              },
            })
          }
          
          history.push({ role: 'model', parts })
        } else if (msg.toolName) {
          // 单个工具调用（旧格式兼容）
          try {
            const args = JSON.parse(contentToString(msg.content))
            history.push({
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: msg.toolName,
                    args,
                  },
                },
              ],
            })
          } catch {
            // JSON 解析失败，作为普通文本处理
            history.push({
              role: 'model',
              parts: [{ text: contentToString(msg.content) }],
            })
          }
        } else {
          // 普通文本消息
          const text = contentToString(msg.content)
          if (text && text.trim()) {
            history.push({
              role: 'model',
              parts: [{ text }],
            })
          }
        }
      } else if (msg.role === 'tool') {
        // 收集工具结果，稍后合并
        pendingToolResults.push({
          name: msg.toolName || '',
          result: contentToString(msg.content),
        })
      }
    }

    // 处理剩余的工具结果
    flushToolResults()

    // 确保历史以用户消息开始（Gemini 要求）
    if (history.length > 0 && history[0].role !== 'user') {
      history.unshift({
        role: 'user',
        parts: [{ text: 'Continue the conversation.' }],
      })
    }

    // 确保 user 和 model 消息交替出现（Gemini 要求）
    // 合并连续的同角色消息
    const mergedHistory: Content[] = []
    for (const msg of history) {
      const lastMsg = mergedHistory[mergedHistory.length - 1]
      if (lastMsg && lastMsg.role === msg.role && msg.role !== 'function') {
        // 合并同角色消息
        lastMsg.parts = [...lastMsg.parts, ...msg.parts]
      } else {
        mergedHistory.push(msg)
      }
    }

    if (!lastUserMessage) {
      lastUserMessage = 'Continue.'
    }

    return { history: mergedHistory, lastUserMessage }
  }

  // ============================================
  // 自定义协议处理（HTTP fetch）
  // ============================================

  private async chatWithCustom(params: ChatParams): Promise<void> {
    const { model, messages, tools, systemPrompt, maxTokens, temperature, topP, stream = true, signal, onStream, onToolCall, onComplete, onError } = params

    try {
      this.log('info', 'Chat (Custom)', { model, messageCount: messages.length, stream })

      // 转换消息和工具（使用配置的 messageFormat 和 toolFormat）
      const converted = MessageAdapter.convert(messages, systemPrompt, 'custom', this.adapterConfig, this.visionConfig)
      const convertedTools = ToolAdapter.convert(tools, 'custom', this.adapterConfig)

      // 构建请求
      const { request } = this.adapterConfig
      const url = `${this.config.baseUrl}${request.endpoint}`

      // 构建请求头（根据认证配置）
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...request.headers,
        ...this.config.advanced?.request?.headers,
      }

      // 应用认证
      const authConfig = this.config.advanced?.auth
      if (authConfig?.type === 'none') {
        // 无认证
      } else if (authConfig?.type === 'header' || authConfig?.type === 'api-key') {
        const headerName = authConfig.headerName || 'x-api-key'
        headers[headerName] = this.config.apiKey
      } else {
        // 默认 bearer
        headers['Authorization'] = `Bearer ${this.config.apiKey}`
      }

      // 构建请求体
      const body = this.buildCustomRequestBody({
        model,
        messages: converted.messages,
        tools: convertedTools,
        systemPrompt: converted.systemPrompt,
        maxTokens: maxTokens || LLM_DEFAULTS.maxTokens,
        temperature,
        topP,
        stream,
      })

      // 发送请求
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout || LLM_DEFAULTS.timeout)
      if (signal) signal.addEventListener('abort', () => controller.abort())

      try {
        const response = await fetch(url, {
          method: request.method,
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new LLMErrorClass(
            `HTTP ${response.status}: ${errorText}`,
            this.mapHttpErrorCode(response.status),
            response.status,
            response.status === 429 || response.status >= 500
          )
        }

        if (stream) {
          await this.handleCustomStream(response, onStream, onToolCall, onComplete)
        } else {
          await this.handleCustomNonStream(response, onStream, onToolCall, onComplete)
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      onError(this.parseError(error))
    }
  }

  /**
   * 构建自定义协议的请求体
   * 支持特殊结构如阿里 DashScope: { input: { messages }, parameters: {} }
   */
  private buildCustomRequestBody(params: {
    model: string
    messages: unknown[]
    tools?: unknown[]
    systemPrompt?: string | unknown[]
    maxTokens: number
    temperature?: number
    topP?: number
    stream: boolean
  }): Record<string, unknown> {
    const { model, messages, tools, systemPrompt, maxTokens, temperature, topP, stream } = params
    const bodyTemplate = this.adapterConfig.request?.bodyTemplate || {}
    const messageFormat = this.adapterConfig.messageFormat

    // 检查是否是 DashScope 风格（有 input 字段）
    if ('input' in bodyTemplate) {
      // DashScope 风格: { model, input: { messages }, parameters: {} }
      const body: Record<string, unknown> = {
        model,
        input: {
          messages,
        },
        parameters: {
          max_tokens: maxTokens,
          incremental_output: stream,
        },
      }

      // 添加温度和 topP 到 parameters
      if (temperature !== undefined) (body.parameters as Record<string, unknown>).temperature = temperature
      if (topP !== undefined) (body.parameters as Record<string, unknown>).top_p = topP

      // 系统消息
      if (systemPrompt && messageFormat?.systemMessageMode === 'parameter') {
        const systemParamName = messageFormat.systemParameterName || 'system'
        ;(body.input as Record<string, unknown>)[systemParamName] = systemPrompt
      }

      // 工具
      if (tools?.length) {
        (body.parameters as Record<string, unknown>).tools = tools
      }

      // 合并 bodyTemplate 中的其他参数
      this.mergeBodyTemplate(body, bodyTemplate, ['input', 'parameters', 'model'])

      return body
    }

    // 标准 OpenAI 风格
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      stream,
    }

    if (temperature !== undefined) body.temperature = temperature
    if (topP !== undefined) body.top_p = topP

    // 系统消息处理
    if (systemPrompt && messageFormat?.systemMessageMode === 'parameter') {
      const systemParamName = messageFormat.systemParameterName || 'system'
      body[systemParamName] = systemPrompt
    }

    if (tools?.length) body.tools = tools
    if (stream) body.stream_options = { include_usage: true }

    // 应用 bodyTemplate
    this.applyBodyTemplate(body)

    return body
  }

  /**
   * 合并 bodyTemplate 中的额外参数
   */
  private mergeBodyTemplate(
    body: Record<string, unknown>,
    template: Record<string, unknown>,
    excludeKeys: string[]
  ): void {
    for (const [key, value] of Object.entries(template)) {
      if (excludeKeys.includes(key)) continue
      if (typeof value === 'string' && value.startsWith('{{')) continue

      // 深度合并对象
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        if (typeof body[key] === 'object' && body[key] !== null) {
          Object.assign(body[key] as Record<string, unknown>, value)
        } else {
          body[key] = value
        }
      } else {
        body[key] = value
      }
    }
  }

  private async handleCustomStream(
    response: Response,
    onStream: ChatParams['onStream'],
    onToolCall: ChatParams['onToolCall'],
    onComplete: ChatParams['onComplete']
  ): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) throw new LLMErrorClass('Response body is not readable', LLMErrorCode.NETWORK_ERROR)

    const decoder = new TextDecoder()
    const parser = new ResponseParser(this.adapterConfig.response)
    let buffer = ''
    let fullContent = ''
    let fullReasoning = ''
    const toolCalls: LLMToolCall[] = []
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const chunks = parser.parseLine(line)
          for (const chunk of chunks) {
            switch (chunk.type) {
              case 'text':
                fullContent += chunk.content || ''
                onStream({ type: 'text', content: chunk.content || '' })
                break
              case 'reasoning':
                fullReasoning += chunk.content || ''
                onStream({ type: 'reasoning', content: chunk.content || '' })
                break
              case 'tool_call_start':
                onStream({ type: 'tool_call_start', toolCallDelta: { id: chunk.toolCall?.id, name: chunk.toolCall?.name } })
                break
              case 'tool_call_delta':
                onStream({ type: 'tool_call_delta', toolCallDelta: { id: chunk.toolCall?.id, args: chunk.toolCall?.arguments as string } })
                break
              case 'tool_call_end':
                if (chunk.toolCall) {
                  const tc: LLMToolCall = {
                    id: chunk.toolCall.id || '',
                    name: chunk.toolCall.name || '',
                    arguments: chunk.toolCall.arguments as Record<string, unknown> || {},
                  }
                  toolCalls.push(tc)
                  onStream({ type: 'tool_call_end', toolCall: tc })
                  onToolCall(tc)
                }
                break
              case 'usage':
                usage = chunk.usage
                break
            }
          }
        }
      }

      // 完成剩余的工具调用
      const finalChunks = parser.finalize()
      for (const chunk of finalChunks) {
        if (chunk.type === 'tool_call_end' && chunk.toolCall) {
          const tc: LLMToolCall = {
            id: chunk.toolCall.id || '',
            name: chunk.toolCall.name || '',
            arguments: chunk.toolCall.arguments as Record<string, unknown> || {},
          }
          toolCalls.push(tc)
          onStream({ type: 'tool_call_end', toolCall: tc })
          onToolCall(tc)
        }
      }

      onComplete({
        content: fullContent,
        reasoning: fullReasoning || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage,
      })
    } finally {
      reader.releaseLock()
    }
  }

  private async handleCustomNonStream(
    response: Response,
    onStream: ChatParams['onStream'],
    onToolCall: ChatParams['onToolCall'],
    onComplete: ChatParams['onComplete']
  ): Promise<void> {
    const data = await response.json() as Record<string, unknown>
    const responseConfig = this.adapterConfig.response

    let fullContent = ''
    const toolCalls: LLMToolCall[] = []

    // 提取 usage
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
    if (data.usage) {
      const u = data.usage as Record<string, number>
      usage = {
        promptTokens: u.prompt_tokens || u.promptTokens || 0,
        completionTokens: u.completion_tokens || u.completionTokens || 0,
        totalTokens: u.total_tokens || u.totalTokens || 0,
      }
    }

    // 提取内容
    const choices = data.choices as Array<Record<string, unknown>> | undefined
    if (choices?.length) {
      const choice = choices[0]
      const content = this.getNestedValue(choice, responseConfig.contentField.replace('delta.', 'message.'))
      if (content) {
        fullContent = content
        onStream({ type: 'text', content })
      }

      // 提取工具调用
      const toolCallField = responseConfig.toolCallField?.replace('delta.', 'message.') || 'message.tool_calls'
      const toolCallsData = this.getNestedValue(choice, toolCallField) as Array<Record<string, unknown>> | undefined
      if (toolCallsData) {
        for (const tc of toolCallsData) {
          const id = this.getNestedValue(tc, responseConfig.toolIdPath || 'id') || `call_${toolCalls.length}`
          const name = this.getNestedValue(tc, responseConfig.toolNamePath || 'function.name')
          const argsData = this.getNestedValue(tc, responseConfig.toolArgsPath || 'function.arguments')

          let args: Record<string, unknown> = {}
          if (typeof argsData === 'string') {
            try { args = JSON.parse(argsData) } catch { /* ignore */ }
          } else if (typeof argsData === 'object' && argsData !== null) {
            args = argsData as Record<string, unknown>
          }

          if (name) {
            const toolCall: LLMToolCall = { id: String(id), name: String(name), arguments: args }
            toolCalls.push(toolCall)
            onToolCall(toolCall)
          }
        }
      }
    }

    onComplete({
      content: fullContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    })
  }

  // ============================================
  // 辅助方法
  // ============================================

  private applyBodyTemplate(body: Record<string, unknown>): void {
    const template = this.adapterConfig.request?.bodyTemplate
    if (!template) return

    const excludeKeys = ['model', 'messages', 'tools', 'max_tokens', 'temperature', 'top_p', 'stream', 'system']
    for (const [key, value] of Object.entries(template)) {
      if (excludeKeys.includes(key)) continue
      if (typeof value === 'string' && value.startsWith('{{')) continue
      body[key] = value
    }
  }

  private getNestedValue(obj: unknown, path: string): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined
    return path.split('.').reduce((acc: unknown, part) => {
      if (acc && typeof acc === 'object') {
        return (acc as Record<string, unknown>)[part]
      }
      return undefined
    }, obj) as string | undefined
  }

  private finalizeToolCall(tc: { id?: string; name?: string; argsString: string }): LLMToolCall | null {
    if (!tc.id || !tc.name) return null
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(tc.argsString || '{}')
    } catch {
      // 尝试修复
      try {
        const fixed = tc.argsString.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
        args = JSON.parse(fixed)
      } catch { /* ignore */ }
    }
    return { id: tc.id, name: tc.name, arguments: args }
  }

  private mapHttpErrorCode(status: number): LLMErrorCode {
    switch (status) {
      case 400: return LLMErrorCode.INVALID_REQUEST
      case 401: return LLMErrorCode.INVALID_API_KEY
      case 403: return LLMErrorCode.INVALID_API_KEY
      case 404: return LLMErrorCode.MODEL_NOT_FOUND
      case 429: return LLMErrorCode.RATE_LIMIT
      default: return LLMErrorCode.UNKNOWN
    }
  }

  private logRequest(requestParams: Record<string, unknown>, stream: boolean, toolCount: number): void {
    const systemArr = requestParams.system as Array<{ text: string }> | undefined
    const systemLength = systemArr?.reduce((acc, item) => acc + (item.text?.length || 0), 0) || 0
    const messagesArr = requestParams.messages as Array<unknown> | undefined

    logger.system.debug('[UnifiedProvider] Request:', JSON.stringify({
      model: requestParams.model,
      max_tokens: requestParams.max_tokens,
      stream,
      messageCount: messagesArr?.length || 0,
      system: systemLength ? `[${systemLength} chars]` : undefined,
      tools: toolCount ? `[${toolCount} tools]` : undefined,
    }, null, 2))
  }
}
