/**
 * Plan 相关类型定义
 */

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
