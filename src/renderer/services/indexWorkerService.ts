/**
 * Index Worker Service
 * Manages the background indexing via Electron IPC
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { IndexStatus } from '@shared/types'

// ============ Types ============

export interface IndexProgress {
  processed: number
  total: number
  chunksCount: number
  isComplete: boolean
  error?: string
  message?: string
}

export interface IndexResult {
  chunks: any[] // We don't get chunks back in progress, only stats
  totalFiles: number
  totalChunks: number
}

type ProgressCallback = (progress: IndexProgress) => void
type CompleteCallback = (result: IndexResult) => void
type ErrorCallback = (error: string) => void

// ============ Worker Service ============

class IndexWorkerService {
  private progressCallbacks: Set<ProgressCallback> = new Set()
  private completeCallbacks: Set<CompleteCallback> = new Set()
  private errorCallbacks: Set<ErrorCallback> = new Set()
  private isInitialized = false
  private stopListener: (() => void) | null = null

  /**
   * Initialize the service and listeners
   */
  initialize(): void {
    if (this.isInitialized) return

    try {
      this.stopListener = api.index.onProgress((status: IndexStatus) => {
        this.handleStatusUpdate(status)
      })

      this.isInitialized = true
      logger.index.info('[IndexWorkerService] Initialized (IPC)')
    } catch (error) {
      logger.index.error('[IndexWorkerService] Failed to initialize:', error)
    }
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.isInitialized
  }

  /**
   * Start indexing files
   */
  async startIndexing(workspacePath: string): Promise<void> {
    if (!this.isInitialized) this.initialize()
    await api.index.start(workspacePath)
  }

  /**
   * Stop current indexing (Not directly supported in simple IPC yet, but we can clear)
   */
  stopIndexing(): void {
    // No-op for now unless we add cancel to backend
    logger.index.warn('[IndexWorkerService] Stop not fully implemented in backend')
  }

  /**
   * Update a single file
   */
  async updateFile(workspacePath: string, filePath: string): Promise<void> {
    await api.index.updateFile(workspacePath, filePath)
  }

  /**
   * Clear the index
   */
  async clear(workspacePath: string): Promise<void> {
    await api.index.clear(workspacePath)
  }

  /**
   * Subscribe to progress updates
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  /**
   * Subscribe to completion
   */
  onComplete(callback: CompleteCallback): () => void {
    this.completeCallbacks.add(callback)
    return () => this.completeCallbacks.delete(callback)
  }

  /**
   * Subscribe to errors
   */
  onError(callback: ErrorCallback): () => void {
    this.errorCallbacks.add(callback)
    return () => this.errorCallbacks.delete(callback)
  }

  /**
   * Terminate the service
   */
  terminate(): void {
    if (this.stopListener) {
      this.stopListener()
      this.stopListener = null
    }
    this.isInitialized = false
    this.progressCallbacks.clear()
    this.completeCallbacks.clear()
    this.errorCallbacks.clear()
  }

  // ============ Private Methods ============

  private handleStatusUpdate(status: IndexStatus): void {
    const progress: IndexProgress = {
      processed: status.indexedFiles,
      total: status.totalFiles,
      chunksCount: status.totalChunks,
      isComplete: !status.isIndexing,
      error: status.error,
      message: status.message,
    }

    this.progressCallbacks.forEach(cb => cb(progress))

    if (status.error) {
      this.errorCallbacks.forEach(cb => cb(status.error!))
    }

    if (!status.isIndexing && status.totalFiles > 0) {
      this.completeCallbacks.forEach(cb => cb({
        chunks: [], // We don't return chunks anymore to frontend to save memory
        totalFiles: status.totalFiles,
        totalChunks: status.totalChunks,
      }))
    }
  }
}

// Export singleton
export const indexWorkerService = new IndexWorkerService()

