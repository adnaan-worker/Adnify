import { describe, expect, it } from 'vitest'

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
import { createTaskSession, derivePatchBatchSummary, deriveTaskSessionStage } from '@renderer/agent/types/taskSession'

function buildExecutionTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  const now = 1_710_000_000_000

  return {
    id: 'task-1',
    objective: 'Ship a safer hybrid agent IDE flow',
    specialists: ['logic', 'verifier'],
    state: 'running',
    governanceState: 'active',
    patrol: createInitialPatrolState(),
    heartbeat: createEmptyExecutionHeartbeatSnapshot(),
    recoveryCheckpoint: createInitialRecoveryCheckpoint(),
    risk: 'medium',
    executionTarget: 'isolated',
    trustMode: 'balanced',
    modelRoutingPolicy: 'balanced',
    executionStrategy: createDefaultExecutionStrategySnapshot(),
    workPackages: ['wp-1', 'wp-2'],
    sourceWorkspacePath: '/workspace/source',
    resolvedWorkspacePath: '/workspace/isolated',
    isolationMode: 'worktree',
    isolationStatus: 'ready',
    isolationError: null,
    queueSummary: createEmptyExecutionQueueSummary(),
    proposalSummary: createEmptyProposalSummary(),
    latestHandoffId: null,
    latestProposalId: 'proposal-2',
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
    verificationSummary: verificationStatus === 'passed' ? 'Regression checks passed.' : 'Regression checks pending.',
    verificationBlockedReason: verificationStatus === 'passed' ? null : 'Waiting for verification to complete.',
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

describe('task session model', () => {
  it('aggregates the active execution task, patch batch, and verification summary', () => {
    const task = buildExecutionTask()
    const pendingProposal = buildProposal('proposal-1', 'pending')
    const passedProposal = buildProposal('proposal-2', 'passed', {
      changedFiles: ['src/renderer/App.tsx', 'src/renderer/components/panels/ComposerPanel.tsx'],
    })

    const session = createTaskSession({
      id: 'session-1',
      objective: task.objective,
      successCriteria: ['Task board is primary entry', 'Patch review gates apply'],
      threadId: 'thread-1',
      task,
      proposals: [pendingProposal, passedProposal],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })

    expect(session.activeExecutionTaskId).toBe(task.id)
    expect(session.threadId).toBe('thread-1')
    expect(session.stage).toBe('review')
    expect(session.patchBatch.totalProposals).toBe(2)
    expect(session.patchBatch.changedFiles).toEqual([
      'src/renderer/App.tsx',
      'src/renderer/components/panels/ComposerPanel.tsx',
    ])
    expect(session.patchBatch.canApply).toBe(false)
    expect(session.verification.status).toBe('pending')
    expect(session.verification.blockedReasons).toContain('Waiting for verification to complete.')
  })

  it('derives define, plan, execute, verify, and complete stages from task state', () => {
    expect(deriveTaskSessionStage({ task: null, proposals: [] })).toBe('define')
    expect(deriveTaskSessionStage({ task: buildExecutionTask({ state: 'planning' }), proposals: [] })).toBe('plan')
    expect(deriveTaskSessionStage({ task: buildExecutionTask({ state: 'running' }), proposals: [] })).toBe('execute')
    expect(deriveTaskSessionStage({ task: buildExecutionTask({ state: 'verifying' }), proposals: [] })).toBe('verify')
    expect(deriveTaskSessionStage({ task: buildExecutionTask({ state: 'complete' }), proposals: [] })).toBe('complete')
  })

  it('marks a patch batch as applyable only when every pending proposal is verified and conflict-free', () => {
    const applyable = derivePatchBatchSummary([
      buildProposal('proposal-1', 'passed', {
        verificationMode: 'browser',
        changedFiles: ['src/renderer/App.tsx'],
      }),
      buildProposal('proposal-2', 'passed', {
        verificationMode: 'browser',
        changedFiles: ['src/renderer/components/orchestrator/ExecutionTaskPanel.tsx'],
      }),
    ])

    expect(applyable.verificationStatus).toBe('passed')
    expect(applyable.verificationModes).toEqual(['browser'])
    expect(applyable.hasConflicts).toBe(false)
    expect(applyable.canApply).toBe(true)

    const blocked = derivePatchBatchSummary([
      buildProposal('proposal-1', 'passed'),
      buildProposal('proposal-2', 'failed', {
        conflictFiles: ['src/renderer/App.tsx'],
        verificationBlockedReason: 'Regression tests failed.',
      }),
    ])

    expect(blocked.verificationStatus).toBe('failed')
    expect(blocked.hasConflicts).toBe(true)
    expect(blocked.canApply).toBe(false)
  })
})
