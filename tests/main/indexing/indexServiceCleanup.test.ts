import fs from 'fs'
import os from 'os'
import path from 'path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/indexing/treeSitterChunker', () => ({
  TreeSitterChunker: class {
    async init() {}
    async chunkFile() { return [] }
  },
}))

vi.mock('@main/indexing/chunker', () => ({
  ChunkerService: class {
    chunkFile() { return [] }
  },
}))

vi.mock('@main/indexing/embedder', () => ({
  EmbeddingService: class {
    updateConfig() {}
    async testConnection() { return { success: true } }
  },
}))

vi.mock('@main/indexing/vectorStore', () => ({
  VectorStoreService: class {
    async initialize() {}
    isInitialized() { return true }
    async getFileHashes() { return new Map() }
    async addBatch() {}
    async deleteFile() {}
    async upsertFile() {}
    async clear() {}
    async hasIndex() { return false }
    async search() { return [] }
    async keywordSearch() { return [] }
  },
}))

vi.mock('@main/indexing/search', () => ({
  BM25Index: class {
    size = 0
    clear() {}
    build() {}
    fromJSON() {}
    toJSON() { return {} }
    addDocument() {}
    deleteFile() {}
  },
  SymbolIndex: class {
    size = 0
    fileCount = 0
    clear() {}
    fromJSON() {}
    toJSON() { return {} }
    deleteFile() {}
  },
}))

vi.mock('@main/indexing/summary', () => ({
  ProjectSummaryGenerator: class {
    constructor(_workspacePath: string) {}
    async loadCache() { return null }
  },
}))


vi.mock('@main/services/configPath', () => ({
  getUserConfigDir: () => '/tmp/adnify-test-config',
}))

import { CodebaseIndexService } from '@main/indexing'

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adnify-index-cleanup-'))
}

describe('index service cleanup', () => {
  it('destroys an idle worker after the timeout elapses', () => {
    const service = new CodebaseIndexService(makeWorkspace(), { mode: 'semantic' }) as any
    const worker = { terminate: vi.fn() }

    service.worker = worker
    service.status.isIndexing = false
    service.workerLastActivityAt = 1_000

    const reclaimed = service.reclaimIdleWorker(5_000, 2_000)

    expect(reclaimed).toBe(true)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(service.worker).toBeNull()
  })

  it('keeps a recently active worker alive', () => {
    const service = new CodebaseIndexService(makeWorkspace(), { mode: 'semantic' }) as any
    const worker = { terminate: vi.fn() }

    service.worker = worker
    service.status.isIndexing = false
    service.markWorkerActivity(4_000)

    const reclaimed = service.reclaimIdleWorker(4_500, 2_000)

    expect(reclaimed).toBe(false)
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(service.worker).toBe(worker)
  })

  it('does not reclaim while indexing is in progress', () => {
    const service = new CodebaseIndexService(makeWorkspace(), { mode: 'semantic' }) as any
    const worker = { terminate: vi.fn() }

    service.worker = worker
    service.status.isIndexing = true
    service.workerLastActivityAt = 1_000

    const reclaimed = service.reclaimIdleWorker(5_000, 2_000)

    expect(reclaimed).toBe(false)
    expect(worker.terminate).not.toHaveBeenCalled()
  })
})
