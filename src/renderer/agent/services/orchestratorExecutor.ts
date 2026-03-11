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
import { getLLMConfigForTask, getProviderModelContext } from './llmConfigService'
import type { TaskPlan, OrchestratorTask, ExecutionStats } from '../orchestrator/types'
import type { ExecutionTask, ProposalAction, ProposalVerificationStatus, SpecialistKind, SpecialistProfile, TaskRiskLevel, VerificationMode, WorkPackage } from '../types/taskExecution'
import { createEmptyExecutionHeartbeatSnapshot, createInitialPatrolState } from '../types/taskExecution'
import { shouldEscalatePatrolState, shouldTripCircuitBreaker } from './circuitBreakerService'
import { buildExecutionTaskInputFromPlan } from './taskTemplateService'
import { cleanupTaskExecutionWorkspace, prepareTaskExecutionWorkspace } from './executionWorkspaceService'
import { restoreExecutionTaskFromRecovery, syncTaskRecoveryCheckpoint } from './executionRecoveryService'
import { buildWorkPackageHandoff } from './handoffBrokerService'
import { createOwnershipRegistrySnapshot, acquireOwnership, releaseOwnership } from './ownershipRegistryService'
import { buildChangeProposal } from './proposalEngineService'
import { applyChangeProposal, captureBaselineForScopes } from './proposalApplyService'
import { resolveSpecialistRoute } from './modelRoutingService'
import { buildBrowserVerificationPrompt, getBrowserVerificationCapability } from './browserVerificationService'
import { DEFAULT_PATROL_THRESHOLDS, evaluateExecutionPatrol, type PatrolThresholds } from './patrolService'
import {
    markExecutionHeartbeatStarted,
    recordHeartbeatAssistantOutput,
    recordHeartbeatFileMutation,
    recordHeartbeatToolActivity,
    stopExecutionHeartbeat,
} from './executionHeartbeatService'

// ============================================
// 模块状态
// ============================================

let scheduler: ExecutionScheduler | null = null
let executionStartedAt = 0
let isRunning = false
let activeExecutionRunId = 0
let stopInFlightPromise: Promise<void> | null = null

function beginExecutionRun(): number {
    activeExecutionRunId += 1
    return activeExecutionRunId
}

function invalidateExecutionRun(): void {
    activeExecutionRunId += 1
}

function isExecutionRunCurrent(executionRunId?: number | null): boolean {
    return executionRunId == null || executionRunId === activeExecutionRunId
}

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
function waitForAgentCompletion(threadId: string): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
        if (!threadId) {
            resolve({ success: false, output: '', error: 'Failed to create thread' })
            return
        }

        const unsubscribe = EventBus.on('loop:end', (event) => {
            if (event.threadId && event.threadId !== threadId) {
                return
            }
            const thread = useAgentStore.getState().threads[threadId]
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

    if (profile.provider) {
        lines.push(`- Preferred provider: ${profile.provider}`)
    }
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
    executionRunId?: number
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
    verificationMode?: VerificationMode | null
    verificationSummary?: string | null
    verificationBlockedReason?: string | null
    verificationProvider?: 'playwright' | 'puppeteer' | null
    riskLevel?: TaskRiskLevel
}

interface CompleteWorkPackageExecutionResult {
    handoffId: string
    proposalId: string
    activatedQueueItemIds: string[]
}

interface WorkPackageVerificationResult {
    status: 'passed' | 'failed' | 'blocked'
    verificationStatus: ProposalVerificationStatus
    mode: VerificationMode | null
    summary: string | null
    reason: string | null
    provider: 'playwright' | 'puppeteer' | null
}

function buildDefaultVerificationResult(workPackage: WorkPackage): WorkPackageVerificationResult {
    return {
        status: 'passed',
        verificationStatus: 'passed',
        mode: workPackage.verificationMode ?? null,
        summary: workPackage.verificationMode ? `${workPackage.verificationMode} verification completed.` : null,
        reason: null,
        provider: null,
    }
}

function interpretBrowserVerificationResult(output: string, provider: 'playwright' | 'puppeteer' | null): WorkPackageVerificationResult {
    if (/\bBLOCKED\b/i.test(output)) {
        return {
            status: 'blocked',
            verificationStatus: 'pending',
            mode: 'browser',
            summary: 'Browser verification blocked before completion.',
            reason: output,
            provider,
        }
    }

    if (/\bFAIL(?:ED)?\b/i.test(output)) {
        return {
            status: 'failed',
            verificationStatus: 'failed',
            mode: 'browser',
            summary: 'Browser verification reported a failing interaction.',
            reason: output,
            provider,
        }
    }

    return {
        status: 'passed',
        verificationStatus: 'passed',
        mode: 'browser',
        summary: 'Browser verification completed successfully.',
        reason: null,
        provider,
    }
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

    if (!isExecutionRunCurrent(input.executionRunId)) {
        return {
            ready: false,
            workspacePath: null,
            leaseIds: [],
            queueItemId: null,
            error: 'Execution run superseded',
        }
    }

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
        if (!isExecutionRunCurrent(input.executionRunId)) {
            return {
                ready: false,
                workspacePath: null,
                leaseIds: [],
                queueItemId: null,
                error: 'Execution run superseded',
            }
        }

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

    const releasePreparedResources = async () => {
        leaseIds.forEach((leaseId) => store.releaseOwnershipLease(leaseId))
        await cleanupTaskExecutionWorkspace(input.taskId, input.workPackageId)
    }

    const preparedWorkspace = await prepareTaskExecutionWorkspace(executionTask.id, input.fallbackWorkspacePath, input.workPackageId)
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

    if (!isExecutionRunCurrent(input.executionRunId)) {
        await releasePreparedResources()
        return {
            ready: false,
            workspacePath: null,
            leaseIds,
            queueItemId: null,
            error: 'Execution run superseded',
        }
    }

    const baselineFiles = await captureBaselineForScopes(
        executionTask.sourceWorkspacePath || input.fallbackWorkspacePath,
        workPackage.writableScopes,
    )

    if (!isExecutionRunCurrent(input.executionRunId)) {
        await releasePreparedResources()
        return {
            ready: false,
            workspacePath: null,
            leaseIds,
            queueItemId: null,
            error: 'Execution run superseded',
        }
    }

    const startedAt = Date.now()
    store.updateWorkPackage(input.workPackageId, {
        status: 'executing',
        workspaceId: preparedWorkspace.workspacePath,
        workspaceOwnerId: preparedWorkspace.target === 'isolated' ? input.workPackageId : null,
        baselineFiles,
        queueReason: null,
    })
    markExecutionHeartbeatActive(input.taskId, input.workPackageId, startedAt)
    syncTaskRecoveryCheckpoint(input.taskId, { status: 'recovering', updatedAt: startedAt })

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
        verificationMode: input.verificationMode ?? workPackage.verificationMode ?? null,
        verificationSummary: input.verificationSummary ?? null,
        verificationBlockedReason: input.verificationBlockedReason ?? null,
        verificationProvider: input.verificationProvider ?? null,
        riskLevel: input.riskLevel ?? executionTask.risk,
    })
    const proposalId = store.createChangeProposal({
        taskId: proposal.proposal.taskId,
        workPackageId: proposal.proposal.workPackageId,
        summary: proposal.proposal.summary,
        changedFiles: proposal.proposal.changedFiles,
        verificationStatus: proposal.proposal.verificationStatus,
        verificationMode: proposal.proposal.verificationMode ?? null,
        verificationSummary: proposal.proposal.verificationSummary ?? null,
        verificationBlockedReason: proposal.proposal.verificationBlockedReason ?? null,
        verificationProvider: proposal.proposal.verificationProvider ?? null,
        riskLevel: proposal.proposal.riskLevel,
        recommendedAction: proposal.proposal.recommendedAction,
    })

    syncTaskRecoveryCheckpoint(input.taskId, { status: 'ready' })

    return {
        handoffId,
        proposalId,
        activatedQueueItemIds: [],
    }
}


async function releaseWorkPackageResources(taskId: string, workPackageId: string): Promise<void> {
    const store = useAgentStore.getState()
    const releaseResult = releaseOwnership(createOwnershipRegistrySnapshot({
        leases: store.ownershipLeases,
        queueItems: store.executionQueueItems,
    }), {
        workPackageId,
    })

    releaseResult.releasedLeaseIds.forEach((leaseId) => store.releaseOwnershipLease(leaseId))
    releaseResult.activatedQueueItemIds.forEach((queueItemId) => {
        store.updateExecutionQueueItem(queueItemId, { status: 'ready' })
    })

    await cleanupTaskExecutionWorkspace(taskId, workPackageId)
}

async function failWorkPackageExecution(taskId: string, workPackageId: string): Promise<void> {
    const store = useAgentStore.getState()
    const failedAt = Date.now()
    const workPackage = store.workPackages[workPackageId]
    store.updateWorkPackage(workPackageId, {
        status: 'failed',
        heartbeat: stopExecutionHeartbeat(workPackage?.heartbeat, failedAt),
    })
    await releaseWorkPackageResources(taskId, workPackageId)
    syncTaskRecoveryCheckpoint(taskId, { status: 'ready', updatedAt: failedAt })
}


export async function reviewChangeProposal(proposalId: string, action: ProposalAction): Promise<void> {
    const store = useAgentStore.getState()
    const proposal = store.changeProposals[proposalId]
    if (!proposal) return

    const executionTask = store.executionTasks[proposal.taskId]
    const workPackage = store.workPackages[proposal.workPackageId]
    if (!executionTask || !workPackage) return

    if (action === 'apply') {
        if (proposal.verificationStatus !== 'passed') {
            const applyError = proposal.verificationBlockedReason
                || proposal.verificationSummary
                || (proposal.verificationStatus === 'failed'
                    ? 'Verification failed for the proposed changes.'
                    : 'Proposal verification is incomplete.')
            store.updateChangeProposal(proposalId, { applyError })
            store.openExecutionTaskAdjudication(executionTask.id, {
                trigger: 'verification-failed',
                reason: applyError,
                changedFiles: proposal.changedFiles,
                workPackageId: workPackage.id,
            })
            return
        }

        const taskWorkspacePath = executionTask.sourceWorkspacePath || executionTask.resolvedWorkspacePath
        if (!taskWorkspacePath) {
            store.updateChangeProposal(proposalId, { applyError: 'Missing main workspace path' })
            return
        }

        const applyResult = await applyChangeProposal({
            proposal,
            taskWorkspacePath,
            workPackage,
        })

        if (!applyResult.success) {
            store.updateChangeProposal(proposalId, {
                applyError: applyResult.error || 'Failed to apply proposal',
                conflictFiles: applyResult.conflictFiles,
            })

            if (applyResult.conflictFiles.length > 0) {
                store.openExecutionTaskAdjudication(executionTask.id, {
                    trigger: 'main-workspace-conflict',
                    reason: applyResult.error || 'Main workspace changed during package review',
                    changedFiles: applyResult.conflictFiles,
                    workPackageId: workPackage.id,
                })
            }
            return
        }

        store.updateChangeProposal(proposalId, {
            status: 'applied',
            applyError: null,
            conflictFiles: [],
        })
    } else {
        store.updateChangeProposal(proposalId, {
            status: action === 'return-for-rework'
                ? 'returned-for-rework'
                : action === 'reassign'
                    ? 'reassigned'
                    : 'discarded',
            applyError: null,
            conflictFiles: [],
        })
    }

    await releaseWorkPackageResources(executionTask.id, workPackage.id)
    syncTaskRecoveryCheckpoint(executionTask.id, { status: 'ready' })
}

export const __testing = {
    applyTaskGovernanceForAttempt,
    resolveExecutionAttemptProfile,
    buildExecutionAttemptGuidance,
    prepareWorkPackageExecution,
    completeWorkPackageExecution,
    reviewChangeProposal,
    getRunnableWorkPackageBatch,
    getWorkPackageBatchLimit,
    runWorkPackageWithAgent,
    syncTaskPatrol,
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


const DEFAULT_WORK_PACKAGE_MAX_CONCURRENCY = 2

function getWorkPackageBatchLimit(plan: Pick<TaskPlan, 'executionMode'>): number {
    return plan.executionMode === 'parallel'
        ? DEFAULT_WORK_PACKAGE_MAX_CONCURRENCY
        : 1
}

function getRunnableWorkPackageBatch(taskId: string, maxConcurrency = DEFAULT_WORK_PACKAGE_MAX_CONCURRENCY): WorkPackage[] {
    const store = useAgentStore.getState()
    const executionTask = store.executionTasks[taskId]
    if (!executionTask) return []

    const workPackages = executionTask.workPackages
        .map((workPackageId) => store.workPackages[workPackageId])
        .filter(Boolean)

    const runnable = workPackages.filter((workPackage) => {
        if (workPackage.status !== 'queued') return false
        return workPackage.dependsOn.every((dependencyId) => store.workPackages[dependencyId]?.status === 'applied')
    })

    return runnable.slice(0, maxConcurrency)
}

function getLatestPlanSnapshot(plan: TaskPlan): TaskPlan {
    return useAgentStore.getState().plans.find((candidate) => candidate.id === plan.id) ?? plan
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function markExecutionHeartbeatActive(taskId: string, workPackageId: string, timestamp = Date.now()): void {
    const store = useAgentStore.getState()
    const task = store.executionTasks[taskId]
    const workPackage = store.workPackages[workPackageId]

    if (task) {
        store.updateExecutionTask(taskId, {
            heartbeat: markExecutionHeartbeatStarted(task.heartbeat, timestamp),
        })
    }

    if (workPackage) {
        store.updateWorkPackage(workPackageId, {
            heartbeat: markExecutionHeartbeatStarted(workPackage.heartbeat, timestamp),
        })
    }
}

function recordExecutionHeartbeatToolActivity(taskId: string, workPackageId: string, timestamp = Date.now()): void {
    const store = useAgentStore.getState()
    const task = store.executionTasks[taskId]
    const workPackage = store.workPackages[workPackageId]

    if (task) {
        store.updateExecutionTask(taskId, {
            heartbeat: recordHeartbeatToolActivity(task.heartbeat, timestamp),
        })
    }

    if (workPackage) {
        store.updateWorkPackage(workPackageId, {
            heartbeat: recordHeartbeatToolActivity(workPackage.heartbeat, timestamp),
        })
    }
}

function recordExecutionHeartbeatAssistantOutput(taskId: string, workPackageId: string, timestamp = Date.now()): void {
    const store = useAgentStore.getState()
    const task = store.executionTasks[taskId]
    const workPackage = store.workPackages[workPackageId]

    if (task) {
        store.updateExecutionTask(taskId, {
            heartbeat: recordHeartbeatAssistantOutput(task.heartbeat, timestamp),
        })
    }

    if (workPackage) {
        store.updateWorkPackage(workPackageId, {
            heartbeat: recordHeartbeatAssistantOutput(workPackage.heartbeat, timestamp),
        })
    }
}

function recordExecutionHeartbeatFileMutation(taskId: string, workPackageId: string, timestamp = Date.now()): void {
    const store = useAgentStore.getState()
    const task = store.executionTasks[taskId]
    const workPackage = store.workPackages[workPackageId]

    if (task) {
        store.updateExecutionTask(taskId, {
            heartbeat: recordHeartbeatFileMutation(task.heartbeat, timestamp),
        })
    }

    if (workPackage) {
        store.updateWorkPackage(workPackageId, {
            heartbeat: recordHeartbeatFileMutation(workPackage.heartbeat, timestamp),
        })
    }
}

function stopExecutionHeartbeats(taskId: string, timestamp = Date.now()): void {
    const store = useAgentStore.getState()
    const task = store.executionTasks[taskId]
    if (!task) return

    store.updateExecutionTask(taskId, {
        heartbeat: stopExecutionHeartbeat(task.heartbeat, timestamp),
    })

    task.workPackages.forEach((workPackageId) => {
        const workPackage = useAgentStore.getState().workPackages[workPackageId]
        if (!workPackage) return

        store.updateWorkPackage(workPackageId, {
            heartbeat: stopExecutionHeartbeat(workPackage.heartbeat, timestamp),
        })
    })
}

function getPatrolSeverity(status: 'idle' | 'active' | 'silent-but-healthy' | 'suspected-stuck' | 'abandoned'): number {
    switch (status) {
        case 'abandoned':
            return 4
        case 'suspected-stuck':
            return 3
        case 'silent-but-healthy':
            return 2
        case 'active':
            return 1
        default:
            return 0
    }
}

function pauseExecutionForPatrolEscalation(): void {
    isRunning = false
    scheduler?.pause()
    Agent.abortAll()

    const store = useAgentStore.getState()
    if (store.activePlanId) {
        store.pauseExecution()
    }
    store.setControllerState('paused')
}

function syncTaskPatrol(taskId: string, input?: {
    now?: number
    thresholds?: Partial<PatrolThresholds>
}): {
    escalated: boolean
    status: 'idle' | 'active' | 'silent-but-healthy' | 'suspected-stuck' | 'abandoned'
    reason: string | null
    workPackageId: string | null
} | null {
    const store = useAgentStore.getState()
    const task = store.executionTasks[taskId]
    if (!task) return null

    const now = input?.now ?? Date.now()
    const thresholds = {
        ...DEFAULT_PATROL_THRESHOLDS,
        ...(input?.thresholds || {}),
    }

    const taskEvaluation = evaluateExecutionPatrol({
        heartbeat: task.heartbeat,
        patrol: task.patrol,
        now,
        thresholds,
    })

    let dominantStatus = taskEvaluation.patrol.status
    let dominantReason = taskEvaluation.patrol.reason
    let dominantWorkPackageId: string | null = null

    const executingWorkPackages = task.workPackages
        .map((workPackageId) => store.workPackages[workPackageId])
        .filter((workPackage): workPackage is WorkPackage => Boolean(workPackage) && ['executing', 'running', 'verifying'].includes(workPackage.status))

    executingWorkPackages.forEach((workPackage) => {
        const workPackageEvaluation = evaluateExecutionPatrol({
            heartbeat: workPackage.heartbeat,
            patrol: {
                ...createInitialPatrolState(),
                status: workPackage.heartbeat?.status === 'abandoned'
                    ? 'abandoned'
                    : workPackage.heartbeat?.status === 'suspected-stuck'
                        ? 'suspected-stuck'
                        : workPackage.heartbeat?.status === 'silent'
                            ? 'silent-but-healthy'
                            : workPackage.heartbeat?.status === 'active'
                                ? 'active'
                                : 'idle',
            },
            now,
            thresholds,
        })

        store.updateWorkPackage(workPackage.id, {
            heartbeat: workPackageEvaluation.heartbeat,
        })

        if (getPatrolSeverity(workPackageEvaluation.patrol.status) > getPatrolSeverity(dominantStatus)) {
            dominantStatus = workPackageEvaluation.patrol.status
            dominantReason = workPackageEvaluation.patrol.reason
            dominantWorkPackageId = workPackage.id
        }
    })

    const taskEscalation = shouldEscalatePatrolState({
        previousStatus: task.patrol?.status,
        nextStatus: dominantStatus,
        reason: dominantReason,
    })

    const nextTaskPatrol = getPatrolSeverity(dominantStatus) >= getPatrolSeverity(taskEvaluation.patrol.status)
        ? {
            ...(task.patrol || createInitialPatrolState()),
            status: dominantStatus,
            lastCheckedAt: now,
            lastTransitionAt: task.patrol?.status === dominantStatus ? task.patrol.lastTransitionAt : now,
            reason: dominantReason,
        }
        : taskEvaluation.patrol

    const nextTaskHeartbeat = getPatrolSeverity(dominantStatus) >= getPatrolSeverity(taskEvaluation.patrol.status)
        ? {
            ...(task.heartbeat || createEmptyExecutionHeartbeatSnapshot()),
            status: (dominantStatus === 'silent-but-healthy'
                ? 'silent'
                : dominantStatus) as 'idle' | 'active' | 'silent' | 'suspected-stuck' | 'abandoned',
            stuckReason: dominantStatus === 'suspected-stuck' || dominantStatus === 'abandoned'
                ? dominantReason
                : null,
        }
        : taskEvaluation.heartbeat

    store.updateExecutionTask(taskId, {
        patrol: nextTaskPatrol,
        heartbeat: nextTaskHeartbeat,
    })

    if (taskEscalation.trip) {
        executingWorkPackages.forEach((workPackage) => {
            store.updateWorkPackage(workPackage.id, {
                status: 'blocked',
            })
        })

        store.setExecutionTaskState(taskId, 'blocked')
        store.openExecutionTaskAdjudication(taskId, {
            trigger: 'circuit-breaker',
            reason: taskEscalation.reason || dominantReason || 'Execution appears stuck without progress.',
            changedFiles: [],
            workPackageId: dominantWorkPackageId,
        })
        pauseExecutionForPatrolEscalation()
    }

    return {
        escalated: taskEscalation.trip,
        status: dominantStatus,
        reason: dominantReason,
        workPackageId: dominantWorkPackageId,
    }
}

function ensureDetachedThreadForWorkPackage(workPackageId: string): string {
    const store = useAgentStore.getState()
    const existing = store.workPackages[workPackageId]?.threadId
    if (existing && store.threads[existing]) {
        return existing
    }

    const previousThreadId = store.currentThreadId
    const threadId = store.createThread()
    if (previousThreadId && previousThreadId !== threadId) {
        store.switchThread(previousThreadId)
    }
    store.updateWorkPackage(workPackageId, { threadId })
    return threadId
}

function mapWorkPackageToTemplateId(workPackage: WorkPackage): string {
    switch (workPackage.specialist) {
        case 'frontend':
            return 'uiux-designer'
        case 'verifier':
        case 'reviewer':
            return 'reviewer'
        default:
            return 'coder'
    }
}

function inferSpecialistKindFromRole(role: string, fallback?: SpecialistKind | null): SpecialistKind {
    if (fallback) return fallback

    const normalized = role.toLowerCase()
    if (/(frontend|ui|ux)/.test(normalized)) return 'frontend'
    if (/(review|audit)/.test(normalized)) return 'reviewer'
    if (/(verify|qa|test)/.test(normalized)) return 'verifier'
    return 'logic'
}

function buildWorkPackageMessage(workPackage: WorkPackage, executionTask: ExecutionTask, plan: TaskPlan): string {
    const lines: string[] = []

    lines.push('# Work Package Execution Request')
    lines.push('')
    lines.push(`## Execution Task Objective: ${executionTask.objective}`)
    lines.push(`## Work Package: ${workPackage.title}`)
    lines.push('')
    lines.push('### Specialist')
    lines.push(workPackage.specialist)
    lines.push('')
    lines.push('### Objective')
    lines.push(workPackage.objective)
    lines.push('')

    if (workPackage.writableScopes.length > 0) {
        lines.push('### Writable Scopes')
        lines.push(workPackage.writableScopes.map((scope) => `- ${scope}`).join('\n'))
        lines.push('')
    }

    if (plan.requirementsContent) {
        lines.push('### Requirements Context')
        lines.push(plan.requirementsContent.length > 3000
            ? `${plan.requirementsContent.slice(0, 3000)}\n\n... (truncated)`
            : plan.requirementsContent)
        lines.push('')
    }

    lines.push('### Instructions')
    lines.push('- Work only on this work package objective')
    lines.push('- Respect the writable scopes and avoid unrelated edits')
    lines.push('- Execute directly without asking the user for confirmation')
    lines.push('- Finish by summarizing changed files, validation, and remaining risks')

    return lines.join('\n')
}
async function runWorkPackageWithAgent(
    workPackage: WorkPackage,
    executionTask: ExecutionTask,
    plan: TaskPlan,
    workspacePath: string,
): Promise<{ success: boolean; output: string; error?: string; metrics: TaskExecutionMetrics; verification: WorkPackageVerificationResult }> {
    const threadId = ensureDetachedThreadForWorkPackage(workPackage.id)
    const attemptProfile = executionTask.specialistProfilesSnapshot[workPackage.specialist]
    const store = useStore.getState()
    const routedModel = resolveSpecialistRoute({
        policy: executionTask.modelRoutingPolicy ?? 'balanced',
        specialist: workPackage.specialist,
        specialistProvider: attemptProfile?.provider?.trim() || null,
        specialistModel: attemptProfile?.model?.trim() || null,
        defaultProvider: store.llmConfig.provider,
        resolveProviderContext: getProviderModelContext,
        budget: executionTask.budget,
    })
    const llmConfig = await getLLMConfigForTask(routedModel.providerId, routedModel.model)

    if (!llmConfig) {
        return {
            success: false,
            output: '',
            error: `Failed to resolve LLM config for ${routedModel.providerId}/${routedModel.model}`,
            metrics: { llmCalls: 0, estimatedTokens: 0, verifications: 0 },
            verification: buildDefaultVerificationResult(workPackage),
        }
    }

    const baseMessage = buildWorkPackageMessage(workPackage, executionTask, plan)
    const metrics: TaskExecutionMetrics = {
        llmCalls: 1,
        estimatedTokens: Math.max(1, Math.ceil(baseMessage.length / 4)),
        verifications: workPackage.specialist === 'verifier' || workPackage.specialist === 'reviewer' ? 1 : 0,
    }

    let message = baseMessage
    let browserProvider: 'playwright' | 'puppeteer' | null = null

    if (workPackage.verificationMode === 'browser') {
        const capability = getBrowserVerificationCapability()
        if (!capability.available) {
            return {
                success: true,
                output: capability.reason || 'Browser verification unavailable.',
                metrics,
                verification: {
                    status: 'blocked',
                    verificationStatus: 'pending',
                    mode: 'browser',
                    summary: 'Browser verification blocked before execution.',
                    reason: capability.reason || 'Browser verification unavailable.',
                    provider: capability.provider,
                },
            }
        }

        browserProvider = capability.provider
        message = `${baseMessage}

${buildBrowserVerificationPrompt({
            objective: executionTask.objective,
            workPackageTitle: workPackage.title,
            provider: capability.provider!,
            serverName: capability.serverName || capability.provider!,
        })}`
        metrics.estimatedTokens = Math.max(1, Math.ceil(message.length / 4))
    }

    await Agent.send(message, llmConfig, workspacePath, 'agent', {
        promptTemplateId: mapWorkPackageToTemplateId(workPackage),
        orchestratorPhase: 'executing',
        targetThreadId: threadId,
    })

    const result = await waitForAgentCompletion(threadId)
    return {
        ...result,
        metrics,
        verification: workPackage.verificationMode === 'browser'
            ? interpretBrowserVerificationResult(result.output, browserProvider)
            : buildDefaultVerificationResult(workPackage),
    }
}

async function executeWorkPackage(
    taskId: string,
    workPackage: WorkPackage,
    plan: TaskPlan,
    workspacePath: string,
    executionRunId: number,
): Promise<void> {
    if (!isExecutionRunCurrent(executionRunId)) return

    const store = useAgentStore.getState()
    const executionTask = store.executionTasks[taskId]
    if (!executionTask) return

    const preparedWorkPackage = await prepareWorkPackageExecution({
        taskId,
        workPackageId: workPackage.id,
        fallbackWorkspacePath: workspacePath,
        executionRunId,
    })

    if (!preparedWorkPackage.ready || !preparedWorkPackage.workspacePath || !isExecutionRunCurrent(executionRunId)) {
        return
    }

    const durationStartedAt = Date.now()
    recordExecutionHeartbeatToolActivity(taskId, workPackage.id, durationStartedAt)
    store.setExecutionTaskState(taskId, 'running')

    const patrolTimer = setInterval(() => {
        if (!isExecutionRunCurrent(executionRunId)) return
        syncTaskPatrol(taskId)
    }, 1_000)

    try {
        const result = await runWorkPackageWithAgent(
            useAgentStore.getState().workPackages[workPackage.id] || workPackage,
            useAgentStore.getState().executionTasks[taskId] || executionTask,
            plan,
            preparedWorkPackage.workspacePath,
        )

        const latestTaskAfterRun = useAgentStore.getState().executionTasks[taskId]
        const latestWorkPackageAfterRun = useAgentStore.getState().workPackages[workPackage.id]
        if (latestTaskAfterRun?.patrol && ['suspected-stuck', 'abandoned'].includes(latestTaskAfterRun.patrol.status)) {
            return
        }
        if (latestWorkPackageAfterRun?.status === 'blocked' && ['suspected-stuck', 'abandoned'].includes(latestWorkPackageAfterRun.heartbeat?.status || '')) {
            return
        }

        const changedFiles = await collectChangedFiles(preparedWorkPackage.workspacePath)
        const durationMs = Date.now() - durationStartedAt
        const completedAt = Date.now()

        recordExecutionHeartbeatAssistantOutput(taskId, workPackage.id, completedAt)
        if (changedFiles.length > 0) {
            recordExecutionHeartbeatFileMutation(taskId, workPackage.id, completedAt)
        }

        if (!isExecutionRunCurrent(executionRunId)) {
            return
        }

        if (!result.success) {
            applyTaskGovernanceForAttempt({
                taskId,
                durationMs,
                changedFiles,
                failureReason: result.error || 'Unknown work package failure',
                llmCalls: result.metrics.llmCalls,
                estimatedTokens: result.metrics.estimatedTokens,
                verifications: result.metrics.verifications,
            })
            await failWorkPackageExecution(taskId, workPackage.id)
            return
        }

        const mergeGateResult = scheduler?.validateTaskMerge({
            writableScopes: workPackage.writableScopes,
            changedFiles,
        })
        const verificationBlocked = result.verification.verificationStatus !== 'passed'
        if (mergeGateResult && !mergeGateResult.ok) {
            applyTaskGovernanceForAttempt({
                taskId,
                durationMs,
                changedFiles,
                adjudicationTrigger: 'unsafe-merge',
                adjudicationReason: mergeGateResult.reason,
                llmCalls: result.metrics.llmCalls,
                estimatedTokens: result.metrics.estimatedTokens,
                verifications: result.metrics.verifications,
            })
            await failWorkPackageExecution(taskId, workPackage.id)
            return
        }

        const nextTask = applyTaskGovernanceForAttempt({
            taskId,
            durationMs,
            changedFiles,
            llmCalls: result.metrics.llmCalls,
            estimatedTokens: result.metrics.estimatedTokens,
            verifications: result.metrics.verifications,
            adjudicationTrigger: verificationBlocked ? 'verification-failed' : undefined,
            adjudicationReason: verificationBlocked
                ? (result.verification.reason || result.verification.summary || 'Verification failed or is incomplete.')
                : undefined,
        })
        if (nextTask?.state === 'tripped') {
            await failWorkPackageExecution(taskId, workPackage.id)
            return
        }

        if (!isExecutionRunCurrent(executionRunId)) {
            return
        }

        await completeWorkPackageExecution({
            taskId,
            workPackageId: workPackage.id,
            summary: result.output,
            changedFiles,
            suggestedNextSpecialist: 'verifier',
            verificationStatus: result.verification.verificationStatus,
            verificationMode: result.verification.mode,
            verificationSummary: result.verification.summary,
            verificationBlockedReason: result.verification.reason,
            verificationProvider: result.verification.provider,
            riskLevel: executionTask.risk,
        })

        if (!isExecutionRunCurrent(executionRunId)) {
            return
        }

        store.setExecutionTaskState(taskId, verificationBlocked ? 'blocked' : 'verifying')
    } catch (error) {
        if (!isExecutionRunCurrent(executionRunId)) {
            return
        }

        const failureReason = error instanceof Error ? error.message : String(error)
        applyTaskGovernanceForAttempt({
            taskId,
            durationMs: Date.now() - durationStartedAt,
            changedFiles: [],
            failureReason,
            llmCalls: 0,
            estimatedTokens: 0,
            verifications: 0,
        })
        await failWorkPackageExecution(taskId, workPackage.id)
    } finally {
        clearInterval(patrolTimer)
        if (isExecutionRunCurrent(executionRunId)) {
            store.setCurrentTask(null)
        }
    }
}

function areWorkPackageDependenciesResolved(workPackage: WorkPackage): boolean {
    const store = useAgentStore.getState()
    return workPackage.dependsOn.every((dependencyId) => store.workPackages[dependencyId]?.status === 'applied')
}

function areAllWorkPackagesResolved(taskId: string): boolean {
    const store = useAgentStore.getState()
    const executionTask = store.executionTasks[taskId]
    if (!executionTask) return true

    return executionTask.workPackages
        .map((workPackageId) => store.workPackages[workPackageId])
        .every((workPackage) => workPackage && ['applied', 'failed', 'reassigned'].includes(workPackage.status))
}

async function runWorkPackageExecutionLoop(plan: TaskPlan, taskId: string, workspacePath: string, executionRunId: number): Promise<void> {
    while (isExecutionRunCurrent(executionRunId) && isRunning && scheduler && !scheduler.isAborted) {
        const latestPlan = getLatestPlanSnapshot(plan)
        const batchLimit = getWorkPackageBatchLimit(latestPlan)
        const batch = getRunnableWorkPackageBatch(taskId, batchLimit)
        const store = useAgentStore.getState()
        const executionTask = store.executionTasks[taskId]
        if (!executionTask) {
            await completeExecution(latestPlan, executionRunId)
            return
        }

        if (batch.length === 0) {
            if (areAllWorkPackagesResolved(taskId)) {
                await completeExecution(latestPlan, executionRunId)
                return
            }

            const hasPendingReview = executionTask.workPackages
                .map((workPackageId) => store.workPackages[workPackageId])
                .some((workPackage) => workPackage && (workPackage.status === 'proposal-ready' || (workPackage.status === 'queued' && !areWorkPackageDependenciesResolved(workPackage))))

            if (hasPendingReview) {
                await sleep(150)
                continue
            }

            await sleep(150)
            continue
        }

        await Promise.all(batch.map((workPackage) => executeWorkPackage(taskId, workPackage, latestPlan, workspacePath, executionRunId)))
    }
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
    if (stopInFlightPromise) {
        await stopInFlightPromise
    }

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
    store.updateExecutionTask(executionTaskId, {
        sourceWorkspacePath: workspacePath,
        resolvedWorkspacePath: null,
        isolationMode: null,
        isolationStatus: 'pending',
        isolationError: null,
    })

    const executionRunId = beginExecutionRun()

    // 初始化调度器
    scheduler = new ExecutionScheduler({ maxConcurrency: DEFAULT_WORK_PACKAGE_MAX_CONCURRENCY })
    scheduler.start()
    executionStartedAt = Date.now()
    isRunning = true

    // 更新 Store 状态
    store.startExecution(plan.id)

    logger.agent.info(`[OrchestratorExecutor] Started execution of plan: ${plan.name}`)

    // 发布事件
    EventBus.emit({ type: 'plan:start', planId: plan.id } as any)

    // 异步执行（不阻塞返回）
    runWorkPackageExecutionLoop(plan, executionTaskId, workspacePath, executionRunId).catch(async error => {
        if (!isExecutionRunCurrent(executionRunId)) {
            return
        }

        logger.agent.error('[OrchestratorExecutor] Execution loop failed:', error)
        await handleExecutionError(plan, error, executionRunId)
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
    if (stopInFlightPromise) {
        await stopInFlightPromise
        return
    }

    const store = useAgentStore.getState()
    const executionTaskId = store.activeExecutionTaskId
    const activePlanId = store.activePlanId
    store.setControllerState('stopping')

    invalidateExecutionRun()
    isRunning = false
    scheduler?.stop()
    scheduler = null

    // 中止当前正在运行的 Agent
    Agent.abortAll()

    const stopPromise = (async () => {
        try {
            if (executionTaskId) {
                await cleanupTaskExecutionWorkspace(executionTaskId)
                stopExecutionHeartbeats(executionTaskId, Date.now())
            }
        } finally {
            const latestStore = useAgentStore.getState()
            latestStore.cleanupManualStopState(activePlanId, executionTaskId)
            if (executionTaskId) {
                syncTaskRecoveryCheckpoint(executionTaskId, { status: 'ready' })
            }
            latestStore.stopExecution()
        }

        logger.agent.info('[OrchestratorExecutor] Execution stopped')
    })()

    stopInFlightPromise = stopPromise

    try {
        await stopPromise
    } finally {
        if (stopInFlightPromise === stopPromise) {
            stopInFlightPromise = null
        }
    }
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
    restoreExecutionTaskFromRecovery(executionTaskId)
    const executionRunId = beginExecutionRun()

    isRunning = true
    scheduler?.resume()
    store.resumeExecution()

    EventBus.emit({ type: 'plan:resumed', planId: plan.id } as any)

    // 继续执行循环
    runWorkPackageExecutionLoop(plan, executionTaskId, workspacePath, executionRunId).catch(async error => {
        if (!isExecutionRunCurrent(executionRunId)) {
            return
        }

        logger.agent.error('[OrchestratorExecutor] Resume failed:', error)
        await handleExecutionError(plan, error, executionRunId)
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
export async function runExecutionLoop(plan: TaskPlan, workspacePath: string): Promise<void> {
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
async function completeExecution(plan: TaskPlan, executionRunId?: number): Promise<void> {
    if (!scheduler || !isExecutionRunCurrent(executionRunId)) return

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
        const completedAt = Date.now()
        await cleanupTaskExecutionWorkspace(executionTaskId)
        stopExecutionHeartbeats(executionTaskId, completedAt)
        syncTaskRecoveryCheckpoint(executionTaskId, { status: 'idle', updatedAt: completedAt })
    }

    if (!isExecutionRunCurrent(executionRunId)) {
        return
    }

    EventBus.emit({ type: 'plan:complete', planId: plan.id, stats } as any)

    logger.agent.info(`[OrchestratorExecutor] Execution complete:`, stats)
}

/**
 * 处理执行错误
 */
async function handleExecutionError(plan: TaskPlan, error: unknown, executionRunId?: number): Promise<void> {
    if (!isExecutionRunCurrent(executionRunId)) {
        return
    }

    const errorMsg = error instanceof Error ? error.message : String(error)

    const store = useAgentStore.getState()
    const executionTaskId = store.activeExecutionTaskId
    store.updatePlan(plan.id, { status: 'failed' })
    store.stopExecution()

    isRunning = false
    scheduler?.stop()
    scheduler = null

    if (executionTaskId) {
        const failedAt = Date.now()
        await cleanupTaskExecutionWorkspace(executionTaskId)
        stopExecutionHeartbeats(executionTaskId, failedAt)
        syncTaskRecoveryCheckpoint(executionTaskId, { status: 'ready', updatedAt: failedAt })
    }

    if (!isExecutionRunCurrent(executionRunId)) {
        return
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
            const routedModel = resolveSpecialistRoute({
                policy: executionTask?.modelRoutingPolicy ?? 'manual',
                specialist: inferSpecialistKindFromRole(currentRole, attemptProfile?.role),
                specialistProvider: attemptProfile?.provider?.trim() || null,
                specialistModel: attemptProfile?.model?.trim() || null,
                defaultProvider: task.provider,
                resolveProviderContext: (providerId) => {
                    const providerContext = getProviderModelContext(providerId)
                    return {
                        ...providerContext,
                        defaultModel: providerId === task.provider && task.model ? task.model : providerContext.defaultModel,
                    }
                },
                budget: executionTask?.budget,
            })
            const llmConfig = await getLLMConfigForTask(routedModel.providerId, routedModel.model)
            if (!llmConfig) {
                return { success: false, output: '', error: `Failed to get LLM config for ${routedModel.providerId}/${routedModel.model}`, metrics }
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

            const result = await waitForAgentCompletion(useAgentStore.getState().currentThreadId || '')

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
