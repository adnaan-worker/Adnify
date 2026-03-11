import type { TaskHandoff } from '@renderer/agent/types/taskExecution'

interface HandoffDetailPanelProps {
  handoff?: TaskHandoff | null
}

export function HandoffDetailPanel({ handoff }: HandoffDetailPanelProps) {
  if (!handoff) {
    return (
      <aside className="rounded-xl border border-dashed border-border bg-surface/20 p-4 text-sm text-text-muted">
        选中一个移交包后，这里会显示变更摘要、文件清单和待处理事项。
      </aside>
    )
  }

  return (
    <aside className="rounded-xl border border-border bg-surface/30 p-4 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-text-muted">Handoff</div>
        <h3 className="text-sm font-semibold text-text-primary mt-1">{handoff.summary}</h3>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">变更文件</div>
        <ul className="space-y-1 text-xs text-text-primary">
          {handoff.changedFiles.length > 0 ? handoff.changedFiles.map((file) => (
            <li key={file}>{file}</li>
          )) : <li className="text-text-muted">暂无文件变更</li>}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">待处理事项</div>
        <ul className="space-y-1 text-xs text-text-primary">
          {handoff.unresolvedItems.length > 0 ? handoff.unresolvedItems.map((item) => (
            <li key={item}>{item}</li>
          )) : <li className="text-text-muted">无未决事项</li>}
        </ul>
      </div>

      {handoff.suggestedNextSpecialist && (
        <div className="text-xs text-text-secondary">
          建议下一位接手者：<span className="text-text-primary">{handoff.suggestedNextSpecialist}</span>
        </div>
      )}
    </aside>
  )
}

export default HandoffDetailPanel
