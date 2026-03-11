import { describe, expect, it } from 'vitest'

import { recordBudgetUsage, summarizeBudgetState } from '@renderer/agent/services/budgetLedgerService'
import { createDefaultTaskBudget } from '@renderer/agent/types/taskExecution'

describe('budget ledger service', () => {
  it('accumulates usage and triggers warning before hard trip', () => {
    const initial = createDefaultTaskBudget()
    const budget = recordBudgetUsage(initial, {
      llmCalls: initial.limits.llmCalls - 4,
    }, 1000)

    const summary = summarizeBudgetState(budget)
    expect(budget.usage.llmCalls).toBe(initial.limits.llmCalls - 4)
    expect(summary.warning).toBe(true)
    expect(summary.trip).toBe(false)
  })

  it('creates a structured trip report when a hard limit is exceeded', () => {
    const initial = createDefaultTaskBudget()
    const budget = recordBudgetUsage(initial, {
      commands: initial.limits.commands + 1,
    }, 2000)

    const summary = summarizeBudgetState(budget)
    expect(summary.trip).toBe(true)
    expect(summary.report?.exceededDimensions).toContain('commands')
    expect(summary.report?.triggeredAt).toBe(2000)
  })
})
