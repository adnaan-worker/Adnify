/**
 * 上下文管理模块
 */

// 新的压缩管理器（推荐使用）
export {
  prepareMessages,
  updateStats,
  calculateLevel,
  estimateTokens,
  estimateMessagesTokens,
  LEVEL_NAMES,
  type CompressionLevel,
  type CompressionStats,
  type PrepareResult,
} from './CompressionManager'

// 旧的压缩模块（保留兼容）
export {
  pruneMessages,
  getCompressionLevel,
  isOverflow,
  estimateTotalTokens,
  getMessageContent,
  COMPRESSION_LEVEL_NAMES,
  getPruneMinimum,
  getPruneProtect,
  type CompactionResult,
} from './compaction'

// 摘要服务
export {
  generateSummary,
  generateHandoffDocument,
  type SummaryResult,
} from './summaryService'

// Handoff 管理
export { buildHandoffContext, buildWelcomeMessage } from './HandoffManager'

// 类型
export type {
  StructuredSummary,
  HandoffDocument,
  FileChangeRecord,
} from './types'
