/**
 * Agent 模块统一导出
 */

// 类型（统一来源）
export * from './types'

// Store
export {
    useAgentStore,
    selectCurrentThread,
    selectMessages,
    selectStreamState,
    selectContextItems,
    selectIsStreaming,
    selectIsAwaitingApproval,
    selectBranches,
    selectActiveBranch,
    selectIsOnBranch,
    selectContextStats,
    selectInputPrompt,
    selectCurrentSessionId,
    selectCompressionStats,
    selectHandoffDocument,
    selectHandoffRequired,
    selectContextSummary,
    selectCompressionPhase,
    selectIsCompacting,
} from './store/AgentStore'
export type { ContextStats } from './store/AgentStore'

// 核心模块（新架构）
export { Agent, EventBus, approvalService } from './core'
export type { LLMConfig, AgentEvent, EventType } from './core'

// 工具系统
export {
    toolRegistry,
    TOOL_DEFINITIONS,
    TOOL_DISPLAY_NAMES,
} from './tools'
export { getToolApprovalType, getToolDisplayName } from '@/shared/config/tools'

// 其他服务
export { lintService } from './services/lintService'
export { streamingEditService } from './services/streamingEditService'
export { sessionService } from './services/sessionService'
export { rulesService } from './services/rulesService'
export { memoryService } from './services/memoryService'
export type { MemoryItem } from './services/memoryService'
export { skillService } from './services/skillService'
export type { SkillItem } from './services/skillService'
export { composerService } from './services/composerService'

// 上下文管理
export {
    prepareMessages,
    updateStats,
    calculateLevel,
    LEVEL_NAMES,
    buildHandoffContext,
    buildWelcomeMessage,
} from './context'
export type { CompressionLevel, CompressionStats, StructuredSummary, HandoffDocument } from './context'

// LLM 相关
export { buildContextContent, buildUserContent } from './llm/ContextBuilder'
export { buildLLMMessages } from './llm/MessageBuilder'

// 工具函数
export { parseXMLToolCalls, generateToolCallId } from './utils/XMLToolParser'
export { MentionParser, SPECIAL_MENTIONS } from './utils/MentionParser'
export type { MentionCandidate, MentionParseResult } from './utils/MentionParser'

// 配置
export { getAgentConfig } from './utils/AgentConfig'

// 重试工具（从 shared 导出）
export { isRetryableError } from '@shared/utils'

// Prompts
export { buildAgentSystemPrompt } from './prompts/PromptBuilder'

// 分支类型
export type { Branch } from './store/slices/branchSlice'
