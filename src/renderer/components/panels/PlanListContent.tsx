/**
 * 任务列表内容组件
 * 显示任务模板列表、进度和状态
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect, useCallback } from 'react'
import { logger } from '@shared/utils/Logger'
import {
    ClipboardList,
    CheckCircle2,
    Clock,
    AlertCircle,
    Circle,
    Play,
    Trash2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { useModeStore } from '@/renderer/modes'
import { useAgent } from '@/renderer/hooks/useAgent'
import type { PlanFileData, PlanStatus } from '@/renderer/agent/types'
import BottomBarPopover from '../ui/BottomBarPopover'
import { Button } from '../ui'

interface TaskInfo {
    path: string
    name: string
    status: PlanStatus
    progress: { completed: number; total: number }
    updatedAt: number
}

interface PlanListContentProps {
    language: 'en' | 'zh'
}

// 解析任务 JSON 文件
async function parseTaskFile(filePath: string): Promise<TaskInfo | null> {
    try {
        const content = await api.file.read(filePath)
        if (!content) return null

        const data = JSON.parse(content) as PlanFileData
        const completed = data.items.filter(item => item.status === 'completed').length
        
        return {
            path: filePath,
            name: data.title,
            status: data.status,
            progress: { completed, total: data.items.length },
            updatedAt: data.updatedAt,
        }
    } catch {
        return null
    }
}

// 状态图标
function StatusIcon({ status }: { status: PlanStatus }) {
    switch (status) {
        case 'completed':
            return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        case 'active':
            return <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
        case 'failed':
            return <AlertCircle className="w-3.5 h-3.5 text-red-400" />
        default:
            return <Circle className="w-3.5 h-3.5 text-text-muted/50" />
    }
}

// 状态标签
function StatusBadge({ status, language }: { status: PlanStatus; language: 'en' | 'zh' }) {
    const labels: Record<PlanStatus, { en: string; zh: string; color: string }> = {
        draft: { en: 'Draft', zh: '草稿', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
        active: { en: 'Running', zh: '执行中', color: 'bg-accent/20 text-accent border-accent/30' },
        completed: { en: 'Done', zh: '完成', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
        failed: { en: 'Failed', zh: '失败', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
    }

    const label = labels[status]
    return (
        <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded border ${label.color}`}>
            {language === 'zh' ? label.zh : label.en}
        </span>
    )
}

// 进度条
function MiniProgress({ completed, total }: { completed: number; total: number }) {
    if (total === 0) return null
    const percent = Math.round((completed / total) * 100)

    return (
        <div className="flex items-center gap-1.5">
            <div className="w-12 h-1 bg-surface/50 rounded-full overflow-hidden">
                <div
                    className="h-full bg-accent rounded-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                />
            </div>
            <span className="text-[9px] text-text-muted tabular-nums">{percent}%</span>
        </div>
    )
}

export default function PlanListContent({ language }: PlanListContentProps) {
    const { workspacePath, openFile, setActiveFile } = useStore()
    const { sendMessage } = useAgent()
    const [tasks, setTasks] = useState<TaskInfo[]>([])
    const [activePath, setActivePath] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    const loadTasks = useCallback(async () => {
        if (!workspacePath) {
            setTasks([])
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const plansDir = `${workspacePath}/.adnify/plans`
            const files = await api.file.readDir(plansDir)
            const planFiles = files
                .filter(f => !f.isDirectory && f.name.endsWith('.json'))
                .map(f => f.path)

            const taskInfos = await Promise.all(planFiles.map(parseTaskFile))
            const validTasks = taskInfos.filter((t): t is TaskInfo => t !== null)
            
            // 按更新时间排序，执行中的优先
            validTasks.sort((a, b) => {
                if (a.status === 'active' && b.status !== 'active') return -1
                if (b.status === 'active' && a.status !== 'active') return 1
                return b.updatedAt - a.updatedAt
            })

            setTasks(validTasks)

            // 读取活动任务
            const active = await api.file.read(`${workspacePath}/.adnify/active_plan.txt`)
            if (active) setActivePath(active.trim())
        } catch {
            setTasks([])
        } finally {
            setLoading(false)
        }
    }, [workspacePath])

    useEffect(() => {
        loadTasks()
        // 定期刷新
        const interval = setInterval(loadTasks, 10000)
        
        // 监听计划创建/更新事件
        const handleRefresh = () => loadTasks()
        window.addEventListener('plan-list-refresh', handleRefresh)
        
        return () => {
            clearInterval(interval)
            window.removeEventListener('plan-list-refresh', handleRefresh)
        }
    }, [loadTasks])

    const handleOpenTask = async (taskPath: string) => {
        const content = await api.file.read(taskPath)
        if (content) {
            openFile(taskPath, content)
            setActiveFile(taskPath)
            if (workspacePath) {
                await api.file.write(`${workspacePath}/.adnify/active_plan.txt`, taskPath)
            }
            setActivePath(taskPath)
        }
    }

    const handleContinueTask = (task: TaskInfo) => {
        const prompt = language === 'zh'
            ? `请继续执行任务：${task.name}`
            : `Please continue executing task: ${task.name}`
        sendMessage(prompt)
    }

    const handleDeleteTask = async (taskPath: string, e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            await api.file.delete(taskPath)
            setTasks(prev => prev.filter(t => t.path !== taskPath))
            if (activePath === taskPath) {
                setActivePath(null)
                if (workspacePath) {
                    await api.file.delete(`${workspacePath}/.adnify/active_plan.txt`)
                }
            }
        } catch (err) {
            logger.ui.error('Failed to delete task:', err)
        }
    }

    // 统计
    const stats = {
        total: tasks.length,
        executing: tasks.filter(t => t.status === 'active').length,
        completed: tasks.filter(t => t.status === 'completed').length,
    }

    return (
        <div className="flex flex-col h-full">
            {/* 统计头部 */}
            {tasks.length > 0 && (
                <div className="px-3 py-2 border-b border-border/50 flex items-center gap-3 text-[10px] text-text-muted">
                    <span>{stats.total} {language === 'zh' ? '个任务' : 'tasks'}</span>
                    {stats.executing > 0 && (
                        <span className="text-accent">{stats.executing} {language === 'zh' ? '执行中' : 'running'}</span>
                    )}
                    {stats.completed > 0 && (
                        <span className="text-green-400">{stats.completed} {language === 'zh' ? '已完成' : 'done'}</span>
                    )}
                </div>
            )}

            {/* 任务列表 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="p-4 text-center">
                        <Clock className="w-4 h-4 text-text-muted animate-spin mx-auto mb-2" />
                        <span className="text-xs text-text-muted">Loading...</span>
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="p-4 text-center">
                        <ClipboardList className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
                        <p className="text-xs text-text-muted">
                            {language === 'zh' ? '暂无任务' : 'No tasks yet'}
                        </p>
                        <p className="text-[10px] text-text-muted/60 mt-1">
                            {language === 'zh' 
                                ? '在 Plan 模式下创建任务模板' 
                                : 'Create task templates in Plan mode'}
                        </p>
                    </div>
                ) : (
                    <div className="p-2 space-y-1">
                        <AnimatePresence>
                            {tasks.map((task) => (
                                <motion.div
                                    key={task.path}
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className={`
                                        group relative p-2.5 rounded-lg cursor-pointer transition-all
                                        ${task.path === activePath
                                            ? 'bg-accent/10 border border-accent/30'
                                            : 'hover:bg-white/5 border border-transparent'
                                        }
                                    `}
                                    onClick={() => handleOpenTask(task.path)}
                                >
                                    <div className="flex items-start gap-2">
                                        <StatusIcon status={task.status} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-text-primary truncate">
                                                    {task.name}
                                                </span>
                                                <StatusBadge status={task.status} language={language} />
                                            </div>
                                            <MiniProgress 
                                                completed={task.progress.completed} 
                                                total={task.progress.total} 
                                            />
                                        </div>

                                        {/* 操作按钮 */}
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {(task.status === 'draft' || task.status === 'active') && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleContinueTask(task)
                                                    }}
                                                    className="h-6 w-6 p-0"
                                                    title={language === 'zh' ? '继续执行' : 'Continue'}
                                                >
                                                    <Play className="w-3 h-3" />
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={(e) => handleDeleteTask(task.path, e)}
                                                className="h-6 w-6 p-0 hover:text-red-400"
                                                title={language === 'zh' ? '删除' : 'Delete'}
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    )
}

// Plan 列表弹出组件
export function PlanListPopover({ language }: { language: 'en' | 'zh' }) {
    const { currentMode } = useModeStore()

    // 在 Agent 和 Plan 模式下都显示
    if (currentMode !== 'plan' && currentMode !== 'agent') return null

    return (
        <BottomBarPopover
            icon={<ClipboardList className="w-3 h-3" />}
            tooltip={language === 'zh' ? '任务列表' : 'Task List'}
            title={language === 'zh' ? '任务列表' : 'Task List'}
            width={320}
            height={300}
            language={language}
        >
            <PlanListContent language={language} />
        </BottomBarPopover>
    )
}
