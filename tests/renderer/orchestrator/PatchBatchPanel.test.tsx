import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { PatchBatchPanel } from '@renderer/components/orchestrator/PatchBatchPanel'
import type { ChangeProposal } from '@renderer/agent/types/taskExecution'

function buildProposal(id: string, overrides: Partial<ChangeProposal> = {}): ChangeProposal {
  return {
    id,
    taskId: 'task-1',
    workPackageId: `wp-${id}`,
    summary: `Proposal ${id}`,
    changedFiles: ['src/renderer/App.tsx'],
    verificationStatus: 'passed',
    verificationMode: 'regression',
    verificationSummary: 'Checks passed.',
    verificationBlockedReason: null,
    verificationProvider: null,
    riskLevel: 'medium',
    recommendedAction: 'apply',
    status: 'pending',
    applyError: null,
    conflictFiles: [],
    createdAt: 1,
    resolvedAt: null,
    ...overrides,
  }
}

describe('PatchBatchPanel', () => {
  it('renders aggregate review state and blocks batch apply when any proposal is unverified or conflicted', () => {
    const html = renderToStaticMarkup(
      <PatchBatchPanel
        proposals={[
          buildProposal('proposal-1', {
            changedFiles: ['src/renderer/App.tsx', 'src/renderer/components/panels/ComposerPanel.tsx'],
            verificationStatus: 'pending',
            verificationBlockedReason: 'Waiting for regression verification.',
          }),
          buildProposal('proposal-2', {
            changedFiles: ['src/renderer/components/orchestrator/ExecutionTaskPanel.tsx'],
            verificationStatus: 'passed',
            conflictFiles: ['src/renderer/components/orchestrator/ExecutionTaskPanel.tsx'],
          }),
        ]}
        selectedProposalId="proposal-1"
        onSelectProposal={vi.fn()}
        onReviewProposal={vi.fn()}
      />,
    )

    expect(html).toContain('Patch Batch')
    expect(html).toContain('2 proposals')
    expect(html).toContain('3 files')
    expect(html).toContain('Apply Ready Batch')
    expect(html).toContain('Apply blocked until every pending proposal passes verification and conflict checks.')
    expect(html).toContain('Proposal proposal-1')
    expect(html).toContain('Proposal proposal-2')
    expect(html).toContain('disabled')
  })

  it('enables batch apply when every pending proposal is verified and conflict-free', () => {
    const html = renderToStaticMarkup(
      <PatchBatchPanel
        proposals={[
          buildProposal('proposal-1', {
            changedFiles: ['src/renderer/App.tsx'],
            verificationMode: 'browser',
          }),
          buildProposal('proposal-2', {
            changedFiles: ['src/renderer/components/panels/ComposerPanel.tsx'],
            verificationMode: 'browser',
          }),
        ]}
        selectedProposalId="proposal-1"
        onSelectProposal={vi.fn()}
        onReviewProposal={vi.fn()}
      />,
    )

    expect(html).toContain('2 proposals')
    expect(html).toContain('2 files')
    expect(html).toContain('passed')
    expect(html).not.toContain('Apply blocked until every pending proposal passes verification and conflict checks.')
  })
})
