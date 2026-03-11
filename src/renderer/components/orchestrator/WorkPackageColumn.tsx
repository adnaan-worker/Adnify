import type { ChangeProposal, TaskHandoff, WorkPackage } from '@renderer/agent/types/taskExecution'

interface WorkPackageColumnProps {
  workPackage: WorkPackage
  handoff?: TaskHandoff | null
  proposal?: ChangeProposal | null
  selected?: boolean
  onSelectHandoff?: (handoffId: string) => void
  onSelectProposal?: (proposalId: string) => void
}

export function WorkPackageColumn({
  workPackage,
  handoff,
  proposal,
  selected = false,
  onSelectHandoff,
  onSelectProposal,
}: WorkPackageColumnProps) {
  return (
    <article
      className={`rounded-xl border p-4 bg-surface/30 space-y-3 ${selected ? 'border-accent shadow-lg shadow-accent/10' : 'border-border'}`}
    >
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-text-muted">{workPackage.specialist}</div>
        <h3 className="text-sm font-semibold text-text-primary">{workPackage.title}</h3>
        <div className="text-xs text-text-secondary">{workPackage.status}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="px-2 py-1 rounded-full bg-background/60 text-[11px] text-text-secondary">
          {workPackage.targetDomain}
        </span>
        {workPackage.verificationMode ? (
          <span className="px-2 py-1 rounded-full bg-amber-500/10 text-[11px] text-amber-200">
            {workPackage.verificationMode}
          </span>
        ) : null}
        {workPackage.writableScopes.map((scope) => (
          <span key={scope} className="px-2 py-1 rounded-full bg-accent/10 text-[11px] text-accent">
            {scope}
          </span>
        ))}
      </div>

      {workPackage.queueReason ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {workPackage.queueReason}
        </div>
      ) : null}

      {proposal ? (
        <button
          type="button"
          onClick={() => onSelectProposal?.(proposal.id)}
          className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors"
        >
          Review proposal
        </button>
      ) : handoff ? (
        <button
          type="button"
          onClick={() => onSelectHandoff?.(handoff.id)}
          className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors"
        >
          查看移交包
        </button>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
          暂无移交包
        </div>
      )}
    </article>
  )
}

export default WorkPackageColumn
