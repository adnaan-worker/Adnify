import type { ExecutionTask, WorkPackage } from '@renderer/agent/types/taskExecution'
import type { WorkPackageRuntimeActivity } from './workPackageRuntime'

interface ExecutionDiagnosticsPanelProps {
  task: ExecutionTask
  workPackage?: WorkPackage | null
  activity?: WorkPackageRuntimeActivity | null
}

export function ExecutionDiagnosticsPanel({ task, workPackage = null, activity = null }: ExecutionDiagnosticsPanelProps) {
  const taskWorkspace = task.resolvedWorkspacePath || task.sourceWorkspacePath || '—'
  const packageWorkspace = workPackage?.workspaceId || '—'
  const stuckReason = workPackage?.heartbeat?.stuckReason || activity?.stuckReason || task.heartbeat?.stuckReason || task.patrol?.reason || null
  const resumeCandidates = task.recoveryCheckpoint?.resumeCandidateWorkPackageIds.length || 0

  const items = [
    { label: 'autonomy', value: task.autonomyMode || 'manual' },
    { label: 'patrol', value: task.patrol?.status || 'idle' },
    { label: 'recovery', value: task.recoveryCheckpoint?.status || 'idle' },
    { label: 'isolation', value: task.isolationMode || 'current' },
    { label: 'task workspace', value: taskWorkspace },
    { label: 'package workspace', value: packageWorkspace },
    { label: 'resume candidates', value: String(resumeCandidates) },
  ]

  return (
    <section className="rounded-xl border border-border bg-background/20 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Execution Diagnostics</div>
          <div className="text-sm font-semibold text-text-primary mt-1">Autonomy & recovery context</div>
        </div>
        {workPackage?.heartbeat?.status && workPackage.heartbeat.status !== 'idle' ? (
          <span className="px-2 py-1 rounded-full bg-amber-500/10 text-[11px] text-amber-200">
            {workPackage.heartbeat.status}
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-text-muted">{item.label}</div>
            <div className="text-xs text-text-primary break-all">{item.value}</div>
          </div>
        ))}
      </div>

      {stuckReason ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-amber-200">stuck reason</div>
          <div className="text-xs text-amber-100 break-words">{stuckReason}</div>
        </div>
      ) : null}
    </section>
  )
}

export default ExecutionDiagnosticsPanel
