import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentStore } from '@renderer/agent/store/AgentStore'
import {
  ExecutionTaskComposer,
  buildExecutionTaskDraftFromPlan,
  buildExecutionTaskInputFromDraft,
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
    expect(task.sourceWorkspacePath).toBe('/workspace/adnify')
    expect(task.specialists).toEqual(['frontend', 'verifier'])
    expect(task.executionStrategy.orchestrationMode).toBe('mixed')
    expect(task.executionStrategy.ownershipPolicy).toBe('exclusive')
  })

  it('renders objective and orchestration default controls', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskComposer
        draft={{
          objective: 'Implement profile editing',
          specialists: ['frontend', 'logic'],
          trustMode: 'balanced',
          executionTarget: 'isolated',
          executionStrategy: {
            orchestrationMode: 'mixed',
            ownershipPolicy: 'exclusive',
            conflictPolicy: 'queue',
            workspaceIsolation: 'isolated',
            handoffPolicy: 'auto-on-complete',
            proposalReviewPolicy: 'per-work-package',
          },
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
    expect(html).toContain('mixed')
    expect(html).toContain('exclusive')
    expect(html).toContain('queue')
    expect(html).toContain('per-work-package')
    expect(html).toContain('Implement profile editing')
  })
})
