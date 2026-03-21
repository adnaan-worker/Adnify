import type { ChangeProposal, ProposalAction } from '@renderer/agent/types/taskExecution'
import { derivePatchBatchSummary } from '@renderer/agent/types/taskSession'

import { ChangeProposalPanel } from './ChangeProposalPanel'

interface PatchBatchPanelProps {
  proposals: ChangeProposal[]
  selectedProposalId?: string | null
  onSelectProposal?: (proposalId: string) => void
  onReviewProposal?: (proposalId: string, action: ProposalAction) => void
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function PatchBatchPanel({
  proposals,
  selectedProposalId,
  onSelectProposal,
  onReviewProposal,
}: PatchBatchPanelProps) {
  if (proposals.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-surface/20 p-4 text-sm text-text-muted">
        暂无可审阅的补丁批次。
      </section>
    )
  }

  const batch = derivePatchBatchSummary(proposals)
  const selectedProposal = proposals.find((proposal) => proposal.id === selectedProposalId) || proposals[0] || null
  const pendingProposals = proposals.filter((proposal) => proposal.status === 'pending')

  const handleApplyReadyBatch = () => {
    if (!batch.canApply) return
    for (const proposal of pendingProposals) {
      onReviewProposal?.(proposal.id, 'apply')
    }
  }

  return (
    <section className="space-y-4">
      <aside className="rounded-xl border border-border bg-surface/30 p-4 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">Patch Batch</div>
          <h3 className="text-sm font-semibold text-text-primary mt-1">Task review batch</h3>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">
            {pluralize(batch.totalProposals, 'proposal')}
          </span>
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">
            {pluralize(batch.changedFiles.length, 'file')}
          </span>
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">
            {batch.verificationStatus}
          </span>
        </div>

        {!batch.canApply ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
            Apply blocked until every pending proposal passes verification and conflict checks.
          </div>
        ) : null}

        <button
          type="button"
          disabled={!batch.canApply}
          onClick={handleApplyReadyBatch}
          className="rounded-lg border border-border px-3 py-2 text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply Ready Batch
        </button>

        <div className="space-y-2">
          <div className="text-xs font-medium text-text-secondary">Proposals</div>
          <div className="space-y-2">
            {proposals.map((proposal) => (
              <button
                key={proposal.id}
                type="button"
                onClick={() => onSelectProposal?.(proposal.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                  proposal.id === selectedProposal?.id
                    ? 'border-accent bg-accent/10 text-text-primary'
                    : 'border-border bg-background/40 text-text-secondary hover:border-accent hover:bg-accent/5'
                }`}
              >
                <div className="font-medium text-inherit">{proposal.summary}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <span>{proposal.verificationStatus}</span>
                  <span>{proposal.status}</span>
                  <span>{pluralize(proposal.changedFiles.length, 'file')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <ChangeProposalPanel proposal={selectedProposal} onReview={onReviewProposal} />
    </section>
  )
}

export default PatchBatchPanel
