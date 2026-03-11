import {
  createEmptyExecutionHeartbeatSnapshot,
  type ExecutionHeartbeatSnapshot,
} from '../types/taskExecution'

function cloneHeartbeat(snapshot?: ExecutionHeartbeatSnapshot | null): ExecutionHeartbeatSnapshot {
  return snapshot ? { ...snapshot } : createEmptyExecutionHeartbeatSnapshot()
}

export function markExecutionHeartbeatStarted(
  snapshot?: ExecutionHeartbeatSnapshot | null,
  timestamp = Date.now(),
): ExecutionHeartbeatSnapshot {
  const base = cloneHeartbeat(snapshot)

  return {
    ...base,
    status: 'active',
    lastHeartbeatAt: timestamp,
    lastProgressAt: base.lastProgressAt ?? timestamp,
    stuckReason: null,
  }
}

export function recordHeartbeatAssistantOutput(
  snapshot?: ExecutionHeartbeatSnapshot | null,
  timestamp = Date.now(),
): ExecutionHeartbeatSnapshot {
  const base = cloneHeartbeat(snapshot)

  return {
    ...base,
    status: 'active',
    lastHeartbeatAt: timestamp,
    lastAssistantOutputAt: timestamp,
    lastProgressAt: timestamp,
    stuckReason: null,
  }
}

export function recordHeartbeatToolActivity(
  snapshot?: ExecutionHeartbeatSnapshot | null,
  timestamp = Date.now(),
): ExecutionHeartbeatSnapshot {
  const base = cloneHeartbeat(snapshot)

  return {
    ...base,
    status: 'active',
    lastHeartbeatAt: timestamp,
    lastToolActivityAt: timestamp,
    stuckReason: null,
  }
}

export function recordHeartbeatFileMutation(
  snapshot?: ExecutionHeartbeatSnapshot | null,
  timestamp = Date.now(),
): ExecutionHeartbeatSnapshot {
  const base = cloneHeartbeat(snapshot)

  return {
    ...base,
    status: 'active',
    lastHeartbeatAt: timestamp,
    lastFileMutationAt: timestamp,
    lastProgressAt: timestamp,
    stuckReason: null,
  }
}

export function stopExecutionHeartbeat(
  snapshot?: ExecutionHeartbeatSnapshot | null,
  timestamp = Date.now(),
): ExecutionHeartbeatSnapshot {
  const base = cloneHeartbeat(snapshot)

  return {
    ...base,
    status: 'idle',
    lastHeartbeatAt: timestamp,
  }
}
