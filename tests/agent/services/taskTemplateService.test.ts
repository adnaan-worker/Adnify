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

  it('exposes richer phase-two templates with execution metadata', () => {
    const templates = getTaskTemplates()
    expect(templates.map((template) => template.id)).toEqual(expect.arrayContaining([
      'frontend-logic-reviewer',
      'logic-verifier',
      'full-stack-safe',
      'bugfix-fast',
      'ui-polish-browser-verify',
    ]))

    const fullStackSafe = templates.find((template) => template.id === 'full-stack-safe')
    expect(fullStackSafe).toMatchObject({
      description: expect.any(String),
      trustMode: 'safe',
      executionTarget: 'isolated',
      modelRoutingPolicy: 'balanced',
    })
  })

  it('marks browser-verification packages explicitly for ui polish template', () => {
    const template = getTaskTemplates().find((item) => item.id === 'ui-polish-browser-verify')
    expect(template?.workPackages.map((item) => ({
      specialist: item.specialist,
      verificationMode: item.verificationMode,
    }))).toEqual([
      { specialist: 'frontend', verificationMode: null },
      { specialist: 'verifier', verificationMode: 'browser' },
      { specialist: 'reviewer', verificationMode: 'browser' },
    ])
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

  it('emits parallel-ready work packages with verifier gated on upstream packages', () => {
    const workPackages = buildTaskWorkPackages('task-1', {
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic', 'verifier'],
      writableScopes: ['src/renderer'],
    })

    expect(workPackages).toHaveLength(3)
    expect(workPackages[0].dependsOn).toEqual([])
    expect(workPackages[1].dependsOn).toEqual([])
    expect(workPackages[2].dependsOn).toEqual([workPackages[0].id, workPackages[1].id])
    expect(workPackages[0].writableScopes).toEqual(['src/renderer'])
  })

  it('propagates browser verification metadata into generated work packages', () => {
    const workPackages = buildTaskWorkPackages('task-ui', {
      objective: 'Polish account settings surface',
      specialists: ['frontend', 'verifier', 'reviewer'],
      writableScopes: ['src/renderer'],
    })

    expect(workPackages).toHaveLength(3)
    expect(workPackages[0].verificationMode ?? null).toBeNull()
    expect(workPackages[1].verificationMode).toBe('browser')
    expect(workPackages[2].verificationMode).toBe('browser')
    expect(workPackages[1].dependsOn).toEqual([workPackages[0].id])
    expect(workPackages[2].dependsOn).toEqual([workPackages[1].id])
  })
})
