/**
 * 计划列表弹框内容
 * 显示当前工作区的所有计划，点击打开对应的 TaskBoard
 */

import { memo, useMemo } from 'react'
import { useAgentStore } from '@renderer/agent'
import { useStore } from '@store'
import {
    PlayCircle,
    CheckCircle2,
    Clock,
    Pause,
    XCircle,
    ChevronRight,
    FileText,
} from 'lucide-react'
import type { TaskPlan, PlanStatus } from '@renderer/agent/orchestrator/types'

interface PlanListContentProps {
    language?: 'en' | 'zh'
    onPlanSelect?: () => void  // 选择后关闭弹框
}

/**
 * 获取状态图标
 */
function StatusIcon({ status }: { status: PlanStatus }) {
    switch (status) {
        case 'executing':
            return <PlayCircle className="w-4 h-4 text-accent animate-pulse" />
        case 'completed':
            return <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        case 'paused':
            return <Pause className="w-4 h-4 text-amber-400" />
        case 'failed':
            return <XCircle className="w-4 h-4 text-red-400" />
        default:
            return <Clock className="w-4 h-4 text-text-muted" />
    }
}

/**
 * 获取状态文本
 */
function getStatusText(status: PlanStatus, language: 'en' | 'zh'): string {
    const texts: Record<PlanStatus, { en: string; zh: string }> = {
        draft: { en: 'Draft', zh: '草稿' },
        approved: { en: 'Approved', zh: '已批准' },
        executing: { en: 'Executing', zh: '执行中' },
        paused: { en: 'Paused', zh: '已暂停' },
        completed: { en: 'Completed', zh: '已完成' },
        failed: { en: 'Failed', zh: '失败' },
    }
    return texts[status]?.[language] || status
}

/**
 * 计算任务进度
 */
function getTaskProgress(plan: TaskPlan): { completed: number; total: number } {
    const total = plan.tasks.length
    const completed = plan.tasks.filter(t => t.status === 'completed').length
    return { completed, total }
}

/**
 * 单个计划项
 */
const PlanItem = memo(function PlanItem({
    plan,
    isActive,
    language,
    onClick
}: {
    plan: TaskPlan
    isActive: boolean
    language: 'en' | 'zh'
    onClick: () => void
}) {
    const { completed, total } = getTaskProgress(plan)
    const progressPercent = total > 0 ? (completed / total) * 100 : 0

    // 格式化时间
    const timeAgo = useMemo(() => {
        const diff = Date.now() - plan.updatedAt
        const minutes = Math.floor(diff / 1000 / 60)
        const hours = Math.floor(minutes / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) return language === 'zh' ? `${days}天前` : `${days}d ago`
        if (hours > 0) return language === 'zh' ? `${hours}小时前` : `${hours}h ago`
        if (minutes > 0) return language === 'zh' ? `${minutes}分钟前` : `${minutes}m ago`
        return language === 'zh' ? '刚刚' : 'Just now'
    }, [plan.updatedAt, language])

    return (
        <button
            onClick={onClick}
            className={`
                w-full p-3 text-left rounded-xl transition-all group
                ${isActive
                    ? 'bg-accent/10 border border-accent/30'
                    : 'hover:bg-white/5 border border-transparent hover:border-white/10'
                }
            `}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                    <StatusIcon status={plan.status} />
                    <div className="min-w-0">
                        <div className="font-medium text-sm text-text-primary truncate">
                            {plan.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-text-muted">
                                {getStatusText(plan.status, language)}
                            </span>
                            <span className="text-[10px] text-text-muted/50">•</span>
                            <span className="text-[10px] text-text-muted/50">
                                {timeAgo}
                            </span>
                        </div>
                    </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted/30 group-hover:text-text-muted transition-colors shrink-0 mt-1" />
            </div>

            {/* 进度条 */}
            {total > 0 && (
                <div className="mt-2.5">
                    <div className="flex items-center justify-between text-[10px] mb-1">
                        <span className="text-text-muted">
                            {completed}/{total} {language === 'zh' ? '任务' : 'tasks'}
                        </span>
                        <span className="text-text-muted font-mono">
                            {Math.round(progressPercent)}%
                        </span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${progressPercent === 100
                                ? 'bg-emerald-400'
                                : 'bg-accent'
                                }`}
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
            )}
        </button>
    )
})

export default memo(function PlanListContent({
    language = 'zh',
    onPlanSelect
}: PlanListContentProps) {
    const plans = useAgentStore(state => state.plans)
    const activePlanId = useAgentStore(state => state.activePlanId)
    const setActivePlan = useAgentStore(state => state.setActivePlan)
    const openFile = useStore(state => state.openFile)
    const workspacePath = useStore(state => state.workspacePath)

    // 按状态和时间排序：执行中 > 暂停 > 草稿/就绪 > 完成/失败
    const sortedPlans = useMemo(() => {
        const priorityMap: Record<PlanStatus, number> = {
            executing: 0,
            paused: 1,
            draft: 2,
            approved: 2,
            completed: 3,
            failed: 4,
        }
        return [...plans].sort((a, b) => {
            const pA = priorityMap[a.status] ?? 5
            const pB = priorityMap[b.status] ?? 5
            if (pA !== pB) return pA - pB
            return b.updatedAt - a.updatedAt
        })
    }, [plans])

    const handlePlanClick = (plan: TaskPlan) => {
        // 设置为活跃计划
        setActivePlan(plan.id)

        // 打开计划的 JSON 文件（触发 TaskBoard 渲染）
        if (workspacePath) {
            const jsonPath = `${workspacePath}/.adnify/plan/${plan.id}.json`
            openFile(jsonPath, JSON.stringify(plan, null, 2))
        }

        // 关闭弹框
        onPlanSelect?.()
    }

    if (plans.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-text-muted py-8">
                <FileText className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm font-medium">
                    {language === 'zh' ? '暂无计划' : 'No Plans Yet'}
                </p>
                <p className="text-xs text-text-muted/50 mt-1 text-center px-4">
                    {language === 'zh'
                        ? '使用 Orchestrator 模式创建任务计划'
                        : 'Use Orchestrator mode to create task plans'
                    }
                </p>
            </div>
        )
    }

    return (
        <div className="p-2 space-y-1.5">
            {sortedPlans.map(plan => (
                <PlanItem
                    key={plan.id}
                    plan={plan}
                    isActive={plan.id === activePlanId}
                    language={language}
                    onClick={() => handlePlanClick(plan)}
                />
            ))}
        </div>
    )
})
