/**
 * 执行调度器
 * 
 * 职责：
 * - 确定可执行的任务（依赖已满足）
 * - 支持顺序和并行执行
 * - 处理任务失败和依赖传播
 */

import { logger } from '@utils/Logger'
import type {
    TaskPlan,
    OrchestratorTask,
    TaskExecutionResult,
    ExecutionStats,
    OrchestratorConfig,
} from './types'
import { DEFAULT_ORCHESTRATOR_CONFIG } from './types'

// ============================================
// 执行调度器
// ============================================

export class ExecutionScheduler {
    private config: OrchestratorConfig
    private runningTasks: Set<string> = new Set()
    private abortController: AbortController | null = null

    constructor(config: Partial<OrchestratorConfig> = {}) {
        this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config }
    }

    // ============================================
    // 任务查询
    // ============================================

    /**
     * 获取所有可执行的任务（依赖已满足且未执行）
     */
    getExecutableTasks(plan: TaskPlan): OrchestratorTask[] {
        const executable: OrchestratorTask[] = []

        for (const task of plan.tasks) {
            if (task.status !== 'pending') continue
            if (this.runningTasks.has(task.id)) continue

            const depStatus = this.checkDependencies(task, plan)

            if (depStatus === 'ready') {
                executable.push(task)
            } else if (depStatus === 'blocked') {
                // 依赖失败，自动跳过
                if (this.config.autoSkipOnDependencyFailure) {
                    this.markTaskSkipped(task, 'Dependency failed or skipped')
                }
            }
            // depStatus === 'waiting' -> 继续等待
        }

        return executable
    }

    /**
     * 检查任务的依赖状态
     */
    private checkDependencies(task: OrchestratorTask, plan: TaskPlan): 'ready' | 'waiting' | 'blocked' {
        if (task.dependencies.length === 0) return 'ready'

        let allCompleted = true

        for (const depId of task.dependencies) {
            const depTask = plan.tasks.find(t => t.id === depId)
            if (!depTask) {
                logger.agent.warn(`[Scheduler] Dependency not found: ${depId}`)
                continue
            }

            if (depTask.status === 'failed' || depTask.status === 'skipped') {
                return 'blocked'
            }

            if (depTask.status !== 'completed') {
                allCompleted = false
            }
        }

        return allCompleted ? 'ready' : 'waiting'
    }

    /**
     * 标记任务为跳过
     */
    private markTaskSkipped(task: OrchestratorTask, reason: string): void {
        task.status = 'skipped'
        task.error = reason
        logger.agent.info(`[Scheduler] Task skipped: ${task.id} - ${reason}`)
    }

    /**
     * 获取下一个待执行任务（顺序模式）
     */
    getNextTask(plan: TaskPlan): OrchestratorTask | null {
        const executable = this.getExecutableTasks(plan)
        return executable[0] || null
    }

    // ============================================
    // 执行控制
    // ============================================

    /**
     * 开始执行
     */
    start(): void {
        this.abortController = new AbortController()
        this.runningTasks.clear()
    }

    /**
     * 停止执行
     */
    stop(): void {
        if (this.abortController) {
            this.abortController.abort()
            this.abortController = null
        }
        this.runningTasks.clear()
    }

    /**
     * 暂停执行
     */
    pause(): void {
        this.abortController?.abort()
    }

    /**
     * 恢复执行
     */
    resume(): void {
        this.abortController = new AbortController()
    }

    /**
     * 检查是否已中止
     */
    get isAborted(): boolean {
        return this.abortController?.signal.aborted ?? true
    }

    /**
     * 获取中止信号
     */
    get abortSignal(): AbortSignal | undefined {
        return this.abortController?.signal
    }

    // ============================================
    // 任务状态管理
    // ============================================

    /**
     * 标记任务开始执行
     */
    markTaskRunning(task: OrchestratorTask): void {
        task.status = 'running'
        task.startedAt = Date.now()
        this.runningTasks.add(task.id)
    }

    /**
     * 标记任务完成
     */
    markTaskCompleted(task: OrchestratorTask, output: string): TaskExecutionResult {
        const duration = Date.now() - (task.startedAt || Date.now())
        task.status = 'completed'
        task.output = output
        task.completedAt = Date.now()
        this.runningTasks.delete(task.id)

        return { taskId: task.id, success: true, output, duration }
    }

    /**
     * 标记任务失败
     */
    markTaskFailed(task: OrchestratorTask, error: string): TaskExecutionResult {
        const duration = Date.now() - (task.startedAt || Date.now())
        task.status = 'failed'
        task.error = error
        task.completedAt = Date.now()
        this.runningTasks.delete(task.id)

        return { taskId: task.id, success: false, output: '', error, duration }
    }

    // ============================================
    // 进度统计
    // ============================================

    /**
     * 检查计划是否完成
     */
    isComplete(plan: TaskPlan): boolean {
        return plan.tasks.every(t =>
            t.status === 'completed' || t.status === 'failed' || t.status === 'skipped'
        )
    }

    /**
     * 检查是否有任务正在运行
     */
    hasRunningTasks(): boolean {
        return this.runningTasks.size > 0
    }

    /**
     * 计算执行统计
     */
    calculateStats(plan: TaskPlan, startedAt: number): ExecutionStats {
        const tasks = plan.tasks
        return {
            totalTasks: tasks.length,
            completedTasks: tasks.filter(t => t.status === 'completed').length,
            failedTasks: tasks.filter(t => t.status === 'failed').length,
            skippedTasks: tasks.filter(t => t.status === 'skipped').length,
            totalDuration: Date.now() - startedAt,
            startedAt,
            completedAt: this.isComplete(plan) ? Date.now() : undefined,
        }
    }

    // ============================================
    // 并行执行支持
    // ============================================

    /**
     * 获取可并行执行的任务批次
     */
    getParallelBatch(plan: TaskPlan): OrchestratorTask[] {
        const executable = this.getExecutableTasks(plan)
        // 限制并发数
        return executable.slice(0, this.config.maxConcurrency)
    }
}
