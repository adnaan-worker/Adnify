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
  /** Orchestrator 阶段：planning = 只有编排工具, executing = 执行工具 */
  orchestratorPhase?: 'planning' | 'executing'
  abortSignal?: AbortSignal
  /** 绑定的线程 ID（用于后台任务隔离） */
  threadId?: string | null
}

// ===== 工具执行上下文（重新导出 shared 定义） =====

export type { ToolExecutionContext } from '@/shared/types'

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

// ===== 工具执行结果（Agent 内部使用，包含 toolCall 信息） =====

export interface AgentToolExecutionResult {
  toolCall: ToolCall
  result: {
    content: string
    meta?: Record<string, unknown>
    richContent?: import('@/shared/types').ToolRichContent[]
  }
}

// ===== 重新导出 =====

export type { ToolCall, TokenUsage }
