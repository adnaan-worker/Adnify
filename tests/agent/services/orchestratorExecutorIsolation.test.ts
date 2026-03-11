import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    workspace: {
      createIsolated: vi.fn(),
      disposeIsolated: vi.fn(),
    },
    file: {
      read: vi.fn(),
      readDir: vi.fn(),
      exists: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    },
    llm: {
      abort: vi.fn(),
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
import { __testing as executorTesting, stopPlanExecution } from '@renderer/agent/services/orchestratorExecutor'
import { hashFileContent } from '@renderer/agent/services/proposalApplyService'

describe('execution workspace service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAgentStore.setState({
      plans: [],
      activePlanId: null,
      phase: 'planning',
      isExecuting: false,
      currentTaskId: null,
      controllerState: 'idle',
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


  it('creates independent isolated workspaces for separate work packages in the same task', async () => {
    vi.mocked(api.workspace.createIsolated).mockImplementation(async ({ ownerId }) => ({
      success: true,
      workspacePath: `/tmp/${ownerId}`,
      mode: 'worktree',
    }))

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Run two parallel packages',
      specialists: ['frontend', 'logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
    })
    const [firstPackageId, secondPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    const first = await prepareTaskExecutionWorkspace(taskId, '/workspace/adnify', firstPackageId)
    const second = await prepareTaskExecutionWorkspace(taskId, '/workspace/adnify', secondPackageId)

    expect(first.workspacePath).toBe(`/tmp/${firstPackageId}`)
    expect(second.workspacePath).toBe(`/tmp/${secondPackageId}`)
    expect(api.workspace.createIsolated).toHaveBeenNthCalledWith(1, {
      taskId,
      workspacePath: '/workspace/adnify',
      ownerId: firstPackageId,
    })
    expect(api.workspace.createIsolated).toHaveBeenNthCalledWith(2, {
      taskId,
      workspacePath: '/workspace/adnify',
      ownerId: secondPackageId,
    })
  })


  it('recreates a package workspace when persisted workspaceId no longer exists', async () => {
    vi.mocked(api.file.exists).mockResolvedValue(false)
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/pkg-recreated',
      mode: 'copy',
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Resume persisted package execution',
      specialists: ['logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      isolationMode: 'copy',
      isolationStatus: 'ready',
    })
    const [packageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    useAgentStore.getState().updateWorkPackage(packageId, {
      workspaceId: '/tmp/stale-pkg',
      workspaceOwnerId: packageId,
    })

    const result = await prepareTaskExecutionWorkspace(taskId, '/workspace/adnify', packageId)

    expect(api.file.exists).toHaveBeenCalledWith('/tmp/stale-pkg')
    expect(api.workspace.createIsolated).toHaveBeenCalledWith({
      taskId,
      workspacePath: '/workspace/adnify',
      ownerId: packageId,
    })
    expect(result.success).toBe(true)
    expect(result.workspacePath).toBe('/tmp/pkg-recreated')
    expect(useAgentStore.getState().workPackages[packageId].workspaceId).toBeNull()
  })

  it('disposes package-scoped isolated workspaces independently', async () => {
    vi.mocked(api.workspace.disposeIsolated).mockResolvedValue({ success: true })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Dispose one package workspace',
      specialists: ['frontend', 'logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      isolationMode: 'worktree',
      isolationStatus: 'ready',
    })
    const [firstPackageId, secondPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    useAgentStore.getState().updateWorkPackage(firstPackageId, {
      workspaceId: '/tmp/pkg-1',
      workspaceOwnerId: firstPackageId,
    })
    useAgentStore.getState().updateWorkPackage(secondPackageId, {
      workspaceId: '/tmp/pkg-2',
      workspaceOwnerId: secondPackageId,
    })

    await cleanupTaskExecutionWorkspace(taskId, firstPackageId)

    expect(api.workspace.disposeIsolated).toHaveBeenCalledWith(firstPackageId)
    expect(useAgentStore.getState().workPackages[firstPackageId].workspaceId).toBeNull()
    expect(useAgentStore.getState().workPackages[secondPackageId].workspaceId).toBe('/tmp/pkg-2')
  })

  it('captures baseline file hashes for writable scopes before package execution starts', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/adnify-task-2a',
      mode: 'worktree',
    })
    vi.mocked(api.file.readDir).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components') {
        return [{ name: 'TaskBoard.tsx', path: '/workspace/adnify/src/renderer/components/TaskBoard.tsx', isDirectory: false }]
      }
      return []
    })
    vi.mocked(api.file.read).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components/TaskBoard.tsx') {
        return 'baseline TaskBoard content'
      }
      return null
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Coordinate renderer changes',
      specialists: ['frontend', 'logic'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      writableScopes: ['src/renderer/components'],
    })
    const [firstPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    const prepared = await executorTesting.prepareWorkPackageExecution({
      taskId,
      workPackageId: firstPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })

    expect(prepared.ready).toBe(true)
    expect(useAgentStore.getState().workPackages[firstPackageId].baselineFiles).toEqual({
      'src/renderer/components/TaskBoard.tsx': {
        path: 'src/renderer/components/TaskBoard.tsx',
        exists: true,
        hash: hashFileContent('baseline TaskBoard content'),
      },
    })
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


  it('resets active runtime state after manual stop so the same plan can be restarted cleanly', async () => {
    vi.mocked(api.workspace.createIsolated).mockImplementation(async ({ ownerId }) => ({
      success: true,
      workspacePath: `/tmp/${ownerId}`,
      mode: 'worktree',
    }))
    vi.mocked(api.workspace.disposeIsolated).mockResolvedValue({ success: true })

    const store = useAgentStore.getState()
    const planId = 'plan-stop-cleanup'
    store.addPlan({
      id: planId,
      name: 'Stop cleanup plan',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      requirementsDoc: 'noop.md',
      executionMode: 'parallel',
      status: 'approved',
      tasks: [
        {
          id: 'plan-task-1',
          title: 'Inspect project',
          description: 'Inspect project structure',
          provider: 'openai',
          model: 'gpt-5',
          role: 'coder',
          dependencies: [],
          status: 'pending',
        },
      ],
    })
    store.setActivePlan(planId)
    store.startExecution(planId)

    const executionTaskId = store.createExecutionTask({
      objective: 'Inspect project and summarize',
      sourcePlanId: planId,
      specialists: ['logic', 'frontend'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/workspace/adnify',
      writableScopes: ['src/renderer/components'],
    })
    store.selectExecutionTask(executionTaskId)
    store.setExecutionTaskState(executionTaskId, 'running')

    const [firstPackageId, secondPackageId] = useAgentStore.getState().executionTasks[executionTaskId].workPackages

    const first = await executorTesting.prepareWorkPackageExecution({
      taskId: executionTaskId,
      workPackageId: firstPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })
    const second = await executorTesting.prepareWorkPackageExecution({
      taskId: executionTaskId,
      workPackageId: secondPackageId,
      fallbackWorkspacePath: '/workspace/adnify',
    })

    expect(first.ready).toBe(true)
    expect(second.ready).toBe(false)
    expect(useAgentStore.getState().workPackages[firstPackageId].status).toBe('executing')
    expect(useAgentStore.getState().workPackages[secondPackageId].status).toBe('queued')

    await stopPlanExecution()

    const state = useAgentStore.getState()
    const stoppedPlan = state.plans.find((plan) => plan.id === planId)

    expect(state.isExecuting).toBe(false)
    expect(state.phase).toBe('planning')
    expect(state.controllerState).toBe('idle')
    expect(stoppedPlan?.status).toBe('paused')
    expect(stoppedPlan?.tasks[0]?.status).toBe('pending')
    expect(state.executionTasks[executionTaskId].state).toBe('planning')
    expect(state.workPackages[firstPackageId].status).toBe('queued')
    expect(state.workPackages[secondPackageId].status).toBe('queued')
    expect(state.workPackages[firstPackageId].workspaceId).toBeNull()
    expect(state.workPackages[firstPackageId].workspaceOwnerId).toBeNull()
    expect(Object.values(state.ownershipLeases).every((lease) => lease.status === 'released')).toBe(true)
    expect(Object.values(state.executionQueueItems).every((item) => item.status === 'cancelled')).toBe(true)
    expect(state.executionTasks[executionTaskId].queueSummary.activeLeaseCount).toBe(0)
    expect(state.executionTasks[executionTaskId].queueSummary.queuedCount).toBe(0)
    expect(api.workspace.disposeIsolated).toHaveBeenCalledWith(firstPackageId)
  })

  it('applies an approved proposal, then releases queued work and cleans the package workspace', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/adnify-task-5',
      mode: 'worktree',
    })
    vi.mocked(api.workspace.disposeIsolated).mockResolvedValue({ success: true })
    vi.mocked(api.file.readDir).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components') {
        return [{ name: 'TaskBoard.tsx', path: '/workspace/adnify/src/renderer/components/TaskBoard.tsx', isDirectory: false }]
      }
      return []
    })
    vi.mocked(api.file.read).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components/TaskBoard.tsx') {
        return 'baseline TaskBoard content'
      }
      if (path === '/tmp/adnify-task-5/src/renderer/components/TaskBoard.tsx') {
        return 'new isolated TaskBoard content'
      }
      return null
    })
    vi.mocked(api.file.exists).mockImplementation(async (path: string) => path === '/tmp/adnify-task-5/src/renderer/components/TaskBoard.tsx')
    vi.mocked(api.file.write).mockResolvedValue(true)
    vi.mocked(api.file.delete).mockResolvedValue(true)

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

    await executorTesting.reviewChangeProposal(completion.proposalId, 'apply')

    const state = useAgentStore.getState()
    const queuedItem = Object.values(state.executionQueueItems).find((item) => item.workPackageId === secondPackageId)

    expect(state.changeProposals[completion.proposalId].status).toBe('applied')
    expect(queuedItem?.status).toBe('ready')
    expect(api.file.write).toHaveBeenCalledWith(
      '/workspace/adnify/src/renderer/components/TaskBoard.tsx',
      'new isolated TaskBoard content',
    )
    expect(api.workspace.disposeIsolated).toHaveBeenCalledWith(firstPackageId)
  })


  it('opens adjudication instead of applying when the main workspace drifted before proposal approval', async () => {
    vi.mocked(api.workspace.createIsolated).mockResolvedValue({
      success: true,
      workspacePath: '/tmp/adnify-task-6',
      mode: 'worktree',
    })
    vi.mocked(api.workspace.disposeIsolated).mockResolvedValue({ success: true })
    vi.mocked(api.file.readDir).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components') {
        return [{ name: 'TaskBoard.tsx', path: '/workspace/adnify/src/renderer/components/TaskBoard.tsx', isDirectory: false }]
      }
      return []
    })
    vi.mocked(api.file.read).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components/TaskBoard.tsx') {
        return 'baseline TaskBoard content'
      }
      if (path === '/tmp/adnify-task-6/src/renderer/components/TaskBoard.tsx') {
        return 'new isolated TaskBoard content'
      }
      return null
    })
    vi.mocked(api.file.exists).mockImplementation(async (path: string) => path === '/tmp/adnify-task-6/src/renderer/components/TaskBoard.tsx')
    vi.mocked(api.file.write).mockResolvedValue(true)
    vi.mocked(api.file.delete).mockResolvedValue(true)

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

    vi.mocked(api.file.read).mockImplementation(async (path: string) => {
      if (path === '/workspace/adnify/src/renderer/components/TaskBoard.tsx') {
        return 'main workspace drifted'
      }
      if (path === '/tmp/adnify-task-6/src/renderer/components/TaskBoard.tsx') {
        return 'new isolated TaskBoard content'
      }
      return null
    })

    await executorTesting.reviewChangeProposal(completion.proposalId, 'apply')

    const state = useAgentStore.getState()
    const proposal = state.changeProposals[completion.proposalId]
    const queuedItem = Object.values(state.executionQueueItems).find((item) => item.workPackageId === secondPackageId)

    expect(proposal.status).toBe('pending')
    expect(proposal.conflictFiles).toEqual(['src/renderer/components/TaskBoard.tsx'])
    expect(state.executionTasks[taskId].latestAdjudicationId).toBeTruthy()
    expect(queuedItem?.status).toBe('queued')
    expect(api.file.write).not.toHaveBeenCalled()
    expect(api.workspace.disposeIsolated).not.toHaveBeenCalled()
  })

  it('creates handoff and proposal state while keeping conflicting queued work blocked until review resolution', async () => {
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
    expect(queuedItem?.status).toBe('queued')
  })
})
