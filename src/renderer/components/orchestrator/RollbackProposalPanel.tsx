import type { TaskRollbackState } from '@renderer/agent/types/taskExecution'

interface RollbackProposalPanelProps {
  rollback: TaskRollbackState
  onConfirm?: () => void
}

export function RollbackProposalPanel({ rollback, onConfirm }: RollbackProposalPanelProps) {
  if (!rollback.proposal) {
    return null
  }

  return (
    <aside className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted">Rollback</div>
        <h3 className="text-sm font-semibold text-text-primary mt-1">{rollback.proposal.summary}</h3>
      </div>

      <div className="text-xs text-text-secondary">
        Requires confirmation: <span className="text-text-primary">{rollback.proposal.requiresConfirmation ? 'yes' : 'no'}</span>
      </div>

      {rollback.proposal.changedFiles.length > 0 ? (
        <ul className="space-y-1 text-xs text-text-primary">
          {rollback.proposal.changedFiles.map((file) => <li key={file}>{file}</li>)}
        </ul>
      ) : null}

      {rollback.proposal.externalSideEffects.length > 0 ? (
        <ul className="space-y-1 text-xs text-text-primary">
          {rollback.proposal.externalSideEffects.map((effect) => <li key={effect}>{effect}</li>)}
        </ul>
      ) : (
        <div className="text-xs text-text-muted">No external side effects recorded.</div>
      )}

      {rollback.status === 'rolled-back' ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200">Rollback marked complete.</div>
      ) : onConfirm ? (
        <button type="button" onClick={onConfirm} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-200">
          Mark rollback complete
        </button>
      ) : null}
    </aside>
  )
}

export default RollbackProposalPanel
