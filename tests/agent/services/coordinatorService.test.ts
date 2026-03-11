import { describe, expect, it } from 'vitest'

import {
  validateChangeProposalForMerge,
  validateHandoffForMerge,
} from '@renderer/agent/services/coordinatorService'

describe('coordinator merge gate', () => {
  it('blocks handoffs that modify files outside writable scopes', () => {
    const result = validateHandoffForMerge({
      writableScopes: ['src/renderer/components/settings'],
      changedFiles: ['src/main/main.ts'],
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Expected coordinator merge gate to reject out-of-scope files')
    expect(result.reason).toContain('outside writable scopes')
  })

  it('allows merges when files stay within writable scopes', () => {
    const result = validateHandoffForMerge({
      writableScopes: ['src/renderer/components/settings'],
      changedFiles: ['src/renderer/components/settings/SettingsModal.tsx'],
    })

    expect(result.ok).toBe(true)
  })


  it('recommends return-for-rework when proposal scope validation fails', () => {
    const result = validateChangeProposalForMerge({
      writableScopes: ['src/renderer/components/settings'],
      changedFiles: ['src/main/main.ts'],
      verificationStatus: 'passed',
      riskLevel: 'low',
    })

    expect(result.ok).toBe(false)
    expect(result.recommendedAction).toBe('return-for-rework')
    expect(result.outOfScopeFiles).toEqual(['src/main/main.ts'])
  })

  it('recommends reassignment for high-risk verified proposals', () => {
    const result = validateChangeProposalForMerge({
      writableScopes: ['src/renderer/components/settings'],
      changedFiles: ['src/renderer/components/settings/SettingsModal.tsx'],
      verificationStatus: 'passed',
      riskLevel: 'high',
    })

    expect(result.ok).toBe(false)
    expect(result.recommendedAction).toBe('reassign')
    expect(result.reason).toContain('High-risk')
  })

})
