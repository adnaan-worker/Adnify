import { describe, expect, it } from 'vitest'

import type { TaskTrustSettings as PersistedTaskTrustSettings } from '@shared/config/types'
import { normalizeTaskTrustSettings } from '@renderer/components/settings/types'

describe('task trust settings', () => {
  it('hydrates defaults for global, workspace, and task overrides', () => {
    const settings = normalizeTaskTrustSettings(undefined)
    expect(settings.global.mode).toBe('balanced')
    expect(settings.global.modelRoutingPolicy).toBe('balanced')
    expect(settings.workspaceOverrides).toEqual({})
    expect(settings.allowTaskOverride).toBe(true)
  })

  it('hydrates partial workspace override policies', () => {
    const settings = normalizeTaskTrustSettings({
      workspaceOverrides: {
        '/tmp/project': {
          mode: 'safe',
        },
      },
    } satisfies PersistedTaskTrustSettings)

    expect(settings.workspaceOverrides['/tmp/project']).toEqual({
      mode: 'safe',
      enableSafetyGuards: true,
      defaultExecutionTarget: 'auto',
      interruptMode: 'phase',
      modelRoutingPolicy: 'balanced',
    })
  })

  it('hydrates conservative governance defaults for budgets and specialist profiles', () => {
    const settings = normalizeTaskTrustSettings(undefined)

    expect(settings.governanceDefaults.budget.limits.timeMs).toBeGreaterThan(0)
    expect(settings.governanceDefaults.budget.hardStop).toBe(true)
    expect(settings.governanceDefaults.rollback.autoRollbackIsolated).toBe(true)
    expect(settings.governanceDefaults.rollback.requireConfirmationForMainWorkspace).toBe(true)
    expect(settings.specialistProfiles.frontend.role).toBe('frontend')
    expect(settings.specialistProfiles.frontend.verificationMode).toBe('browser')
    expect(settings.specialistProfiles.reviewer.toolPermission).toBe('read-mostly')
  })

  it('merges specialist profile overrides with conservative defaults', () => {
    const settings = normalizeTaskTrustSettings({
      specialistProfiles: {
        frontend: {
          model: 'gpt-4.1',
          toolPermission: 'elevated',
        },
      },
    } satisfies PersistedTaskTrustSettings)

    expect(settings.specialistProfiles.frontend.model).toBe('gpt-4.1')
    expect(settings.specialistProfiles.frontend.toolPermission).toBe('elevated')
    expect(settings.specialistProfiles.frontend.networkPermission).toBe('workspace-only')
  })
})
