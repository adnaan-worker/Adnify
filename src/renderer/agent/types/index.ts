/**
 * Agent 模块类型定义
 * 
 * 按领域拆分，统一导出
 */

// ============================================
// 从 shared/types 重新导出通用类型
// ============================================

export type {
  // 消息内容类型
  TextContent,
  ImageContent,
  MessageContent,
  // 工具相关类型
  ToolStatus,
  ToolResultType,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolExecutor,
  ValidationResult,
  ToolApprovalType,
} from '@/shared/types'

// ============================================
// 从配置中心导入基础类型
// ============================================

export type { ToolCategory, ToolConfig } from '@/shared/config/tools'
export type { AgentRuntimeConfig } from '@/shared/config/agentConfig'

// ============================================
// Agent 专用类型
// ============================================

// 消息类型
export * from './messages'

// 上下文类型
export * from './context'

// Plan 类型
export * from './plan'

// 交互式内容类型
export * from './interactive'

// 检查点类型
export * from './checkpoint'

// 线程类型
export * from './thread'

// 服务类型
export * from './services'

// ============================================
// 工具函数
// ============================================

import { isFileEditTool } from '@/shared/config/tools'
import { isAssistantMessage, isToolCallPart, type ChatMessage } from './messages'

export function getModifiedFilesFromMessages(messages: ChatMessage[]): string[] {
  const files = new Set<string>()
  for (const msg of messages) {
    if (isAssistantMessage(msg)) {
      for (const part of msg.parts) {
        if (isToolCallPart(part)) {
          const tc = part.toolCall
          if (isFileEditTool(tc.name)) {
            const path = (tc.arguments.path || (tc.arguments._meta as any)?.filePath) as string
            if (path) files.add(path)
          }
        }
      }
    }
  }
  return Array.from(files)
}

export function findLastCheckpointIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'checkpoint') return i
  }
  return -1
}
