import { DEFAULT_TRUST_POLICY } from './trustPolicy'

export type TrustMode = 'safe' | 'balanced' | 'autonomous' | 'manual'

export type ExecutionTarget = 'current' | 'isolated' | 'auto'

export type InterruptMode = 'phase' | 'high-risk' | 'failure-only'

export type TaskRiskLevel = 'low' | 'medium' | 'high'

export type ExecutionTaskState = 'planning' | 'running' | 'verifying' | 'blocked' | 'complete' | 'tripped'

export type ExecutionTaskGovernanceState = 'active' | 'awaiting-adjudication' | 'rollback-ready' | 'rolled-back' | 'completed-with-warnings'

export type IsolationStatus = 'pending' | 'preparing' | 'ready' | 'failed' | 'disposed'

export type WorkPackageStatus =
  | 'queued'
  | 'leasing'
  | 'running'
  | 'executing'
  | 'blocked'
  | 'verifying'
  | 'handoff'
  | 'handoff-ready'
  | 'verified'
  | 'proposal-ready'
  | 'waiting-approval'
  | 'applied'
  | 'reassigned'
  | 'failed'

export type SpecialistKind = 'frontend' | 'logic' | 'verifier' | 'reviewer'

export type WorkPackageDomain = 'ui' | 'logic' | 'verification' | 'review'

export type SpecialistToolPermission = 'read-mostly' | 'workspace-write' | 'elevated'

export type SpecialistNetworkPermission = 'blocked' | 'workspace-only' | 'allowed'

export type SpecialistGitPermission = 'read-only' | 'task-branch' | 'workspace-write'

export type SpecialistValidationRole = 'none' | 'secondary' | 'primary'

export type VerificationMode = 'static' | 'regression' | 'browser'

export type ModelRoutingPolicy = 'manual' | 'balanced' | 'budget-aware'

export type AutonomyMode = 'manual' | 'autonomous'

export type PatrolStatus = 'idle' | 'active' | 'silent-but-healthy' | 'suspected-stuck' | 'abandoned'

export type ExecutionHeartbeatStatus = 'idle' | 'active' | 'silent' | 'suspected-stuck' | 'abandoned'

export type OrchestrationMode = 'mixed' | 'manual' | 'automatic'

export type OwnershipPolicy = 'exclusive'

export type ConflictPolicy = 'queue'

export type WorkspaceIsolationPolicy = 'isolated'

export type HandoffPolicy = 'auto-on-complete'

export type ProposalReviewPolicy = 'per-work-package'

export type OwnershipLeaseStatus = 'active' | 'releasing' | 'transferred' | 'released'

export type ExecutionQueueItemStatus = 'queued' | 'ready' | 'cancelled'

export type ProposalVerificationStatus = 'pending' | 'passed' | 'failed'

export type ProposalAction = 'apply' | 'return-for-rework' | 'reassign' | 'discard'

export type ChangeProposalStatus = 'pending' | 'applied' | 'returned-for-rework' | 'reassigned' | 'discarded'

export interface IsolationDecisionInput {
  risk: TaskRiskLevel
  fileCount: number
}

export interface CircuitBreakerState {
  tripped: boolean
  reason?: string
  metrics: {
    retryCount: number
    repeatedCommands: number
    repeatedFiles: number
    progressDelta: number
  }
  updatedAt: number
}

export interface TaskBudgetLimits {
  timeMs: number
  estimatedTokens: number
  llmCalls: number
  commands: number
  verifications: number
}

export interface TaskBudgetUsage {
  timeMs: number
  estimatedTokens: number
  llmCalls: number
  commands: number
  verifications: number
}

export type TaskBudgetDimension = keyof TaskBudgetUsage

export interface TaskBudgetTripReport {
  exceededDimensions: TaskBudgetDimension[]
  triggeredAt: number
  usage: TaskBudgetUsage
  limits: TaskBudgetLimits
  summary: string
}

export interface TaskBudgetState {
  limits: TaskBudgetLimits
  usage: TaskBudgetUsage
  warningThresholdRatio: number
  warningTriggered: boolean
  hardStop: boolean
  tripReason: string | null
  tripReport: TaskBudgetTripReport | null
  updatedAt: number | null
}

export interface TaskRollbackProposal {
  mode: 'auto-dispose' | 'proposal'
  summary: string
  changedFiles: string[]
  externalSideEffects: string[]
  requiresConfirmation: boolean
}

export interface TaskRollbackState {
  status: 'idle' | 'ready' | 'rolled-back'
  proposal: TaskRollbackProposal | null
  lastUpdatedAt: number | null
}

export interface SpecialistProfile {
  role: SpecialistKind
  provider: string | null
  model: string | null
  toolPermission: SpecialistToolPermission
  networkPermission: SpecialistNetworkPermission
  gitPermission: SpecialistGitPermission
  writableScopes: string[]
  budgetCap: Partial<TaskBudgetLimits>
  styleHints: string
  validationRole: SpecialistValidationRole
  trustMode: TrustMode
  verificationMode: VerificationMode
}

export type SpecialistProfileSnapshot = Partial<Record<SpecialistKind, SpecialistProfile>>

export type AdjudicationTrigger = 'budget-trip' | 'unsafe-merge' | 'verification-failed' | 'rollback-recommended' | 'circuit-breaker' | 'main-workspace-conflict'

export type AdjudicationActionType = 'accept-all' | 'accept-partial' | 'return-for-rework' | 'reassign-specialist' | 'require-verification' | 'rollback'

export interface AdjudicationResolution {
  action: AdjudicationActionType
  selectedFiles?: string[]
  targetSpecialist?: SpecialistKind
  resolvedAt: number
}

export interface AdjudicationCase {
  id: string
  taskId: string
  workPackageId?: string | null
  trigger: AdjudicationTrigger
  reason: string
  changedFiles: string[]
  recommendedAction: AdjudicationActionType
  status: 'open' | 'resolved'
  resolution?: AdjudicationResolution
  createdAt: number
}

export interface ExecutionStrategySnapshot {
  orchestrationMode: OrchestrationMode
  ownershipPolicy: OwnershipPolicy
  conflictPolicy: ConflictPolicy
  workspaceIsolation: WorkspaceIsolationPolicy
  handoffPolicy: HandoffPolicy
  proposalReviewPolicy: ProposalReviewPolicy
}

export interface ExecutionQueueSummary {
  queuedCount: number
  activeLeaseCount: number
  blockedScopes: string[]
  updatedAt: number | null
}

export interface ProposalSummary {
  pendingCount: number
  appliedCount: number
  returnedForReworkCount: number
  reassignedCount: number
  discardedCount: number
  updatedAt: number | null
}

export interface ExecutionHeartbeatSnapshot {
  status: ExecutionHeartbeatStatus
  lastHeartbeatAt: number | null
  lastAssistantOutputAt: number | null
  lastToolActivityAt: number | null
  lastProgressAt: number | null
  lastFileMutationAt: number | null
  stuckReason: string | null
}

export interface PatrolState {
  status: PatrolStatus
  lastCheckedAt: number | null
  lastTransitionAt: number | null
  reason: string | null
}

export interface RecoveryCheckpoint {
  status: 'idle' | 'ready' | 'recovering'
  lastSafeWorkPackageId: string | null
  lastProposalId: string | null
  lastHandoffId: string | null
  resumeCandidateWorkPackageIds: string[]
  updatedAt: number | null
}

export interface OwnershipLease {
  id: string
  taskId: string
  workPackageId: string
  specialist: SpecialistKind
  scope: string
  status: OwnershipLeaseStatus
  queuedWorkPackageIds: string[]
  leasedAt: number
  releasedAt: number | null
}

export interface ExecutionQueueItem {
  id: string
  taskId: string
  workPackageId: string
  blockedScopes: string[]
  blockedByWorkPackageId: string | null
  status: ExecutionQueueItemStatus
  queuedAt: number
  resolvedAt: number | null
}

export interface FileBaselineSnapshot {
  path: string
  exists: boolean
  hash: string | null
}

export interface ChangeProposal {
  id: string
  taskId: string
  workPackageId: string
  summary: string
  changedFiles: string[]
  verificationStatus: ProposalVerificationStatus
  verificationMode?: VerificationMode | null
  verificationSummary?: string | null
  verificationBlockedReason?: string | null
  verificationProvider?: 'playwright' | 'puppeteer' | null
  riskLevel: TaskRiskLevel
  recommendedAction: ProposalAction
  status: ChangeProposalStatus
  applyError?: string | null
  conflictFiles?: string[]
  createdAt: number
  resolvedAt: number | null
}

const DEFAULT_TASK_BUDGET_LIMITS: TaskBudgetLimits = {
  timeMs: 30 * 60 * 1000,
  estimatedTokens: 120_000,
  llmCalls: 24,
  commands: 40,
  verifications: 12,
}

const DEFAULT_SPECIALIST_PROFILES: Record<SpecialistKind, Omit<SpecialistProfile, 'role'>> = {
  frontend: {
    provider: null,
    model: null,
    toolPermission: 'workspace-write',
    networkPermission: 'workspace-only',
    gitPermission: 'task-branch',
    writableScopes: [],
    budgetCap: { llmCalls: 8, commands: 12 },
    styleHints: 'Prefer polished UI, accessibility, and interaction details.',
    validationRole: 'secondary',
    trustMode: DEFAULT_TRUST_POLICY.mode,
    verificationMode: 'browser',
  },
  logic: {
    provider: null,
    model: null,
    toolPermission: 'workspace-write',
    networkPermission: 'workspace-only',
    gitPermission: 'task-branch',
    writableScopes: [],
    budgetCap: { llmCalls: 8, commands: 12 },
    styleHints: 'Prefer correctness, state integrity, and edge-case handling.',
    validationRole: 'secondary',
    trustMode: DEFAULT_TRUST_POLICY.mode,
    verificationMode: 'regression',
  },
  verifier: {
    provider: null,
    model: null,
    toolPermission: 'workspace-write',
    networkPermission: 'workspace-only',
    gitPermission: 'read-only',
    writableScopes: [],
    budgetCap: { llmCalls: 6, verifications: 6 },
    styleHints: 'Prefer focused verification, reproduction, and concise findings.',
    validationRole: 'primary',
    trustMode: DEFAULT_TRUST_POLICY.mode,
    verificationMode: 'regression',
  },
  reviewer: {
    provider: null,
    model: null,
    toolPermission: 'read-mostly',
    networkPermission: 'blocked',
    gitPermission: 'read-only',
    writableScopes: [],
    budgetCap: { llmCalls: 4, verifications: 4 },
    styleHints: 'Prefer risk review, scope control, and minimal-change guidance.',
    validationRole: 'secondary',
    trustMode: DEFAULT_TRUST_POLICY.mode,
    verificationMode: 'static',
  },
}

export function createEmptyTaskBudgetUsage(): TaskBudgetUsage {
  return {
    timeMs: 0,
    estimatedTokens: 0,
    llmCalls: 0,
    commands: 0,
    verifications: 0,
  }
}

export function createDefaultTaskBudget(): TaskBudgetState {
  return {
    limits: { ...DEFAULT_TASK_BUDGET_LIMITS },
    usage: createEmptyTaskBudgetUsage(),
    warningThresholdRatio: 0.8,
    warningTriggered: false,
    hardStop: true,
    tripReason: null,
    tripReport: null,
    updatedAt: null,
  }
}

export function createInitialExecutionTaskGovernanceState(): ExecutionTaskGovernanceState {
  return 'active'
}

export function createInitialRollbackState(): TaskRollbackState {
  return {
    status: 'idle',
    proposal: null,
    lastUpdatedAt: null,
  }
}

export function createDefaultExecutionStrategySnapshot(): ExecutionStrategySnapshot {
  return {
    orchestrationMode: 'mixed',
    ownershipPolicy: 'exclusive',
    conflictPolicy: 'queue',
    workspaceIsolation: 'isolated',
    handoffPolicy: 'auto-on-complete',
    proposalReviewPolicy: 'per-work-package',
  }
}

export function createEmptyExecutionQueueSummary(): ExecutionQueueSummary {
  return {
    queuedCount: 0,
    activeLeaseCount: 0,
    blockedScopes: [],
    updatedAt: null,
  }
}

export function createEmptyProposalSummary(): ProposalSummary {
  return {
    pendingCount: 0,
    appliedCount: 0,
    returnedForReworkCount: 0,
    reassignedCount: 0,
    discardedCount: 0,
    updatedAt: null,
  }
}

export function createEmptyExecutionHeartbeatSnapshot(): ExecutionHeartbeatSnapshot {
  return {
    status: 'idle',
    lastHeartbeatAt: null,
    lastAssistantOutputAt: null,
    lastToolActivityAt: null,
    lastProgressAt: null,
    lastFileMutationAt: null,
    stuckReason: null,
  }
}

export function createInitialPatrolState(): PatrolState {
  return {
    status: 'idle',
    lastCheckedAt: null,
    lastTransitionAt: null,
    reason: null,
  }
}

export function createInitialRecoveryCheckpoint(): RecoveryCheckpoint {
  return {
    status: 'idle',
    lastSafeWorkPackageId: null,
    lastProposalId: null,
    lastHandoffId: null,
    resumeCandidateWorkPackageIds: [],
    updatedAt: null,
  }
}

export function createDefaultSpecialistProfile(role: SpecialistKind): SpecialistProfile {
  return {
    role,
    ...DEFAULT_SPECIALIST_PROFILES[role],
    writableScopes: [...DEFAULT_SPECIALIST_PROFILES[role].writableScopes],
    budgetCap: { ...DEFAULT_SPECIALIST_PROFILES[role].budgetCap },
  }
}

export function createEmptySpecialistProfileSnapshot(
  specialists: SpecialistKind[],
  overrides?: Partial<Record<SpecialistKind, Partial<SpecialistProfile>>>,
): SpecialistProfileSnapshot {
  return Object.fromEntries(
    specialists.map((role) => {
      const defaults = createDefaultSpecialistProfile(role)
      const override = overrides?.[role]
      return [role, {
        ...defaults,
        ...(override || {}),
        role,
        writableScopes: [...(override?.writableScopes || defaults.writableScopes)],
        budgetCap: { ...defaults.budgetCap, ...(override?.budgetCap || {}) },
      }]
    })
  ) as SpecialistProfileSnapshot
}

export interface ExecutionTask {
  id: string
  sourcePlanId?: string
  objective: string
  specialists: SpecialistKind[]
  autonomyMode?: AutonomyMode
  state: ExecutionTaskState
  governanceState: ExecutionTaskGovernanceState
  patrol?: PatrolState
  heartbeat?: ExecutionHeartbeatSnapshot
  recoveryCheckpoint?: RecoveryCheckpoint
  risk: TaskRiskLevel
  executionTarget: ExecutionTarget
  trustMode: TrustMode
  modelRoutingPolicy?: ModelRoutingPolicy
  executionStrategy: ExecutionStrategySnapshot
  workPackages: string[]
  sourceWorkspacePath: string | null
  resolvedWorkspacePath: string | null
  isolationMode: 'worktree' | 'copy' | null
  isolationStatus: IsolationStatus
  isolationError: string | null
  queueSummary: ExecutionQueueSummary
  proposalSummary: ProposalSummary
  latestHandoffId: string | null
  latestProposalId: string | null
  latestAdjudicationId?: string | null
  circuitBreaker?: CircuitBreakerState | null
  budget: TaskBudgetState
  rollback: TaskRollbackState
  specialistProfilesSnapshot: SpecialistProfileSnapshot
  createdAt: number
  updatedAt: number
}

export interface WorkPackage {
  id: string
  taskId: string
  title: string
  objective: string
  specialist: SpecialistKind
  status: WorkPackageStatus
  heartbeat?: ExecutionHeartbeatSnapshot
  recoveryCheckpoint?: RecoveryCheckpoint
  targetDomain: WorkPackageDomain
  verificationMode?: VerificationMode | null
  writableScopes: string[]
  readableScopes: string[]
  dependsOn: string[]
  expectedArtifacts: string[]
  queueReason: string | null
  workspaceId: string | null
  workspaceOwnerId?: string | null
  threadId?: string | null
  baselineFiles?: Record<string, FileBaselineSnapshot>
  handoffId: string | null
  proposalId: string | null
}

export interface TaskHandoff {
  id: string
  taskId: string
  workPackageId: string
  summary: string
  changedFiles: string[]
  unresolvedItems: string[]
  suggestedNextSpecialist?: SpecialistKind
  createdAt: number
}

export interface CreateExecutionTaskInput {
  objective: string
  sourcePlanId?: string
  specialists: SpecialistKind[]
  autonomyMode?: AutonomyMode
  risk?: TaskRiskLevel
  executionTarget?: ExecutionTarget
  trustMode?: TrustMode
  modelRoutingPolicy?: ModelRoutingPolicy
  writableScopes?: string[]
  sourceWorkspacePath?: string | null
  resolvedWorkspacePath?: string | null
  isolationMode?: 'worktree' | 'copy' | null
  isolationStatus?: IsolationStatus
  isolationError?: string | null
  executionStrategy?: ExecutionStrategySnapshot
  queueSummary?: ExecutionQueueSummary
  proposalSummary?: ProposalSummary
  budget?: TaskBudgetState
  governanceState?: ExecutionTaskGovernanceState
  patrol?: PatrolState
  heartbeat?: ExecutionHeartbeatSnapshot
  recoveryCheckpoint?: RecoveryCheckpoint
  rollback?: TaskRollbackState
  specialistProfilesSnapshot?: SpecialistProfileSnapshot
}

export interface CreateTaskHandoffInput {
  taskId: string
  workPackageId: string
  summary: string
  changedFiles?: string[]
  unresolvedItems?: string[]
  suggestedNextSpecialist?: SpecialistKind
}

export interface CreateOwnershipLeaseInput {
  taskId: string
  workPackageId: string
  specialist: SpecialistKind
  scope: string
}

export interface CreateExecutionQueueItemInput {
  taskId: string
  workPackageId: string
  blockedScopes: string[]
  blockedByWorkPackageId?: string | null
}

export interface CreateChangeProposalInput {
  taskId: string
  workPackageId: string
  summary: string
  changedFiles?: string[]
  verificationStatus?: ProposalVerificationStatus
  verificationMode?: VerificationMode | null
  verificationSummary?: string | null
  verificationBlockedReason?: string | null
  verificationProvider?: 'playwright' | 'puppeteer' | null
  riskLevel?: TaskRiskLevel
  recommendedAction?: ProposalAction
}
