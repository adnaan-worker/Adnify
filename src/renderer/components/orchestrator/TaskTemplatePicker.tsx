import { getTaskTemplates } from '@renderer/agent/services/taskTemplateService'

interface TaskTemplatePickerProps {
  selectedTemplateId?: string | null
  onSelectTemplate?: (templateId: string) => void
}

export function TaskTemplatePicker({ selectedTemplateId = null, onSelectTemplate }: TaskTemplatePickerProps) {
  const templates = getTaskTemplates()

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-text-muted">Specialist Template</div>
      <div className="flex flex-wrap gap-2">
        {templates.map((template) => {
          const selected = template.id === selectedTemplateId
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate?.(template.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${selected ? 'border-accent bg-accent/10 text-accent' : 'border-border bg-background/50 text-text-secondary'}`}
            >
              {template.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default TaskTemplatePicker
