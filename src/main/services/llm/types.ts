/**
 * LLM 服务类型定义
 */

import type { LanguageModelUsage } from 'ai'
import { mapAISDKError, ErrorCode } from '@shared/utils/errorHandler'

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

/**
 * LLM 错误类
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly retryable: boolean = false,
    public readonly status?: number,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'LLMError'
    Error.captureStackTrace?.(this, LLMError)
  }

  /**
   * 从 AI SDK 错误创建 LLMError
   */
  static fromAISDKError(error: Error, status?: number): LLMError {
    const mapped = mapAISDKError(error)
    return new LLMError(mapped.message, mapped.code, mapped.retryable, status, error)
  }

  /**
   * 从任意错误创建 LLMError
   */
  static fromError(error: unknown): LLMError {
    if (error instanceof LLMError) {
      return error
    }

    if (error instanceof Error) {
      return LLMError.fromAISDKError(error)
    }

    if (typeof error === 'string') {
      return new LLMError(error, ErrorCode.UNKNOWN, false)
    }

    return new LLMError('Unknown error', ErrorCode.UNKNOWN, false)
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      retryable: this.retryable,
      status: this.status,
    }
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
// 工具函数
// ============================================

export function convertUsage(usage: LanguageModelUsage): TokenUsage {
  const usageAny = usage as any
  return {
    inputTokens: usage.inputTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || 0,
    cachedInputTokens: usageAny.inputDetails?.cacheReadTokens,
    reasoningTokens: usageAny.outputDetails?.reasoningTokens,
  }
}
