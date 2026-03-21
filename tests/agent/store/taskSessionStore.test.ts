import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentStore } from '@renderer/agent/store/AgentStore'
import {
  createDefaultExecutionStrategySnapshot,
  createDefaultTaskBudget,
  createEmptyExecutionHeartbeatSnapshot,
  createEmptyExecutionQueueSummary,
  createEmptyProposalSummary,
  createEmptySpecialistProfileSnapshot,
  createInitialPatrolState,
  createInitialRecoveryCheckpoint,
  createInitialRollbackState,
  type ChangeProposal,
  type ExecutionTask,
  type ProposalVerificationStatus,
} from '@renderer/agent/types/taskExecution'

function buildExecutionTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  const now = 1_710_000_000_000

  return {
    id: 'task-1',
    objective: 'Integrate a task-first hybrid agent IDE flow',
    specialists: ['logic', 'verifier'],
    state: 'planning',
    governanceState: 'active',
    patrol: createInitialPatrolState(),
    heartbeat: createEmptyExecutionHeartbeatSnapshot(),
    recoveryCheckpoint: createInitialRecoveryCheckpoint(),
    risk: 'medium',
    executionTarget: 'isolated',
    trustMode: 'balanced',
    modelRoutingPolicy: 'balanced',
    executionStrategy: createDefaultExecutionStrategySnapshot(),
    workPackages: ['wp-1'],
    sourceWorkspacePath: '/workspace/source',
    resolvedWorkspacePath: '/workspace/isolated',
    isolationMode: 'worktree',
    isolationStatus: 'ready',
    isolationError: null,
    queueSummary: createEmptyExecutionQueueSummary(),
    proposalSummary: createEmptyProposalSummary(),
    latestHandoffId: null,
    latestProposalId: null,
    latestAdjudicationId: null,
    circuitBreaker: null,
    budget: createDefaultTaskBudget(),
    rollback: createInitialRollbackState(),
    specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['logic', 'verifier']),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildProposal(
  id: string,
  verificationStatus: ProposalVerificationStatus,
  overrides: Partial<ChangeProposal> = {},
): ChangeProposal {
  const now = 1_710_000_000_000

  return {
    id,
    taskId: 'task-1',
    workPackageId: `wp-${id}`,
    summary: `Proposal ${id}`,
    changedFiles: ['src/renderer/App.tsx'],
    verificationStatus,
    verificationMode: 'regression',
    verificationSummary: verificationStatus === 'passed' ? 'Checks passed.' : 'Checks pending.',
    verificationBlockedReason: verificationStatus === 'passed' ? null : 'Waiting for regression verification.',
    verificationProvider: null,
    riskLevel: 'medium',
    recommendedAction: 'apply',
    status: 'pending',
    applyError: null,
    conflictFiles: [],
    createdAt: now,
    resolvedAt: null,
    ...overrides,
  }
}

describe('TaskSession store integration', () => {
  beforeEach(() => {
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
      taskSessions: {},
      currentTaskSessionId: null,
      executionTasks: {},
      changeProposals: {},
    })
  })

  it('creates and selects a task session', () => {
    const store = useAgentStore.getState()
    const sessionId = store.createTaskSession({
      objective: 'Ship task sessions',
      successCriteria: ['Session binds execution state'],
    })

    const current = useAgentStore.getState().getCurrentTaskSession()
    expect(sessionId).toBeDefined()
    expect(useAgentStore.getState().currentTaskSessionId).toBe(sessionId)
    expect(current?.objective).toBe('Ship task sessions')
    expect(current?.successCriteria).toEqual(['Session binds execution state'])
    expect(current?.stage).toBe('define')
  })

  it('binds a thread and execution task to the active task session', () => {
    const store = useAgentStore.getState()
    const sessionId = store.createTaskSession({
      objective: 'Ship task sessions',
    })
    const threadId = store.createThread()
    const task = buildExecutionTask({ state: 'running' })

    store.bindThreadToTaskSession(sessionId, threadId)
    store.bindExecutionTaskToTaskSession(sessionId, task)

    const current = useAgentStore.getState().getCurrentTaskSession()
    expect(current?.threadId).toBe(threadId)
    expect(current?.activeExecutionTaskId).toBe(task.id)
    expect(current?.executionRun?.taskId).toBe(task.id)
    expect(current?.stage).toBe('execute')
  })

  it('syncs proposals into the current task session patch batch and verification summary', () => {
    const store = useAgentStore.getState()
    const sessionId = store.createTaskSession({
      objective: 'Ship task sessions',
    })
    store.bindExecutionTaskToTaskSession(sessionId, buildExecutionTask({ state: 'running' }))

    store.syncTaskSessionProposals(sessionId, [
      buildProposal('proposal-1', 'pending'),
      buildProposal('proposal-2', 'passed', {
        changedFiles: ['src/renderer/App.tsx', 'src/renderer/components/panels/ComposerPanel.tsx'],
      }),
    ])

    const current = useAgentStore.getState().getCurrentTaskSession()
    expect(current?.stage).toBe('review')
    expect(current?.patchBatch.totalProposals).toBe(2)
    expect(current?.patchBatch.canApply).toBe(false)
    expect(current?.patchBatch.changedFiles).toEqual([
      'src/renderer/App.tsx',
      'src/renderer/components/panels/ComposerPanel.tsx',
    ])
    expect(current?.verification.status).toBe('pending')
  })
})
