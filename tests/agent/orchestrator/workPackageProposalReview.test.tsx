import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ExecutionTaskPanel } from '@renderer/components/orchestrator/ExecutionTaskPanel'
import {
  createDefaultExecutionStrategySnapshot,
  createDefaultTaskBudget,
  createEmptyExecutionQueueSummary,
  createEmptyProposalSummary,
  createEmptySpecialistProfileSnapshot,
} from '@renderer/agent/types/taskExecution'

describe('work package proposal review', () => {
  it('renders proposal details and review actions for proposal-ready packages', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskPanel
        task={{
          id: 'task-1',
          objective: 'Coordinate renderer changes',
          specialists: ['frontend', 'logic'],
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
          specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['frontend', 'logic']),
          createdAt: 1,
          updatedAt: 1,
        }}
        workPackages={[
          {
            id: 'pkg-1',
            taskId: 'task-1',
            title: 'Wire queue state',
            objective: 'Wire queue state',
            specialist: 'logic',
            status: 'proposal-ready',
            targetDomain: 'logic',
            writableScopes: ['src/renderer/store'],
            readableScopes: ['src/renderer'],
            dependsOn: [],
            expectedArtifacts: ['state-updates'],
            queueReason: null,
            workspaceId: null,
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
            summary: 'Logic package is ready for review',
            changedFiles: ['src/renderer/store/index.ts'],
            verificationStatus: 'passed',
            riskLevel: 'low',
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

    expect(html).toContain('Logic package is ready for review')
    expect(html).toContain('src/renderer/store/index.ts')
    expect(html).toContain('Apply')
    expect(html).toContain('Return for Rework')
    expect(html).toContain('Reassign')
    expect(html).toContain('Discard')
  })
})
