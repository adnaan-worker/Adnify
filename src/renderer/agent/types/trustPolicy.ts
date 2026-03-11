import type { ExecutionTarget, InterruptMode, IsolationDecisionInput, ModelRoutingPolicy, TrustMode } from './taskExecution'

export interface TrustPolicy {
  mode: TrustMode
  enableSafetyGuards: boolean
  defaultExecutionTarget: ExecutionTarget
  interruptMode: InterruptMode
  modelRoutingPolicy: ModelRoutingPolicy
}

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  mode: 'balanced',
  enableSafetyGuards: true,
  defaultExecutionTarget: 'auto',
  interruptMode: 'phase',
  modelRoutingPolicy: 'balanced',
}

export function shouldUseIsolatedWorkspace(input: IsolationDecisionInput): boolean {
  return input.risk !== 'low' || input.fileCount > 1
}
