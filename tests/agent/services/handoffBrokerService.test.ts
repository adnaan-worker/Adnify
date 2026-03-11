import { describe, expect, it } from 'vitest'

import { buildWorkPackageHandoff } from '@renderer/agent/services/handoffBrokerService'

describe('handoff broker service', () => {
  it('creates durable handoff artifacts with summary and unresolved items', () => {
    const handoff = buildWorkPackageHandoff({
      id: 'handoff-1',
      taskId: 'task-1',
      workPackageId: 'pkg-1',
      summary: 'Frontend work is ready for verification',
      changedFiles: ['src/renderer/App.tsx'],
      unresolvedItems: ['Validate keyboard flow'],
      suggestedNextSpecialist: 'verifier',
      createdAt: 30,
    })

    expect(handoff.summary).toContain('ready for verification')
    expect(handoff.changedFiles).toEqual(['src/renderer/App.tsx'])
    expect(handoff.unresolvedItems).toEqual(['Validate keyboard flow'])
    expect(handoff.suggestedNextSpecialist).toBe('verifier')
  })
})
