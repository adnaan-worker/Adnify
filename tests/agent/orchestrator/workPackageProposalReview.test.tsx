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


  it('renders browser verification blocking details and disables apply for incomplete verification', () => {
    const html = renderToStaticMarkup(
      <ExecutionTaskPanel
        task={{
          id: 'task-2',
          objective: 'Validate settings readability',
          specialists: ['frontend', 'verifier', 'reviewer'],
          state: 'blocked',
          governanceState: 'awaiting-adjudication',
          risk: 'medium',
          executionTarget: 'isolated',
          trustMode: 'balanced',
          executionStrategy: createDefaultExecutionStrategySnapshot(),
          workPackages: ['pkg-browser'],
          sourceWorkspacePath: '/workspace/adnify',
          resolvedWorkspacePath: '/tmp/adnify-task-2',
          isolationMode: 'worktree',
          isolationStatus: 'ready',
          isolationError: null,
          queueSummary: createEmptyExecutionQueueSummary(),
          proposalSummary: {
            ...createEmptyProposalSummary(),
            pendingCount: 1,
          },
          latestHandoffId: null,
          latestProposalId: 'proposal-browser',
          latestAdjudicationId: null,
          budget: createDefaultTaskBudget(),
          rollback: {
            status: 'idle',
            proposal: null,
            lastUpdatedAt: null,
          },
          specialistProfilesSnapshot: createEmptySpecialistProfileSnapshot(['frontend', 'verifier', 'reviewer']),
          createdAt: 1,
          updatedAt: 1,
        }}
        workPackages={[
          {
            id: 'pkg-browser',
            taskId: 'task-2',
            title: 'Validate settings page in browser mode',
            objective: 'Validate settings page in browser mode',
            specialist: 'verifier',
            status: 'proposal-ready',
            targetDomain: 'verification',
            verificationMode: 'browser',
            writableScopes: ['src/renderer/components/settings'],
            readableScopes: ['src/renderer/components/settings'],
            dependsOn: [],
            expectedArtifacts: ['browser-checks'],
            queueReason: null,
            workspaceId: null,
            handoffId: null,
            proposalId: 'proposal-browser',
          },
        ]}
        handoffs={[]}
        changeProposals={[
          {
            id: 'proposal-browser',
            taskId: 'task-2',
            workPackageId: 'pkg-browser',
            summary: 'Browser verification blocked before execution',
            changedFiles: ['src/renderer/components/settings/tabs/AgentSettings.tsx'],
            verificationStatus: 'pending',
            verificationMode: 'browser',
            verificationSummary: 'Browser verification blocked before execution.',
            verificationBlockedReason: 'Playwright MCP server is not connected.',
            riskLevel: 'medium',
            recommendedAction: 'discard',
            status: 'pending',
            createdAt: 1,
            resolvedAt: null,
          },
        ]}
        selectedProposalId="proposal-browser"
        onSelectProposal={vi.fn()}
        onReviewProposal={vi.fn()}
      />,
    )

    expect(html).toContain('browser')
    expect(html).toContain('Browser verification blocked before execution')
    expect(html).toContain('Playwright MCP server is not connected.')
    expect(html).toContain('Manual review required before apply can continue.')
    expect(html).toContain('disabled')
  })
})
