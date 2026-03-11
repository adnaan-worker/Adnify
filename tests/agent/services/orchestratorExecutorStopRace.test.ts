import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  completeLateRun: null as null | (() => Promise<void>),
  lastThreadId: null as string | null,
}))

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
    git: {
      execSecure: vi.fn(),
    },
    llm: {
      abort: vi.fn(),
    },
    lsp: {
      onDiagnostics: vi.fn(() => () => undefined),
    },
  },
}))

vi.mock('@renderer/agent/services/llmConfigService', () => ({
  getLLMConfigForTask: vi.fn(async () => ({ apiKey: 'test-key' })),
  getProviderModelContext: vi.fn(() => ({
    providerId: 'openai',
    defaultModel: 'gpt-4.1',
    availableModels: ['gpt-4.1'],
  })),
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
      store.appendToAssistant(assistantId, `working:${threadId}`, threadId)
      store.finalizeAssistant(assistantId, threadId)
      mockState.lastThreadId = threadId
      mockState.completeLateRun = async () => {
        EventBus.emit({ type: 'loop:end', reason: 'complete', threadId })
      }
    }),
    abort: vi.fn(),
    abortAll: vi.fn(),
  },
}))

import { api } from '@renderer/services/electronAPI'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { startPlanExecution, stopPlanExecution } from '@renderer/agent/services/orchestratorExecutor'
import { gitService } from '@renderer/agent/services/gitService'
import { useStore } from '@store'

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitFor(assertion: () => void, attempts = 20): Promise<void> {
  let lastError: unknown = null

  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await flushTimers()
    }
  }

  throw lastError instanceof Error ? lastError : new Error('waitFor timed out')
}

describe('orchestrator executor stop race handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.completeLateRun = null
    mockState.lastThreadId = null

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
      adjudicationCases: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
      selectedChangeProposalId: null,
    })

    useStore.setState((state) => ({
      ...state,
      llmConfig: {
        ...state.llmConfig,
        provider: 'openai',
        model: 'gpt-4.1',
      },
      taskTrustSettings: {
        ...state.taskTrustSettings,
        global: {
          ...state.taskTrustSettings.global,
          mode: 'balanced',
          defaultExecutionTarget: 'current',
        },
      },
    }))

    gitService.setWorkspace('/workspace/adnify')
    vi.mocked(api.file.read).mockResolvedValue('')
    vi.mocked(api.file.exists).mockResolvedValue(true)
    vi.mocked(api.git.execSecure).mockResolvedValue({ success: true, stdout: '', stderr: '', exitCode: 0 })
  })

  it('ignores late work package completion from a stopped run and restarts cleanly', async () => {
    const store = useAgentStore.getState()
    const planId = 'plan-stop-race'

    store.addPlan({
      id: planId,
      name: 'Stop race plan',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      requirementsDoc: 'requirements.md',
      executionMode: 'sequential',
      status: 'approved',
      tasks: [
        {
          id: 'task-1',
          title: 'Inspect workspace',
          description: 'Audit the current project tree',
          provider: 'openai',
          model: 'gpt-4.1',
          role: 'coder',
          dependencies: [],
          status: 'pending',
        },
      ],
    })
    store.setActivePlan(planId)

    const started = await startPlanExecution(planId)
    expect(started.success).toBe(true)

    await waitFor(() => {
      const state = useAgentStore.getState()
      const executionTaskId = state.activeExecutionTaskId
      expect(executionTaskId).toBeTruthy()
      const [workPackageId] = state.executionTasks[executionTaskId!].workPackages
      expect(state.workPackages[workPackageId].status).toBe('executing')
      expect(state.workPackages[workPackageId].threadId).toBeTruthy()
      expect(state.workPackages[workPackageId].heartbeat?.status).toBe('active')
      expect(state.executionTasks[executionTaskId!].heartbeat?.status).toBe('active')
      expect(mockState.completeLateRun).toBeTypeOf('function')
    })

    const executionTaskId = useAgentStore.getState().activeExecutionTaskId!
    const [workPackageId] = useAgentStore.getState().executionTasks[executionTaskId].workPackages

    await stopPlanExecution()

    const stoppedState = useAgentStore.getState()
    expect(stoppedState.isExecuting).toBe(false)
    expect(stoppedState.controllerState).toBe('idle')
    expect(stoppedState.plans.find((plan) => plan.id === planId)?.status).toBe('paused')
    expect(stoppedState.workPackages[workPackageId].status).toBe('queued')
    expect(stoppedState.workPackages[workPackageId].threadId).toBeNull()
    expect(stoppedState.workPackages[workPackageId].heartbeat?.status).toBe('idle')
    expect(stoppedState.executionTasks[executionTaskId].heartbeat?.status).toBe('idle')

    await mockState.completeLateRun?.()
    await flushTimers()

    const stateAfterLateCompletion = useAgentStore.getState()
    expect(stateAfterLateCompletion.workPackages[workPackageId].status).toBe('queued')
    expect(Object.keys(stateAfterLateCompletion.changeProposals)).toHaveLength(0)
    expect(Object.keys(stateAfterLateCompletion.taskHandoffs)).toHaveLength(0)
    expect(stateAfterLateCompletion.executionTasks[executionTaskId].state).toBe('planning')

    const restarted = await startPlanExecution(planId)
    expect(restarted.success).toBe(true)

    await waitFor(() => {
      const state = useAgentStore.getState()
      expect(state.isExecuting).toBe(true)
      expect(state.workPackages[workPackageId].status).toBe('executing')
      expect(state.workPackages[workPackageId].threadId).toBeTruthy()
    })
  })
})
