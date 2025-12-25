/**
 * Agent 核心枚举定义
 */

export enum MessageRole {
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool',
    Checkpoint = 'checkpoint',
    InterruptedTool = 'interrupted_tool',
}

export enum ToolStatus {
    Pending = 'pending',        // 等待执行/流式接收中
    Running = 'running',        // 正在执行
    Success = 'success',        // 执行成功
    Error = 'error',            // 执行失败
    Rejected = 'rejected',      // 用户拒绝
    Awaiting = 'awaiting',      // 等待用户审批
}

export enum StreamPhase {
    Idle = 'idle',           // 空闲
    Streaming = 'streaming',      // LLM 正在输出
    ToolPending = 'tool_pending',   // 工具等待审批
    ToolRunning = 'tool_running',   // 工具执行中
    Error = 'error',          // 出错
}

export enum ToolResultType {
    ToolRequest = 'tool_request',   // 等待用户审批
    RunningNow = 'running_now',    // 正在执行
    Success = 'success',        // 执行成功
    ToolError = 'tool_error',     // 执行出错
    Rejected = 'rejected',       // 用户拒绝
}

export enum PlanStatus {
    Draft = 'draft',
    Active = 'active',
    Completed = 'completed',
    Failed = 'failed',
}

export enum PlanItemStatus {
    Pending = 'pending',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed',
    Skipped = 'skipped',
}

export enum ContextItemType {
    File = 'File',
    CodeSelection = 'CodeSelection',
    Folder = 'Folder',
    Codebase = 'Codebase',
    Git = 'Git',
    Terminal = 'Terminal',
    Symbols = 'Symbols',
    Web = 'Web',
}

export type ToolApprovalType = 'terminal' | 'dangerous'
