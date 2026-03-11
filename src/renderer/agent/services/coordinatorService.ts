import type {
  AdjudicationActionType,
  AdjudicationCase,
  AdjudicationResolution,
  AdjudicationTrigger,
  ProposalAction,
  ProposalVerificationStatus,
  TaskRiskLevel,
} from '../types/taskExecution'

export interface MergeGateInput {
  writableScopes: string[]
  changedFiles: string[]
}

export type MergeGateResult =
  | { ok: true }
  | { ok: false; reason: string }

export interface ProposalMergeGateInput extends MergeGateInput {
  verificationStatus: ProposalVerificationStatus
  riskLevel: TaskRiskLevel
}

export interface ProposalMergeGateResult {
  ok: boolean
  reason?: string
  outOfScopeFiles: string[]
  recommendedAction: ProposalAction
}

export interface CreateAdjudicationCaseInput {
  id?: string
  taskId: string
  workPackageId?: string | null
  trigger: AdjudicationTrigger
  reason: string
  changedFiles?: string[]
  recommendedAction?: AdjudicationActionType
  createdAt?: number
}

export interface ResolveAdjudicationCaseInput {
  action: AdjudicationActionType
  selectedFiles?: string[]
  targetSpecialist?: AdjudicationResolution['targetSpecialist']
  resolvedAt?: number
}

function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

function createCaseId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getRecommendedAction(trigger: AdjudicationTrigger): AdjudicationActionType {
  switch (trigger) {
    case 'budget-trip':
      return 'return-for-rework'
    case 'rollback-recommended':
      return 'rollback'
    case 'verification-failed':
      return 'require-verification'
    case 'circuit-breaker':
      return 'return-for-rework'
    case 'main-workspace-conflict':
      return 'return-for-rework'
    case 'unsafe-merge':
    default:
      return 'accept-partial'
  }
}

function findOutOfScopeFiles(input: MergeGateInput): string[] {
  const writableScopes = input.writableScopes.map(normalizePath).filter(Boolean)
  const changedFiles = input.changedFiles.map(normalizePath).filter(Boolean)

  if (writableScopes.length === 0 || changedFiles.length === 0) {
    return []
  }

  return changedFiles.filter(
    (file) => !writableScopes.some((scope) => file === scope || file.startsWith(`${scope}/`)),
  )
}

export function validateHandoffForMerge(input: MergeGateInput): MergeGateResult {
  const outOfScope = findOutOfScopeFiles(input)

  return outOfScope.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `Changed files outside writable scopes: ${outOfScope.join(', ')}`,
      }
}

export function validateChangeProposalForMerge(input: ProposalMergeGateInput): ProposalMergeGateResult {
  const outOfScopeFiles = findOutOfScopeFiles(input)
  if (outOfScopeFiles.length > 0) {
    return {
      ok: false,
      reason: `Changed files outside writable scopes: ${outOfScopeFiles.join(', ')}`,
      outOfScopeFiles,
      recommendedAction: 'return-for-rework',
    }
  }

  if (input.verificationStatus === 'failed') {
    return {
      ok: false,
      reason: 'Verification failed for the proposed changes.',
      outOfScopeFiles: [],
      recommendedAction: 'return-for-rework',
    }
  }

  if (input.verificationStatus !== 'passed') {
    return {
      ok: false,
      reason: 'Proposal verification is incomplete.',
      outOfScopeFiles: [],
      recommendedAction: 'discard',
    }
  }

  if (input.riskLevel === 'high') {
    return {
      ok: false,
      reason: 'High-risk proposals require reassignment or explicit review.',
      outOfScopeFiles: [],
      recommendedAction: 'reassign',
    }
  }

  return {
    ok: true,
    outOfScopeFiles: [],
    recommendedAction: 'apply',
  }
}

export function createAdjudicationCase(input: CreateAdjudicationCaseInput): AdjudicationCase {
  return {
    id: input.id ?? createCaseId(),
    taskId: input.taskId,
    workPackageId: input.workPackageId ?? null,
    trigger: input.trigger,
    reason: input.reason,
    changedFiles: [...(input.changedFiles || [])],
    recommendedAction: input.recommendedAction ?? getRecommendedAction(input.trigger),
    status: 'open',
    createdAt: input.createdAt ?? Date.now(),
  }
}

export function resolveAdjudicationCase(
  caseItem: AdjudicationCase,
  input: ResolveAdjudicationCaseInput,
): { caseItem: AdjudicationCase } {
  return {
    caseItem: {
      ...caseItem,
      status: 'resolved',
      resolution: {
        action: input.action,
        selectedFiles: input.selectedFiles ? [...input.selectedFiles] : undefined,
        targetSpecialist: input.targetSpecialist,
        resolvedAt: input.resolvedAt ?? Date.now(),
      },
    },
  }
}
