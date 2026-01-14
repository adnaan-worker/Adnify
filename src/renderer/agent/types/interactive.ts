/**
 * 交互式内容类型（用于 Plan 模式问答）
 */

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
