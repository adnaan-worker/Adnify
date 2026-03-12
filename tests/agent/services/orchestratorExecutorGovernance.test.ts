import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  nextAgentOutput: 'Browser verification passed',
  browserCapability: {
    available: true,
    provider: 'playwright' as 'playwright' | 'puppeteer' | null,
    serverId: 'playwright',
    serverName: 'Playwright',
    toolNames: ['browser_navigate', 'browser_screenshot'],
    reason: null as string | null,
  },
}))

vi.mock('@renderer/agent/core/Agent', () => ({
  Agent: {
    send: vi.fn(async (_message: string, _config: unknown, _workspacePath: string, _mode: string, promptOptions?: { targetThreadId?: string }) => {
      const threadId = promptOptions?.targetThreadId
      if (!threadId) {
        throw new Error('missing target thread')
      }

      const { useAgentStore } = await import('@renderer/agent/store/AgentStore')
      const { EventBus } = await import('@renderer/agent/core/EventBus')
      const store = useAgentStore.getState()
      const { assistantId } = store.prepareExecution('work package execution', [], threadId)
      store.appendToAssistant(assistantId, mockState.nextAgentOutput, threadId)
      store.finalizeAssistant(assistantId, threadId)
      setTimeout(() => {
        EventBus.emit({ type: 'loop:end', reason: 'complete', threadId })
      }, 0)
    }),
    abort: vi.fn(),
    abortAll: vi.fn(),
  },
}))

vi.mock('@renderer/agent/services/llmConfigService', () => ({
  getLLMConfigForTask: vi.fn(async () => ({ apiKey: 'test-key', provider: 'openai', model: 'gpt-4o' })),
  getProviderModelContext: vi.fn(() => ({ providerId: 'openai', defaultModel: 'gpt-4o', availableModels: ['gpt-4o', 'gpt-4o-mini'] })),
}))

vi.mock('@renderer/agent/services/browserVerificationService', () => ({
  getBrowserVerificationCapability: vi.fn(() => ({ ...mockState.browserCapability })),
  buildBrowserVerificationPrompt: vi.fn((input: { serverName: string }) => `Browser prompt via ${input.serverName}`),
}))

import { useStore } from '@store'
import { Agent } from '@renderer/agent/core/Agent'
import type { TaskPlan } from '@renderer/agent/orchestrator/types'
import { __testing } from '@renderer/agent/services/orchestratorExecutor'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { createEmptyExecutionHeartbeatSnapshot, createEmptySpecialistProfileSnapshot, createInitialPatrolState } from '@renderer/agent/types/taskExecution'

describe('orchestrator executor governance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.nextAgentOutput = 'Browser verification passed'
    mockState.browserCapability = {
      available: true,
      provider: 'playwright',
      serverId: 'playwright',
      serverName: 'Playwright',
      toolNames: ['browser_navigate', 'browser_screenshot'],
      reason: null,
    }

    useAgentStore.setState({
      executionTasks: {},
      workPackages: {},
      taskHandoffs: {},
      changeProposals: {},
      adjudicationCases: {},
      ownershipLeases: {},
      executionQueueItems: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
      selectedChangeProposalId: null,
    })
    useStore.setState((state) => ({
      ...state,
      llmConfig: {
        ...state.llmConfig,
        provider: 'openai',
        model: 'gpt-4o',
      },
      taskTrustSettings: state.taskTrustSettings,
    }))
  })

  it('creates adjudication when budget usage trips a task', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Trip budget',
      specialists: ['logic'],
    })

    __testing.applyTaskGovernanceForAttempt({
      taskId,
      durationMs: 100,
      llmCalls: 0,
      estimatedTokens: 0,
      verifications: 0,
      commands: useAgentStore.getState().executionTasks[taskId].budget.limits.commands + 1,
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.state).toBe('tripped')
    expect(task.latestAdjudicationId).toBeTruthy()
  })

  it('proposes rollback after a failed attempt', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Rollback after failure',
      specialists: ['logic'],
      executionTarget: 'current',
    })

    __testing.applyTaskGovernanceForAttempt({
      taskId,
      durationMs: 100,
      llmCalls: 1,
      estimatedTokens: 100,
      verifications: 0,
      changedFiles: ['src/renderer/App.tsx'],
      failureReason: 'verification failed',
      externalSideEffects: ['npm install'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.rollback.status).toBe('ready')
    expect(task.rollback.proposal?.externalSideEffects).toEqual(['npm install'])
  })

  it('resolves specialist execution guidance from task snapshots', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Build onboarding UI',
      specialists: ['frontend', 'reviewer'],
    })

    useAgentStore.getState().updateExecutionTask(taskId, {
      specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['frontend', 'reviewer'], {
        frontend: {
          model: 'gpt-4.1',
          toolPermission: 'workspace-write',
          networkPermission: 'workspace-only',
          gitPermission: 'task-branch',
          writableScopes: ['src/renderer'],
          styleHints: 'Prefer polished UI',
        },
        reviewer: {
          model: 'gpt-4.1-mini',
          toolPermission: 'read-mostly',
          writableScopes: ['src/renderer'],
          styleHints: 'Prefer risk review',
        },
      }),
    })

    const executionTask = useAgentStore.getState().executionTasks[taskId]
    const profile = __testing.resolveExecutionAttemptProfile(executionTask, 'frontend')
    const guidance = __testing.buildExecutionAttemptGuidance(profile)

    expect(profile?.model).toBe('gpt-4.1')
    expect(guidance).toContain('Prefer polished UI')
    expect(guidance).toContain('Writable scopes: src/renderer')
    expect(guidance).toContain('Tool permission: workspace-write')
  })

  it('returns blocked browser verification when MCP browser capability is unavailable', async () => {
    mockState.browserCapability = {
      available: false,
      provider: null,
      serverId: 'playwright',
      serverName: 'Playwright',
      toolNames: [],
      reason: 'Playwright MCP server is not connected.',
    }

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Validate settings surface',
      specialists: ['frontend', 'verifier', 'reviewer'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })
    const executionTask = useAgentStore.getState().executionTasks[taskId]
    const verifierPackage = executionTask.workPackages
      .map((workPackageId) => useAgentStore.getState().workPackages[workPackageId])
      .find((workPackage) => workPackage.specialist === 'verifier')!
    const plan: TaskPlan = {
      id: 'plan-browser-1',
      name: 'Browser verify',
      createdAt: 1,
      updatedAt: 1,
      requirementsDoc: 'requirements.md',
      executionMode: 'parallel',
      status: 'approved',
      tasks: [],
    }

    const result = await __testing.runWorkPackageWithAgent(verifierPackage, executionTask, plan, '/workspace/adnify')

    expect(result.success).toBe(true)
    expect(result.verification.status).toBe('blocked')
    expect(result.verification.verificationStatus).toBe('pending')
    expect(result.verification.reason).toContain('not connected')
    expect(Agent.send).not.toHaveBeenCalled()
  })

  it('marks browser verification as passed when the verifier completes the browser flow', async () => {
    mockState.nextAgentOutput = 'Browser verification passed for navigation and button states.'

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Validate settings surface',
      specialists: ['frontend', 'verifier', 'reviewer'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })
    const executionTask = useAgentStore.getState().executionTasks[taskId]
    const verifierPackage = executionTask.workPackages
      .map((workPackageId) => useAgentStore.getState().workPackages[workPackageId])
      .find((workPackage) => workPackage.specialist === 'verifier')!
    const plan: TaskPlan = {
      id: 'plan-browser-2',
      name: 'Browser verify',
      createdAt: 1,
      updatedAt: 1,
      requirementsDoc: 'requirements.md',
      executionMode: 'parallel',
      status: 'approved',
      tasks: [],
    }

    const result = await __testing.runWorkPackageWithAgent(verifierPackage, executionTask, plan, '/workspace/adnify')

    expect(result.success).toBe(true)
    expect(result.verification.status).toBe('passed')
    expect(result.verification.verificationStatus).toBe('passed')
    expect(Agent.send).toHaveBeenCalledTimes(1)
    expect(String(vi.mocked(Agent.send).mock.calls[0]?.[0])).toContain('Browser prompt via Playwright')
  })

  it('marks browser verification as failed when verifier output reports a browser failure', async () => {
    mockState.nextAgentOutput = 'FAILED: Login dialog could not be opened in the browser flow.'

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Validate settings surface',
      specialists: ['frontend', 'verifier', 'reviewer'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })
    const executionTask = useAgentStore.getState().executionTasks[taskId]
    const verifierPackage = executionTask.workPackages
      .map((workPackageId) => useAgentStore.getState().workPackages[workPackageId])
      .find((workPackage) => workPackage.specialist === 'verifier')!
    const plan: TaskPlan = {
      id: 'plan-browser-3',
      name: 'Browser verify',
      createdAt: 1,
      updatedAt: 1,
      requirementsDoc: 'requirements.md',
      executionMode: 'parallel',
      status: 'approved',
      tasks: [],
    }

    const result = await __testing.runWorkPackageWithAgent(verifierPackage, executionTask, plan, '/workspace/adnify')

    expect(result.success).toBe(true)
    expect(result.verification.status).toBe('failed')
    expect(result.verification.verificationStatus).toBe('failed')
  })

  it('pauses execution and opens adjudication when patrol detects a stuck package', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Recover a long-running task',
      specialists: ['logic'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })

    const state = useAgentStore.getState()
    const workPackageId = state.executionTasks[taskId].workPackages[0]
    const staleHeartbeat = {
      ...createEmptyExecutionHeartbeatSnapshot(),
      status: 'active' as const,
      lastHeartbeatAt: 1_000,
      lastProgressAt: 1_000,
    }

    state.selectExecutionTask(taskId)
    state.setControllerState('executing')
    state.updateExecutionTask(taskId, {
      state: 'running',
      patrol: {
        ...createInitialPatrolState(),
        status: 'active',
      },
      heartbeat: staleHeartbeat,
    })
    state.updateWorkPackage(workPackageId, {
      status: 'executing',
      heartbeat: staleHeartbeat,
    })

    const result = __testing.syncTaskPatrol(taskId, {
      now: 20_000,
      thresholds: {
        silentMs: 5_000,
        suspectedStuckMs: 10_000,
        abandonedMs: 30_000,
      },
    })

    const nextState = useAgentStore.getState()
    const task = nextState.executionTasks[taskId]
    const workPackage = nextState.workPackages[workPackageId]

    expect(result?.escalated).toBe(true)
    expect(task.patrol?.status).toBe('suspected-stuck')
    expect(task.state).toBe('blocked')
    expect(task.latestAdjudicationId).toBeTruthy()
    expect(workPackage.status).toBe('blocked')
    expect(workPackage.heartbeat?.status).toBe('suspected-stuck')
    expect(nextState.controllerState).toBe('paused')
    expect(Agent.abortAll).toHaveBeenCalledTimes(1)
  })

  it('keeps execution active when the detached thread still has recent tool activity', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Continue a long-running multi-agent task',
      specialists: ['logic'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })

    const state = useAgentStore.getState()
    const workPackageId = state.executionTasks[taskId].workPackages[0]
    const threadId = state.createThread()
    const staleHeartbeat = {
      ...createEmptyExecutionHeartbeatSnapshot(),
      status: 'active' as const,
      lastHeartbeatAt: 1_000,
      lastProgressAt: 1_000,
    }

    state.selectExecutionTask(taskId)
    state.updateExecutionTask(taskId, {
      state: 'running',
      patrol: {
        ...createInitialPatrolState(),
        status: 'active',
      },
      heartbeat: staleHeartbeat,
    })
    state.updateWorkPackage(workPackageId, {
      status: 'executing',
      threadId,
      heartbeat: staleHeartbeat,
    })
    useAgentStore.setState((store) => ({
      threads: {
        ...store.threads,
        [threadId]: {
          ...store.threads[threadId],
          lastModified: 19_500,
          streamState: { phase: 'tool_running' },
        },
      },
    }))

    const result = __testing.syncTaskPatrol(taskId, {
      now: 20_000,
      thresholds: {
        silentMs: 5_000,
        suspectedStuckMs: 10_000,
        abandonedMs: 30_000,
      },
    })

    const nextState = useAgentStore.getState()
    const task = nextState.executionTasks[taskId]
    const workPackage = nextState.workPackages[workPackageId]

    expect(result?.escalated).toBe(false)
    expect(task.patrol?.status).toBe('active')
    expect(task.state).toBe('running')
    expect(workPackage.status).toBe('executing')
    expect(workPackage.heartbeat?.status).toBe('active')
  })

})
