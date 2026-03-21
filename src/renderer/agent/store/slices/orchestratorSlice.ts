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
import {
    createDefaultExecutionStrategySnapshot,
    createDefaultTaskBudget,
    createEmptyExecutionHeartbeatSnapshot,
    createEmptyExecutionQueueSummary,
    createEmptyProposalSummary,
    createEmptySpecialistProfileSnapshot,
    createInitialExecutionTaskGovernanceState,
    createInitialPatrolState,
    createInitialRecoveryCheckpoint,
    createInitialRollbackState,
} from '../../types/taskExecution'
import type {
    ChangeProposal,
    CircuitBreakerState,
    CreateChangeProposalInput,
    CreateExecutionQueueItemInput,
    CreateExecutionTaskInput,
    CreateOwnershipLeaseInput,
    CreateTaskHandoffInput,
    ExecutionQueueItem,
    ExecutionQueueSummary,
    ExecutionTask,
    ExecutionTaskState,
    OwnershipLease,
    ProposalSummary,
    SpecialistKind,
    SpecialistProfileSnapshot,
    TaskBudgetState,
    TaskHandoff,
    AdjudicationCase,
    WorkPackage,
    WorkPackageStatus,
} from '../../types/taskExecution'
import { buildTaskWorkPackages } from '../../services/taskTemplateService'
import { recordBudgetUsage } from '../../services/budgetLedgerService'
import { createRollbackProposal, createRollbackStateFromProposal } from '../../services/rollbackOrchestratorService'
import { shouldUseIsolatedWorkspace } from '../../types/trustPolicy'
import { createAdjudicationCase as buildAdjudicationCase, resolveAdjudicationCase as applyAdjudicationResolution } from '../../services/coordinatorService'
import { useStore } from '@store'

// ============================================
// 类型定义（从 orchestrator/types 重新导出）
// ============================================

export type { TaskStatus, ExecutionMode, PlanStatus, OrchestratorTask, TaskPlan }

// 兼容旧代码
export type OrchestratorTaskStatus = TaskStatus

/** Orchestrator 阶段（简化为两阶段，内部使用完整状态机） */
export type OrchestratorPhase = 'planning' | 'executing'

function createExecutionEntityId(prefix: string): string {
    return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const TASK_BUDGET_DIMENSIONS: Array<keyof TaskBudgetState['limits']> = ['timeMs', 'estimatedTokens', 'llmCalls', 'commands', 'verifications']

function resolveSpecialistProfileSnapshot(
    specialists: SpecialistKind[],
    inputSnapshot?: SpecialistProfileSnapshot,
): SpecialistProfileSnapshot {
    if (inputSnapshot) {
        return inputSnapshot
    }

    return createEmptySpecialistProfileSnapshot(
        specialists,
        useStore.getState().taskTrustSettings.specialistProfiles as Partial<Record<SpecialistKind, any>> | undefined,
    )
}

function resolveTaskWritableScopes(
    specialists: SpecialistKind[],
    specialistProfilesSnapshot: SpecialistProfileSnapshot,
    inputWritableScopes?: string[],
): string[] {
    const explicitScopes = (inputWritableScopes || []).filter(Boolean)
    if (explicitScopes.length > 0) {
        return Array.from(new Set(explicitScopes))
    }

    return Array.from(new Set(
        specialists.flatMap((role) => specialistProfilesSnapshot[role]?.writableScopes || []).filter(Boolean),
    ))
}

function resolveTaskBudget(
    specialists: SpecialistKind[],
    specialistProfilesSnapshot: SpecialistProfileSnapshot,
    inputBudget?: TaskBudgetState,
): TaskBudgetState {
    if (inputBudget) {
        return inputBudget
    }

    const defaultBudget = createDefaultTaskBudget()
    const governanceBudget = useStore.getState().taskTrustSettings.governanceDefaults?.budget
    const resolvedBudget: TaskBudgetState = {
        ...defaultBudget,
        limits: {
            ...defaultBudget.limits,
            ...(governanceBudget?.limits || {}),
        },
        warningThresholdRatio: governanceBudget?.warningThresholdRatio ?? defaultBudget.warningThresholdRatio,
        hardStop: governanceBudget?.hardStop ?? defaultBudget.hardStop,
    }

    for (const dimension of TASK_BUDGET_DIMENSIONS) {
        const specialistCap = specialists.reduce((sum, role) => {
            const value = specialistProfilesSnapshot[role]?.budgetCap?.[dimension]
            return typeof value === 'number' && value > 0 ? sum + value : sum
        }, 0)

        if (specialistCap > 0) {
            resolvedBudget.limits[dimension] = Math.min(resolvedBudget.limits[dimension], specialistCap)
        }
    }

    return resolvedBudget
}

function summarizeExecutionQueue(
    taskId: string,
    ownershipLeases: Record<string, OwnershipLease>,
    executionQueueItems: Record<string, ExecutionQueueItem>,
): ExecutionQueueSummary {
    const queuedItems = Object.values(executionQueueItems).filter((item) =>
        item.taskId === taskId && item.status === 'queued',
    )
    const activeLeases = Object.values(ownershipLeases).filter((lease) =>
        lease.taskId === taskId && lease.status !== 'released',
    )

    return {
        queuedCount: queuedItems.length,
        activeLeaseCount: activeLeases.length,
        blockedScopes: Array.from(new Set(queuedItems.flatMap((item) => item.blockedScopes))),
        updatedAt: queuedItems.length > 0 || activeLeases.length > 0 ? Date.now() : null,
    }
}

function summarizeProposals(
    taskId: string,
    changeProposals: Record<string, ChangeProposal>,
): ProposalSummary {
    const proposals = Object.values(changeProposals).filter((proposal) => proposal.taskId === taskId)

    return {
        pendingCount: proposals.filter((proposal) => proposal.status === 'pending').length,
        appliedCount: proposals.filter((proposal) => proposal.status === 'applied').length,
        returnedForReworkCount: proposals.filter((proposal) => proposal.status === 'returned-for-rework').length,
        reassignedCount: proposals.filter((proposal) => proposal.status === 'reassigned').length,
        discardedCount: proposals.filter((proposal) => proposal.status === 'discarded').length,
        updatedAt: proposals.length > 0
            ? Math.max(...proposals.map((proposal) => proposal.resolvedAt ?? proposal.createdAt))
            : null,
    }
}

function findLatestProposalId(
    taskId: string,
    changeProposals: Record<string, ChangeProposal>,
): string | null {
    const proposals = Object.values(changeProposals).filter((proposal) => proposal.taskId === taskId)
    if (proposals.length === 0) return null

    proposals.sort((a, b) => (b.createdAt - a.createdAt) || b.id.localeCompare(a.id))
    return proposals[0]?.id ?? null
}

function syncTaskDerivedOrchestrationState(
    task: ExecutionTask,
    ownershipLeases: Record<string, OwnershipLease>,
    executionQueueItems: Record<string, ExecutionQueueItem>,
    changeProposals: Record<string, ChangeProposal>,
    overrides: Partial<ExecutionTask> = {},
): ExecutionTask {
    return {
        ...task,
        ...overrides,
        queueSummary: summarizeExecutionQueue(task.id, ownershipLeases, executionQueueItems),
        proposalSummary: summarizeProposals(task.id, changeProposals),
        latestProposalId: overrides.latestProposalId ?? findLatestProposalId(task.id, changeProposals),
        updatedAt: overrides.updatedAt ?? Date.now(),
    }
}

const STOP_RESETTABLE_WORK_PACKAGE_STATUSES = new Set<WorkPackageStatus>([
    'queued',
    'leasing',
    'running',
    'executing',
    'verifying',
    'waiting-approval',
])

function resolveExecutionTaskStateAfterManualStop(
    task: ExecutionTask,
    workPackages: Record<string, WorkPackage>,
    changeProposals: Record<string, ChangeProposal>,
): ExecutionTaskState {
    if (task.state === 'complete' || task.state === 'tripped') {
        return task.state
    }

    const hasPendingProposal = Object.values(changeProposals).some((proposal) =>
        proposal.taskId === task.id && proposal.status === 'pending',
    )
    if (hasPendingProposal) {
        return 'blocked'
    }

    const taskWorkPackages = task.workPackages
        .map((workPackageId) => workPackages[workPackageId])
        .filter(Boolean)

    if (taskWorkPackages.some((workPackage) => ['proposal-ready', 'handoff', 'handoff-ready', 'blocked', 'verified'].includes(workPackage.status))) {
        return 'blocked'
    }

    return 'planning'
}

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
    /** 可视化执行任务 */
    executionTasks: Record<string, ExecutionTask>
    /** 可视化工作包 */
    workPackages: Record<string, WorkPackage>
    /** 结构化移交包 */
    taskHandoffs: Record<string, TaskHandoff>
    /** 作用域租约 */
    ownershipLeases: Record<string, OwnershipLease>
    /** 执行排队项 */
    executionQueueItems: Record<string, ExecutionQueueItem>
    /** 变更提案 */
    changeProposals: Record<string, ChangeProposal>
    /** 裁决案例 */
    adjudicationCases: Record<string, AdjudicationCase>
    /** 当前选中的执行任务 */
    activeExecutionTaskId: string | null
    /** 当前选中的移交包 */
    selectedTaskHandoffId: string | null
    /** 当前选中的变更提案 */
    selectedChangeProposalId: string | null
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

    // ===== 执行任务建模 =====
    /** 创建可视化执行任务 */
    createExecutionTask: (input: CreateExecutionTaskInput) => string
    /** 更新执行任务 */
    updateExecutionTask: (taskId: string, updates: Partial<ExecutionTask>) => void
    /** 设置执行任务状态 */
    setExecutionTaskState: (taskId: string, state: ExecutionTaskState) => void
    /** 选中执行任务 */
    selectExecutionTask: (taskId: string | null) => void
    /** 设置任务熔断状态 */
    setExecutionTaskCircuitBreaker: (taskId: string, circuitBreaker: CircuitBreakerState | null) => void
    recordExecutionTaskBudgetUsage: (taskId: string, delta: Partial<ExecutionTask['budget']['usage']>) => void
    proposeExecutionTaskRollback: (taskId: string, input: { changedFiles?: string[]; externalSideEffects?: string[] }) => void
    openExecutionTaskAdjudication: (taskId: string, input: { trigger: AdjudicationCase['trigger']; reason: string; changedFiles?: string[]; workPackageId?: string | null }) => string
    resolveExecutionTaskAdjudication: (caseId: string, resolution: { action: AdjudicationCase['recommendedAction']; selectedFiles?: string[]; targetSpecialist?: SpecialistKind }) => void
    completeExecutionTaskRollback: (taskId: string) => void
    /** 更新工作包 */
    updateWorkPackage: (workPackageId: string, updates: Partial<WorkPackage>) => void
    /** 设置工作包状态 */
    setWorkPackageStatus: (workPackageId: string, status: WorkPackageStatus) => void
    /** 创建移交包 */
    createTaskHandoff: (input: CreateTaskHandoffInput) => string
    /** 选中移交包 */
    selectTaskHandoff: (handoffId: string | null) => void
    /** 创建写入作用域租约 */
    createOwnershipLease: (input: CreateOwnershipLeaseInput) => string
    /** 更新作用域租约 */
    updateOwnershipLease: (leaseId: string, updates: Partial<OwnershipLease>) => void
    /** 释放作用域租约 */
    releaseOwnershipLease: (leaseId: string) => void
    /** 创建排队项 */
    createExecutionQueueItem: (input: CreateExecutionQueueItemInput) => string
    /** 更新排队项 */
    updateExecutionQueueItem: (queueItemId: string, updates: Partial<ExecutionQueueItem>) => void
    /** 创建变更提案 */
    createChangeProposal: (input: CreateChangeProposalInput) => string
    /** 更新变更提案 */
    updateChangeProposal: (proposalId: string, updates: Partial<ChangeProposal>) => void
    /** 选中变更提案 */
    selectChangeProposal: (proposalId: string | null) => void

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
    /** 手动停止后回收运行时残留状态 */
    cleanupManualStopState: (planId?: string | null, taskId?: string | null) => void
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
    /** 获取任务下的工作包 */
    getTaskWorkPackages: (taskId: string) => WorkPackage[]
    /** 获取任务下的移交包 */
    getTaskHandoffs: (taskId: string) => TaskHandoff[]
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
    executionTasks: {},
    workPackages: {},
    taskHandoffs: {},
    ownershipLeases: {},
    executionQueueItems: {},
    changeProposals: {},
    adjudicationCases: {},
    activeExecutionTaskId: null,
    selectedTaskHandoffId: null,
    selectedChangeProposalId: null,

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

    createExecutionTask: (input) => {
        const specialists: SpecialistKind[] = input.specialists.length > 0 ? [...input.specialists] : ['logic']
        const taskId = createExecutionEntityId('task')
        const risk = input.risk ?? (specialists.length > 1 ? 'medium' : 'low')
        const specialistProfilesSnapshot = resolveSpecialistProfileSnapshot(specialists, input.specialistProfilesSnapshot)
        const writableScopes = resolveTaskWritableScopes(specialists, specialistProfilesSnapshot, input.writableScopes)
        const workPackages = buildTaskWorkPackages(taskId, {
            objective: input.objective,
            specialists,
            writableScopes,
        })
        const executionTarget = input.executionTarget ?? (
            shouldUseIsolatedWorkspace({ risk, fileCount: workPackages.length }) ? 'isolated' : 'current'
        )
        const now = Date.now()

        const resolvedTrustMode = input.trustMode ?? 'balanced'

        const task: ExecutionTask = {
            id: taskId,
            sourcePlanId: input.sourcePlanId,
            objective: input.objective,
            specialists,
            autonomyMode: input.autonomyMode ?? (resolvedTrustMode === 'autonomous' ? 'autonomous' : 'manual'),
            state: 'planning',
            governanceState: input.governanceState ?? createInitialExecutionTaskGovernanceState(),
            patrol: input.patrol ?? createInitialPatrolState(),
            heartbeat: input.heartbeat ?? createEmptyExecutionHeartbeatSnapshot(),
            recoveryCheckpoint: input.recoveryCheckpoint ?? createInitialRecoveryCheckpoint(),
            risk,
            executionTarget,
            trustMode: resolvedTrustMode,
            modelRoutingPolicy: input.modelRoutingPolicy ?? 'balanced',
            executionStrategy: input.executionStrategy ?? createDefaultExecutionStrategySnapshot(),
            workPackages: workPackages.map((pkg) => pkg.id),
            sourceWorkspacePath: input.sourceWorkspacePath ?? null,
            resolvedWorkspacePath: input.resolvedWorkspacePath ?? null,
            isolationMode: input.isolationMode ?? null,
            isolationStatus: input.isolationStatus ?? 'pending',
            isolationError: input.isolationError ?? null,
            queueSummary: input.queueSummary ?? createEmptyExecutionQueueSummary(),
            proposalSummary: input.proposalSummary ?? createEmptyProposalSummary(),
            latestHandoffId: null,
            latestProposalId: null,
            latestAdjudicationId: null,
            circuitBreaker: null,
            budget: resolveTaskBudget(specialists, specialistProfilesSnapshot, input.budget),
            rollback: input.rollback ?? createInitialRollbackState(),
            specialistProfilesSnapshot,
            createdAt: now,
            updatedAt: now,
        }

        set((state) => ({
            executionTasks: {
                ...state.executionTasks,
                [taskId]: task,
            },
            workPackages: {
                ...state.workPackages,
                ...Object.fromEntries(workPackages.map((pkg) => [pkg.id, pkg])),
            },
            activeExecutionTaskId: taskId,
        }))

        return taskId
    },

    updateExecutionTask: (taskId, updates) => {
        set((state) => {
            const current = state.executionTasks[taskId]
            if (!current) return state

            return {
                executionTasks: {
                    ...state.executionTasks,
                    [taskId]: {
                        ...current,
                        ...updates,
                        updatedAt: Date.now(),
                    },
                },
            }
        })
    },

    setExecutionTaskState: (taskId, stateValue) => {
        get().updateExecutionTask(taskId, { state: stateValue })
    },

    selectExecutionTask: (taskId) => {
        set({ activeExecutionTaskId: taskId })
    },

    setExecutionTaskCircuitBreaker: (taskId, circuitBreaker) => {
        get().updateExecutionTask(taskId, { circuitBreaker })
    },

    recordExecutionTaskBudgetUsage: (taskId, delta) => {
        set((state) => {
            const task = state.executionTasks[taskId]
            if (!task) return state

            const nextBudget = recordBudgetUsage(task.budget, delta)
            const tripReport = nextBudget.tripReport
            const adjudicationCase = tripReport ? buildAdjudicationCase({
                taskId,
                trigger: 'budget-trip',
                reason: tripReport.summary,
                changedFiles: [],
            }) : null

            return {
                executionTasks: {
                    ...state.executionTasks,
                    [taskId]: {
                        ...task,
                        budget: nextBudget,
                        state: tripReport ? 'tripped' : task.state,
                        governanceState: tripReport ? 'awaiting-adjudication' : task.governanceState,
                        latestAdjudicationId: adjudicationCase?.id ?? task.latestAdjudicationId ?? null,
                        updatedAt: Date.now(),
                    },
                },
                adjudicationCases: adjudicationCase ? {
                    ...state.adjudicationCases,
                    [adjudicationCase.id]: adjudicationCase,
                } : state.adjudicationCases,
            }
        })
    },

    proposeExecutionTaskRollback: (taskId, input) => {
        set((state) => {
            const task = state.executionTasks[taskId]
            if (!task) return state

            const rollbackSettings = useStore.getState().taskTrustSettings.governanceDefaults?.rollback
            const proposal = createRollbackProposal({
                executionTarget: task.executionTarget,
                resolvedWorkspacePath: task.resolvedWorkspacePath,
                changedFiles: input.changedFiles,
                externalSideEffects: input.externalSideEffects,
            }, rollbackSettings)
            const rollback = createRollbackStateFromProposal(proposal)

            return {
                executionTasks: {
                    ...state.executionTasks,
                    [taskId]: {
                        ...task,
                        rollback,
                        governanceState: 'rollback-ready',
                        updatedAt: Date.now(),
                    },
                },
            }
        })
    },

    completeExecutionTaskRollback: (taskId) => {
        set((state) => {
            const task = state.executionTasks[taskId]
            if (!task || !task.rollback.proposal) return state

            return {
                executionTasks: {
                    ...state.executionTasks,
                    [taskId]: {
                        ...task,
                        rollback: {
                            ...task.rollback,
                            status: 'rolled-back',
                            lastUpdatedAt: Date.now(),
                        },
                        governanceState: 'rolled-back',
                        updatedAt: Date.now(),
                    },
                },
            }
        })
    },

    openExecutionTaskAdjudication: (taskId, input) => {
        const adjudicationCase = buildAdjudicationCase({
            taskId,
            trigger: input.trigger,
            reason: input.reason,
            changedFiles: input.changedFiles,
            workPackageId: input.workPackageId,
        })

        set((state) => {
            const task = state.executionTasks[taskId]
            if (!task) return state

            return {
                executionTasks: {
                    ...state.executionTasks,
                    [taskId]: {
                        ...task,
                        governanceState: 'awaiting-adjudication',
                        latestAdjudicationId: adjudicationCase.id,
                        updatedAt: Date.now(),
                    },
                },
                adjudicationCases: {
                    ...state.adjudicationCases,
                    [adjudicationCase.id]: adjudicationCase,
                },
            }
        })

        return adjudicationCase.id
    },

    resolveExecutionTaskAdjudication: (caseId, resolution) => {
        set((state) => {
            const currentCase = state.adjudicationCases[caseId]
            if (!currentCase) return state

            const task = state.executionTasks[currentCase.taskId]
            if (!task) return state

            const resolved = applyAdjudicationResolution(currentCase, resolution).caseItem
            let nextTask: ExecutionTask = {
                ...task,
                governanceState: resolution.action === 'rollback' ? 'rollback-ready' : 'active',
                updatedAt: Date.now(),
            }
            let nextWorkPackages = state.workPackages

            if (resolution.action === 'require-verification') {
                nextTask = { ...nextTask, state: 'verifying' }
            }

            if (resolution.action === 'rollback') {
                const rollbackSettings = useStore.getState().taskTrustSettings.governanceDefaults?.rollback
                const proposal = createRollbackProposal({
                    executionTarget: task.executionTarget,
                    resolvedWorkspacePath: task.resolvedWorkspacePath,
                    changedFiles: currentCase.changedFiles,
                }, rollbackSettings)
                nextTask = {
                    ...nextTask,
                    rollback: createRollbackStateFromProposal(proposal),
                }
            }

            if (resolution.action === 'return-for-rework' || resolution.action === 'reassign-specialist') {
                const sourceWorkPackage = currentCase.workPackageId ? state.workPackages[currentCase.workPackageId] : task.workPackages.map((id) => state.workPackages[id]).find(Boolean)
                if (sourceWorkPackage) {
                    const followUpId = createExecutionEntityId('workpkg')
                    const followUpSpecialist = resolution.action === 'reassign-specialist' && resolution.targetSpecialist
                        ? resolution.targetSpecialist
                        : sourceWorkPackage.specialist
                    const followUp: WorkPackage = {
                        ...sourceWorkPackage,
                        id: followUpId,
                        specialist: followUpSpecialist,
                        title: resolution.action === 'return-for-rework'
                            ? `${sourceWorkPackage.title} (rework)`
                            : `${sourceWorkPackage.title} (${followUpSpecialist})`,
                        status: 'queued',
                        heartbeat: createEmptyExecutionHeartbeatSnapshot(),
                        recoveryCheckpoint: createInitialRecoveryCheckpoint(),
                    }
                    nextWorkPackages = {
                        ...state.workPackages,
                        [followUpId]: followUp,
                        [sourceWorkPackage.id]: {
                            ...sourceWorkPackage,
                            status: 'blocked',
                        },
                    }
                    nextTask = {
                        ...nextTask,
                        workPackages: [...task.workPackages, followUpId],
                    }
                }
            }

            return {
                executionTasks: {
                    ...state.executionTasks,
                    [task.id]: nextTask,
                },
                workPackages: nextWorkPackages,
                adjudicationCases: {
                    ...state.adjudicationCases,
                    [caseId]: resolved,
                },
            }
        })
    },

    updateWorkPackage: (workPackageId, updates) => {
        set((state) => {
            const current = state.workPackages[workPackageId]
            if (!current) return state

            const task = state.executionTasks[current.taskId]
            return {
                workPackages: {
                    ...state.workPackages,
                    [workPackageId]: {
                        ...current,
                        ...updates,
                    },
                },
                executionTasks: task ? {
                    ...state.executionTasks,
                    [task.id]: {
                        ...task,
                        updatedAt: Date.now(),
                    },
                } : state.executionTasks,
            }
        })
    },

    setWorkPackageStatus: (workPackageId, status) => {
        get().updateWorkPackage(workPackageId, { status })
    },

    createTaskHandoff: (input) => {
        const state = get()
        const task = state.executionTasks[input.taskId]
        const workPackage = state.workPackages[input.workPackageId]

        if (!task || !workPackage) {
            throw new Error('Cannot create task handoff for missing task or work package')
        }

        const handoffId = createExecutionEntityId('handoff')
        const createdAt = Date.now()
        const handoff: TaskHandoff = {
            id: handoffId,
            taskId: input.taskId,
            workPackageId: input.workPackageId,
            summary: input.summary,
            changedFiles: [...(input.changedFiles || [])],
            unresolvedItems: [...(input.unresolvedItems || [])],
            suggestedNextSpecialist: input.suggestedNextSpecialist,
            createdAt,
        }

        set((current) => ({
            taskHandoffs: {
                ...current.taskHandoffs,
                [handoffId]: handoff,
            },
            workPackages: {
                ...current.workPackages,
                [input.workPackageId]: {
                    ...workPackage,
                    status: 'handoff',
                    handoffId,
                },
            },
            executionTasks: {
                ...current.executionTasks,
                [input.taskId]: {
                    ...task,
                    state: 'verifying',
                    latestHandoffId: handoffId,
                    updatedAt: createdAt,
                },
            },
            selectedTaskHandoffId: handoffId,
        }))

        return handoffId
    },

    selectTaskHandoff: (handoffId) => {
        set({ selectedTaskHandoffId: handoffId })
    },

    createOwnershipLease: (input) => {
        const state = get()
        const task = state.executionTasks[input.taskId]
        if (!task) {
            throw new Error('Cannot create ownership lease for missing task')
        }

        const leaseId = createExecutionEntityId('lease')
        const leasedAt = Date.now()
        const lease: OwnershipLease = {
            id: leaseId,
            taskId: input.taskId,
            workPackageId: input.workPackageId,
            specialist: input.specialist,
            scope: input.scope,
            status: 'active',
            queuedWorkPackageIds: [],
            leasedAt,
            releasedAt: null,
        }

        set((current) => {
            const workPackage = current.workPackages[input.workPackageId]
            const ownershipLeases = {
                ...current.ownershipLeases,
                [leaseId]: lease,
            }

            return {
                ownershipLeases,
                workPackages: workPackage ? {
                    ...current.workPackages,
                    [input.workPackageId]: {
                        ...workPackage,
                        status: 'leasing',
                        queueReason: null,
                    },
                } : current.workPackages,
                executionTasks: {
                    ...current.executionTasks,
                    [input.taskId]: syncTaskDerivedOrchestrationState(
                        task,
                        ownershipLeases,
                        current.executionQueueItems,
                        current.changeProposals,
                    ),
                },
            }
        })

        return leaseId
    },

    updateOwnershipLease: (leaseId, updates) => {
        set((state) => {
            const currentLease = state.ownershipLeases[leaseId]
            if (!currentLease) return state

            const task = state.executionTasks[currentLease.taskId]
            if (!task) return state

            const ownershipLeases = {
                ...state.ownershipLeases,
                [leaseId]: {
                    ...currentLease,
                    ...updates,
                },
            }

            return {
                ownershipLeases,
                executionTasks: {
                    ...state.executionTasks,
                    [task.id]: syncTaskDerivedOrchestrationState(
                        task,
                        ownershipLeases,
                        state.executionQueueItems,
                        state.changeProposals,
                    ),
                },
            }
        })
    },

    releaseOwnershipLease: (leaseId) => {
        set((state) => {
            const currentLease = state.ownershipLeases[leaseId]
            if (!currentLease) return state

            const task = state.executionTasks[currentLease.taskId]
            if (!task) return state

            const releasedLease: OwnershipLease = {
                ...currentLease,
                status: 'released',
                releasedAt: Date.now(),
            }
            const ownershipLeases: Record<string, OwnershipLease> = {
                ...state.ownershipLeases,
                [leaseId]: releasedLease,
            }

            return {
                ownershipLeases,
                executionTasks: {
                    ...state.executionTasks,
                    [task.id]: syncTaskDerivedOrchestrationState(
                        task,
                        ownershipLeases,
                        state.executionQueueItems,
                        state.changeProposals,
                    ),
                },
            }
        })
    },

    createExecutionQueueItem: (input) => {
        const state = get()
        const task = state.executionTasks[input.taskId]
        if (!task) {
            throw new Error('Cannot create execution queue item for missing task')
        }

        const queueItemId = createExecutionEntityId('queue')
        const queueItem: ExecutionQueueItem = {
            id: queueItemId,
            taskId: input.taskId,
            workPackageId: input.workPackageId,
            blockedScopes: [...input.blockedScopes],
            blockedByWorkPackageId: input.blockedByWorkPackageId ?? null,
            status: 'queued',
            queuedAt: Date.now(),
            resolvedAt: null,
        }

        set((current) => {
            const workPackage = current.workPackages[input.workPackageId]
            const executionQueueItems = {
                ...current.executionQueueItems,
                [queueItemId]: queueItem,
            }
            const queueReason = input.blockedByWorkPackageId
                ? `Waiting for ${input.blockedByWorkPackageId}`
                : input.blockedScopes.join(', ') || null

            return {
                executionQueueItems,
                workPackages: workPackage ? {
                    ...current.workPackages,
                    [input.workPackageId]: {
                        ...workPackage,
                        status: 'queued',
                        queueReason,
                    },
                } : current.workPackages,
                executionTasks: {
                    ...current.executionTasks,
                    [input.taskId]: syncTaskDerivedOrchestrationState(
                        task,
                        current.ownershipLeases,
                        executionQueueItems,
                        current.changeProposals,
                    ),
                },
            }
        })

        return queueItemId
    },

    updateExecutionQueueItem: (queueItemId, updates) => {
        set((state) => {
            const currentItem = state.executionQueueItems[queueItemId]
            if (!currentItem) return state

            const task = state.executionTasks[currentItem.taskId]
            if (!task) return state

            const nextItem: ExecutionQueueItem = {
                ...currentItem,
                ...updates,
                resolvedAt: updates.status && updates.status !== 'queued'
                    ? updates.resolvedAt ?? Date.now()
                    : currentItem.resolvedAt,
            }
            const executionQueueItems = {
                ...state.executionQueueItems,
                [queueItemId]: nextItem,
            }
            const workPackage = state.workPackages[currentItem.workPackageId]

            return {
                executionQueueItems,
                workPackages: workPackage && nextItem.status !== 'queued' ? {
                    ...state.workPackages,
                    [currentItem.workPackageId]: {
                        ...workPackage,
                        queueReason: null,
                    },
                } : state.workPackages,
                executionTasks: {
                    ...state.executionTasks,
                    [task.id]: syncTaskDerivedOrchestrationState(
                        task,
                        state.ownershipLeases,
                        executionQueueItems,
                        state.changeProposals,
                    ),
                },
            }
        })
    },

    createChangeProposal: (input) => {
        const state = get()
        const task = state.executionTasks[input.taskId]
        if (!task) {
            throw new Error('Cannot create change proposal for missing task')
        }

        const proposalId = createExecutionEntityId('proposal')
        const createdAt = Date.now()
        const proposal: ChangeProposal = {
            id: proposalId,
            taskId: input.taskId,
            workPackageId: input.workPackageId,
            summary: input.summary,
            changedFiles: [...(input.changedFiles || [])],
            verificationStatus: input.verificationStatus ?? 'pending',
            verificationMode: input.verificationMode ?? null,
            verificationSummary: input.verificationSummary ?? null,
            verificationBlockedReason: input.verificationBlockedReason ?? null,
            verificationProvider: input.verificationProvider ?? null,
            riskLevel: input.riskLevel ?? 'medium',
            recommendedAction: input.recommendedAction ?? 'apply',
            status: 'pending',
            createdAt,
            resolvedAt: null,
        }

        set((current) => {
            const workPackage = current.workPackages[input.workPackageId]
            const changeProposals = {
                ...current.changeProposals,
                [proposalId]: proposal,
            }

            return {
                changeProposals,
                workPackages: workPackage ? {
                    ...current.workPackages,
                    [input.workPackageId]: {
                        ...workPackage,
                        status: 'proposal-ready',
                        proposalId,
                    },
                } : current.workPackages,
                executionTasks: {
                    ...current.executionTasks,
                    [input.taskId]: syncTaskDerivedOrchestrationState(
                        task,
                        current.ownershipLeases,
                        current.executionQueueItems,
                        changeProposals,
                    ),
                },
                selectedChangeProposalId: proposalId,
            }
        })

        return proposalId
    },

    updateChangeProposal: (proposalId, updates) => {
        set((state) => {
            const currentProposal = state.changeProposals[proposalId]
            if (!currentProposal) return state

            const task = state.executionTasks[currentProposal.taskId]
            if (!task) return state

            const nextProposal: ChangeProposal = {
                ...currentProposal,
                ...updates,
                resolvedAt: updates.status && updates.status !== 'pending'
                    ? updates.resolvedAt ?? Date.now()
                    : currentProposal.resolvedAt,
            }
            const changeProposals = {
                ...state.changeProposals,
                [proposalId]: nextProposal,
            }
            const workPackage = state.workPackages[currentProposal.workPackageId]
            const nextWorkPackageStatus = nextProposal.status === 'applied'
                ? 'applied'
                : nextProposal.status === 'reassigned'
                    ? 'reassigned'
                    : nextProposal.status === 'discarded'
                        ? 'failed'
                        : workPackage?.status

            return {
                changeProposals,
                workPackages: workPackage && nextWorkPackageStatus ? {
                    ...state.workPackages,
                    [currentProposal.workPackageId]: {
                        ...workPackage,
                        status: nextWorkPackageStatus,
                    },
                } : state.workPackages,
                executionTasks: {
                    ...state.executionTasks,
                    [task.id]: syncTaskDerivedOrchestrationState(
                        task,
                        state.ownershipLeases,
                        state.executionQueueItems,
                        changeProposals,
                    ),
                },
            }
        })
    },

    selectChangeProposal: (proposalId) => {
        set({ selectedChangeProposalId: proposalId })
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

    cleanupManualStopState: (planId, taskId) => {
        set((state) => {
            const resolvedPlanId = planId ?? state.activePlanId
            const resolvedTaskId = taskId ?? state.activeExecutionTaskId
            const now = Date.now()

            const plans = resolvedPlanId
                ? state.plans.map((plan) => {
                    if (plan.id !== resolvedPlanId) return plan

                    return {
                        ...plan,
                        status: plan.status === 'executing' ? 'paused' as PlanStatus : plan.status,
                        tasks: plan.tasks.map((task) =>
                            task.status === 'running'
                                ? { ...task, status: 'pending' as TaskStatus, startedAt: undefined }
                                : task,
                        ),
                    }
                })
                : state.plans

            if (!resolvedTaskId) {
                return { plans }
            }

            const currentTask = state.executionTasks[resolvedTaskId]
            if (!currentTask) {
                return { plans }
            }

            const ownershipLeases = Object.fromEntries(
                Object.entries(state.ownershipLeases).map(([leaseId, lease]) => [
                    leaseId,
                    lease.taskId === resolvedTaskId && lease.status !== 'released'
                        ? {
                            ...lease,
                            status: 'released',
                            queuedWorkPackageIds: [],
                            releasedAt: lease.releasedAt ?? now,
                        }
                        : lease,
                ]),
            ) as Record<string, OwnershipLease>

            const executionQueueItems = Object.fromEntries(
                Object.entries(state.executionQueueItems).map(([queueItemId, queueItem]) => [
                    queueItemId,
                    queueItem.taskId === resolvedTaskId && queueItem.status !== 'cancelled'
                        ? {
                            ...queueItem,
                            status: 'cancelled',
                            resolvedAt: queueItem.resolvedAt ?? now,
                        }
                        : queueItem,
                ]),
            ) as Record<string, ExecutionQueueItem>

            const workPackages = { ...state.workPackages }
            for (const workPackageId of currentTask.workPackages) {
                const workPackage = workPackages[workPackageId]
                if (!workPackage) continue

                if (!STOP_RESETTABLE_WORK_PACKAGE_STATUSES.has(workPackage.status)) {
                    continue
                }

                workPackages[workPackageId] = {
                    ...workPackage,
                    status: 'queued',
                    queueReason: null,
                    workspaceId: null,
                    workspaceOwnerId: null,
                    threadId: null,
                }
            }

            const executionTask = syncTaskDerivedOrchestrationState(
                currentTask,
                ownershipLeases,
                executionQueueItems,
                state.changeProposals,
                {
                    state: resolveExecutionTaskStateAfterManualStop(currentTask, workPackages, state.changeProposals),
                    updatedAt: now,
                },
            )

            return {
                plans,
                ownershipLeases,
                executionQueueItems,
                workPackages,
                executionTasks: {
                    ...state.executionTasks,
                    [resolvedTaskId]: executionTask,
                },
            }
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

    getTaskWorkPackages: (taskId) => {
        const state = get()
        const task = state.executionTasks[taskId]
        if (!task) return []

        return task.workPackages
            .map((id) => state.workPackages[id])
            .filter((pkg): pkg is WorkPackage => Boolean(pkg))
    },

    getTaskHandoffs: (taskId) => {
        const state = get()
        return Object.values(state.taskHandoffs)
            .filter((handoff) => handoff.taskId === taskId)
            .sort((a, b) => b.createdAt - a.createdAt)
    },
})
