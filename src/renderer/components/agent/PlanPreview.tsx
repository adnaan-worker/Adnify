/**
 * 任务模板预览组件
 * 从 JSON 数据渲染计划视图
 */

import { useState, useMemo } from 'react'
import {
    Play,
    RotateCcw,
    CheckCircle2,
    Circle,
    Clock,
    AlertCircle,
    ChevronDown,
    ChevronRight,
    Sparkles,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '../ui'
import { useAgent } from '@/renderer/hooks/useAgent'
import { useStore } from '@/renderer/store'
import type { PlanFileData, PlanItemStatus } from '@/renderer/agent/types'

interface PlanPreviewProps {
    content: string
    fontSize?: number
}

// 状态图标
function StatusIcon({ status, size = 16 }: { status: PlanItemStatus; size?: number }) {
    switch (status) {
        case 'completed':
            return <CheckCircle2 className="text-green-400" style={{ width: size, height: size }} />
        case 'in_progress':
            return <Clock className="text-blue-400 animate-pulse" style={{ width: size, height: size }} />
        case 'failed':
            return <AlertCircle className="text-red-400" style={{ width: size, height: size }} />
        case 'skipped':
            return <Circle className="text-text-muted/30" style={{ width: size, height: size }} />
        default:
            return <Circle className="text-text-muted/50" style={{ width: size, height: size }} />
    }
}

// 进度条
function ProgressBar({ completed, total }: { completed: number; total: number }) {
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-surface/50 rounded-full overflow-hidden">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="h-full bg-gradient-to-r from-accent to-green-400 rounded-full"
                />
            </div>
            <span className="text-xs font-medium text-text-muted tabular-nums">
                {completed}/{total}
            </span>
        </div>
    )
}

// 状态标签
function StatusBadge({ status }: { status: PlanFileData['status'] }) {
    const config = {
        draft: { label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
        active: { label: 'Running', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
        completed: { label: 'Done', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
        failed: { label: 'Failed', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
    }
    const { label, color } = config[status]
    return (
        <span className={`px-2 py-0.5 text-xs font-medium rounded border ${color}`}>
            {label}
        </span>
    )
}

export function PlanPreview({ content, fontSize = 14 }: PlanPreviewProps) {
    const { sendMessage } = useAgent()
    const { language } = useStore()
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

    // 解析 JSON
    const planData = useMemo((): PlanFileData | null => {
        try {
            return JSON.parse(content) as PlanFileData
        } catch {
            return null
        }
    }, [content])

    if (!planData) {
        return (
            <div className="absolute inset-0 flex items-center justify-center text-text-muted">
                <p>Invalid plan data</p>
            </div>
        )
    }

    const toggleItem = (id: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const handleExecuteItem = (title: string) => {
        const prompt = language === 'zh'
            ? `请执行任务步骤：${title}`
            : `Please execute task step: ${title}`
        sendMessage(prompt)
    }

    const handleExecuteAll = () => {
        const prompt = language === 'zh'
            ? '请继续执行任务模板中的所有待完成步骤'
            : 'Please continue executing all pending steps in the task template'
        sendMessage(prompt)
    }

    const completedCount = planData.items.filter(i => i.status === 'completed').length
    const totalCount = planData.items.length

    return (
        <div
            className="absolute inset-0 overflow-y-auto p-6 bg-transparent custom-scrollbar"
            style={{ fontSize: `${fontSize}px` }}
        >
            <div className="max-w-3xl mx-auto space-y-6">
                {/* 头部 */}
                <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl font-bold text-text-primary tracking-tight flex items-center gap-2">
                                <Sparkles className="w-6 h-6 text-accent" />
                                {planData.title}
                            </h1>
                            <div className="flex items-center gap-2 mt-2">
                                <StatusBadge status={planData.status} />
                                <span className="text-xs text-text-muted">
                                    {new Date(planData.updatedAt).toLocaleString()}
                                </span>
                            </div>
                        </div>
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={handleExecuteAll}
                            className="flex items-center gap-1.5"
                        >
                            <Play className="w-3.5 h-3.5" />
                            {language === 'zh' ? '执行全部' : 'Execute All'}
                        </Button>
                    </div>

                    {/* 进度 */}
                    <ProgressBar completed={completedCount} total={totalCount} />
                </div>

                {/* 任务列表 */}
                <div className="space-y-2">
                    <h2 className="text-sm font-semibold text-text-primary mb-3">
                        {language === 'zh' ? '任务步骤' : 'Task Steps'}
                    </h2>

                    {planData.items.map((item, index) => {
                        const isExpanded = expandedItems.has(item.id) || item.status === 'in_progress'
                        const hasDescription = !!item.description

                        return (
                            <div
                                key={item.id}
                                className={`rounded-xl border transition-colors ${
                                    item.status === 'in_progress'
                                        ? 'bg-blue-500/5 border-blue-500/30'
                                        : item.status === 'completed'
                                        ? 'bg-green-500/5 border-green-500/20'
                                        : item.status === 'failed'
                                        ? 'bg-red-500/5 border-red-500/20'
                                        : 'bg-surface/30 border-border'
                                }`}
                            >
                                <div
                                    className={`flex items-center gap-3 p-3 ${hasDescription ? 'cursor-pointer hover:bg-white/5' : ''} transition-colors rounded-xl`}
                                    onClick={() => hasDescription && toggleItem(item.id)}
                                >
                                    <StatusIcon status={item.status} size={18} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-text-muted">
                                                #{index + 1}
                                            </span>
                                            <span className={`text-sm font-medium truncate ${
                                                item.status === 'completed' ? 'text-text-muted line-through' : 'text-text-primary'
                                            }`}>
                                                {item.title}
                                            </span>
                                        </div>
                                    </div>
                                    
                                    {/* 操作按钮 */}
                                    <div className="flex items-center gap-1">
                                        {item.status !== 'in_progress' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleExecuteItem(item.title)
                                                }}
                                                className="h-7 px-2 opacity-0 group-hover:opacity-100 hover:opacity-100"
                                            >
                                                {item.status === 'completed' ? (
                                                    <RotateCcw className="w-3 h-3" />
                                                ) : (
                                                    <Play className="w-3 h-3" />
                                                )}
                                            </Button>
                                        )}
                                        {hasDescription && (
                                            isExpanded ? (
                                                <ChevronDown className="w-4 h-4 text-text-muted" />
                                            ) : (
                                                <ChevronRight className="w-4 h-4 text-text-muted" />
                                            )
                                        )}
                                    </div>
                                </div>

                                {/* 描述展开 */}
                                <AnimatePresence>
                                    {isExpanded && item.description && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="px-4 pb-3 pt-0">
                                                <p className="text-xs text-text-secondary leading-relaxed pl-7">
                                                    {item.description}
                                                </p>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
