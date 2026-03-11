import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ExecutionTaskPanel } from '@renderer/components/orchestrator/ExecutionTaskPanel'
import { ChangeProposalPanel } from '@renderer/components/orchestrator/ChangeProposalPanel'
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

  it('renders conflict-blocked proposal state with manual-review guidance', () => {
    const html = renderToStaticMarkup(
      <ChangeProposalPanel
        proposal={{
          id: 'proposal-2',
          taskId: 'task-1',
          workPackageId: 'pkg-2',
          summary: 'Renderer package needs adjudication',
          changedFiles: ['src/renderer/App.tsx'],
          verificationStatus: 'passed',
          riskLevel: 'low',
          recommendedAction: 'apply',
          status: 'pending',
          applyError: 'Main workspace changed during package review',
          conflictFiles: ['src/renderer/App.tsx'],
          createdAt: 1,
          resolvedAt: null,
        }}
        onReview={vi.fn()}
      />,
    )

    expect(html).toContain('Conflict blocked')
    expect(html).toContain('Manual review required before apply can continue.')
    expect(html).toContain('Main workspace changed during package review')
    expect(html).toContain('src/renderer/App.tsx')
    expect(html).toContain('disabled')
  })

  it('renders applied proposals as resolved state', () => {
    const html = renderToStaticMarkup(
      <ChangeProposalPanel
        proposal={{
          id: 'proposal-3',
          taskId: 'task-1',
          workPackageId: 'pkg-3',
          summary: 'Applied renderer package',
          changedFiles: ['src/renderer/App.tsx'],
          verificationStatus: 'passed',
          riskLevel: 'low',
          recommendedAction: 'apply',
          status: 'applied',
          createdAt: 1,
          resolvedAt: 2,
        }}
        onReview={vi.fn()}
      />,
    )

    expect(html).toContain('Applied to main workspace.')
    expect(html).toContain('Proposal resolved as applied.')
    expect(html).not.toContain('Return for Rework')
  })


  it('keeps autonomy diagnostics visible while reviewing a blocked proposal', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskPanel
        task={{
          id: 'task-3',
          objective: 'Review blocked proposal with autonomy context',
          specialists: ['verifier', 'reviewer'],
          autonomyMode: 'autonomous',
          state: 'blocked',
          governanceState: 'awaiting-adjudication',
          patrol: {
            status: 'abandoned',
            lastCheckedAt: 50,
            lastTransitionAt: 50,
            reason: 'Execution heartbeat missing for 30s.',
          },
          heartbeat: {
            status: 'abandoned',
            lastHeartbeatAt: 10,
            lastAssistantOutputAt: 5,
            lastToolActivityAt: 10,
            lastProgressAt: 0,
            lastFileMutationAt: null,
            stuckReason: 'Execution heartbeat missing for 30s.',
          },
          recoveryCheckpoint: {
            status: 'ready',
            lastSafeWorkPackageId: null,
            lastProposalId: 'proposal-autonomy',
            lastHandoffId: null,
            resumeCandidateWorkPackageIds: ['pkg-autonomy'],
            updatedAt: 50,
          },
          risk: 'medium',
          executionTarget: 'isolated',
          trustMode: 'balanced',
          executionStrategy: createDefaultExecutionStrategySnapshot(),
          workPackages: ['pkg-autonomy'],
          sourceWorkspacePath: '/workspace/adnify',
          resolvedWorkspacePath: '/tmp/adnify-task-3',
          isolationMode: 'worktree',
          isolationStatus: 'ready',
          isolationError: null,
          queueSummary: createEmptyExecutionQueueSummary(),
          proposalSummary: {
            ...createEmptyProposalSummary(),
            pendingCount: 1,
          },
          latestHandoffId: null,
          latestProposalId: 'proposal-autonomy',
          latestAdjudicationId: null,
          budget: createDefaultTaskBudget(),
          rollback: {
            status: 'idle',
            proposal: null,
            lastUpdatedAt: null,
          },
          specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['verifier', 'reviewer']),
          createdAt: 1,
          updatedAt: 1,
        }}
        workPackages={[
          {
            id: 'pkg-autonomy',
            taskId: 'task-3',
            title: 'Recover blocked proposal',
            objective: 'Recover blocked proposal',
            specialist: 'reviewer',
            status: 'proposal-ready',
            heartbeat: {
              status: 'abandoned',
              lastHeartbeatAt: 10,
              lastAssistantOutputAt: 5,
              lastToolActivityAt: 10,
              lastProgressAt: 0,
              lastFileMutationAt: null,
              stuckReason: 'Execution heartbeat missing for 30s.',
            },
            targetDomain: 'review',
            writableScopes: ['src/renderer/components'],
            readableScopes: ['src/renderer/components'],
            dependsOn: [],
            expectedArtifacts: ['review'],
            queueReason: null,
            workspaceId: '/tmp/adnify-task-3',
            handoffId: null,
            proposalId: 'proposal-autonomy',
          },
        ]}
        handoffs={[]}
        changeProposals={[
          {
            id: 'proposal-autonomy',
            taskId: 'task-3',
            workPackageId: 'pkg-autonomy',
            summary: 'Autonomy proposal blocked for review',
            changedFiles: ['src/renderer/components/orchestrator/TaskBoard.tsx'],
            verificationStatus: 'pending',
            riskLevel: 'medium',
            recommendedAction: 'return-for-rework',
            status: 'pending',
            createdAt: 1,
            resolvedAt: null,
          },
        ]}
        selectedProposalId="proposal-autonomy"
        onSelectProposal={vi.fn()}
        onReviewProposal={vi.fn()}
      />,
    )

    expect(html).toContain('autonomous')
    expect(html).toContain('abandoned')
    expect(html).toContain('/tmp/adnify-task-3')
    expect(html).toContain('worktree')
    expect(html).toContain('Execution heartbeat missing for 30s.')
  })
})
