import { api } from '@/renderer/services/electronAPI'

import { useAgentStore } from '../store/AgentStore'
import { shouldUseIsolatedWorkspace } from '../types/trustPolicy'
import type { ExecutionTask } from '../types/taskExecution'

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

export async function prepareTaskExecutionWorkspace(taskId: string, fallbackWorkspacePath: string): Promise<PreparedExecutionWorkspace> {
  const store = useAgentStore.getState()
  const task = getTaskOrThrow(taskId)

  if (task.resolvedWorkspacePath && task.isolationStatus === 'ready') {
    return {
      success: true,
      workspacePath: task.resolvedWorkspacePath,
      target: task.isolationMode ? 'isolated' : 'current',
      mode: task.isolationMode ?? undefined,
    }
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
    resolvedWorkspacePath: null,
    isolationMode: null,
    isolationStatus: 'preparing',
    isolationError: null,
  })

  const result = await api.workspace.createIsolated({
    taskId,
    workspacePath: sourceWorkspacePath,
  })

  if (!result.success || !result.workspacePath) {
    const error = result.error || 'Failed to create isolated workspace'
    store.updateExecutionTask(taskId, {
      sourceWorkspacePath,
      resolvedWorkspacePath: null,
      isolationMode: null,
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
    resolvedWorkspacePath: result.workspacePath,
    isolationMode: result.mode ?? null,
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

export async function cleanupTaskExecutionWorkspace(taskId: string): Promise<void> {
  const store = useAgentStore.getState()
  const task = store.executionTasks[taskId]
  if (!task) return

  const shouldDispose = Boolean(task.isolationMode && task.resolvedWorkspacePath && task.isolationStatus !== 'disposed')
  if (!shouldDispose) return

  const result = await api.workspace.disposeIsolated(taskId)
  store.updateExecutionTask(taskId, {
    resolvedWorkspacePath: result.success ? null : task.resolvedWorkspacePath,
    isolationStatus: result.success ? 'disposed' : task.isolationStatus,
    isolationError: result.success ? null : (result.error || 'Failed to dispose isolated workspace'),
  })
}
