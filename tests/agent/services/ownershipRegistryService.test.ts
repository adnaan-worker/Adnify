import { describe, expect, it } from 'vitest'

import {
  acquireOwnership,
  createOwnershipRegistrySnapshot,
  reclaimStaleOwnershipLeases,
  releaseOwnership,
} from '@renderer/agent/services/ownershipRegistryService'

describe('ownership registry service', () => {
  it('acquires leases when requested scopes are free', () => {
    const result = acquireOwnership(createOwnershipRegistrySnapshot(), {
      taskId: 'task-1',
      workPackageId: 'pkg-1',
      specialist: 'frontend',
      scopes: ['src/renderer/components'],
      now: 10,
    })

    expect(result.status).toBe('acquired')
    expect(result.leases).toHaveLength(1)
    expect(result.queueItem).toBeNull()
    expect(result.snapshot.leases[result.leases[0].id].scope).toBe('src/renderer/components')
  })

  it('queues conflicting work packages with deterministic blocker metadata', () => {
    const first = acquireOwnership(createOwnershipRegistrySnapshot(), {
      taskId: 'task-1',
      workPackageId: 'pkg-1',
      specialist: 'frontend',
      scopes: ['src/renderer/components'],
      now: 1,
    })

    const second = acquireOwnership(first.snapshot, {
      taskId: 'task-1',
      workPackageId: 'pkg-2',
      specialist: 'logic',
      scopes: ['src/renderer/components/button'],
      now: 2,
    })

    expect(second.status).toBe('queued')
    expect(second.blockedScopes).toEqual(['src/renderer/components/button'])
    expect(second.blockedByWorkPackageId).toBe('pkg-1')
    expect(second.queueItem?.status).toBe('queued')
  })

  it('wakes the next queued package in FIFO order when scopes are released', () => {
    let snapshot = createOwnershipRegistrySnapshot()

    snapshot = acquireOwnership(snapshot, {
      taskId: 'task-1',
      workPackageId: 'pkg-1',
      specialist: 'frontend',
      scopes: ['src/renderer/components'],
      now: 1,
    }).snapshot

    const second = acquireOwnership(snapshot, {
      taskId: 'task-1',
      workPackageId: 'pkg-2',
      specialist: 'logic',
      scopes: ['src/renderer/components'],
      now: 2,
    })

    const third = acquireOwnership(second.snapshot, {
      taskId: 'task-1',
      workPackageId: 'pkg-3',
      specialist: 'verifier',
      scopes: ['src/renderer/components'],
      now: 3,
    })

    const release = releaseOwnership(third.snapshot, {
      workPackageId: 'pkg-1',
      now: 4,
    })

    expect(release.activatedQueueItemIds).toEqual([second.queueItem!.id])
    expect(release.snapshot.queueItems[second.queueItem!.id].status).toBe('ready')
    expect(release.snapshot.queueItems[third.queueItem!.id].status).toBe('queued')
  })

  it('reclaims stale leases and advances waiting work', () => {
    let snapshot = createOwnershipRegistrySnapshot()

    snapshot = acquireOwnership(snapshot, {
      taskId: 'task-1',
      workPackageId: 'pkg-1',
      specialist: 'frontend',
      scopes: ['src/renderer/components'],
      now: 1,
    }).snapshot

    const queued = acquireOwnership(snapshot, {
      taskId: 'task-1',
      workPackageId: 'pkg-2',
      specialist: 'logic',
      scopes: ['src/renderer/components'],
      now: 2,
    })

    const reclaimed = reclaimStaleOwnershipLeases(queued.snapshot, {
      staleBefore: 5,
      now: 10,
    })

    expect(reclaimed.releasedLeaseIds).toHaveLength(1)
    expect(reclaimed.snapshot.queueItems[queued.queueItem!.id].status).toBe('ready')
  })
})
