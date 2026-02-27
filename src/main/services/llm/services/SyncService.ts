/**
 * 同步服务 - 使用 AI SDK 6.0 generateText
 * 用于后台任务、上下文压缩等
 */

import { generateText } from 'ai'
import { logger } from '@shared/utils/Logger'
import { createModel } from '../modelFactory'
import { MessageConverter } from '../core/MessageConverter'
import { ToolConverter } from '../core/ToolConverter'
import { applyCaching, getCacheConfig } from '../core/PromptCache'
import { LLMError, convertUsage } from '../types'
import type { LLMResponse } from '../types'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'

export interface SyncParams {
  config: LLMConfig
  messages: LLMMessage[]
  tools?: ToolDefinition[]
  systemPrompt?: string
}

export class SyncService {
  private messageConverter: MessageConverter
  private toolConverter: ToolConverter

  constructor() {
    this.messageConverter = new MessageConverter()
    this.toolConverter = new ToolConverter()
  }

  /**
   * 同步生成文本
   */
  async generate(params: SyncParams): Promise<LLMResponse<string>> {
    const { config, messages, tools, systemPrompt } = params

    logger.system.info('[SyncService] Starting generation', {
      provider: config.provider,
      model: config.model,
      messageCount: messages.length,
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

      // 同步生成
      const result = await generateText({
        model,
        messages: coreMessages,
        tools: coreTools,
        maxOutputTokens: config.maxTokens || 1000,
        temperature: config.temperature ?? 0.3,
        // topP 为 1 时等于默认行为，无需传递；且部分模型不允许与 temperature 共存
        topP: config.topP !== undefined && config.topP < 1 ? config.topP : undefined,
        topK: config.topK,
        seed: config.seed,
      })

      return {
        data: result.text,
        usage: result.usage ? convertUsage(result.usage) : undefined,
        metadata: {
          id: result.response.id,
          modelId: result.response.modelId,
          timestamp: result.response.timestamp,
          finishReason: result.finishReason,
        },
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[SyncService] Generation failed:', llmError)
      throw llmError
    }
  }
}
