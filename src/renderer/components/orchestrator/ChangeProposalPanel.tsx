import type { ChangeProposal, ProposalAction } from '@renderer/agent/types/taskExecution'

interface ChangeProposalPanelProps {
  proposal?: ChangeProposal | null
  onReview?: (proposalId: string, action: ProposalAction) => void
}

const REVIEW_ACTIONS: Array<{ action: ProposalAction; label: string }> = [
  { action: 'apply', label: 'Apply' },
  { action: 'return-for-rework', label: 'Return for Rework' },
  { action: 'reassign', label: 'Reassign' },
  { action: 'discard', label: 'Discard' },
]

export function ChangeProposalPanel({ proposal, onReview }: ChangeProposalPanelProps) {
  if (!proposal) {
    return (
      <aside className="rounded-xl border border-dashed border-border bg-surface/20 p-4 text-sm text-text-muted">
        选中一个变更提案后，这里会显示摘要、文件清单和审核动作。
      </aside>
    )
  }

  return (
    <aside className="rounded-xl border border-border bg-surface/30 p-4 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted">Proposal</div>
        <h3 className="text-sm font-semibold text-text-primary mt-1">{proposal.summary}</h3>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{proposal.verificationStatus}</span>
        <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{proposal.riskLevel}</span>
        <span className="px-2 py-1 rounded-full bg-accent/10 text-accent">{proposal.recommendedAction}</span>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">变更文件</div>
        <ul className="space-y-1 text-xs text-text-primary">
          {proposal.changedFiles.length > 0 ? proposal.changedFiles.map((file) => (
            <li key={file}>{file}</li>
          )) : <li className="text-text-muted">暂无文件变更</li>}
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {REVIEW_ACTIONS.map((item) => (
          <button
            key={item.action}
            type="button"
            onClick={() => onReview?.(proposal.id, item.action)}
            className="rounded-lg border border-border px-3 py-2 text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors"
          >
            {item.label}
          </button>
        ))}
      </div>
    </aside>
  )
}

export default ChangeProposalPanel
