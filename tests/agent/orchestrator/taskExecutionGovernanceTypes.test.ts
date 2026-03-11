import { describe, expect, it } from 'vitest'

import { DEFAULT_TRUST_POLICY } from '@renderer/agent/types/trustPolicy'
import {
  createDefaultTaskBudget,
  createEmptyTaskBudgetUsage,
  createInitialExecutionTaskGovernanceState,
  createInitialRollbackState,
  createEmptySpecialistProfileSnapshot,
} from '@renderer/agent/types/taskExecution'

describe('task governance types', () => {
  it('creates conservative default task budget state', () => {
    const budget = createDefaultTaskBudget()

    expect(budget.limits.timeMs).toBeGreaterThan(0)
    expect(budget.limits.estimatedTokens).toBeGreaterThan(0)
    expect(budget.limits.llmCalls).toBeGreaterThan(0)
    expect(budget.warningThresholdRatio).toBe(0.8)
    expect(budget.hardStop).toBe(true)
  })

  it('creates empty usage and rollback state', () => {
    expect(createEmptyTaskBudgetUsage()).toEqual({
      timeMs: 0,
      estimatedTokens: 0,
      llmCalls: 0,
      commands: 0,
      verifications: 0,
    })

    expect(createInitialRollbackState()).toEqual({
      status: 'idle',
      proposal: null,
      lastUpdatedAt: null,
    })
  })

  it('creates initial governance state and specialist snapshots', () => {
    expect(createInitialExecutionTaskGovernanceState()).toBe('active')

    const snapshot = createEmptySpecialistProfileSnapshot(['frontend', 'verifier'])
    expect(snapshot.frontend?.role).toBe('frontend')
    expect(snapshot.verifier?.role).toBe('verifier')
    expect(snapshot.frontend?.trustMode).toBe(DEFAULT_TRUST_POLICY.mode)
    expect(snapshot.frontend?.verificationMode).toBe('browser')
    expect(snapshot.verifier?.verificationMode).toBe('regression')
  })
})
