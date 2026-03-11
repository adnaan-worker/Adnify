import { useAgentStore } from '../store/AgentStore'
import {
  createInitialRecoveryCheckpoint,
  type RecoveryCheckpoint,
  type WorkPackage,
  type WorkPackageStatus,
} from '../types/taskExecution'
import { stopExecutionHeartbeat } from './executionHeartbeatService'

const SAFE_WORK_PACKAGE_STATUSES = new Set<WorkPackageStatus>(['applied', 'reassigned'])
const RESUMABLE_WORK_PACKAGE_STATUSES = new Set<WorkPackageStatus>([
  'queued',
  'leasing',
  'running',
  'executing',
  'blocked',
  'verifying',
  'waiting-approval',
])

function getTaskWorkPackages(taskId: string): WorkPackage[] {
  const store = useAgentStore.getState()
  const task = store.executionTasks[taskId]
  if (!task) return []

  return task.workPackages
    .map((workPackageId) => store.workPackages[workPackageId])
    .filter((workPackage): workPackage is WorkPackage => Boolean(workPackage))
}

function getLastSafeWorkPackageId(taskId: string): string | null {
  const workPackages = getTaskWorkPackages(taskId)
  for (let index = workPackages.length - 1; index >= 0; index -= 1) {
    if (SAFE_WORK_PACKAGE_STATUSES.has(workPackages[index].status)) {
      return workPackages[index].id
    }
  }
  return null
}

function getResumeCandidateWorkPackageIds(taskId: string): string[] {
  return getTaskWorkPackages(taskId)
    .filter((workPackage) => RESUMABLE_WORK_PACKAGE_STATUSES.has(workPackage.status))
    .map((workPackage) => workPackage.id)
}

function buildRecoveryCheckpoint(taskId: string, input?: {
  status?: RecoveryCheckpoint['status']
  updatedAt?: number
}): RecoveryCheckpoint | null {
  const store = useAgentStore.getState()
  const task = store.executionTasks[taskId]
  if (!task) return null

  const resumeCandidateWorkPackageIds = getResumeCandidateWorkPackageIds(taskId)
  const lastSafeWorkPackageId = getLastSafeWorkPackageId(taskId)
  const updatedAt = input?.updatedAt ?? Date.now()
  const base = task.recoveryCheckpoint || createInitialRecoveryCheckpoint()

  return {
    ...base,
    status: input?.status ?? (resumeCandidateWorkPackageIds.length > 0 ? 'ready' : 'idle'),
    lastSafeWorkPackageId,
    lastProposalId: task.latestProposalId,
    lastHandoffId: task.latestHandoffId,
    resumeCandidateWorkPackageIds,
    updatedAt,
  }
}

export function syncTaskRecoveryCheckpoint(taskId: string, input?: {
  status?: RecoveryCheckpoint['status']
  updatedAt?: number
}): RecoveryCheckpoint | null {
  const store = useAgentStore.getState()
  const task = store.executionTasks[taskId]
  if (!task) return null

  const checkpoint = buildRecoveryCheckpoint(taskId, input)
  if (!checkpoint) return null

  store.updateExecutionTask(taskId, {
    recoveryCheckpoint: checkpoint,
  })

  getTaskWorkPackages(taskId).forEach((workPackage) => {
    store.updateWorkPackage(workPackage.id, {
      recoveryCheckpoint: {
        ...(workPackage.recoveryCheckpoint || createInitialRecoveryCheckpoint()),
        status: checkpoint.status === 'recovering' && checkpoint.resumeCandidateWorkPackageIds.includes(workPackage.id)
          ? 'recovering'
          : checkpoint.status === 'idle'
            ? 'idle'
            : 'ready',
        lastSafeWorkPackageId: checkpoint.lastSafeWorkPackageId,
        lastProposalId: checkpoint.lastProposalId,
        lastHandoffId: checkpoint.lastHandoffId,
        resumeCandidateWorkPackageIds: checkpoint.resumeCandidateWorkPackageIds.includes(workPackage.id)
          ? [workPackage.id]
          : [],
        updatedAt: checkpoint.updatedAt,
      },
    })
  })

  return checkpoint
}

export function restoreExecutionTaskFromRecovery(taskId: string): {
  resumedWorkPackageIds: string[]
  checkpoint: RecoveryCheckpoint | null
} | null {
  const store = useAgentStore.getState()
  const task = store.executionTasks[taskId]
  if (!task) return null

  const now = Date.now()
  const checkpoint = syncTaskRecoveryCheckpoint(taskId, {
    status: 'recovering',
    updatedAt: now,
  })

  if (!checkpoint) {
    return null
  }

  checkpoint.resumeCandidateWorkPackageIds.forEach((workPackageId) => {
    const workPackage = useAgentStore.getState().workPackages[workPackageId]
    if (!workPackage) return

    store.updateWorkPackage(workPackageId, {
      status: 'queued',
      queueReason: null,
      heartbeat: stopExecutionHeartbeat(workPackage.heartbeat, now),
      recoveryCheckpoint: {
        ...(workPackage.recoveryCheckpoint || createInitialRecoveryCheckpoint()),
        status: 'recovering',
        lastSafeWorkPackageId: checkpoint.lastSafeWorkPackageId,
        lastProposalId: checkpoint.lastProposalId,
        lastHandoffId: checkpoint.lastHandoffId,
        resumeCandidateWorkPackageIds: [workPackageId],
        updatedAt: now,
      },
    })
  })

  const nextCheckpoint: RecoveryCheckpoint = {
    ...checkpoint,
    status: checkpoint.resumeCandidateWorkPackageIds.length > 0 ? 'recovering' : 'idle',
    updatedAt: now,
  }

  store.updateExecutionTask(taskId, {
    state: 'planning',
    heartbeat: stopExecutionHeartbeat(task.heartbeat, now),
    recoveryCheckpoint: nextCheckpoint,
  })

  return {
    resumedWorkPackageIds: checkpoint.resumeCandidateWorkPackageIds,
    checkpoint: nextCheckpoint,
  }
}
