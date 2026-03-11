import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  __testing,
  chooseIsolationMode,
  cleanupAllIsolatedWorkspaces,
  disposeIsolatedWorkspace,
} from '@main/security/isolatedWorkspace'

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('isolated workspace', () => {
  afterEach(async () => {
    await cleanupAllIsolatedWorkspaces()
    __testing.clearRegistry()
  })

  it('prefers git worktree for git repositories', () => {
    expect(chooseIsolationMode({ hasGit: true, hasUncommittedChanges: false })).toBe('worktree')
  })

  it('falls back to temp copy outside git', () => {
    expect(chooseIsolationMode({ hasGit: false, hasUncommittedChanges: false })).toBe('copy')
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
