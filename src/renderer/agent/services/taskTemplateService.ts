import type {
  CreateExecutionTaskInput,
  SpecialistKind,
  TrustMode,
  WorkPackage,
  WorkPackageDomain,
  ExecutionTarget,
} from '../types/taskExecution'
import type { OrchestratorTask, TaskPlan } from '../orchestrator/types'

interface WorkPackageTemplateDefinition {
  title: string
  specialist: SpecialistKind
  targetDomain: WorkPackageDomain
  expectedArtifacts: string[]
}

export interface TaskTemplateDefinition {
  id: string
  label: string
  specialists: SpecialistKind[]
  workPackages: WorkPackageTemplateDefinition[]
}

const TASK_TEMPLATE_COPY: Record<SpecialistKind, { title: (objective: string) => string; targetDomain: WorkPackageDomain; expectedArtifacts: string[] }> = {
  frontend: {
    title: (objective) => `Implement UI flow for ${objective}`,
    targetDomain: 'ui',
    expectedArtifacts: ['ui-updates', 'interaction-notes'],
  },
  logic: {
    title: (objective) => `Wire logic for ${objective}`,
    targetDomain: 'logic',
    expectedArtifacts: ['state-updates', 'edge-cases'],
  },
  verifier: {
    title: (objective) => `Verify ${objective}`,
    targetDomain: 'verification',
    expectedArtifacts: ['test-results', 'regression-summary'],
  },
  reviewer: {
    title: (objective) => `Review ${objective}`,
    targetDomain: 'review',
    expectedArtifacts: ['review-findings', 'risk-notes'],
  },
}

const TASK_TEMPLATES: TaskTemplateDefinition[] = [
  {
    id: 'frontend-logic-verifier',
    label: 'Frontend + Logic + Verifier',
    specialists: ['frontend', 'logic', 'verifier'],
    workPackages: [
      {
        title: 'Build UI shell',
        specialist: 'frontend',
        targetDomain: 'ui',
        expectedArtifacts: ['ui-shell'],
      },
      {
        title: 'Wire state and actions',
        specialist: 'logic',
        targetDomain: 'logic',
        expectedArtifacts: ['state-flow', 'actions'],
      },
      {
        title: 'Run regression checks',
        specialist: 'verifier',
        targetDomain: 'verification',
        expectedArtifacts: ['test-results', 'regression-summary'],
      },
    ],
  },
]

function createEntityId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneTemplate(template: TaskTemplateDefinition): TaskTemplateDefinition {
  return {
    ...template,
    specialists: [...template.specialists],
    workPackages: template.workPackages.map((workPackage) => ({
      ...workPackage,
      expectedArtifacts: [...workPackage.expectedArtifacts],
    })),
  }
}

export function getTaskTemplates(): TaskTemplateDefinition[] {
  return TASK_TEMPLATES.map(cloneTemplate)
}

export function findMatchingTaskTemplate(specialists: SpecialistKind[]): TaskTemplateDefinition | undefined {
  return TASK_TEMPLATES.find((template) =>
    template.specialists.length === specialists.length
    && template.specialists.every((specialist, index) => specialist === specialists[index]),
  )
}

function inferSpecialistFromTask(task: Pick<OrchestratorTask, 'title' | 'description' | 'role'>): SpecialistKind {
  const signal = `${task.role} ${task.title} ${task.description}`.toLowerCase()

  if (/(frontend|ui|ux|component|layout|visual)/.test(signal)) return 'frontend'
  if (/(verifier|verify|test|qa|regression)/.test(signal)) return 'verifier'
  if (/(reviewer|review|audit)/.test(signal)) return 'reviewer'
  return 'logic'
}

export function buildExecutionTaskInputFromPlan(
  plan: Pick<TaskPlan, 'id' | 'name' | 'userRequest' | 'tasks'>,
  trustPolicy: { mode?: TrustMode; defaultExecutionTarget?: ExecutionTarget }
): CreateExecutionTaskInput {
  const specialists = Array.from(new Set(
    plan.tasks.map((task) => inferSpecialistFromTask(task))
  )) as SpecialistKind[]

  const defaultExecutionTarget = trustPolicy.defaultExecutionTarget === 'auto'
    ? undefined
    : trustPolicy.defaultExecutionTarget

  return {
    sourcePlanId: plan.id,
    objective: plan.userRequest || plan.name,
    specialists: specialists.length > 0 ? specialists : ['logic'],
    risk: plan.tasks.length >= 4 ? 'high' : plan.tasks.length > 1 ? 'medium' : 'low',
    trustMode: trustPolicy.mode ?? 'balanced',
    executionTarget: defaultExecutionTarget,
  }
}

export function buildTaskWorkPackages(
  taskId: string,
  input: Pick<CreateExecutionTaskInput, 'objective' | 'specialists' | 'writableScopes'>
): WorkPackage[] {
  const specialists: SpecialistKind[] = input.specialists.length > 0 ? [...input.specialists] : ['logic']
  const matchedTemplate = findMatchingTaskTemplate(specialists)
  const writableScopes = [...(input.writableScopes || [])]

  const baseWorkPackages = matchedTemplate
    ? matchedTemplate.workPackages.map((template) => ({
        id: createEntityId('workpkg'),
        taskId,
        title: template.title,
        objective: template.title,
        specialist: template.specialist,
        status: 'queued' as const,
        targetDomain: template.targetDomain,
        writableScopes: [...writableScopes],
        readableScopes: [],
        dependsOn: [],
        expectedArtifacts: [...template.expectedArtifacts],
        queueReason: null,
        workspaceId: null,
        handoffId: null,
        proposalId: null,
      }))
    : specialists.map((specialist, index) => {
        const template = TASK_TEMPLATE_COPY[specialist]
        const title = index === 0 ? input.objective : template.title(input.objective)

        return {
          id: createEntityId('workpkg'),
          taskId,
          title,
          objective: title,
          specialist,
          status: 'queued' as const,
          targetDomain: template.targetDomain,
          writableScopes: [...writableScopes],
          readableScopes: [],
          dependsOn: [],
          expectedArtifacts: [...template.expectedArtifacts],
          queueReason: null,
          workspaceId: null,
          handoffId: null,
          proposalId: null,
        }
      })

  return baseWorkPackages.map((workPackage, index) => ({
    ...workPackage,
    dependsOn: index === 0 ? [] : [baseWorkPackages[index - 1].id],
  }))
}

export { TASK_TEMPLATE_COPY, TASK_TEMPLATES }
