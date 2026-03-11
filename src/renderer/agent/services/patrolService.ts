import {
  createEmptyExecutionHeartbeatSnapshot,
  createInitialPatrolState,
  type ExecutionHeartbeatSnapshot,
  type PatrolState,
} from '../types/taskExecution'
import { shouldEscalatePatrolState } from './circuitBreakerService'

export interface PatrolThresholds {
  silentMs: number
  suspectedStuckMs: number
  abandonedMs: number
}

export interface PatrolEvaluationResult {
  heartbeat: ExecutionHeartbeatSnapshot
  patrol: PatrolState
  escalation: {
    trip: boolean
    reason?: string
  }
}

export const DEFAULT_PATROL_THRESHOLDS: PatrolThresholds = {
  silentMs: 30_000,
  suspectedStuckMs: 120_000,
  abandonedMs: 300_000,
}

function mergeThresholds(thresholds?: Partial<PatrolThresholds>): PatrolThresholds {
  return {
    ...DEFAULT_PATROL_THRESHOLDS,
    ...(thresholds || {}),
  }
}

function cloneHeartbeat(snapshot?: ExecutionHeartbeatSnapshot | null): ExecutionHeartbeatSnapshot {
  return snapshot ? { ...snapshot } : createEmptyExecutionHeartbeatSnapshot()
}

function clonePatrol(snapshot?: PatrolState | null): PatrolState {
  return snapshot ? { ...snapshot } : createInitialPatrolState()
}

function maxTimestamp(...values: Array<number | null | undefined>): number | null {
  const numericValues = values.filter((value): value is number => typeof value === 'number')
  return numericValues.length > 0 ? Math.max(...numericValues) : null
}

function formatElapsedMs(durationMs: number): string {
  const seconds = Math.max(1, Math.round(durationMs / 1000))
  return `${seconds}s`
}

export function evaluateExecutionPatrol(input: {
  heartbeat?: ExecutionHeartbeatSnapshot | null
  patrol?: PatrolState | null
  now?: number
  thresholds?: Partial<PatrolThresholds>
}): PatrolEvaluationResult {
  const now = input.now ?? Date.now()
  const thresholds = mergeThresholds(input.thresholds)
  const heartbeat = cloneHeartbeat(input.heartbeat)
  const patrol = clonePatrol(input.patrol)

  if (heartbeat.status === 'idle') {
    return {
      heartbeat: {
        ...heartbeat,
        stuckReason: null,
      },
      patrol: {
        ...patrol,
        status: 'idle',
        lastCheckedAt: now,
        lastTransitionAt: patrol.status === 'idle' ? patrol.lastTransitionAt : now,
        reason: null,
      },
      escalation: { trip: false },
    }
  }

  const lastHeartbeatAt = maxTimestamp(
    heartbeat.lastHeartbeatAt,
    heartbeat.lastToolActivityAt,
    heartbeat.lastAssistantOutputAt,
    heartbeat.lastFileMutationAt,
  )
  const lastProgressAt = maxTimestamp(
    heartbeat.lastProgressAt,
    heartbeat.lastAssistantOutputAt,
    heartbeat.lastFileMutationAt,
  )

  const heartbeatAge = lastHeartbeatAt == null ? Number.POSITIVE_INFINITY : Math.max(0, now - lastHeartbeatAt)
  const progressAge = lastProgressAt == null ? heartbeatAge : Math.max(0, now - lastProgressAt)

  let nextPatrolStatus: PatrolState['status'] = 'active'
  let reason: string | null = null

  if (heartbeatAge >= thresholds.abandonedMs) {
    nextPatrolStatus = 'abandoned'
    reason = `Execution heartbeat missing for ${formatElapsedMs(heartbeatAge)}.`
  } else if (progressAge >= thresholds.suspectedStuckMs) {
    nextPatrolStatus = 'suspected-stuck'
    reason = `No task progress for ${formatElapsedMs(progressAge)}.`
  } else if (progressAge >= thresholds.silentMs) {
    nextPatrolStatus = 'silent-but-healthy'
    reason = `No recent task progress for ${formatElapsedMs(progressAge)}, but heartbeat is still active.`
  }

  const nextHeartbeatStatus: ExecutionHeartbeatSnapshot['status'] = nextPatrolStatus === 'silent-but-healthy'
    ? 'silent'
    : nextPatrolStatus

  const escalation = shouldEscalatePatrolState({
    previousStatus: patrol.status,
    nextStatus: nextPatrolStatus,
    reason,
  })

  return {
    heartbeat: {
      ...heartbeat,
      status: nextHeartbeatStatus,
      stuckReason: nextPatrolStatus === 'suspected-stuck' || nextPatrolStatus === 'abandoned' ? reason : null,
    },
    patrol: {
      ...patrol,
      status: nextPatrolStatus,
      lastCheckedAt: now,
      lastTransitionAt: patrol.status === nextPatrolStatus ? patrol.lastTransitionAt : now,
      reason,
    },
    escalation,
  }
}
