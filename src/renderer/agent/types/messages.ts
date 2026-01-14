/**
 * 消息相关类型定义
 */

import type { TextContent, ImageContent, MessageContent, ToolCall, ToolResultType } from '@/shared/types'
import type { ContextItem } from './context'
import type { InteractiveContent } from './interactive'
import type { FileSnapshot } from './checkpoint'

// ============================================
// 消息部分类型
// ============================================

/** 文本部分 */
export interface TextPart {
  type: 'text'
  content: string
}

/** 推理部分 */
export interface ReasoningPart {
  type: 'reasoning'
  content: string
  startTime?: number
  isStreaming?: boolean
}

/** 工具调用部分 */
export interface ToolCallPart {
  type: 'tool_call'
  toolCall: ToolCall
}

/** 助手消息部分 */
export type AssistantPart = TextPart | ReasoningPart | ToolCallPart

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

// ============================================
// 消息类型
// ============================================

/** 用户消息 */
export interface UserMessage {
  id: string
  role: 'user'
  content: MessageContent
  displayContent?: string
  timestamp: number
  contextItems?: ContextItem[]
}

/** 助手消息 */
export interface AssistantMessage {
  id: string
  role: 'assistant'
  content: string
  displayContent?: string
  timestamp: number
  isStreaming?: boolean
  parts: AssistantPart[]
  toolCalls?: ToolCall[]
  reasoning?: string
  reasoningStartTime?: number
  usage?: TokenUsage
  interactive?: InteractiveContent
}

/** 工具结果消息 */
export interface ToolResultMessage {
  id: string
  role: 'tool'
  toolCallId: string
  name: string
  content: string
  timestamp: number
  type: ToolResultType
  rawParams?: Record<string, unknown>
  compactedAt?: number
}

/** Checkpoint 消息 */
export interface CheckpointMessage {
  id: string
  role: 'checkpoint'
  type: 'user_message' | 'tool_edit'
  timestamp: number
  fileSnapshots: Record<string, FileSnapshot>
  userModifications?: Record<string, FileSnapshot>
}

/** 被中断的工具调用消息 */
export interface InterruptedToolMessage {
  id: string
  role: 'interrupted_tool'
  name: string
  timestamp: number
}

/** 聊天消息联合类型 */
export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CheckpointMessage
  | InterruptedToolMessage

// ============================================
// 类型守卫
// ============================================

export function isUserMessage(msg: ChatMessage): msg is UserMessage {
  return msg.role === 'user'
}

export function isAssistantMessage(msg: ChatMessage): msg is AssistantMessage {
  return msg.role === 'assistant'
}

export function isToolResultMessage(msg: ChatMessage): msg is ToolResultMessage {
  return msg.role === 'tool'
}

export function isCheckpointMessage(msg: ChatMessage): msg is CheckpointMessage {
  return msg.role === 'checkpoint'
}

export function isInterruptedToolMessage(msg: ChatMessage): msg is InterruptedToolMessage {
  return msg.role === 'interrupted_tool'
}

export function isTextPart(part: AssistantPart): part is TextPart {
  return part.type === 'text'
}

export function isReasoningPart(part: AssistantPart): part is ReasoningPart {
  return part.type === 'reasoning'
}

export function isToolCallPart(part: AssistantPart): part is ToolCallPart {
  return part.type === 'tool_call'
}

// ============================================
// 工具函数
// ============================================

export function getMessageText(content: MessageContent): string {
  if (typeof content === 'string') return content
  return (content as Array<TextContent | ImageContent>)
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
}

export function getMessageImages(content: MessageContent): ImageContent[] {
  if (typeof content === 'string') return []
  return (content as Array<TextContent | ImageContent>).filter((c): c is ImageContent => c.type === 'image')
}
