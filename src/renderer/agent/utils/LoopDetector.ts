/**
 * 智能循环检测器
 * 
 * 检测策略：
 * 1. 基于内容变化检测，而不是简单的操作次数
 * 2. 检测真正的循环模式（A→B→A→B）
 * 3. 支持时间窗口衰减
 * 4. 区分读操作和写操作
 */

import type { LLMToolCall } from '@/shared/types'
import { getAgentConfig } from './AgentConfig'

/** 工具调用记录 */
interface ToolCallRecord {
  name: string
  target: string | null
  argsHash: string
  contentHash?: string
  timestamp: number
  success: boolean
}

/** 循环检测结果 */
export interface LoopCheckResult {
  isLoop: boolean
  reason?: string
  suggestion?: string
}

/** 循环检测配置 */
interface LoopDetectorInternalConfig {
  timeWindowMs: number
  maxExactRepeats: number
  maxNoChangeEdits: number
  maxHistory: number
  minPatternLength: number
  maxPatternLength: number
  readOpMultiplier: number
}

/**
 * 从 AgentConfig 获取循环检测配置
 */
function getLoopConfig(): LoopDetectorInternalConfig {
  const agentConfig = getAgentConfig()
  const loopConfig = agentConfig.loopDetection

  return {
    timeWindowMs: 3 * 60 * 1000,  // 3 分钟滑动窗口
    maxExactRepeats: Math.min(loopConfig.maxExactRepeats, 3),  // 最多 3 次精确重复
    maxNoChangeEdits: Math.min(loopConfig.maxSameTargetRepeats, 4),  // 最多 4 次无变化编辑
    maxHistory: loopConfig.maxHistory,
    minPatternLength: 2,  // 检测 A→B→A→B 模式
    maxPatternLength: 4,
    readOpMultiplier: 8,  // 读操作允许更多次（24 次精确重复）
  }
}

// 读操作列表
const READ_OPERATIONS = new Set([
  'read_file',
  'list_directory',
  'search_files',
  'grep_search',
  'codebase_search',
  'get_file_info',
])

// 写操作列表
const WRITE_OPERATIONS = new Set([
  'edit_file',
  'write_file',
  'create_file',
  'delete_file',
  'run_command',
])

export class LoopDetector {
  private history: ToolCallRecord[] = []
  private contentHashes: Map<string, string[]> = new Map()  // 文件路径 -> 内容哈希历史

  /**
   * 获取当前配置（每次调用时从 AgentConfig 获取最新值）
   */
  private get config(): LoopDetectorInternalConfig {
    return getLoopConfig()
  }

  /**
   * 检查是否存在循环
   * @param toolCalls 本轮的工具调用
   * @param fileContents 可选的文件内容映射，用于检测内容变化
   */
  checkLoop(
    toolCalls: LLMToolCall[],
    fileContents?: Map<string, string>
  ): LoopCheckResult {
    const now = Date.now()
    
    // 清理过期记录
    this.cleanupOldRecords(now)

    for (const tc of toolCalls) {
      const record = this.createRecord(tc, fileContents)
      
      // 1. 检测精确重复（完全相同的参数）
      const exactResult = this.checkExactRepeat(record)
      if (exactResult.isLoop) return exactResult

      // 2. 对于写操作，检测内容是否真正变化
      if (WRITE_OPERATIONS.has(tc.name) && record.target) {
        const contentResult = this.checkContentChange(record, fileContents)
        if (contentResult.isLoop) return contentResult
      }

      // 3. 检测模式循环（A→B→A→B）
      const patternResult = this.checkPatternLoop(record)
      if (patternResult.isLoop) return patternResult

      // 记录本次调用
      this.history.push(record)
    }

    return { isLoop: false }
  }

  /**
   * 记录工具调用结果（用于更新成功/失败状态）
   */
  recordResult(toolCallId: string, success: boolean): void {
    // 更新最近的匹配记录
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].argsHash.includes(toolCallId.slice(0, 8))) {
        this.history[i].success = success
        break
      }
    }
  }

  /**
   * 更新文件内容哈希（在文件编辑后调用）
   */
  updateContentHash(filePath: string, content: string): void {
    const hash = this.hashContent(content)
    const hashes = this.contentHashes.get(filePath) || []
    hashes.push(hash)
    // 只保留最近 10 个哈希
    if (hashes.length > 10) {
      hashes.shift()
    }
    this.contentHashes.set(filePath, hashes)
  }

  /**
   * 重置检测器
   */
  reset(): void {
    this.history = []
    this.contentHashes.clear()
  }

  // ===== 私有方法 =====

  private createRecord(tc: LLMToolCall, fileContents?: Map<string, string>): ToolCallRecord {
    const args = tc.arguments as Record<string, unknown>
    const target = (args.path || args.file || args.command || args.query || null) as string | null
    
    let contentHash: string | undefined
    if (target && fileContents?.has(target)) {
      contentHash = this.hashContent(fileContents.get(target)!)
    }

    return {
      name: tc.name,
      target,
      argsHash: this.hashArgs(tc.arguments),
      contentHash,
      timestamp: Date.now(),
      success: true,  // 默认成功，后续可更新
    }
  }

  private cleanupOldRecords(now: number): void {
    const config = this.config
    const cutoff = now - config.timeWindowMs
    
    // 先按时间过滤
    this.history = this.history.filter(r => r.timestamp > cutoff)
    
    // 再按最大历史记录数限制
    if (this.history.length > config.maxHistory) {
      this.history = this.history.slice(-config.maxHistory)
    }
  }

  private checkExactRepeat(record: ToolCallRecord): LoopCheckResult {
    const isReadOp = READ_OPERATIONS.has(record.name)
    const threshold = isReadOp 
      ? this.config.maxExactRepeats * this.config.readOpMultiplier
      : this.config.maxExactRepeats

    const exactMatches = this.history.filter(
      h => h.name === record.name && h.argsHash === record.argsHash
    )

    if (exactMatches.length >= threshold) {
      return {
        isLoop: true,
        reason: `Detected exact repeat of ${record.name} (${exactMatches.length + 1} times with identical arguments).`,
        suggestion: isReadOp 
          ? 'The file content may not have changed. Consider a different approach.'
          : 'The same operation has been attempted multiple times. Please try a different approach.',
      }
    }

    // 检测同一工具的过度调用（即使参数不同）
    // 复杂任务可能需要多次编辑不同文件，所以阈值要合理
    const sameToolCalls = this.history.filter(h => h.name === record.name)
    const maxSameToolCalls = isReadOp ? 50 : 25  // 写操作允许 25 次
    if (sameToolCalls.length >= maxSameToolCalls) {
      return {
        isLoop: true,
        reason: `Tool "${record.name}" has been called ${sameToolCalls.length + 1} times. This may indicate a loop.`,
        suggestion: 'Consider using a different approach or tool to accomplish the task.',
      }
    }

    return { isLoop: false }
  }

  private checkContentChange(
    record: ToolCallRecord,
    _fileContents?: Map<string, string>
  ): LoopCheckResult {
    if (!record.target) return { isLoop: false }

    const hashes = this.contentHashes.get(record.target) || []
    if (hashes.length < 2) return { isLoop: false }

    // 检查最近的内容哈希是否在循环
    const recentHashes = hashes.slice(-this.config.maxNoChangeEdits)
    const uniqueHashes = new Set(recentHashes)

    // 如果最近 N 次编辑后，内容哈希只有 1-2 个不同值，说明在循环
    if (recentHashes.length >= this.config.maxNoChangeEdits && uniqueHashes.size <= 2) {
      return {
        isLoop: true,
        reason: `File "${record.target}" content is cycling between ${uniqueHashes.size} state(s) after ${recentHashes.length} edits.`,
        suggestion: 'The edits are not making progress. Consider reviewing the approach or asking for clarification.',
      }
    }

    return { isLoop: false }
  }

  private checkPatternLoop(newRecord: ToolCallRecord): LoopCheckResult {
    const tempHistory = [...this.history, newRecord]

    // 检测不同长度的模式
    for (let len = this.config.minPatternLength; len <= this.config.maxPatternLength; len++) {
      if (tempHistory.length < len * 2) continue

      const recent = tempHistory.slice(-len * 2)
      const firstHalf = recent.slice(0, len)
      const secondHalf = recent.slice(len)

      // 检查是否是精确的模式循环（工具名 + 参数都相同）
      const isExactPattern = firstHalf.every((r, i) =>
        r.name === secondHalf[i].name && r.argsHash === secondHalf[i].argsHash
      )

      // 检查是否是路径探索（工具名相同但路径不同）
      const isPathExploration = this.isPathExploration(firstHalf, secondHalf)

      // 只有精确模式且不是路径探索才算循环
      if (isExactPattern && !isPathExploration) {
        const pattern = firstHalf.map(r => `${r.name}(${r.target || 'N/A'})`).join(' → ')
        return {
          isLoop: true,
          reason: `Detected repeating pattern: ${pattern} (repeated 2 times).`,
          suggestion: 'The agent is stuck in a loop. Consider breaking the pattern with a different approach.',
        }
      }
    }

    return { isLoop: false }
  }

  /**
   * 检查是否是路径探索行为
   */
  private isPathExploration(firstHalf: ToolCallRecord[], secondHalf: ToolCallRecord[]): boolean {
    const allSameTool = firstHalf.every((r, i) => r.name === secondHalf[i].name)
    if (!allSameTool) return false

    const hasTargets = firstHalf.every((r, i) => r.target && secondHalf[i].target)
    if (!hasTargets) return false

    for (let i = 0; i < firstHalf.length; i++) {
      const path1 = firstHalf[i].target!
      const path2 = secondHalf[i].target!
      if (path1 !== path2 && this.isSubPath(path1, path2)) {
        return true
      }
    }

    return false
  }

  /**
   * 检查是否是子路径关系
   */
  private isSubPath(path1: string, path2: string): boolean {
    const normalized1 = path1.replace(/\\/g, '/').toLowerCase()
    const normalized2 = path2.replace(/\\/g, '/').toLowerCase()
    return normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1)
  }

  private hashArgs(args: Record<string, unknown>): string {
    const normalized = JSON.stringify(args, Object.keys(args).sort())
    return this.simpleHash(normalized)
  }

  private hashContent(content: string): string {
    return this.simpleHash(content)
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(36)
  }
}