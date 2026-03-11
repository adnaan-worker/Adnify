import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setToolLoadingContextMock, sendMock } = vi.hoisted(() => ({
  setToolLoadingContextMock: vi.fn(),
  sendMock: vi.fn(async () => undefined),
}))

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    llm: {
      send: sendMock,
      abort: vi.fn(),
    },
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    agent: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

vi.mock('@shared/utils', () => ({
  performanceMonitor: {
    start: vi.fn(),
    end: vi.fn(),
  },
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
  isRetryableError: vi.fn(() => false),
}))

vi.mock('@store', () => ({
  useStore: {
    getState: vi.fn(() => ({
      promptTemplateId: undefined,
      language: 'zh',
      addToolCallLog: vi.fn(),
      agentConfig: {
        maxToolLoops: 3,
        enableAutoFix: false,
        enableLLMSummary: false,
        autoHandoff: false,
      },
    })),
  },
}))

vi.mock('@renderer/agent/tools', () => ({
  toolManager: {
    getAllToolDefinitions: vi.fn(() => []),
  },
  initializeToolProviders: vi.fn(),
  initializeTools: vi.fn(async () => undefined),
  setToolLoadingContext: setToolLoadingContextMock,
}))

vi.mock('@renderer/agent/tools/registry', () => ({
  toolRegistry: {
    execute: vi.fn(),
  },
}))

vi.mock('@renderer/agent/utils/AgentConfig', () => ({
  READ_TOOLS: [],
  getAgentConfig: vi.fn(() => ({
    maxRetries: 1,
    retryDelayMs: 0,
    retryBackoffMultiplier: 1,
    maxToolLoops: 3,
    autoHandoff: false,
    modePostProcessHooks: {},
  })),
}))

vi.mock('@renderer/agent/utils/LoopDetector', () => ({
  LoopDetector: class {
    checkLoop() {
      return { isLoop: false }
    }
  },
}))

vi.mock('@renderer/agent/core/stream', () => ({
  createStreamProcessor: vi.fn(() => ({
    wait: vi.fn(async () => ({
      content: 'done',
      toolCalls: [],
      usage: {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      },
    })),
    cleanup: vi.fn(),
  })),
}))

vi.mock('@renderer/agent/core/tools', () => ({
  executeTools: vi.fn(),
}))

vi.mock('@renderer/agent/context', () => ({
  generateSummary: vi.fn(),
  generateHandoffDocument: vi.fn(),
}))

vi.mock('@renderer/agent/context/CompressionManager', () => ({
  LEVEL_NAMES: ['L0', 'L1', 'L2', 'L3', 'L4'],
  updateStats: vi.fn(() => ({
    level: 0,
    ratio: 0.01,
    inputTokens: 1,
    outputTokens: 1,
  })),
  estimateMessagesTokens: vi.fn(() => 1),
}))

import { runLoop } from '@renderer/agent/core/loop'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { EventBus } from '@renderer/agent/core/EventBus'

describe('runLoop tool loading context', () => {
  beforeEach(() => {
    EventBus.clear()
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
    })
    setToolLoadingContextMock.mockClear()
    sendMock.mockClear()
  })

  it('passes orchestrator execution phase into tool loading context', async () => {
    const store = useAgentStore.getState()
    const threadId = store.createThread()
    store.switchThread(threadId)
    const assistantId = store.addAssistantMessage()

    await runLoop(
      {
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'test-key',
      },
      [{ role: 'user', content: 'Execute package' } as never],
      {
        workspacePath: '/workspace/adnify',
        chatMode: 'orchestrator',
        threadId,
        orchestratorPhase: 'executing',
      } as never,
      assistantId,
    )

    expect(setToolLoadingContextMock).toHaveBeenCalledWith({
      mode: 'orchestrator',
      templateId: undefined,
      orchestratorPhase: 'executing',
    })
  })
})
