import type {
  TaskBudgetDimension,
  TaskBudgetState,
  TaskBudgetTripReport,
  TaskBudgetUsage,
} from '../types/taskExecution'

export interface BudgetStatusSummary {
  warning: boolean
  trip: boolean
  warningDimensions: TaskBudgetDimension[]
  exceededDimensions: TaskBudgetDimension[]
  report: TaskBudgetTripReport | null
}

const BUDGET_DIMENSIONS: TaskBudgetDimension[] = ['timeMs', 'estimatedTokens', 'llmCalls', 'commands', 'verifications']

function mergeUsage(current: TaskBudgetUsage, delta: Partial<TaskBudgetUsage>): TaskBudgetUsage {
  return {
    timeMs: current.timeMs + (delta.timeMs ?? 0),
    estimatedTokens: current.estimatedTokens + (delta.estimatedTokens ?? 0),
    llmCalls: current.llmCalls + (delta.llmCalls ?? 0),
    commands: current.commands + (delta.commands ?? 0),
    verifications: current.verifications + (delta.verifications ?? 0),
  }
}

function createTripReport(budget: TaskBudgetState, exceededDimensions: TaskBudgetDimension[], now: number): TaskBudgetTripReport {
  return {
    exceededDimensions,
    triggeredAt: now,
    usage: { ...budget.usage },
    limits: { ...budget.limits },
    summary: `Budget exceeded for ${exceededDimensions.join(', ')}`,
  }
}

export function summarizeBudgetState(budget: TaskBudgetState): BudgetStatusSummary {
  const warningDimensions = BUDGET_DIMENSIONS.filter((dimension) => {
    const limit = budget.limits[dimension]
    return limit > 0 && budget.usage[dimension] >= limit * budget.warningThresholdRatio
  })
  const exceededDimensions = BUDGET_DIMENSIONS.filter((dimension) => {
    const limit = budget.limits[dimension]
    return limit > 0 && budget.usage[dimension] > limit
  })

  return {
    warning: warningDimensions.length > 0,
    trip: exceededDimensions.length > 0 && budget.hardStop,
    warningDimensions,
    exceededDimensions,
    report: budget.tripReport,
  }
}

export function recordBudgetUsage(
  budget: TaskBudgetState,
  delta: Partial<TaskBudgetUsage>,
  now = Date.now(),
): TaskBudgetState {
  const nextUsage = mergeUsage(budget.usage, delta)
  const nextBudget: TaskBudgetState = {
    ...budget,
    usage: nextUsage,
    updatedAt: now,
  }

  const warningDimensions = BUDGET_DIMENSIONS.filter((dimension) => {
    const limit = nextBudget.limits[dimension]
    return limit > 0 && nextBudget.usage[dimension] >= limit * nextBudget.warningThresholdRatio
  })
  const exceededDimensions = BUDGET_DIMENSIONS.filter((dimension) => {
    const limit = nextBudget.limits[dimension]
    return limit > 0 && nextBudget.usage[dimension] > limit
  })

  nextBudget.warningTriggered = warningDimensions.length > 0

  if (exceededDimensions.length > 0 && nextBudget.hardStop) {
    const report = createTripReport(nextBudget, exceededDimensions, now)
    nextBudget.tripReason = report.summary
    nextBudget.tripReport = report
  }

  return nextBudget
}
