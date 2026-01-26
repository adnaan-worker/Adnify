/**
 * LLM 服务类型定义
 * 统一的类型系统，避免使用 any
 */

import type { LanguageModelUsage } from 'ai'

// ============================================
// 基础类型
// ============================================

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export interface ResponseMetadata {
  id: string
  modelId: string
  timestamp: Date
  finishReason?: string
}

export interface LLMResponse<T> {
  data: T
  usage?: TokenUsage
  metadata?: ResponseMetadata
}

// ============================================
// 错误类型
// ============================================

export class LLMError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false,
    public status?: number,
    public cause?: Error
  ) {
    super(message)
    this.name = 'LLMError'
  }

  static fromError(error: unknown): LLMError {
    if (error instanceof LLMError) return error

    const err = error as { name?: string; message?: string; status?: number }

    // 中止错误
    if (err.name === 'AbortError') {
      return new LLMError('Request aborted', 'ABORTED', false)
    }

    // 速率限制
    if (err.status === 429) {
      return new LLMError('Rate limit exceeded', 'RATE_LIMIT', true, 429)
    }

    // 认证错误
    if (err.status === 401 || err.status === 403) {
      return new LLMError('Authentication failed', 'AUTH_ERROR', false, err.status)
    }

    // 网络错误
    if (err.message?.includes('network') || err.message?.includes('fetch')) {
      return new LLMError('Network error', 'NETWORK_ERROR', true)
    }

    // 未知错误
    return new LLMError(
      err.message || 'Unknown error',
      'UNKNOWN_ERROR',
      false,
      err.status
    )
  }
}

// ============================================
// 流式事件类型
// ============================================

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-delta'; id: string; name?: string; argumentsDelta: string }
  | { type: 'tool-call-delta-end'; id: string }
  | { type: 'tool-call-available'; id: string; name: string; arguments: Record<string, unknown> }
  | { type: 'error'; error: LLMError }
  | { type: 'done'; usage?: TokenUsage; metadata?: ResponseMetadata }

// ============================================
// 结构化输出类型
// ============================================

export interface CodeIssue {
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
  code?: string
  source?: string
}

export interface CodeSuggestion {
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  changes?: Array<{
    line: number
    oldText: string
    newText: string
  }>
}

export interface CodeAnalysis {
  issues: CodeIssue[]
  suggestions: CodeSuggestion[]
  summary: string
}

export interface RefactoringChange {
  type: 'replace' | 'insert' | 'delete'
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText?: string
}

export interface Refactoring {
  refactorings: Array<{
    title: string
    description: string
    confidence: 'high' | 'medium' | 'low'
    changes: RefactoringChange[]
    explanation: string
  }>
}

export interface CodeFix {
  fixes: Array<{
    diagnosticIndex: number
    title: string
    description: string
    changes: Array<{
      startLine: number
      startColumn: number
      endLine: number
      endColumn: number
      newText: string
    }>
    confidence: 'high' | 'medium' | 'low'
  }>
}

export interface TestCase {
  testCases: Array<{
    name: string
    description: string
    code: string
    type: 'unit' | 'integration' | 'edge-case'
  }>
  setup?: string
  teardown?: string
}

// ============================================
// 工具类型转换
// ============================================

export function convertUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || 0,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
  }
}
