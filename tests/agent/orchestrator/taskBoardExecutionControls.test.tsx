import { describe, expect, it } from 'vitest'

import { shouldShowStopExecutionAction } from '@renderer/components/orchestrator/TaskBoard'

describe('TaskBoard execution controls', () => {
  it('shows a restart action when the active task is blocked even if the global execution flag is stale', () => {
    const showStop = shouldShowStopExecutionAction({
      isExecuting: true,
      isStopping: false,
      controllerState: 'paused',
      activeTaskState: 'blocked',
      workPackageStatuses: ['blocked'],
    })

    expect(showStop).toBe(false)
  })
})
