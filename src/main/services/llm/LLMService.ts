/**
 * LLM 服务 - 统一入口
 * 完全重构，使用 AI SDK 6.0 新 API
 */

import { BrowserWindow } from 'electron'
import { StreamingService } from './services/StreamingService'
import { SyncService } from './services/SyncService'
import { StructuredService } from './services/StructuredService'
import { EmbeddingService } from './services/EmbeddingService'
import type { LLMConfig, LLMMessage, ToolDefinition } from '@shared/types'
import type {
  LLMResponse,
  CodeAnalysis,
  Refactoring,
  CodeFix,
  TestCase,
} from './types'

export class LLMService {
  private streamingService: StreamingService
  private syncService: SyncService
  private structuredService: StructuredService
  private embeddingService: EmbeddingService
  private currentAbortController: AbortController | null = null

  constructor(window: BrowserWindow) {
    this.streamingService = new StreamingService(window)
    this.syncService = new SyncService()
    this.structuredService = new StructuredService()
    this.embeddingService = new EmbeddingService()
  }

  // 流式生成
  async sendMessage(params: {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
    activeTools?: string[]
  }) {
    this.currentAbortController = new AbortController()
    try {
      return await this.streamingService.generate({
        ...params,
        abortSignal: this.currentAbortController.signal,
      })
    } finally {
      this.currentAbortController = null
    }
  }

  abort() {
    this.currentAbortController?.abort()
    this.currentAbortController = null
  }

  // 同步生成
  async sendMessageSync(params: {
    config: LLMConfig
    messages: LLMMessage[]
    tools?: ToolDefinition[]
    systemPrompt?: string
  }): Promise<LLMResponse<string>> {
    return await this.syncService.generate(params)
  }

  // 结构化输出
  async analyzeCode(params: {
    config: LLMConfig
    code: string
    language: string
    filePath: string
  }): Promise<LLMResponse<CodeAnalysis>> {
    return await this.structuredService.analyzeCode(params)
  }

  async suggestRefactoring(params: {
    config: LLMConfig
    code: string
    language: string
    intent: string
  }): Promise<LLMResponse<Refactoring>> {
    return await this.structuredService.suggestRefactoring(params)
  }

  async suggestFixes(params: {
    config: LLMConfig
    code: string
    language: string
    diagnostics: Array<{
      message: string
      line: number
      column: number
      severity: number
    }>
  }): Promise<LLMResponse<CodeFix>> {
    return await this.structuredService.suggestFixes(params)
  }

  async generateTests(params: {
    config: LLMConfig
    code: string
    language: string
    framework?: string
  }): Promise<LLMResponse<TestCase>> {
    return await this.structuredService.generateTests(params)
  }

  async analyzeCodeStream(
    params: {
      config: LLMConfig
      code: string
      language: string
      filePath: string
    },
    onPartial: (partial: Partial<CodeAnalysis>) => void
  ): Promise<LLMResponse<CodeAnalysis>> {
    return await this.structuredService.analyzeCodeStream(params, onPartial)
  }

  // Embeddings
  async embedText(text: string, config: LLMConfig): Promise<LLMResponse<number[]>> {
    return await this.embeddingService.embedText(text, config)
  }

  async embedMany(texts: string[], config: LLMConfig): Promise<LLMResponse<number[][]>> {
    return await this.embeddingService.embedMany(texts, config)
  }

  async findSimilar(
    query: string,
    candidates: string[],
    config: LLMConfig,
    topK?: number
  ) {
    return await this.embeddingService.findMostSimilar(query, candidates, config, topK)
  }

  destroy() {
    this.abort()
  }
}

// 导出类型
export type { CodeAnalysis, Refactoring, CodeFix, TestCase, LLMResponse }
export { LLMError } from './types'
