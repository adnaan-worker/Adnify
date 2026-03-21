import { describe, expect, it } from 'vitest'

import type {
  ChangeProposal,
  ProposalVerificationStatus,
} from '@renderer/agent/types/taskExecution'
import {
  evaluatePatchGate,
  evaluatePlanningGate,
  evaluateVerificationGate,
  evaluateWorkspaceGate,
} from '@renderer/agent/types/taskSessionGates'

function buildProposal(
  id: string,
  verificationStatus: ProposalVerificationStatus,
  overrides: Partial<ChangeProposal> = {},
): ChangeProposal {
  return {
    id,
    taskId: 'task-1',
    workPackageId: `wp-${id}`,
    summary: `Proposal ${id}`,
    changedFiles: ['src/renderer/App.tsx'],
    verificationStatus,
    verificationMode: 'regression',
    verificationSummary: verificationStatus === 'passed' ? 'Regression checks passed.' : 'Regression checks pending.',
    verificationBlockedReason: verificationStatus === 'passed' ? null : 'Verification is still pending.',
    verificationProvider: null,
    riskLevel: 'medium',
    recommendedAction: 'apply',
    status: 'pending',
    applyError: null,
    conflictFiles: [],
    createdAt: 1,
    resolvedAt: null,
    ...overrides,
  }
}

describe('task session gates', () => {
  it('blocks execution until a plan is available', () => {
    const blocked = evaluatePlanningGate({
      hasPlan: false,
      successCriteriaCount: 1,
    })

    expect(blocked.status).toBe('blocked')
    expect(blocked.reason).toContain('plan')

    const ready = evaluatePlanningGate({
      hasPlan: true,
      successCriteriaCount: 2,
    })

    expect(ready.status).toBe('ready')
  })

  it('recommends isolated workspaces for non-trivial tasks', () => {
    const warning = evaluateWorkspaceGate({
      risk: 'medium',
      fileCount: 3,
      executionTarget: 'current',
      isolationReady: false,
    })

    expect(warning.status).toBe('warning')
    expect(warning.reason).toContain('isolated workspace')

    const ready = evaluateWorkspaceGate({
      risk: 'low',
      fileCount: 1,
      executionTarget: 'current',
      isolationReady: false,
    })

    expect(ready.status).toBe('ready')
  })

  it('blocks patch apply when proposals are unverified or conflicted', () => {
    const blocked = evaluatePatchGate({
      proposals: [
        buildProposal('proposal-1', 'pending'),
        buildProposal('proposal-2', 'passed', {
          conflictFiles: ['src/renderer/App.tsx'],
        }),
      ],
    })

    expect(blocked.status).toBe('blocked')
    expect(blocked.reason).toContain('conflict')

    const ready = evaluatePatchGate({
      proposals: [
        buildProposal('proposal-3', 'passed'),
      ],
    })

    expect(ready.status).toBe('ready')
  })

  it('blocks completion until verification passes or degraded acceptance is explicit', () => {
    const blocked = evaluateVerificationGate({
      proposals: [
        buildProposal('proposal-1', 'failed', {
          verificationSummary: 'Browser verification failed.',
          verificationBlockedReason: 'Fix browser regression before completion.',
        }),
      ],
    })

    expect(blocked.status).toBe('blocked')
    expect(blocked.reason).toContain('verification')

    const degraded = evaluateVerificationGate({
      proposals: [
        buildProposal('proposal-1', 'failed', {
          verificationSummary: 'Browser verification failed.',
          verificationBlockedReason: 'Fix browser regression before completion.',
        }),
      ],
      allowDegradedAcceptance: true,
    })

    expect(degraded.status).toBe('warning')

    const ready = evaluateVerificationGate({
      proposals: [
        buildProposal('proposal-2', 'passed', {
          verificationSummary: 'Browser flow passed.',
        }),
      ],
    })

    expect(ready.status).toBe('ready')
  })
})
