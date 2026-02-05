/**
 * TaskBoard - 任务规划看板
 * 显示需求文档和任务列表，支持模型/角色选择
 */

import { memo, useState, useMemo, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Play,
    Pause,
    CheckCircle2,
    Circle,
    AlertCircle,
    Clock,
    ChevronDown,
    ChevronRight,
    FileText,
    ListTodo,
    Settings2,
    Sparkles,
} from 'lucide-react'
import { Button } from '@/renderer/components/ui'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useStore } from '@/renderer/store'
import { BUILTIN_PROVIDERS } from '@/shared/config/providers'
import type { OrchestratorTask, ExecutionMode } from '@/renderer/agent/store/slices/orchestratorSlice'

interface TaskBoardProps {
    planId: string
}

// ============================================
// 子组件
// ============================================

/** 任务状态图标 */
const TaskStatusIcon = memo(function TaskStatusIcon({ status }: { status: OrchestratorTask['status'] }) {
    switch (status) {
        case 'completed':
            return <CheckCircle2 className="w-4 h-4 text-green-500" />
        case 'running':
            return <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                <Sparkles className="w-4 h-4 text-blue-500" />
            </motion.div>
        case 'failed':
            return <AlertCircle className="w-4 h-4 text-red-500" />
        case 'skipped':
            return <Circle className="w-4 h-4 text-muted-foreground" />
        default:
            return <Clock className="w-4 h-4 text-muted-foreground" />
    }
})

/** 模型选择器 */
const ModelSelector = memo(function ModelSelector({
    provider,
    model,
    onChange,
    disabled,
}: {
    provider: string
    model: string
    onChange: (provider: string, model: string) => void
    disabled?: boolean
}) {
    const providers = Object.values(BUILTIN_PROVIDERS)

    return (
        <div className="flex gap-2">
            <select
                className="px-2 py-1 text-xs rounded bg-surface border border-border text-text-primary disabled:opacity-50"
                value={provider}
                onChange={(e) => {
                    const newProvider = e.target.value
                    const defaultModel = BUILTIN_PROVIDERS[newProvider]?.defaultModel || ''
                    onChange(newProvider, defaultModel)
                }}
                disabled={disabled}
            >
                {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.displayName}
                    </option>
                ))}
            </select>
            <select
                className="px-2 py-1 text-xs rounded bg-surface border border-border text-text-primary disabled:opacity-50"
                value={model}
                onChange={(e) => onChange(provider, e.target.value)}
                disabled={disabled}
            >
                {BUILTIN_PROVIDERS[provider]?.models.map((m) => (
                    <option key={m} value={m}>
                        {m}
                    </option>
                ))}
            </select>
        </div>
    )
})

/** 单个任务卡片 */
const TaskCard = memo(function TaskCard({
    task,
    planId,
    isExecuting,
}: {
    task: OrchestratorTask
    planId: string
    isExecuting: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const updateTask = useAgentStore((s) => s.updateTask)

    const handleModelChange = useCallback(
        (provider: string, model: string) => {
            updateTask(planId, task.id, { provider, model })
        },
        [planId, task.id, updateTask]
    )

    const isActive = task.status === 'running'

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`
        relative rounded-lg border transition-all duration-200
        ${isActive
                    ? 'border-blue-500/50 bg-blue-500/5 shadow-lg shadow-blue-500/10'
                    : 'border-border bg-surface/50 hover:bg-surface/80'}
      `}
        >
            {/* 进度条 */}
            {isActive && (
                <motion.div
                    className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-t-lg"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 30, ease: 'linear' }}
                />
            )}

            {/* 头部 */}
            <div
                className="flex items-center gap-3 p-3 cursor-pointer"
                onClick={() => setExpanded((e) => !e)}
            >
                <TaskStatusIcon status={task.status} />
                <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-text-primary truncate">{task.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{task.description}</div>
                </div>
                <motion.div animate={{ rotate: expanded ? 90 : 0 }}>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </motion.div>
            </div>

            {/* 展开详情 */}
            <AnimatePresence>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 pb-3 pt-0 border-t border-border/50">
                            <div className="flex items-center gap-2 mt-2">
                                <Settings2 className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">模型配置</span>
                            </div>
                            <div className="mt-2">
                                <ModelSelector
                                    provider={task.provider}
                                    model={task.model}
                                    onChange={handleModelChange}
                                    disabled={isExecuting}
                                />
                            </div>

                            {task.output && (
                                <div className="mt-3 p-2 rounded bg-background/50 border border-border/50">
                                    <div className="text-xs text-muted-foreground mb-1">输出</div>
                                    <div className="text-xs text-text-primary whitespace-pre-wrap max-h-32 overflow-auto">
                                        {task.output}
                                    </div>
                                </div>
                            )}

                            {task.error && (
                                <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/30">
                                    <div className="text-xs text-red-500">{task.error}</div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    )
})

/** 执行模式切换 */
const ExecutionModeToggle = memo(function ExecutionModeToggle({
    mode,
    onChange,
    disabled,
}: {
    mode: ExecutionMode
    onChange: (mode: ExecutionMode) => void
    disabled?: boolean
}) {
    return (
        <div className="flex items-center gap-2 p-1 rounded-lg bg-surface/50 border border-border">
            <button
                className={`px-3 py-1 text-xs rounded transition-colors ${mode === 'sequential'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-text-primary'
                    }`}
                onClick={() => onChange('sequential')}
                disabled={disabled}
            >
                顺序执行
            </button>
            <button
                className={`px-3 py-1 text-xs rounded transition-colors ${mode === 'parallel'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-text-primary'
                    }`}
                onClick={() => onChange('parallel')}
                disabled={disabled}
            >
                并行执行
            </button>
        </div>
    )
})

// ============================================
// 主组件
// ============================================

export const TaskBoard = memo(function TaskBoard({ planId }: TaskBoardProps) {
    const [showRequirements, setShowRequirements] = useState(true)
    const [requirementsContent, setRequirementsContent] = useState<string>('')
    const plan = useAgentStore((s) => s.plans.find((p) => p.id === planId))
    const isExecuting = useAgentStore((s) => s.isExecuting)
    const updatePlan = useAgentStore((s) => s.updatePlan)
    const startExecution = useAgentStore((s) => s.startExecution)
    const stopExecution = useAgentStore((s) => s.stopExecution)
    const workspacePath = useStore((s) => s.workspacePath)

    // 加载需求文档内容
    useEffect(() => {
        if (!plan?.requirementsDoc || !workspacePath) return
        const loadRequirements = async () => {
            try {
                const { api } = await import('@/renderer/services/electronAPI')
                const mdPath = `${workspacePath}/.adnify/plan/${plan.requirementsDoc}`
                const content = await api.file.read(mdPath)
                if (content) {
                    setRequirementsContent(content)
                }
            } catch (err) {
                console.error('Failed to load requirements doc:', err)
            }
        }
        loadRequirements()
    }, [plan?.requirementsDoc, workspacePath])

    // 统计
    const stats = useMemo(() => {
        if (!plan) return { total: 0, completed: 0, failed: 0 }
        return {
            total: plan.tasks.length,
            completed: plan.tasks.filter((t) => t.status === 'completed').length,
            failed: plan.tasks.filter((t) => t.status === 'failed').length,
        }
    }, [plan])

    const handleExecutionModeChange = useCallback(
        (mode: ExecutionMode) => {
            if (plan) {
                updatePlan(plan.id, { executionMode: mode })
            }
        },
        [plan, updatePlan]
    )

    const handleStart = useCallback(() => {
        if (plan) {
            startExecution(plan.id)
            // TODO: 触发 Agent 执行循环
        }
    }, [plan, startExecution])

    const handleStop = useCallback(() => {
        stopExecution()
        // TODO: 中断执行
    }, [stopExecution])

    if (!plan) {
        return (
            <div className="flex items-center justify-center h-full text-muted-foreground">
                规划不存在
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-background">
            {/* 头部 */}
            <div className="flex-shrink-0 p-4 border-b border-border bg-surface/30 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-text-primary">{plan.name}</h1>
                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            <span>{stats.total} 个任务</span>
                            <span className="text-green-500">{stats.completed} 完成</span>
                            {stats.failed > 0 && <span className="text-red-500">{stats.failed} 失败</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <ExecutionModeToggle
                            mode={plan.executionMode}
                            onChange={handleExecutionModeChange}
                            disabled={isExecuting}
                        />
                        {isExecuting ? (
                            <Button variant="danger" size="sm" onClick={handleStop}>
                                <Pause className="w-4 h-4 mr-1" />
                                停止
                            </Button>
                        ) : (
                            <Button variant="primary" size="sm" onClick={handleStart}>
                                <Play className="w-4 h-4 mr-1" />
                                开始执行
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 flex overflow-hidden">
                {/* 需求文档 */}
                <div className={`${showRequirements ? 'w-1/2' : 'w-0'} transition-all duration-300 overflow-hidden border-r border-border`}>
                    <div className="h-full overflow-auto p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-text-primary">需求文档</span>
                        </div>
                        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                            {requirementsContent ? (
                                <div className="text-text-secondary text-sm">
                                    {requirementsContent}
                                </div>
                            ) : (
                                <p className="text-muted-foreground italic">
                                    加载中...
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* 折叠按钮 */}
                <button
                    className="flex-shrink-0 w-6 flex items-center justify-center border-r border-border hover:bg-surface/50 transition-colors"
                    onClick={() => setShowRequirements((s) => !s)}
                >
                    <motion.div animate={{ rotate: showRequirements ? 0 : 180 }}>
                        <ChevronDown className="w-4 h-4 text-muted-foreground rotate-90" />
                    </motion.div>
                </button>

                {/* 任务列表 */}
                <div className="flex-1 overflow-auto p-4">
                    <div className="flex items-center gap-2 mb-3">
                        <ListTodo className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-text-primary">任务列表</span>
                    </div>
                    <div className="space-y-2">
                        {plan.tasks.map((task) => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                planId={plan.id}
                                isExecuting={isExecuting}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
})

export default TaskBoard
