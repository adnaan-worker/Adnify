import type {
  ChangeProposal,
  ExecutionTarget,
  TaskRiskLevel,
} from './taskExecution'
import {
  derivePatchBatchSummary,
  deriveTaskSessionVerificationSummary,
} from './taskSession'
import { shouldUseIsolatedWorkspace } from './trustPolicy'

export type TaskGateStatus = 'ready' | 'warning' | 'blocked'

export interface TaskGateResult {
  status: TaskGateStatus
  reason: string | null
}

export interface PlanningGateInput {
  hasPlan: boolean
  successCriteriaCount: number
}

export interface WorkspaceGateInput {
  risk: TaskRiskLevel
  fileCount: number
  executionTarget: ExecutionTarget
  isolationReady: boolean
}

export interface PatchGateInput {
  proposals: ChangeProposal[]
}

export interface VerificationGateInput {
  proposals: ChangeProposal[]
  allowDegradedAcceptance?: boolean
}

function createGateResult(status: TaskGateStatus, reason: string | null): TaskGateResult {
  return {
    status,
    reason,
  }
}

export function evaluatePlanningGate(input: PlanningGateInput): TaskGateResult {
  if (!input.hasPlan) {
    return createGateResult('blocked', 'Create or approve a plan before execution can start.')
  }

  if (input.successCriteriaCount === 0) {
    return createGateResult('warning', 'Add success criteria before handing the task to execution.')
  }

  return createGateResult('ready', 'Plan and success criteria are ready for execution.')
}

export function evaluateWorkspaceGate(input: WorkspaceGateInput): TaskGateResult {
  const isolationRecommended = shouldUseIsolatedWorkspace({
    risk: input.risk,
    fileCount: input.fileCount,
  })

  if (!isolationRecommended) {
    return createGateResult('ready', 'Current workspace is acceptable for this task.')
  }

  if (input.executionTarget === 'isolated') {
    return input.isolationReady
      ? createGateResult('ready', 'Isolated workspace is ready for execution.')
      : createGateResult('blocked', 'Isolated workspace is required but not ready yet.')
  }

  return createGateResult('warning', 'Use an isolated workspace for non-trivial tasks before execution.')
}

export function evaluatePatchGate(input: PatchGateInput): TaskGateResult {
  if (input.proposals.length === 0) {
    return createGateResult('blocked', 'No proposals are ready to apply.')
  }

  const patchBatch = derivePatchBatchSummary(input.proposals)

  if (patchBatch.hasConflicts) {
    return createGateResult('blocked', `Patch apply is blocked by conflict files: ${patchBatch.conflictFiles.join(', ')}`)
  }

  if (patchBatch.verificationStatus !== 'passed') {
    return createGateResult('blocked', 'Patch apply requires every proposal to pass verification.')
  }

  if (!patchBatch.canApply) {
    return createGateResult('blocked', 'Patch batch is not ready to apply yet.')
  }

  return createGateResult('ready', 'Patch batch is ready to apply.')
}

export function evaluateVerificationGate(input: VerificationGateInput): TaskGateResult {
  if (input.proposals.length === 0) {
    return createGateResult('blocked', 'verification gate blocked completion because no verification evidence is available.')
  }

  const verification = deriveTaskSessionVerificationSummary(input.proposals)

  if (verification.status === 'passed') {
    return createGateResult('ready', verification.summary || 'Verification passed.')
  }

  if (input.allowDegradedAcceptance) {
    return createGateResult(
      'warning',
      verification.summary || 'Verification did not fully pass, but degraded acceptance was explicitly granted.',
    )
  }

  const blockedReason = verification.blockedReasons[0] || verification.summary || 'Verification must pass before completion.'
  return createGateResult('blocked', `verification gate blocked completion: ${blockedReason}`)
}
