/**
 * Agent 配置管理
 * 集中管理 Agent 运行时配置
 * 
 * 使用 src/shared/config/agentConfig.ts 作为配置源
 */

import { useStore } from '@store'
import { DEFAULT_AGENT_CONFIG, type AgentRuntimeConfig } from '@/shared/config/agentConfig'
import { getReadOnlyTools } from '@/shared/config/tools'

// 重新导出类型
export type { AgentRuntimeConfig }

/**
 * 从 store 获取动态配置
 * 合并用户配置和默认配置
 */
export function getAgentConfig(): AgentRuntimeConfig {
    const agentConfig = useStore.getState().agentConfig || {}
    return {
        // 基础配置
        maxToolLoops: agentConfig.maxToolLoops ?? DEFAULT_AGENT_CONFIG.maxToolLoops,
        maxHistoryMessages: agentConfig.maxHistoryMessages ?? DEFAULT_AGENT_CONFIG.maxHistoryMessages,

        // 上下文限制
        maxToolResultChars: agentConfig.maxToolResultChars ?? DEFAULT_AGENT_CONFIG.maxToolResultChars,
        maxFileContentChars: agentConfig.maxFileContentChars ?? DEFAULT_AGENT_CONFIG.maxFileContentChars,
        maxTotalContextChars: agentConfig.maxTotalContextChars ?? DEFAULT_AGENT_CONFIG.maxTotalContextChars,
        maxContextTokens: agentConfig.maxContextTokens ?? DEFAULT_AGENT_CONFIG.maxContextTokens,
        maxSingleFileChars: agentConfig.maxSingleFileChars ?? DEFAULT_AGENT_CONFIG.maxSingleFileChars,
        maxContextFiles: agentConfig.maxContextFiles ?? DEFAULT_AGENT_CONFIG.maxContextFiles,
        maxSemanticResults: agentConfig.maxSemanticResults ?? DEFAULT_AGENT_CONFIG.maxSemanticResults,
        maxTerminalChars: agentConfig.maxTerminalChars ?? DEFAULT_AGENT_CONFIG.maxTerminalChars,

        // 重试配置
        maxRetries: agentConfig.maxRetries ?? DEFAULT_AGENT_CONFIG.maxRetries,
        retryDelayMs: agentConfig.retryDelayMs ?? DEFAULT_AGENT_CONFIG.retryDelayMs,
        retryBackoffMultiplier: DEFAULT_AGENT_CONFIG.retryBackoffMultiplier,

        // 工具执行
        toolTimeoutMs: agentConfig.toolTimeoutMs ?? DEFAULT_AGENT_CONFIG.toolTimeoutMs,
        enableAutoFix: agentConfig.enableAutoFix ?? DEFAULT_AGENT_CONFIG.enableAutoFix,

        // 上下文压缩
        keepRecentTurns: agentConfig.keepRecentTurns ?? DEFAULT_AGENT_CONFIG.keepRecentTurns,
        deepCompressionTurns: agentConfig.deepCompressionTurns ?? DEFAULT_AGENT_CONFIG.deepCompressionTurns,
        maxImportantOldTurns: agentConfig.maxImportantOldTurns ?? DEFAULT_AGENT_CONFIG.maxImportantOldTurns,
        enableLLMSummary: agentConfig.enableLLMSummary ?? DEFAULT_AGENT_CONFIG.enableLLMSummary,
        autoHandoff: agentConfig.autoHandoff ?? DEFAULT_AGENT_CONFIG.autoHandoff,

        // 循环检测配置
        loopDetection: {
            maxHistory: agentConfig.loopDetection?.maxHistory ?? DEFAULT_AGENT_CONFIG.loopDetection.maxHistory,
            maxExactRepeats: agentConfig.loopDetection?.maxExactRepeats ?? DEFAULT_AGENT_CONFIG.loopDetection.maxExactRepeats,
            maxSameTargetRepeats: agentConfig.loopDetection?.maxSameTargetRepeats ?? DEFAULT_AGENT_CONFIG.loopDetection.maxSameTargetRepeats,
        },

        // 忽略目录
        ignoredDirectories: agentConfig.ignoredDirectories ?? DEFAULT_AGENT_CONFIG.ignoredDirectories,
    }
}

/**
 * 只读工具列表（可并行执行）
 * 从配置中心动态获取
 */
export const READ_TOOLS: readonly string[] = getReadOnlyTools()
