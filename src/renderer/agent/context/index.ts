/**
 * 上下文管理模块
 * 
 * 提供多级压缩策略，确保永不丢失关键信息
 */

export { contextManager, ContextManager } from './ContextManager'
export type { CompressionStats } from './ContextManager'
export { estimateTokens, estimateMessageTokens, estimateTotalTokens } from './TokenEstimator'
export { truncateToolResult, truncateMessage } from './MessageTruncator'
export { scoreMessage, scoreMessageGroup, extractDecisionPoints, extractFileChanges } from './ImportanceScorer'
export { generateQuickSummary, generateHandoffDocument, handoffToSystemPrompt, buildSummaryPrompt } from './SummaryGenerator'
export { buildHandoffContext, buildWelcomeMessage } from './HandoffManager'

export type {
  CompressionLevel,
  LevelConfig,
  MessageImportance,
  DecisionPoint,
  FileChangeRecord,
  StructuredSummary,
  HandoffDocument,
  ContextConfig,
  ContextStats,
  OptimizedContext,
  MessageGroup,
} from './types'

export { COMPRESSION_LEVELS, DEFAULT_CONTEXT_CONFIG } from './types'
