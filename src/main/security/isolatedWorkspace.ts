import { execFile } from 'child_process'
import fs, { promises as fsPromises } from 'fs'
import { ipcMain } from 'electron'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

import { logger } from '@shared/utils/Logger'
import { pathEquals, pathStartsWith } from '@shared/utils/pathUtils'

const execFileAsync = promisify(execFile)
const ISOLATED_WORKSPACE_ROOT = path.join(os.tmpdir(), 'adnify-task-workspaces')
const ISOLATED_WORKSPACE_METADATA_PATH = path.join('.adnify', 'isolated-workspace.json')

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
  ownerId?: string
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
  ownerId?: string
  taskId: string
  sourcePath: string
  workspacePath: string
  mode: IsolationMode
}

const isolatedWorkspaceRegistry = new Map<string, IsolatedWorkspaceRecord>()
let registryHydratedFromDisk = false

function getRegistryKey(record: Pick<IsolatedWorkspaceRecord, 'ownerId' | 'taskId'>): string {
  return record.ownerId || record.taskId
}

function isTrackedWorkspacePath(workspacePath: string): boolean {
  const resolvedWorkspacePath = path.resolve(workspacePath)
  const resolvedRoot = path.resolve(ISOLATED_WORKSPACE_ROOT)
  return pathStartsWith(resolvedWorkspacePath, resolvedRoot) || pathEquals(resolvedWorkspacePath, resolvedRoot)
}

function getMetadataFilePath(workspacePath: string): string {
  return path.join(workspacePath, ISOLATED_WORKSPACE_METADATA_PATH)
}

async function persistIsolatedWorkspaceRecord(record: IsolatedWorkspaceRecord): Promise<void> {
  const metadataPath = getMetadataFilePath(record.workspacePath)
  await fsPromises.mkdir(path.dirname(metadataPath), { recursive: true })
  await fsPromises.writeFile(metadataPath, JSON.stringify(record, null, 2), 'utf-8')
}

function parsePersistedRecord(workspacePath: string, rawContent: string): IsolatedWorkspaceRecord | null {
  try {
    const parsed = JSON.parse(rawContent) as Partial<IsolatedWorkspaceRecord>
    if (typeof parsed.taskId !== 'string' || parsed.taskId.trim().length === 0) {
      return null
    }
    if (typeof parsed.sourcePath !== 'string' || parsed.sourcePath.trim().length === 0) {
      return null
    }

    return {
      ownerId: typeof parsed.ownerId === 'string' && parsed.ownerId.trim().length > 0 ? parsed.ownerId : undefined,
      taskId: parsed.taskId,
      sourcePath: parsed.sourcePath,
      workspacePath: path.resolve(workspacePath),
      mode: parsed.mode === 'worktree' ? 'worktree' : 'copy',
    }
  } catch {
    return null
  }
}

function loadPersistedRegistryEntries(): IsolatedWorkspaceRecord[] {
  if (!fs.existsSync(ISOLATED_WORKSPACE_ROOT)) {
    return []
  }

  const entries: IsolatedWorkspaceRecord[] = []
  for (const item of fs.readdirSync(ISOLATED_WORKSPACE_ROOT, { withFileTypes: true })) {
    if (!item.isDirectory()) {
      continue
    }

    const workspacePath = path.join(ISOLATED_WORKSPACE_ROOT, item.name)
    if (!isTrackedWorkspacePath(workspacePath)) {
      continue
    }

    const metadataPath = getMetadataFilePath(workspacePath)
    if (!fs.existsSync(metadataPath)) {
      continue
    }

    const record = parsePersistedRecord(workspacePath, fs.readFileSync(metadataPath, 'utf-8'))
    if (!record) {
      continue
    }

    entries.push(record)
  }

  return entries
}

function hydrateRegistryFromDisk(force = false): void {
  if (registryHydratedFromDisk && !force) {
    return
  }

  registryHydratedFromDisk = true

  for (const record of isolatedWorkspaceRegistry.values()) {
    if (!fs.existsSync(record.workspacePath)) {
      isolatedWorkspaceRegistry.delete(getRegistryKey(record))
    }
  }

  for (const record of loadPersistedRegistryEntries()) {
    isolatedWorkspaceRegistry.set(getRegistryKey(record), record)
  }
}

export function isRegisteredIsolatedWorkspacePath(targetPath: string): boolean {
  hydrateRegistryFromDisk()

  const resolvedTargetPath = path.resolve(targetPath)
  for (const record of isolatedWorkspaceRegistry.values()) {
    const resolvedWorkspacePath = path.resolve(record.workspacePath)
    if (pathStartsWith(resolvedTargetPath, resolvedWorkspacePath) || pathEquals(resolvedTargetPath, resolvedWorkspacePath)) {
      return true
    }
  }

  return false
}

export function getAccessibleWorkspaceRoots(workspaceRoots: string | string[]): string[] {
  hydrateRegistryFromDisk()

  const baseRoots = (Array.isArray(workspaceRoots) ? workspaceRoots : [workspaceRoots])
    .filter((root): root is string => typeof root === 'string' && root.trim().length > 0)
    .map((root) => path.resolve(root))

  const accessibleRoots = [...baseRoots]

  for (const record of isolatedWorkspaceRegistry.values()) {
    const resolvedSourcePath = path.resolve(record.sourcePath)
    const shouldInclude = baseRoots.some((root) =>
      pathStartsWith(resolvedSourcePath, root) || pathEquals(resolvedSourcePath, root),
    )

    if (!shouldInclude) {
      continue
    }

    const resolvedWorkspacePath = path.resolve(record.workspacePath)
    if (!accessibleRoots.some((root) => pathEquals(root, resolvedWorkspacePath))) {
      accessibleRoots.push(resolvedWorkspacePath)
    }
  }

  return accessibleRoots
}

export function chooseIsolationMode(input: IsolationChoiceInput): IsolationMode {
  if (!input.hasGit) {
    return 'copy'
  }

  return input.hasUncommittedChanges ? 'copy' : 'worktree'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-') || 'task'
}

function getWorkspaceOwnerId(input: { taskId: string; ownerId?: string }): string {
  return input.ownerId || input.taskId
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

async function createTargetPath(ownerId: string): Promise<string> {
  const root = await ensureIsolationRoot()
  return path.join(root, `${sanitizeTaskId(ownerId)}-${Date.now()}`)
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
  hydrateRegistryFromDisk()

  const preview = await previewIsolationChoice(request.workspacePath)
  let mode = request.preferredMode ?? preview.mode
  const ownerId = getWorkspaceOwnerId(request)
  const targetPath = await createTargetPath(ownerId)

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

    const record: IsolatedWorkspaceRecord = {
      ownerId,
      taskId: request.taskId,
      sourcePath: request.workspacePath,
      workspacePath: targetPath,
      mode,
    }

    await persistIsolatedWorkspaceRecord(record)
    isolatedWorkspaceRegistry.set(getRegistryKey(record), record)

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
  hydrateRegistryFromDisk()

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
  hydrateRegistryFromDisk()

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
    isolatedWorkspaceRegistry.set(record.ownerId || record.taskId, { ...record, ownerId: record.ownerId || record.taskId })
  },
  getRegistrySize() {
    return isolatedWorkspaceRegistry.size
  },
  clearRegistry() {
    isolatedWorkspaceRegistry.clear()
    registryHydratedFromDisk = false
  },
}
