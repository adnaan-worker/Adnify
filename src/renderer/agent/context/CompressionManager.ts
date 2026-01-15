/**
 * 上下文压缩管理器
 * 
 * 统一管理所有压缩逻辑，提供清晰的 API：
 * 1. prepareMessages - 发送前压缩消息
 * 2. updateStats - LLM 返回后更新统计
 * 3. 自动根据压缩等级执行相应策略
 */

import { logger } from '@utils/Logger'
import { getAgentConfig } from '../utils/AgentConfig'
import type { ChatMessage, AssistantMessage, ToolResultMessage, UserMessage, ToolCall } from '../types'

// ===== 类型 =====

export type CompressionLevel = 0 | 1 | 2 | 3 | 4

export interface CompressionStats {
  level: CompressionLevel
  levelName: string
  ratio: number           // 当前使用率 (0-1)
  inputTokens: number     // 输入 token
  outputTokens: number    // 输出 token
  contextLimit: number    // 上下文限制
  savedTokens: number     // 节省的 token
  savedPercent: number    // 节省百分比
  messageCount: number    // 消息数量
  needsHandoff: boolean
  lastUpdatedAt: number
}

export interface PrepareResult {
  messages: ChatMessage[]
  appliedLevel: CompressionLevel
  truncatedToolCalls: number
  clearedToolResults: number
  removedMessages: number
}

// ===== 常量 =====

export const LEVEL_NAMES = [
  'Full Context',      // L0: 不压缩
  'Truncate Args',     // L1: 截断工具参数
  'Clear Results',     // L2: 清理工具结果
  'Deep Compress',     // L3: 深度压缩
  'Session Handoff',   // L4: 需要切换会话
] as const

/** 需要截断参数的工具 */
const TRUNCATE_TOOLS = new Set(['write_file', 'edit_file', 'replace_file_content', 'create_file_or_folder'])

/** 受保护的工具（不清理结果） */
const PROTECTED_TOOLS = new Set(['ask_user', 'update_plan', 'create_plan'])

// ===== 核心函数 =====

/**
 * 根据使用率计算压缩等级
 */
export function calculateLevel(ratio: number): CompressionLevel {
  if (ratio < 0.5) return 0   // < 50%
  if (ratio < 0.7) return 1   // 50-70%
  if (ratio < 0.85) return 2  // 70-85%
  if (ratio < 0.95) return 3  // 85-95%
  return 4                     // >= 95%
}

/**
 * 根据压缩等级获取消息数量限制
 */
function getMessageLimit(level: CompressionLevel, config: ReturnType<typeof getAgentConfig>): number {
  const base = config.maxHistoryMessages
  switch (level) {
    case 0: return base           // 60
    case 1: return Math.min(base, 45)
    case 2: return Math.min(base, 30)
    case 3: return Math.min(base, 15)
    case 4: return Math.min(base, 10)
  }
}

/**
 * 根据压缩等级获取工具参数截断阈值
 */
function getTruncateThreshold(level: CompressionLevel, config: ReturnType<typeof getAgentConfig>): number {
  const base = config.maxToolResultChars
  switch (level) {
    case 0: return Infinity  // 不截断
    case 1: return base      // 10000
    case 2: return 2000
    case 3: return 500
    case 4: return 200
  }
}

/**
 * 截断工具调用参数
 */
function truncateToolCallArgs(tc: ToolCall, maxChars: number): { tc: ToolCall; truncated: boolean } {
  if (!TRUNCATE_TOOLS.has(tc.name)) return { tc, truncated: false }
  
  const args = { ...tc.arguments }
  let truncated = false
  
  for (const key of ['content', 'new_string', 'old_string']) {
    if (typeof args[key] === 'string' && (args[key] as string).length > maxChars) {
      args[key] = `[Truncated: ${(args[key] as string).length} chars]`
      truncated = true
    }
  }
  
  return { tc: truncated ? { ...tc, arguments: args } : tc, truncated }
}

/**
 * 准备消息（发送前压缩）
 * 
 * 根据上一次的压缩等级决定本次的压缩策略
 */
export function prepareMessages(
  messages: ChatMessage[],
  lastLevel: CompressionLevel
): PrepareResult {
  const config = getAgentConfig()
  let result = [...messages]
  let truncatedToolCalls = 0
  let clearedToolResults = 0
  let removedMessages = 0
  
  // 过滤 checkpoint 消息
  result = result.filter(m => m.role !== 'checkpoint')
  
  // 1. 限制消息数量
  const messageLimit = getMessageLimit(lastLevel, config)
  if (result.length > messageLimit) {
    removedMessages = result.length - messageLimit
    result = result.slice(-messageLimit)
  }
  
  // 2. L1+: 截断工具调用参数
  if (lastLevel >= 1) {
    const threshold = getTruncateThreshold(lastLevel, config)
    
    // 找到最后一条 assistant 消息（不截断）
    let lastAssistantIdx = -1
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'assistant') {
        lastAssistantIdx = i
        break
      }
    }
    
    result = result.map((msg, idx) => {
      if (msg.role !== 'assistant' || idx === lastAssistantIdx) return msg
      
      const assistantMsg = msg as AssistantMessage
      let hasChanges = false
      
      // 处理 toolCalls
      let newToolCalls = assistantMsg.toolCalls
      if (assistantMsg.toolCalls?.length) {
        newToolCalls = assistantMsg.toolCalls.map(tc => {
          const { tc: newTc, truncated } = truncateToolCallArgs(tc, threshold)
          if (truncated) { truncatedToolCalls++; hasChanges = true }
          return newTc
        })
      }
      
      // 处理 parts 中的 tool_call
      let newParts = assistantMsg.parts
      if (newParts?.length) {
        newParts = newParts.map((part) => {
          if (part.type === 'tool_call' && part.toolCall) {
            const { tc: newTc, truncated } = truncateToolCallArgs(part.toolCall, threshold)
            if (truncated) { truncatedToolCalls++; hasChanges = true }
            return truncated ? { ...part, toolCall: newTc } : part
          }
          return part
        })
      }
      
      return hasChanges ? { ...assistantMsg, toolCalls: newToolCalls, parts: newParts } : msg
    })
  }
  
  // 3. L2+: 清理旧工具结果
  if (lastLevel >= 2) {
    const keepTurns = lastLevel >= 3 ? config.deepCompressionTurns : config.keepRecentTurns
    
    // 计算保护范围
    let userCount = 0
    let protectFromIdx = result.length
    for (let i = result.length - 1; i >= 0; i--) {
      if (result[i].role === 'user') {
        userCount++
        if (userCount >= keepTurns) {
          protectFromIdx = i
          break
        }
      }
    }
    
    result = result.map((msg, idx) => {
      if (idx >= protectFromIdx) return msg
      if (msg.role !== 'tool') return msg
      
      const toolMsg = msg as ToolResultMessage
      if (PROTECTED_TOOLS.has(toolMsg.name || '')) return msg
      if (toolMsg.compactedAt) return msg
      
      const content = typeof toolMsg.content === 'string' ? toolMsg.content : ''
      if (content.length > 100) {
        clearedToolResults++
        return { ...toolMsg, content: '[Cleared]', compactedAt: Date.now() }
      }
      return msg
    })
  }
  
  logger.agent.info(
    `[Compression] Prepared messages: L${lastLevel}, ` +
    `removed=${removedMessages}, truncated=${truncatedToolCalls}, cleared=${clearedToolResults}`
  )
  
  return {
    messages: result,
    appliedLevel: lastLevel,
    truncatedToolCalls,
    clearedToolResults,
    removedMessages,
  }
}

/**
 * 根据 LLM 返回的 usage 更新压缩统计
 */
export function updateStats(
  usage: { promptTokens: number; completionTokens: number },
  contextLimit: number,
  previousStats: CompressionStats | null,
  messageCount: number
): CompressionStats {
  const inputTokens = usage.promptTokens
  const outputTokens = usage.completionTokens
  // 只用 inputTokens 计算比例，输出 token 不占用上下文窗口
  const ratio = inputTokens / contextLimit
  const level = calculateLevel(ratio)
  
  // 计算节省的 token（与上一次比较）
  const savedTokens = previousStats 
    ? Math.max(0, previousStats.inputTokens - inputTokens)
    : 0
  const savedPercent = previousStats && previousStats.inputTokens > 0
    ? Math.round((savedTokens / previousStats.inputTokens) * 100)
    : 0
  
  return {
    level,
    levelName: LEVEL_NAMES[level],
    ratio,
    inputTokens,
    outputTokens,
    contextLimit,
    savedTokens,
    savedPercent,
    messageCount,
    needsHandoff: level >= 4,
    lastUpdatedAt: Date.now(),
  }
}

/**
 * 估算 token 数（用于预检查）
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4)
}

/**
 * 估算消息列表的 token 数
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  
  for (const msg of messages) {
    if (msg.role === 'user') {
      const userMsg = msg as UserMessage
      const content = typeof userMsg.content === 'string' 
        ? userMsg.content 
        : JSON.stringify(userMsg.content || '')
      total += estimateTokens(content)
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      total += estimateTokens(assistantMsg.content || '')
      for (const tc of assistantMsg.toolCalls || []) {
        total += estimateTokens(JSON.stringify(tc.arguments || {}))
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as ToolResultMessage
      if (!toolMsg.compactedAt) {
        total += estimateTokens(typeof toolMsg.content === 'string' ? toolMsg.content : '')
      }
    }
  }
  
  return total
}
