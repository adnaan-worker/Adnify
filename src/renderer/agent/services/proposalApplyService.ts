import { api } from '@/renderer/services/electronAPI'
import { joinPath, normalizePath, pathStartsWith } from '@shared/utils/pathUtils'

import type { ChangeProposal, FileBaselineSnapshot, WorkPackage } from '../types/taskExecution'

export interface ApplyChangeProposalInput {
  proposal: ChangeProposal
  taskWorkspacePath: string
  workPackage: Pick<WorkPackage, 'id' | 'workspaceId' | 'baselineFiles'> & Partial<WorkPackage>
}

export interface ApplyChangeProposalResult {
  success: boolean
  appliedFiles: string[]
  conflictFiles: string[]
  error?: string
}

export function hashFileContent(content: string | null): string | null {
  if (content === null) return null

  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}


function toRelativePath(taskWorkspacePath: string, fullPath: string): string {
  const normalizedWorkspace = normalizePath(taskWorkspacePath)
  const normalizedFullPath = normalizePath(fullPath)
  if (!pathStartsWith(normalizedFullPath, normalizedWorkspace)) {
    return normalizedFullPath
  }

  return normalizedFullPath.slice(normalizedWorkspace.length).replace(/^[\/]+/, '')
}

async function collectFilesRecursively(rootPath: string): Promise<string[]> {
  const directContent = await api.file.read(rootPath)
  if (directContent !== null) {
    return [rootPath]
  }

  const entries = await api.file.readDir(rootPath)
  if (!entries || entries.length === 0) {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      files.push(...await collectFilesRecursively(entry.path))
    } else {
      files.push(entry.path)
    }
  }

  return files
}

export async function captureBaselineForScopes(
  taskWorkspacePath: string,
  writableScopes: string[],
): Promise<Record<string, FileBaselineSnapshot>> {
  const baselines: Record<string, FileBaselineSnapshot> = {}

  for (const scope of writableScopes) {
    const scopePath = joinPath(taskWorkspacePath, scope)
    const files = await collectFilesRecursively(scopePath)

    if (files.length === 0) {
      if (!(scope in baselines)) {
        baselines[scope] = {
          path: scope,
          exists: false,
          hash: null,
        }
      }
      continue
    }

    const scopedBaselines = await captureBaselineForPaths(
      taskWorkspacePath,
      files.map((filePath) => toRelativePath(taskWorkspacePath, filePath)),
    )
    Object.assign(baselines, scopedBaselines)
  }

  return baselines
}

export async function captureBaselineForPaths(
  taskWorkspacePath: string,
  relativePaths: string[],
): Promise<Record<string, FileBaselineSnapshot>> {
  const baselines: Record<string, FileBaselineSnapshot> = {}

  for (const relativePath of relativePaths) {
    const fullPath = joinPath(taskWorkspacePath, relativePath)
    const content = await api.file.read(fullPath)
    baselines[relativePath] = {
      path: relativePath,
      exists: content !== null,
      hash: hashFileContent(content),
    }
  }

  return baselines
}

export async function applyChangeProposal(input: ApplyChangeProposalInput): Promise<ApplyChangeProposalResult> {
  if (!input.workPackage.workspaceId) {
    return {
      success: false,
      appliedFiles: [],
      conflictFiles: [],
      error: 'Missing work package workspace',
    }
  }

  const baselineFiles = input.workPackage.baselineFiles || {}
  const conflictFiles: string[] = []

  for (const relativePath of input.proposal.changedFiles) {
    const baseline = baselineFiles[relativePath]
    if (!baseline) {
      conflictFiles.push(relativePath)
      continue
    }

    const targetPath = joinPath(input.taskWorkspacePath, relativePath)
    const currentContent = await api.file.read(targetPath)
    const currentExists = currentContent !== null
    const currentHash = hashFileContent(currentContent)

    if (currentExists !== baseline.exists || currentHash !== baseline.hash) {
      conflictFiles.push(relativePath)
    }
  }

  if (conflictFiles.length > 0) {
    return {
      success: false,
      appliedFiles: [],
      conflictFiles,
      error: 'Main workspace changed during package review',
    }
  }

  const appliedFiles: string[] = []
  for (const relativePath of input.proposal.changedFiles) {
    const sourcePath = joinPath(input.workPackage.workspaceId, relativePath)
    const targetPath = joinPath(input.taskWorkspacePath, relativePath)
    const sourceExists = await api.file.exists(sourcePath)

    if (!sourceExists) {
      const deleted = await api.file.delete(targetPath)
      if (!deleted) {
        return {
          success: false,
          appliedFiles,
          conflictFiles: [],
          error: `Failed to delete ${relativePath}`,
        }
      }
      appliedFiles.push(relativePath)
      continue
    }

    const sourceContent = await api.file.read(sourcePath)
    if (sourceContent === null) {
      return {
        success: false,
        appliedFiles,
        conflictFiles: [],
        error: `Failed to read ${relativePath} from package workspace`,
      }
    }

    const written = await api.file.write(targetPath, sourceContent)
    if (!written) {
      return {
        success: false,
        appliedFiles,
        conflictFiles: [],
        error: `Failed to write ${relativePath} into main workspace`,
      }
    }

    appliedFiles.push(relativePath)
  }

  return {
    success: true,
    appliedFiles,
    conflictFiles: [],
  }
}
