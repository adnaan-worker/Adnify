/**
 * Orchestrator 类型定义
 * 
 * 设计原则：复用现有系统，不造轮子
 * - role → 映射到 promptTemplateId
 * - provider/model → 使用现有的 providerConfigs
 */

// ============================================
// 状态机类型
// ============================================

/** Orchestrator 状态 */
export type OrchestratorState =
    | 'idle'        // 空闲，等待用户输入
    | 'gathering'   // 收集需求（多轮对话）
    | 'planning'    // 生成任务计划
    | 'reviewing'   // 等待用户审批
    | 'ready'       // 计划已批准，待执行
    | 'executing'   // 执行中
    | 'paused'      // 已暂停
    | 'completed'   // 已完成
    | 'failed'      // 失败

// ============================================
// 任务类型
// ============================================

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

/** 执行模式 */
export type ExecutionMode = 'sequential' | 'parallel'

/** 计划状态 */
export type PlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'paused'

/** 单个任务 */
export interface OrchestratorTask {
    id: string
    title: string
    description: string
    /** 分配的 Provider（来自 BUILTIN_PROVIDERS） */
    provider: string
    /** 分配的模型 */
    model: string
    /** 分配的角色（对应 promptTemplateId，如 'default', 'professional', 'reviewer'） */
    role: string
    /** 依赖的任务 ID */
    dependencies: string[]
    /** 任务状态 */
    status: TaskStatus
    /** 执行输出 */
    output?: string
    /** 错误信息 */
    error?: string
    /** 开始时间 */
    startedAt?: number
    /** 完成时间 */
    completedAt?: number
    /** 重试次数 */
    retryCount?: number
}

/** 任务计划 */
export interface TaskPlan {
    id: string
    name: string
    createdAt: number
    updatedAt: number
    /** 需求文档路径（相对于 .adnify/plan/） */
    requirementsDoc: string
    /** 需求文档内容（缓存，用于注入上下文） */
    requirementsContent?: string
    /** 执行模式 */
    executionMode: ExecutionMode
    /** 计划状态 */
    status: PlanStatus
    /** 任务列表 */
    tasks: OrchestratorTask[]
    /** 用户原始请求 */
    userRequest?: string
}

// ============================================
// 执行上下文（传递给任务执行器）
// ============================================

/** 任务执行上下文 */
export interface TaskExecutionContext {
    /** 工作区路径 */
    workspacePath: string
    /** 当前计划 */
    plan: TaskPlan
    /** 当前任务 */
    task: OrchestratorTask
    /** 已完成任务的输出（可用于传递上下文） */
    completedOutputs: Record<string, string>
    /** 需求文档内容 */
    requirementsContent?: string
}

/** 任务执行结果 */
export interface TaskExecutionResult {
    taskId: string
    success: boolean
    output: string
    error?: string
    duration: number
}

/** 执行统计 */
export interface ExecutionStats {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    skippedTasks: number
    totalDuration: number
    startedAt: number
    completedAt?: number
}

// ============================================
// 事件类型
// ============================================

/** Orchestrator 事件 */
export type OrchestratorEvent =
    | { type: 'state:change'; from: OrchestratorState; to: OrchestratorState }
    | { type: 'task:start'; taskId: string; planId: string }
    | { type: 'task:progress'; taskId: string; message: string }
    | { type: 'task:complete'; taskId: string; output: string; duration: number }
    | { type: 'task:failed'; taskId: string; error: string }
    | { type: 'task:skipped'; taskId: string; reason: string }
    | { type: 'plan:start'; planId: string }
    | { type: 'plan:complete'; planId: string; stats: ExecutionStats }
    | { type: 'plan:failed'; planId: string; error: string }
    | { type: 'plan:paused'; planId: string }
    | { type: 'plan:resumed'; planId: string }

// ============================================
// 配置
// ============================================

/** Orchestrator 配置 */
export interface OrchestratorConfig {
    /** 最大重试次数 */
    maxRetries: number
    /** 任务超时（毫秒） */
    taskTimeout: number
    /** 是否自动跳过失败依赖的任务 */
    autoSkipOnDependencyFailure: boolean
    /** 并行执行的最大并发数 */
    maxConcurrency: number
}

/** 默认配置 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
    maxRetries: 2,
    taskTimeout: 300_000, // 5 分钟
    autoSkipOnDependencyFailure: true,
    maxConcurrency: 3,
}
