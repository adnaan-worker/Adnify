import { beforeEach, describe, expect, it, vi } from 'vitest'

const runLoopMock = vi.fn(async () => undefined)

vi.mock('@renderer/agent/core/loop', () => ({
  runLoop: runLoopMock,
}))

vi.mock('@renderer/agent/llm/MessageBuilder', () => ({
  buildContextContent: vi.fn(async () => ''),
  buildLLMMessages: vi.fn(async () => []),
}))

vi.mock('@renderer/agent/prompts/PromptBuilder', () => ({
  buildAgentSystemPrompt: vi.fn(async () => 'system-prompt'),
}))

vi.mock('@renderer/agent/services/fileCacheService', () => ({
  fileCacheService: {
    clear: vi.fn(),
    getStats: vi.fn(() => ({})),
    hasValidCache: vi.fn(() => false),
    markFileAsRead: vi.fn(),
    getFileHash: vi.fn(() => null),
  },
}))

vi.mock('@renderer/services/electronAPI', () => ({
  api: {
    llm: {
      send: vi.fn(),
      abort: vi.fn(),
    },
    lsp: {
      onDiagnostics: vi.fn(() => () => undefined),
    },
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
  },
}))

import { Agent } from '@renderer/agent/core/Agent'
import { EventBus } from '@renderer/agent/core/EventBus'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

function waitForLoopEnd(threadId: string, timeoutMs = 50) {
  return new Promise<{ reason: string; threadId?: string }>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for loop:end on ${threadId}`))
    }, timeoutMs)

    const unsubscribe = EventBus.on('loop:end', (event) => {
      if (event.threadId !== threadId) {
        return
      }

      clearTimeout(timeoutId)
      unsubscribe()
      resolve(event)
    })
  })
}

describe('Agent orchestrator context', () => {
  beforeEach(() => {
    EventBus.clear()
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
    })
    runLoopMock.mockClear()
  })

  it('passes orchestrator execution phase into the loop context', async () => {
    await Agent.send(
      'Execute orchestrator phase',
      {
        provider: 'openai',
        model: 'gpt-5',
        apiKey: 'test-key',
      },
      '/workspace/adnify',
      'orchestrator',
      { orchestratorPhase: 'executing' },
    )

    expect(runLoopMock).toHaveBeenCalledTimes(1)
    expect(runLoopMock.mock.calls[0]?.[2]).toMatchObject({
      chatMode: 'orchestrator',
      orchestratorPhase: 'executing',
      workspacePath: '/workspace/adnify',
    })
  })
})

describe('Agent detached-thread completion signaling', () => {
  beforeEach(() => {
    EventBus.clear()
    useAgentStore.setState({
      threads: {},
      currentThreadId: null,
    })
    runLoopMock.mockClear()
  })

  it('emits loop:end for targetThreadId when preflight validation fails', async () => {
    const store = useAgentStore.getState()
    const mainThreadId = store.createThread()
    const targetThreadId = store.createThread()
    store.switchThread(mainThreadId)

    const loopEndPromise = waitForLoopEnd(targetThreadId)

    await Agent.send(
      'Run detached package',
      {
        provider: 'openai',
        model: 'gpt-5',
        apiKey: '',
      },
      '/workspace/adnify',
      'agent',
      { targetThreadId },
    )

    await expect(loopEndPromise).resolves.toMatchObject({
      reason: 'error',
      threadId: targetThreadId,
    })

    const latestState = useAgentStore.getState()
    const targetAssistantMessages = latestState.threads[targetThreadId]?.messages.filter(
      (message) => message.role === 'assistant',
    ) ?? []
    const mainAssistantMessages = latestState.threads[mainThreadId]?.messages.filter(
      (message) => message.role === 'assistant',
    ) ?? []

    expect(targetAssistantMessages).toHaveLength(1)
    expect(targetAssistantMessages[0]?.content).toContain('Please configure your API key in settings.')
    expect(mainAssistantMessages).toHaveLength(0)
  })
})
