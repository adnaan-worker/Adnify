import { describe, expect, it } from 'vitest'

import {
  buildExecutionTaskInputFromPlan,
  buildTaskWorkPackages,
  getTaskTemplates,
} from '@renderer/agent/services/taskTemplateService'

describe('task template service', () => {
  it('returns a template for frontend + logic + verifier collaboration', () => {
    const template = getTaskTemplates().find((item) => item.id === 'frontend-logic-verifier')
    expect(template?.specialists).toEqual(['frontend', 'logic', 'verifier'])
    expect(template?.workPackages.length).toBeGreaterThan(1)
  })

  it('builds execution task input from plan tasks and trust settings', () => {
    const input = buildExecutionTaskInputFromPlan(
      {
        id: 'plan-1',
        name: 'Ship onboarding',
        userRequest: 'Ship onboarding flow',
        tasks: [
          {
            id: '1',
            title: 'Build onboarding UI',
            description: 'Implement frontend UI',
            provider: 'openai',
            model: 'gpt-4o',
            role: 'frontend',
            dependencies: [],
            status: 'pending',
          },
          {
            id: '2',
            title: 'Run regression checks',
            description: 'Verify onboarding logic',
            provider: 'openai',
            model: 'gpt-4o',
            role: 'verifier',
            dependencies: ['1'],
            status: 'pending',
          },
        ],
      },
      { mode: 'balanced', defaultExecutionTarget: 'auto' },
    )

    expect(input.sourcePlanId).toBe('plan-1')
    expect(input.objective).toBe('Ship onboarding flow')
    expect(input.specialists).toEqual(['frontend', 'verifier'])
    expect(input.risk).toBe('medium')
    expect(input.trustMode).toBe('balanced')
    expect(input.executionTarget).toBeUndefined()
  })

  it('emits ordered work packages with explicit dependencies and writable scopes', () => {
    const workPackages = buildTaskWorkPackages('task-1', {
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic', 'verifier'],
      writableScopes: ['src/renderer'],
    })

    expect(workPackages).toHaveLength(3)
    expect(workPackages[0].dependsOn).toEqual([])
    expect(workPackages[1].dependsOn).toEqual([workPackages[0].id])
    expect(workPackages[2].dependsOn).toEqual([workPackages[1].id])
    expect(workPackages[0].writableScopes).toEqual(['src/renderer'])
  })
})
