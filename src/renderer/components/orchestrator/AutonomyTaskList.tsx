import type { ExecutionTask } from '@renderer/agent/types/taskExecution'

interface AutonomyTaskListProps {
  tasks: ExecutionTask[]
  activeTaskId?: string | null
  onSelectTask?: (taskId: string) => void
}

export function AutonomyTaskList({ tasks, activeTaskId = null, onSelectTask }: AutonomyTaskListProps) {
  const backgroundTasks = tasks.filter((task) => task.autonomyMode === 'autonomous' && task.id !== activeTaskId)

  if (backgroundTasks.length === 0) {
    return null
  }

  return (
    <section className="rounded-2xl border border-border bg-surface/20 p-4 space-y-3">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Autonomy Tasks</div>
        <h3 className="text-sm font-semibold text-text-primary mt-1">Background autonomous executions</h3>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {backgroundTasks.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => onSelectTask?.(task.id)}
            className="rounded-xl border border-border bg-background/30 p-4 text-left space-y-2 hover:border-accent/40 transition-colors"
          >
            <div className="text-sm font-semibold text-text-primary break-words">{task.objective}</div>
            <div className="flex flex-wrap gap-2 text-[11px] text-text-secondary">
              <span className="px-2 py-1 rounded-full bg-background/60">{task.autonomyMode || 'manual'}</span>
              {task.patrol?.status ? <span className="px-2 py-1 rounded-full bg-background/60">{task.patrol.status}</span> : null}
              {task.isolationMode ? <span className="px-2 py-1 rounded-full bg-background/60">{task.isolationMode}</span> : null}
            </div>
            <div className="text-xs text-text-muted break-all">
              {task.resolvedWorkspacePath || task.sourceWorkspacePath || '—'}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export default AutonomyTaskList
