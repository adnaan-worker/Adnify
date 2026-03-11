import { describe, expect, it } from 'vitest'

import { DEFAULT_TRUST_POLICY, shouldUseIsolatedWorkspace } from '@renderer/agent/types/trustPolicy'
import {
  createDefaultExecutionStrategySnapshot,
  createEmptyExecutionHeartbeatSnapshot,
  createEmptyExecutionQueueSummary,
  createEmptyProposalSummary,
  createInitialRecoveryCheckpoint,
  type WorkPackageStatus,
} from '@renderer/agent/types/taskExecution'

describe('task execution types', () => {
  it('defaults to balanced trust with isolation enabled', () => {
    expect(DEFAULT_TRUST_POLICY.mode).toBe('balanced')
    expect(DEFAULT_TRUST_POLICY.enableSafetyGuards).toBe(true)
    expect(DEFAULT_TRUST_POLICY.modelRoutingPolicy).toBe('balanced')
  })

  it('routes medium and large work into isolated workspaces', () => {
    expect(shouldUseIsolatedWorkspace({ risk: 'medium', fileCount: 4 })).toBe(true)
    expect(shouldUseIsolatedWorkspace({ risk: 'low', fileCount: 1 })).toBe(false)
  })

  it('supports the work-package lifecycle needed for multi-agent orchestration', () => {
    const lifecycle: WorkPackageStatus[] = [
      'queued',
      'leasing',
      'executing',
      'verifying',
      'handoff-ready',
      'proposal-ready',
      'waiting-approval',
      'applied',
      'reassigned',
      'failed',
    ]

    expect(lifecycle).toContain('proposal-ready')
    expect(lifecycle).toContain('waiting-approval')
  })

  it('creates empty autonomy heartbeat and recovery defaults', () => {
    const heartbeat = createEmptyExecutionHeartbeatSnapshot()
    const checkpoint = createInitialRecoveryCheckpoint()

    expect(heartbeat.status).toBe('idle')
    expect(heartbeat.lastProgressAt).toBeNull()
    expect(heartbeat.stuckReason).toBeNull()
    expect(checkpoint.status).toBe('idle')
    expect(checkpoint.lastSafeWorkPackageId).toBeNull()
    expect(checkpoint.resumeCandidateWorkPackageIds).toEqual([])
  })

  it('creates conservative orchestration defaults for queueing and proposal review', () => {
    const strategy = createDefaultExecutionStrategySnapshot()
    const queueSummary = createEmptyExecutionQueueSummary()
    const proposalSummary = createEmptyProposalSummary()

    expect(strategy.orchestrationMode).toBe('mixed')
    expect(strategy.ownershipPolicy).toBe('exclusive')
    expect(strategy.conflictPolicy).toBe('queue')
    expect(strategy.proposalReviewPolicy).toBe('per-work-package')
    expect(queueSummary.queuedCount).toBe(0)
    expect(queueSummary.blockedScopes).toEqual([])
    expect(proposalSummary.pendingCount).toBe(0)
    expect(proposalSummary.appliedCount).toBe(0)
  })
})
