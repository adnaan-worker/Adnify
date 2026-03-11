import { execFile } from 'child_process'
import { promises as fsPromises } from 'fs'
import { ipcMain } from 'electron'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

import { logger } from '@shared/utils/Logger'

const execFileAsync = promisify(execFile)
const ISOLATED_WORKSPACE_ROOT = path.join(os.tmpdir(), 'adnify-task-workspaces')

export type IsolationMode = 'worktree' | 'copy'

export interface IsolationChoiceInput {
  hasGit: boolean
  hasUncommittedChanges: boolean
}

export interface IsolationPreviewResult extends IsolationChoiceInput {
  mode: IsolationMode
}

export interface CreateIsolatedWorkspaceRequest {
  taskId: string
  workspacePath: string
  preferredMode?: IsolationMode
}

export interface IsolatedWorkspaceResult {
  success: boolean
  mode?: IsolationMode
  workspacePath?: string
  error?: string
}

export interface IsolatedWorkspaceCleanupSummary {
  success: boolean
  cleaned: number
  failed: number
}

interface IsolatedWorkspaceRecord {
  taskId: string
  sourcePath: string
  workspacePath: string
  mode: IsolationMode
}

const isolatedWorkspaceRegistry = new Map<string, IsolatedWorkspaceRecord>()

export function chooseIsolationMode(input: IsolationChoiceInput): IsolationMode {
  return input.hasGit ? 'worktree' : 'copy'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-') || 'task'
}

async function ensureIsolationRoot(): Promise<string> {
  await fsPromises.mkdir(ISOLATED_WORKSPACE_ROOT, { recursive: true })
  return ISOLATED_WORKSPACE_ROOT
}

async function runGit(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    const { stdout = '', stderr = '' } = await execFileAsync('git', args, { cwd })
    return { ok: true, stdout, stderr }
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      error: formatError(error),
    }
  }
}

async function createTargetPath(taskId: string): Promise<string> {
  const root = await ensureIsolationRoot()
  return path.join(root, `${sanitizeTaskId(taskId)}-${Date.now()}`)
}

export async function previewIsolationChoice(workspacePath: string): Promise<IsolationPreviewResult> {
  const gitCheck = await runGit(['rev-parse', '--is-inside-work-tree'], workspacePath)
  const hasGit = gitCheck.ok && gitCheck.stdout.trim() === 'true'

  let hasUncommittedChanges = false
  if (hasGit) {
    const statusCheck = await runGit(['status', '--porcelain'], workspacePath)
    hasUncommittedChanges = statusCheck.ok && statusCheck.stdout.trim().length > 0
  }

  return {
    hasGit,
    hasUncommittedChanges,
    mode: chooseIsolationMode({ hasGit, hasUncommittedChanges }),
  }
}

export async function createIsolatedWorkspace(
  request: CreateIsolatedWorkspaceRequest
): Promise<IsolatedWorkspaceResult> {
  const preview = await previewIsolationChoice(request.workspacePath)
  let mode = request.preferredMode ?? preview.mode
  const targetPath = await createTargetPath(request.taskId)

  try {
    if (mode === 'worktree') {
      const worktreeResult = await runGit(['worktree', 'add', '--detach', targetPath, 'HEAD'], request.workspacePath)
      if (!worktreeResult.ok) {
        logger.security.warn('[IsolatedWorkspace] Falling back to copy mode:', worktreeResult.error)
        await fsPromises.rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
        mode = 'copy'
      }
    }

    if (mode === 'copy') {
      await fsPromises.cp(request.workspacePath, targetPath, { recursive: true, force: true })
    }

    isolatedWorkspaceRegistry.set(request.taskId, {
      taskId: request.taskId,
      sourcePath: request.workspacePath,
      workspacePath: targetPath,
      mode,
    })

    return {
      success: true,
      mode,
      workspacePath: targetPath,
    }
  } catch (error) {
    await fsPromises.rm(targetPath, { recursive: true, force: true }).catch(() => undefined)
    return {
      success: false,
      error: formatError(error),
    }
  }
}


export async function cleanupAllIsolatedWorkspaces(): Promise<IsolatedWorkspaceCleanupSummary> {
  const taskIds = Array.from(isolatedWorkspaceRegistry.keys())
  let cleaned = 0
  let failed = 0

  for (const taskId of taskIds) {
    const result = await disposeIsolatedWorkspace(taskId)
    if (result.success) {
      cleaned += 1
    } else {
      failed += 1
    }
  }

  return {
    success: failed === 0,
    cleaned,
    failed,
  }
}

export async function disposeIsolatedWorkspace(taskId: string): Promise<IsolatedWorkspaceResult> {
  const record = isolatedWorkspaceRegistry.get(taskId)
  if (!record) {
    return { success: true }
  }

  try {
    if (record.mode === 'worktree') {
      const removeResult = await runGit(['worktree', 'remove', '--force', record.workspacePath], record.sourcePath)
      if (!removeResult.ok) {
        logger.security.warn('[IsolatedWorkspace] Failed to remove worktree cleanly:', removeResult.error)
      }
    }

    await fsPromises.rm(record.workspacePath, { recursive: true, force: true })
    isolatedWorkspaceRegistry.delete(taskId)

    return {
      success: true,
      mode: record.mode,
      workspacePath: record.workspacePath,
    }
  } catch (error) {
    return {
      success: false,
      mode: record.mode,
      workspacePath: record.workspacePath,
      error: formatError(error),
    }
  }
}

export function registerIsolatedWorkspaceHandlers(): void {
  ipcMain.handle('workspace:previewIsolation', async (_, workspacePath: string) => previewIsolationChoice(workspacePath))
  ipcMain.handle('workspace:createIsolated', async (_, request: CreateIsolatedWorkspaceRequest) => createIsolatedWorkspace(request))
  ipcMain.handle('workspace:disposeIsolated', async (_, taskId: string) => disposeIsolatedWorkspace(taskId))
}


export const __testing = {
  registerRecord(record: IsolatedWorkspaceRecord) {
    isolatedWorkspaceRegistry.set(record.taskId, { ...record })
  },
  getRegistrySize() {
    return isolatedWorkspaceRegistry.size
  },
  clearRegistry() {
    isolatedWorkspaceRegistry.clear()
  },
}
