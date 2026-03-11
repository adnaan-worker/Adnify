import { describe, expect, it } from 'vitest'

import {
  markExecutionHeartbeatStarted,
  recordHeartbeatAssistantOutput,
  recordHeartbeatFileMutation,
  recordHeartbeatToolActivity,
  stopExecutionHeartbeat,
} from '@renderer/agent/services/executionHeartbeatService'
import { createEmptyExecutionHeartbeatSnapshot } from '@renderer/agent/types/taskExecution'

describe('execution heartbeat service', () => {
  it('marks assistant output as forward progress', () => {
    const started = markExecutionHeartbeatStarted(createEmptyExecutionHeartbeatSnapshot(), 100)
    const updated = recordHeartbeatAssistantOutput(started, 220)

    expect(updated.status).toBe('active')
    expect(updated.lastHeartbeatAt).toBe(220)
    expect(updated.lastAssistantOutputAt).toBe(220)
    expect(updated.lastProgressAt).toBe(220)
    expect(updated.stuckReason).toBeNull()
  })

  it('tracks tool and file activity independently', () => {
    const started = markExecutionHeartbeatStarted(createEmptyExecutionHeartbeatSnapshot(), 50)
    const withTool = recordHeartbeatToolActivity(started, 120)
    const withFileMutation = recordHeartbeatFileMutation(withTool, 180)

    expect(withTool.lastToolActivityAt).toBe(120)
    expect(withTool.lastProgressAt).toBe(50)
    expect(withFileMutation.lastFileMutationAt).toBe(180)
    expect(withFileMutation.lastProgressAt).toBe(180)
  })

  it('returns to idle on stop while keeping the latest timestamps', () => {
    const started = markExecutionHeartbeatStarted(createEmptyExecutionHeartbeatSnapshot(), 10)
    const progressed = recordHeartbeatAssistantOutput(started, 30)
    const stopped = stopExecutionHeartbeat(progressed, 60)

    expect(stopped.status).toBe('idle')
    expect(stopped.lastHeartbeatAt).toBe(60)
    expect(stopped.lastAssistantOutputAt).toBe(30)
    expect(stopped.lastProgressAt).toBe(30)
  })
})
