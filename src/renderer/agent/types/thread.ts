/**
 * 线程和流状态类型定义
 */

import type { ToolCall } from '@/shared/types'
import type { ChatMessage } from './messages'
import type { ContextItem } from './context'
import type { StructuredSummary } from '../context/types'
import type { CompressionStats } from '../core/types'

/** 任务项 */
export interface TodoItem {
  content: string       // 任务描述（祈使句）
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string    // 进行时描述（用于 UI 显示正在做什么）
}

/** 流阶段 */
export type StreamPhase = 'idle' | 'streaming' | 'tool_pending' | 'tool_running' | 'error'

/** 压缩阶段 */
export type CompressionPhase = 'idle' | 'analyzing' | 'compressing' | 'summarizing' | 'done'

/** 流状态（线程级别） */
export interface StreamState {
  phase: StreamPhase
  currentToolCall?: ToolCall
  error?: string
  statusText?: string
}

/** 聊天线程 - 包含所有线程相关状态 */
export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number

  // === 消息相关 ===
  messages: ChatMessage[]
  contextItems: ContextItem[]

  // === 执行状态（每个线程独立） ===
  streamState: StreamState

  // === 压缩状态（每个线程独立） ===
  compressionStats: CompressionStats | null
  contextSummary: StructuredSummary | null
  handoffRequired: boolean
  isCompacting: boolean
  compressionPhase: CompressionPhase

  // === 任务列表 ===
  todos?: TodoItem[]

  // === Handoff 相关 ===
  handoffContext?: string
  pendingObjective?: string
  pendingSteps?: string[]
}
