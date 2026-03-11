import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ExecutionTaskPanel } from '@renderer/components/orchestrator/ExecutionTaskPanel'
import {
  createAdjudicationCase,
} from '@renderer/agent/services/coordinatorService'
import {
  createDefaultExecutionStrategySnapshot,
  createDefaultTaskBudget,
  createEmptyExecutionQueueSummary,
  createEmptyProposalSummary,
  createEmptySpecialistProfileSnapshot,
} from '@renderer/agent/types/taskExecution'
import {
  createRollbackProposal,
  createRollbackStateFromProposal,
} from '@renderer/agent/services/rollbackOrchestratorService'

describe('ExecutionTaskPanel', () => {
  it('shows specialists, active profile details, adjudication actions, and rollback actions', () => {
    const budget = createDefaultTaskBudget()
    budget.usage.llmCalls = 2
    budget.usage.commands = 1

    const adjudicationCase = createAdjudicationCase({
      id: 'adj-1',
      taskId: 'task-1',
      trigger: 'budget-trip',
      reason: 'Budget exceeded for commands',
      changedFiles: ['src/main/main.ts', 'src/renderer/App.tsx'],
    })

    const rollback = createRollbackStateFromProposal(createRollbackProposal({
      executionTarget: 'current',
      changedFiles: ['src/renderer/App.tsx'],
      externalSideEffects: ['npm install'],
    }), 7)

    const html = renderToStaticMarkup(
      <ExecutionTaskPanel
        task={{
          id: 'task-1',
          objective: 'Ship onboarding',
          specialists: ['frontend', 'logic'],
          state: 'running',
          governanceState: 'rollback-ready',
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
          proposalSummary: createEmptyProposalSummary(),
          latestHandoffId: null,
          latestProposalId: null,
          latestAdjudicationId: 'adj-1',
          budget,
          rollback,
          specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['frontend', 'logic'], {
            frontend: {
              model: 'gpt-4.1',
              toolPermission: 'workspace-write',
              styleHints: 'Prefer polished UI',
            },
            logic: {
              model: 'gpt-4.1-mini',
              toolPermission: 'workspace-write',
              styleHints: 'Prefer correctness',
            },
          }),
          createdAt: 1,
          updatedAt: 1,
        }}
        workPackages={[
          {
            id: 'pkg-1',
            taskId: 'task-1',
            title: 'Build onboarding UI',
            objective: 'Build onboarding UI',
            specialist: 'frontend',
            status: 'running',
            targetDomain: 'ui',
            writableScopes: ['src/renderer/components'],
            readableScopes: ['src/renderer'],
            dependsOn: [],
            expectedArtifacts: ['ui-updates'],
            queueReason: null,
            workspaceId: null,
            handoffId: null,
            proposalId: null,
          },
        ]}
        handoffs={[]}
        adjudicationCase={adjudicationCase}
        onResolveAdjudication={vi.fn()}
        onConfirmRollback={vi.fn()}
      />,
    )

    expect(html).toContain('frontend')
    expect(html).toContain('logic')
    expect(html).toContain('gpt-4.1')
    expect(html).toContain('Prefer polished UI')
    expect(html).toMatch(/running/i)
    expect(html).toMatch(/balanced/i)
    expect(html).toMatch(/budget/i)
    expect(html).toContain('LLM 2/24')
    expect(html).toMatch(/adjudication/i)
    expect(html).toMatch(/return-for-rework/i)
    expect(html).toMatch(/accept all/i)
    expect(html).toMatch(/accept selected/i)
    expect(html).toMatch(/reassign/i)
    expect(html).toMatch(/rollback/i)
    expect(html).toMatch(/mark rollback complete/i)
    expect(html).toMatch(/npm install/i)
  })


  it('shows queued blockers and task-level queue and proposal counters', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskPanel
        task={{
          id: 'task-2',
          objective: 'Coordinate renderer changes',
          specialists: ['frontend', 'logic'],
          state: 'running',
          governanceState: 'active',
          risk: 'medium',
          executionTarget: 'isolated',
          trustMode: 'balanced',
          executionStrategy: createDefaultExecutionStrategySnapshot(),
          workPackages: ['pkg-2'],
          sourceWorkspacePath: '/workspace/adnify',
          resolvedWorkspacePath: '/tmp/adnify-task-2',
          isolationMode: 'worktree',
          isolationStatus: 'ready',
          isolationError: null,
          queueSummary: {
            queuedCount: 1,
            activeLeaseCount: 1,
            blockedScopes: ['src/renderer/store'],
            updatedAt: 1,
          },
          proposalSummary: {
            pendingCount: 1,
            appliedCount: 0,
            returnedForReworkCount: 0,
            reassignedCount: 0,
            discardedCount: 0,
            updatedAt: 1,
          },
          latestHandoffId: null,
          latestProposalId: null,
          latestAdjudicationId: null,
          budget: createDefaultTaskBudget(),
          rollback: {
            status: 'idle',
            proposal: null,
            lastUpdatedAt: null,
          },
          specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['frontend', 'logic']),
          createdAt: 1,
          updatedAt: 1,
        }}
        workPackages={[
          {
            id: 'pkg-2',
            taskId: 'task-2',
            title: 'Wire queue state',
            objective: 'Wire queue state',
            specialist: 'logic',
            status: 'queued',
            targetDomain: 'logic',
            writableScopes: ['src/renderer/store'],
            readableScopes: ['src/renderer'],
            dependsOn: [],
            expectedArtifacts: ['state-updates'],
            queueReason: 'Waiting for pkg-owner',
            workspaceId: null,
            handoffId: null,
            proposalId: null,
          },
        ]}
        handoffs={[]}
      />,
    )

    expect(html).toContain('Queued 1')
    expect(html).toContain('Pending proposals 1')
    expect(html).toContain('Waiting for pkg-owner')
  })

})
