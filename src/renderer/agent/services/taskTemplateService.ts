import {
  createEmptyExecutionHeartbeatSnapshot,
  createInitialRecoveryCheckpoint,
} from '../types/taskExecution'
import type {
  CreateExecutionTaskInput,
  ExecutionTarget,
  ModelRoutingPolicy,
  SpecialistKind,
  TrustMode,
  VerificationMode,
  WorkPackage,
  WorkPackageDomain,
} from '../types/taskExecution'
import type { OrchestratorTask, TaskPlan } from '../orchestrator/types'

interface WorkPackageTemplateDefinition {
  title: string
  specialist: SpecialistKind
  targetDomain: WorkPackageDomain
  verificationMode?: VerificationMode | null
  expectedArtifacts: string[]
  dependsOnIndexes?: number[]
}

export interface TaskTemplateDefinition {
  id: string
  label: string
  description: string
  specialists: SpecialistKind[]
  trustMode?: TrustMode
  executionTarget?: ExecutionTarget
  modelRoutingPolicy?: ModelRoutingPolicy
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
    description: 'Split UI and state work, then gate completion with regression verification.',
    specialists: ['frontend', 'logic', 'verifier'],
    trustMode: 'balanced',
    executionTarget: 'isolated',
    modelRoutingPolicy: 'balanced',
    workPackages: [
      {
        title: 'Build UI shell',
        specialist: 'frontend',
        targetDomain: 'ui',
        verificationMode: null,
        expectedArtifacts: ['ui-shell'],
      },
      {
        title: 'Wire state and actions',
        specialist: 'logic',
        targetDomain: 'logic',
        verificationMode: null,
        expectedArtifacts: ['state-flow', 'actions'],
      },
      {
        title: 'Run regression checks',
        specialist: 'verifier',
        targetDomain: 'verification',
        verificationMode: 'regression',
        expectedArtifacts: ['test-results', 'regression-summary'],
        dependsOnIndexes: [0, 1],
      },
    ],
  },
  {
    id: 'frontend-logic',
    label: 'Frontend + Logic',
    description: 'Use two specialists for feature delivery without dedicated review or verification packages.',
    specialists: ['frontend', 'logic'],
    trustMode: 'balanced',
    executionTarget: 'isolated',
    modelRoutingPolicy: 'balanced',
    workPackages: [
      {
        title: 'Implement product surface',
        specialist: 'frontend',
        targetDomain: 'ui',
        verificationMode: null,
        expectedArtifacts: ['ui-flow', 'interaction-notes'],
      },
      {
        title: 'Wire feature logic',
        specialist: 'logic',
        targetDomain: 'logic',
        verificationMode: null,
        expectedArtifacts: ['state-updates', 'edge-cases'],
      },
    ],
  },
  {
    id: 'frontend-logic-reviewer',
    label: 'Frontend + Logic + Reviewer',
    description: 'Pair implementation specialists with a conservative review pass before landing changes.',
    specialists: ['frontend', 'logic', 'reviewer'],
    trustMode: 'balanced',
    executionTarget: 'isolated',
    modelRoutingPolicy: 'balanced',
    workPackages: [
      {
        title: 'Implement UI shell',
        specialist: 'frontend',
        targetDomain: 'ui',
        verificationMode: null,
        expectedArtifacts: ['ui-shell', 'interaction-notes'],
      },
      {
        title: 'Wire data flow and state',
        specialist: 'logic',
        targetDomain: 'logic',
        verificationMode: null,
        expectedArtifacts: ['state-updates', 'edge-cases'],
      },
      {
        title: 'Review risk and merge scope',
        specialist: 'reviewer',
        targetDomain: 'review',
        verificationMode: 'static',
        expectedArtifacts: ['review-findings', 'risk-notes'],
        dependsOnIndexes: [0, 1],
      },
    ],
  },
  {
    id: 'logic-verifier',
    label: 'Logic + Verifier',
    description: 'Focus on state and workflow correctness, then run a targeted regression pass.',
    specialists: ['logic', 'verifier'],
    trustMode: 'balanced',
    executionTarget: 'isolated',
    modelRoutingPolicy: 'balanced',
    workPackages: [
      {
        title: 'Implement logic changes',
        specialist: 'logic',
        targetDomain: 'logic',
        verificationMode: null,
        expectedArtifacts: ['state-updates', 'edge-cases'],
      },
      {
        title: 'Run logic regression checks',
        specialist: 'verifier',
        targetDomain: 'verification',
        verificationMode: 'regression',
        expectedArtifacts: ['test-results', 'regression-summary'],
        dependsOnIndexes: [0],
      },
    ],
  },
  {
    id: 'full-stack-safe',
    label: 'Full Stack Safe',
    description: 'Use the full specialist bench with isolation and a conservative trust policy.',
    specialists: ['frontend', 'logic', 'verifier', 'reviewer'],
    trustMode: 'safe',
    executionTarget: 'isolated',
    modelRoutingPolicy: 'balanced',
    workPackages: [
      {
        title: 'Implement user-facing surface',
        specialist: 'frontend',
        targetDomain: 'ui',
        verificationMode: null,
        expectedArtifacts: ['ui-updates', 'interaction-notes'],
      },
      {
        title: 'Wire backend-facing logic',
        specialist: 'logic',
        targetDomain: 'logic',
        verificationMode: null,
        expectedArtifacts: ['state-updates', 'edge-cases'],
      },
      {
        title: 'Run end-to-end regression checks',
        specialist: 'verifier',
        targetDomain: 'verification',
        verificationMode: 'regression',
        expectedArtifacts: ['test-results', 'regression-summary'],
        dependsOnIndexes: [0, 1],
      },
      {
        title: 'Review proposal risk and rollout',
        specialist: 'reviewer',
        targetDomain: 'review',
        verificationMode: 'static',
        expectedArtifacts: ['review-findings', 'risk-notes'],
        dependsOnIndexes: [2],
      },
    ],
  },
  {
    id: 'bugfix-fast',
    label: 'Bugfix Fast',
    description: 'Keep the team small and bias model routing toward lower-cost fixes with quick regression checks.',
    specialists: ['logic', 'verifier'],
    trustMode: 'balanced',
    executionTarget: 'current',
    modelRoutingPolicy: 'budget-aware',
    workPackages: [
      {
        title: 'Patch the failing logic path',
        specialist: 'logic',
        targetDomain: 'logic',
        verificationMode: null,
        expectedArtifacts: ['fix-notes', 'state-updates'],
      },
      {
        title: 'Confirm the bugfix with focused regression',
        specialist: 'verifier',
        targetDomain: 'verification',
        verificationMode: 'regression',
        expectedArtifacts: ['reproduction', 'regression-summary'],
        dependsOnIndexes: [0],
      },
    ],
  },
  {
    id: 'ui-polish-browser-verify',
    label: 'UI Polish + Browser Verify',
    description: 'Polish the experience, then validate the rendered UI in a browser-aware verification flow.',
    specialists: ['frontend', 'verifier', 'reviewer'],
    trustMode: 'balanced',
    executionTarget: 'isolated',
    modelRoutingPolicy: 'balanced',
    workPackages: [
      {
        title: 'Polish UI flow and interaction copy',
        specialist: 'frontend',
        targetDomain: 'ui',
        verificationMode: null,
        expectedArtifacts: ['ui-polish', 'interaction-notes'],
      },
      {
        title: 'Validate the UI flow in browser mode',
        specialist: 'verifier',
        targetDomain: 'verification',
        verificationMode: 'browser',
        expectedArtifacts: ['browser-checks', 'verification-summary'],
        dependsOnIndexes: [0],
      },
      {
        title: 'Review browser findings and release risk',
        specialist: 'reviewer',
        targetDomain: 'review',
        verificationMode: 'browser',
        expectedArtifacts: ['review-findings', 'risk-notes'],
        dependsOnIndexes: [1],
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
      dependsOnIndexes: workPackage.dependsOnIndexes ? [...workPackage.dependsOnIndexes] : undefined,
    })),
  }
}

function getFallbackVerificationMode(specialist: SpecialistKind): VerificationMode | null {
  if (specialist === 'verifier') return 'regression'
  if (specialist === 'reviewer') return 'static'
  return null
}

export function getTaskTemplates(): TaskTemplateDefinition[] {
  return TASK_TEMPLATES.map(cloneTemplate)
}

export function findTaskTemplateById(templateId: string): TaskTemplateDefinition | undefined {
  return TASK_TEMPLATES.find((template) => template.id === templateId)
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
  trustPolicy: { mode?: TrustMode; defaultExecutionTarget?: ExecutionTarget; modelRoutingPolicy?: ModelRoutingPolicy }
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
    autonomyMode: trustPolicy.mode === 'autonomous' ? 'autonomous' : 'manual',
    risk: plan.tasks.length >= 4 ? 'high' : plan.tasks.length > 1 ? 'medium' : 'low',
    trustMode: trustPolicy.mode ?? 'balanced',
    executionTarget: defaultExecutionTarget,
    modelRoutingPolicy: trustPolicy.modelRoutingPolicy ?? 'balanced',
  }
}

export function buildTaskWorkPackages(
  taskId: string,
  input: Pick<CreateExecutionTaskInput, 'objective' | 'specialists' | 'writableScopes'>
): WorkPackage[] {
  const specialists: SpecialistKind[] = input.specialists.length > 0 ? [...input.specialists] : ['logic']
  const matchedTemplate = findMatchingTaskTemplate(specialists)
  const writableScopes = [...(input.writableScopes || [])]

  if (matchedTemplate) {
    const baseWorkPackages = matchedTemplate.workPackages.map((template) => ({
      id: createEntityId('workpkg'),
      taskId,
      title: template.title,
      objective: template.title,
      specialist: template.specialist,
      status: 'queued' as const,
      heartbeat: createEmptyExecutionHeartbeatSnapshot(),
      recoveryCheckpoint: createInitialRecoveryCheckpoint(),
      targetDomain: template.targetDomain,
      verificationMode: template.verificationMode ?? getFallbackVerificationMode(template.specialist),
      writableScopes: [...writableScopes],
      readableScopes: [],
      dependsOn: [],
      expectedArtifacts: [...template.expectedArtifacts],
      queueReason: null,
      workspaceId: null,
      handoffId: null,
      proposalId: null,
    }))

    return baseWorkPackages.map((workPackage, index) => ({
      ...workPackage,
      dependsOn: (matchedTemplate.workPackages[index].dependsOnIndexes || []).map((depIndex) => baseWorkPackages[depIndex]?.id).filter(Boolean),
    }))
  }

  const baseWorkPackages = specialists.map((specialist, index) => {
    const template = TASK_TEMPLATE_COPY[specialist]
    const title = index === 0 ? input.objective : template.title(input.objective)

    return {
      id: createEntityId('workpkg'),
      taskId,
      title,
      objective: title,
      specialist,
      status: 'queued' as const,
      heartbeat: createEmptyExecutionHeartbeatSnapshot(),
      recoveryCheckpoint: createInitialRecoveryCheckpoint(),
      targetDomain: template.targetDomain,
      verificationMode: getFallbackVerificationMode(specialist),
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
    dependsOn: workPackage.specialist === 'verifier' || workPackage.specialist === 'reviewer'
      ? baseWorkPackages.slice(0, index).map((candidate) => candidate.id)
      : [],
  }))
}

export { TASK_TEMPLATE_COPY, TASK_TEMPLATES }
