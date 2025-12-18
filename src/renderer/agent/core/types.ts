/**
 * Agent 核心类型定义
 * 参考 Cursor/Void 的架构设计
 */

// ===== 工具相关类型 =====

export type ToolStatus =
  | 'pending'        // 等待执行/流式接收中
  | 'running'        // 正在执行
  | 'success'        // 执行成功
  | 'error'          // 执行失败
  | 'rejected'       // 用户拒绝
  | 'awaiting'       // 等待用户审批

// edits 已移除 - 文件编辑不需要确认（可通过Checkpoint撤销）
export type ToolApprovalType = 'terminal' | 'dangerous'

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string
  rawParams?: Record<string, unknown>
}

export interface ToolDefinition {
  name: string
  description: string
  approvalType?: ToolApprovalType
  parameters: {
    type: 'object'
    properties: Record<string, {
      type: string
      description: string
      enum?: string[]
    }>
    required: string[]
  }
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
  role: 'user'
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
  role: 'assistant'
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
export type ToolResultType =
  | 'tool_request'   // 等待用户审批
  | 'running_now'    // 正在执行
  | 'success'        // 执行成功
  | 'tool_error'     // 执行出错
  | 'rejected'       // 用户拒绝

export interface ToolResultMessage {
  id: string
  role: 'tool'
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
  role: 'checkpoint'
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
  role: 'interrupted_tool'
  name: string
  timestamp: number
}

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | CheckpointMessage
  | InterruptedToolMessage

// ===== 上下文相关类型 =====

export type ContextItemType = 'File' | 'CodeSelection' | 'Folder' | 'Codebase' | 'Git' | 'Terminal' | 'Symbols'

export interface FileContext {
  type: 'File'
  uri: string
}

export interface CodeSelectionContext {
  type: 'CodeSelection'
  uri: string
  range: [number, number]
}

export interface FolderContext {
  type: 'Folder'
  uri: string
}

export interface CodebaseContext {
  type: 'Codebase'
  query?: string
}

export interface GitContext {
  type: 'Git'
}

export interface TerminalContext {
  type: 'Terminal'
}

export interface SymbolsContext {
  type: 'Symbols'
}

export type ContextItem =
  | FileContext
  | CodeSelectionContext
  | FolderContext
  | CodebaseContext
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

export type StreamPhase =
  | 'idle'           // 空闲
  | 'streaming'      // LLM 正在输出
  | 'tool_pending'   // 工具等待审批
  | 'tool_running'   // 工具执行中
  | 'error'          // 出错

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
