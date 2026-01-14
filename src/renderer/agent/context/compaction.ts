/**
 * 上下文压缩模块
 * 
 * 参考 OpenCode 的实现：
 * - 使用真实的 token 使用量（来自 LLM 返回）判断是否需要压缩
 * - 压缩是持久化的（修改存储的消息）
 * - L2/L3: Prune 旧工具输出 + 可选 LLM 摘要
 * - L4: 生成 Handoff 文档
 */

import { logger } from '@utils/Logger'
import type { ChatMessage, ToolResultMessage, AssistantMessage } from '../types'
import { getAgentConfig } from '../utils/AgentConfig'

// ===== 配置获取 =====

/** 获取 prune 最小 token 阈值（从配置读取） */
export function getPruneMinimum(): number {
  return getAgentConfig().pruneMinimumTokens
}

/** 获取 prune 保护 token 数（从配置读取） */
export function getPruneProtect(): number {
  return getAgentConfig().pruneProtectTokens
}

/** 受保护的工具（不会被 prune） */
const PROTECTED_TOOLS = ['ask_user', 'update_plan', 'create_plan']

/** 简单的 token 估算：每 4 个字符约 1 个 token */
export function estimateTokens(text: string): number {
  return Math.max(0, Math.round((text || '').length / 4))
}

// ===== 类型 =====

export interface CompactionResult {
  pruned: number
  total: number
  prunedCount: number
  /** 需要标记为已压缩的消息 ID 列表 */
  messagesToCompact: string[]
}

export type CompressionLevel = 0 | 1 | 2 | 3 | 4

// CompressionStats 已移至 CompressionManager.ts
export type { CompressionStats } from './CompressionManager'

// ===== 核心函数 =====

/**
 * 计算压缩等级
 * 
 * @param ratio - 当前使用率 (0-1)
 */
export function getCompressionLevel(ratio: number): CompressionLevel {
  if (ratio < 0.5) return 0  // < 50%: 无压缩
  if (ratio < 0.7) return 1  // 50-70%: 轻度截断
  if (ratio < 0.85) return 2 // 70-85%: 滑动窗口 + Prune
  if (ratio < 0.95) return 3 // 85-95%: 深度压缩 + Summary
  return 4                    // > 95%: Handoff
}

/**
 * 判断是否需要压缩（基于真实 token 使用量）
 * 
 * @param tokens - LLM 返回的真实 token 使用量
 * @param contextLimit - 模型上下文限制
 * @param outputReserve - 预留给输出的 token 数（默认 4096）
 * @returns 是否超出可用上下文
 */
export function isOverflow(
  tokens: { input: number; output: number },
  contextLimit: number,
  outputReserve: number = 4096
): boolean {
  const totalUsed = tokens.input + tokens.output
  const usableContext = contextLimit - outputReserve
  return totalUsed > usableContext
}

/**
 * 压缩等级描述
 */
export const COMPRESSION_LEVEL_NAMES = [
  'Full Context',
  'Smart Truncation',
  'Sliding Window',
  'Deep Compression',
  'Session Handoff',
] as const

/**
 * Prune 消息列表中的旧工具输出
 * 
 * 策略（参考 OpenCode）：
 * 1. 从后往前遍历消息
 * 2. 跳过最近 keepRecentTurns 轮对话（保护最新内容，默认 5 轮）
 * 3. 保护最近 pruneProtectTokens token 的工具调用
 * 4. 超过保护范围的工具输出会被标记为 compacted
 * 5. 遇到已压缩的 assistant 消息（有 summary）就停止
 * 
 * 注意：此函数不直接修改消息，而是返回需要压缩的消息 ID 列表，
 * 调用方应通过 store action 更新消息状态。
 * 
 * @param messages - 消息列表（只读）
 * @returns 压缩结果，包含需要压缩的消息 ID 列表
 */
export function pruneMessages(messages: readonly ChatMessage[]): CompactionResult {
  let total = 0
  let pruned = 0
  const messagesToCompact: string[] = []
  const pruneProtect = getPruneProtect()
  const config = getAgentConfig()
  const keepRecentTurns = config.keepRecentTurns
  let turns = 0

  // 从后往前遍历
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    
    // 计算轮次（每个 user 消息算一轮）
    if (msg.role === 'user') turns++
    
    // 跳过最近 keepRecentTurns 轮（保护最新内容）
    if (turns < keepRecentTurns) continue
    
    // 遇到已压缩的 assistant 消息（有 compactedAt 标记），继续遍历更早的消息
    if (msg.role === 'assistant' && (msg as AssistantMessage & { compactedAt?: number }).compactedAt) {
      continue
    }
    
    // 处理工具结果消息
    if (msg.role === 'tool') {
      const toolMsg = msg as ToolResultMessage
      
      // 跳过受保护的工具
      if (PROTECTED_TOOLS.includes(toolMsg.name || '')) continue
      
      // 跳过已压缩的工具结果
      if (toolMsg.compactedAt) continue
      
      // 估算 token
      const content = typeof toolMsg.content === 'string' ? toolMsg.content : ''
      const estimate = estimateTokens(content)
      total += estimate
      
      // 超过保护范围的加入待压缩列表
      if (total > pruneProtect) {
        pruned += estimate
        messagesToCompact.push(msg.id)
      }
    }
  }

  const pruneMinimum = getPruneMinimum()
  logger.agent.info(`[Compaction] Prune scan: ${messagesToCompact.length} candidates, ${pruned}/${total} tokens (threshold: ${pruneMinimum}, keepRecentTurns: ${keepRecentTurns})`)

  return { 
    pruned: pruned > pruneMinimum ? pruned : 0, 
    total, 
    prunedCount: pruned > pruneMinimum ? messagesToCompact.length : 0,
    messagesToCompact: pruned > pruneMinimum ? messagesToCompact : [],
  }
}

/**
 * 获取消息内容（考虑压缩状态）
 */
export function getMessageContent(msg: ToolResultMessage): string {
  if (msg.compactedAt) {
    return '[Old tool result content cleared]'
  }
  return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
}

/**
 * 计算消息列表的总 token 数（估算）
 */
export function estimateTotalTokens(messages: ChatMessage[]): number {
  let total = 0
  
  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = typeof (msg as any).content === 'string' 
        ? (msg as any).content 
        : JSON.stringify((msg as any).content)
      total += estimateTokens(content)
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      total += estimateTokens(assistantMsg.content || '')
      
      // 工具调用也计入
      for (const tc of assistantMsg.toolCalls || []) {
        total += estimateTokens(JSON.stringify(tc.arguments))
        total += estimateTokens(tc.result || '')
      }
    } else if (msg.role === 'tool') {
      const toolMsg = msg as ToolResultMessage
      if (!toolMsg.compactedAt) {
        total += estimateTokens(typeof toolMsg.content === 'string' ? toolMsg.content : '')
      } else {
        total += 10 // 压缩后的占位符
      }
    }
  }
  
  return total
}

logger.agent.info('[Compaction] Module loaded')
