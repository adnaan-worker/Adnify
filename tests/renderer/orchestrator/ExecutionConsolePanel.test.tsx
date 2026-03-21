import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { ExecutionTaskPanel } from '@renderer/components/orchestrator/ExecutionTaskPanel'
import {
  createDefaultExecutionStrategySnapshot,
  createDefaultTaskBudget,
  createEmptyExecutionQueueSummary,
  createEmptyProposalSummary,
  createEmptySpecialistProfileSnapshot,
} from '@renderer/agent/types/taskExecution'
import type { ChatThread } from '@renderer/agent/types/thread'

function buildRuntimeThread(): ChatThread {
  return {
    id: 'thread-1',
    createdAt: 1,
    lastModified: 2,
    messages: [
      {
        id: 'user-1',
        role: 'user',
        content: 'Wire the task board summary into the hybrid task session flow.',
        timestamp: 1,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        parts: [
          {
            type: 'text',
            content: 'Patched App shell and queued verification output.',
          },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tool-1',
              name: 'read_file',
              arguments: { path: 'src/renderer/App.tsx' },
              status: 'running',
            },
          },
        ],
        toolCalls: [
          {
            id: 'tool-1',
            name: 'read_file',
            arguments: { path: 'src/renderer/App.tsx' },
            status: 'running',
          },
        ],
      },
    ],
    contextItems: [],
    streamState: {
      phase: 'tool_running',
    },
    toolStreamingPreviews: {},
    compressionStats: null,
    contextSummary: null,
    handoffRequired: false,
    isCompacting: false,
    compressionPhase: 'idle',
  }
}

describe('ExecutionTaskPanel execution console', () => {
  beforeEach(() => {
    useAgentStore.setState({
      threads: {
        'thread-1': buildRuntimeThread(),
      },
      currentThreadId: 'thread-1',
    })
  })

  it('renders a unified execution console summary for runtime activity and verification state', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskPanel
        task={{
          id: 'task-1',
          objective: 'Review hybrid execution console state',
          specialists: ['logic', 'verifier'],
          state: 'verifying',
          governanceState: 'active',
          risk: 'medium',
          executionTarget: 'isolated',
          trustMode: 'balanced',
          executionStrategy: createDefaultExecutionStrategySnapshot(),
          workPackages: ['pkg-1'],
          sourceWorkspacePath: '/workspace/adnify',
          resolvedWorkspacePath: '/tmp/adnify-task-1',
          isolationMode: 'worktree',
          isolationStatus: 'ready',
          isolationError: null,
          queueSummary: createEmptyExecutionQueueSummary(),
          proposalSummary: {
            ...createEmptyProposalSummary(),
            pendingCount: 1,
          },
          latestHandoffId: null,
          latestProposalId: 'proposal-1',
          latestAdjudicationId: null,
          budget: createDefaultTaskBudget(),
          rollback: {
            status: 'idle',
            proposal: null,
            lastUpdatedAt: null,
          },
          specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['logic', 'verifier']),
          createdAt: 1,
          updatedAt: 2,
        }}
        workPackages={[
          {
            id: 'pkg-1',
            taskId: 'task-1',
            title: 'Wire execution console summary',
            objective: 'Wire execution console summary',
            specialist: 'logic',
            status: 'verifying',
            heartbeat: {
              status: 'active',
              lastHeartbeatAt: 2,
              lastAssistantOutputAt: 2,
              lastToolActivityAt: 2,
              lastProgressAt: 2,
              lastFileMutationAt: 2,
              stuckReason: null,
            },
            targetDomain: 'logic',
            writableScopes: ['src/renderer'],
            readableScopes: ['src/renderer'],
            dependsOn: [],
            expectedArtifacts: ['execution-console'],
            queueReason: null,
            workspaceId: '/tmp/adnify-task-1',
            threadId: 'thread-1',
            handoffId: null,
            proposalId: 'proposal-1',
          },
        ]}
        handoffs={[]}
        changeProposals={[
          {
            id: 'proposal-1',
            taskId: 'task-1',
            workPackageId: 'pkg-1',
            summary: 'Execution console changes are ready for review',
            changedFiles: ['src/renderer/components/orchestrator/ExecutionTaskPanel.tsx'],
            verificationStatus: 'passed',
            verificationMode: 'browser',
            verificationSummary: 'Browser flow passed.',
            riskLevel: 'medium',
            recommendedAction: 'apply',
            status: 'pending',
            createdAt: 1,
            resolvedAt: null,
          },
        ]}
        selectedProposalId="proposal-1"
        onSelectProposal={vi.fn()}
        onReviewProposal={vi.fn()}
      />,
    )

    expect(html).toContain('Execution Console')
    expect(html).toContain('Runtime Activity')
    expect(html).toContain('Tool activity')
    expect(html).toContain('read_file')
    expect(html).toContain('Latest assistant output')
    expect(html).toContain('Patched App shell and queued verification output.')
    expect(html).toContain('Verification Summary')
    expect(html).toContain('Browser flow passed.')
  })
})
