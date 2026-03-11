import type { CreateTaskHandoffInput, TaskHandoff } from '../types/taskExecution'

export interface BuildWorkPackageHandoffInput extends CreateTaskHandoffInput {
  id?: string
  createdAt?: number
}

function createHandoffId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function buildWorkPackageHandoff(input: BuildWorkPackageHandoffInput): TaskHandoff {
  return {
    id: input.id ?? createHandoffId(),
    taskId: input.taskId,
    workPackageId: input.workPackageId,
    summary: input.summary,
    changedFiles: [...(input.changedFiles || [])],
    unresolvedItems: [...(input.unresolvedItems || [])],
    suggestedNextSpecialist: input.suggestedNextSpecialist,
    createdAt: input.createdAt ?? Date.now(),
  }
}
