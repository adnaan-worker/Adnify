import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    workspace: {
      createIsolated: vi.fn(),
      disposeIsolated: vi.fn(),
    },
    lsp: {
      onDiagnostics: vi.fn(() => () => undefined),
    },
  },
}))

import { api } from '@renderer/services/electronAPI'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import {
  cleanupTaskExecutionWorkspace,
  prepareTaskExecutionWorkspace,
} from '@renderer/agent/services/executionWorkspaceService'
import { __testing as executorTesting } from '@renderer/agent/services/orchestratorExecutor'

describe('execution workspace service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentStore.setState({
      executionTasks: {},
      workPackages: {},
      taskHandoffs: {},
      ownershipLeases: {},
      executionQueueItems: {},
      changeProposals: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
      selectedChangeProposalId: null,
    })
  })

  it('prepares an isolated workspace and stores the resolved path', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/adnify-task-1',
      mode: 'worktree',
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
    })

    const result = await prepareTaskExecutionWorkspace(taskId, '/workspace/adnify')

    expect(result.success).toBe(true)
    expect(result.workspacePath).toBe('/tmp/adnify-task-1')
    expect(useAgentStore.getState().executionTasks[taskId].resolvedWorkspacePath).toBe('/tmp/adnify-task-1')
    expect(useAgentStore.getState().executionTasks[taskId].isolationStatus).toBe('ready')
    expect(useAgentStore.getState().executionTasks[taskId].isolationMode).toBe('worktree')
  })

  it('falls back to current workspace without spawning isolation', async () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Update one setting',
      specialists: ['logic'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })

    const result = await prepareTaskExecutionWorkspace(taskId, '/workspace/adnify')

    expect(result.success).toBe(true)
    expect(result.workspacePath).toBe('/workspace/adnify')
    expect(api.workspace.createIsolated).not.toHaveBeenCalled()
    expect(useAgentStore.getState().executionTasks[taskId].isolationMode).toBeNull()
    expect(useAgentStore.getState().executionTasks[taskId].resolvedWorkspacePath).toBe('/workspace/adnify')
  })

  it('marks preparation failure without leaving a leaked workspace', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: false,
      error: 'git worktree failed',
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Refactor routing',
      specialists: ['logic', 'verifier'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
    })

    const result = await prepareTaskExecutionWorkspace(taskId, '/workspace/adnify')

    expect(result.success).toBe(false)
    expect(useAgentStore.getState().executionTasks[taskId].isolationStatus).toBe('failed')
    expect(useAgentStore.getState().executionTasks[taskId].isolationError).toContain('git worktree failed')
  })

  it('disposes isolated workspaces idempotently', async () => {
    vi.mocked(api.workspace.disposeIsolated).mockResolvedValue({ success: true })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Run long task',
      specialists: ['frontend', 'logic', 'verifier'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      resolvedWorkspacePath: '/tmp/adnify-task-2',
      isolationMode: 'copy',
      isolationStatus: 'ready',
    })

    await cleanupTaskExecutionWorkspace(taskId)
    await cleanupTaskExecutionWorkspace(taskId)

    expect(api.workspace.disposeIsolated).toHaveBeenCalledTimes(1)
    expect(useAgentStore.getState().executionTasks[taskId].isolationStatus).toBe('disposed')
    expect(useAgentStore.getState().executionTasks[taskId].resolvedWorkspacePath).toBeNull()
  })

  it('queues conflicting work packages until active leases are released', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/adnify-task-3',
      mode: 'worktree',
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Coordinate renderer changes',
      specialists: ['frontend', 'logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      writableScopes: ['src/renderer/components'],
    })
    const [firstPackageId, secondPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    const first = await executorTesting.prepareWorkPackageExecution({
      taskId,
      workPackageId: firstPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })
    const second = await executorTesting.prepareWorkPackageExecution({
      taskId,
      workPackageId: secondPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })

    const state = useAgentStore.getState()
    expect(first.ready).toBe(true)
    expect(first.workspacePath).toBe('/tmp/adnify-task-3')
    expect(state.workPackages[firstPackageId].status).toBe('executing')
    expect(state.workPackages[firstPackageId].workspaceId).toBe('/tmp/adnify-task-3')
    expect(second.ready).toBe(false)
    expect(state.workPackages[secondPackageId].status).toBe('queued')
    expect(Object.values(state.executionQueueItems)).toHaveLength(1)
  })

  it('creates handoff and proposal state, then wakes queued work on completion', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/adnify-task-4',
      mode: 'worktree',
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Coordinate renderer changes',
      specialists: ['frontend', 'logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      writableScopes: ['src/renderer/components'],
    })
    const [firstPackageId, secondPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    await executorTesting.prepareWorkPackageExecution({
      taskId,
      workPackageId: firstPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })
    await executorTesting.prepareWorkPackageExecution({
      taskId,
      workPackageId: secondPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })

    const completion = await executorTesting.completeWorkPackageExecution({
      taskId,
      workPackageId: firstPackageId,
      summary: 'Frontend package is ready for review',
      changedFiles: ['src/renderer/components/TaskBoard.tsx'],
      verificationStatus: 'passed',
      riskLevel: 'low',
    })

    const state = useAgentStore.getState()
    const queuedItem = Object.values(state.executionQueueItems).find((item) => item.workPackageId === secondPackageId)

    expect(completion.handoffId).toBeTruthy()
    expect(completion.proposalId).toBeTruthy()
    expect(state.taskHandoffs[completion.handoffId].workPackageId).toBe(firstPackageId)
    expect(state.changeProposals[completion.proposalId].workPackageId).toBe(firstPackageId)
    expect(state.workPackages[firstPackageId].status).toBe('proposal-ready')
    expect(state.executionTasks[taskId].proposalSummary.pendingCount).toBe(1)
    expect(queuedItem?.status).toBe('ready')
  })
})
