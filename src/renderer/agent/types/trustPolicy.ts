import type { ExecutionTarget, InterruptMode, IsolationDecisionInput, TrustMode } from './taskExecution'

export interface TrustPolicy {
  mode: TrustMode
  enableSafetyGuards: boolean
  defaultExecutionTarget: ExecutionTarget
  interruptMode: InterruptMode
}

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  mode: 'balanced',
  enableSafetyGuards: true,
  defaultExecutionTarget: 'auto',
  interruptMode: 'phase',
}

export function shouldUseIsolatedWorkspace(input: IsolationDecisionInput): boolean {
  return input.risk !== 'low' || input.fileCount > 1
}
