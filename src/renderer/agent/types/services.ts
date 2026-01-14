/**
 * 服务相关类型定义
 */

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
