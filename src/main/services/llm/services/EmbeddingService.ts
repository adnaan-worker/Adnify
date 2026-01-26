/**
 * Embeddings 服务 - 使用 AI SDK 6.0 embed/embedMany
 * 用于代码语义搜索、相似度匹配、RAG
 */

import { embed, embedMany, cosineSimilarity } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { logger } from '@shared/utils/Logger'
import { LLMError } from '../types'
import type { LLMResponse } from '../types'
import type { LLMConfig } from '@shared/types'

export interface EmbeddingResult {
  embedding: number[]
}

export interface EmbeddingsResult {
  embeddings: number[][]
}

/**
 * 创建嵌入模型
 */
function createEmbeddingModel(config: LLMConfig) {
  const { provider, apiKey, baseUrl } = config

  if (provider === 'openai' || !provider || provider === 'custom') {
    const openai = createOpenAI({
      apiKey,
      baseURL: baseUrl,
    })
    return openai.textEmbeddingModel('text-embedding-3-small')
  }

  throw new Error(`Embeddings not supported for provider: ${provider}`)
}

export class EmbeddingService {
  /**
   * 生成单个文本的向量嵌入
   */
  async embedText(text: string, config: LLMConfig): Promise<LLMResponse<number[]>> {
    logger.system.info('[EmbeddingService] Embedding text', {
      provider: config.provider,
      textLength: text.length,
    })

    try {
      const model = createEmbeddingModel(config)

      const result = await embed({
        model,
        value: text,
      })

      return {
        data: result.embedding,
        usage: result.usage
          ? {
              inputTokens: result.usage.tokens || 0,
              outputTokens: 0,
              totalTokens: result.usage.tokens || 0,
            }
          : undefined,
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[EmbeddingService] Embedding failed:', llmError)
      throw llmError
    }
  }

  /**
   * 批量生成向量嵌入
   */
  async embedMany(texts: string[], config: LLMConfig): Promise<LLMResponse<number[][]>> {
    logger.system.info('[EmbeddingService] Embedding multiple texts', {
      provider: config.provider,
      count: texts.length,
    })

    try {
      const model = createEmbeddingModel(config)

      const result = await embedMany({
        model,
        values: texts,
      })

      return {
        data: result.embeddings,
        usage: result.usage
          ? {
              inputTokens: result.usage.tokens || 0,
              outputTokens: 0,
              totalTokens: result.usage.tokens || 0,
            }
          : undefined,
      }
    } catch (error) {
      const llmError = LLMError.fromError(error)
      logger.system.error('[EmbeddingService] Batch embedding failed:', llmError)
      throw llmError
    }
  }

  /**
   * 计算余弦相似度（使用 AI SDK 内置实现）
   */
  cosineSimilarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b)
  }

  /**
   * 查找最相似的文本
   */
  async findMostSimilar(
    query: string,
    candidates: string[],
    config: LLMConfig,
    topK: number = 5
  ): Promise<Array<{ text: string; similarity: number; index: number }>> {
    // 生成查询向量
    const queryResult = await this.embedText(query, config)
    const queryEmbedding = queryResult.data

    // 生成候选向量
    const candidatesResult = await this.embedMany(candidates, config)
    const candidateEmbeddings = candidatesResult.data

    // 计算相似度
    const similarities = candidateEmbeddings.map((embedding, index) => ({
      text: candidates[index],
      similarity: this.cosineSimilarity(queryEmbedding, embedding),
      index,
    }))

    // 排序并返回 top K
    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
  }
}
