/**
 * 上下文管理类型定义 v2
 * 
 * 多级压缩策略，永不丢失关键信息
 */

import type { OpenAIMessage } from '../llm/MessageConverter'
import { getReadOnlyTools, getWriteTools } from '@/shared/config/tools'

/** 压缩级别 */
export type CompressionLevel = 0 | 1 | 2 | 3 | 4

/** 压缩级别配置 */
export interface LevelConfig {
  /** 触发阈值（占上限的百分比） */
  threshold: number
  /** 目标压缩率（压缩后占上限的百分比） */
  target: number
  /** 描述 */
  description: string
}

/** 压缩级别配置表 */
export const COMPRESSION_LEVELS: Record<CompressionLevel, LevelConfig> = {
  0: { threshold: 0, target: 0.5, description: 'Full Context' },
  1: { threshold: 0.5, target: 0.65, description: 'Smart Truncation' },
  2: { threshold: 0.7, target: 0.75, description: 'Sliding Window + Summary' },
  3: { threshold: 0.85, target: 0.85, description: 'Deep Compression' },
  4: { threshold: 0.95, target: 0, description: 'Session Handoff' },
}

/** 获取压缩级别阈值 */
export function getLevelThresholds(): { l1: number; l2: number; l3: number; l4: number } {
  return {
    l1: COMPRESSION_LEVELS[1].threshold,
    l2: COMPRESSION_LEVELS[2].threshold,
    l3: COMPRESSION_LEVELS[3].threshold,
    l4: COMPRESSION_LEVELS[4].threshold,
  }
}

/** 消息重要性评分 */
export interface MessageImportance {
  /** 消息索引 */
  index: number
  /** 重要性分数 (0-100) */
  score: number
  /** 重要性原因 */
  reasons: string[]
  /** 是否可压缩 */
  compressible: boolean
}

/** 关键决策点 */
export interface DecisionPoint {
  /** 轮次索引 */
  turnIndex: number
  /** 决策类型 */
  type: 'file_create' | 'file_modify' | 'file_delete' | 'error_fix' | 'architecture' | 'user_correction'
  /** 决策描述 */
  description: string
  /** 涉及的文件 */
  files: string[]
  /** 原始消息索引 */
  messageIndex: number
}

/** 文件修改记录 */
export interface FileChangeRecord {
  path: string
  action: 'create' | 'modify' | 'delete'
  /** 修改摘要 */
  summary: string
  /** 修改轮次 */
  turnIndex: number
}

/** 结构化摘要 */
export interface StructuredSummary {
  /** 任务目标 */
  objective: string
  /** 已完成的步骤 */
  completedSteps: string[]
  /** 待完成的步骤 */
  pendingSteps: string[]
  /** 关键决策点 */
  decisions: DecisionPoint[]
  /** 文件修改记录 */
  fileChanges: FileChangeRecord[]
  /** 遇到的错误及解决方案 */
  errorsAndFixes: { error: string; fix: string }[]
  /** 用户的重要指示 */
  userInstructions: string[]
  /** 生成时间 */
  generatedAt: number
  /** 覆盖的轮次范围 */
  turnRange: [number, number]
}

/** Session Handoff 文档 */
export interface HandoffDocument {
  /** 会话 ID */
  fromSessionId: string
  /** 创建时间 */
  createdAt: number
  /** 结构化摘要 */
  summary: StructuredSummary
  /** 当前工作目录 */
  workingDirectory: string
  /** 关键文件内容快照（只保留最重要的几个） */
  keyFileSnapshots: { path: string; content: string; reason: string }[]
  /** 最后的用户请求 */
  lastUserRequest: string
  /** 建议的下一步 */
  suggestedNextSteps: string[]
}

/** 上下文配置 */
export interface ContextConfig {
  /** 最大 Token 数 */
  maxTokens: number
  /** 保留最近 N 轮对话（Level 2） */
  keepRecentTurns: number
  /** 深度压缩时保留的轮数（Level 3） */
  deepCompressionTurns: number
  /** L2 时保留的重要旧轮次数量 */
  maxImportantOldTurns: number
  /** 工具结果最大字符数 */
  maxToolResultChars: number
  /** 重要工具列表（结果保留更多） */
  importantTools: string[]
  /** 只读工具列表（结果可大幅截断） */
  readOnlyTools: string[]
  /** 是否启用 LLM 摘要 */
  enableLLMSummary: boolean
  /** 是否自动创建新会话（Level 4） */
  autoHandoff: boolean
}

/** 上下文统计 */
export interface ContextStats {
  originalTokens: number
  finalTokens: number
  savedPercent: number
  compressionLevel: CompressionLevel
  keptTurns: number
  compactedTurns: number
  /** 是否需要 Handoff */
  needsHandoff: boolean
}

/** 优化后的上下文 */
export interface OptimizedContext {
  messages: OpenAIMessage[]
  summary: StructuredSummary | null
  stats: ContextStats
  /** Handoff 文档（如果需要） */
  handoff?: HandoffDocument
}

/** 消息分组（一轮对话） */
export interface MessageGroup {
  /** 轮次索引 */
  turnIndex: number
  userIndex: number
  assistantIndex: number | null
  toolIndices: number[]
  tokens: number
  /** 重要性分数 */
  importance: number
  /** 是否包含写操作 */
  hasWriteOps: boolean
  /** 是否包含错误 */
  hasErrors: boolean
  /** 涉及的文件 */
  files: string[]
}

/** 默认配置（仅用于工具列表，其他值从 agentConfig 获取） */
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxTokens: 128000,
  keepRecentTurns: 5,
  deepCompressionTurns: 2,
  maxImportantOldTurns: 3,
  maxToolResultChars: 10000,
  importantTools: getWriteTools(),
  readOnlyTools: getReadOnlyTools(),
  enableLLMSummary: true,
  autoHandoff: true,
}
