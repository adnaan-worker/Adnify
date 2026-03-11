import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '@store'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { createEmptySpecialistProfileSnapshot } from '@renderer/agent/types/taskExecution'
import { __testing } from '@renderer/agent/services/orchestratorExecutor'

describe('orchestrator executor governance', () => {
  beforeEach(() => {
    useAgentStore.setState({
      executionTasks: {},
      workPackages: {},
      taskHandoffs: {},
      adjudicationCases: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
    })
    useStore.setState((state) => ({
      taskTrustSettings: state.taskTrustSettings,
    }))
  })

  it('creates adjudication when budget usage trips a task', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Trip budget',
      specialists: ['logic'],
    })

    __testing.applyTaskGovernanceForAttempt({
      taskId,
      durationMs: 100,
      llmCalls: 0,
      estimatedTokens: 0,
      verifications: 0,
      commands: useAgentStore.getState().executionTasks[taskId].budget.limits.commands + 1,
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.state).toBe('tripped')
    expect(task.latestAdjudicationId).toBeTruthy()
  })

  it('proposes rollback after a failed attempt', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Rollback after failure',
      specialists: ['logic'],
      executionTarget: 'current',
    })

    __testing.applyTaskGovernanceForAttempt({
      taskId,
      durationMs: 100,
      llmCalls: 1,
      estimatedTokens: 100,
      verifications: 0,
      changedFiles: ['src/renderer/App.tsx'],
      failureReason: 'verification failed',
      externalSideEffects: ['npm install'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.rollback.status).toBe('ready')
    expect(task.rollback.proposal?.externalSideEffects).toEqual(['npm install'])
  })

  it('resolves specialist execution guidance from task snapshots', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Build onboarding UI',
      specialists: ['frontend', 'reviewer'],
    })

    useAgentStore.getState().updateExecutionTask(taskId, {
      specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['frontend', 'reviewer'], {
        frontend: {
          model: 'gpt-4.1',
          toolPermission: 'workspace-write',
          networkPermission: 'workspace-only',
          gitPermission: 'task-branch',
          writableScopes: ['src/renderer'],
          styleHints: 'Prefer polished UI',
        },
        reviewer: {
          model: 'gpt-4.1-mini',
          toolPermission: 'read-mostly',
          writableScopes: ['src/renderer'],
          styleHints: 'Prefer risk review',
        },
      }),
    })

    const executionTask = useAgentStore.getState().executionTasks[taskId]
    const profile = __testing.resolveExecutionAttemptProfile(executionTask, 'frontend')
    const guidance = __testing.buildExecutionAttemptGuidance(profile)

    expect(profile?.model).toBe('gpt-4.1')
    expect(guidance).toContain('Prefer polished UI')
    expect(guidance).toContain('Writable scopes: src/renderer')
    expect(guidance).toContain('Tool permission: workspace-write')
  })
})
