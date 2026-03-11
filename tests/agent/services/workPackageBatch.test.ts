import { describe, expect, it } from 'vitest'

import { __testing as executorTesting } from '@renderer/agent/services/orchestratorExecutor'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

describe('work package batch selection', () => {
  it('returns up to two dependency-ready work packages and leaves blocked verification work for later', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic', 'verifier'],
      writableScopes: ['src/renderer'],
    })

    const batch = executorTesting.getRunnableWorkPackageBatch(taskId, 2)

    expect(batch).toHaveLength(2)
    expect(batch.map((item) => item.specialist)).toEqual(['frontend', 'logic'])
  })

  it('respects sequential execution mode by limiting the batch to one work package', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic', 'verifier'],
      writableScopes: ['src/renderer'],
    })

    const batch = executorTesting.getRunnableWorkPackageBatch(taskId, executorTesting.getWorkPackageBatchLimit({ executionMode: 'sequential' }))

    expect(batch).toHaveLength(1)
    expect(batch[0].specialist).toBe('frontend')
  })

  it('unblocks verifier work after upstream packages are applied', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic', 'verifier'],
      writableScopes: ['src/renderer'],
    })

    const [firstId, secondId] = useAgentStore.getState().executionTasks[taskId].workPackages
    useAgentStore.getState().updateWorkPackage(firstId, { status: 'applied' })
    useAgentStore.getState().updateWorkPackage(secondId, { status: 'applied' })

    const batch = executorTesting.getRunnableWorkPackageBatch(taskId, 2)
    expect(batch).toHaveLength(1)
    expect(batch[0].specialist).toBe('verifier')
  })

  it('uses default concurrency of two in parallel mode', () => {
    expect(executorTesting.getWorkPackageBatchLimit({ executionMode: 'parallel' })).toBe(2)
  })
})
