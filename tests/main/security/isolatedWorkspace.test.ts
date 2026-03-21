import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  __testing,
  chooseIsolationMode,
  cleanupAllIsolatedWorkspaces,
  disposeIsolatedWorkspace,
  getAccessibleWorkspaceRoots,
} from '@main/security/isolatedWorkspace'

const tempPathsToCleanup = new Set<string>()

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tempPathsToCleanup.add(dir)
  return dir
}

function makePersistedIsolatedWorkspace(sourcePath: string, ownerId: string): string {
  const isolationRoot = path.join(os.tmpdir(), 'adnify-task-workspaces')
  fs.mkdirSync(isolationRoot, { recursive: true })
  const workspacePath = fs.mkdtempSync(path.join(isolationRoot, `${ownerId}-`))
  fs.mkdirSync(path.join(workspacePath, '.adnify'), { recursive: true })
  fs.writeFileSync(
    path.join(workspacePath, '.adnify', 'isolated-workspace.json'),
    JSON.stringify({
      ownerId,
      taskId: 'task-persisted',
      sourcePath,
      workspacePath,
      mode: 'copy',
    }),
    'utf-8',
  )
  tempPathsToCleanup.add(workspacePath)
  return workspacePath
}

describe('isolated workspace', () => {
  afterEach(async () => {
    await cleanupAllIsolatedWorkspaces()
    __testing.clearRegistry()
    for (const targetPath of tempPathsToCleanup) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
    tempPathsToCleanup.clear()
  })

  it('prefers git worktree for git repositories', () => {
    expect(chooseIsolationMode({ hasGit: true, hasUncommittedChanges: false })).toBe('worktree')
  })

  it('falls back to copy mode when git workspace has uncommitted changes', () => {
    expect(chooseIsolationMode({ hasGit: true, hasUncommittedChanges: true })).toBe('copy')
  })

  it('falls back to temp copy outside git', () => {
    expect(chooseIsolationMode({ hasGit: false, hasUncommittedChanges: false })).toBe('copy')
  })

  it('allows isolated workspaces derived from the active workspace roots', () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const unrelatedRoot = makeTempDir('adnify-unrelated-')
    const isolatedA = makeTempDir('adnify-iso-a-')
    const isolatedB = makeTempDir('adnify-iso-b-')

    __testing.registerRecord({
      ownerId: 'task-a:pkg-1',
      taskId: 'task-a',
      sourcePath: workspaceRoot,
      workspacePath: isolatedA,
      mode: 'copy',
    })
    __testing.registerRecord({
      ownerId: 'task-b:pkg-1',
      taskId: 'task-b',
      sourcePath: unrelatedRoot,
      workspacePath: isolatedB,
      mode: 'copy',
    })

    expect(getAccessibleWorkspaceRoots([workspaceRoot])).toEqual([
      workspaceRoot,
      isolatedA,
    ])
  })

  it('rehydrates persisted isolated workspaces after the in-memory registry is cleared', () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makePersistedIsolatedWorkspace(workspaceRoot, 'pkg-persisted')

    __testing.clearRegistry()

    expect(getAccessibleWorkspaceRoots([workspaceRoot])).toEqual([
      workspaceRoot,
      isolatedWorkspace,
    ])
  })

  it('includes task-owned isolated roots for task-level execution targets', () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makeTempDir('adnify-task-iso-')

    __testing.registerRecord({
      taskId: 'task-level',
      sourcePath: workspaceRoot,
      workspacePath: isolatedWorkspace,
      mode: 'copy',
    })

    expect(getAccessibleWorkspaceRoots([workspaceRoot])).toEqual([
      workspaceRoot,
      isolatedWorkspace,
    ])
  })


  it('disposes package-scoped isolated workspaces independently within one task', async () => {
    const sourcePath = makeTempDir('adnify-source-')
    const isolatedA = makeTempDir('adnify-iso-a-')
    const isolatedB = makeTempDir('adnify-iso-b-')

    __testing.registerRecord({
      ownerId: 'task-a:pkg-1',
      taskId: 'task-a',
      sourcePath,
      workspacePath: isolatedA,
      mode: 'copy',
    })
    __testing.registerRecord({
      ownerId: 'task-a:pkg-2',
      taskId: 'task-a',
      sourcePath,
      workspacePath: isolatedB,
      mode: 'copy',
    })

    const first = await disposeIsolatedWorkspace('task-a:pkg-1')
    expect(first.success).toBe(true)
    expect(fs.existsSync(isolatedA)).toBe(false)
    expect(fs.existsSync(isolatedB)).toBe(true)
    expect(__testing.getRegistrySize()).toBe(1)

    const second = await disposeIsolatedWorkspace('task-a:pkg-2')
    expect(second.success).toBe(true)
    expect(fs.existsSync(isolatedB)).toBe(false)
    expect(__testing.getRegistrySize()).toBe(0)
  })

  it('cleans all tracked isolated workspaces and is idempotent', async () => {
    const sourcePath = makeTempDir('adnify-source-')
    const isolatedA = makeTempDir('adnify-iso-a-')
    const isolatedB = makeTempDir('adnify-iso-b-')

    __testing.registerRecord({
      taskId: 'task-a',
      sourcePath,
      workspacePath: isolatedA,
      mode: 'copy',
    })
    __testing.registerRecord({
      taskId: 'task-b',
      sourcePath,
      workspacePath: isolatedB,
      mode: 'copy',
    })

    expect(__testing.getRegistrySize()).toBe(2)

    const first = await cleanupAllIsolatedWorkspaces()
    expect(first.success).toBe(true)
    expect(first.cleaned).toBe(2)
    expect(__testing.getRegistrySize()).toBe(0)
    expect(fs.existsSync(isolatedA)).toBe(false)
    expect(fs.existsSync(isolatedB)).toBe(false)

    const second = await cleanupAllIsolatedWorkspaces()
    expect(second.success).toBe(true)
    expect(second.cleaned).toBe(0)
    expect(second.failed).toBe(0)
  })
})
