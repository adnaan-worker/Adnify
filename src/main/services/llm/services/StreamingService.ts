/**
 * 流式服务 - 使用 AI SDK 6.0 streamText
 * AI SDK 6.0 原生支持所有主流模型的 reasoning，只需处理特殊格式（如 MiniMax XML 标签）
 */

import { streamText } from 'ai'
import type { StreamTextResult } from 'ai'
import { BrowserWindow } from 'electron'
import { logger } from '@shared/utils/Logger'
import { createModel } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { applyCaching, getCacheConfig } from '../core/PromptCache'
import { LLMError, convertUsage } from '../types'
import type { StreamEvent, TokenUsage, ResponseMetadata } from '../types'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'
import { ThinkingStrategyFactory, type ThinkingStrategy } from '../strategies/ThinkingStrategy'

export interface StreamingParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
  abortSignal?: AbortSignal
  activeTools?: string[]
  requestId: string  // 必传，用于 IPC 频道隔离
}

export interface StreamingResult {
  content: string
  reasoning?: string
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

export class StreamingService {
  private window: BrowserWindow
  private messageConverter: MessageConverter
  private toolConverter: ToolConverter

  constructor(window: BrowserWindow) {
    this.window = window
    this.messageConverter = new MessageConverter()
    this.toolConverter = new ToolConverter()
  }

  /**
   * 流式生成文本
   */
  async generate(params: StreamingParams): Promise<StreamingResult> {
    const { config, messages, tools, systemPrompt, abortSignal, activeTools, requestId } = params

    // 创建 thinking 策略（只为需要特殊处理的模型）
    const strategy = ThinkingStrategyFactory.create(config.model)
    strategy.reset?.()

    logger.system.info('[StreamingService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      requestId,
    })

    try {
      // 创建模型
      const model = createModel(config)

      // 转换消息
      let coreMessages = this.messageConverter.convert(messages, systemPrompt)

      // 应用 Prompt Caching
      const cacheConfig = getCacheConfig(config.provider)
      coreMessages = applyCaching(coreMessages, cacheConfig)

      // 转换工具
      const coreTools = tools ? this.toolConverter.convert(tools) : undefined

      // 构建 streamText 参数
      const streamParams: Parameters<typeof streamText>[0] = {
        model,
        messages: coreMessages,
        tools: coreTools,
        activeTools,  // 动态限制可用工具

        // 核心参数
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        // topP 为 1 时等于默认行为（不过滤），无需传递
        // 且部分模型（如 Claude）不允许 temperature 和 topP 同时指定
        topP: config.topP !== undefined && config.topP < 1 ? config.topP : undefined,
        topK: config.topK,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stopSequences: config.stopSequences,
        seed: config.seed,

        // AI SDK 高级参数
        maxRetries: config.maxRetries,
        toolChoice: config.toolChoice,
        headers: config.headers,
        timeout: config.timeout,  // 超时配置
        abortSignal,
      }

      // OpenAI 特定参数
      if (config.provider === 'openai') {
        if (config.logitBias) {
          // @ts-expect-error - OpenAI specific parameter
          streamParams.logitBias = config.logitBias
        }
        if (config.parallelToolCalls !== undefined) {
          streamParams.providerOptions = {
            ...streamParams.providerOptions,
            openai: {
              ...streamParams.providerOptions?.openai,
              parallelToolCalls: config.parallelToolCalls,
            },
          }
        }
      }

      // 启用 thinking 模式（各厂商配置不同）
      if (config.enableThinking) {
        if (config.provider === 'gemini') {
          // Google Gemini: thinkingConfig
          streamParams.providerOptions = {
            google: {
              thinkingConfig: {
                includeThoughts: true,
              },
            },
          }
        } else if (config.provider === 'anthropic') {
          // Anthropic Claude: thinking.type = "enabled"
          streamParams.providerOptions = {
            anthropic: {
              thinking: {
                type: 'enabled',
              },
            },
          }
        } else if (config.provider === 'openai') {
          // OpenAI: reasoningEffort + forceReasoning
          streamParams.providerOptions = {
            openai: {
              reasoningEffort: 'medium',
              forceReasoning: true,
            },
          }
        }
      }

      // 流式生成 - AI SDK 6.0 自动处理所有 reasoning
      const result = streamText({
        ...streamParams,
        // 自动修复工具调用 JSON 格式错误
        experimental_repairToolCall: async ({ toolCall, error }) => {
          logger.llm.warn('[StreamingService] Tool call parse error, attempting repair:', {
            toolName: toolCall.toolName,
            error: error.message,
          })

          try {
            const inputText = toolCall.input

            // 1. 修复未闭合的引号
            let fixed = inputText.replace(/([^\\])"([^"]*?)$/g, '$1"$2"')

            // 2. 修复未闭合的大括号
            const openBraces = (fixed.match(/\{/g) || []).length
            const closeBraces = (fixed.match(/\}/g) || []).length
            if (openBraces > closeBraces) {
              fixed += '}'.repeat(openBraces - closeBraces)
            }

            // 3. 修复未闭合的方括号
            const openBrackets = (fixed.match(/\[/g) || []).length
            const closeBrackets = (fixed.match(/\]/g) || []).length
            if (openBrackets > closeBrackets) {
              fixed += ']'.repeat(openBrackets - closeBrackets)
            }

            // 4. 尝试解析修复后的 JSON
            JSON.parse(fixed)

            logger.llm.info('[StreamingService] Tool call repaired successfully')
            return {
              ...toolCall,
              input: fixed,
            }
          } catch (repairError) {
            logger.llm.error('[StreamingService] Tool call repair failed:', repairError)
            return null // 返回 null 表示无法修复
          }
        },
      })

      // 处理流式响应
      return await this.processStream(result, strategy, requestId)
    } catch (error) {
      // LLMError.fromError 会自动使用 mapAISDKError 获取友好消息
      const llmError = LLMError.fromError(error)
      this.sendEvent(requestId, { type: 'error', error: llmError })
      throw llmError
    }
  }

  /**
   * 处理流式响应
   * AI SDK 6.0 自动处理 reasoning-delta，我们只需处理特殊格式（如 MiniMax XML 标签）
   */
  private async processStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result: StreamTextResult<any, any>,
    strategy: ThinkingStrategy,
    requestId: string
  ): Promise<StreamingResult> {
    let reasoning = ''
    const hasCustomParser = !!strategy.parseStreamText
    let streamError: Error | null = null

    for await (const part of result.fullStream) {
      if (this.window.isDestroyed()) break

      try {
        switch (part.type) {
          case 'text-delta':
            if (hasCustomParser && strategy.parseStreamText) {
              const parsed = strategy.parseStreamText(part.text)
              if (parsed.thinking) {
                reasoning += parsed.thinking
                this.sendEvent(requestId, { type: 'reasoning', content: parsed.thinking })
              }
              if (parsed.content) {
                this.sendEvent(requestId, { type: 'text', content: parsed.content })
              }
            } else {
              this.sendEvent(requestId, { type: 'text', content: part.text })
            }
            break

          case 'reasoning-delta':
            if (part.text) {
              reasoning += part.text
              this.sendEvent(requestId, { type: 'reasoning', content: part.text })
            }
            break

          case 'tool-input-start':
            this.sendEvent(requestId, {
              type: 'tool-call-start',
              id: part.id,
              name: part.toolName,
            })
            break

          case 'tool-input-delta':
            this.sendEvent(requestId, {
              type: 'tool-call-delta',
              id: part.id,
              argumentsDelta: part.delta,
            })
            break

          case 'tool-input-end':
            this.sendEvent(requestId, {
              type: 'tool-call-delta-end',
              id: part.id,
            })
            break

          case 'tool-call':
            this.sendEvent(requestId, {
              type: 'tool-call-available',
              id: part.toolCallId,
              name: part.toolName,
              arguments: part.input as Record<string, unknown>,
            })
            break

          case 'error':
            // 捕获流中的错误，稍后抛出
            if (part.error instanceof Error) {
              streamError = part.error
            }
            const llmError = LLMError.fromError(part.error)
            this.sendEvent(requestId, { type: 'error', error: llmError })
            break
        }
      } catch (error) {
        if (!this.window.isDestroyed()) {
          logger.llm.warn('[StreamingService] Error processing stream part:', error)
        }
      }
    }

    // 如果流中有错误，优先抛出真实错误而不是 NoOutputGeneratedError
    if (streamError) {
      throw streamError
    }

    // 获取最终结果
    const text = await result.text
    const usage = await result.usage
    const response = await result.response

    // 使用策略提取最终 thinking
    let finalText = text
    let finalReasoning = reasoning
    if (strategy.extractThinking) {
      const parsed = strategy.extractThinking(text)
      finalText = parsed.content
      if (parsed.thinking) {
        finalReasoning = parsed.thinking
      }
    }

    const streamingResult: StreamingResult = {
      content: finalText,
      reasoning: finalReasoning || undefined,
      usage: usage ? convertUsage(usage) : undefined,
      metadata: {
        id: response.id,
        modelId: response.modelId,
        timestamp: response.timestamp,
        finishReason: (await result.finishReason) || undefined,
      },
    }

    this.sendEvent(requestId, {
      type: 'done',
      usage: streamingResult.usage,
      metadata: streamingResult.metadata,
    })

    return streamingResult
  }

  /**
   * 发送事件到渲染进程（使用动态 IPC 频道实现请求隔离）
   */
  private sendEvent(requestId: string, event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    try {
      switch (event.type) {
        case 'text':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'text',
            content: event.content,
          })
          break

        case 'reasoning':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'reasoning',
            content: event.content,
          })
          break

        case 'tool-call-start':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_start',
            id: event.id,
            name: event.name,
          })
          break

        case 'tool-call-delta':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_delta',
            id: event.id,
            name: event.name,
            argumentsDelta: event.argumentsDelta,
          })
          break

        case 'tool-call-delta-end':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_delta_end',
            id: event.id,
          })
          break

        case 'tool-call-available':
          this.window.webContents.send(`llm:stream:${requestId}`, {
            type: 'tool_call_available',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          })
          break

        case 'error':
          this.window.webContents.send(`llm:error:${requestId}`, {
            message: event.error.message,
            code: event.error.code,
            retryable: event.error.retryable,
          })
          break

        case 'done':
          logger.llm.info('[StreamingService] Sending done event', { requestId, channel: `llm:done:${requestId}` })
          this.window.webContents.send(`llm:done:${requestId}`, {
            usage: event.usage ? {
              promptTokens: event.usage.inputTokens,
              completionTokens: event.usage.outputTokens,
              totalTokens: event.usage.totalTokens,
              cachedInputTokens: event.usage.cachedInputTokens,
              reasoningTokens: event.usage.reasoningTokens,
            } : undefined,
            metadata: event.metadata,
          })
          break
      }
    } catch (error) {
      logger.llm.warn('[StreamingService] Failed to send event:', error)
    }
  }
}
