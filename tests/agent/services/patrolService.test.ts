import { describe, expect, it } from 'vitest'

import {
  evaluateExecutionPatrol,
  type PatrolThresholds,
} from '@renderer/agent/services/patrolService'
import {
  createEmptyExecutionHeartbeatSnapshot,
  createInitialPatrolState,
} from '@renderer/agent/types/taskExecution'

const now = 100_000
const thresholds: PatrolThresholds = {
  silentMs: 5_000,
  suspectedStuckMs: 15_000,
  abandonedMs: 30_000,
}

function createHeartbeat(overrides: Partial<ReturnType<typeof createEmptyExecutionHeartbeatSnapshot>> = {}) {
  return {
    ...createEmptyExecutionHeartbeatSnapshot(),
    status: 'active' as const,
    lastHeartbeatAt: now - 1_000,
    lastProgressAt: now - 1_000,
    ...overrides,
  }
}

describe('patrol service', () => {
  it('classifies active executions with recent progress', () => {
    const result = evaluateExecutionPatrol({
      heartbeat: createHeartbeat(),
      patrol: createInitialPatrolState(),
      now,
      thresholds,
    })

    expect(result.patrol.status).toBe('active')
    expect(result.heartbeat.status).toBe('active')
    expect(result.escalation.trip).toBe(false)
  })

  it('classifies silent-but-healthy when heartbeat is fresh but progress is quiet', () => {
    const result = evaluateExecutionPatrol({
      heartbeat: createHeartbeat({
        lastHeartbeatAt: now - 1_000,
        lastToolActivityAt: now - 1_000,
        lastProgressAt: now - 7_000,
      }),
      patrol: createInitialPatrolState(),
      now,
      thresholds,
    })

    expect(result.patrol.status).toBe('silent-but-healthy')
    expect(result.heartbeat.status).toBe('silent')
    expect(result.escalation.trip).toBe(false)
  })

  it('classifies suspected-stuck and escalates on first transition', () => {
    const result = evaluateExecutionPatrol({
      heartbeat: createHeartbeat({
        lastHeartbeatAt: now - 16_000,
        lastProgressAt: now - 16_000,
      }),
      patrol: {
        ...createInitialPatrolState(),
        status: 'active',
      },
      now,
      thresholds,
    })

    expect(result.patrol.status).toBe('suspected-stuck')
    expect(result.heartbeat.status).toBe('suspected-stuck')
    expect(result.patrol.reason).toMatch(/progress/i)
    expect(result.escalation.trip).toBe(true)
  })

  it('classifies abandoned when heartbeats disappear for too long', () => {
    const result = evaluateExecutionPatrol({
      heartbeat: createHeartbeat({
        lastHeartbeatAt: now - 31_000,
        lastProgressAt: now - 31_000,
      }),
      patrol: {
        ...createInitialPatrolState(),
        status: 'silent-but-healthy',
      },
      now,
      thresholds,
    })

    expect(result.patrol.status).toBe('abandoned')
    expect(result.heartbeat.status).toBe('abandoned')
    expect(result.patrol.reason).toMatch(/heartbeat/i)
    expect(result.escalation.trip).toBe(true)
  })
})
