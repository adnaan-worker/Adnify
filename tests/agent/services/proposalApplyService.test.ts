import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    file: {
      read: vi.fn(),
      write: vi.fn(),
      exists: vi.fn(),
      delete: vi.fn(),
      readDir: vi.fn(),
    },
  },
}))

import { api } from '@renderer/services/electronAPI'
import { applyChangeProposal, hashFileContent } from '@renderer/agent/services/proposalApplyService'

const fileState = new Map<string, string>()

function setFile(path: string, content: string) {
  fileState.set(path, content)
}

describe('proposal apply service', () => {
  beforeEach(() => {
    fileState.clear()
    vi.clearAllMocks()

    vi.mocked(api.file.read).mockImplementation(async (path: string) => fileState.get(path) ?? null)
    vi.mocked(api.file.exists).mockImplementation(async (path: string) => fileState.has(path))
    vi.mocked(api.file.write).mockImplementation(async (path: string, content: string) => {
      fileState.set(path, content)
      return true
    })
    vi.mocked(api.file.delete).mockImplementation(async (path: string) => {
      fileState.delete(path)
      return true
    })
  })

  it('applies only changedFiles from package workspace back into the main workspace', async () => {
    setFile('/main/src/app.ts', 'old main content')
    setFile('/main/src/ignore.ts', 'stay the same')
    setFile('/isolated/src/app.ts', 'new isolated content')

    const result = await applyChangeProposal({
      proposal: {
        id: 'proposal-1',
        taskId: 'task-1',
        workPackageId: 'pkg-1',
        summary: 'Apply app.ts only',
        changedFiles: ['src/app.ts'],
        verificationStatus: 'passed',
        riskLevel: 'low',
        recommendedAction: 'apply',
        status: 'pending',
        createdAt: 1,
        resolvedAt: null,
      },
      taskWorkspacePath: '/main',
      workPackage: {
        id: 'pkg-1',
        taskId: 'task-1',
        title: 'Update app.ts',
        objective: 'Update app.ts',
        specialist: 'logic',
        status: 'proposal-ready',
        targetDomain: 'logic',
        writableScopes: ['src'],
        readableScopes: ['src'],
        dependsOn: [],
        expectedArtifacts: [],
        queueReason: null,
        workspaceId: '/isolated',
        baselineFiles: {
          'src/app.ts': {
            path: 'src/app.ts',
            exists: true,
            hash: hashFileContent('old main content'),
          },
        },
        handoffId: null,
        proposalId: 'proposal-1',
      },
    })

    expect(result.success).toBe(true)
    expect(fileState.get('/main/src/app.ts')).toBe('new isolated content')
    expect(fileState.get('/main/src/ignore.ts')).toBe('stay the same')
    expect(api.file.write).toHaveBeenCalledTimes(1)
  })

  it('stops applying when the main workspace drifted from the recorded baseline', async () => {
    setFile('/main/src/app.ts', 'main changed after package started')
    setFile('/isolated/src/app.ts', 'new isolated content')

    const result = await applyChangeProposal({
      proposal: {
        id: 'proposal-1',
        taskId: 'task-1',
        workPackageId: 'pkg-1',
        summary: 'Apply app.ts only',
        changedFiles: ['src/app.ts'],
        verificationStatus: 'passed',
        riskLevel: 'low',
        recommendedAction: 'apply',
        status: 'pending',
        createdAt: 1,
        resolvedAt: null,
      },
      taskWorkspacePath: '/main',
      workPackage: {
        id: 'pkg-1',
        taskId: 'task-1',
        title: 'Update app.ts',
        objective: 'Update app.ts',
        specialist: 'logic',
        status: 'proposal-ready',
        targetDomain: 'logic',
        writableScopes: ['src'],
        readableScopes: ['src'],
        dependsOn: [],
        expectedArtifacts: [],
        queueReason: null,
        workspaceId: '/isolated',
        baselineFiles: {
          'src/app.ts': {
            path: 'src/app.ts',
            exists: true,
            hash: hashFileContent('old main content'),
          },
        },
        handoffId: null,
        proposalId: 'proposal-1',
      },
    })

    expect(result.success).toBe(false)
    expect(result.conflictFiles).toEqual(['src/app.ts'])
    expect(api.file.write).not.toHaveBeenCalled()
    expect(fileState.get('/main/src/app.ts')).toBe('main changed after package started')
  })
})
