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

function formatProposalStatus(status: ChangeProposal['status']): string {
  return status.replace(/-/g, ' ')
}

export function ChangeProposalPanel({ proposal, onReview }: ChangeProposalPanelProps) {
  if (!proposal) {
    return (
      <aside className="rounded-xl border border-dashed border-border bg-surface/20 p-4 text-sm text-text-muted">
        选中一个变更提案后，这里会显示摘要、文件清单和审核动作。
      </aside>
    )
  }

  const hasConflict = (proposal.conflictFiles?.length ?? 0) > 0
  const verificationBlocked = proposal.verificationStatus !== 'passed'
  const isResolved = proposal.status !== 'pending'

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
        <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{formatProposalStatus(proposal.status)}</span>
      </div>

      {proposal.status === 'applied' ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          Applied to main workspace.
        </div>
      ) : null}

      {hasConflict ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 space-y-2 text-xs text-amber-100">
          <div className="font-medium text-amber-200">Conflict blocked</div>
          <div>Manual review required before apply can continue.</div>
          {proposal.applyError ? <div>{proposal.applyError}</div> : null}
          <div>
            <div className="font-medium text-amber-200">Conflict files</div>
            <ul className="mt-1 space-y-1">
              {(proposal.conflictFiles || []).map((file) => <li key={file}>{file}</li>)}
            </ul>
          </div>
        </div>
      ) : null}


      {proposal.verificationMode || proposal.verificationSummary || proposal.verificationBlockedReason ? (
        <div className={`rounded-lg border p-3 space-y-2 text-xs ${verificationBlocked ? 'border-amber-500/20 bg-amber-500/10 text-amber-100' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'}`}>
          <div className="font-medium">Verification</div>
          <div>{proposal.verificationMode ? `Mode: ${proposal.verificationMode}` : `Status: ${proposal.verificationStatus}`}</div>
          {proposal.verificationSummary ? <div>{proposal.verificationSummary}</div> : null}
          {proposal.verificationBlockedReason ? <div>{proposal.verificationBlockedReason}</div> : null}
          {verificationBlocked ? <div>Manual review required before apply can continue.</div> : null}
        </div>
      ) : null}

      {!hasConflict && proposal.applyError ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">
          {proposal.applyError}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">变更文件</div>
        <ul className="space-y-1 text-xs text-text-primary">
          {proposal.changedFiles.length > 0 ? proposal.changedFiles.map((file) => (
            <li key={file}>{file}</li>
          )) : <li className="text-text-muted">暂无文件变更</li>}
        </ul>
      </div>

      {isResolved ? (
        <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-text-secondary">
          Proposal resolved as {formatProposalStatus(proposal.status)}.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {REVIEW_ACTIONS.map((item) => {
            const disabled = item.action === 'apply' && (hasConflict || verificationBlocked)
            return (
              <button
                key={item.action}
                type="button"
                disabled={disabled}
                onClick={() => onReview?.(proposal.id, item.action)}
                className="rounded-lg border border-border px-3 py-2 text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </aside>
  )
}

export default ChangeProposalPanel
