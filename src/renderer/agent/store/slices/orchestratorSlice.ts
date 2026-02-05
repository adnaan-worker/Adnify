/**
 * Orchestrator State Management
 * 管理任务规划、执行状态
 */

import { StateCreator } from 'zustand'
import type { AgentStore } from '../AgentStore'

// ============================================
// 类型定义
// ============================================

/** 任务状态 */
export type OrchestratorTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 执行模式 */
export type ExecutionMode = 'sequential' | 'parallel'

/** 规划状态 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'failed'

/** 单个任务 */
export interface OrchestratorTask {
    id: string
    title: string
    description: string
    /** 分配的 Provider */
    provider: string
    /** 分配的模型 */
    model: string
    /** 分配的角色/提示词模板 */
    role: string
    /** 依赖的任务 ID */
    dependencies: string[]
    /** 任务状态 */
    status: OrchestratorTaskStatus
    /** 执行输出 */
    output?: string
    /** 错误信息 */
    error?: string
    /** 开始时间 */
    startedAt?: number
    /** 完成时间 */
    completedAt?: number
}

/** 任务规划 */
export interface TaskPlan {
    /** 唯一 ID */
    id: string
    /** 人类可读名称 */
    name: string
    /** 创建时间 */
    createdAt: number
    /** 更新时间 */
    updatedAt: number
    /** 需求文档路径（相对于 .adnify/plan/） */
    requirementsDoc: string
    /** 执行模式 */
    executionMode: ExecutionMode
    /** 规划状态 */
    status: PlanStatus
    /** 任务列表 */
    tasks: OrchestratorTask[]
}

/** Orchestrator Slice 状态 */
export interface OrchestratorState {
    /** 所有规划列表 */
    plans: TaskPlan[]
    /** 当前活跃的规划 ID */
    activePlanId: string | null
    /** 是否正在执行 */
    isExecuting: boolean
    /** 当前执行的任务 ID */
    currentTaskId: string | null
}

/** Orchestrator Slice Actions */
export interface OrchestratorActions {
    /** 添加规划 */
    addPlan: (plan: TaskPlan) => void
    /** 设置活跃规划 */
    setActivePlan: (planId: string | null) => void
    /** 更新规划 */
    updatePlan: (planId: string, updates: Partial<TaskPlan>) => void
    /** 删除规划 */
    deletePlan: (planId: string) => void
    /** 更新任务 */
    updateTask: (planId: string, taskId: string, updates: Partial<OrchestratorTask>) => void
    /** 开始执行 */
    startExecution: (planId: string) => void
    /** 结束执行 */
    stopExecution: () => void
    /** 设置当前任务 */
    setCurrentTask: (taskId: string | null) => void
    /** 获取当前规划 */
    getActivePlan: () => TaskPlan | null
    /** 获取下一个待执行任务 */
    getNextPendingTask: (planId: string) => OrchestratorTask | null
}

export type OrchestratorSlice = OrchestratorState & OrchestratorActions

// ============================================
// Slice 创建
// ============================================

export const createOrchestratorSlice: StateCreator<
    AgentStore,
    [],
    [],
    OrchestratorSlice
> = (set, get) => ({
    // ===== 初始状态 =====
    plans: [],
    activePlanId: null,
    isExecuting: false,
    currentTaskId: null,

    // ===== Actions =====
    addPlan: (plan) => {
        set((state) => ({
            plans: [...state.plans, plan],
            activePlanId: plan.id,
        }))
    },

    setActivePlan: (planId) => {
        set({ activePlanId: planId })
    },

    updatePlan: (planId, updates) => {
        set((state) => ({
            plans: state.plans.map((p) =>
                p.id === planId ? { ...p, ...updates, updatedAt: Date.now() } : p
            ),
        }))
    },

    deletePlan: (planId) => {
        set((state) => ({
            plans: state.plans.filter((p) => p.id !== planId),
            activePlanId: state.activePlanId === planId ? null : state.activePlanId,
        }))
    },

    updateTask: (planId, taskId, updates) => {
        set((state) => ({
            plans: state.plans.map((plan) => {
                if (plan.id !== planId) return plan
                return {
                    ...plan,
                    updatedAt: Date.now(),
                    tasks: plan.tasks.map((task) =>
                        task.id === taskId ? { ...task, ...updates } : task
                    ),
                }
            }),
        }))
    },

    startExecution: (planId) => {
        set((state) => ({
            isExecuting: true,
            plans: state.plans.map((p) =>
                p.id === planId ? { ...p, status: 'executing' as PlanStatus } : p
            ),
        }))
    },

    stopExecution: () => {
        set({ isExecuting: false, currentTaskId: null })
    },

    setCurrentTask: (taskId) => {
        set({ currentTaskId: taskId })
    },

    getActivePlan: () => {
        const state = get()
        return state.plans.find((p) => p.id === state.activePlanId) || null
    },

    getNextPendingTask: (planId) => {
        const state = get()
        const plan = state.plans.find((p) => p.id === planId)
        if (!plan) return null

        // 找到第一个待执行且所有依赖都已完成的任务
        return (
            plan.tasks.find((task) => {
                if (task.status !== 'pending') return false
                // 检查所有依赖是否已完成
                return task.dependencies.every((depId) => {
                    const depTask = plan.tasks.find((t) => t.id === depId)
                    return depTask?.status === 'completed'
                })
            }) || null
        )
    },
})
