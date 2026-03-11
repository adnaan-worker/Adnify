import type { TaskHandoff, WorkPackage } from '@renderer/agent/types/taskExecution'
import type { WorkPackageRuntimeActivity } from './workPackageRuntime'

interface HandoffDetailPanelProps {
  handoff?: TaskHandoff | null
  workPackage?: WorkPackage | null
  activity?: WorkPackageRuntimeActivity | null
}

export function HandoffDetailPanel({ handoff, workPackage, activity = null }: HandoffDetailPanelProps) {
  if (!handoff && !workPackage) {
    return (
      <aside className="rounded-xl border border-dashed border-border bg-surface/20 p-4 text-sm text-text-muted">
        选中一个移交包后，这里会显示变更摘要、文件清单和待处理事项。
      </aside>
    )
  }

  if (!handoff && workPackage) {
    return (
      <aside className="rounded-xl border border-border bg-surface/30 p-4 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">执行过程</div>
          <h3 className="text-sm font-semibold text-text-primary mt-1">{workPackage.title}</h3>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{workPackage.specialist}</span>
          <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">{workPackage.status}</span>
          {activity ? <span className="px-2 py-1 rounded-full bg-accent/10 text-accent">{activity.phaseLabel}</span> : null}
          {activity?.messageCount ? <span className="px-2 py-1 rounded-full bg-background/60 text-text-secondary">消息 {activity.messageCount}</span> : null}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-text-secondary">最新输出</div>
          <div className="rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-text-primary break-words">
            {activity?.assistantPreview || '暂时还没有助手输出。'}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-text-secondary">运行中工具</div>
          <div className="rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-text-primary break-words">
            {activity?.toolPreview || '当前没有可见的工具调用。'}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-text-secondary">原始任务</div>
          <div className="rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-text-primary break-words">
            {activity?.userPreview || workPackage.objective}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-text-secondary">工作区</div>
          <div className="rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-text-primary break-all">
            {workPackage.workspaceId || '暂无工作区路径'}
          </div>
        </div>

        {(workPackage.heartbeat?.stuckReason || activity?.stuckReason) ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-text-secondary">卡住原因</div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100 break-words">
              {workPackage.heartbeat?.stuckReason || activity?.stuckReason}
            </div>
          </div>
        ) : null}
      </aside>
    )
  }

  const resolvedHandoff = handoff as TaskHandoff

  return (
    <aside className="rounded-xl border border-border bg-surface/30 p-4 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted">Handoff</div>
        <h3 className="text-sm font-semibold text-text-primary mt-1">{resolvedHandoff.summary}</h3>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">变更文件</div>
        <ul className="space-y-1 text-xs text-text-primary">
          {resolvedHandoff.changedFiles.length > 0 ? resolvedHandoff.changedFiles.map((file) => (
            <li key={file}>{file}</li>
          )) : <li className="text-text-muted">暂无文件变更</li>}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">待处理事项</div>
        <ul className="space-y-1 text-xs text-text-primary">
          {resolvedHandoff.unresolvedItems.length > 0 ? resolvedHandoff.unresolvedItems.map((item) => (
            <li key={item}>{item}</li>
          )) : <li className="text-text-muted">无未决事项</li>}
        </ul>
      </div>

      {resolvedHandoff.suggestedNextSpecialist && (
        <div className="text-xs text-text-secondary">
          建议下一位接手者：<span className="text-text-primary">{resolvedHandoff.suggestedNextSpecialist}</span>
        </div>
      )}
    </aside>
  )
}

export default HandoffDetailPanel
