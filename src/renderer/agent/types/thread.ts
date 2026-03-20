/**
 * Thread and thread-scoped runtime state.
 */

import type { ToolCall, ToolStreamingPreview } from '@/shared/types'
import type { ChatMessage } from './messages'
import type { ContextItem } from './context'
import type { StructuredSummary } from '../context/types'
import type { CompressionStats } from '../core/types'

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Present-tense copy used by the UI for the active task label. */
  activeForm: string
}

export type StreamPhase = 'idle' | 'streaming' | 'tool_pending' | 'tool_running' | 'error'

export type CompressionPhase = 'idle' | 'analyzing' | 'compressing' | 'summarizing' | 'done'

/** Thread-local streaming state for the current agent run. */
export interface StreamState {
  phase: StreamPhase
  currentToolCall?: ToolCall
  error?: string
  statusText?: string
}

/** Complete persisted thread record plus thread-scoped ephemeral preview state. */
export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number

  messages: ChatMessage[]
  contextItems: ContextItem[]

  streamState: StreamState
  toolStreamingPreviews?: Record<string, ToolStreamingPreview>

  compressionStats: CompressionStats | null
  contextSummary: StructuredSummary | null
  handoffRequired: boolean
  isCompacting: boolean
  compressionPhase: CompressionPhase

  todos?: TodoItem[]

  handoffContext?: string
  pendingObjective?: string
  pendingSteps?: string[]
}
