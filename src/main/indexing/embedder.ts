/**
 * Embedding 服务
 * 支持多个免费/付费 Embedding API 提供商
 * 包含速率限制和重试机制
 * 
 * Custom provider 支持：
 * 1. 任何兼容 OpenAI API 的服务
 * 2. 使用 LLM 配置的 Embeddings（通过 AI SDK 6.0）
 */

import {
  EmbeddingConfig,
  EmbeddingProvider,
  DEFAULT_EMBEDDING_MODELS,
  EMBEDDING_ENDPOINTS,
} from './types'
import { logger } from '@shared/utils/Logger'
import type { LLMConfig } from '@shared/types'

// 每个 provider 支持的模型前缀/关键词
const PROVIDER_MODEL_PATTERNS: Record<string, RegExp> = {
  jina: /^jina-/i,
  voyage: /^voyage-/i,
  openai: /^text-embedding/i,
  cohere: /^embed-/i,
  huggingface: /^sentence-transformers\//i,
  ollama: /^(nomic|llama|mxbai)/i,
  transformers: /^Xenova\//i,
}

// 每个 provider 的速率限制配置（保守值，适用于免费账户）
const RATE_LIMITS: Record<EmbeddingProvider, { rpm: number; batchSize: number }> = {
  jina: { rpm: 60, batchSize: 100 },
  voyage: { rpm: 3, batchSize: 8 },
  openai: { rpm: 60, batchSize: 100 },
  cohere: { rpm: 100, batchSize: 96 },
  huggingface: { rpm: 30, batchSize: 1 },
  ollama: { rpm: 1000, batchSize: 1 },
  transformers: { rpm: 10000, batchSize: 32 }, // 本地运行，限制主要取决于 CPU
  custom: { rpm: 60, batchSize: 50 },
}

/**
 * 简单的速率限制器
 */
class RateLimiter {
  private lastRequestTime = 0
  private readonly minInterval: number // 毫秒

  constructor(rpm: number) {
    this.minInterval = Math.ceil(60000 / rpm)
  }

  async wait(): Promise<void> {
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    if (elapsed < this.minInterval) {
      await this.sleep(this.minInterval - elapsed)
    }
    this.lastRequestTime = Date.now()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export class EmbeddingService {
  private config: EmbeddingConfig
  private rateLimiter: RateLimiter
  private batchSize: number
  private llmConfig: LLMConfig | null = null
  private useLLMEmbeddings: boolean = false

  constructor(config: EmbeddingConfig, llmConfig?: LLMConfig) {
    this.config = {
      ...config,
      model: this.resolveModel(config.provider, config.model),
    }
    const limits = RATE_LIMITS[config.provider]
    this.rateLimiter = new RateLimiter(limits.rpm)
    this.batchSize = limits.batchSize

    // 如果提供了 LLM 配置且 provider 是 custom，则使用 LLM Embeddings
    if (llmConfig && config.provider === 'custom' && !config.baseUrl) {
      this.llmConfig = llmConfig
      this.useLLMEmbeddings = true
    }
  }

  /**
   * 设置 LLM 配置（用于 custom provider 使用 LLM Embeddings）
   */
  setLLMConfig(llmConfig: LLMConfig): void {
    this.llmConfig = llmConfig
    if (this.config.provider === 'custom' && !this.config.baseUrl) {
      this.useLLMEmbeddings = true
    }
  }

  /**
   * 解析并验证 model，确保与 provider 匹配
   */
  private resolveModel(provider: string, model?: string): string {
    // 自定义服务直接使用用户指定的 model
    if (provider === 'custom') {
      return model || ''
    }

    if (!model) {
      return DEFAULT_EMBEDDING_MODELS[provider as keyof typeof DEFAULT_EMBEDDING_MODELS] || ''
    }

    const pattern = PROVIDER_MODEL_PATTERNS[provider]
    if (pattern && !pattern.test(model)) {
      logger.index.warn(
        `[EmbeddingService] Model "${model}" doesn't match provider "${provider}", using default: ${DEFAULT_EMBEDDING_MODELS[provider as keyof typeof DEFAULT_EMBEDDING_MODELS]}`
      )
      return DEFAULT_EMBEDDING_MODELS[provider as keyof typeof DEFAULT_EMBEDDING_MODELS] || ''
    }

    return model
  }

  /**
   * 更新配置
   * 当切换 provider 时，如果没有指定新 model，则使用新 provider 的默认 model
   */
  updateConfig(config: Partial<EmbeddingConfig>): void {
    const newProvider = config.provider || this.config.provider
    const providerChanged = config.provider && config.provider !== this.config.provider

    // 如果切换了 provider 且没有指定新 model，使用新 provider 的默认 model
    const modelToUse = providerChanged ? config.model : (config.model || this.config.model)
    const newModel = this.resolveModel(newProvider, modelToUse)

    this.config = {
      ...this.config,
      ...config,
      model: newModel,
    }

    // 更新速率限制器
    if (config.provider) {
      const limits = RATE_LIMITS[config.provider]
      this.rateLimiter = new RateLimiter(limits.rpm)
      this.batchSize = limits.batchSize
    }
  }

  /**
   * 获取单个文本的 embedding
   */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text])
    return results[0]
  }

  /**
   * 批量获取 embedding（自动分批 + 速率限制 + 重试）
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const results: number[][] = []

    // 按 batchSize 分批处理
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)

      // 等待速率限制
      await this.rateLimiter.wait()

      // 带重试的请求
      const batchResults = await this.embedWithRetry(batch)
      results.push(...batchResults)
    }

    return results
  }

  /**
   * 带重试的 embedding 请求
   */
  private async embedWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.embedSingle(texts)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // 429 错误需要等待更长时间
        if (lastError.message.includes('429')) {
          const waitTime = Math.pow(2, attempt + 1) * 20000 // 20s, 40s, 80s
          logger.index.warn(`[EmbeddingService] Rate limited, waiting ${waitTime / 1000}s before retry...`)
          await this.sleep(waitTime)
        } else if (attempt < maxRetries - 1) {
          // 其他错误短暂等待后重试
          await this.sleep(1000 * (attempt + 1))
        }
      }
    }

    throw lastError || new Error('Embedding failed after retries')
  }

  /**
   * 单次 embedding 请求（不带重试）
   */
  private async embedSingle(texts: string[]): Promise<number[][]> {
    // Custom provider 且配置了 LLM，使用 LLM Embeddings
    if (this.useLLMEmbeddings && this.llmConfig) {
      return this.embedLLM(texts)
    }

    switch (this.config.provider) {
      case 'jina':
        return this.embedJina(texts)
      case 'voyage':
        return this.embedVoyage(texts)
      case 'openai':
        return this.embedOpenAI(texts)
      case 'cohere':
        return this.embedCohere(texts)
      case 'huggingface':
        return this.embedHuggingFace(texts)
      case 'ollama':
        return this.embedOllama(texts)
      case 'transformers':
        return this.embedTransformers(texts)
      case 'custom':
        return this.embedCustom(texts)
      default:
        throw new Error(`Unsupported embedding provider: ${this.config.provider}`)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 使用 LLM 配置的 Embeddings（通过 AI SDK 6.0）
   * 当 provider 为 'custom' 且没有 baseUrl 时使用
   */
  private async embedLLM(texts: string[]): Promise<number[][]> {
    if (!this.llmConfig) {
      throw new Error('LLM config not set. Call setLLMConfig() first.')
    }

    // 动态导入 LLM Embeddings 服务
    const { EmbeddingService: LLMEmbeddingService } = await import('../services/llm/services/EmbeddingService')
    const embeddingService = new LLMEmbeddingService()

    const response = await embeddingService.embedMany(texts, this.llmConfig)
    return response.data
  }


  /**
   * Jina AI Embedding
   */
  private async embedJina(texts: string[]): Promise<number[][]> {
    const url = this.config.baseUrl || EMBEDDING_ENDPOINTS.jina

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Jina API error: ${response.status} - ${error}`)
    }

    const data = (await response.json()) as { data: { embedding: number[] }[] }
    return data.data.map((item: { embedding: number[] }) => item.embedding)
  }

  /**
   * Voyage AI Embedding
   */
  private async embedVoyage(texts: string[]): Promise<number[][]> {
    const url = this.config.baseUrl || EMBEDDING_ENDPOINTS.voyage

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Voyage API error: ${response.status} - ${error}`)
    }

    const data = (await response.json()) as { data: { embedding: number[] }[] }
    return data.data.map((item: { embedding: number[] }) => item.embedding)
  }

  /**
   * OpenAI Embedding
   */
  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    const url = this.config.baseUrl || EMBEDDING_ENDPOINTS.openai

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} - ${error}`)
    }

    const data = (await response.json()) as { data: { embedding: number[]; index: number }[] }
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(item => item.embedding)
  }

  /**
   * Cohere Embedding
   */
  private async embedCohere(texts: string[]): Promise<number[][]> {
    const url = this.config.baseUrl || EMBEDDING_ENDPOINTS.cohere

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        texts: texts,
        input_type: 'search_document',
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Cohere API error: ${response.status} - ${error}`)
    }

    const data = (await response.json()) as { embeddings: number[][] }
    return data.embeddings
  }

  /**
   * HuggingFace Inference API
   */
  private async embedHuggingFace(texts: string[]): Promise<number[][]> {
    const model = this.config.model || 'sentence-transformers/all-MiniLM-L6-v2'
    const url = this.config.baseUrl || `${EMBEDDING_ENDPOINTS.huggingface}/${model}`

    const results: number[][] = []

    for (const text of texts) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: text }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`HuggingFace API error: ${response.status} - ${error}`)
      }

      const data = (await response.json()) as number[] | number[][]
      if (Array.isArray(data) && Array.isArray(data[0])) {
        results.push(this.meanPooling(data as number[][]))
      } else {
        results.push(data as number[])
      }
    }

    return results
  }

  /**
   * Ollama 本地 Embedding
   */
  private async embedOllama(texts: string[]): Promise<number[][]> {
    const url = this.config.baseUrl || EMBEDDING_ENDPOINTS.ollama
    const results: number[][] = []

    for (const text of texts) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: text,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Ollama API error: ${response.status} - ${error}`)
      }

      const data = (await response.json()) as { embedding: number[] }
      results.push(data.embedding)
    }

    return results
  }

  /**
   * 自定义 Embedding 服务（兼容 OpenAI API 格式）
   * 支持任何兼容 OpenAI embeddings API 的服务
   */
  private async embedCustom(texts: string[]): Promise<number[][]> {
    if (!this.config.baseUrl) {
      throw new Error('Custom embedding service requires baseUrl')
    }

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model || 'default',
        input: texts,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Custom embedding API error: ${response.status} - ${error}`)
    }

    const data = (await response.json()) as { data: { embedding: number[]; index?: number }[] }

    // 处理可能有 index 字段的情况
    if (data.data[0]?.index !== undefined) {
      return data.data
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(item => item.embedding)
    }

    return data.data.map(item => item.embedding)
  }

  /**
   * 平均池化（用于 HuggingFace token embeddings）
   */
  private meanPooling(tokenEmbeddings: number[][]): number[] {
    if (tokenEmbeddings.length === 0) return []

    const dim = tokenEmbeddings[0].length
    const result = new Array(dim).fill(0)

    for (const embedding of tokenEmbeddings) {
      for (let i = 0; i < dim; i++) {
        result[i] += embedding[i]
      }
    }

    for (let i = 0; i < dim; i++) {
      result[i] /= tokenEmbeddings.length
    }

    return result
  }

  /**
   * Transformers.js 本地 Embedding
   */
  private static transformersPipeline: any = null
  private static loadingPromise: Promise<any> | null = null

  private async embedTransformers(texts: string[]): Promise<number[][]> {
    const model = this.config.model || 'Xenova/all-MiniLM-L6-v2'

    // 懒加载 pipeline (带竞态条件处理)
    if (!EmbeddingService.transformersPipeline) {
      if (!EmbeddingService.loadingPromise) {
        EmbeddingService.loadingPromise = (async () => {
          logger.index.info('[EmbeddingService] Loading local transformers model:', model)
          try {
            const { pipeline, env } = await import('@xenova/transformers')

            // 配置缓存目录
            if (this.config.cacheDir) {
              env.cacheDir = this.config.cacheDir
            }
            env.allowLocalModels = false // 允许从 HF 下载

            const pipe = await pipeline('feature-extraction', model, {
              quantized: true,
            })

            EmbeddingService.transformersPipeline = pipe
            logger.index.info('[EmbeddingService] Local model loaded successfully')
            return pipe
          } catch (e) {
            logger.index.error('[EmbeddingService] Failed to load local model:', e)
            EmbeddingService.loadingPromise = null // Reset on error
            throw e
          }
        })()
      }

      await EmbeddingService.loadingPromise
    }

    const extractor = EmbeddingService.transformersPipeline
    const results: number[][] = []

    for (const text of texts) {
      // 使用 mean pooling 和 normalization
      const output = await extractor(text, { pooling: 'mean', normalize: true })
      // output.data 是 Float32Array
      results.push(Array.from(output.data))
    }

    return results
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<{ success: boolean; error?: string; latency?: number }> {
    const start = Date.now()

    try {
      await this.embed('test connection')
      return {
        success: true,
        latency: Date.now() - start,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
