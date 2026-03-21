import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  __testing as isolatedWorkspaceTesting,
  cleanupAllIsolatedWorkspaces,
} from '@main/security/isolatedWorkspace'
import { securityManager } from '@main/security/securityModule'
import { __testing } from '@main/security/secureTerminal'

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
      taskId: 'task-terminal',
      sourcePath,
      workspacePath,
      mode: 'copy',
    }),
    'utf-8',
  )
  tempPathsToCleanup.add(workspacePath)
  return workspacePath
}

describe('secure terminal backend safety', () => {
  afterEach(async () => {
    await cleanupAllIsolatedWorkspaces()
    isolatedWorkspaceTesting.clearRegistry()
    for (const targetPath of tempPathsToCleanup) {
      fs.rmSync(targetPath, { recursive: true, force: true })
    }
    tempPathsToCleanup.clear()
  })

  it('downgrades PTY requests to pipe on macOS before spawn', () => {
    expect(__testing.resolveInteractiveBackend('darwin', 'pty')).toBe('pipe')
  })

  it('preserves explicit pipe requests on other platforms', () => {
    expect(__testing.resolveInteractiveBackend('linux', 'pipe')).toBe('pipe')
    expect(__testing.resolveInteractiveBackend('win32', 'pipe')).toBe('pipe')
  })

  it('resolves isolated workspace roots for terminal and git validation', () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makePersistedIsolatedWorkspace(workspaceRoot, 'pkg-terminal')

    isolatedWorkspaceTesting.clearRegistry()

    expect(__testing.resolveValidationRoots([workspaceRoot])).toEqual([
      workspaceRoot,
      isolatedWorkspace,
    ])
  })

  it('allows validated access inside an isolated workspace even when it lives under macOS /var temp paths', () => {
    const workspaceRoot = makeTempDir('adnify-workspace-')
    const isolatedWorkspace = makePersistedIsolatedWorkspace(workspaceRoot, 'pkg-sensitive')

    isolatedWorkspaceTesting.clearRegistry()

    expect(
      securityManager.validateWorkspacePath(
        path.join(isolatedWorkspace, 'package.json'),
        __testing.resolveValidationRoots([workspaceRoot]),
      ),
    ).toBe(true)
  })
})
