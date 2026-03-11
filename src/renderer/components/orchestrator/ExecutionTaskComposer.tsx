import type { TaskPlan } from '@renderer/agent/orchestrator/types'
import {
  buildExecutionTaskInputFromPlan,
  findTaskTemplateById,
  getTaskTemplates,
} from '@renderer/agent/services/taskTemplateService'
import type { TaskTemplateDefinition } from '@renderer/agent/services/taskTemplateService'
import { createDefaultExecutionStrategySnapshot } from '@renderer/agent/types/taskExecution'
import type {
  CreateExecutionTaskInput,
  ExecutionStrategySnapshot,
  ExecutionTarget,
  ModelRoutingPolicy,
  SpecialistKind,
  TrustMode,
} from '@renderer/agent/types/taskExecution'

export interface ExecutionTaskDraft {
  objective: string
  specialists: SpecialistKind[]
  trustMode: TrustMode
  executionTarget: ExecutionTarget
  modelRoutingPolicy: ModelRoutingPolicy
  executionStrategy: ExecutionStrategySnapshot
  sourceWorkspacePath: string | null
}

interface ExecutionTaskComposerProps {
  draft: ExecutionTaskDraft
  onDraftChange: (draft: ExecutionTaskDraft) => void
  onCreate: () => void
  disabled?: boolean
}

type ExecutionTaskTemplateOption = Pick<
  TaskTemplateDefinition,
  'id' | 'label' | 'description' | 'specialists' | 'trustMode' | 'executionTarget' | 'modelRoutingPolicy'
>

const TRUST_MODE_OPTIONS: TrustMode[] = ['safe', 'balanced', 'autonomous', 'manual']
const EXECUTION_TARGET_OPTIONS: ExecutionTarget[] = ['current', 'isolated', 'auto']
const SPECIALIST_OPTIONS: SpecialistKind[] = ['frontend', 'logic', 'verifier', 'reviewer']
const AUTO_TEMPLATE_OPTION: ExecutionTaskTemplateOption = {
  id: 'auto',
  label: 'Auto',
  description: 'Keep current inferred specialists and manual overrides.',
  specialists: [],
}

function toggleSpecialist(list: SpecialistKind[], specialist: SpecialistKind): SpecialistKind[] {
  const next = list.includes(specialist)
    ? list.filter((item) => item !== specialist)
    : [...list, specialist]

  return next.length > 0 ? next : ['logic']
}

function matchesTemplate(draft: ExecutionTaskDraft, template: { specialists: SpecialistKind[] }): boolean {
  if (template.specialists.length === 0) return false
  return template.specialists.length === draft.specialists.length
    && template.specialists.every((specialist, index) => draft.specialists[index] === specialist)
}

export function getExecutionTaskTemplateOptions(): ExecutionTaskTemplateOption[] {
  return [AUTO_TEMPLATE_OPTION, ...getTaskTemplates()]
}

export function applyTaskTemplateToDraft(draft: ExecutionTaskDraft, templateId: string): ExecutionTaskDraft {
  if (templateId === AUTO_TEMPLATE_OPTION.id) return draft

  const template = findTaskTemplateById(templateId)
  if (!template) return draft

  return {
    ...draft,
    specialists: [...template.specialists],
    trustMode: template.trustMode ?? draft.trustMode,
    executionTarget: template.executionTarget ?? draft.executionTarget,
    modelRoutingPolicy: template.modelRoutingPolicy ?? draft.modelRoutingPolicy,
  }
}

export function buildExecutionTaskDraftFromPlan(
  plan: Pick<TaskPlan, 'id' | 'name' | 'userRequest' | 'tasks'>,
  workspacePath: string | null,
  trustPolicy: { mode?: TrustMode; defaultExecutionTarget?: ExecutionTarget; modelRoutingPolicy?: ModelRoutingPolicy },
): ExecutionTaskDraft {
  const input = buildExecutionTaskInputFromPlan(plan, trustPolicy)

  return {
    objective: input.objective,
    specialists: input.specialists,
    trustMode: input.trustMode ?? trustPolicy.mode ?? 'balanced',
    executionTarget: input.executionTarget ?? (trustPolicy.defaultExecutionTarget === 'auto' ? 'isolated' : trustPolicy.defaultExecutionTarget ?? 'isolated'),
    modelRoutingPolicy: input.modelRoutingPolicy ?? (trustPolicy.modelRoutingPolicy ?? 'balanced'),
    executionStrategy: input.executionStrategy ?? createDefaultExecutionStrategySnapshot(),
    sourceWorkspacePath: workspacePath,
  }
}

export function buildExecutionTaskInputFromDraft(draft: ExecutionTaskDraft): CreateExecutionTaskInput {
  return {
    objective: draft.objective,
    specialists: [...draft.specialists],
    trustMode: draft.trustMode,
    executionTarget: draft.executionTarget,
    modelRoutingPolicy: draft.modelRoutingPolicy,
    executionStrategy: { ...draft.executionStrategy },
    sourceWorkspacePath: draft.sourceWorkspacePath,
  }
}

export function ExecutionTaskComposer({ draft, onDraftChange, onCreate, disabled = false }: ExecutionTaskComposerProps) {
  const templateOptions = getExecutionTaskTemplateOptions()
  const activeTemplate = templateOptions.find((template) => matchesTemplate(draft, template))?.id ?? 'custom'

  return (
    <section className="rounded-2xl border border-border bg-surface/20 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-text-muted">准备执行</div>
          <h3 className="text-lg font-semibold text-text-primary">创建执行任务</h3>
        </div>
        <button
          type="button"
          onClick={onCreate}
          disabled={disabled || !draft.objective.trim()}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          保存任务
        </button>
      </div>

      <label className="flex flex-col gap-2 text-sm text-text-secondary">
        <span>Objective</span>
        <input
          value={draft.objective}
          onChange={(event) => onDraftChange({ ...draft, objective: event.target.value })}
          disabled={disabled}
          className="rounded-xl border border-border bg-background px-3 py-2 text-text-primary"
        />
      </label>

      <div className="space-y-2">
        <div className="text-sm text-text-secondary">Template</div>
        <div className="flex flex-wrap gap-2">
          {templateOptions.map((template) => (
            <button
              key={template.id}
              type="button"
              title={template.description}
              disabled={disabled}
              onClick={() => onDraftChange(applyTaskTemplateToDraft(draft, template.id))}
              className={`rounded-full border px-3 py-1.5 text-xs ${activeTemplate === template.id ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-text-secondary">Specialists</div>
        <div className="flex flex-wrap gap-2">
          {SPECIALIST_OPTIONS.map((specialist) => {
            const selected = draft.specialists.includes(specialist)
            return (
              <button
                key={specialist}
                type="button"
                disabled={disabled}
                onClick={() => onDraftChange({ ...draft, specialists: toggleSpecialist(draft.specialists, specialist) })}
                className={`rounded-full border px-3 py-1.5 text-xs ${selected ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}
              >
                {specialist}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-text-secondary">Trust Mode</div>
        <div className="flex flex-wrap gap-2">
          {TRUST_MODE_OPTIONS.map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              onClick={() => onDraftChange({ ...draft, trustMode: mode })}
              className={`rounded-full border px-3 py-1.5 text-xs ${draft.trustMode === mode ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-text-secondary">Execution Target</div>
        <div className="flex flex-wrap gap-2">
          {EXECUTION_TARGET_OPTIONS.map((target) => (
            <button
              key={target}
              type="button"
              disabled={disabled}
              onClick={() => onDraftChange({ ...draft, executionTarget: target })}
              className={`rounded-full border px-3 py-1.5 text-xs ${draft.executionTarget === target ? 'border-accent text-accent' : 'border-border text-text-secondary'}`}
            >
              {target}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-text-secondary">Execution Strategy</div>
        <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
          <span className="rounded-full border border-border px-3 py-1.5">{draft.executionStrategy.orchestrationMode}</span>
          <span className="rounded-full border border-border px-3 py-1.5">{draft.executionStrategy.ownershipPolicy}</span>
          <span className="rounded-full border border-border px-3 py-1.5">{draft.executionStrategy.conflictPolicy}</span>
          <span className="rounded-full border border-border px-3 py-1.5">{draft.modelRoutingPolicy}</span>
          <span className="rounded-full border border-border px-3 py-1.5">{draft.executionStrategy.proposalReviewPolicy}</span>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        Workspace: {draft.sourceWorkspacePath || 'Not selected'}
      </div>
    </section>
  )
}
