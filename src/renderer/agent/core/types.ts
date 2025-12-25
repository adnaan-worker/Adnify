/**
 * Agent 核心类型定义
 * 参考 Cursor/Void 的架构设计
 */

import {
  MessageRole,
  ToolStatus,
  ToolApprovalType, // Note: This was a type alias, not enum, checking if I should make it an enum too. Let's keep it as type for now or move to enums if needed. Wait, it's 'terminal' | 'dangerous'.
  StreamPhase,
  ToolResultType,
  PlanStatus,
  PlanItemStatus,
  ContextItemType
} from './enums'

export {
  MessageRole,
  ToolStatus,
  StreamPhase,
  ToolResultType,
  PlanStatus,
  PlanItemStatus,
  ContextItemType
}

// ===== 工具相关类型 =====

// edits 已移除 - 文件编辑不需要确认（可通过Checkpoint撤销）
// export type ToolApprovalType = 'terminal' | 'dangerous' // Moved to enums

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string
  rawParams?: Record<string, unknown>
}

export interface ToolProperty {
  type: string
  description?: string
  enum?: string[]
  items?: ToolProperty
  properties?: Record<string, ToolProperty>
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  approvalType?: ToolApprovalType
  parameters: {
    type: 'object'
    properties: Record<string, ToolProperty>
    required: string[]
  }
}

export interface ToolExecutionResult {
  success: boolean
  result?: string
  error?: string
  content?: string
  rejected?: boolean
  meta?: Record<string, any>
}

// ===== 消息内容类型 =====

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type: string
    data: string
  }
}

export type MessageContent = string | Array<TextContent | ImageContent>

// ===== 文件快照类型（用于 Checkpoint）=====

export interface FileSnapshot {
  fsPath: string
  content: string | null  // null 表示文件不存在
}

// ===== 消息类型 =====

// 用户消息
export interface UserMessage {
  id: string
  role: MessageRole.User
  content: MessageContent
  displayContent?: string  // 显示给用户的内容（可能与发送给 LLM 的不同）
  timestamp: number
  contextItems?: ContextItem[]
}

// Assistant 消息内容部分（支持文字和工具调用交错）
export interface TextPart {
  type: 'text'
  content: string
}

export interface ToolCallPart {
  type: 'tool_call'
  toolCall: ToolCall
}

export type AssistantPart = TextPart | ToolCallPart

// 助手消息
export interface AssistantMessage {
  id: string
  role: MessageRole.Assistant
  content: string  // 纯文本内容（用于发送给 LLM）
  displayContent?: string  // 显示给用户的内容
  timestamp: number
  isStreaming?: boolean
  // 按顺序存储的内容部分（文字和工具调用交错显示）
  parts: AssistantPart[]
  // 兼容：所有工具调用的列表
  toolCalls?: ToolCall[]
}

// 工具结果消息（参考 Void 的 ToolMessage）
export interface ToolResultMessage {
  id: string
  role: MessageRole.Tool
  toolCallId: string
  name: string
  content: string  // 工具执行结果
  timestamp: number
  type: ToolResultType
  rawParams?: Record<string, unknown>  // 原始参数
}

// Checkpoint 消息（参考 Void）
export interface CheckpointMessage {
  id: string
  role: MessageRole.Checkpoint
  type: 'user_message' | 'tool_edit'  // 触发类型
  timestamp: number
  // 文件快照：路径 -> 快照
  fileSnapshots: Record<string, FileSnapshot>
  // 用户修改的快照（用于 Keep 功能）
  userModifications?: Record<string, FileSnapshot>
}

// 被中断的工具调用（装饰性消息）
export interface InterruptedToolMessage {
  id: string
  role: MessageRole.InterruptedTool
  name: string
  timestamp: number
}

// ===== Plan Mode 类型 =====

export interface PlanItem {
  id: string
  title: string
  description?: string
  status: PlanItemStatus
}

export interface Plan {
  id: string
  items: PlanItem[]
  status: PlanStatus
  currentStepId: string | null
  createdAt: number
  updatedAt: number
}

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CheckpointMessage
  | InterruptedToolMessage

// ===== 上下文相关类型 =====

export interface FileContext {
  type: ContextItemType.File
  uri: string
}

export interface CodeSelectionContext {
  type: ContextItemType.CodeSelection
  uri: string
  range: [number, number]
}

export interface FolderContext {
  type: ContextItemType.Folder
  uri: string
}

export interface CodebaseContext {
  type: ContextItemType.Codebase
  query?: string
}

export interface GitContext {
  type: ContextItemType.Git
}

export interface TerminalContext {
  type: ContextItemType.Terminal
}

export interface SymbolsContext {
  type: ContextItemType.Symbols
}

export interface WebContext {
  type: ContextItemType.Web
  query?: string
}

export type ContextItem =
  | FileContext
  | CodeSelectionContext
  | FolderContext
  | CodebaseContext
  | WebContext
  | GitContext
  | TerminalContext
  | SymbolsContext

// ===== 线程相关类型 =====

export interface ThreadState {
  // 当前 checkpoint 索引（null 表示不在特定 checkpoint，如正在流式输出）
  currentCheckpointIdx: number | null
  // 是否正在流式输出
  isStreaming: boolean
  // 当前等待审批的工具
  pendingToolCall?: ToolCall
  // 错误信息
  error?: string
}

export interface ChatThread {
  id: string
  createdAt: number
  lastModified: number
  messages: ChatMessage[]
  contextItems: ContextItem[]
  state: ThreadState
}

// ===== 流状态类型 =====

export interface StreamState {
  phase: StreamPhase
  currentToolCall?: ToolCall
  error?: string
  // 状态文本（如 "Planning next moves"）
  statusText?: string
}

// ===== 待确认的更改 =====

export interface PendingChange {
  id: string
  filePath: string
  toolCallId: string
  toolName: string
  status: 'pending' | 'accepted' | 'rejected'
  snapshot: FileSnapshot      // 修改前的快照
  timestamp: number
  linesAdded: number
  linesRemoved: number
}

// ===== 消息级别的检查点 =====

export interface MessageCheckpoint {
  id: string
  messageId: string           // 关联的用户消息 ID（在该消息之前创建）
  timestamp: number
  fileSnapshots: Record<string, FileSnapshot>  // 文件路径 -> 快照
  description: string
}

// ===== Agent 配置 =====

export interface AgentConfig {
  maxToolLoops: number
  maxHistoryMessages: number
  maxToolResultChars: number
  autoApprove: {
    edits: boolean
    terminal: boolean
    dangerous: boolean
  }
}

// ===== 辅助函数 =====

export function isUserMessage(msg: ChatMessage): msg is UserMessage {
  return msg.role === MessageRole.User
}

export function isAssistantMessage(msg: ChatMessage): msg is AssistantMessage {
  return msg.role === MessageRole.Assistant
}

export function isToolResultMessage(msg: ChatMessage): msg is ToolResultMessage {
  return msg.role === MessageRole.Tool
}

export function isCheckpointMessage(msg: ChatMessage): msg is CheckpointMessage {
  return msg.role === MessageRole.Checkpoint
}

export function isInterruptedToolMessage(msg: ChatMessage): msg is InterruptedToolMessage {
  return msg.role === MessageRole.InterruptedTool
}

export function isTextPart(part: AssistantPart): part is TextPart {
  return part.type === 'text'
}

export function isToolCallPart(part: AssistantPart): part is ToolCallPart {
  return part.type === 'tool_call'
}

export function getMessageText(content: MessageContent): string {
  if (typeof content === 'string') return content
  return content
    .filter((c): c is TextContent => c.type === 'text')
    .map(c => c.text)
    .join('')
}

export function getMessageImages(content: MessageContent): ImageContent[] {
  if (typeof content === 'string') return []
  return content.filter((c): c is ImageContent => c.type === 'image')
}

// 获取消息中所有修改的文件路径
export function getModifiedFilesFromMessages(messages: ChatMessage[]): string[] {
  const files = new Set<string>()

  for (const msg of messages) {
    if (isAssistantMessage(msg)) {
      for (const part of msg.parts) {
        if (isToolCallPart(part)) {
          const tc = part.toolCall
          if (['edit_file', 'write_file', 'create_file_or_folder'].includes(tc.name)) {
            const path = (tc.arguments.path || (tc.arguments._meta as any)?.filePath) as string
            if (path) files.add(path)
          }
        }
      }
    }
  }

  return Array.from(files)
}

// 获取最近的 checkpoint 索引
export function findLastCheckpointIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCheckpointMessage(messages[i])) {
      return i
    }
  }
  return -1
}
