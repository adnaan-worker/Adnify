import { beforeEach, describe, expect, it } from 'vitest'

import { useStore } from '@store'
import { useAgentStore } from '@renderer/agent/store/AgentStore'

describe('task orchestrator slice', () => {
  beforeEach(() => {
    useAgentStore.setState({
      executionTasks: {},
      workPackages: {},
      taskHandoffs: {},
      adjudicationCases: {},
      ownershipLeases: {},
      executionQueueItems: {},
      changeProposals: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
      selectedChangeProposalId: null,
    })

    useStore.setState((state) => ({
      taskTrustSettings: {
        ...state.taskTrustSettings,
        specialistProfiles: {
          ...(state.taskTrustSettings.specialistProfiles || {}),
        },
      },
    }))
  })

  it('creates a task with visible work packages and specialist assignments', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Build auth pages',
      specialists: ['frontend', 'logic'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.specialists).toEqual(['frontend', 'logic'])
    expect(task.workPackages.length).toBeGreaterThan(0)
    expect(task.executionTarget).toBe('isolated')
  })

  it('tracks handoffs against their work package', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Ship onboarding',
      specialists: ['logic'],
    })
    const workPackageId = useAgentStore.getState().executionTasks[taskId].workPackages[0]

    const handoffId = store.createTaskHandoff({
      taskId,
      workPackageId,
      summary: 'Logic implementation ready for verification',
      changedFiles: ['src/renderer/App.tsx'],
      suggestedNextSpecialist: 'verifier',
    })

    const nextState = useAgentStore.getState()
    expect(nextState.taskHandoffs[handoffId].workPackageId).toBe(workPackageId)
    expect(nextState.workPackages[workPackageId].status).toBe('handoff')
    expect(nextState.executionTasks[taskId].latestHandoffId).toBe(handoffId)
    expect(nextState.selectedTaskHandoffId).toBe(handoffId)
  })

  it('stores task-scoped workspace lifecycle defaults', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Refactor workspace launch flow',
      specialists: ['logic', 'verifier'],
      executionTarget: 'isolated',
      sourceWorkspacePath: '/tmp/adnify-workspace',
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.sourceWorkspacePath).toBe('/tmp/adnify-workspace')
    expect(task.resolvedWorkspacePath).toBeNull()
    expect(task.isolationMode).toBeNull()
    expect(task.isolationStatus).toBe('pending')
    expect(task.isolationError).toBeNull()
  })

  it('trips task governance when hard budget limit is exceeded', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Stress budget handling',
      specialists: ['logic'],
    })

    store.recordExecutionTaskBudgetUsage(taskId, {
      commands: useAgentStore.getState().executionTasks[taskId].budget.limits.commands + 1,
    })

    const state = useAgentStore.getState()
    const task = state.executionTasks[taskId]
    expect(task.state).toBe('tripped')
    expect(task.governanceState).toBe('awaiting-adjudication')
    expect(task.budget.tripReport?.exceededDimensions).toContain('commands')
    expect(task.latestAdjudicationId).toBeTruthy()
    expect(state.adjudicationCases[task.latestAdjudicationId!].trigger).toBe('budget-trip')
  })

  it('creates conservative rollback proposals for the main workspace', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Handle rollback proposal',
      specialists: ['logic'],
      executionTarget: 'current',
    })

    store.proposeExecutionTaskRollback(taskId, {
      changedFiles: ['src/renderer/App.tsx'],
      externalSideEffects: ['npm install'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.rollback.status).toBe('ready')
    expect(task.rollback.proposal?.requiresConfirmation).toBe(true)
    expect(task.governanceState).toBe('rollback-ready')
  })

  it('snapshots specialist profile overrides from settings at task creation', () => {
    useStore.setState((state) => ({
      taskTrustSettings: {
        ...state.taskTrustSettings,
        specialistProfiles: {
          ...(state.taskTrustSettings.specialistProfiles || {}),
          frontend: {
            ...((state.taskTrustSettings.specialistProfiles || {}).frontend || {}),
            model: 'gpt-4.1',
            toolPermission: 'elevated',
          },
        },
      },
    }))

    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Design polished UI',
      specialists: ['frontend'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.specialistProfilesSnapshot.frontend?.model).toBe('gpt-4.1')
    expect(task.specialistProfilesSnapshot.frontend?.toolPermission).toBe('elevated')
  })

  it('applies governance defaults and specialist budget caps to new tasks', () => {
    useStore.setState((state) => {
      const governanceDefaults = state.taskTrustSettings.governanceDefaults || {
        budget: { limits: {} },
      }

      return {
        taskTrustSettings: {
          ...state.taskTrustSettings,
          governanceDefaults: {
            ...governanceDefaults,
            budget: {
              ...governanceDefaults.budget,
              limits: {
                ...(governanceDefaults.budget?.limits || {}),
                llmCalls: 10,
                commands: 9,
              },
              warningThresholdRatio: 0.5,
              hardStop: false,
            },
          },
          specialistProfiles: {
          ...(state.taskTrustSettings.specialistProfiles || {}),
          frontend: {
            ...((state.taskTrustSettings.specialistProfiles || {}).frontend || {}),
            model: 'gpt-4.1',
            budgetCap: {
              ...((state.taskTrustSettings.specialistProfiles || {}).frontend?.budgetCap || {}),
              llmCalls: 2,
              commands: 3,
            },
            styleHints: 'Prefer polished UI',
          },
          },
        },
      }
    })

    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Design polished UI',
      specialists: ['frontend'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.budget.limits.llmCalls).toBe(2)
    expect(task.budget.limits.commands).toBe(3)
    expect(task.budget.warningThresholdRatio).toBe(0.5)
    expect(task.budget.hardStop).toBe(false)
    expect(task.specialistProfilesSnapshot.frontend?.model).toBe('gpt-4.1')
  })

  it('creates follow-up work when adjudication returns a task for rework', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Recover from failed merge',
      specialists: ['logic'],
    })
    const originalPackageId = useAgentStore.getState().executionTasks[taskId].workPackages[0]

    const adjudicationId = store.openExecutionTaskAdjudication(taskId, {
      trigger: 'unsafe-merge',
      reason: 'Changed files outside writable scopes',
      workPackageId: originalPackageId,
      changedFiles: ['src/main/main.ts'],
    })

    store.resolveExecutionTaskAdjudication(adjudicationId, {
      action: 'return-for-rework',
    })

    const state = useAgentStore.getState()
    const task = state.executionTasks[taskId]
    const followUpId = task.workPackages[task.workPackages.length - 1]
    expect(followUpId).not.toBe(originalPackageId)
    expect(state.workPackages[followUpId].title).toMatch(/rework/i)
    expect(state.adjudicationCases[adjudicationId].status).toBe('resolved')
  })

  it('creates a task with orchestration strategy snapshot and empty queue/proposal summaries', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Coordinate frontend and logic work',
      specialists: ['frontend', 'logic'],
    })

    const task = useAgentStore.getState().executionTasks[taskId]
    expect(task.executionStrategy.orchestrationMode).toBe('mixed')
    expect(task.executionStrategy.ownershipPolicy).toBe('exclusive')
    expect(task.queueSummary.queuedCount).toBe(0)
    expect(task.proposalSummary.pendingCount).toBe(0)
  })

  it('creates, updates, and releases ownership leases while keeping task lease counts in sync', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Lock writable scopes',
      specialists: ['frontend'],
    })
    const workPackageId = useAgentStore.getState().executionTasks[taskId].workPackages[0]

    const leaseId = store.createOwnershipLease({
      taskId,
      workPackageId,
      specialist: 'frontend',
      scope: 'src/renderer/components',
    })

    store.updateOwnershipLease(leaseId, { queuedWorkPackageIds: ['workpkg-next'] })
    store.releaseOwnershipLease(leaseId)

    const state = useAgentStore.getState()
    expect(state.ownershipLeases[leaseId].queuedWorkPackageIds).toEqual(['workpkg-next'])
    expect(state.ownershipLeases[leaseId].status).toBe('released')
    expect(state.executionTasks[taskId].queueSummary.activeLeaseCount).toBe(0)
  })

  it('tracks queue items and proposals against the owning task', () => {
    const store = useAgentStore.getState()
    const taskId = store.createExecutionTask({
      objective: 'Review package proposal',
      specialists: ['logic'],
    })
    const workPackageId = useAgentStore.getState().executionTasks[taskId].workPackages[0]

    const queueItemId = store.createExecutionQueueItem({
      taskId,
      workPackageId,
      blockedScopes: ['src/renderer/store'],
      blockedByWorkPackageId: 'workpkg-owner',
    })

    const proposalId = store.createChangeProposal({
      taskId,
      workPackageId,
      summary: 'Logic package is ready for review',
      changedFiles: ['src/renderer/store/index.ts'],
      verificationStatus: 'passed',
      riskLevel: 'low',
      recommendedAction: 'apply',
    })

    const state = useAgentStore.getState()
    expect(state.executionQueueItems[queueItemId].blockedScopes).toEqual(['src/renderer/store'])
    expect(state.changeProposals[proposalId].workPackageId).toBe(workPackageId)
    expect(state.executionTasks[taskId].queueSummary.queuedCount).toBe(1)
    expect(state.executionTasks[taskId].proposalSummary.pendingCount).toBe(1)
    expect(state.executionTasks[taskId].latestProposalId).toBe(proposalId)
    expect(state.selectedChangeProposalId).toBe(proposalId)
  })

})
