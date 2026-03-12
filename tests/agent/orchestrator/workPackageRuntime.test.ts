import { describe, expect, it } from 'vitest'

import { buildWorkPackageRuntimeActivity } from '@renderer/components/orchestrator/workPackageRuntime'
import type { ChatThread } from '@renderer/agent/types'
import { createEmptyExecutionHeartbeatSnapshot } from '@renderer/agent/types/taskExecution'

function createThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    id: 'thread-1',
    createdAt: 1,
    lastModified: 1,
    messages: [],
    contextItems: [],
    streamState: { phase: 'idle' },
    compressionStats: null,
    contextSummary: null,
    handoffRequired: false,
    isCompacting: false,
    compressionPhase: 'idle',
    ...overrides,
  }
}

describe('work package runtime activity', () => {
  it('prefers suspected-stuck status over an idle thread phase', () => {
    const activity = buildWorkPackageRuntimeActivity(
      {
        id: 'pkg-1',
        taskId: 'task-1',
        title: 'Recover stalled execution',
        objective: 'Recover stalled execution',
        specialist: 'logic',
        status: 'blocked',
        targetDomain: 'logic',
        writableScopes: ['src'],
        readableScopes: ['src'],
        dependsOn: [],
        expectedArtifacts: ['diagnostic'],
        queueReason: null,
        workspaceId: null,
        handoffId: null,
        proposalId: null,
        threadId: 'thread-1',
        heartbeat: {
          ...createEmptyExecutionHeartbeatSnapshot(),
          status: 'suspected-stuck',
          lastHeartbeatAt: 100,
          lastToolActivityAt: 100,
          lastProgressAt: 0,
          stuckReason: 'No task progress for 120s.',
        },
      },
      createThread(),
    )

    expect(activity?.phaseLabel).toBe('疑似卡住')
    expect(activity?.stuckReason).toBe('No task progress for 120s.')
  })
})
