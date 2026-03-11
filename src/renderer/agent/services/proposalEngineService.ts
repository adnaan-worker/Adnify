import type {
  ChangeProposal,
  ProposalVerificationStatus,
  TaskRiskLevel,
  VerificationMode,
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
  verificationMode?: VerificationMode | null
  verificationSummary?: string | null
  verificationBlockedReason?: string | null
  verificationProvider?: 'playwright' | 'puppeteer' | null
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
      verificationMode: input.verificationMode ?? null,
      verificationSummary: input.verificationSummary ?? null,
      verificationBlockedReason: input.verificationBlockedReason ?? null,
      verificationProvider: input.verificationProvider ?? null,
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
