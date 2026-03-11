import { describe, expect, it } from 'vitest'

import {
  createRollbackProposal,
  createRollbackStateFromProposal,
} from '@renderer/agent/services/rollbackOrchestratorService'

describe('rollback orchestrator service', () => {
  it('auto-disposes isolated task workspaces', () => {
    const proposal = createRollbackProposal({
      executionTarget: 'isolated',
      changedFiles: ['src/main/main.ts'],
      externalSideEffects: [],
      resolvedWorkspacePath: '/tmp/adnify-task-1',
    })

    expect(proposal.mode).toBe('auto-dispose')
    expect(proposal.requiresConfirmation).toBe(false)
    expect(proposal.summary).toMatch(/dispose/i)
  })

  it('respects rollback governance overrides for isolated workspaces', () => {
    const proposal = createRollbackProposal({
      executionTarget: 'isolated',
      changedFiles: ['src/main/main.ts'],
      externalSideEffects: [],
      resolvedWorkspacePath: '/tmp/adnify-task-1',
    }, {
      autoRollbackIsolated: false,
      requireConfirmationForMainWorkspace: true,
      warnOnExternalSideEffects: true,
    })

    expect(proposal.mode).toBe('proposal')
    expect(proposal.requiresConfirmation).toBe(true)
    expect(proposal.summary).toMatch(/confirmation/i)
  })

  it('requires confirmation for main-workspace rollback proposals', () => {
    const proposal = createRollbackProposal({
      executionTarget: 'current',
      changedFiles: ['src/renderer/App.tsx'],
      externalSideEffects: ['npm install'],
    })

    const rollback = createRollbackStateFromProposal(proposal, 42)
    expect(rollback.status).toBe('ready')
    expect(rollback.proposal?.requiresConfirmation).toBe(true)
    expect(rollback.proposal?.externalSideEffects).toEqual(['npm install'])
  })

  it('can relax main-workspace confirmation when configured', () => {
    const proposal = createRollbackProposal({
      executionTarget: 'current',
      changedFiles: ['src/renderer/App.tsx'],
      externalSideEffects: ['npm install'],
    }, {
      autoRollbackIsolated: true,
      requireConfirmationForMainWorkspace: false,
      warnOnExternalSideEffects: true,
    })

    expect(proposal.mode).toBe('proposal')
    expect(proposal.requiresConfirmation).toBe(false)
  })
})
