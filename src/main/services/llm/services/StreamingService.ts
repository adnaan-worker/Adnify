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
    const { config, messages, tools, systemPrompt, abortSignal } = params

    // 创建 thinking 策略（只为需要特殊处理的模型）
    const strategy = ThinkingStrategyFactory.create(config.model)
    strategy.reset?.()

    logger.system.info('[StreamingService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      hasCustomParser: !!strategy.parseStreamText,
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

      // 流式生成 - AI SDK 6.0 自动处理所有 reasoning
      const result = streamText({
        model,
        messages: coreMessages,
        tools: coreTools,
        maxOutputTokens: config.maxTokens,
        temperature: config.temperature,
        topP: config.topP,
        topK: config.topK,
        frequencyPenalty: config.frequencyPenalty,
        presencePenalty: config.presencePenalty,
        stopSequences: config.stopSequences,
        seed: config.seed,
        abortSignal,
      })

      // 处理流式响应
      return await this.processStream(result, strategy)
    } catch (error) {
      const llmError = LLMError.fromError(error)
      this.sendEvent({ type: 'error', error: llmError })
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
    strategy: ThinkingStrategy
  ): Promise<StreamingResult> {
    let reasoning = ''
    const hasCustomParser = !!strategy.parseStreamText

    for await (const part of result.fullStream) {
      if (this.window.isDestroyed()) break

      try {
        switch (part.type) {
          case 'text-delta':
            // 使用策略解析文本
            if (hasCustomParser && strategy.parseStreamText) {
              const parsed = strategy.parseStreamText(part.text)
              if (parsed.thinking) {
                reasoning += parsed.thinking
                this.sendEvent({
                  type: 'reasoning',
                  content: parsed.thinking,
                })
              }
              if (parsed.content) {
                this.sendEvent({
                  type: 'text',
                  content: parsed.content,
                })
              }
            } else {
              this.sendEvent({
                type: 'text',
                content: part.text,
              })
            }
            break

          case 'reasoning-delta':
            if (part.text) {
              reasoning += part.text
              this.sendEvent({
                type: 'reasoning',
                content: part.text,
              })
            }
            break

          case 'tool-call':
            this.sendEvent({
              type: 'tool-call',
              id: part.toolCallId,
              name: part.toolName,
              arguments: part.input as Record<string, unknown>,
            })
            break

          case 'error':
            const llmError = LLMError.fromError(part.error)
            this.sendEvent({ type: 'error', error: llmError })
            break
        }
      } catch (error) {
        if (!this.window.isDestroyed()) {
          logger.llm.warn('[StreamingService] Error processing stream part:', error)
        }
      }
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

    // 发送完成事件
    this.sendEvent({
      type: 'done',
      usage: streamingResult.usage,
      metadata: streamingResult.metadata,
    })

    return streamingResult
  }

  /**
   * 发送事件到渲染进程
   */
  private sendEvent(event: StreamEvent): void {
    if (this.window.isDestroyed()) return

    try {
      switch (event.type) {
        case 'text':
          this.window.webContents.send('llm:stream', {
            type: 'text',
            content: event.content,
          })
          break

        case 'reasoning':
          this.window.webContents.send('llm:stream', {
            type: 'reasoning',
            content: event.content,
          })
          break

        case 'tool-call':
          this.window.webContents.send('llm:toolCall', {
            type: 'tool_call',
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          })
          break

        case 'error':
          this.window.webContents.send('llm:error', {
            message: event.error.message,
            code: event.error.code,
            retryable: event.error.retryable,
          })
          break

        case 'done':
          this.window.webContents.send('llm:done', {
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
