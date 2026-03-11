import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      store.appendToAssistant(assistantId, `completed:${threadId}`, threadId)
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
  getLLMConfigForTask: vi.fn(async () => ({ apiKey: 'test-key' })),
  getProviderModelContext: vi.fn(() => ({ providerId: 'openai', defaultModel: 'gpt-4.1', availableModels: ['gpt-4.1', 'gpt-4.1-mini'] })),
}))

import { useStore } from '@store'
import { Agent } from '@renderer/agent/core/Agent'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { __testing as executorTesting } from '@renderer/agent/services/orchestratorExecutor'
import type { TaskPlan } from '@renderer/agent/orchestrator/types'

describe('orchestrator executor parallel package execution', () => {
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
    useStore.setState((state) => ({
      ...state,
      llmConfig: {
        ...state.llmConfig,
        provider: 'openai',
        model: 'gpt-4.1',
      },
    }))
  })

  it('routes concurrent work packages through independent target threads', async () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Ship onboarding flow',
      specialists: ['frontend', 'logic'],
      executionTarget: 'current',
      sourceWorkspacePath: '/workspace/adnify',
    })
    const executionTask = useAgentStore.getState().executionTasks[taskId]
    const [frontendId, logicId] = executionTask.workPackages
    const frontendPackage = useAgentStore.getState().workPackages[frontendId]
    const logicPackage = useAgentStore.getState().workPackages[logicId]
    const plan: TaskPlan = {
      id: 'plan-1',
      name: 'Plan',
      createdAt: 1,
      updatedAt: 1,
      requirementsDoc: 'requirements.md',
      executionMode: 'parallel',
      status: 'approved',
      tasks: [],
    }

    const [frontendResult, logicResult] = await Promise.all([
      executorTesting.runWorkPackageWithAgent(frontendPackage, executionTask, plan, '/workspace/adnify'),
      executorTesting.runWorkPackageWithAgent(logicPackage, executionTask, plan, '/workspace/adnify'),
    ])

    const calls = vi.mocked(Agent.send).mock.calls
    const [frontendCall, logicCall] = calls
    const frontendThreadId = frontendCall?.[4]?.targetThreadId
    const logicThreadId = logicCall?.[4]?.targetThreadId

    expect(calls).toHaveLength(2)
    expect(frontendThreadId).toBeTruthy()
    expect(logicThreadId).toBeTruthy()
    expect(frontendThreadId).not.toBe(logicThreadId)
    expect(frontendCall?.[4]?.promptTemplateId).toBe('uiux-designer')
    expect(logicCall?.[4]?.promptTemplateId).toBe('coder')
    const frontendPackageThreadId = useAgentStore.getState().workPackages[frontendId].threadId
    const logicPackageThreadId = useAgentStore.getState().workPackages[logicId].threadId

    expect(frontendPackageThreadId).toBeTruthy()
    expect(logicPackageThreadId).toBeTruthy()
    expect(frontendPackageThreadId).toBe(frontendThreadId)
    expect(logicPackageThreadId).toBe(logicThreadId)
    expect(frontendResult.success).toBe(true)
    expect(logicResult.success).toBe(true)
    expect(new Set([frontendResult.output, logicResult.output])).toEqual(new Set([
      `completed:${frontendPackageThreadId}`,
      `completed:${logicPackageThreadId}`,
    ]))
  })
})
