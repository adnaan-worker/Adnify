/**
 * Git 源代码管理面板
 * 功能: 状态查看、暂存/提交、分支管理、Stash、Rebase、Cherry-pick 等
 */
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
    GitBranch, GitCommit as GitCommitIcon, GitMerge, GitPullRequest,
    ChevronDown, ChevronRight, Plus, Minus, RefreshCw, Trash2,
    ArrowUp, ArrowDown, Check, X, MoreHorizontal, FolderGit2,
    Undo2, RotateCcw, Copy, Archive, AlertTriangle,
    Play, SkipForward, Loader2, Sparkles
} from 'lucide-react'
import { useStore } from '@store'
import { t, type TranslationKey } from '@renderer/i18n'
import { gitService, GitStatus, GitCommit, GitBranch as GitBranchType, GitStashEntry } from '@renderer/agent/services/gitService'
import { getEditorConfig } from '@renderer/settings'
import { toast } from '@components/common/ToastProvider'
import { keybindingService } from '@services/keybindingService'
import { Input, Button, Modal } from '@components/ui'
import { getFileName } from '@shared/utils/pathUtils'
import { ConflictResolver } from '@components/git/ConflictResolver'

// ==================== 类型定义 ====================
type GitTab = 'changes' | 'branches' | 'stash' | 'history'
type OperationState = 'normal' | 'merge' | 'rebase' | 'cherry-pick' | 'revert'

// ==================== 子组件 ====================

// 文件状态图标
function FileStatusBadge({ status }: { status: string }) {
    const config: Record<string, { color: string; label: string }> = {
        added: { color: 'text-green-400', label: 'A' },
        modified: { color: 'text-yellow-400', label: 'M' },
        deleted: { color: 'text-red-400', label: 'D' },
        renamed: { color: 'text-blue-400', label: 'R' },
        copied: { color: 'text-purple-400', label: 'C' },
        unmerged: { color: 'text-orange-400', label: 'U' },
        untracked: { color: 'text-green-400', label: 'U' },
    }
    const c = config[status] || { color: 'text-text-muted', label: '?' }
    return <span className={`text-[10px] font-mono ${c.color} w-4 text-center flex-shrink-0`}>{c.label}</span>
}

// 文件项组件
function FileItem({
    path,
    status,
    staged,
    onStage,
    onUnstage,
    onDiscard,
    onClick,
}: {
    path: string
    status: string
    staged: boolean
    onStage: () => void
    onUnstage: () => void
    onDiscard: () => void
    onClick: () => void
}) {
    const fileName = getFileName(path)
    const dirPath = path.replace(fileName, '').replace(/[/\\]$/, '')
    const { language } = useStore()
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    return (
        <div
            className="group flex items-center px-3 py-1 hover:bg-surface-hover cursor-pointer transition-colors"
            onClick={onClick}
        >
            <FileStatusBadge status={status} />
            <div className="flex-1 min-w-0 ml-2">
                <span className="text-xs text-text-primary truncate block">{fileName}</span>
                {dirPath && <span className="text-[10px] text-text-muted truncate block">{dirPath}</span>}
            </div>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {staged ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); onUnstage() }}
                        className="p-1 hover:bg-surface-active rounded"
                        title={tt('git.unstage')}
                    >
                        <Minus className="w-3 h-3 text-text-muted" />
                    </button>
                ) : (
                    <>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDiscard() }}
                            className="p-1 hover:bg-surface-active rounded"
                            title={tt('git.discard')}
                        >
                            <Undo2 className="w-3 h-3 text-text-muted hover:text-red-400" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onStage() }}
                            className="p-1 hover:bg-surface-active rounded"
                            title={tt('git.stage')}
                        >
                            <Plus className="w-3 h-3 text-text-muted" />
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

// 分支项组件
function BranchItem({
    branch,
    onCheckout,
    onDelete,
    onMerge,
    onRebase,
}: {
    branch: GitBranchType
    onCheckout: () => void
    onDelete: () => void
    onMerge: () => void
    onRebase: () => void
}) {
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const { language } = useStore()
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    // 点击外部关闭菜单
    useEffect(() => {
        if (!showMenu) return
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showMenu])

    return (
        <div
            className={`group flex items-center px-3 py-1.5 hover:bg-surface-hover cursor-pointer transition-colors ${
                branch.current ? 'bg-accent/10' : ''
            }`}
            onClick={() => !branch.current && onCheckout()}
        >
            {branch.current ? (
                <Check className="w-3 h-3 text-accent mr-2 flex-shrink-0" />
            ) : (
                <div className="w-3 h-3 mr-2 flex-shrink-0" />
            )}
            <GitBranch className={`w-3 h-3 mr-2 flex-shrink-0 ${branch.remote ? 'text-purple-400' : 'text-accent'}`} />
            <span className={`text-xs flex-1 truncate ${branch.current ? 'text-accent font-medium' : 'text-text-secondary'}`}>
                {branch.name}
            </span>
            {(branch.ahead && branch.ahead > 0) || (branch.behind && branch.behind > 0) ? (
                <div className="flex items-center gap-1 mr-2">
                    {branch.ahead && branch.ahead > 0 ? (
                        <span className="text-[10px] text-green-400 flex items-center">
                            <ArrowUp className="w-2.5 h-2.5" />{branch.ahead}
                        </span>
                    ) : null}
                    {branch.behind && branch.behind > 0 ? (
                        <span className="text-[10px] text-orange-400 flex items-center">
                            <ArrowDown className="w-2.5 h-2.5" />{branch.behind}
                        </span>
                    ) : null}
                </div>
            ) : null}
            {!branch.current && !branch.remote && (
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                        className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreHorizontal className="w-3 h-3 text-text-muted" />
                    </button>
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-surface border border-border-subtle rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                            <button
                                onClick={(e) => { e.stopPropagation(); onMerge(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <GitMerge className="w-3 h-3" /> {tt('git.merge')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onRebase(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <RotateCcw className="w-3 h-3" /> {tt('git.rebase')}
                            </button>
                            <div className="border-t border-border-subtle my-1" />
                            <button
                                onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover text-red-400 flex items-center gap-2"
                            >
                                <Trash2 className="w-3 h-3" /> {tt('delete')}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// Commit 项组件
function CommitItem({
    commit,
    onCherryPick,
    onRevert,
    onCopyHash,
    onClick,
}: {
    commit: GitCommit
    onCherryPick: () => void
    onRevert: () => void
    onCopyHash: () => void
    onClick: () => void
}) {
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const { language } = useStore()
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])
    const timeAgo = getTimeAgo(commit.date, language)

    // 点击外部关闭菜单
    useEffect(() => {
        if (!showMenu) return
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showMenu])

    return (
        <div
            className="group px-3 py-2 hover:bg-surface-hover cursor-pointer border-l-2 border-transparent hover:border-accent transition-colors"
            onClick={onClick}
        >
            <div className="flex items-start gap-2">
                <GitCommitIcon className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary truncate font-medium">{commit.message}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-accent font-mono">{commit.shortHash}</span>
                        <span className="text-[10px] text-text-muted">{commit.author}</span>
                        <span className="text-[10px] text-text-muted opacity-60">{timeAgo}</span>
                    </div>
                </div>
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                        className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreHorizontal className="w-3 h-3 text-text-muted" />
                    </button>
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-surface border border-border-subtle rounded-lg shadow-xl z-50 py-1 min-w-[140px]">
                            <button
                                onClick={(e) => { e.stopPropagation(); onCopyHash(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <Copy className="w-3 h-3" /> {tt('git.copyHash')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onCherryPick(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <GitPullRequest className="w-3 h-3" /> {tt('git.cherryPick')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onRevert(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <Undo2 className="w-3 h-3" /> {tt('git.revert')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// Stash 项组件
function StashItem({
    stash,
    onApply,
    onPop,
    onDrop,
    onView,
}: {
    stash: GitStashEntry
    onApply: () => void
    onPop: () => void
    onDrop: () => void
    onView: () => void
}) {
    const [showMenu, setShowMenu] = useState(false)
    const menuRef = useRef<HTMLDivElement>(null)
    const { language } = useStore()
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    // 点击外部关闭菜单
    useEffect(() => {
        if (!showMenu) return
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setShowMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [showMenu])

    return (
        <div className="group px-3 py-2 hover:bg-surface-hover cursor-pointer" onClick={onView}>
            <div className="flex items-start gap-2">
                <Archive className="w-3.5 h-3.5 text-text-muted mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-primary truncate">{stash.message || 'WIP'}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-accent font-mono">stash@{`{${stash.index}}`}</span>
                        <span className="text-[10px] text-text-muted">on {stash.branch}</span>
                    </div>
                </div>
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu) }}
                        className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreHorizontal className="w-3 h-3 text-text-muted" />
                    </button>
                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-surface border border-border-subtle rounded-lg shadow-xl z-50 py-1 min-w-[120px]">
                            <button
                                onClick={(e) => { e.stopPropagation(); onApply(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <Play className="w-3 h-3" /> {tt('git.stashApply')}
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onPop(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover flex items-center gap-2"
                            >
                                <ArrowUp className="w-3 h-3" /> {tt('git.stashPop')}
                            </button>
                            <div className="border-t border-border-subtle my-1" />
                            <button
                                onClick={(e) => { e.stopPropagation(); onDrop(); setShowMenu(false) }}
                                className="w-full px-3 py-1.5 text-xs text-left hover:bg-surface-hover text-red-400 flex items-center gap-2"
                            >
                                <Trash2 className="w-3 h-3" /> {tt('git.stashDrop')}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// 时间格式化 (带语言参数)
function getTimeAgo(date: Date, language: 'en' | 'zh'): string {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (minutes < 1) return t('justNow', language)
    if (minutes < 60) return t('minutesAgo', language, { count: String(minutes) })
    if (hours < 24) return t('hoursAgo', language, { count: String(hours) })
    if (days < 7) return t('daysAgo', language, { count: String(days) })
    return date.toLocaleDateString()
}

// ==================== 主组件 ====================
export function GitView() {
    const { workspacePath, language, openFile, setActiveFile } = useStore()
    
    // 状态
    const [activeTab, setActiveTab] = useState<GitTab>('changes')
    const [status, setStatus] = useState<GitStatus | null>(null)
    const [commits, setCommits] = useState<GitCommit[]>([])
    const [branches, setBranches] = useState<GitBranchType[]>([])
    const [stashList, setStashList] = useState<GitStashEntry[]>([])
    const [operationState, setOperationState] = useState<OperationState>('normal')
    
    // UI 状态
    const [commitMessage, setCommitMessage] = useState('')
    const [isCommitting, setIsCommitting] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [isPushing, setIsPushing] = useState(false)
    const [isPulling, setIsPulling] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isGeneratingMessage, setIsGeneratingMessage] = useState(false)
    
    // 展开状态
    const [expandedSections, setExpandedSections] = useState({
        staged: true,
        changes: true,
        stash: false,
        localBranches: true,
        remoteBranches: false,
    })
    
    // 新建分支
    const [showNewBranch, setShowNewBranch] = useState(false)
    const [newBranchName, setNewBranchName] = useState('')
    
    // Stash 消息
    const [showStashInput, setShowStashInput] = useState(false)
    const [stashMessage, setStashMessage] = useState('')
    
    // 冲突解决
    const [conflictFile, setConflictFile] = useState<string | null>(null)

    // 国际化辅助函数
    const tt = useCallback((key: TranslationKey) => t(key, language), [language])

    // 刷新数据
    const refreshStatus = useCallback(async () => {
        if (!workspacePath) return
        setIsRefreshing(true)
        setError(null)
        
        try {
            gitService.setWorkspace(workspacePath)
            
            const [s, c, b, st, op] = await Promise.all([
                gitService.getStatus(),
                gitService.getRecentCommits(30),
                gitService.getBranches(),
                gitService.getStashList(),
                gitService.getOperationState(),
            ])
            
            setStatus(s)
            setCommits(c)
            setBranches(b)
            setStashList(st)
            setOperationState(op)
        } catch (e: unknown) {
            logger.ui.error('Git status error:', e)
            setError(tt('error.unknown'))
        } finally {
            setIsRefreshing(false)
        }
    }, [workspacePath])

    // 初始化时刷新一次
    useEffect(() => {
        refreshStatus()
    }, [workspacePath])

    // 监听 .git 目录变化，自动刷新（如果启用）
    useEffect(() => {
        if (!workspacePath) return
        
        const config = getEditorConfig()
        if (!config.git.autoRefresh) return

        let debounceTimer: ReturnType<typeof setTimeout> | null = null
        
        const unsubscribe = api.file.onChanged((event: { event: string; path: string }) => {
            if (event.path.includes('.git')) {
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(refreshStatus, 500)
            }
        })

        return () => {
            unsubscribe()
            if (debounceTimer) clearTimeout(debounceTimer)
        }
    }, [workspacePath, refreshStatus])

    // 切换展开状态
    const toggleSection = (section: keyof typeof expandedSections) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
    }

    // AI 生成提交信息
    const handleGenerateCommitMessage = useCallback(async () => {
        if (!status || (status.staged.length === 0 && status.unstaged.length === 0)) {
            toast.warning(tt('git.noChanges'))
            return
        }

        const { llmConfig } = useStore.getState()
        if (!llmConfig.apiKey) {
            toast.warning(tt('apiKeyWarning'))
            return
        }

        setIsGeneratingMessage(true)
        try {
            // 获取所有变更文件的 diff
            const allChanges = [...status.staged, ...status.unstaged]
            const diffs: string[] = []
            
            for (const file of allChanges.slice(0, 10)) { // 限制最多10个文件
                const diff = await gitService.getFileDiff(file.path, status.staged.includes(file))
                if (diff) {
                    diffs.push(`File: ${file.path}\nStatus: ${file.status}\n${diff.slice(0, 1000)}`) // 限制每个diff长度
                }
            }

            if (diffs.length === 0) {
                toast.warning(tt('git.noChanges'))
                setIsGeneratingMessage(false)
                return
            }

            // 构建提示
            const prompt = `Based on the following git diff, generate a concise and descriptive commit message. Follow conventional commits format (e.g., feat:, fix:, docs:, refactor:, etc.). Only output the commit message, nothing else.

Changes:
${diffs.join('\n\n---\n\n')}

Commit message:`

            // 调用 LLM API (使用 compactContext 进行同步调用)
            const response = await api.llm.compactContext({
                config: llmConfig,
                messages: [{ role: 'user', content: prompt }],
            })

            if (response?.content) {
                // 清理生成的消息
                let message = response.content.trim()
                // 移除可能的引号
                message = message.replace(/^["']|["']$/g, '')
                // 移除可能的 "Commit message:" 前缀
                message = message.replace(/^commit message:\s*/i, '')
                setCommitMessage(message)
            } else {
                toast.error(tt('git.generateFailed'), response?.error)
            }
        } catch (e) {
            logger.ui.error('Failed to generate commit message:', e)
            toast.error(tt('git.generateFailed'))
        } finally {
            setIsGeneratingMessage(false)
        }
    }, [status, tt])

    // ==================== 操作处理 ====================
    
    const handleInit = async () => {
        if (!workspacePath) return
        await gitService.init()
        refreshStatus()
        toast.success(tt('git.repoInitialized'))
    }

    const handleStage = async (path: string) => {
        await gitService.stageFile(path)
        refreshStatus()
    }

    const handleStageAll = async () => {
        await gitService.stageAll()
        refreshStatus()
    }

    const handleUnstage = async (path: string) => {
        await gitService.unstageFile(path)
        refreshStatus()
    }

    const handleUnstageAll = async () => {
        await gitService.unstageAll()
        refreshStatus()
    }

    const handleDiscard = async (path: string) => {
        const { globalConfirm } = await import('@components/common/ConfirmDialog')
        const confirmed = await globalConfirm({
            title: tt('git.discard'),
            message: t('git.discardConfirm', language, { name: getFileName(path) }),
            confirmText: tt('git.discard'),
            variant: 'danger',
        })
        if (confirmed) {
            await gitService.discardChanges(path)
            refreshStatus()
            toast.success(tt('git.discarded'))
        }
    }

    const handleCommit = async () => {
        if (!commitMessage.trim()) return
        setIsCommitting(true)
        const result = await gitService.commit(commitMessage)
        setIsCommitting(false)
        if (result.success) {
            setCommitMessage('')
            refreshStatus()
            toast.success(tt('git.commitSuccess'))
        } else {
            toast.error(tt('git.commitFailed'), result.error)
        }
    }

    const handlePush = async () => {
        setIsPushing(true)
        const result = await gitService.push()
        setIsPushing(false)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.pushSuccess'))
        } else {
            toast.error(tt('git.pushFailed'), result.error)
        }
    }

    const handlePull = async () => {
        setIsPulling(true)
        const result = await gitService.pull()
        setIsPulling(false)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.pullSuccess'))
        } else {
            toast.error(tt('git.pullFailed'), result.error)
        }
    }

    const handleFetch = async () => {
        const result = await gitService.fetch()
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.fetchSuccess'))
        } else {
            toast.error(tt('git.fetchFailed'), result.error)
        }
    }

    // 分支操作
    const handleCheckoutBranch = async (name: string) => {
        const result = await gitService.checkoutBranch(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.branchSwitched'), name)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    const handleCreateBranch = async () => {
        if (!newBranchName.trim()) return
        const result = await gitService.createBranch(newBranchName)
        if (result.success) {
            setNewBranchName('')
            setShowNewBranch(false)
            refreshStatus()
            toast.success(tt('git.branchCreated'), newBranchName)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    const handleDeleteBranch = async (name: string) => {
        const { globalConfirm } = await import('@components/common/ConfirmDialog')
        const confirmed = await globalConfirm({
            title: tt('git.deleteBranch'),
            message: t('git.deleteBranchConfirm', language, { name }),
            confirmText: tt('delete'),
            variant: 'danger',
        })
        if (confirmed) {
            const result = await gitService.deleteBranch(name)
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.branchDeleted'), name)
            } else {
                toast.error(tt('git.mergeFailed'), result.error)
            }
        }
    }

    const handleMergeBranch = async (name: string) => {
        const result = await gitService.mergeBranch(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.mergeSuccess'))
        } else if (result.conflicts) {
            refreshStatus()
            toast.warning(tt('git.mergeConflicts'), `${result.conflicts.length} files`)
        } else {
            toast.error(tt('git.mergeFailed'), result.error)
        }
    }

    const handleRebaseBranch = async (name: string) => {
        const result = await gitService.rebase(name)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.rebaseSuccess'))
        } else {
            refreshStatus()
            toast.error(tt('git.rebaseFailed'), result.error)
        }
    }

    // Stash 操作
    const handleStash = async () => {
        const result = await gitService.stash(stashMessage || undefined, true)
        if (result.success) {
            setStashMessage('')
            setShowStashInput(false)
            refreshStatus()
            toast.success(tt('git.stashed'))
        } else {
            toast.error(tt('git.stashFailed'), result.error)
        }
    }

    const handleStashApply = async (index: number) => {
        const result = await gitService.stashApply(index)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.stashApplied'))
        } else {
            toast.error(tt('git.stashFailed'), result.error)
        }
    }

    const handleStashPop = async (index: number) => {
        const result = await gitService.stashPop(index)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.stashPopped'))
        } else {
            toast.error(tt('git.stashFailed'), result.error)
        }
    }

    const handleStashDrop = async (index: number) => {
        const { globalConfirm } = await import('@components/common/ConfirmDialog')
        const confirmed = await globalConfirm({
            title: tt('git.stashDrop'),
            message: t('git.stashDropConfirm', language, { index: String(index) }),
            confirmText: tt('git.stashDrop'),
            variant: 'danger',
        })
        if (confirmed) {
            const result = await gitService.stashDrop(index)
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.stashDropped'))
            } else {
                toast.error(tt('git.stashFailed'), result.error)
            }
        }
    }

    // Commit 操作
    const handleCherryPick = async (hash: string) => {
        const result = await gitService.cherryPick(hash)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.cherryPickSuccess'))
        } else {
            refreshStatus()
            toast.error(tt('git.cherryPickFailed'), result.error)
        }
    }

    const handleRevertCommit = async (hash: string) => {
        const result = await gitService.revertCommit(hash)
        if (result.success) {
            refreshStatus()
            toast.success(tt('git.revertSuccess'))
        } else {
            toast.error(tt('git.revertFailed'), result.error)
        }
    }

    // 操作状态处理
    const handleContinueOperation = async () => {
        let result
        switch (operationState) {
            case 'rebase':
                result = await gitService.rebaseContinue()
                break
            case 'cherry-pick':
                result = await gitService.cherryPickContinue()
                break
            default:
                return
        }
        if (result?.success) {
            refreshStatus()
            toast.success(tt('git.operationContinued'))
        } else {
            toast.error(tt('git.mergeFailed'), result?.error)
        }
    }

    const handleAbortOperation = async () => {
        let result
        switch (operationState) {
            case 'merge':
                result = await gitService.abortMerge()
                break
            case 'rebase':
                result = await gitService.rebaseAbort()
                break
            case 'cherry-pick':
                result = await gitService.cherryPickAbort()
                break
            default:
                return
        }
        if (result?.success) {
            refreshStatus()
            toast.success(tt('git.operationAborted'))
        } else {
            toast.error(tt('git.mergeFailed'), result?.error)
        }
    }

    const handleSkipOperation = async () => {
        if (operationState === 'rebase') {
            const result = await gitService.rebaseSkip()
            if (result.success) {
                refreshStatus()
                toast.success(tt('git.commitSkipped'))
            } else {
                toast.error(tt('git.mergeFailed'), result.error)
            }
        }
    }

    // 文件点击处理 - 打开 diff
    const handleFileClick = async (path: string, fileStatus: string, staged: boolean) => {
        try {
            const fullPath = `${workspacePath}/${path}`.replace(/\\/g, '/')
            
            // 尝试读取文件内容
            const content = await api.file.read(fullPath)
            
            // 如果读取失败，可能是目录或不存在
            if (content === null) {
                return
            }

            // 根据文件状态决定是否显示 diff
            if (fileStatus === 'modified' || fileStatus === 'renamed') {
                // 修改的文件：显示 HEAD 版本 vs 当前版本
                const original = await gitService.getHeadFileContent(fullPath)
                if (original !== null) {
                    openFile(fullPath, content, original)
                    setActiveFile(fullPath)
                    return
                }
            } else if (fileStatus === 'added' || fileStatus === 'untracked') {
                // 新文件：显示空内容 vs 当前内容
                openFile(fullPath, content, '')
                setActiveFile(fullPath)
                return
            } else if (fileStatus === 'deleted') {
                // 删除的文件：显示原内容 vs 空内容
                const original = await gitService.getHeadFileContent(fullPath)
                if (original !== null) {
                    openFile(fullPath, '', original)
                    setActiveFile(fullPath)
                    return
                }
            }

            // 其他情况，直接打开文件
            openFile(fullPath, content)
            setActiveFile(fullPath)
        } catch (e) {
            logger.ui.error('Failed to open file:', e)
            toast.error(tt('git.openFileFailed'))
        }
    }

    // 计算统计
    const stats = useMemo(() => {
        if (!status) return { staged: 0, unstaged: 0, untracked: 0, total: 0 }
        return {
            staged: status.staged.length,
            unstaged: status.unstaged.length,
            untracked: status.untracked.length,
            total: status.staged.length + status.unstaged.length + status.untracked.length,
        }
    }, [status])

    const localBranches = useMemo(() => branches.filter(b => !b.remote), [branches])
    const remoteBranches = useMemo(() => branches.filter(b => b.remote), [branches])

    // ==================== 渲染 ====================

    if (!workspacePath) {
        return (
            <div className="p-4 text-xs text-text-muted text-center">
                {tt('noFolderOpened')}
            </div>
        )
    }

    // 非 Git 仓库
    if (!status && !isRefreshing) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-14 h-14 bg-surface-hover rounded-2xl flex items-center justify-center mb-4">
                    <FolderGit2 className="w-7 h-7 text-text-muted opacity-50" />
                </div>
                <p className="text-sm text-text-secondary mb-2">{tt('git.noRepo')}</p>
                <p className="text-xs text-text-muted mb-4">{tt('git.noRepoDesc')}</p>
                <Button onClick={handleInit} className="px-4 py-2">
                    <Plus className="w-4 h-4 mr-2" />
                    {tt('git.initRepo')}
                </Button>
                {error && <p className="text-[10px] text-status-error mt-2">{error}</p>}
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full bg-transparent text-sm">
            {/* Header */}
            <div className="h-10 px-3 flex items-center justify-between border-b border-border-subtle sticky top-0 z-10 bg-surface/50 backdrop-blur-sm">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider whitespace-nowrap">
                    {tt('git.title')}
                </span>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    <Button variant="icon" size="icon" onClick={handleFetch} title={tt('git.fetch')} className="w-6 h-6">
                        <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="icon" size="icon" onClick={handlePull} disabled={isPulling} title={tt('git.pull')} className="w-6 h-6">
                        <ArrowDown className={`w-3.5 h-3.5 ${isPulling ? 'animate-bounce' : ''}`} />
                    </Button>
                    <Button variant="icon" size="icon" onClick={handlePush} disabled={isPushing} title={tt('git.push')} className="w-6 h-6">
                        <ArrowUp className={`w-3.5 h-3.5 ${isPushing ? 'animate-bounce' : ''}`} />
                    </Button>
                    <Button variant="icon" size="icon" onClick={refreshStatus} title={tt('refresh')} className="w-6 h-6">
                        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* Operation State Banner */}
            {operationState !== 'normal' && (
                <div className="px-3 py-2 bg-warning/10 border-b border-warning/20 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
                    <span className="text-xs text-warning flex-1 capitalize">{t('git.operationInProgress', language, { operation: operationState })}</span>
                    <div className="flex items-center gap-1">
                        {operationState === 'rebase' && (
                            <Button variant="ghost" size="sm" onClick={handleSkipOperation} className="h-6 px-2 text-xs">
                                <SkipForward className="w-3 h-3 mr-1" /> {tt('git.skip')}
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={handleContinueOperation} className="h-6 px-2 text-xs text-green-400">
                            <Play className="w-3 h-3 mr-1" /> {tt('git.continue')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleAbortOperation} className="h-6 px-2 text-xs text-red-400">
                            <X className="w-3 h-3 mr-1" /> {tt('git.abort')}
                        </Button>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-border-subtle">
                {(['changes', 'branches', 'stash', 'history'] as GitTab[]).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 px-2 py-2 text-xs font-medium transition-colors relative ${
                            activeTab === tab
                                ? 'text-accent'
                                : 'text-text-muted hover:text-text-secondary'
                        }`}
                    >
                        {tab === 'changes' && `${tt('git.changes')}${stats.total > 0 ? ` (${stats.total})` : ''}`}
                        {tab === 'branches' && tt('git.branches')}
                        {tab === 'stash' && `${tt('git.stash')}${stashList.length > 0 ? ` (${stashList.length})` : ''}`}
                        {tab === 'history' && tt('git.history')}
                        {activeTab === tab && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
                        )}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Changes Tab */}
                {activeTab === 'changes' && status && (
                    <div className="flex flex-col">
                        {/* Branch Info */}
                        <div className="px-3 py-2 border-b border-border-subtle bg-surface/30 flex items-center gap-2">
                            <GitBranch className="w-3.5 h-3.5 text-accent" />
                            <span className="text-xs font-medium text-text-primary">{status.branch}</span>
                            {(status.ahead > 0 || status.behind > 0) && (
                                <div className="flex items-center gap-1 ml-auto">
                                    {status.ahead > 0 && (
                                        <span className="text-[10px] text-green-400 flex items-center">
                                            <ArrowUp className="w-2.5 h-2.5" />{status.ahead}
                                        </span>
                                    )}
                                    {status.behind > 0 && (
                                        <span className="text-[10px] text-orange-400 flex items-center">
                                            <ArrowDown className="w-2.5 h-2.5" />{status.behind}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Commit Input */}
                        <div className="p-3 border-b border-border-subtle">
                            <div className="relative">
                                <textarea
                                    value={commitMessage}
                                    onChange={(e) => setCommitMessage(e.target.value)}
                                    placeholder={tt('git.commitMessage')}
                                    className="w-full bg-black/20 border border-border-subtle rounded-lg p-2.5 pr-10 text-xs text-text-primary focus:border-accent/50 focus:bg-black/30 focus:outline-none resize-none min-h-[70px] placeholder:text-text-muted/50"
                                    onKeyDown={(e) => {
                                        if (keybindingService.matches(e, 'git.commit')) handleCommit()
                                    }}
                                />
                                <button
                                    onClick={handleGenerateCommitMessage}
                                    disabled={isGeneratingMessage || stats.total === 0}
                                    className="absolute right-2 top-2 p-1.5 rounded-md hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={tt('git.generateMessage')}
                                >
                                    {isGeneratingMessage ? (
                                        <Loader2 className="w-4 h-4 text-accent animate-spin" />
                                    ) : (
                                        <Sparkles className="w-4 h-4 text-accent" />
                                    )}
                                </button>
                            </div>
                            <div className="flex items-center gap-2 mt-2">
                                <Button
                                    onClick={handleCommit}
                                    disabled={isCommitting || stats.staged === 0}
                                    className="flex-1"
                                >
                                    {isCommitting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
                                    ) : (
                                        <Check className="w-3.5 h-3.5 mr-2" />
                                    )}
                                    {isCommitting ? tt('git.committing') : tt('git.commit')}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowStashInput(!showStashInput)}
                                    title={tt('git.stashChanges')}
                                    className="px-3"
                                >
                                    <Archive className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                            
                            {/* Stash Input */}
                            {showStashInput && (
                                <div className="mt-2 flex items-center gap-2 animate-slide-in">
                                    <Input
                                        value={stashMessage}
                                        onChange={(e) => setStashMessage(e.target.value)}
                                        placeholder={tt('git.stashMessage')}
                                        className="flex-1 h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleStash()
                                            if (e.key === 'Escape') setShowStashInput(false)
                                        }}
                                    />
                                    <Button size="sm" onClick={handleStash} className="h-8">
                                        <Archive className="w-3 h-3 mr-1" /> {tt('git.stash')}
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Conflict Files */}
                        {status.hasConflicts && status.conflictFiles.length > 0 && (
                            <div className="border-b border-border-subtle">
                                <div className="px-3 py-1.5 text-[10px] text-orange-400 font-semibold bg-orange-500/10 flex items-center gap-2">
                                    <AlertTriangle className="w-3 h-3" />
                                    {tt('git.conflicts')} ({status.conflictFiles.length})
                                </div>
                                {status.conflictFiles.map(path => (
                                    <FileItem
                                        key={path}
                                        path={path}
                                        status="unmerged"
                                        staged={false}
                                        onStage={() => handleStage(path)}
                                        onUnstage={() => {}}
                                        onDiscard={() => handleDiscard(path)}
                                        onClick={() => setConflictFile(`${workspacePath}/${path}`.replace(/\\/g, '/'))}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Staged Changes */}
                        {stats.staged > 0 && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleSection('staged')}
                                >
                                    {expandedSections.staged ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.stagedChanges')}</span>
                                    <span className="bg-green-500/20 text-green-400 px-1.5 rounded-full text-[10px]">{stats.staged}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleUnstageAll() }}
                                        className="p-0.5 hover:bg-surface-active rounded"
                                        title={tt('git.unstageAll')}
                                    >
                                        <Minus className="w-3 h-3" />
                                    </button>
                                </div>
                                {expandedSections.staged && status.staged.map(file => (
                                    <FileItem
                                        key={file.path}
                                        path={file.path}
                                        status={file.status}
                                        staged={true}
                                        onStage={() => {}}
                                        onUnstage={() => handleUnstage(file.path)}
                                        onDiscard={() => {}}
                                        onClick={() => handleFileClick(file.path, file.status, true)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Unstaged Changes */}
                        {(stats.unstaged > 0 || stats.untracked > 0) && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleSection('changes')}
                                >
                                    {expandedSections.changes ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.unstaged')}</span>
                                    <span className="bg-yellow-500/20 text-yellow-400 px-1.5 rounded-full text-[10px]">{stats.unstaged + stats.untracked}</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleStageAll() }}
                                        className="p-0.5 hover:bg-surface-active rounded"
                                        title={tt('git.stageAll')}
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                                {expandedSections.changes && (
                                    <>
                                        {status.unstaged.map(file => (
                                            <FileItem
                                                key={file.path}
                                                path={file.path}
                                                status={file.status}
                                                staged={false}
                                                onStage={() => handleStage(file.path)}
                                                onUnstage={() => {}}
                                                onDiscard={() => handleDiscard(file.path)}
                                                onClick={() => handleFileClick(file.path, file.status, false)}
                                            />
                                        ))}
                                        {status.untracked.map(path => (
                                            <FileItem
                                                key={path}
                                                path={path}
                                                status="untracked"
                                                staged={false}
                                                onStage={() => handleStage(path)}
                                                onUnstage={() => {}}
                                                onDiscard={() => handleDiscard(path)}
                                                onClick={() => handleFileClick(path, 'added', false)}
                                            />
                                        ))}
                                    </>
                                )}
                            </div>
                        )}

                        {/* No Changes */}
                        {stats.total === 0 && !status.hasConflicts && (
                            <div className="p-6 text-center">
                                <Check className="w-8 h-8 text-green-400 mx-auto mb-2 opacity-50" />
                                <p className="text-xs text-text-muted">{tt('git.noChanges')}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Branches Tab */}
                {activeTab === 'branches' && (
                    <div className="flex flex-col">
                        {/* New Branch */}
                        <div className="p-3 border-b border-border-subtle">
                            {showNewBranch ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={newBranchName}
                                        onChange={(e) => setNewBranchName(e.target.value)}
                                        placeholder={tt('git.newBranchName')}
                                        className="flex-1 h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateBranch()
                                            if (e.key === 'Escape') setShowNewBranch(false)
                                        }}
                                        autoFocus
                                    />
                                    <Button size="sm" onClick={handleCreateBranch} className="h-8">
                                        <Check className="w-3 h-3" />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setShowNewBranch(false)} className="h-8">
                                        <X className="w-3 h-3" />
                                    </Button>
                                </div>
                            ) : (
                                <Button variant="secondary" onClick={() => setShowNewBranch(true)} className="w-full">
                                    <Plus className="w-3.5 h-3.5 mr-2" />
                                    {tt('git.newBranch')}
                                </Button>
                            )}
                        </div>

                        {/* Local Branches */}
                        <div>
                            <div
                                className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-b border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                onClick={() => toggleSection('localBranches')}
                            >
                                {expandedSections.localBranches ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                <span className="flex-1">{tt('git.local')}</span>
                                <span className="text-[10px] text-text-muted">{localBranches.length}</span>
                            </div>
                            {expandedSections.localBranches && localBranches.map(branch => (
                                <BranchItem
                                    key={branch.name}
                                    branch={branch}
                                    onCheckout={() => handleCheckoutBranch(branch.name)}
                                    onDelete={() => handleDeleteBranch(branch.name)}
                                    onMerge={() => handleMergeBranch(branch.name)}
                                    onRebase={() => handleRebaseBranch(branch.name)}
                                />
                            ))}
                        </div>

                        {/* Remote Branches */}
                        {remoteBranches.length > 0 && (
                            <div>
                                <div
                                    className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle flex items-center gap-2 cursor-pointer hover:bg-surface-hover"
                                    onClick={() => toggleSection('remoteBranches')}
                                >
                                    {expandedSections.remoteBranches ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                    <span className="flex-1">{tt('git.remote')}</span>
                                    <span className="text-[10px] text-text-muted">{remoteBranches.length}</span>
                                </div>
                                {expandedSections.remoteBranches && remoteBranches.map(branch => (
                                    <BranchItem
                                        key={branch.name}
                                        branch={branch}
                                        onCheckout={() => handleCheckoutBranch(branch.name)}
                                        onDelete={() => {}}
                                        onMerge={() => {}}
                                        onRebase={() => {}}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Stash Tab */}
                {activeTab === 'stash' && (
                    <div className="flex flex-col">
                        {/* Stash Actions */}
                        <div className="p-3 border-b border-border-subtle">
                            {showStashInput ? (
                                <div className="flex items-center gap-2">
                                    <Input
                                        value={stashMessage}
                                        onChange={(e) => setStashMessage(e.target.value)}
                                        placeholder={tt('git.stashMessage')}
                                        className="flex-1 h-8 text-xs"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleStash()
                                            if (e.key === 'Escape') setShowStashInput(false)
                                        }}
                                        autoFocus
                                    />
                                    <Button size="sm" onClick={handleStash} className="h-8">
                                        <Archive className="w-3 h-3 mr-1" /> {tt('git.stash')}
                                    </Button>
                                </div>
                            ) : (
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowStashInput(true)}
                                    disabled={stats.total === 0}
                                    className="w-full"
                                >
                                    <Archive className="w-3.5 h-3.5 mr-2" />
                                    {tt('git.stashChanges')}
                                </Button>
                            )}
                        </div>

                        {/* Stash List */}
                        {stashList.length === 0 ? (
                            <div className="p-6 text-center">
                                <Archive className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-30" />
                                <p className="text-xs text-text-muted">{tt('git.noStash')}</p>
                            </div>
                        ) : (
                            <div>
                                {stashList.map(stash => (
                                    <StashItem
                                        key={stash.index}
                                        stash={stash}
                                        onApply={() => handleStashApply(stash.index)}
                                        onPop={() => handleStashPop(stash.index)}
                                        onDrop={() => handleStashDrop(stash.index)}
                                        onView={() => {
                                            // TODO: Show stash diff
                                            toast.info(tt('git.stash'), stash.message || 'WIP')
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* History Tab */}
                {activeTab === 'history' && (
                    <div className="flex flex-col">
                        {commits.length === 0 ? (
                            <div className="p-6 text-center">
                                <GitCommitIcon className="w-8 h-8 text-text-muted mx-auto mb-2 opacity-30" />
                                <p className="text-xs text-text-muted">{tt('git.noCommits')}</p>
                            </div>
                        ) : (
                            <div>
                                {commits.map(commit => (
                                    <CommitItem
                                        key={commit.hash}
                                        commit={commit}
                                        onCherryPick={() => handleCherryPick(commit.hash)}
                                        onRevert={() => handleRevertCommit(commit.hash)}
                                        onCopyHash={() => {
                                            navigator.clipboard.writeText(commit.hash)
                                            toast.success(tt('git.hashCopied'))
                                        }}
                                        onClick={() => {
                                            // TODO: Show commit details
                                            toast.info(commit.shortHash, commit.message)
                                        }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Conflict Resolver Modal */}
            {conflictFile && (
                <Modal isOpen={true} onClose={() => setConflictFile(null)} title="" size="5xl" noPadding>
                    <ConflictResolver
                        filePath={conflictFile}
                        onResolved={() => {
                            setConflictFile(null)
                            refreshStatus()
                        }}
                        onCancel={() => setConflictFile(null)}
                    />
                </Modal>
            )}
        </div>
    )
}
