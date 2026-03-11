import { api } from '@/renderer/services/electronAPI'

import { useAgentStore } from '../store/AgentStore'
import { shouldUseIsolatedWorkspace } from '../types/trustPolicy'
import type { ExecutionTask } from '../types/taskExecution'
import { syncTaskRecoveryCheckpoint } from './executionRecoveryService'

export interface PreparedExecutionWorkspace {
  success: boolean
  workspacePath: string
  target: 'current' | 'isolated'
  mode?: 'worktree' | 'copy'
  error?: string
}

function getTaskOrThrow(taskId: string): ExecutionTask {
  const task = useAgentStore.getState().executionTasks[taskId]
  if (!task) {
    throw new Error(`Execution task not found: ${taskId}`)
  }
  return task
}

export function getEffectiveExecutionTarget(task: ExecutionTask): 'current' | 'isolated' {
  if (task.executionTarget === 'current' || task.executionTarget === 'isolated') {
    return task.executionTarget
  }

  return shouldUseIsolatedWorkspace({
    risk: task.risk,
    fileCount: task.workPackages.length,
  }) ? 'isolated' : 'current'
}

export async function prepareTaskExecutionWorkspace(
  taskId: string,
  fallbackWorkspacePath: string,
  ownerId?: string,
): Promise<PreparedExecutionWorkspace> {
  const store = useAgentStore.getState()
  const task = getTaskOrThrow(taskId)
  const workPackage = ownerId ? store.workPackages[ownerId] : null

  if (ownerId && workPackage?.workspaceId) {
    const workspaceStillExists = await api.file.exists(workPackage.workspaceId)

    if (workspaceStillExists) {
      return {
        success: true,
        workspacePath: workPackage.workspaceId,
        target: workPackage.workspaceOwnerId ? 'isolated' : 'current',
        mode: workPackage.workspaceOwnerId ? (task.isolationMode ?? undefined) : undefined,
      }
    }

    store.updateWorkPackage(ownerId, {
      workspaceId: null,
      workspaceOwnerId: null,
    })
    syncTaskRecoveryCheckpoint(taskId, {
      status: task.recoveryCheckpoint?.status === 'recovering' ? 'recovering' : 'ready',
    })
  }

  if (!ownerId && task.resolvedWorkspacePath && task.isolationStatus === 'ready') {
    const workspaceStillExists = await api.file.exists(task.resolvedWorkspacePath)

    if (workspaceStillExists) {
      return {
        success: true,
        workspacePath: task.resolvedWorkspacePath,
        target: task.isolationMode ? 'isolated' : 'current',
        mode: task.isolationMode ?? undefined,
      }
    }

    store.updateExecutionTask(taskId, {
      resolvedWorkspacePath: null,
      isolationStatus: 'pending',
      isolationError: null,
    })
    syncTaskRecoveryCheckpoint(taskId, {
      status: task.recoveryCheckpoint?.status === 'recovering' ? 'recovering' : 'ready',
    })
  }

  const sourceWorkspacePath = task.sourceWorkspacePath || fallbackWorkspacePath
  const target = getEffectiveExecutionTarget(task)

  if (target === 'current') {
    store.updateExecutionTask(taskId, {
      sourceWorkspacePath,
      resolvedWorkspacePath: sourceWorkspacePath,
      isolationMode: null,
      isolationStatus: 'ready',
      isolationError: null,
    })

    return {
      success: true,
      workspacePath: sourceWorkspacePath,
      target,
    }
  }

  store.updateExecutionTask(taskId, {
    sourceWorkspacePath,
    resolvedWorkspacePath: ownerId ? task.resolvedWorkspacePath : null,
    isolationMode: ownerId ? task.isolationMode : null,
    isolationStatus: 'preparing',
    isolationError: null,
  })

  const result = await api.workspace.createIsolated({
    taskId,
    workspacePath: sourceWorkspacePath,
    ownerId,
  })

  if (!result.success || !result.workspacePath) {
    const error = result.error || 'Failed to create isolated workspace'
    store.updateExecutionTask(taskId, {
      sourceWorkspacePath,
      resolvedWorkspacePath: ownerId ? task.resolvedWorkspacePath : null,
      isolationMode: ownerId ? task.isolationMode : null,
      isolationStatus: 'failed',
      isolationError: error,
    })

    return {
      success: false,
      workspacePath: sourceWorkspacePath,
      target,
      error,
    }
  }

  store.updateExecutionTask(taskId, {
    sourceWorkspacePath,
    resolvedWorkspacePath: ownerId ? task.resolvedWorkspacePath : result.workspacePath,
    isolationMode: result.mode ?? task.isolationMode ?? null,
    isolationStatus: 'ready',
    isolationError: null,
  })

  return {
    success: true,
    workspacePath: result.workspacePath,
    target,
    mode: result.mode ?? undefined,
  }
}

export async function cleanupTaskExecutionWorkspace(taskId: string, ownerId?: string): Promise<void> {
  const store = useAgentStore.getState()
  const task = store.executionTasks[taskId]
  if (!task) return

  if (ownerId) {
    const workPackage = store.workPackages[ownerId]
    if (!workPackage?.workspaceOwnerId || !workPackage.workspaceId) return

    const result = await api.workspace.disposeIsolated(workPackage.workspaceOwnerId)
    if (result.success) {
      store.updateWorkPackage(ownerId, {
        workspaceId: null,
        workspaceOwnerId: null,
      })
    }
    return
  }

  for (const workPackageId of task.workPackages) {
    const workPackage = store.workPackages[workPackageId]
    if (workPackage?.workspaceOwnerId && workPackage.workspaceId) {
      await cleanupTaskExecutionWorkspace(taskId, workPackageId)
    }
  }

  const shouldDisposeTaskWorkspace = Boolean(task.isolationMode && task.resolvedWorkspacePath && task.isolationStatus !== 'disposed')
  if (shouldDisposeTaskWorkspace) {
    const result = await api.workspace.disposeIsolated(taskId)
    store.updateExecutionTask(taskId, {
      resolvedWorkspacePath: result.success ? null : task.resolvedWorkspacePath,
      isolationStatus: result.success ? 'disposed' : task.isolationStatus,
      isolationError: result.success ? null : (result.error || 'Failed to dispose isolated workspace'),
    })
    return
  }

  if (task.isolationMode && task.isolationStatus !== 'disposed') {
    store.updateExecutionTask(taskId, {
      isolationStatus: 'disposed',
      isolationError: null,
    })
  }
}
