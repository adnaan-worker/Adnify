/**
 * Agent 核心类型定义
 */

import type { WorkMode } from '@/renderer/modes/types'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMConfig as SharedLLMConfig } from '@/shared/types/llm'

// ===== LLM 配置（扩展 shared 定义，添加 contextLimit） =====

export interface LLMConfig extends SharedLLMConfig {
  /** 模型上下文限制（用于压缩判断） */
  contextLimit?: number
}

// ===== 执行上下文 =====

export interface ExecutionContext {
  workspacePath: string | null
  chatMode: WorkMode
  abortSignal?: AbortSignal
}

// ===== 工具执行上下文 =====

export interface ToolExecutionContext {
  workspacePath: string | null
  currentAssistantId: string | null
}

// ===== LLM 调用结果 =====

export interface LLMCallResult {
  content?: string
  toolCalls?: ToolCall[]
  usage?: TokenUsage
  error?: string
}

// ===== 循环检测结果 =====

export interface LoopCheckResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
}

// ===== 压缩统计（从 CompressionManager 导出） =====

export type { CompressionStats, CompressionLevel } from '../context/CompressionManager'

// ===== 工具执行结果 =====

export interface ToolExecutionResult {
  toolCall: ToolCall
  result: {
    content: string
    meta?: Record<string, unknown>
  }
}

// ===== 重新导出 =====

export type { ToolCall, TokenUsage }
