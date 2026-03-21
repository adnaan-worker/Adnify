import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const { mockStoreState, useStoreMock } = vi.hoisted(() => {
  const storeState = {
    openFiles: [
      {
        path: 'src/renderer/App.tsx',
        content: 'export function App() { return null }',
      },
    ],
    activeFilePath: 'src/renderer/App.tsx',
    llmConfig: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
    },
    updateFileContent: vi.fn(),
    language: 'en' as const,
    currentTheme: 'dark',
  }

  const storeMock = ((selector: (state: typeof storeState) => unknown) => selector(storeState)) as typeof import('@store').useStore
  storeMock.getState = () => storeState as never

  return {
    mockStoreState: storeState,
    useStoreMock: storeMock,
  }
})

vi.mock('@store', () => ({
  useStore: useStoreMock,
}))

vi.mock('zustand/react/shallow', () => ({
  useShallow: (selector: unknown) => selector,
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      read: vi.fn(async () => ''),
      write: vi.fn(async () => true),
      delete: vi.fn(async () => true),
      mkdir: vi.fn(async () => true),
    },
    llm: {
      onStream: vi.fn(() => () => undefined),
      onDone: vi.fn(() => () => undefined),
      onError: vi.fn(() => () => undefined),
      send: vi.fn(async () => undefined),
    },
  },
}))

vi.mock('@utils/Logger', () => ({
  logger: {
    ui: {
      error: vi.fn(),
      info: vi.fn(),
    },
    agent: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}))

vi.mock('@renderer/agent/services/composerService', () => ({
  composerService: {
    getState: () => ({
      currentSession: null,
      sessions: [],
      isProcessing: false,
    }),
    subscribe: () => () => undefined,
    startSession: vi.fn(),
    addChange: vi.fn(),
    getChangesGroupedByDirectory: () => new Map(),
    getSummary: () => ({
      total: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
    }),
    acceptChange: vi.fn(async () => true),
    rejectChange: vi.fn(async () => true),
    acceptAll: vi.fn(async () => ({
      accepted: 0,
      failed: 0,
    })),
    rejectAll: vi.fn(async () => ({
      rejected: 0,
    })),
  },
}))

vi.mock('@renderer/settings', () => ({
  getEditorConfig: () => ({
    fontSize: 14,
    fontFamily: 'Fira Code',
  }),
}))

vi.mock('@components/ui', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import ComposerPanel from '@renderer/components/panels/ComposerPanel'

describe('ComposerPanel task session entry', () => {
  it('renders a task-first planning entry with success criteria and context affordances', () => {
    const html = renderToStaticMarkup(
      <ComposerPanel
        onClose={vi.fn()}
        defaultMode="task"
        initialTaskDraft={{
          goal: 'Ship the hybrid task session flow',
          successCriteria: 'Review gates stay visible before apply.',
          contextNote: 'Focus on renderer orchestrator panels.',
        }}
      />,
    )

    expect(html).toContain('Task Session')
    expect(html).toContain('Goal')
    expect(html).toContain('Ship the hybrid task session flow')
    expect(html).toContain('Success Criteria')
    expect(html).toContain('Review gates stay visible before apply.')
    expect(html).toContain('Context Attachments')
    expect(html).toContain('Use open files as context')
    expect(html).toContain('Generate Plan')
    expect(html).toContain('Patch Review')
  })

  it('renders patch review mode while preserving the existing multi-file edit surface', () => {
    const html = renderToStaticMarkup(
      <ComposerPanel
        onClose={vi.fn()}
        defaultMode="review"
      />,
    )

    expect(html).toContain('Generate Plan')
    expect(html).toContain('Patch Review')
    expect(html).toContain('Files to edit')
    expect(html).toContain('Generate Edits')
    expect(html).not.toContain('Success Criteria')
  })
})
