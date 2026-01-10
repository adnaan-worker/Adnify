/**
 * 上下文管理器 v2
 * 
 * 多级压缩策略：
 * Level 0: Full Context - 完整保留
 * Level 1: Smart Truncation - 智能截断工具输出
 * Level 2: Sliding Window + Summary - 滑动窗口 + 摘要
 * Level 3: Deep Compression - 深度压缩，只保留关键信息
 * Level 4: Session Handoff - 生成 Handoff 文档，建议新会话
 */

import { logger } from '@utils/Logger'
import type { OpenAIMessage } from '../llm/MessageConverter'
import type { 
  ContextConfig, 
  OptimizedContext, 
  MessageGroup, 
  CompressionLevel,
  StructuredSummary,
  HandoffDocument,
} from './types'
import { DEFAULT_CONTEXT_CONFIG, COMPRESSION_LEVELS, getLevelThresholds } from './types'
import { estimateMessageTokens, estimateTotalTokens } from './TokenEstimator'
import { truncateToolResult } from './MessageTruncator'
import { scoreMessageGroup } from './ImportanceScorer'
import { generateQuickSummary, generateHandoffDocument, handoffToSystemPrompt } from './SummaryGenerator'
import { getAgentConfig } from '../utils/AgentConfig'
import { isWriteTool } from '@/shared/config/tools'

/** 压缩统计信息（用于 UI 显示） */
export interface CompressionStats {
  level: CompressionLevel
  levelName: string
  originalTokens: number
  finalTokens: number
  savedPercent: number
  keptTurns: number
  compactedTurns: number
  needsHandoff: boolean
  lastOptimizedAt: number
}

export class ContextManager {
  private summary: StructuredSummary | null = null
  private handoff: HandoffDocument | null = null
  private currentLevel: CompressionLevel = 0
  private sessionId: string = ''
  private lastStats: CompressionStats | null = null
  private llmSummaryPending: boolean = false

  /**
   * 设置会话 ID
   */
  setSessionId(id: string): void {
    this.sessionId = id
  }

  /**
   * 获取当前压缩级别
   */
  getCurrentLevel(): CompressionLevel {
    return this.currentLevel
  }

  /**
   * 获取当前摘要
   */
  getSummary(): StructuredSummary | null {
    return this.summary
  }

  /**
   * 设置摘要
   */
  setSummary(summary: StructuredSummary | null): void {
    this.summary = summary
  }

  /**
   * 获取 Handoff 文档
   */
  getHandoff(): HandoffDocument | null {
    return this.handoff
  }

  /**
   * 获取最新的压缩统计
   */
  getStats(): CompressionStats | null {
    return this.lastStats
  }

  /**
   * 清除状态
   */
  clear(): void {
    this.summary = null
    this.handoff = null
    this.currentLevel = 0
    this.lastStats = null
    this.llmSummaryPending = false
  }

  /**
   * 优化上下文（主入口）
   */
  optimize(
    messages: OpenAIMessage[],
    config: Partial<ContextConfig> = {}
  ): OptimizedContext {
    const cfg = this.mergeConfig(config)
    const originalTokens = estimateTotalTokens(messages)
    
    // 边界检查：如果消息太少，直接返回原始消息
    const nonSystemMessages = messages.filter(m => m.role !== 'system')
    if (nonSystemMessages.length === 0) {
      return {
        messages: [...messages], // 返回副本，避免引用问题
        summary: this.summary,
        stats: {
          originalTokens,
          finalTokens: originalTokens,
          savedPercent: 0,
          compressionLevel: 0,
          keptTurns: 0,
          compactedTurns: 0,
          needsHandoff: false,
        },
      }
    }
    
    // 确定压缩级别
    const level = this.determineLevel(originalTokens, cfg.maxTokens)
    this.currentLevel = level

    logger.agent.info(`[ContextManager] Level ${level}, tokens: ${originalTokens}/${cfg.maxTokens}`)

    let result: OptimizedContext

    switch (level) {
      case 0:
        result = this.level0FullContext(messages, originalTokens, cfg)
        break
      case 1:
        result = this.level1SmartTruncation(messages, originalTokens, cfg)
        break
      case 2:
        result = this.level2SlidingWindow(messages, originalTokens, cfg)
        break
      case 3:
        result = this.level3DeepCompression(messages, originalTokens, cfg)
        break
      case 4:
        result = this.level4SessionHandoff(messages, originalTokens, cfg)
        break
      default:
        result = this.level0FullContext(messages, originalTokens, cfg)
    }

    // 更新统计信息
    this.lastStats = {
      level,
      levelName: COMPRESSION_LEVELS[level].description,
      originalTokens: result.stats.originalTokens,
      finalTokens: result.stats.finalTokens,
      savedPercent: result.stats.savedPercent,
      keptTurns: result.stats.keptTurns,
      compactedTurns: result.stats.compactedTurns,
      needsHandoff: result.stats.needsHandoff,
      lastOptimizedAt: Date.now(),
    }

    return result
  }

  /**
   * 确定压缩级别
   */
  private determineLevel(tokens: number, maxTokens: number): CompressionLevel {
    const ratio = tokens / maxTokens
    const thresholds = getLevelThresholds()
    
    if (ratio < thresholds.l1) return 0
    if (ratio < thresholds.l2) return 1
    if (ratio < thresholds.l3) return 2
    if (ratio < thresholds.l4) return 3
    return 4
  }

  /**
   * Level 0: 完整保留
   */
  private level0FullContext(
    messages: OpenAIMessage[],
    originalTokens: number,
    _cfg: ContextConfig
  ): OptimizedContext {
    return {
      messages: [...messages], // 返回副本，避免引用问题
      summary: this.summary,
      stats: {
        originalTokens,
        finalTokens: originalTokens,
        savedPercent: 0,
        compressionLevel: 0,
        keptTurns: this.countTurns(messages),
        compactedTurns: 0,
        needsHandoff: false,
      },
    }
  }

  /**
   * Level 1: 智能截断工具输出
   */
  private level1SmartTruncation(
    messages: OpenAIMessage[],
    originalTokens: number,
    cfg: ContextConfig
  ): OptimizedContext {
    const truncatedMessages = this.truncateAllToolResults(messages, cfg)
    const finalTokens = estimateTotalTokens(truncatedMessages)

    logger.agent.info(`[ContextManager] Level 1: ${originalTokens} -> ${finalTokens} tokens`)

    return {
      messages: truncatedMessages,
      summary: this.summary,
      stats: {
        originalTokens,
        finalTokens,
        savedPercent: Math.round((1 - finalTokens / originalTokens) * 100),
        compressionLevel: 1,
        keptTurns: this.countTurns(messages),
        compactedTurns: 0,
        needsHandoff: false,
      },
    }
  }

  /**
   * Level 2: 滑动窗口 + 摘要
   */
  private level2SlidingWindow(
    messages: OpenAIMessage[],
    originalTokens: number,
    cfg: ContextConfig
  ): OptimizedContext {
    // 分离 system 消息
    const systemMsg = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    // 分组消息
    const groups = this.groupMessages(nonSystemMessages)
    
    // 边界检查：如果没有消息组，回退到 Level 1
    if (groups.length === 0) {
      return this.level1SmartTruncation(messages, originalTokens, cfg)
    }
    
    // 计算每组的重要性
    for (const group of groups) {
      group.importance = scoreMessageGroup(group, nonSystemMessages, groups)
    }

    // 保留最近 N 轮 + 高重要性的旧轮次
    const keepTurns = cfg.keepRecentTurns
    const recentGroups = groups.slice(-keepTurns)
    const olderGroups = groups.slice(0, -keepTurns)

    // 从旧轮次中选择高重要性的保留
    const importantOldGroups = olderGroups
      .filter(g => g.importance > 60 || g.hasWriteOps || g.hasErrors)
      .slice(-cfg.maxImportantOldTurns)

    // 生成或更新摘要（如果有被压缩的轮次）
    const compactedGroups = olderGroups.filter(g => !importantOldGroups.includes(g))
    if (compactedGroups.length > 0) {
      const turnRange: [number, number] = [
        compactedGroups[0].turnIndex,
        compactedGroups[compactedGroups.length - 1].turnIndex,
      ]
      
      // 生成新摘要（合并已有摘要）
      const newSummary = generateQuickSummary(nonSystemMessages, compactedGroups, turnRange)
      
      if (this.summary) {
        // 合并已有摘要
        this.summary = this.mergeSummaries(this.summary, newSummary)
      } else {
        this.summary = newSummary
      }
      
      // 异步触发 LLM 摘要（如果启用且尚未触发过）
      if (cfg.enableLLMSummary && !this.llmSummaryPending) {
        this.llmSummaryPending = true
        this.triggerLLMSummary(nonSystemMessages, compactedGroups, turnRange)
      }
    }

    // 构建保留的消息索引
    const keptGroups = [...importantOldGroups, ...recentGroups]
    const keptIndices = new Set<number>()
    for (const group of keptGroups) {
      keptIndices.add(group.userIndex)
      if (group.assistantIndex !== null) keptIndices.add(group.assistantIndex)
      for (const idx of group.toolIndices) keptIndices.add(idx)
    }

    // 构建最终消息列表
    const finalMessages: OpenAIMessage[] = []

    // 添加 system 消息（带摘要）
    if (systemMsg) {
      const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content : ''
      const summaryText = this.summary ? this.formatSummaryForSystem(this.summary) : ''
      const enhancedSystem = summaryText
        ? `${systemContent}\n\n${summaryText}`
        : systemContent

      finalMessages.push({ ...systemMsg, content: enhancedSystem })
    }

    // 添加保留的消息（截断工具结果）
    for (let i = 0; i < nonSystemMessages.length; i++) {
      if (!keptIndices.has(i)) continue

      const msg = nonSystemMessages[i]
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        const toolName = (msg as any).name || ''
        finalMessages.push({
          ...msg,
          content: truncateToolResult(msg.content, toolName, cfg),
        })
      } else {
        finalMessages.push(msg)
      }
    }

    const finalTokens = estimateTotalTokens(finalMessages)

    logger.agent.info(
      `[ContextManager] Level 2: ${originalTokens} -> ${finalTokens} tokens, ` +
      `kept ${keptGroups.length} turns, compacted ${compactedGroups.length} turns`
    )

    return {
      messages: finalMessages,
      summary: this.summary,
      stats: {
        originalTokens,
        finalTokens,
        savedPercent: Math.round((1 - finalTokens / originalTokens) * 100),
        compressionLevel: 2,
        keptTurns: keptGroups.length,
        compactedTurns: compactedGroups.length,
        needsHandoff: false,
      },
    }
  }

  /**
   * Level 3: 深度压缩
   */
  private level3DeepCompression(
    messages: OpenAIMessage[],
    originalTokens: number,
    cfg: ContextConfig
  ): OptimizedContext {
    const systemMsg = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')
    const groups = this.groupMessages(nonSystemMessages)

    // 边界检查：如果没有消息组，回退到 Level 1
    if (groups.length === 0) {
      logger.agent.warn('[ContextManager] No message groups in Level 3, falling back to Level 1')
      return this.level1SmartTruncation(messages, originalTokens, cfg)
    }

    // 只保留最近 2 轮 + 关键决策点
    const recentGroups = groups.slice(-cfg.deepCompressionTurns)
    const olderGroups = groups.slice(0, -cfg.deepCompressionTurns)

    // 生成完整摘要
    if (olderGroups.length > 0) {
      const turnRange: [number, number] = [0, olderGroups[olderGroups.length - 1].turnIndex]
      this.summary = generateQuickSummary(nonSystemMessages, olderGroups, turnRange)
      
      // Level 3 也触发 LLM 摘要（更重要，因为压缩更激进）
      if (cfg.enableLLMSummary) {
        this.triggerLLMSummary(nonSystemMessages, olderGroups, turnRange)
      }
    }

    // 构建最终消息
    const finalMessages: OpenAIMessage[] = []

    // System 消息 + 详细摘要
    if (systemMsg) {
      const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content : ''
      const summaryText = this.summary ? this.formatDetailedSummary(this.summary) : ''
      finalMessages.push({ ...systemMsg, content: `${systemContent}\n\n${summaryText}` })
    }

    // 只添加最近的消息（大幅截断）
    const keptIndices = new Set<number>()
    for (const group of recentGroups) {
      keptIndices.add(group.userIndex)
      if (group.assistantIndex !== null) keptIndices.add(group.assistantIndex)
      for (const idx of group.toolIndices) keptIndices.add(idx)
    }

    for (let i = 0; i < nonSystemMessages.length; i++) {
      if (!keptIndices.has(i)) continue

      const msg = nonSystemMessages[i]
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        // 深度压缩时，工具结果只保留很少
        finalMessages.push({
          ...msg,
          content: truncateToolResult(msg.content, '', { 
            ...cfg, 
            maxToolResultChars: Math.floor(cfg.maxToolResultChars / 3) 
          }),
        })
      } else {
        finalMessages.push(msg)
      }
    }

    const finalTokens = estimateTotalTokens(finalMessages)

    logger.agent.info(
      `[ContextManager] Level 3: ${originalTokens} -> ${finalTokens} tokens (deep compression)`
    )

    return {
      messages: finalMessages,
      summary: this.summary,
      stats: {
        originalTokens,
        finalTokens,
        savedPercent: Math.round((1 - finalTokens / originalTokens) * 100),
        compressionLevel: 3,
        keptTurns: recentGroups.length,
        compactedTurns: olderGroups.length,
        needsHandoff: false,
      },
    }
  }

  /**
   * Level 4: Session Handoff
   */
  private level4SessionHandoff(
    messages: OpenAIMessage[],
    originalTokens: number,
    cfg: ContextConfig
  ): OptimizedContext {
    const nonSystemMessages = messages.filter(m => m.role !== 'system')
    const groups = this.groupMessages(nonSystemMessages)

    // 边界检查：如果没有消息组，回退到 Level 3
    if (groups.length === 0) {
      logger.agent.warn('[ContextManager] No message groups, falling back to Level 3')
      return this.level3DeepCompression(messages, originalTokens, cfg)
    }

    // 边界检查：如果只有一轮对话（新会话的第一条消息），不触发 Handoff
    // 因为 Handoff 是为了处理长对话的上下文溢出，不适用于单条消息
    if (groups.length <= 1) {
      logger.agent.warn('[ContextManager] Only one turn, skipping handoff, falling back to Level 3')
      return this.level3DeepCompression(messages, originalTokens, cfg)
    }

    // 生成完整摘要
    const turnRange: [number, number] = [0, groups.length - 1]
    this.summary = generateQuickSummary(nonSystemMessages, groups, turnRange)
    
    // Level 4 触发 LLM 摘要（异步，但 Handoff 文档会使用快速摘要）
    // LLM 摘要完成后会更新 this.summary，但不影响当前 Handoff
    if (cfg.enableLLMSummary) {
      this.triggerLLMSummary(nonSystemMessages, groups, turnRange)
    }

    // 生成 Handoff 文档（使用当前的快速摘要）
    this.handoff = generateHandoffDocument(
      this.sessionId,
      nonSystemMessages,
      groups,
      this.summary,
      '' // workingDirectory 需要从外部传入
    )

    // 如果配置了自动 Handoff，返回一个精简的上下文
    if (cfg.autoHandoff) {
      const systemMsg = messages.find(m => m.role === 'system')
      const handoffPrompt = handoffToSystemPrompt(this.handoff)
      
      // 只保留最后一轮对话
      const lastGroup = groups[groups.length - 1]
      const lastMessages: OpenAIMessage[] = []
      
      if (systemMsg) {
        const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content : ''
        lastMessages.push({ ...systemMsg, content: `${systemContent}\n\n${handoffPrompt}` })
      }

      // 添加最后一轮
      lastMessages.push(nonSystemMessages[lastGroup.userIndex])
      if (lastGroup.assistantIndex !== null) {
        lastMessages.push(nonSystemMessages[lastGroup.assistantIndex])
      }

      const finalTokens = estimateTotalTokens(lastMessages)

      logger.agent.warn(
        `[ContextManager] Level 4: Session handoff required. ` +
        `Original: ${originalTokens}, Handoff context: ${finalTokens} tokens`
      )

      return {
        messages: lastMessages,
        summary: this.summary,
        stats: {
          originalTokens,
          finalTokens,
          savedPercent: Math.round((1 - finalTokens / originalTokens) * 100),
          compressionLevel: 4,
          keptTurns: 1,
          compactedTurns: groups.length - 1,
          needsHandoff: true,
        },
        handoff: this.handoff,
      }
    }

    // 如果不自动 Handoff，尝试 Level 3
    return this.level3DeepCompression(messages, originalTokens, cfg)
  }

  // ===== 辅助方法 =====

  private mergeConfig(config: Partial<ContextConfig>): ContextConfig {
    const agentConfig = getAgentConfig()
    return {
      ...DEFAULT_CONTEXT_CONFIG,
      maxTokens: agentConfig.maxContextTokens,
      keepRecentTurns: agentConfig.keepRecentTurns,
      deepCompressionTurns: agentConfig.deepCompressionTurns,
      maxImportantOldTurns: agentConfig.maxImportantOldTurns,
      maxToolResultChars: agentConfig.maxToolResultChars,
      enableLLMSummary: agentConfig.enableLLMSummary,
      autoHandoff: agentConfig.autoHandoff,
      ...config,
    }
  }

  private groupMessages(messages: OpenAIMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = []
    let currentGroup: MessageGroup | null = null
    let turnIndex = 0

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.role === 'system') continue

      if (msg.role === 'user') {
        if (currentGroup) groups.push(currentGroup)
        currentGroup = {
          turnIndex: turnIndex++,
          userIndex: i,
          assistantIndex: null,
          toolIndices: [],
          tokens: estimateMessageTokens(msg),
          importance: 0,
          hasWriteOps: false,
          hasErrors: false,
          files: [],
        }
      } else if (msg.role === 'assistant' && currentGroup) {
        currentGroup.assistantIndex = i
        currentGroup.tokens += estimateMessageTokens(msg)
        
        // 检查工具调用
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            if (isWriteTool(tc.function.name)) {
              currentGroup.hasWriteOps = true
              try {
                const args = JSON.parse(tc.function.arguments)
                if (args.path) currentGroup.files.push(args.path)
              } catch { /* ignore */ }
            }
          }
        }
      } else if (msg.role === 'tool' && currentGroup) {
        currentGroup.toolIndices.push(i)
        currentGroup.tokens += estimateMessageTokens(msg)
        
        // 检查错误（只检查明确的错误标记）
        const content = typeof msg.content === 'string' ? msg.content : ''
        if (content.startsWith('Error:') || content.startsWith('❌')) {
          currentGroup.hasErrors = true
        }
      }
    }

    if (currentGroup) groups.push(currentGroup)
    return groups
  }

  private truncateAllToolResults(
    messages: OpenAIMessage[],
    config: ContextConfig
  ): OpenAIMessage[] {
    return messages.map(msg => {
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        const toolName = (msg as any).name || ''
        return { ...msg, content: truncateToolResult(msg.content, toolName, config) }
      }
      return msg
    })
  }

  private countTurns(messages: OpenAIMessage[]): number {
    return messages.filter(m => m.role === 'user').length
  }

  private formatSummaryForSystem(summary: StructuredSummary): string {
    const fileChanges = summary.fileChanges
      .slice(-10)
      .map(f => `- ${f.action}: ${f.path}`)
      .join('\n')

    return `## Previous Context Summary (Turns ${summary.turnRange[0]}-${summary.turnRange[1]})

**Objective:** ${summary.objective}

**Completed:**
${summary.completedSteps.slice(-5).map(s => `- ${s}`).join('\n') || '- None recorded'}

**File Changes:**
${fileChanges || '- None'}

**User Instructions:**
${summary.userInstructions.slice(-3).map(i => `- ${i}`).join('\n') || '- None'}

---
Continue based on the above context.`
  }

  private formatDetailedSummary(summary: StructuredSummary): string {
    const decisions = summary.decisions
      .slice(-5)
      .map(d => `- [${d.type}] ${d.description}`)
      .join('\n')

    const errors = summary.errorsAndFixes
      .map(e => `- Error: ${e.error.slice(0, 50)}... → ${e.fix}`)
      .join('\n')

    return `## Detailed Context Summary

**Objective:** ${summary.objective}

**Completed Steps:**
${summary.completedSteps.map(s => `✓ ${s}`).join('\n') || 'None'}

**Pending Steps:**
${summary.pendingSteps.map(s => `○ ${s}`).join('\n') || 'None'}

**Key Decisions:**
${decisions || 'None'}

**Errors & Resolutions:**
${errors || 'None'}

**File Changes:**
${summary.fileChanges.map(f => `- [${f.action.toUpperCase()}] ${f.path}: ${f.summary}`).join('\n') || 'None'}

**Important User Instructions:**
${summary.userInstructions.map(i => `⚠️ ${i}`).join('\n') || 'None'}

---`
  }

  /**
   * 合并两个摘要
   * 新摘要的内容会追加到旧摘要，去重并保留最新信息
   */
  private mergeSummaries(
    existing: StructuredSummary,
    newSummary: StructuredSummary
  ): StructuredSummary {
    // 合并并去重数组
    const mergeArrays = <T>(arr1: T[], arr2: T[], limit: number = 20): T[] => {
      const combined = [...arr1, ...arr2]
      // 简单去重（对于字符串数组）
      const unique = Array.from(new Set(combined.map(item => 
        typeof item === 'string' ? item : JSON.stringify(item)
      ))).map(item => {
        try {
          return JSON.parse(item)
        } catch {
          return item
        }
      }) as T[]
      return unique.slice(-limit)
    }

    return {
      // 使用新摘要的目标（可能更准确）
      objective: newSummary.objective || existing.objective,
      // 合并已完成步骤
      completedSteps: mergeArrays(existing.completedSteps, newSummary.completedSteps, 30),
      // 使用新摘要的待完成步骤（更新）
      pendingSteps: newSummary.pendingSteps.length > 0 
        ? newSummary.pendingSteps 
        : existing.pendingSteps,
      // 合并决策点
      decisions: mergeArrays(existing.decisions, newSummary.decisions, 15),
      // 合并文件变更
      fileChanges: mergeArrays(existing.fileChanges, newSummary.fileChanges, 30),
      // 合并错误修复记录
      errorsAndFixes: mergeArrays(existing.errorsAndFixes, newSummary.errorsAndFixes, 10),
      // 合并用户指示
      userInstructions: mergeArrays(existing.userInstructions, newSummary.userInstructions, 10),
      // 使用新的时间戳
      generatedAt: Date.now(),
      // 扩展轮次范围
      turnRange: [
        Math.min(existing.turnRange[0], newSummary.turnRange[0]),
        Math.max(existing.turnRange[1], newSummary.turnRange[1]),
      ],
    }
  }

  /**
   * 异步触发 LLM 摘要生成
   * 不阻塞主流程，生成完成后更新摘要
   */
  private triggerLLMSummary(
    messages: OpenAIMessage[],
    groups: MessageGroup[],
    turnRange: [number, number]
  ): void {
    // 异步执行，不阻塞
    import('./LLMSummarizer').then(({ generateLLMSummary }) => {
      generateLLMSummary(messages, groups, turnRange)
        .then(llmSummary => {
          // 只有当 LLM 摘要比快速摘要更详细时才更新
          if (llmSummary.completedSteps.length > (this.summary?.completedSteps.length || 0) ||
              llmSummary.pendingSteps.length > 0) {
            this.summary = llmSummary
            logger.agent.info('[ContextManager] Updated with LLM summary')
          }
        })
        .catch(err => {
          logger.agent.warn('[ContextManager] LLM summary failed:', err)
        })
    })
  }
}

// 单例导出
export const contextManager = new ContextManager()
