/**
 * 线程和流状态类型定义
 */

import type { ToolCall } from '@/shared/types'
import type { ChatMessage } from './messages'
import type { ContextItem } from './context'
import type { StructuredSummary } from '../context/types'

/** 线程状态 */
export interface ThreadState {
  currentCheckpointIdx: number | null
  isStreaming: boolean
  pendingToolCall?: ToolCall
  error?: string
}

/** 聊天线程 */
export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number
  messages: ChatMessage[]
  contextItems: ContextItem[]
  state: ThreadState
  /** Handoff 上下文（从上一个会话继承，用于注入 system prompt） */
  handoffContext?: string
  /** 上下文压缩摘要 */
  contextSummary?: StructuredSummary | null
}

/** 流阶段 */
export type StreamPhase = 'idle' | 'streaming' | 'tool_pending' | 'tool_running' | 'error'

/** 流状态 */
export interface StreamState {
  phase: StreamPhase
  currentToolCall?: ToolCall
  error?: string
  statusText?: string
}
