import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import { getTaskTemplates } from '@renderer/agent/services/taskTemplateService'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import {
  ExecutionTaskComposer,
  applyTaskTemplateToDraft,
  buildExecutionTaskDraftFromPlan,
  buildExecutionTaskInputFromDraft,
  getExecutionTaskTemplateOptions,
} from '@renderer/components/orchestrator/ExecutionTaskComposer'

describe('ExecutionTaskComposer', () => {
  beforeEach(() => {
    useAgentStore.setState({
      executionTasks: {},
      workPackages: {},
      taskHandoffs: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
    })
  })

  it('builds a task draft from plan context and approved orchestration defaults', () => {
    const draft = buildExecutionTaskDraftFromPlan(
      {
        id: 'plan-1',
        name: 'Ship profile flow',
        userRequest: 'Implement profile editing',
        tasks: [],
      },
      '/workspace/adnify',
      {
        mode: 'balanced',
        defaultExecutionTarget: 'auto',
      },
    )

    expect(draft.objective).toBe('Implement profile editing')
    expect(draft.sourceWorkspacePath).toBe('/workspace/adnify')
    expect(draft.trustMode).toBe('balanced')
    expect(draft.executionTarget).toBe('isolated')
    expect(draft.modelRoutingPolicy).toBe('balanced')
    expect(draft.executionStrategy.orchestrationMode).toBe('mixed')
    expect(draft.executionStrategy.ownershipPolicy).toBe('exclusive')
    expect(draft.executionStrategy.conflictPolicy).toBe('queue')
    expect(draft.executionStrategy.proposalReviewPolicy).toBe('per-work-package')
  })

  it('creates execution-task input with chosen trust mode and orchestration strategy', () => {
    const draft = buildExecutionTaskDraftFromPlan(
      {
        id: 'plan-1',
        name: 'Ship profile flow',
        userRequest: 'Implement profile editing',
        tasks: [],
      },
      '/workspace/adnify',
      {
        mode: 'balanced',
        defaultExecutionTarget: 'auto',
      },
    )

    const taskId = useAgentStore.getState().createExecutionTask(
      buildExecutionTaskInputFromDraft({
        ...draft,
        trustMode: 'safe',
        executionTarget: 'current',
        specialists: ['frontend', 'verifier'],
      }),
    )

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.trustMode).toBe('safe')
    expect(task.executionTarget).toBe('current')
    expect(task.modelRoutingPolicy).toBe('balanced')
    expect(task.sourceWorkspacePath).toBe('/workspace/adnify')
    expect(task.specialists).toEqual(['frontend', 'verifier'])
    expect(task.executionStrategy.orchestrationMode).toBe('mixed')
    expect(task.executionStrategy.ownershipPolicy).toBe('exclusive')
  })
  it('supports autonomous execution mode in the composer draft and created task', () => {
    const draft = buildExecutionTaskDraftFromPlan(
      {
        id: 'plan-1',
        name: 'Ship profile flow',
        userRequest: 'Implement profile editing',
        tasks: [],
      },
      '/workspace/adnify',
      {
        mode: 'autonomous',
        defaultExecutionTarget: 'auto',
      },
    )

    const taskId = useAgentStore.getState().createExecutionTask(
      buildExecutionTaskInputFromDraft({
        ...draft,
        autonomyMode: 'autonomous',
      }),
    )

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(draft.autonomyMode).toBe('autonomous')
    expect(task.autonomyMode).toBe('autonomous')
  })


  it('derives composer template options from the shared template registry', () => {
    const templateOptions = getExecutionTaskTemplateOptions()
    expect(templateOptions[0]).toMatchObject({ id: 'auto', label: 'Auto' })
    expect(templateOptions.slice(1).map((item) => item.id)).toEqual(getTaskTemplates().map((item) => item.id))
  })

  it('applies template metadata into the draft when a rich template is selected', () => {
    const draft = buildExecutionTaskDraftFromPlan(
      {
        id: 'plan-1',
        name: 'Harden full-stack flow',
        userRequest: 'Harden full-stack flow',
        tasks: [],
      },
      '/workspace/adnify',
      {
        mode: 'balanced',
        defaultExecutionTarget: 'auto',
        modelRoutingPolicy: 'balanced',
      },
    )

    const nextDraft = applyTaskTemplateToDraft(draft, 'full-stack-safe')
    expect(nextDraft.specialists).toEqual(['frontend', 'logic', 'verifier', 'reviewer'])
    expect(nextDraft.trustMode).toBe('safe')
    expect(nextDraft.executionTarget).toBe('isolated')
    expect(nextDraft.modelRoutingPolicy).toBe('balanced')
  })

  it('renders objective and template controls from the shared registry', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskComposer
        draft={{
          objective: 'Implement profile editing',
          specialists: ['frontend', 'logic'],
          trustMode: 'balanced',
          executionTarget: 'isolated',
          modelRoutingPolicy: 'balanced',
          executionStrategy: {
            orchestrationMode: 'mixed',
            ownershipPolicy: 'exclusive',
            conflictPolicy: 'queue',
            workspaceIsolation: 'isolated',
            handoffPolicy: 'auto-on-complete',
            proposalReviewPolicy: 'per-work-package',
          },
          autonomyMode: 'manual',
          sourceWorkspacePath: '/workspace/adnify',
        }}
        onDraftChange={() => undefined}
        onCreate={() => undefined}
      />,
    )

    expect(html).toContain('准备执行')
    expect(html).toContain('Trust Mode')
    expect(html).toContain('Execution Target')
    expect(html).toContain('Execution Strategy')
    expect(html).toContain('Execution Mode')
    expect(html).toContain('UI Polish + Browser Verify')
    expect(html).toContain('balanced')
    expect(html).toContain('mixed')
    expect(html).toContain('exclusive')
    expect(html).toContain('queue')
    expect(html).toContain('per-work-package')
    expect(html).toContain('manual')
    expect(html).toContain('autonomous')
    expect(html).toContain('Implement profile editing')
  })
})
