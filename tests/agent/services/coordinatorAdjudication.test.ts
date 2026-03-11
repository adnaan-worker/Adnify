import { describe, expect, it } from 'vitest'

import {
  createAdjudicationCase,
  resolveAdjudicationCase,
} from '@renderer/agent/services/coordinatorService'

describe('coordinator adjudication', () => {
  it('creates open adjudication cases with conservative defaults', () => {
    const caseItem = createAdjudicationCase({
      id: 'adj-1',
      taskId: 'task-1',
      trigger: 'budget-trip',
      reason: 'Budget exceeded for commands',
      changedFiles: ['src/main/main.ts'],
    })

    expect(caseItem.status).toBe('open')
    expect(caseItem.recommendedAction).toBe('return-for-rework')
  })

  it('resolves partial acceptance with selected files', () => {
    const caseItem = createAdjudicationCase({
      id: 'adj-2',
      taskId: 'task-1',
      trigger: 'unsafe-merge',
      reason: 'Changed files outside writable scopes',
      changedFiles: ['src/main/main.ts', 'src/renderer/App.tsx'],
    })

    const resolution = resolveAdjudicationCase(caseItem, {
      action: 'accept-partial',
      selectedFiles: ['src/renderer/App.tsx'],
    })

    expect(resolution.caseItem.status).toBe('resolved')
    expect(resolution.caseItem.resolution?.selectedFiles).toEqual(['src/renderer/App.tsx'])
  })
})
