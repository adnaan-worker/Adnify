import type {
  ExecutionTarget,
  TaskRollbackProposal,
  TaskRollbackState,
} from '../types/taskExecution'

export interface RollbackGovernanceOptions {
  autoRollbackIsolated?: boolean
  requireConfirmationForMainWorkspace?: boolean
  warnOnExternalSideEffects?: boolean
}

export interface CreateRollbackProposalInput {
  executionTarget: ExecutionTarget
  changedFiles?: string[]
  externalSideEffects?: string[]
  resolvedWorkspacePath?: string | null
}

export function createRollbackProposal(
  input: CreateRollbackProposalInput,
  options: RollbackGovernanceOptions = {},
): TaskRollbackProposal {
  const changedFiles = [...(input.changedFiles || [])]
  const externalSideEffects = [...(input.externalSideEffects || [])]
  const autoRollbackIsolated = options.autoRollbackIsolated ?? true
  const requireConfirmationForMainWorkspace = options.requireConfirmationForMainWorkspace ?? true
  const warnOnExternalSideEffects = options.warnOnExternalSideEffects ?? true
  const sideEffectSuffix = warnOnExternalSideEffects && externalSideEffects.length > 0
    ? ' External side effects were recorded.'
    : ''

  if (input.executionTarget === 'isolated' && autoRollbackIsolated) {
    return {
      mode: 'auto-dispose',
      summary: `Dispose isolated workspace${input.resolvedWorkspacePath ? ` ${input.resolvedWorkspacePath}` : ''}.${sideEffectSuffix}`.trim(),
      changedFiles,
      externalSideEffects,
      requiresConfirmation: false,
    }
  }

  if (input.executionTarget === 'isolated') {
    return {
      mode: 'proposal',
      summary: `Rollback proposal requires confirmation before disposing the isolated workspace.${sideEffectSuffix}`.trim(),
      changedFiles,
      externalSideEffects,
      requiresConfirmation: true,
    }
  }

  return {
    mode: 'proposal',
    summary: `${requireConfirmationForMainWorkspace
      ? 'Rollback proposal requires confirmation before reverting main-workspace files.'
      : 'Rollback proposal is ready for main-workspace revert.'}${sideEffectSuffix}`.trim(),
    changedFiles,
    externalSideEffects,
    requiresConfirmation: requireConfirmationForMainWorkspace,
  }
}

export function createRollbackStateFromProposal(
  proposal: TaskRollbackProposal,
  now = Date.now(),
): TaskRollbackState {
  return {
    status: 'ready',
    proposal,
    lastUpdatedAt: now,
  }
}
