import { describe, expect, it } from 'vitest'

import { buildChangeProposal } from '@renderer/agent/services/proposalEngineService'

describe('proposal engine service', () => {
  it('flags out-of-scope files and recommends return-for-rework', () => {
    const result = buildChangeProposal({
      taskId: 'task-1',
      workPackageId: 'pkg-1',
      summary: 'Renderer package is ready',
      changedFiles: ['src/main/main.ts', 'src/renderer/App.tsx'],
      writableScopes: ['src/renderer'],
      verificationStatus: 'passed',
      riskLevel: 'low',
      createdAt: 10,
    })

    expect(result.outOfScopeFiles).toEqual(['src/main/main.ts'])
    expect(result.safeToApply).toBe(false)
    expect(result.proposal.recommendedAction).toBe('return-for-rework')
  })

  it('carries review metadata for high-risk but in-scope proposals', () => {
    const result = buildChangeProposal({
      taskId: 'task-1',
      workPackageId: 'pkg-2',
      summary: 'Risky package is ready',
      changedFiles: ['src/renderer/App.tsx'],
      writableScopes: ['src/renderer'],
      verificationStatus: 'passed',
      riskLevel: 'high',
      createdAt: 20,
    })

    expect(result.outOfScopeFiles).toEqual([])
    expect(result.safeToApply).toBe(false)
    expect(result.proposal.recommendedAction).toBe('reassign')
    expect(result.proposal.verificationStatus).toBe('passed')
  })
})
