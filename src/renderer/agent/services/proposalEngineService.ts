import type {
  ChangeProposal,
  ProposalVerificationStatus,
  TaskRiskLevel,
} from '../types/taskExecution'
import { validateChangeProposalForMerge } from './coordinatorService'

export interface BuildChangeProposalInput {
  id?: string
  taskId: string
  workPackageId: string
  summary: string
  changedFiles?: string[]
  writableScopes?: string[]
  verificationStatus?: ProposalVerificationStatus
  riskLevel?: TaskRiskLevel
  createdAt?: number
}

export interface BuildChangeProposalResult {
  proposal: ChangeProposal
  outOfScopeFiles: string[]
  safeToApply: boolean
  reason?: string
}

function createProposalId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildChangeProposal(input: BuildChangeProposalInput): BuildChangeProposalResult {
  const verificationStatus = input.verificationStatus ?? 'pending'
  const riskLevel = input.riskLevel ?? 'medium'
  const changedFiles = [...(input.changedFiles || [])]
  const gate = validateChangeProposalForMerge({
    writableScopes: [...(input.writableScopes || [])],
    changedFiles,
    verificationStatus,
    riskLevel,
  })

  return {
    proposal: {
      id: input.id ?? createProposalId(),
      taskId: input.taskId,
      workPackageId: input.workPackageId,
      summary: input.summary,
      changedFiles,
      verificationStatus,
      riskLevel,
      recommendedAction: gate.recommendedAction,
      status: 'pending',
      createdAt: input.createdAt ?? Date.now(),
      resolvedAt: null,
    },
    outOfScopeFiles: gate.outOfScopeFiles,
    safeToApply: gate.ok,
    reason: gate.reason,
  }
}
