/**
 * Web Worker 服务
 * 管理计算密集型任务的 Worker 池
 */

import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'
import type { WorkerRequest, WorkerResponse, WorkerMessageType } from '../workers/computeWorker'

// Worker 池配置
const POOL_SIZE = Math.max(1, (navigator.hardwareConcurrency || 4) - 1)

interface PendingTask {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

class WorkerService {
  private workers: Worker[] = []
  private pendingTasks = new Map<string, PendingTask>()
  private taskQueue: WorkerRequest[] = []
  private busyWorkers = new Set<Worker>()
  private initialized = false
  private taskIdCounter = 0

  /**
   * 初始化 Worker 池
   */
  init(): void {
    if (this.initialized) return

    try {
      for (let i = 0; i < POOL_SIZE; i++) {
        const worker = new Worker(
          new URL('../workers/computeWorker.ts', import.meta.url),
          { type: 'module' }
        )

        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          this.handleWorkerResponse(worker, e.data)
        }

        worker.onerror = (e) => {
          logger.system.error('[WorkerService] Worker error:', e)
          this.handleWorkerError(worker, new Error(e.message))
        }

        this.workers.push(worker)
      }

      this.initialized = true
      logger.system.info(`[WorkerService] Initialized with ${POOL_SIZE} workers`)
    } catch (e) {
      logger.system.error('[WorkerService] Failed to initialize:', e)
    }
  }

  /**
   * 执行任务
   */
  async execute<T>(type: WorkerMessageType, payload: unknown): Promise<T> {
    if (!this.initialized) {
      this.init()
    }

    // 如果没有可用的 Worker，在主线程执行（降级）
    if (this.workers.length === 0) {
      return this.executeFallback<T>(type, payload)
    }

    const id = `task-${++this.taskIdCounter}`
    const request: WorkerRequest = { id, type, payload }

    return new Promise<T>((resolve, reject) => {
      const taskTimeout = getEditorConfig().performance.workerTimeoutMs
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(id)
        reject(new Error(`Task ${type} timed out after ${taskTimeout}ms`))
      }, taskTimeout)

      this.pendingTasks.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      })

      this.taskQueue.push(request)
      this.processQueue()
    })
  }

  /**
   * 计算 diff
   */
  async computeDiff(
    oldText: string,
    newText: string,
    options?: { ignoreWhitespace?: boolean; contextLines?: number }
  ): Promise<Array<{ type: 'add' | 'remove' | 'unchanged'; content: string; oldLineNumber?: number; newLineNumber?: number }>> {
    return this.execute('diff', { oldText, newText, options })
  }

  /**
   * 搜索文本
   */
  async searchText(
    text: string,
    pattern: string,
    options?: { isRegex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; maxResults?: number }
  ): Promise<Array<{ line: number; column: number; length: number; text: string }>> {
    return this.execute('search', { text, pattern, options })
  }

  /**
   * 估算 token 数量
   */
  async estimateTokens(text: string): Promise<number> {
    return this.execute('tokenize', { text })
  }

  /**
   * 处理 Worker 响应
   */
  private handleWorkerResponse(worker: Worker, response: WorkerResponse): void {
    this.busyWorkers.delete(worker)

    const task = this.pendingTasks.get(response.id)
    if (task) {
      clearTimeout(task.timeout)
      this.pendingTasks.delete(response.id)

      if (response.success) {
        task.resolve(response.result)
      } else {
        task.reject(new Error(response.error || 'Unknown error'))
      }
    }

    // 处理队列中的下一个任务
    this.processQueue()
  }

  /**
   * 处理 Worker 错误
   */
  private handleWorkerError(worker: Worker, error: Error): void {
    this.busyWorkers.delete(worker)

    // 找到该 Worker 正在处理的任务并拒绝
    // 由于我们不跟踪 Worker 到任务的映射，这里简单处理
    logger.system.error('[WorkerService] Worker error:', error)

    // 处理队列中的下一个任务
    this.processQueue()
  }

  /**
   * 处理任务队列
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const availableWorker = this.workers.find(w => !this.busyWorkers.has(w))
      if (!availableWorker) break

      const task = this.taskQueue.shift()
      if (task) {
        this.busyWorkers.add(availableWorker)
        availableWorker.postMessage(task)
      }
    }
  }

  /**
   * 降级：在主线程执行
   */
  private async executeFallback<T>(type: WorkerMessageType, payload: unknown): Promise<T> {
    logger.system.warn('[WorkerService] Falling back to main thread execution')

    switch (type) {
      case 'diff':
        // 简单的 diff 降级实现
        const { oldText, newText } = payload as { oldText: string; newText: string }
        const oldLines = oldText.split('\n')
        const newLines = newText.split('\n')
        const result: Array<{ type: 'add' | 'remove' | 'unchanged'; content: string }> = []
        
        const maxLen = Math.max(oldLines.length, newLines.length)
        for (let i = 0; i < maxLen; i++) {
          if (i >= oldLines.length) {
            result.push({ type: 'add', content: newLines[i] })
          } else if (i >= newLines.length) {
            result.push({ type: 'remove', content: oldLines[i] })
          } else if (oldLines[i] === newLines[i]) {
            result.push({ type: 'unchanged', content: newLines[i] })
          } else {
            result.push({ type: 'remove', content: oldLines[i] })
            result.push({ type: 'add', content: newLines[i] })
          }
        }
        return result as T

      case 'tokenize':
        const { text } = payload as { text: string }
        return Math.ceil(text.length / 4) as T

      default:
        throw new Error(`Unsupported fallback for type: ${type}`)
    }
  }

  /**
   * 销毁所有 Worker
   */
  destroy(): void {
    for (const worker of this.workers) {
      worker.terminate()
    }
    this.workers = []
    this.busyWorkers.clear()
    
    // 拒绝所有待处理的任务
    for (const [, task] of this.pendingTasks) {
      clearTimeout(task.timeout)
      task.reject(new Error('Worker service destroyed'))
    }
    this.pendingTasks.clear()
    this.taskQueue = []
    this.initialized = false

    logger.system.info('[WorkerService] Destroyed')
  }
}

export const workerService = new WorkerService()
