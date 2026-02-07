/**
 * Orchestrator State Management
 * 管理任务规划、执行状态
 * 
 * 重构：使用新的 orchestrator 模块类型
 */

import { StateCreator } from 'zustand'
import type { AgentStore } from '../AgentStore'
import type {
    OrchestratorState as ControllerState,
    TaskPlan,
    OrchestratorTask,
    TaskStatus,
    ExecutionMode,
    PlanStatus,
} from '../../orchestrator/types'
import { useStore } from '@store'

// ============================================
// 类型定义（从 orchestrator/types 重新导出）
// ============================================

export type { TaskStatus, ExecutionMode, PlanStatus, OrchestratorTask, TaskPlan }

// 兼容旧代码
export type OrchestratorTaskStatus = TaskStatus

/** Orchestrator 阶段（简化为两阶段，内部使用完整状态机） */
export type OrchestratorPhase = 'planning' | 'executing'

/** Orchestrator Slice 状态 */
export interface OrchestratorState {
    /** 所有规划列表 */
    plans: TaskPlan[]
    /** 当前活跃的规划 ID */
    activePlanId: string | null
    /** 当前阶段（UI 显示用，内部状态机更精细） */
    phase: OrchestratorPhase
    /** 是否正在执行 */
    isExecuting: boolean
    /** 当前执行的任务 ID */
    currentTaskId: string | null
    /** 控制器状态（完整状态机状态） */
    controllerState: ControllerState
}

/** Orchestrator Slice Actions */
export interface OrchestratorActions {
    // ===== 计划管理 =====
    /** 添加规划 */
    addPlan: (plan: TaskPlan) => void
    /** 设置活跃规划 */
    setActivePlan: (planId: string | null) => void
    /** 更新规划 */
    updatePlan: (planId: string, updates: Partial<TaskPlan>) => void
    /** 删除规划 */
    deletePlan: (planId: string) => void
    /** 设置所有计划（用于从磁盘加载） */
    setPlans: (plans: TaskPlan[]) => void
    /** 从磁盘加载计划 */
    loadPlansFromDisk: (workspacePath: string) => Promise<void>

    // ===== 任务管理 =====
    /** 更新任务 */
    updateTask: (planId: string, taskId: string, updates: Partial<OrchestratorTask>) => void
    /** 标记任务完成 */
    markTaskCompleted: (planId: string, taskId: string, output: string) => void
    /** 标记任务失败 */
    markTaskFailed: (planId: string, taskId: string, error: string) => void
    /** 标记任务跳过 */
    markTaskSkipped: (planId: string, taskId: string, reason: string) => void

    // ===== 执行控制 =====
    /** 设置阶段 */
    setPhase: (phase: OrchestratorPhase) => void
    /** 设置控制器状态 */
    setControllerState: (state: ControllerState) => void
    /** 开始执行 */
    startExecution: (planId: string) => void
    /** 暂停执行 */
    pauseExecution: () => void
    /** 恢复执行 */
    resumeExecution: () => void
    /** 结束执行 */
    stopExecution: () => void
    /** 设置当前任务 */
    setCurrentTask: (taskId: string | null) => void

    // ===== 查询 =====
    /** 获取当前规划 */
    getActivePlan: () => TaskPlan | null
    /** 获取指定规划 */
    getPlan: (planId: string) => TaskPlan | null
    /** 获取下一个待执行任务 */
    getNextPendingTask: (planId: string) => OrchestratorTask | null
    /** 获取所有可执行任务（依赖已满足） */
    getExecutableTasks: (planId: string) => OrchestratorTask[]
    /** 保存规划到磁盘 */
    savePlan: (planId: string) => Promise<void>
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
    phase: 'planning' as OrchestratorPhase,
    isExecuting: false,
    currentTaskId: null,
    controllerState: 'idle' as ControllerState,

    // ===== 计划管理 =====
    addPlan: (plan) => {
        set((state) => ({
            plans: [...state.plans, plan],
            activePlanId: plan.id,
            phase: 'planning' as OrchestratorPhase,
            controllerState: 'reviewing' as ControllerState,
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
        get().savePlan(planId)
    },

    deletePlan: (planId) => {
        set((state) => ({
            plans: state.plans.filter((p) => p.id !== planId),
            activePlanId: state.activePlanId === planId ? null : state.activePlanId,
        }))
    },

    setPlans: (plans) => {
        set({ plans })
    },

    loadPlansFromDisk: async (workspacePath) => {
        try {
            const { api } = await import('@/renderer/services/electronAPI')
            const planDir = `${workspacePath}/.adnify/plan`

            // 检查目录是否存在
            const exists = await api.file.exists(planDir)
            if (!exists) return

            // 读取目录
            // readDir 返回 { name: string, isDirectory: boolean }[]
            const files = await api.file.readDir(planDir)
            if (!files || !Array.isArray(files) || files.length === 0) return

            // 提取文件名并过滤 JSON 文件
            // 兼容处理：支持对象数组（新API）或字符串数组（旧API）
            const jsonFiles = files
                .filter((f: any) => {
                    const name = typeof f === 'string' ? f : f.name
                    const isDir = typeof f === 'string' ? false : f.isDirectory
                    return !isDir && name.endsWith('.json')
                })
                .map((f: any) => typeof f === 'string' ? f : f.name)

            const plans: TaskPlan[] = []

            for (const file of jsonFiles) {
                try {
                    const content = await api.file.read(`${planDir}/${file}`)
                    if (content) {
                        const plan = JSON.parse(content) as TaskPlan
                        // 验证必要字段
                        if (plan.id && plan.name && Array.isArray(plan.tasks)) {
                            plans.push(plan)
                        }
                    }
                } catch (e) {
                    console.warn(`[OrchestratorSlice] Failed to load plan: ${file}`, e)
                }
            }

            if (plans.length > 0) {
                // 按更新时间排序（最新的在前）
                plans.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                set({ plans })
                console.log(`[OrchestratorSlice] Loaded ${plans.length} plans from disk`)
            }
        } catch (e) {
            console.warn('[OrchestratorSlice] Failed to load plans from disk:', e)
        }
    },

    savePlan: async (planId) => {
        const plan = get().plans.find(p => p.id === planId)
        if (!plan) return

        try {
            const workspacePath = useStore.getState().workspacePath
            if (!workspacePath) return

            const { api } = await import('@/renderer/services/electronAPI')
            const planPath = `${workspacePath}/.adnify/plan/${planId}.json`

            // 确保 updatedAt 是最新的
            const planToSave = { ...plan, updatedAt: Date.now() }
            await api.file.write(planPath, JSON.stringify(planToSave, null, 2))
        } catch (error) {
            console.error('[OrchestratorSlice] Failed to save plan:', error)
        }
    },

    // ===== 任务管理 =====
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
        get().savePlan(planId)
    },

    markTaskCompleted: (planId, taskId, output) => {
        get().updateTask(planId, taskId, {
            status: 'completed',
            output,
            completedAt: Date.now(),
        })
    },

    markTaskFailed: (planId, taskId, error) => {
        get().updateTask(planId, taskId, {
            status: 'failed',
            error,
            completedAt: Date.now(),
        })
    },

    markTaskSkipped: (planId, taskId, reason) => {
        get().updateTask(planId, taskId, {
            status: 'skipped',
            error: reason,
            completedAt: Date.now(),
        })
    },

    // ===== 执行控制 =====
    setPhase: (phase) => {
        set({ phase })
    },

    setControllerState: (controllerState) => {
        set({ controllerState })
    },

    startExecution: (planId) => {
        const plan = get().plans.find(p => p.id === planId)
        if (!plan) return

        // 找到第一个可执行任务
        const firstTask = get().getNextPendingTask(planId)

        set((state) => ({
            isExecuting: true,
            phase: 'executing' as OrchestratorPhase,
            controllerState: 'executing' as ControllerState,
            currentTaskId: firstTask?.id || null,
            plans: state.plans.map((p) => {
                if (p.id !== planId) return p
                return {
                    ...p,
                    status: 'executing' as PlanStatus,
                    tasks: p.tasks.map((task) =>
                        task.id === firstTask?.id
                            ? { ...task, status: 'running' as TaskStatus, startedAt: Date.now() }
                            : task
                    ),
                }
            }),
        }))
    },

    pauseExecution: () => {
        const state = get()
        if (!state.activePlanId) return

        set((state) => ({
            isExecuting: false,
            controllerState: 'paused' as ControllerState,
            plans: state.plans.map((p) =>
                p.id === state.activePlanId ? { ...p, status: 'paused' as PlanStatus } : p
            ),
        }))
    },

    resumeExecution: () => {
        const state = get()
        if (!state.activePlanId) return

        set((state) => ({
            isExecuting: true,
            controllerState: 'executing' as ControllerState,
            plans: state.plans.map((p) =>
                p.id === state.activePlanId ? { ...p, status: 'executing' as PlanStatus } : p
            ),
        }))
    },

    stopExecution: () => {
        set({
            isExecuting: false,
            currentTaskId: null,
            phase: 'planning' as OrchestratorPhase,
            controllerState: 'idle' as ControllerState,
        })
    },

    setCurrentTask: (taskId) => {
        set({ currentTaskId: taskId })
    },

    // ===== 查询 =====
    getActivePlan: () => {
        const state = get()
        return state.plans.find((p) => p.id === state.activePlanId) || null
    },

    getPlan: (planId) => {
        return get().plans.find((p) => p.id === planId) || null
    },

    getNextPendingTask: (planId) => {
        const tasks = get().getExecutableTasks(planId)
        return tasks[0] || null
    },

    getExecutableTasks: (planId) => {
        const state = get()
        const plan = state.plans.find((p) => p.id === planId)
        if (!plan) return []

        const executable: OrchestratorTask[] = []

        for (const task of plan.tasks) {
            if (task.status !== 'pending') continue

            // 检查依赖状态
            let allDepsCompleted = true
            let anyDepFailed = false

            for (const depId of task.dependencies) {
                const depTask = plan.tasks.find((t) => t.id === depId)
                if (!depTask) continue

                if (depTask.status === 'failed' || depTask.status === 'skipped') {
                    anyDepFailed = true
                    break
                }

                if (depTask.status !== 'completed') {
                    allDepsCompleted = false
                }
            }

            // 如果依赖失败，标记为跳过
            if (anyDepFailed) {
                // 异步更新，避免在 get 中调用 set
                setTimeout(() => {
                    get().markTaskSkipped(planId, task.id, 'Dependency failed or skipped')
                }, 0)
                continue
            }

            if (allDepsCompleted) {
                executable.push(task)
            }
        }

        return executable
    },
})
