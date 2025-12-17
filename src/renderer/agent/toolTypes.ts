/**
 * 工具相关类型定义
 */

// ===== Lint 相关类型 =====

export interface LintError {
  file: string
  line: number
  column: number
  message: string
  severity: 'error' | 'warning' | 'info'
  rule?: string
}

// ===== 流式编辑相关类型 =====

export interface StreamingEditState {
  editId: string
  filePath: string
  originalContent: string
  currentContent: string
  isComplete: boolean
  startTime: number
  endTime?: number
}

// ===== 终端相关类型 =====

export interface PersistentTerminal {
  id: string
  name: string
  cwd: string
  isRunning: boolean
  lastOutput: string
  createdAt: number
}

export interface TerminalCommandResult {
  success: boolean
  output: string
  exitCode: number
  duration: number
}

// ===== Checkpoint 相关类型 =====

export interface FileSnapshot {
  path: string
  content: string | null
  timestamp: number
}

export interface Checkpoint {
  id: string
  type: 'user_message' | 'tool_edit'
  timestamp: number
  snapshots: Record<string, FileSnapshot>
  description: string
}

// ===== 工具状态类型 =====

export type ToolStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'rejected'
  | 'awaiting'

export type ToolApprovalType = 'edits' | 'terminal' | 'dangerous'
