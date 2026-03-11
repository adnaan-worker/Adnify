import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentStore } from '@renderer/agent/store/AgentStore'
import {
  restoreExecutionTaskFromRecovery,
  syncTaskRecoveryCheckpoint,
} from '@renderer/agent/services/executionRecoveryService'

describe('execution recovery service', () => {
  beforeEach(() => {
    useAgentStore.setState({
      executionTasks: {},
      workPackages: {},
      taskHandoffs: {},
      changeProposals: {},
      ownershipLeases: {},
      executionQueueItems: {},
      adjudicationCases: {},
      activeExecutionTaskId: null,
      selectedTaskHandoffId: null,
      selectedChangeProposalId: null,
    })
  })

  it('captures a conservative checkpoint from the last safe package boundary', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Resume a partially completed task',
      specialists: ['frontend', 'logic', 'verifier'],
    })
    const [appliedPackageId, proposalPackageId, executingPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    useAgentStore.getState().updateWorkPackage(appliedPackageId, { status: 'applied' })
    useAgentStore.getState().updateWorkPackage(proposalPackageId, { status: 'proposal-ready' })
    useAgentStore.getState().updateWorkPackage(executingPackageId, { status: 'executing' })
    useAgentStore.getState().updateExecutionTask(taskId, {
      latestProposalId: 'proposal-1',
      latestHandoffId: 'handoff-1',
    })

    const checkpoint = syncTaskRecoveryCheckpoint(taskId, { status: 'ready' })
    const state = useAgentStore.getState()

    expect(checkpoint?.status).toBe('ready')
    expect(checkpoint?.lastSafeWorkPackageId).toBe(appliedPackageId)
    expect(checkpoint?.lastProposalId).toBe('proposal-1')
    expect(checkpoint?.lastHandoffId).toBe('handoff-1')
    expect(checkpoint?.resumeCandidateWorkPackageIds).toEqual([executingPackageId])
    expect(state.workPackages[executingPackageId].recoveryCheckpoint?.resumeCandidateWorkPackageIds).toEqual([executingPackageId])
    expect(state.workPackages[proposalPackageId].recoveryCheckpoint?.resumeCandidateWorkPackageIds).toEqual([])
  })

  it('restores only resumable packages to queued when resuming', () => {
    const taskId = useAgentStore.getState().createExecutionTask({
      objective: 'Recover long-running work after interruption',
      specialists: ['frontend', 'logic', 'verifier', 'reviewer'],
    })
    const [appliedPackageId, blockedPackageId, waitingPackageId, proposalPackageId] = useAgentStore.getState().executionTasks[taskId].workPackages

    useAgentStore.getState().updateWorkPackage(appliedPackageId, { status: 'applied' })
    useAgentStore.getState().updateWorkPackage(blockedPackageId, { status: 'blocked' })
    useAgentStore.getState().updateWorkPackage(waitingPackageId, { status: 'executing' })
    useAgentStore.getState().updateWorkPackage(proposalPackageId, { status: 'proposal-ready' })

    syncTaskRecoveryCheckpoint(taskId, { status: 'ready' })
    const result = restoreExecutionTaskFromRecovery(taskId)
    const state = useAgentStore.getState()

    expect(result?.resumedWorkPackageIds).toEqual([blockedPackageId, waitingPackageId])
    expect(state.workPackages[appliedPackageId].status).toBe('applied')
    expect(state.workPackages[blockedPackageId].status).toBe('queued')
    expect(state.workPackages[waitingPackageId].status).toBe('queued')
    expect(state.workPackages[proposalPackageId].status).toBe('proposal-ready')
    expect(state.executionTasks[taskId].recoveryCheckpoint?.status).toBe('recovering')
  })
})
