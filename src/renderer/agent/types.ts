/**
 * Agent 模块统一类型定义
 * 
 * Agent 专用类型定义，通用 LLM 类型从 @/shared/types 重新导出
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
import { isFileEditTool } from '@/shared/config/tools'

// ============================================
// Agent 专用消息类型
// ============================================

import type { TextContent, ImageContent, MessageContent, ToolCall, ToolResultType } from '@/shared/types'

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
    /** 交互式内容（选项卡片等） */
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
// 交互式内容类型（用于 Plan 模式问答）
// ============================================

/** 选项 */
export interface InteractiveOption {
    id: string
    label: string
    icon?: string
    description?: string
}

/** 交互式选项内容 */
export interface InteractiveContent {
    type: 'interactive'
    question: string
    options: InteractiveOption[]
    multiSelect?: boolean
    selectedIds?: string[]
}

// ============================================
// Plan 相关类型
// ============================================

/** 计划项状态 */
export type PlanItemStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'

/** 计划状态 */
export type PlanStatus = 'draft' | 'active' | 'completed' | 'failed'

/** 计划项 */
export interface PlanItem {
    id: string
    title: string
    description?: string
    status: PlanItemStatus
}

/** 计划 */
export interface Plan {
    id: string
    items: PlanItem[]
    status: PlanStatus
    currentStepId: string | null
    createdAt: number
    updatedAt: number
}

/** 计划文件 JSON 格式（用于持久化存储） */
export interface PlanFileData {
    version: 1
    title: string
    status: PlanStatus
    createdAt: number
    updatedAt: number
    items: Array<{
        id: string
        title: string
        description?: string
        status: PlanItemStatus
    }>
}

// ============================================
// 上下文相关类型
// ============================================

/** 上下文项类型 */
export type ContextItemType = 'File' | 'CodeSelection' | 'Folder' | 'Codebase' | 'Git' | 'Terminal' | 'Symbols' | 'Web' | 'Problems'

export interface FileContext { type: 'File'; uri: string }
export interface CodeSelectionContext { type: 'CodeSelection'; uri: string; range: [number, number] }
export interface FolderContext { type: 'Folder'; uri: string }
export interface CodebaseContext { type: 'Codebase'; query?: string }
export interface GitContext { type: 'Git' }
export interface TerminalContext { type: 'Terminal' }
export interface SymbolsContext { type: 'Symbols' }
export interface WebContext { type: 'Web'; query?: string }
export interface ProblemsContext { type: 'Problems'; uri?: string }

/** 上下文项联合类型 */
export type ContextItem =
    | FileContext
    | CodeSelectionContext
    | FolderContext
    | CodebaseContext
    | GitContext
    | TerminalContext
    | SymbolsContext
    | WebContext
    | ProblemsContext

// ============================================
// 线程和流状态类型
// ============================================

/** 线程状态 */
export interface ThreadState {
    currentCheckpointIdx: number | null
    isStreaming: boolean
    pendingToolCall?: ToolCall
    error?: string
}

/** 聊天线程 */
export interface ChatThread {
    id: string
    createdAt: number
    lastModified: number
    messages: ChatMessage[]
    contextItems: ContextItem[]
    state: ThreadState
    /** Handoff 上下文（从上一个会话继承，用于注入 system prompt） */
    handoffContext?: string
    /** 上下文压缩摘要 */
    contextSummary?: import('./context/types').StructuredSummary | null
}

/** 流阶段 */
export type StreamPhase = 'idle' | 'streaming' | 'tool_pending' | 'tool_running' | 'error'

/** 流状态 */
export interface StreamState {
    phase: StreamPhase
    currentToolCall?: ToolCall
    error?: string
    statusText?: string
}

// ============================================
// 文件和检查点类型
// ============================================

/** 文件快照 */
export interface FileSnapshot {
    /** 文件完整路径 */
    path: string
    /** 文件内容，null 表示文件不存在 */
    content: string | null
    /** 快照时间戳 */
    timestamp?: number
}

/** 变更类型 */
export type ChangeType = 'create' | 'modify' | 'delete'

/** 待确认的更改 */
export interface PendingChange {
    id: string
    filePath: string
    toolCallId: string
    toolName: string
    status: 'pending' | 'accepted' | 'rejected'
    snapshot: FileSnapshot
    /** 新内容（用于 Diff 展示） */
    newContent: string | null
    /** 变更类型 */
    changeType: ChangeType
    timestamp: number
    linesAdded: number
    linesRemoved: number
}

/** 消息检查点 */
export interface MessageCheckpoint {
    id: string
    messageId: string
    timestamp: number
    fileSnapshots: Record<string, FileSnapshot>
    description: string
}

/** 检查点 */
export interface Checkpoint {
    id: string
    type: 'user_message' | 'tool_edit'
    timestamp: number
    snapshots: Record<string, FileSnapshot>
    description: string
    messageId?: string
}

// ============================================
// 服务相关类型
// ============================================

/** Lint 错误 */
export interface LintError {
    file: string
    line?: number
    column?: number
    message: string
    severity: 'error' | 'warning' | 'info'
    rule?: string
    code?: string
    startLine?: number
    endLine?: number
}

/** 流式编辑状态 */
export interface StreamingEditState {
    editId: string
    filePath: string
    originalContent: string
    currentContent: string
    isComplete: boolean
    startTime: number
    endTime?: number
}

// ============================================
// 类型守卫函数
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
        .map(c => c.text)
        .join('')
}

export function getMessageImages(content: MessageContent): ImageContent[] {
    if (typeof content === 'string') return []
    return (content as Array<TextContent | ImageContent>).filter((c): c is ImageContent => c.type === 'image')
}

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
        if (isCheckpointMessage(messages[i])) return i
    }
    return -1
}
