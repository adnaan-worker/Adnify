/**
 * 消息重要性评分器
 * 
 * 基于结构性信号评分，不依赖关键词匹配
 * 主要考虑：消息类型、工具操作、位置
 */

import type { OpenAIMessage } from '../llm/MessageConverter'
import type { MessageImportance, MessageGroup, DecisionPoint, FileChangeRecord } from './types'
import { isFileEditTool } from '@/shared/config/tools'

/** 重要性权重配置 */
const WEIGHTS = {
  // 消息类型
  user: 30,
  assistantWithTools: 25,
  assistantText: 15,
  tool: 10,
  
  // 操作类型
  writeOp: 35,
  deleteOp: 45,
  error: 40,
  
  // 位置
  recent: 20,
}

/**
 * 计算单条消息的重要性（简化版，基于结构性信号）
 */
export function scoreMessage(
  msg: OpenAIMessage,
  index: number,
  totalMessages: number,
  _laterMessages: OpenAIMessage[]
): MessageImportance {
  let score = 0
  const reasons: string[] = []
  let compressible = true

  // 基础类型分数
  if (msg.role === 'user') {
    score += WEIGHTS.user
    reasons.push('user')
  } else if (msg.role === 'assistant') {
    if (msg.tool_calls?.length) {
      score += WEIGHTS.assistantWithTools
      reasons.push('tool calls')
      
      for (const tc of msg.tool_calls) {
        if (isFileEditTool(tc.function.name)) {
          score += WEIGHTS.writeOp
          reasons.push('write op')
          if (tc.function.name === 'delete_file') {
            score += 10
            compressible = false
          }
        }
      }
    } else {
      score += WEIGHTS.assistantText
    }
  } else if (msg.role === 'tool') {
    score += WEIGHTS.tool
    const content = typeof msg.content === 'string' ? msg.content : ''
    // 只检查明确的错误标记，不做关键词匹配
    if (content.startsWith('Error:') || content.startsWith('❌')) {
      score += WEIGHTS.error
      reasons.push('error')
      compressible = false
    }
  }

  // 位置加分（最近 20% 的消息）
  if ((totalMessages - index) / totalMessages < 0.2) {
    score += WEIGHTS.recent
    reasons.push('recent')
  }

  return {
    index,
    score: Math.min(100, score),
    reasons,
    compressible,
  }
}

/**
 * 计算消息组（一轮对话）的重要性
 */
export function scoreMessageGroup(
  group: MessageGroup,
  messages: OpenAIMessage[],
  allGroups: MessageGroup[]
): number {
  let score = 0

  // 基础分数：组内消息的平均重要性
  const indices = [group.userIndex, group.assistantIndex, ...group.toolIndices].filter(i => i !== null) as number[]
  const laterMessages = messages.slice(Math.max(...indices) + 1)
  
  for (const idx of indices) {
    const importance = scoreMessage(messages[idx], idx, messages.length, laterMessages)
    score += importance.score
  }
  score = score / indices.length

  // 写操作加分
  if (group.hasWriteOps) {
    score += 20
  }

  // 错误处理加分
  if (group.hasErrors) {
    score += 30
  }

  // 位置加分（最近 30% 的轮次）
  if (group.turnIndex / allGroups.length > 0.7) {
    score += 15
  }

  return Math.min(100, score)
}

/**
 * 提取关键决策点
 */
export function extractDecisionPoints(
  messages: OpenAIMessage[],
  groups: MessageGroup[]
): DecisionPoint[] {
  const decisions: DecisionPoint[] = []

  for (const group of groups) {
    if (group.assistantIndex === null) continue
    
    const assistantMsg = messages[group.assistantIndex]
    if (!assistantMsg.tool_calls) continue

    for (const tc of assistantMsg.tool_calls) {
      const args = safeParseArgs(tc.function.arguments)
      const filePath = args.path as string | undefined
      if (!filePath) continue
      
      if (tc.function.name === 'create_file') {
        decisions.push({
          turnIndex: group.turnIndex,
          type: 'file_create',
          description: `Created: ${filePath}`,
          files: [filePath],
          messageIndex: group.assistantIndex,
        })
      } else if (['edit_file', 'write_file', 'apply_diff'].includes(tc.function.name)) {
        decisions.push({
          turnIndex: group.turnIndex,
          type: 'file_modify',
          description: `Modified: ${filePath}`,
          files: [filePath],
          messageIndex: group.assistantIndex,
        })
      } else if (tc.function.name === 'delete_file') {
        decisions.push({
          turnIndex: group.turnIndex,
          type: 'file_delete',
          description: `Deleted: ${filePath}`,
          files: [filePath],
          messageIndex: group.assistantIndex,
        })
      }
    }
  }

  return decisions
}

/**
 * 提取文件修改记录
 */
export function extractFileChanges(
  messages: OpenAIMessage[],
  groups: MessageGroup[]
): FileChangeRecord[] {
  const changes: FileChangeRecord[] = []
  const fileHistory = new Map<string, FileChangeRecord>()

  for (const group of groups) {
    if (group.assistantIndex === null) continue
    
    const assistantMsg = messages[group.assistantIndex]
    if (!assistantMsg.tool_calls) continue

    for (const tc of assistantMsg.tool_calls) {
      const args = safeParseArgs(tc.function.arguments)
      const filePath = args.path as string | undefined
      if (!filePath) continue

      let action: 'create' | 'modify' | 'delete' = 'modify'
      let summary = ''

      if (tc.function.name === 'create_file') {
        action = 'create'
        summary = 'Created'
      } else if (tc.function.name === 'delete_file') {
        action = 'delete'
        summary = 'Deleted'
      } else if (['edit_file', 'write_file', 'apply_diff'].includes(tc.function.name)) {
        action = 'modify'
        summary = (args.description as string) || 'Modified'
      }

      const existing = fileHistory.get(filePath)
      if (existing) {
        if (action === 'delete') {
          existing.action = 'delete'
          existing.summary = 'Created then deleted'
        } else {
          existing.summary += ` → ${summary}`
        }
        existing.turnIndex = group.turnIndex
      } else {
        const record: FileChangeRecord = { path: filePath, action, summary, turnIndex: group.turnIndex }
        fileHistory.set(filePath, record)
        changes.push(record)
      }
    }
  }

  return changes
}

function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}
