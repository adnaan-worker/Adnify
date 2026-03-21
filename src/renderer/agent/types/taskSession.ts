import type {
  ChangeProposal,
  ExecutionTask,
  ProposalVerificationStatus,
  VerificationMode,
} from './taskExecution'

export type TaskSessionStage = 'define' | 'plan' | 'execute' | 'review' | 'verify' | 'complete'

export interface PatchBatchSummary {
  proposalIds: string[]
  totalProposals: number
  pendingProposals: number
  appliedProposals: number
  changedFiles: string[]
  conflictFiles: string[]
  verificationStatus: ProposalVerificationStatus
  verificationModes: VerificationMode[]
  blockedReasons: string[]
  hasConflicts: boolean
  canApply: boolean
  updatedAt: number | null
}

export interface TaskSessionVerificationSummary {
  status: ProposalVerificationStatus
  verificationModes: VerificationMode[]
  blockedReasons: string[]
  summary: string | null
  provider: 'playwright' | 'puppeteer' | 'mixed' | null
}

export interface ExecutionRun {
  taskId: string
  threadId: string | null
  state: ExecutionTask['state']
  governanceState: ExecutionTask['governanceState']
  workPackageIds: string[]
  sourceWorkspacePath: string | null
  resolvedWorkspacePath: string | null
  latestProposalId: string | null
  latestHandoffId: string | null
  updatedAt: number
}

export interface TaskSession {
  id: string
  objective: string
  successCriteria: string[]
  threadId: string | null
  activeExecutionTaskId: string | null
  stage: TaskSessionStage
  executionRun: ExecutionRun | null
  patchBatch: PatchBatchSummary
  verification: TaskSessionVerificationSummary
  createdAt: number
  updatedAt: number
}

export interface CreateTaskSessionInput {
  id: string
  objective: string
  successCriteria?: string[]
  threadId?: string | null
  task?: ExecutionTask | null
  proposals?: ChangeProposal[]
  createdAt?: number
  updatedAt?: number
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0) {
      continue
    }
    seen.add(value)
  }
  return Array.from(seen)
}

function uniqueVerificationModes(values: Array<VerificationMode | null | undefined>): VerificationMode[] {
  return uniqueStrings(values) as VerificationMode[]
}

function deriveVerificationStatus(proposals: ChangeProposal[]): ProposalVerificationStatus {
  if (proposals.some((proposal) => proposal.verificationStatus === 'failed')) {
    return 'failed'
  }
  if (proposals.length > 0 && proposals.every((proposal) => proposal.verificationStatus === 'passed')) {
    return 'passed'
  }
  return 'pending'
}

function deriveVerificationProvider(
  proposals: ChangeProposal[],
): 'playwright' | 'puppeteer' | 'mixed' | null {
  const providers = uniqueStrings(proposals.map((proposal) => proposal.verificationProvider))
  if (providers.length === 0) {
    return null
  }
  if (providers.length === 1) {
    return providers[0] as 'playwright' | 'puppeteer'
  }
  return 'mixed'
}

export function derivePatchBatchSummary(proposals: ChangeProposal[]): PatchBatchSummary {
  const changedFiles = uniqueStrings(proposals.flatMap((proposal) => proposal.changedFiles))
  const conflictFiles = uniqueStrings(proposals.flatMap((proposal) => proposal.conflictFiles || []))
  const blockedReasons = uniqueStrings(proposals.map((proposal) => proposal.verificationBlockedReason))
  const pendingReview = proposals.filter((proposal) => proposal.status === 'pending')
  const verificationStatus = deriveVerificationStatus(proposals)
  const hasConflicts = conflictFiles.length > 0
  const canApply =
    pendingReview.length > 0 &&
    verificationStatus === 'passed' &&
    pendingReview.every((proposal) => (proposal.conflictFiles?.length || 0) === 0)

  return {
    proposalIds: proposals.map((proposal) => proposal.id),
    totalProposals: proposals.length,
    pendingProposals: pendingReview.length,
    appliedProposals: proposals.filter((proposal) => proposal.status === 'applied').length,
    changedFiles,
    conflictFiles,
    verificationStatus,
    verificationModes: uniqueVerificationModes(proposals.map((proposal) => proposal.verificationMode)),
    blockedReasons,
    hasConflicts,
    canApply,
    updatedAt: proposals.reduce<number | null>((latest, proposal) => {
      const proposalUpdatedAt = proposal.resolvedAt ?? proposal.createdAt
      if (latest === null || proposalUpdatedAt > latest) {
        return proposalUpdatedAt
      }
      return latest
    }, null),
  }
}

export function deriveTaskSessionVerificationSummary(
  proposals: ChangeProposal[],
): TaskSessionVerificationSummary {
  const summaries = uniqueStrings(proposals.map((proposal) => proposal.verificationSummary))

  return {
    status: deriveVerificationStatus(proposals),
    verificationModes: uniqueVerificationModes(proposals.map((proposal) => proposal.verificationMode)),
    blockedReasons: uniqueStrings(proposals.map((proposal) => proposal.verificationBlockedReason)),
    summary: summaries.length === 1 ? summaries[0] : summaries.length > 1 ? summaries.join(' ') : null,
    provider: deriveVerificationProvider(proposals),
  }
}

export function deriveTaskSessionStage(input: {
  task: ExecutionTask | null
  proposals: ChangeProposal[]
}): TaskSessionStage {
  const { task, proposals } = input
  if (!task) {
    return 'define'
  }

  if (proposals.some((proposal) => proposal.status === 'pending')) {
    return 'review'
  }

  switch (task.state) {
    case 'planning':
      return 'plan'
    case 'verifying':
      return 'verify'
    case 'complete':
      return 'complete'
    default:
      return 'execute'
  }
}

export function createExecutionRun(task: ExecutionTask, threadId: string | null): ExecutionRun {
  return {
    taskId: task.id,
    threadId,
    state: task.state,
    governanceState: task.governanceState,
    workPackageIds: [...task.workPackages],
    sourceWorkspacePath: task.sourceWorkspacePath,
    resolvedWorkspacePath: task.resolvedWorkspacePath,
    latestProposalId: task.latestProposalId,
    latestHandoffId: task.latestHandoffId,
    updatedAt: task.updatedAt,
  }
}

export function createTaskSession(input: CreateTaskSessionInput): TaskSession {
  const proposals = input.proposals || []
  const task = input.task || null
  const patchBatch = derivePatchBatchSummary(proposals)
  const verification = deriveTaskSessionVerificationSummary(proposals)
  const createdAt = input.createdAt ?? task?.createdAt ?? Date.now()
  const updatedAt = input.updatedAt ?? task?.updatedAt ?? createdAt
  const threadId = input.threadId ?? null

  return {
    id: input.id,
    objective: input.objective,
    successCriteria: [...(input.successCriteria || [])],
    threadId,
    activeExecutionTaskId: task?.id ?? null,
    stage: deriveTaskSessionStage({ task, proposals }),
    executionRun: task ? createExecutionRun(task, threadId) : null,
    patchBatch,
    verification,
    createdAt,
    updatedAt,
  }
}
