/**
 * Orchestrator 执行引擎
 * 
 * 职责：
 * - 启动/停止计划执行
 * - 为每个任务创建执行上下文
 * - 调用现有 Agent 系统执行任务
 * - 更新任务状态到 Store
 * 
 * 设计原则：
 * - 复用 buildAgentSystemPrompt() 构建提示词
 * - 复用 Agent.send() 执行任务
 * - task.role 映射到 promptTemplateId
 * - task.provider + task.model 直接使用
 */

import { useAgentStore } from '../store/AgentStore'
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { EventBus } from '../core/EventBus'
import { Agent } from '../core/Agent'
import { gitService } from './gitService'
import { ExecutionScheduler } from '../orchestrator/ExecutionScheduler'
import { getLLMConfigForTask } from './llmConfigService'
import type { TaskPlan, OrchestratorTask, ExecutionStats } from '../orchestrator/types'

// ============================================
// 模块状态
// ============================================

let scheduler: ExecutionScheduler | null = null
let executionStartedAt = 0
let isRunning = false

/** 等待单次 Agent 执行完成 */
function waitForAgentCompletion(): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
        const store = useAgentStore.getState()
        const threadId = store.currentThreadId

        if (!threadId) {
            resolve({ success: false, output: '', error: 'Failed to create thread' })
            return
        }

        const unsubscribe = EventBus.on('loop:end', (event) => {
            const thread = store.threads[threadId]
            if (!thread) {
                unsubscribe()
                resolve({ success: false, output: '', error: 'Thread not found after loop end' })
                return
            }

            const lastAssistantMsg = thread.messages
                .filter(m => m.role === 'assistant')
                .pop() as import('../types').AssistantMessage

            const output = lastAssistantMsg?.content || 'Task execution completed'
            unsubscribe()

            if (event.reason === 'error' || event.reason === 'aborted') {
                resolve({ success: false, output: '', error: `Execution ended with reason: ${event.reason}` })
            } else {
                resolve({ success: true, output })
            }
        })
    })
}

// ============================================
// 公共 API
// ============================================

/**
 * 开始执行计划
 */
export async function startPlanExecution(
    planId?: string
): Promise<{ success: boolean; message: string }> {
    const store = useAgentStore.getState()

    // 获取计划
    const plan = planId
        ? store.plans.find(p => p.id === planId)
        : store.getActivePlan()

    if (!plan) {
        return { success: false, message: 'No active plan found' }
    }

    if (plan.tasks.length === 0) {
        return { success: false, message: 'Plan has no tasks' }
    }

    // 使用 gitService 获取工作区路径
    const workspacePath = gitService.getWorkspace()
    if (!workspacePath) {
        return { success: false, message: 'No workspace open' }
    }

    // 加载需求文档内容
    try {
        const requirementsPath = `${workspacePath}/.adnify/plan/${plan.requirementsDoc}`
        const requirementsContent = await api.file.read(requirementsPath)
        plan.requirementsContent = requirementsContent || undefined
    } catch (e) {
        logger.agent.warn('[OrchestratorExecutor] Failed to load requirements document:', e)
    }

    // 初始化调度器
    scheduler = new ExecutionScheduler()
    scheduler.start()
    executionStartedAt = Date.now()
    isRunning = true

    // 更新 Store 状态
    store.startExecution(plan.id)

    logger.agent.info(`[OrchestratorExecutor] Started execution of plan: ${plan.name}`)

    // 发布事件
    EventBus.emit({ type: 'plan:start', planId: plan.id } as any)

    // 异步执行（不阻塞返回）
    runExecutionLoop(plan, workspacePath).catch(error => {
        logger.agent.error('[OrchestratorExecutor] Execution loop failed:', error)
        handleExecutionError(plan, error)
    })

    return {
        success: true,
        message: `Started executing plan "${plan.name}" with ${plan.tasks.length} tasks.`
    }
}

/**
 * 停止执行
 */
export function stopPlanExecution(): void {
    isRunning = false
    scheduler?.stop()
    scheduler = null

    // 中止当前正在运行的 Agent
    Agent.abort()

    const store = useAgentStore.getState()
    store.stopExecution()

    logger.agent.info('[OrchestratorExecutor] Execution stopped')
}

/**
 * 暂停执行
 */
export function pausePlanExecution(): void {
    isRunning = false
    scheduler?.pause()

    const store = useAgentStore.getState()
    store.pauseExecution()

    const plan = store.getActivePlan()
    if (plan) {
        EventBus.emit({ type: 'plan:paused', planId: plan.id } as any)
    }

    logger.agent.info('[OrchestratorExecutor] Execution paused')
}

/**
 * 恢复执行
 */
export async function resumePlanExecution(): Promise<void> {
    const store = useAgentStore.getState()
    const plan = store.getActivePlan()
    const workspacePath = gitService.getWorkspace()

    if (!plan || !workspacePath) return

    isRunning = true
    scheduler?.resume()
    store.resumeExecution()

    EventBus.emit({ type: 'plan:resumed', planId: plan.id } as any)

    // 继续执行循环
    runExecutionLoop(plan, workspacePath).catch(error => {
        logger.agent.error('[OrchestratorExecutor] Resume failed:', error)
        handleExecutionError(plan, error)
    })
}

/**
 * 获取当前执行状态
 */
export function getExecutionStatus(): {
    isRunning: boolean
    stats: ExecutionStats | null
} {
    const store = useAgentStore.getState()
    const plan = store.getActivePlan()

    if (!plan || !scheduler) {
        return { isRunning: false, stats: null }
    }

    return {
        isRunning,
        stats: scheduler.calculateStats(plan, executionStartedAt)
    }
}

/**
 * 获取当前阶段
 */
export function getCurrentPhase(): 'planning' | 'executing' {
    return useAgentStore.getState().phase
}

// ============================================
// 执行循环
// ============================================

/**
 * 主执行循环
 */
async function runExecutionLoop(plan: TaskPlan, workspacePath: string): Promise<void> {
    const store = useAgentStore.getState()

    while (isRunning && scheduler && !scheduler.isAborted) {
        // 获取下一个可执行任务
        const task = plan.executionMode === 'sequential'
            ? scheduler.getNextTask(plan)
            : null // 并行模式稍后处理

        if (!task) {
            // 检查是否完成
            if (scheduler.isComplete(plan)) {
                await completeExecution(plan)
            } else if (!scheduler.hasRunningTasks()) {
                await completeExecution(plan)
            }
            break
        }

        // 执行任务
        await executeTask(task, plan, workspacePath)

        // 重新获取最新的 plan 状态
        const freshPlan = store.getPlan(plan.id)
        if (freshPlan) {
            for (const freshTask of freshPlan.tasks) {
                const idx = plan.tasks.findIndex(t => t.id === freshTask.id)
                if (idx >= 0) {
                    plan.tasks[idx] = freshTask
                }
            }
        }
    }
}

/**
 * 执行单个任务
 */
async function executeTask(
    task: OrchestratorTask,
    plan: TaskPlan,
    workspacePath: string
): Promise<void> {
    if (!scheduler) return

    const store = useAgentStore.getState()

    // 标记任务开始
    scheduler.markTaskRunning(task)
    store.setCurrentTask(task.id)
    store.updateTask(plan.id, task.id, { status: 'running', startedAt: Date.now() })

    EventBus.emit({ type: 'task:start', taskId: task.id, planId: plan.id } as any)

    logger.agent.info(`[OrchestratorExecutor] Executing task: ${task.title}`)

    try {
        // 执行任务
        const result = await runTaskWithAgent(task, plan, workspacePath)

        if (result.success) {
            // 任务成功
            scheduler.markTaskCompleted(task, result.output)
            store.markTaskCompleted(plan.id, task.id, result.output)

            EventBus.emit({
                type: 'task:complete',
                taskId: task.id,
                output: result.output,
                duration: Date.now() - (task.startedAt || Date.now())
            } as any)

            logger.agent.info(`[OrchestratorExecutor] Task completed: ${task.title}`)
        } else {
            // 任务失败
            scheduler.markTaskFailed(task, result.error || 'Unknown error')
            store.markTaskFailed(plan.id, task.id, result.error || 'Unknown error')

            EventBus.emit({
                type: 'task:failed',
                taskId: task.id,
                error: result.error || 'Unknown error'
            } as any)

            logger.agent.error(`[OrchestratorExecutor] Task failed: ${task.title}`, result.error)
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        scheduler.markTaskFailed(task, errorMsg)
        store.markTaskFailed(plan.id, task.id, errorMsg)

        EventBus.emit({ type: 'task:failed', taskId: task.id, error: errorMsg } as any)

        logger.agent.error(`[OrchestratorExecutor] Task execution error: ${task.title}`, error)
    }

    store.setCurrentTask(null)
}

/**
 * 完成执行
 */
async function completeExecution(plan: TaskPlan): Promise<void> {
    if (!scheduler) return

    const stats = scheduler.calculateStats(plan, executionStartedAt)
    const hasFailures = stats.failedTasks > 0

    const store = useAgentStore.getState()
    store.updatePlan(plan.id, { status: hasFailures ? 'failed' : 'completed' })
    store.stopExecution()

    isRunning = false
    scheduler.stop()
    scheduler = null

    EventBus.emit({ type: 'plan:complete', planId: plan.id, stats } as any)

    logger.agent.info(`[OrchestratorExecutor] Execution complete:`, stats)
}

/**
 * 处理执行错误
 */
function handleExecutionError(plan: TaskPlan, error: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error)

    const store = useAgentStore.getState()
    store.updatePlan(plan.id, { status: 'failed' })
    store.stopExecution()

    isRunning = false
    scheduler?.stop()
    scheduler = null

    EventBus.emit({ type: 'plan:failed', planId: plan.id, error: errorMsg } as any)

    logger.agent.error('[OrchestratorExecutor] Plan execution failed:', errorMsg)
}

// ============================================
// 任务执行核心
// ============================================

/**
 * 使用 Agent 执行任务
 */
async function runTaskWithAgent(
    task: OrchestratorTask,
    plan: TaskPlan,
    workspacePath: string
): Promise<{ success: boolean; output: string; error?: string }> {

    try {
        const isCoderTask = /coder|developer|engineer/i.test(task.role || '')
        const maxReviewLoops = 3
        let currentLoop = 0
        let currentRole = task.role || 'default'
        let feedbackMessage = buildTaskMessage(task, plan)
        let finalOutput = ''

        while (currentLoop < maxReviewLoops && isRunning) {
            const llmConfig = await getLLMConfigForTask(task.provider, task.model)
            if (!llmConfig) {
                return { success: false, output: '', error: `Failed to get LLM config for ${task.provider}/${task.model}` }
            }

            logger.agent.info(`[OrchestratorExecutor] Emitting subtask. Loop: ${currentLoop}, Role: ${currentRole}`)

            await Agent.send(feedbackMessage, llmConfig, workspacePath, 'agent', {
                promptTemplateId: currentRole,
                orchestratorPhase: 'executing',
            })

            const result = await waitForAgentCompletion()

            if (!result.success) {
                return result
            }

            finalOutput = result.output

            if (isCoderTask) {
                if (currentRole !== 'reviewer') {
                    // Coder finished -> Switch to Reviewer
                    currentRole = 'reviewer'
                    feedbackMessage = `[System: Reviewer Phase]\nCoder has completed the sequence for task: "${task.title}".\nPlease verify the latest changes. Use reading tools if necessary. If everything is fully correct and meets requirements without regressions, output exactly <LGTM>. Otherwise, point out the exact logical flaws or remaining steps.`
                    currentLoop++
                } else {
                    // Reviewer finished -> Check LGTM
                    if (finalOutput.includes('<LGTM>')) {
                        logger.agent.info('[OrchestratorExecutor] Reviewer approved the changes.')
                        break
                    } else {
                        // Reviewer rejected -> Switch to Coder with feedback
                        currentRole = task.role || 'coder'
                        feedbackMessage = `[System: Coder Phase]\nReviewer found issues or missing steps:\n\n${finalOutput}\n\nPlease address these issues and continue working on the task.`
                        currentLoop++
                    }
                }
            } else {
                // Regular single-shot task
                break
            }
        }

        return { success: true, output: finalOutput }

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        return { success: false, output: '', error: errorMsg }
    }
}

/**
 * 构建任务消息
 */
function buildTaskMessage(task: OrchestratorTask, plan: TaskPlan): string {
    const lines: string[] = []

    lines.push('# Task Execution Request')
    lines.push('')
    lines.push(`## Task: ${task.title}`)
    lines.push('')
    lines.push('### Description')
    lines.push(task.description)
    lines.push('')

    // 添加需求文档上下文
    if (plan.requirementsContent) {
        lines.push('### Requirements Context')
        lines.push('')
        // 截断过长的需求文档
        const truncated = plan.requirementsContent.length > 3000
            ? plan.requirementsContent.slice(0, 3000) + '\n\n... (truncated)'
            : plan.requirementsContent
        lines.push(truncated)
        lines.push('')
    }

    // 添加依赖任务的输出
    if (task.dependencies.length > 0) {
        const depOutputs = task.dependencies
            .map(depId => {
                const depTask = plan.tasks.find(t => t.id === depId)
                if (depTask?.output) {
                    return `**${depTask.title}**: ${depTask.output.slice(0, 500)}${depTask.output.length > 500 ? '...' : ''}`
                }
                return null
            })
            .filter(Boolean)

        if (depOutputs.length > 0) {
            lines.push('### Previous Task Outputs')
            lines.push('')
            lines.push(depOutputs.join('\n\n'))
            lines.push('')
        }
    }

    lines.push('### Instructions')
    lines.push('')
    lines.push('1. Execute this task completely')
    lines.push('2. Use all available tools as needed')
    lines.push('3. When finished, provide a clear summary of what you accomplished')
    lines.push('4. Do NOT ask for user confirmation - just execute')
    lines.push('')
    lines.push('### Important')
    lines.push(`- You are part of plan: "${plan.name}"`)
    lines.push('- Focus ONLY on this specific task')
    lines.push('- Be thorough and handle edge cases')

    return lines.join('\n')
}
