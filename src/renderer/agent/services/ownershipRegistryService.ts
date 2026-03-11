import type {
  ExecutionQueueItem,
  OwnershipLease,
  SpecialistKind,
} from '../types/taskExecution'

export interface OwnershipRegistrySnapshot {
  leases: Record<string, OwnershipLease>
  queueItems: Record<string, ExecutionQueueItem>
}

export interface AcquireOwnershipInput {
  taskId: string
  workPackageId: string
  specialist: SpecialistKind
  scopes: string[]
  now?: number
}

export interface AcquireOwnershipResult {
  snapshot: OwnershipRegistrySnapshot
  status: 'acquired' | 'queued'
  leases: OwnershipLease[]
  queueItem: ExecutionQueueItem | null
  blockedScopes: string[]
  blockedByWorkPackageId: string | null
}

export interface ReleaseOwnershipInput {
  workPackageId: string
  now?: number
}

export interface ReleaseOwnershipResult {
  snapshot: OwnershipRegistrySnapshot
  releasedLeaseIds: string[]
  activatedQueueItemIds: string[]
}

export interface ReclaimStaleOwnershipInput {
  staleBefore: number
  now?: number
}

function createId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
}

function scopesOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
}

function sortQueueItems(left: ExecutionQueueItem, right: ExecutionQueueItem): number {
  return (left.queuedAt - right.queuedAt) || left.id.localeCompare(right.id)
}

function sortLeases(left: OwnershipLease, right: OwnershipLease): number {
  return (left.leasedAt - right.leasedAt) || left.id.localeCompare(right.id)
}

function activateReadyQueueItems(
  snapshot: OwnershipRegistrySnapshot,
  now: number,
): Pick<ReleaseOwnershipResult, 'activatedQueueItemIds'> & { queueItems: Record<string, ExecutionQueueItem> } {
  const reservedScopes = Object.values(snapshot.leases)
    .filter((lease) => lease.status !== 'released')
    .map((lease) => normalizePath(lease.scope))
  const queueItems = { ...snapshot.queueItems }
  const activatedQueueItemIds: string[] = []

  for (const item of Object.values(snapshot.queueItems)
    .filter((queueItem) => queueItem.status === 'queued')
    .sort(sortQueueItems)) {
    const blockedScopes = item.blockedScopes.map(normalizePath)
    const stillBlocked = blockedScopes.some((scope) =>
      reservedScopes.some((reservedScope) => scopesOverlap(scope, reservedScope)),
    )

    if (stillBlocked) continue

    queueItems[item.id] = {
      ...item,
      status: 'ready',
      resolvedAt: now,
    }
    reservedScopes.push(...blockedScopes)
    activatedQueueItemIds.push(item.id)
  }

  return { queueItems, activatedQueueItemIds }
}

export function createOwnershipRegistrySnapshot(
  input: Partial<OwnershipRegistrySnapshot> = {},
): OwnershipRegistrySnapshot {
  return {
    leases: { ...(input.leases || {}) },
    queueItems: { ...(input.queueItems || {}) },
  }
}

export function acquireOwnership(
  snapshot: OwnershipRegistrySnapshot,
  input: AcquireOwnershipInput,
): AcquireOwnershipResult {
  const now = input.now ?? Date.now()
  const scopes = Array.from(new Set(input.scopes.map(normalizePath).filter(Boolean)))
  const blockers = Object.values(snapshot.leases)
    .filter((lease) => lease.status !== 'released')
    .filter((lease) => scopes.some((scope) => scopesOverlap(scope, normalizePath(lease.scope))))
    .sort(sortLeases)

  if (blockers.length === 0) {
    const leases = scopes.map<OwnershipLease>((scope) => ({
      id: createId('lease'),
      taskId: input.taskId,
      workPackageId: input.workPackageId,
      specialist: input.specialist,
      scope,
      status: 'active',
      queuedWorkPackageIds: [],
      leasedAt: now,
      releasedAt: null,
    }))

    return {
      snapshot: {
        leases: {
          ...snapshot.leases,
          ...Object.fromEntries(leases.map((lease) => [lease.id, lease])),
        },
        queueItems: { ...snapshot.queueItems },
      },
      status: 'acquired',
      leases,
      queueItem: null,
      blockedScopes: [],
      blockedByWorkPackageId: null,
    }
  }

  const blockedScopes = scopes.filter((scope) =>
    blockers.some((lease) => scopesOverlap(scope, normalizePath(lease.scope))),
  )
  const queueItem: ExecutionQueueItem = {
    id: createId('queue'),
    taskId: input.taskId,
    workPackageId: input.workPackageId,
    blockedScopes,
    blockedByWorkPackageId: blockers[0]?.workPackageId ?? null,
    status: 'queued',
    queuedAt: now,
    resolvedAt: null,
  }

  return {
    snapshot: {
      leases: { ...snapshot.leases },
      queueItems: {
        ...snapshot.queueItems,
        [queueItem.id]: queueItem,
      },
    },
    status: 'queued',
    leases: [],
    queueItem,
    blockedScopes,
    blockedByWorkPackageId: queueItem.blockedByWorkPackageId,
  }
}

export function releaseOwnership(
  snapshot: OwnershipRegistrySnapshot,
  input: ReleaseOwnershipInput,
): ReleaseOwnershipResult {
  const now = input.now ?? Date.now()
  const releasedLeaseIds = Object.values(snapshot.leases)
    .filter((lease) => lease.workPackageId === input.workPackageId && lease.status !== 'released')
    .sort(sortLeases)
    .map((lease) => lease.id)

  const leases = { ...snapshot.leases }
  for (const leaseId of releasedLeaseIds) {
    leases[leaseId] = {
      ...leases[leaseId],
      status: 'released',
      releasedAt: now,
    }
  }

  const { queueItems, activatedQueueItemIds } = activateReadyQueueItems({
    leases,
    queueItems: snapshot.queueItems,
  }, now)

  return {
    snapshot: {
      leases,
      queueItems,
    },
    releasedLeaseIds,
    activatedQueueItemIds,
  }
}

export function reclaimStaleOwnershipLeases(
  snapshot: OwnershipRegistrySnapshot,
  input: ReclaimStaleOwnershipInput,
): ReleaseOwnershipResult {
  const now = input.now ?? Date.now()
  const leases = { ...snapshot.leases }
  const releasedLeaseIds = Object.values(snapshot.leases)
    .filter((lease) => lease.status !== 'released' && lease.leasedAt < input.staleBefore)
    .sort(sortLeases)
    .map((lease) => lease.id)

  for (const leaseId of releasedLeaseIds) {
    leases[leaseId] = {
      ...leases[leaseId],
      status: 'released',
      releasedAt: now,
    }
  }

  const { queueItems, activatedQueueItemIds } = activateReadyQueueItems({
    leases,
    queueItems: snapshot.queueItems,
  }, now)

  return {
    snapshot: {
      leases,
      queueItems,
    },
    releasedLeaseIds,
    activatedQueueItemIds,
  }
}
