/**
 * Orchestrator 执行引擎
 * 
 * 职责：
 * - 启动/停止计划执行
 * - 为每个任务创建执行上下文
 * - 调用现有 Agent 系统执行任务
 * - 更新任务状态到 Store
 * 
 * 设计原则：
 * - 复用 buildAgentSystemPrompt() 构建提示词
 * - 复用 Agent.send() 执行任务
 * - task.role 映射到 promptTemplateId
 * - task.provider + task.model 直接使用
 */

import { useAgentStore } from '../store/AgentStore'
import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { logger } from '@utils/Logger'
import { EventBus } from '../core/EventBus'
import { Agent } from '../core/Agent'
import { gitService } from './gitService'
import { ExecutionScheduler } from '../orchestrator/ExecutionScheduler'
import { getLLMConfigForTask } from './llmConfigService'
import type { TaskPlan, OrchestratorTask, ExecutionStats } from '../orchestrator/types'
import type { ExecutionTask, ProposalVerificationStatus, SpecialistKind, SpecialistProfile, TaskRiskLevel, WorkPackage } from '../types/taskExecution'
import { shouldTripCircuitBreaker } from './circuitBreakerService'
import { buildExecutionTaskInputFromPlan } from './taskTemplateService'
import { cleanupTaskExecutionWorkspace, prepareTaskExecutionWorkspace } from './executionWorkspaceService'
import { buildWorkPackageHandoff } from './handoffBrokerService'
import { createOwnershipRegistrySnapshot, acquireOwnership, releaseOwnership } from './ownershipRegistryService'
import { buildChangeProposal } from './proposalEngineService'

// ============================================
// 模块状态
// ============================================

let scheduler: ExecutionScheduler | null = null
let executionStartedAt = 0
let isRunning = false

interface TaskExecutionMetrics {
    llmCalls: number
    estimatedTokens: number
    verifications: number
}

interface TaskGovernanceAttemptInput extends TaskExecutionMetrics {
    taskId: string
    durationMs: number
    commands?: number
    changedFiles?: string[]
    failureReason?: string
    adjudicationTrigger?: 'unsafe-merge' | 'verification-failed' | 'rollback-recommended' | 'circuit-breaker'
    adjudicationReason?: string
    externalSideEffects?: string[]
}

/** 等待单次 Agent 执行完成 */
function waitForAgentCompletion(): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
        const store = useAgentStore.getState()
        const threadId = store.currentThreadId

        if (!threadId) {
            resolve({ success: false, output: '', error: 'Failed to create thread' })
            return
        }

        const unsubscribe = EventBus.on('loop:end', (event) => {
            const thread = store.threads[threadId]
            if (!thread) {
                unsubscribe()
                resolve({ success: false, output: '', error: 'Thread not found after loop end' })
                return
            }

            const lastAssistantMsg = thread.messages
                .filter(m => m.role === 'assistant')
                .pop() as import('../types').AssistantMessage

            const output = lastAssistantMsg?.content || 'Task execution completed'
            unsubscribe()

            if (event.reason === 'error' || event.reason === 'aborted') {
                resolve({ success: false, output: '', error: `Execution ended with reason: ${event.reason}` })
            } else {
                resolve({ success: true, output })
            }
        })
    })
}

// ============================================
// Merge Gate Helpers
// ============================================

async function collectChangedFiles(workspacePath: string): Promise<string[]> {
    const status = await gitService.getStatus(workspacePath)
    if (!status) return []

    return Array.from(new Set([
        ...status.staged.map((file) => file.path),
        ...status.unstaged.map((file) => file.path),
        ...status.untracked,
    ]))
}

function getWritableScopesForActiveExecutionTask(): string[] {
    const store = useAgentStore.getState()
    if (!store.activeExecutionTaskId) return []

    return Array.from(new Set(
        store.getTaskWorkPackages(store.activeExecutionTaskId)
            .flatMap((pkg) => pkg.writableScopes)
            .filter(Boolean)
    ))
}

function createCoordinatorHandoffIfNeeded(summary: string, changedFiles: string[]): void {
    const store = useAgentStore.getState()
    const taskId = store.activeExecutionTaskId
    if (!taskId) return

    const nextPackage = store.getTaskWorkPackages(taskId).find((pkg) => pkg.status !== 'handoff' && pkg.status !== 'verified')
    if (!nextPackage) return

    store.createTaskHandoff({
        taskId,
        workPackageId: nextPackage.id,
        summary,
        changedFiles,
    })
}

function applyTaskGovernanceForAttempt(input: TaskGovernanceAttemptInput) {
    const store = useAgentStore.getState()
    const task = store.executionTasks[input.taskId]
    if (!task) return null

    store.recordExecutionTaskBudgetUsage(input.taskId, {
        timeMs: input.durationMs,
        llmCalls: input.llmCalls,
        estimatedTokens: input.estimatedTokens,
        commands: input.commands ?? 1,
        verifications: input.verifications,
    })

    if (input.adjudicationTrigger && input.adjudicationReason) {
        store.openExecutionTaskAdjudication(input.taskId, {
            trigger: input.adjudicationTrigger,
            reason: input.adjudicationReason,
            changedFiles: input.changedFiles,
        })
    }

    if (input.failureReason) {
        store.proposeExecutionTaskRollback(input.taskId, {
            changedFiles: input.changedFiles,
            externalSideEffects: input.externalSideEffects,
        })
    }

    return useAgentStore.getState().executionTasks[input.taskId] || null
}

function resolveExecutionAttemptProfile(executionTask: ExecutionTask | null | undefined, roleSignal: string): SpecialistProfile | null {
    if (!executionTask) return null

    const normalizedSignal = roleSignal.toLowerCase()
    const candidates: SpecialistKind[] = []

    if (/review/.test(normalizedSignal)) candidates.push('reviewer')
    if (/verify|test|qa/.test(normalizedSignal)) candidates.push('verifier')
    if (/front|ui|ux|component|layout|visual/.test(normalizedSignal)) candidates.push('frontend')
    if (/logic|state|data|api|backend/.test(normalizedSignal)) candidates.push('logic')

    if (/coder|developer|engineer|default/.test(normalizedSignal)) {
        candidates.push(...executionTask.specialists.filter((specialist) => specialist !== 'reviewer' && specialist !== 'verifier'))
    }

    candidates.push(...executionTask.specialists)

    for (const specialist of candidates) {
        const profile = executionTask.specialistProfilesSnapshot[specialist]
        if (profile) {
            return profile
        }
    }

    return null
}

function buildExecutionAttemptGuidance(profile: SpecialistProfile | null | undefined): string {
    if (!profile) return ''

    const lines = ['### Specialist Profile']

    if (profile.model) {
        lines.push(`- Preferred model: ${profile.model}`)
    }

    lines.push(`- Tool permission: ${profile.toolPermission}`)
    lines.push(`- Network permission: ${profile.networkPermission}`)
    lines.push(`- Git permission: ${profile.gitPermission}`)
    lines.push(`- Validation role: ${profile.validationRole}`)
    lines.push(`- Trust mode: ${profile.trustMode}`)

    if (profile.writableScopes.length > 0) {
        lines.push(`- Writable scopes: ${profile.writableScopes.join(', ')}`)
    }

    if (profile.styleHints) {
        lines.push(`- Style hints: ${profile.styleHints}`)
    }

    return lines.join('\n')
}

interface PrepareWorkPackageExecutionInput {
    taskId: string
    workPackageId: string
    fallbackWorkspacePath: string
}

interface PrepareWorkPackageExecutionResult {
    ready: boolean
    workspacePath: string | null
    leaseIds: string[]
    queueItemId: string | null
    error?: string
}

interface CompleteWorkPackageExecutionInput {
    taskId: string
    workPackageId: string
    summary: string
    changedFiles?: string[]
    unresolvedItems?: string[]
    suggestedNextSpecialist?: SpecialistKind
    verificationStatus?: ProposalVerificationStatus
    riskLevel?: TaskRiskLevel
}

interface CompleteWorkPackageExecutionResult {
    handoffId: string
    proposalId: string
    activatedQueueItemIds: string[]
}

function getTaskWorkPackageOrThrow(taskId: string, workPackageId: string): { executionTask: ExecutionTask; workPackage: WorkPackage } {
    const store = useAgentStore.getState()
    const executionTask = store.executionTasks[taskId]
    const workPackage = store.workPackages[workPackageId]

    if (!executionTask || !workPackage) {
        throw new Error(`Execution task or work package not found: ${taskId}/${workPackageId}`)
    }

    return { executionTask, workPackage }
}

async function prepareWorkPackageExecution(input: PrepareWorkPackageExecutionInput): Promise<PrepareWorkPackageExecutionResult> {
    const store = useAgentStore.getState()
    const { executionTask, workPackage } = getTaskWorkPackageOrThrow(input.taskId, input.workPackageId)
    const snapshot = createOwnershipRegistrySnapshot({
        leases: store.ownershipLeases,
        queueItems: store.executionQueueItems,
    })
    const ownership = acquireOwnership(snapshot, {
        taskId: input.taskId,
        workPackageId: input.workPackageId,
        specialist: workPackage.specialist,
        scopes: workPackage.writableScopes,
    })

    if (ownership.status === 'queued') {
        const existingQueueItem = Object.values(store.executionQueueItems)
            .find((item) => item.workPackageId === input.workPackageId && item.status === 'queued')
        const queueItemId = existingQueueItem?.id ?? store.createExecutionQueueItem({
            taskId: input.taskId,
            workPackageId: input.workPackageId,
            blockedScopes: ownership.blockedScopes,
            blockedByWorkPackageId: ownership.blockedByWorkPackageId,
        })

        return {
            ready: false,
            workspacePath: null,
            leaseIds: [],
            queueItemId,
        }
    }

    const leaseIds = workPackage.writableScopes.map((scope) =>
        store.createOwnershipLease({
            taskId: input.taskId,
            workPackageId: input.workPackageId,
            specialist: workPackage.specialist,
            scope,
        }),
    )

    const preparedWorkspace = await prepareTaskExecutionWorkspace(executionTask.id, input.fallbackWorkspacePath)
    if (!preparedWorkspace.success) {
        leaseIds.forEach((leaseId) => store.releaseOwnershipLease(leaseId))
        store.updateWorkPackage(input.workPackageId, {
            status: 'failed',
            workspaceId: null,
        })

        return {
            ready: false,
            workspacePath: null,
            leaseIds,
            queueItemId: null,
            error: preparedWorkspace.error || 'Failed to prepare workspace',
        }
    }

    store.updateWorkPackage(input.workPackageId, {
        status: 'executing',
        workspaceId: preparedWorkspace.workspacePath,
        queueReason: null,
    })

    return {
        ready: true,
        workspacePath: preparedWorkspace.workspacePath,
        leaseIds,
        queueItemId: null,
    }
}

async function completeWorkPackageExecution(input: CompleteWorkPackageExecutionInput): Promise<CompleteWorkPackageExecutionResult> {
    const store = useAgentStore.getState()
    const { executionTask, workPackage } = getTaskWorkPackageOrThrow(input.taskId, input.workPackageId)
    const handoff = buildWorkPackageHandoff({
        taskId: input.taskId,
        workPackageId: input.workPackageId,
        summary: input.summary,
        changedFiles: input.changedFiles,
        unresolvedItems: input.unresolvedItems,
        suggestedNextSpecialist: input.suggestedNextSpecialist,
    })
    const handoffId = store.createTaskHandoff({
        taskId: handoff.taskId,
        workPackageId: handoff.workPackageId,
        summary: handoff.summary,
        changedFiles: handoff.changedFiles,
        unresolvedItems: handoff.unresolvedItems,
        suggestedNextSpecialist: handoff.suggestedNextSpecialist,
    })

    const proposal = buildChangeProposal({
        taskId: input.taskId,
        workPackageId: input.workPackageId,
        summary: input.summary,
        changedFiles: input.changedFiles,
        writableScopes: workPackage.writableScopes,
        verificationStatus: input.verificationStatus ?? 'passed',
        riskLevel: input.riskLevel ?? executionTask.risk,
    })
    const proposalId = store.createChangeProposal({
        taskId: proposal.proposal.taskId,
        workPackageId: proposal.proposal.workPackageId,
        summary: proposal.proposal.summary,
        changedFiles: proposal.proposal.changedFiles,
        verificationStatus: proposal.proposal.verificationStatus,
        riskLevel: proposal.proposal.riskLevel,
        recommendedAction: proposal.proposal.recommendedAction,
    })

    const releaseResult = releaseOwnership(createOwnershipRegistrySnapshot({
        leases: useAgentStore.getState().ownershipLeases,
        queueItems: useAgentStore.getState().executionQueueItems,
    }), {
        workPackageId: input.workPackageId,
    })

    releaseResult.releasedLeaseIds.forEach((leaseId) => store.releaseOwnershipLease(leaseId))
    releaseResult.activatedQueueItemIds.forEach((queueItemId) => {
        store.updateExecutionQueueItem(queueItemId, { status: 'ready' })
    })

    return {
        handoffId,
        proposalId,
        activatedQueueItemIds: releaseResult.activatedQueueItemIds,
    }
}

export const __testing = {
    applyTaskGovernanceForAttempt,
    resolveExecutionAttemptProfile,
    buildExecutionAttemptGuidance,
    prepareWorkPackageExecution,
    completeWorkPackageExecution,
}

function ensureExecutionTaskForPlan(plan: TaskPlan): string {
    const store = useAgentStore.getState()
    const taskTrustSettings = useStore.getState().taskTrustSettings
    const existingTask = Object.values(store.executionTasks).find((task) => task.sourcePlanId === plan.id)

    if (existingTask) {
        store.selectExecutionTask(existingTask.id)
        return existingTask.id
    }

    const executionTaskId = store.createExecutionTask(
        buildExecutionTaskInputFromPlan(plan, {
            mode: taskTrustSettings.global?.mode ?? 'balanced',
            defaultExecutionTarget: taskTrustSettings.global?.defaultExecutionTarget ?? 'auto',
        })
    )
    store.selectExecutionTask(executionTaskId)
    return executionTaskId
}

function syncCircuitBreakerState(input: { retryCount: number; repeatedCommands: number; repeatedFiles: number; progressDelta: number }): { trip: boolean; reason?: string } {
    const store = useAgentStore.getState()
    const activeExecutionTaskId = store.activeExecutionTaskId
    const result = shouldTripCircuitBreaker(input)

    if (!activeExecutionTaskId) {
        return result.trip ? { trip: true, reason: result.reason } : { trip: false }
    }

    store.setExecutionTaskCircuitBreaker(activeExecutionTaskId, {
        tripped: result.trip,
        reason: result.trip ? result.reason : undefined,
        metrics: input,
        updatedAt: Date.now(),
    })

    if (result.trip) {
        store.setExecutionTaskState(activeExecutionTaskId, 'tripped')
        return { trip: true, reason: result.reason }
    }

    return { trip: false }
}

// ============================================
// 公共 API
// ============================================

/**
 * 开始执行计划
 */
export async function startPlanExecution(
    planId?: string
): Promise<{ success: boolean; message: string }> {
    const store = useAgentStore.getState()

    // 获取计划
    const plan = planId
        ? store.plans.find(p => p.id === planId)
        : store.getActivePlan()

    if (!plan) {
        return { success: false, message: 'No active plan found' }
    }

    if (plan.tasks.length === 0) {
        return { success: false, message: 'Plan has no tasks' }
    }

    // 使用 gitService 获取工作区路径
    const workspacePath = gitService.getWorkspace()
    if (!workspacePath) {
        return { success: false, message: 'No workspace open' }
    }

    // 加载需求文档内容
    try {
        const requirementsPath = `${workspacePath}/.adnify/plan/${plan.requirementsDoc}`
        const requirementsContent = await api.file.read(requirementsPath)
        plan.requirementsContent = requirementsContent || undefined
    } catch (e) {
        logger.agent.warn('[OrchestratorExecutor] Failed to load requirements document:', e)
    }

    const executionTaskId = ensureExecutionTaskForPlan(plan)
    const preparedWorkspace = await prepareTaskExecutionWorkspace(executionTaskId, workspacePath)
    if (!preparedWorkspace.success) {
        return { success: false, message: preparedWorkspace.error || 'Failed to prepare execution workspace' }
    }

    // 初始化调度器
    scheduler = new ExecutionScheduler()
    scheduler.start()
    executionStartedAt = Date.now()
    isRunning = true

    // 更新 Store 状态
    store.startExecution(plan.id)

    logger.agent.info(`[OrchestratorExecutor] Started execution of plan: ${plan.name}`)

    // 发布事件
    EventBus.emit({ type: 'plan:start', planId: plan.id } as any)

    // 异步执行（不阻塞返回）
    runExecutionLoop(plan, preparedWorkspace.workspacePath).catch(async error => {
        logger.agent.error('[OrchestratorExecutor] Execution loop failed:', error)
        await handleExecutionError(plan, error)
    })

    return {
        success: true,
        message: `Started executing plan "${plan.name}" with ${plan.tasks.length} tasks.`
    }
}

/**
 * 停止执行
 */
export async function stopPlanExecution(): Promise<void> {
    isRunning = false
    scheduler?.stop()
    scheduler = null

    // 中止当前正在运行的 Agent
    Agent.abort()

    const store = useAgentStore.getState()
    const executionTaskId = store.activeExecutionTaskId
    store.stopExecution()

    if (executionTaskId) {
        await cleanupTaskExecutionWorkspace(executionTaskId)
    }

    logger.agent.info('[OrchestratorExecutor] Execution stopped')
}

/**
 * 暂停执行
 */
export function pausePlanExecution(): void {
    isRunning = false
    scheduler?.pause()

    const store = useAgentStore.getState()
    store.pauseExecution()

    const plan = store.getActivePlan()
    if (plan) {
        EventBus.emit({ type: 'plan:paused', planId: plan.id } as any)
    }

    logger.agent.info('[OrchestratorExecutor] Execution paused')
}

/**
 * 恢复执行
 */
export async function resumePlanExecution(): Promise<void> {
    const store = useAgentStore.getState()
    const plan = store.getActivePlan()
    const workspacePath = gitService.getWorkspace()

    if (!plan || !workspacePath) return

    const executionTaskId = store.activeExecutionTaskId ?? ensureExecutionTaskForPlan(plan)
    const preparedWorkspace = await prepareTaskExecutionWorkspace(executionTaskId, workspacePath)
    if (!preparedWorkspace.success) {
        await handleExecutionError(plan, new Error(preparedWorkspace.error || 'Failed to prepare execution workspace'))
        return
    }

    isRunning = true
    scheduler?.resume()
    store.resumeExecution()

    EventBus.emit({ type: 'plan:resumed', planId: plan.id } as any)

    // 继续执行循环
    runExecutionLoop(plan, preparedWorkspace.workspacePath).catch(async error => {
        logger.agent.error('[OrchestratorExecutor] Resume failed:', error)
        await handleExecutionError(plan, error)
    })
}

/**
 * 获取当前执行状态
 */
export function getExecutionStatus(): {
    isRunning: boolean
    stats: ExecutionStats | null
} {
    const store = useAgentStore.getState()
    const plan = store.getActivePlan()

    if (!plan || !scheduler) {
        return { isRunning: false, stats: null }
    }

    return {
        isRunning,
        stats: scheduler.calculateStats(plan, executionStartedAt)
    }
}

/**
 * 获取当前阶段
 */
export function getCurrentPhase(): 'planning' | 'executing' {
    return useAgentStore.getState().phase
}

// ============================================
// 执行循环
// ============================================

/**
 * 主执行循环
 */
async function runExecutionLoop(plan: TaskPlan, workspacePath: string): Promise<void> {
    const store = useAgentStore.getState()

    while (isRunning && scheduler && !scheduler.isAborted) {
        // 获取下一个可执行任务
        const task = plan.executionMode === 'sequential'
            ? scheduler.getNextTask(plan)
            : null // 并行模式稍后处理

        if (!task) {
            // 检查是否完成
            if (scheduler.isComplete(plan)) {
                await completeExecution(plan)
            } else if (!scheduler.hasRunningTasks()) {
                await completeExecution(plan)
            }
            break
        }

        // 执行任务
        await executeTask(task, plan, workspacePath)

        // 重新获取最新的 plan 状态
        const freshPlan = store.getPlan(plan.id)
        if (freshPlan) {
            for (const freshTask of freshPlan.tasks) {
                const idx = plan.tasks.findIndex(t => t.id === freshTask.id)
                if (idx >= 0) {
                    plan.tasks[idx] = freshTask
                }
            }
        }
    }
}

/**
 * 执行单个任务
 */
async function executeTask(
    task: OrchestratorTask,
    plan: TaskPlan,
    workspacePath: string
): Promise<void> {
    if (!scheduler) return

    const store = useAgentStore.getState()
    const executionTaskId = store.activeExecutionTaskId
    const activeWorkPackage = executionTaskId
        ? store.getTaskWorkPackages(executionTaskId).find((workPackage) =>
            workPackage.status === 'queued' || workPackage.status === 'executing' || workPackage.status === 'leasing',
        ) || null
        : null
    const preparedWorkPackage = executionTaskId && activeWorkPackage
        ? await prepareWorkPackageExecution({
            taskId: executionTaskId,
            workPackageId: activeWorkPackage.id,
            fallbackWorkspacePath: workspacePath,
        })
        : null
    const effectiveWorkspacePath = preparedWorkPackage?.ready && preparedWorkPackage.workspacePath
        ? preparedWorkPackage.workspacePath
        : workspacePath

    // 标记任务开始
    scheduler.markTaskRunning(task)
    store.setCurrentTask(task.id)
    store.updateTask(plan.id, task.id, { status: 'running', startedAt: Date.now() })

    EventBus.emit({ type: 'task:start', taskId: task.id, planId: plan.id } as any)

    logger.agent.info(`[OrchestratorExecutor] Executing task: ${task.title}`)

    try {
        // 执行任务
        const result = await runTaskWithAgent(task, plan, effectiveWorkspacePath)

        if (result.success) {
            const changedFiles = await collectChangedFiles(workspacePath)
            const executionTaskId = store.activeExecutionTaskId
            const durationMs = Date.now() - (task.startedAt || Date.now())
            const mergeGateResult = scheduler.validateTaskMerge({
                writableScopes: getWritableScopesForActiveExecutionTask(),
                changedFiles,
            })

            if (!mergeGateResult.ok) {
                if (executionTaskId) {
                    applyTaskGovernanceForAttempt({
                        taskId: executionTaskId,
                        durationMs,
                        changedFiles,
                        adjudicationTrigger: 'unsafe-merge',
                        adjudicationReason: mergeGateResult.reason,
                        llmCalls: result.metrics.llmCalls,
                        estimatedTokens: result.metrics.estimatedTokens,
                        verifications: result.metrics.verifications,
                    })
                }
                scheduler.markTaskFailed(task, mergeGateResult.reason)
                store.markTaskFailed(plan.id, task.id, mergeGateResult.reason)

                EventBus.emit({
                    type: 'task:failed',
                    taskId: task.id,
                    error: mergeGateResult.reason
                } as any)

                logger.agent.warn(`[OrchestratorExecutor] Coordinator blocked merge for task: ${task.title}`, mergeGateResult.reason)
                return
            }

            if (executionTaskId) {
                const nextTask = applyTaskGovernanceForAttempt({
                    taskId: executionTaskId,
                    durationMs,
                    changedFiles,
                    llmCalls: result.metrics.llmCalls,
                    estimatedTokens: result.metrics.estimatedTokens,
                    verifications: result.metrics.verifications,
                })
                if (nextTask?.state === 'tripped') {
                    const budgetReason = nextTask.budget.tripReason || 'Budget trip detected'
                    scheduler.markTaskFailed(task, budgetReason)
                    store.markTaskFailed(plan.id, task.id, budgetReason)
                    EventBus.emit({ type: 'task:failed', taskId: task.id, error: budgetReason } as any)
                    logger.agent.warn(`[OrchestratorExecutor] Budget trip detected for task: ${task.title}`, budgetReason)
                    return
                }
            }

            const breakerState = syncCircuitBreakerState({
                retryCount: task.retryCount || 0,
                repeatedCommands: task.retryCount || 0,
                repeatedFiles: changedFiles.length > 1 ? changedFiles.length : 0,
                progressDelta: result.output.trim() || changedFiles.length > 0 ? 1 : 0,
            })

            if (breakerState.trip) {
                if (executionTaskId) {
                    applyTaskGovernanceForAttempt({
                        taskId: executionTaskId,
                        durationMs,
                        changedFiles,
                        adjudicationTrigger: 'circuit-breaker',
                        adjudicationReason: breakerState.reason || 'Circuit breaker tripped',
                        llmCalls: 0,
                        estimatedTokens: 0,
                        verifications: 0,
                    })
                }
                const breakerReason = breakerState.reason || 'Circuit breaker tripped'
                scheduler.markTaskFailed(task, breakerReason)
                store.markTaskFailed(plan.id, task.id, breakerReason)
                EventBus.emit({ type: 'task:failed', taskId: task.id, error: breakerReason } as any)
                logger.agent.warn(`[OrchestratorExecutor] Circuit breaker tripped for task: ${task.title}`, breakerReason)
                return
            }

            if (executionTaskId && activeWorkPackage) {
                await completeWorkPackageExecution({
                    taskId: executionTaskId,
                    workPackageId: activeWorkPackage.id,
                    summary: result.output,
                    changedFiles,
                    suggestedNextSpecialist: 'verifier',
                    verificationStatus: 'passed',
                })
            } else {
                createCoordinatorHandoffIfNeeded(result.output, changedFiles)
            }

            // 任务成功
            scheduler.markTaskCompleted(task, result.output)
            store.markTaskCompleted(plan.id, task.id, result.output)

            EventBus.emit({
                type: 'task:complete',
                taskId: task.id,
                output: result.output,
                duration: Date.now() - (task.startedAt || Date.now())
            } as any)

            logger.agent.info(`[OrchestratorExecutor] Task completed: ${task.title}`)
        } else {
            const changedFiles = await collectChangedFiles(workspacePath)
            const executionTaskId = store.activeExecutionTaskId
            const durationMs = Date.now() - (task.startedAt || Date.now())
            const nextRetryCount = (task.retryCount || 0) + 1
            store.updateTask(plan.id, task.id, { retryCount: nextRetryCount })

            const breakerState = syncCircuitBreakerState({
                retryCount: nextRetryCount,
                repeatedCommands: nextRetryCount,
                repeatedFiles: changedFiles.length,
                progressDelta: 0,
            })
            const failureReason = breakerState.trip
                ? breakerState.reason || 'Circuit breaker tripped'
                : result.error || 'Unknown error'

            if (executionTaskId) {
                applyTaskGovernanceForAttempt({
                    taskId: executionTaskId,
                    durationMs,
                    changedFiles,
                    failureReason,
                    adjudicationTrigger: breakerState.trip ? 'circuit-breaker' : undefined,
                    adjudicationReason: breakerState.trip ? failureReason : undefined,
                    llmCalls: result.metrics.llmCalls,
                    estimatedTokens: result.metrics.estimatedTokens,
                    verifications: result.metrics.verifications,
                })
            }

            // 任务失败
            scheduler.markTaskFailed(task, failureReason)
            store.markTaskFailed(plan.id, task.id, failureReason)

            EventBus.emit({
                type: 'task:failed',
                taskId: task.id,
                error: failureReason
            } as any)

            logger.agent.error(`[OrchestratorExecutor] Task failed: ${task.title}`, failureReason)
        }
    } catch (error) {
        const executionTaskId = store.activeExecutionTaskId
        const errorMsg = error instanceof Error ? error.message : String(error)
        const nextRetryCount = (task.retryCount || 0) + 1
        store.updateTask(plan.id, task.id, { retryCount: nextRetryCount })
        const breakerState = syncCircuitBreakerState({
            retryCount: nextRetryCount,
            repeatedCommands: nextRetryCount,
            repeatedFiles: 0,
            progressDelta: 0,
        })
        const failureReason = breakerState.trip ? breakerState.reason || errorMsg : errorMsg
        if (executionTaskId) {
            applyTaskGovernanceForAttempt({
                taskId: executionTaskId,
                durationMs: Date.now() - (task.startedAt || Date.now()),
                changedFiles: [],
                failureReason,
                adjudicationTrigger: breakerState.trip ? 'circuit-breaker' : undefined,
                adjudicationReason: breakerState.trip ? failureReason : undefined,
                llmCalls: 0,
                estimatedTokens: 0,
                verifications: 0,
            })
        }
        scheduler.markTaskFailed(task, failureReason)
        store.markTaskFailed(plan.id, task.id, failureReason)

        EventBus.emit({ type: 'task:failed', taskId: task.id, error: failureReason } as any)

        logger.agent.error(`[OrchestratorExecutor] Task execution error: ${task.title}`, error)
    }

    store.setCurrentTask(null)
}

/**
 * 完成执行
 */
async function completeExecution(plan: TaskPlan): Promise<void> {
    if (!scheduler) return

    const stats = scheduler.calculateStats(plan, executionStartedAt)
    const hasFailures = stats.failedTasks > 0

    const store = useAgentStore.getState()
    const executionTaskId = store.activeExecutionTaskId
    store.updatePlan(plan.id, { status: hasFailures ? 'failed' : 'completed' })
    store.stopExecution()

    isRunning = false
    scheduler.stop()
    scheduler = null

    if (executionTaskId) {
        await cleanupTaskExecutionWorkspace(executionTaskId)
    }

    EventBus.emit({ type: 'plan:complete', planId: plan.id, stats } as any)

    logger.agent.info(`[OrchestratorExecutor] Execution complete:`, stats)
}

/**
 * 处理执行错误
 */
async function handleExecutionError(plan: TaskPlan, error: unknown): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error)

    const store = useAgentStore.getState()
    const executionTaskId = store.activeExecutionTaskId
    store.updatePlan(plan.id, { status: 'failed' })
    store.stopExecution()

    isRunning = false
    scheduler?.stop()
    scheduler = null

    if (executionTaskId) {
        await cleanupTaskExecutionWorkspace(executionTaskId)
    }

    EventBus.emit({ type: 'plan:failed', planId: plan.id, error: errorMsg } as any)

    logger.agent.error('[OrchestratorExecutor] Plan execution failed:', errorMsg)
}

// ============================================
// 任务执行核心
// ============================================

/**
 * 使用 Agent 执行任务
 */
async function runTaskWithAgent(
    task: OrchestratorTask,
    plan: TaskPlan,
    workspacePath: string
): Promise<{ success: boolean; output: string; error?: string; metrics: TaskExecutionMetrics }> {

    try {
        const isCoderTask = /coder|developer|engineer/i.test(task.role || '')
        const maxReviewLoops = 3
        let currentLoop = 0
        let currentRole = task.role || 'default'
        let feedbackMessage = buildTaskMessage(task, plan)
        let finalOutput = ''
        const metrics: TaskExecutionMetrics = { llmCalls: 0, estimatedTokens: 0, verifications: 0 }
        const executionTask = useAgentStore.getState().activeExecutionTaskId
            ? useAgentStore.getState().executionTasks[useAgentStore.getState().activeExecutionTaskId!] || null
            : null

        while (currentLoop < maxReviewLoops && isRunning) {
            const attemptProfile = resolveExecutionAttemptProfile(executionTask, currentRole)
            const attemptGuidance = buildExecutionAttemptGuidance(attemptProfile)
            const attemptMessage = attemptGuidance ? `${feedbackMessage}\n\n${attemptGuidance}` : feedbackMessage
            const effectiveModel = attemptProfile?.model?.trim() || task.model
            const llmConfig = await getLLMConfigForTask(task.provider, effectiveModel)
            if (!llmConfig) {
                return { success: false, output: '', error: `Failed to get LLM config for ${task.provider}/${effectiveModel}`, metrics }
            }

            const templateId = mapRoleToTemplateId(currentRole)
            logger.agent.info(`[OrchestratorExecutor] Emitting subtask. Loop: ${currentLoop}, Role: ${currentRole} (Template: ${templateId})`)

            metrics.llmCalls += 1
            metrics.estimatedTokens += Math.max(1, Math.ceil(attemptMessage.length / 4))
            if (currentRole === 'reviewer' || /review|verify/i.test(currentRole)) {
                metrics.verifications += 1
            }

            await Agent.send(attemptMessage, llmConfig, workspacePath, 'agent', {
                promptTemplateId: templateId,
                orchestratorPhase: 'executing',
            })

            const result = await waitForAgentCompletion()

            if (!result.success) {
                return { ...result, metrics }
            }

            finalOutput = result.output

            if (isCoderTask) {
                if (currentRole !== 'reviewer') {
                    // Coder finished -> Switch to Reviewer
                    currentRole = 'reviewer'
                    feedbackMessage = `[System: Reviewer Phase]\nCoder has completed the sequence for task: "${task.title}".\nPlease verify the latest changes. Use reading tools if necessary. If everything is fully correct and meets requirements without regressions, output exactly <LGTM>. Otherwise, point out the exact logical flaws or remaining steps.`
                    currentLoop++
                } else {
                    // Reviewer finished -> Check LGTM
                    if (finalOutput.includes('<LGTM>')) {
                        logger.agent.info('[OrchestratorExecutor] Reviewer approved the changes.')
                        break
                    } else {
                        // Reviewer rejected -> Switch to Coder with feedback
                        currentRole = task.role || 'coder'
                        feedbackMessage = `[System: Coder Phase]\nReviewer found issues or missing steps:\n\n${finalOutput}\n\nPlease address these issues and continue working on the task.`
                        currentLoop++
                    }
                }
            } else {
                // Regular single-shot task
                break
            }
        }

        return { success: true, output: finalOutput, metrics }

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        return { success: false, output: '', error: errorMsg, metrics: { llmCalls: 0, estimatedTokens: 0, verifications: 0 } }
    }
}

/**
 * 构建任务消息
 */
function buildTaskMessage(task: OrchestratorTask, plan: TaskPlan): string {
    const lines: string[] = []

    lines.push('# Task Execution Request')
    lines.push('')
    lines.push(`## Task: ${task.title}`)
    lines.push('')
    lines.push('### Description')
    lines.push(task.description)
    lines.push('')

    // 添加需求文档上下文
    if (plan.requirementsContent) {
        lines.push('### Requirements Context')
        lines.push('')
        // 截断过长的需求文档
        const truncated = plan.requirementsContent.length > 3000
            ? plan.requirementsContent.slice(0, 3000) + '\n\n... (truncated)'
            : plan.requirementsContent
        lines.push(truncated)
        lines.push('')
    }

    // 添加依赖任务的输出
    if (task.dependencies.length > 0) {
        const depOutputs = task.dependencies
            .map(depId => {
                const depTask = plan.tasks.find(t => t.id === depId)
                if (depTask?.output) {
                    return `**${depTask.title}**: ${depTask.output.slice(0, 500)}${depTask.output.length > 500 ? '...' : ''}`
                }
                return null
            })
            .filter(Boolean)

        if (depOutputs.length > 0) {
            lines.push('### Previous Task Outputs')
            lines.push('')
            lines.push(depOutputs.join('\n\n'))
            lines.push('')
        }
    }

    lines.push('### Instructions')
    lines.push('')
    lines.push('1. Execute this task completely')
    lines.push('2. Use all available tools as needed')
    lines.push('3. When finished, provide a clear summary of what you accomplished')
    lines.push('4. Do NOT ask for user confirmation - just execute')
    lines.push('')
    lines.push('### Important')
    lines.push(`- You are part of plan: "${plan.name}"`)
    lines.push('- Focus ONLY on this specific task')
    lines.push('- Be thorough and handle edge cases')

    return lines.join('\n')
}

/**
 * 映射角色名到模板 ID
 */
function mapRoleToTemplateId(role: string): string {
    const r = role.toLowerCase()
    if (r.includes('frontend') || r.includes('backend') || r.includes('developer') || r.includes('coder') || r.includes('engineer')) {
        return 'coder'
    }
    if (r.includes('architect') || r.includes('system design')) {
        return 'architect'
    }
    if (r.includes('ui') || r.includes('ux') || r.includes('designer') || r.includes('visual')) {
        return 'uiux-designer'
    }
    if (r.includes('analyst') || r.includes('research') || r.includes('gather') || r.includes('planning')) {
        return 'analyst'
    }
    if (r.includes('review') || r.includes('audit') || r.includes('careful')) {
        return 'reviewer'
    }
    if (r.includes('concise') || r.includes('efficient') || r.includes('minimal')) {
        return 'concise'
    }
    return role // 如果已经是一个合法的 ID，直接返回
}
