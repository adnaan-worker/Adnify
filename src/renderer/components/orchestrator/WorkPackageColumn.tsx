import type { ChangeProposal, TaskHandoff, WorkPackage } from '@renderer/agent/types/taskExecution'
import type { WorkPackageRuntimeActivity } from './workPackageRuntime'

interface WorkPackageColumnProps {
  workPackage: WorkPackage
  handoff?: TaskHandoff | null
  proposal?: ChangeProposal | null
  selected?: boolean
  activity?: WorkPackageRuntimeActivity | null
  onSelectHandoff?: (handoffId: string) => void
  onSelectProposal?: (proposalId: string) => void
  onSelectWorkPackage?: (workPackageId: string) => void
}

export function WorkPackageColumn({
  workPackage,
  handoff,
  proposal,
  selected = false,
  activity = null,
  onSelectHandoff,
  onSelectProposal,
  onSelectWorkPackage,
}: WorkPackageColumnProps) {
  const activityPreview = activity?.assistantPreview || (activity?.userPreview ? `已接收任务：${activity.userPreview}` : null)
  const showRuntimePreview = Boolean(activity && (activity.hasLiveOutput || workPackage.threadId))

  return (
    <article
      className={`rounded-xl border p-4 bg-surface/30 space-y-3 transition-colors ${selected ? 'border-accent shadow-lg shadow-accent/10' : 'border-border hover:border-accent/40'}`}
      onClick={() => onSelectWorkPackage?.(workPackage.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelectWorkPackage?.(workPackage.id)
        }
      }}
      role="button"
      tabIndex={0}
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

      {showRuntimePreview ? (
        <div className="rounded-lg border border-border/70 bg-background/40 px-3 py-2 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-text-secondary">执行进度</span>
            <span className="text-accent">{activity?.phaseLabel || '等待线程'}</span>
          </div>
          {activity?.toolPreview ? (
            <div className="text-[11px] text-text-secondary break-all">运行中工具：{activity.toolPreview}</div>
          ) : null}
          <div className="text-xs text-text-primary break-words">
            {activityPreview || '执行线程已创建，等待首条输出。'}
          </div>
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
          onClick={(event) => {
            event.stopPropagation()
            onSelectHandoff?.(handoff.id)
          }}
          className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors"
        >
          查看移交包
        </button>
      ) : showRuntimePreview ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onSelectWorkPackage?.(workPackage.id)
          }}
          className="w-full rounded-lg border border-border px-3 py-2 text-left text-xs text-text-primary hover:border-accent hover:bg-accent/5 transition-colors"
        >
          查看过程
        </button>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-text-muted">
          {workPackage.threadId ? '执行中，等待首条反馈。' : '暂无移交包'}
        </div>
      )}
    </article>
  )
}

export default WorkPackageColumn
