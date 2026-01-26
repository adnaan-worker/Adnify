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
import { pruneMessages } from 'ai'
import type { ChatMessage, AssistantMessage, ToolResultMessage, UserMessage, ToolCall, MessageContent } from '../types'

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
 * 
 * 重要说明：
 * - messages 参数包含所有历史消息 + 刚添加的当前用户消息
 * - 当前用户消息在数组的最后一条
 * - 需要保留最后一条消息的图片（AI 需要分析）
 * - 历史消息中的图片替换为占位符（AI 已经分析过，节省 token）
 * 
 * 优化：结合 AI SDK 的 pruneMessages 进行智能修剪
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
  
  // 0. 使用 AI SDK 的 pruneMessages 进行智能修剪（L2+）
  if (lastLevel >= 2) {
    try {
      const beforeCount = result.length
      
      // 转换为 AI SDK 格式
      const aiMessages = result.map(m => {
        if (m.role === 'assistant') {
          const am = m as AssistantMessage
          return {
            role: 'assistant' as const,
            content: am.content || '',
            tool_calls: am.toolCalls?.map(tc => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
            }))
          }
        }
        if (m.role === 'tool') {
          const tm = m as ToolResultMessage
          return {
            role: 'tool' as const,
            tool_call_id: tm.toolCallId,
            name: tm.name,
            content: [{ type: 'text' as const, text: tm.content }]
          }
        }
        if (m.role === 'user') {
          const um = m as UserMessage
          return {
            role: 'user' as const,
            content: typeof um.content === 'string' ? um.content : JSON.stringify(um.content)
          }
        }
        return {
          role: 'system' as const,
          content: ''
        }
      })
      
      // 应用 pruneMessages
      const pruned = pruneMessages({
        messages: aiMessages as any, // 类型转换，避免复杂的类型匹配
        reasoning: lastLevel >= 3 ? 'before-last-message' : 'all',
        toolCalls: lastLevel >= 3 ? 'before-last-2-messages' : 'all',
        emptyMessages: 'remove'
      })
      
      removedMessages = beforeCount - pruned.length
      if (removedMessages > 0) {
        logger.agent.info(`[Compression] pruneMessages removed ${removedMessages} messages`)
        result = result.slice(-pruned.length)
      }
    } catch (e) {
      logger.agent.warn('[Compression] pruneMessages failed:', e)
    }
  }
  
  // 1. 替换历史消息中的图片为占位符（节省 token）
  // 注意：messages 包含刚添加的当前用户消息，它在最后一条
  // 需要保留最后一条用户消息的图片，只替换之前的历史消息
  const lastIndex = result.length - 1
  let hasModifications = false
  const modifiedMessages: ChatMessage[] = []
  
  for (let idx = 0; idx < result.length; idx++) {
    const msg = result[idx]
    
    // 跳过最后一条消息（当前正在发送的消息，保留图片）
    if (idx === lastIndex) {
      modifiedMessages.push(msg)
      continue
    }
    
    // 只处理用户消息
    if (msg.role === 'user') {
      const userMsg = msg as UserMessage
      const newContent = replaceImagesWithPlaceholder(userMsg.content)
      
      // 只在内容真正改变时才创建新对象
      if (newContent !== userMsg.content) {
        modifiedMessages.push({ ...userMsg, content: newContent as MessageContent })
        hasModifications = true
      } else {
        modifiedMessages.push(msg)
      }
    } else {
      modifiedMessages.push(msg)
    }
  }
  
  // 只在有修改时才使用新数组
  result = hasModifications ? modifiedMessages : result
  
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
 * 
 * 参考业界标准：
 * - 英文：~4 字符 = 1 token
 * - 中文：~1.5-2 字符 = 1 token（中文字符占用更多 token）
 * - 代码：~3-4 字符 = 1 token
 * 
 * 这是粗略估算，实际 tokenizer 会更复杂
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  
  // 统计中文字符数量
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const totalChars = text.length
  const nonChineseChars = totalChars - chineseChars
  
  // 中文按 1.5 字符/token，其他按 4 字符/token
  return Math.ceil(chineseChars / 1.5 + nonChineseChars / 4)
}

/**
 * 估算消息内容的 token 数（支持多种内容类型）
 * 
 * 支持的内容类型：
 * 1. 纯文本字符串
 * 2. 结构化内容数组（文本 + 图片 + 其他）
 * 
 * 图片 token 计算（基于 Anthropic 官方文档）：
 * - 图片 token = (width × height) / 750
 * - 最小 258 tokens，最大 1600 tokens
 * - 由于我们没有图片尺寸信息，使用保守估计 1600 tokens
 * 
 * 参考：https://docs.anthropic.com/en/docs/build-with-claude/vision#image-costs
 */
function estimateContentTokens(content: string | Array<{ type: string; text?: string; source?: unknown }>): number {
  if (typeof content === 'string') {
    return estimateTokens(content)
  }
  
  // 处理结构化内容（可能包含文本、图片等）
  let total = 0
  for (const part of content) {
    switch (part.type) {
      case 'text':
        if (part.text) {
          total += estimateTokens(part.text)
        }
        break
      
      case 'image':
        // Anthropic 图片 token 计算：
        // - 小图片（~200x200）：~258 tokens
        // - 中等图片（~400x400）：~600 tokens  
        // - 大图片（~1000x1000）：~1600 tokens
        // 由于无法获取实际尺寸，使用保守估计（大图片）
        total += 1600
        break
      
      case 'tool_use':
      case 'tool_result':
        // 工具调用内容按 JSON 字符串估算
        total += estimateTokens(JSON.stringify(part))
        break
      
      default:
        // 未知类型，按 JSON 字符串估算
        total += estimateTokens(JSON.stringify(part))
    }
  }
  
  return total
}

/**
 * 将历史消息中的图片替换为占位符（优化版）
 * 
 * 原因：AI 已经分析过图片，历史消息中保留完整 base64 浪费 token
 * 主流工具（Cursor、Windsurf）都是这样处理的
 * 
 * 性能优化：
 * 1. 只在需要时创建新对象（避免不必要的拷贝）
 * 2. 使用浅拷贝而非深拷贝
 * 3. 提前返回，避免不必要的遍历
 */
function replaceImagesWithPlaceholder(content: string | Array<{ type: string; text?: string; source?: unknown }>): typeof content {
  if (typeof content === 'string') {
    return content
  }
  
  // 检查是否有图片需要替换
  const hasImage = content.some(part => part.type === 'image')
  if (!hasImage) {
    return content // 没有图片，直接返回原内容（避免拷贝）
  }
  
  // 只在有图片时才创建新数组
  return content.map(part => {
    if (part.type === 'image') {
      // 替换为占位符文本
      return {
        type: 'text' as const,
        text: '[Image: Previously analyzed]'
      }
    }
    return part // 保持原对象引用（浅拷贝）
  })
}

/**
 * 估算消息列表的 token 数
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  
  for (const msg of messages) {
    if (msg.role === 'user') {
      const userMsg = msg as UserMessage
      total += estimateContentTokens(userMsg.content)
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
