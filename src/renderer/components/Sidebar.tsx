import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
    FolderOpen, File, ChevronRight, ChevronDown,
    Plus, RefreshCw, FolderPlus, GitBranch,
    MoreHorizontal, Trash2, Copy, Clipboard,
    FileText, ArrowRight, Edit2, FilePlus, Loader2, Check,
    AlertCircle, AlertTriangle, Info, Code, Hash, Braces, Box,
    ExternalLink
} from 'lucide-react'
import { useStore } from '../store'
import { FileItem, LspDiagnostic, LspDocumentSymbol } from '../types/electron'
import { t } from '../i18n'
import { getFileName, getDirPath, joinPath } from '../utils/pathUtils'
import { gitService, GitStatus, GitCommit } from '../agent/gitService'
import { getEditorConfig } from '../config/editorConfig'
import { toast } from './Toast'
import { onDiagnostics, getDocumentSymbols } from '../services/lspService'
import { adnifyDir } from '../services/adnifyDirService'
import { ContextMenu, ContextMenuItem } from './ContextMenu'
import { directoryCacheService } from '../services/directoryCacheService'
import { VirtualFileTree } from './VirtualFileTree'

// 超过此数量的文件时启用虚拟滚动
const VIRTUAL_SCROLL_THRESHOLD = 100

const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase()
    const iconColors: Record<string, string> = {
        ts: 'text-blue-400',
        tsx: 'text-blue-400',
        js: 'text-yellow-400',
        jsx: 'text-yellow-400',
        py: 'text-green-400',
        json: 'text-yellow-300',
        md: 'text-gray-400',
        css: 'text-pink-400',
        html: 'text-orange-400',
        gitignore: 'text-gray-500',
    }
    return iconColors[ext || ''] || 'text-text-muted'
}

/** 内联创建输入框 */
function InlineCreateInput({
    type,
    depth,
    onSubmit,
    onCancel
}: {
    type: 'file' | 'folder'
    depth: number
    onSubmit: (name: string) => void
    onCancel: () => void
}) {
    const [value, setValue] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    const handleSubmit = () => {
        if (value.trim()) {
            onSubmit(value.trim())
        } else {
            onCancel()
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSubmit()
        if (e.key === 'Escape') onCancel()
    }

    return (
        <div
            className="flex items-center gap-1.5 py-1 pr-2"
            style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
            <span className="w-3.5 flex-shrink-0" />
            {type === 'folder' ? (
                <FolderPlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            ) : (
                <FilePlus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            )}
            <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleSubmit}
                onKeyDown={handleKeyDown}
                placeholder={type === 'file' ? 'filename.ext' : 'folder name'}
                className="flex-1 bg-surface-active border border-accent rounded px-1.5 py-0.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-accent min-w-0 text-text-primary"
            />
        </div>
    )
}

function FileTreeItem({
    item,
    depth = 0,
    onRefresh,
    creatingIn,
    onStartCreate,
    onCancelCreate,
    onCreateSubmit
}: {
    item: FileItem
    depth?: number
    onRefresh: () => void
    creatingIn: { path: string; type: 'file' | 'folder' } | null
    onStartCreate: (path: string, type: 'file' | 'folder') => void
    onCancelCreate: () => void
    onCreateSubmit: (parentPath: string, name: string, type: 'file' | 'folder') => void
}) {
    const { expandedFolders, toggleFolder, expandFolder, openFile, setActiveFile, activeFilePath, language } = useStore()
    const [children, setChildren] = useState<FileItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isRenaming, setIsRenaming] = useState(false)
    const [renameValue, setRenameValue] = useState(item.name)
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
    const renameInputRef = useRef<HTMLInputElement>(null)

    const isExpanded = expandedFolders.has(item.path)
    const isActive = activeFilePath === item.path
    const isCreatingHere = creatingIn?.path === item.path

    useEffect(() => {
        if (item.isDirectory && isExpanded) {
            // 先检查缓存，如果有缓存则不显示 loading
            const loadChildren = async () => {
                setIsLoading(true)
                try {
                    const items = await directoryCacheService.getDirectory(item.path)
                    setChildren(items)
                    
                    // 预加载下一层子目录（提升展开速度）
                    const subDirs = items.filter(i => i.isDirectory).slice(0, 5)
                    if (subDirs.length > 0) {
                        directoryCacheService.preload(subDirs.map(d => d.path))
                    }
                } finally {
                    setIsLoading(false)
                }
            }
            loadChildren()
        }
    }, [item.path, item.isDirectory, isExpanded])

    useEffect(() => {
        if (isRenaming && renameInputRef.current) {
            renameInputRef.current.focus()
            renameInputRef.current.select()
        }
    }, [isRenaming])

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isRenaming) return

        if (item.isDirectory) {
            toggleFolder(item.path)
        } else {
            const content = await window.electronAPI.readFile(item.path)
            if (content !== null) {
                openFile(item.path, content)
                setActiveFile(item.path)
            }
        }
    }

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setContextMenu({ x: e.clientX, y: e.clientY })
    }

    const handleDelete = async () => {
        if (confirm(t('confirmDelete', language, { name: item.name }))) {
            await window.electronAPI.deleteFile(item.path)
            onRefresh()
        }
    }

    const handleRenameStart = () => {
        setRenameValue(item.name)
        setIsRenaming(true)
    }

    const handleRenameSubmit = async () => {
        if (!renameValue.trim() || renameValue === item.name) {
            setIsRenaming(false)
            return
        }
        const newPath = joinPath(getDirPath(item.path), renameValue)
        const success = await window.electronAPI.renameFile(item.path, newPath)
        if (success) {
            onRefresh()
        }
        setIsRenaming(false)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleRenameSubmit()
        if (e.key === 'Escape') setIsRenaming(false)
    }

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData('text/plain', item.path)
        e.dataTransfer.setData('application/adnify-file-path', item.path)
        e.dataTransfer.effectAllowed = 'copy'
    }

    const handleCopyPath = () => {
        navigator.clipboard.writeText(item.path)
        toast.success('Path copied')
    }

    const handleCopyRelativePath = () => {
        const { workspacePath } = useStore.getState()
        if (workspacePath) {
            const relativePath = item.path.replace(workspacePath, '').replace(/^[\\/]/, '')
            navigator.clipboard.writeText(relativePath)
            toast.success('Path copied')
        }
    }

    const handleRevealInExplorer = () => {
        window.electronAPI.showItemInFolder(item.path)
    }

    const handleNewFile = () => {
        if (item.isDirectory) {
            expandFolder(item.path)
            onStartCreate(item.path, 'file')
        }
    }

    const handleNewFolder = () => {
        if (item.isDirectory) {
            expandFolder(item.path)
            onStartCreate(item.path, 'folder')
        }
    }

    // 构建右键菜单项
    const contextMenuItems: ContextMenuItem[] = item.isDirectory
        ? [
            { id: 'newFile', label: t('newFile', language), icon: FilePlus, onClick: handleNewFile },
            { id: 'newFolder', label: t('newFolder', language), icon: FolderPlus, onClick: handleNewFolder },
            { id: 'sep1', label: '', separator: true },
            { id: 'rename', label: t('rename', language), icon: Edit2, onClick: handleRenameStart },
            { id: 'delete', label: t('delete', language), icon: Trash2, danger: true, onClick: handleDelete },
            { id: 'sep2', label: '', separator: true },
            { id: 'copyPath', label: 'Copy Path', icon: Copy, onClick: handleCopyPath },
            { id: 'copyRelPath', label: 'Copy Relative Path', icon: Clipboard, onClick: handleCopyRelativePath },
            { id: 'reveal', label: 'Reveal in Explorer', icon: ExternalLink, onClick: handleRevealInExplorer },
        ]
        : [
            { id: 'rename', label: t('rename', language), icon: Edit2, onClick: handleRenameStart },
            { id: 'delete', label: t('delete', language), icon: Trash2, danger: true, onClick: handleDelete },
            { id: 'sep1', label: '', separator: true },
            { id: 'copyPath', label: 'Copy Path', icon: Copy, onClick: handleCopyPath },
            { id: 'copyRelPath', label: 'Copy Relative Path', icon: Clipboard, onClick: handleCopyRelativePath },
            { id: 'reveal', label: 'Reveal in Explorer', icon: ExternalLink, onClick: handleRevealInExplorer },
        ]

    return (
        <div>
            <div
                draggable={!isRenaming}
                onDragStart={handleDragStart}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                className={`
                    group flex items-center gap-1.5 py-1 pr-2 cursor-pointer transition-all duration-200 relative select-none
                    ${isActive
                        ? 'bg-accent/10 text-text-primary'
                        : 'text-text-muted hover:text-text-primary hover:bg-white/5'}
                `}
                style={{ paddingLeft: `${depth * 12 + 12}px` }}
            >
                {/* Active Indicator Line */}
                {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent" />}

                {/* Indent Guide */}
                {depth > 0 && (
                    <div className="absolute left-0 top-0 bottom-0 border-l border-border-subtle group-hover:border-white/10"
                        style={{ left: `${depth * 12}px` }}
                    />
                )}

                {item.isDirectory ? (
                    <>
                        <span className={`transition-transform duration-200 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                            <ChevronRight className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100" />
                        </span>
                        {isLoading ? (
                            <div className="w-3.5 h-3.5 border-2 border-text-muted border-t-transparent rounded-full animate-spin flex-shrink-0" />
                        ) : (
                            <FolderOpen className={`w-3.5 h-3.5 flex-shrink-0 ${isExpanded ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`} />
                        )}
                    </>
                ) : (
                    <>
                        <span className="w-3.5 flex-shrink-0" />
                        <File className={`w-3.5 h-3.5 flex-shrink-0 ${getFileIcon(item.name)}`} />
                    </>
                )}

                {isRenaming ? (
                    <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-surface-active border-none rounded px-1 py-0 text-[13px] h-5 focus:outline-none focus:ring-1 focus:ring-accent min-w-0 text-text-primary"
                    />
                ) : (
                    <span className="text-[13px] truncate leading-normal flex-1 opacity-90 group-hover:opacity-100">{item.name}</span>
                )}
            </div>

            {/* 右键菜单 */}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    items={contextMenuItems}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* 文件夹展开内容 */}
            {item.isDirectory && isExpanded && (
                <div className="relative">
                    <div className="absolute left-0 top-0 bottom-0 border-l border-border-subtle/30"
                        style={{ left: `${(depth + 1) * 12}px` }}
                    />
                    
                    {/* 内联创建输入框 */}
                    {isCreatingHere && (
                        <InlineCreateInput
                            type={creatingIn!.type}
                            depth={depth + 1}
                            onSubmit={(name) => onCreateSubmit(item.path, name, creatingIn!.type)}
                            onCancel={onCancelCreate}
                        />
                    )}
                    
                    {children
                        .sort((a, b) => {
                            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
                            return a.isDirectory ? -1 : 1
                        })
                        .map((child) => (
                            <FileTreeItem
                                key={child.path}
                                item={child}
                                depth={depth + 1}
                                onRefresh={onRefresh}
                                creatingIn={creatingIn}
                                onStartCreate={onStartCreate}
                                onCancelCreate={onCancelCreate}
                                onCreateSubmit={onCreateSubmit}
                            />
                        ))}
                </div>
            )}
        </div>
    )
}

function ExplorerView() {
    const { workspacePath, files, setWorkspacePath, setFiles, language } = useStore()
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
    const [isGitRepo, setIsGitRepo] = useState(false)
    // 内联创建状态：记录在哪个文件夹创建什么类型
    const [creatingIn, setCreatingIn] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)
    // 根目录右键菜单
    const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null)

    // 更新 Git 状态
    const updateGitStatus = useCallback(async () => {
        if (!workspacePath) {
            setGitStatus(null)
            setIsGitRepo(false)
            return
        }

        gitService.setWorkspace(workspacePath)
        const isRepo = await gitService.isGitRepo()
        setIsGitRepo(isRepo)

        if (isRepo) {
            const status = await gitService.getStatus()
            setGitStatus(status)
        }
    }, [workspacePath])

    // 刷新文件列表
    const refreshFiles = useCallback(async () => {
        if (workspacePath) {
            // 强制刷新根目录缓存
            const items = await directoryCacheService.getDirectory(workspacePath, true)
            setFiles(items)
            updateGitStatus()
        }
    }, [workspacePath, setFiles, updateGitStatus])

    // 工作区变化时更新 Git 状态
    useEffect(() => {
        updateGitStatus()
        // 定期刷新 Git 状态
        const interval = setInterval(updateGitStatus, getEditorConfig().performance.gitStatusIntervalMs)
        return () => clearInterval(interval)
    }, [updateGitStatus])

    // 监听文件变化事件，智能失效缓存并刷新
    useEffect(() => {
        if (!workspacePath) return

        let debounceTimer: ReturnType<typeof setTimeout> | null = null
        let pendingChanges: Array<{ path: string; event: string }> = []

        const unsubscribe = window.electronAPI.onFileChanged((event) => {
            // 只处理当前工作区内的文件变化
            if (event.path.startsWith(workspacePath)) {
                // 收集变化事件
                pendingChanges.push({ path: event.path, event: event.event })
                
                // 防抖处理
                if (debounceTimer) clearTimeout(debounceTimer)
                debounceTimer = setTimeout(() => {
                    // 智能失效缓存
                    pendingChanges.forEach(change => {
                        const eventType = change.event === 'create' ? 'create' 
                            : change.event === 'delete' ? 'delete' 
                            : 'update'
                        directoryCacheService.handleFileChange(change.path, eventType)
                    })
                    pendingChanges = []
                    
                    // 刷新根目录
                    refreshFiles()
                }, getEditorConfig().performance.fileChangeDebounceMs)
            }
        })

        return () => {
            unsubscribe()
            if (debounceTimer) clearTimeout(debounceTimer)
        }
    }, [workspacePath, refreshFiles])

    const handleOpenFolder = async () => {
        const path = await window.electronAPI.openFolder()
        if (path) {
            // 保存当前工作区数据
            await adnifyDir.flush()
            
            // 重置服务（切换项目）
            const { checkpointService } = await import('../agent/checkpointService')
            checkpointService.reset()
            adnifyDir.reset()
            directoryCacheService.clear() // 清空目录缓存
            
            setWorkspacePath(path)
            
            // 初始化 .adnify 目录（统一管理项目数据，会自动加载缓存）
            await adnifyDir.initialize(path)
            
            // 使用缓存服务加载根目录
            const items = await directoryCacheService.getDirectory(path, true)
            setFiles(items)
            
            // 初始化检查点服务
            await checkpointService.init()
        }
    }

    // 开始在指定文件夹创建
    const handleStartCreate = useCallback((path: string, type: 'file' | 'folder') => {
        setCreatingIn({ path, type })
    }, [])

    // 取消创建
    const handleCancelCreate = useCallback(() => {
        setCreatingIn(null)
    }, [])

    // 提交创建
    const handleCreateSubmit = useCallback(async (parentPath: string, name: string, type: 'file' | 'folder') => {
        const fullPath = joinPath(parentPath, name)
        let success = false
        
        if (type === 'file') {
            success = await window.electronAPI.writeFile(fullPath, '')
        } else {
            success = await window.electronAPI.mkdir(fullPath)
        }

        if (success) {
            // 失效父目录缓存
            directoryCacheService.invalidate(parentPath)
            await refreshFiles()
            toast.success(type === 'file' ? 'File created' : 'Folder created')
        }
        setCreatingIn(null)
    }, [refreshFiles])

    // 在根目录创建
    const handleRootCreate = useCallback((type: 'file' | 'folder') => {
        if (workspacePath) {
            setCreatingIn({ path: workspacePath, type })
        }
    }, [workspacePath])

    // 根目录右键菜单
    const handleRootContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        if (workspacePath) {
            setRootContextMenu({ x: e.clientX, y: e.clientY })
        }
    }, [workspacePath])

    const rootMenuItems: ContextMenuItem[] = [
        { id: 'newFile', label: t('newFile', language), icon: FilePlus, onClick: () => handleRootCreate('file') },
        { id: 'newFolder', label: t('newFolder', language), icon: FolderPlus, onClick: () => handleRootCreate('folder') },
        { id: 'sep1', label: '', separator: true },
        { id: 'refresh', label: t('refresh', language), icon: RefreshCw, onClick: refreshFiles },
        { id: 'reveal', label: 'Reveal in Explorer', icon: ExternalLink, onClick: () => workspacePath && window.electronAPI.showItemInFolder(workspacePath) },
    ]

    return (
        <div className="h-full flex flex-col bg-transparent">
            <div className="h-10 px-3 flex items-center justify-between group border-b border-white/5 bg-transparent sticky top-0 z-10">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
                    {t('explorer', language)}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleRootCreate('file')} className="p-1 hover:bg-surface-active rounded transition-colors" title={t('newFile', language)}>
                        <FilePlus className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                    <button onClick={() => handleRootCreate('folder')} className="p-1 hover:bg-surface-active rounded transition-colors" title={t('newFolder', language)}>
                        <FolderPlus className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                    <button onClick={refreshFiles} className="p-1 hover:bg-surface-active rounded transition-colors" title={t('refresh', language)}>
                        <RefreshCw className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                    <button onClick={handleOpenFolder} className="p-1 hover:bg-surface-active rounded transition-colors" title={t('openFolder', language)}>
                        <FolderOpen className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                </div>
            </div>

            <div 
                className="flex-1 overflow-hidden flex flex-col"
                onContextMenu={handleRootContextMenu}
            >
                {workspacePath ? (
                    files.length > VIRTUAL_SCROLL_THRESHOLD ? (
                        // 大目录使用虚拟滚动
                        <VirtualFileTree
                            items={files}
                            onRefresh={refreshFiles}
                            creatingIn={creatingIn}
                            onStartCreate={handleStartCreate}
                            onCancelCreate={handleCancelCreate}
                            onCreateSubmit={handleCreateSubmit}
                        />
                    ) : (
                        // 小目录使用普通渲染
                        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar py-1">
                            {/* 根目录内联创建 */}
                            {creatingIn?.path === workspacePath && (
                                <InlineCreateInput
                                    type={creatingIn.type}
                                    depth={0}
                                    onSubmit={(name) => handleCreateSubmit(workspacePath, name, creatingIn.type)}
                                    onCancel={handleCancelCreate}
                                />
                            )}
                            {files
                                .sort((a: FileItem, b: FileItem) => {
                                    if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
                                    return a.isDirectory ? -1 : 1
                                })
                                .map((item: FileItem) => (
                                    <FileTreeItem
                                        key={item.path}
                                        item={item}
                                        onRefresh={refreshFiles}
                                        creatingIn={creatingIn}
                                        onStartCreate={handleStartCreate}
                                        onCancelCreate={handleCancelCreate}
                                        onCreateSubmit={handleCreateSubmit}
                                    />
                                ))}
                        </div>
                    )
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6">
                        <div className="w-12 h-12 bg-surface-hover rounded-xl flex items-center justify-center mb-4 border border-white/5">
                            <FolderOpen className="w-6 h-6 text-text-muted" />
                        </div>
                        <p className="text-sm text-text-muted mb-4 font-medium">{t('noFolderOpened', language)}</p>
                        <button
                            onClick={handleOpenFolder}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover transition-colors shadow-glow"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            {t('openFolder', language)}
                        </button>
                    </div>
                )}
            </div>

            {/* Git Status Mini-Bar (Pinned to bottom of explorer) */}
            {isGitRepo && gitStatus && (
                <div className="px-3 py-2 border-t border-border-subtle bg-surface/50">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <GitBranch className="w-3.5 h-3.5" />
                        <span>{gitStatus.branch}</span>
                        {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
                            <span className="ml-auto flex items-center gap-1 text-[10px] text-text-muted bg-surface-active px-1.5 py-0.5 rounded">
                                {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
                                {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* 根目录右键菜单 */}
            {rootContextMenu && (
                <ContextMenu
                    x={rootContextMenu.x}
                    y={rootContextMenu.y}
                    items={rootMenuItems}
                    onClose={() => setRootContextMenu(null)}
                />
            )}
        </div>
    )
}

function SearchView() {
    const [query, setQuery] = useState('')
    const [replaceQuery, setReplaceQuery] = useState('')
    const [isRegex, setIsRegex] = useState(false)
    const [isCaseSensitive, setIsCaseSensitive] = useState(false)
    const [isWholeWord, setIsWholeWord] = useState(false)
    const [excludePattern, setExcludePattern] = useState('')
    const [showDetails, setShowDetails] = useState(false)
    const [showReplace, setShowReplace] = useState(false)

    const [searchResults, setSearchResults] = useState<{ path: string; line: number; text: string }[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())

    // 搜索历史
    const [searchHistory, setSearchHistory] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('adnify-search-history')
            return saved ? JSON.parse(saved) : []
        } catch {
            return []
        }
    })
    const [showHistory, setShowHistory] = useState(false)

    const { workspacePath, openFile, setActiveFile, language } = useStore()

    // 保存搜索历史
    const addToHistory = useCallback((searchQuery: string) => {
        if (!searchQuery.trim()) return
        setSearchHistory(prev => {
            const filtered = prev.filter(h => h !== searchQuery)
            const newHistory = [searchQuery, ...filtered].slice(0, 20)
            localStorage.setItem('adnify-search-history', JSON.stringify(newHistory))
            return newHistory
        })
    }, [])

    // Group results by file
    const resultsByFile = useMemo(() => {
        const groups: Record<string, typeof searchResults> = {}
        searchResults.forEach(res => {
            if (!groups[res.path]) groups[res.path] = []
            groups[res.path].push(res)
        })
        return groups
    }, [searchResults])

    const handleSearch = async () => {
        if (!query.trim()) return

        setIsSearching(true)
        setSearchResults([])
        addToHistory(query)
        setShowHistory(false)

        try {
            if (workspacePath) {
                const results = await window.electronAPI.searchFiles(query, workspacePath, {
                    isRegex,
                    isCaseSensitive,
                    isWholeWord,
                    exclude: excludePattern
                })
                setSearchResults(results)
            }
        } finally {
            setIsSearching(false)
        }
    }

    const toggleFileCollapse = (path: string) => {
        const newSet = new Set(collapsedFiles)
        if (newSet.has(path)) newSet.delete(path)
        else newSet.add(path)
        setCollapsedFiles(newSet)
    }

    const handleResultClick = async (result: { path: string }) => {
        const content = await window.electronAPI.readFile(result.path)
        if (content !== null) {
            openFile(result.path, content)
            setActiveFile(result.path)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch()
    }

    // 替换单个文件中的匹配
    const handleReplaceInFile = async () => {
        if (!replaceQuery || searchResults.length === 0) return

        // 获取当前选中的文件（第一个结果的文件）
        const firstResult = searchResults[0]
        if (!firstResult) return

        const content = await window.electronAPI.readFile(firstResult.path)
        if (content === null) return

        let newContent = content
        if (isRegex) {
            try {
                const regex = new RegExp(query, isCaseSensitive ? 'g' : 'gi')
                newContent = content.replace(regex, replaceQuery)
            } catch {
                return
            }
        } else {
            const flags = isCaseSensitive ? 'g' : 'gi'
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = isWholeWord
                ? new RegExp(`\\b${escapedQuery}\\b`, flags)
                : new RegExp(escapedQuery, flags)
            newContent = content.replace(regex, replaceQuery)
        }

        if (newContent !== content) {
            await window.electronAPI.writeFile(firstResult.path, newContent)
            handleSearch() // 刷新搜索结果
        }
    }

    // 替换所有文件中的匹配
    const handleReplaceAll = async () => {
        if (!replaceQuery || searchResults.length === 0) return

        const filePaths = [...new Set(searchResults.map(r => r.path))]

        for (const filePath of filePaths) {
            const content = await window.electronAPI.readFile(filePath)
            if (content === null) continue

            let newContent = content
            if (isRegex) {
                try {
                    const regex = new RegExp(query, isCaseSensitive ? 'g' : 'gi')
                    newContent = content.replace(regex, replaceQuery)
                } catch {
                    continue
                }
            } else {
                const flags = isCaseSensitive ? 'g' : 'gi'
                const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                const regex = isWholeWord
                    ? new RegExp(`\\b${escapedQuery}\\b`, flags)
                    : new RegExp(escapedQuery, flags)
                newContent = content.replace(regex, replaceQuery)
            }

            if (newContent !== content) {
                await window.electronAPI.writeFile(filePath, newContent)
            }
        }

        handleSearch() // 刷新搜索结果
    }

    return (
        <div className="flex flex-col h-full bg-transparent text-sm">
            <div className="h-10 px-3 flex items-center border-b border-white/5 sticky top-0 z-10 bg-transparent">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
                    {t('search', language)}
                </span>
            </div>

            <div className="p-3 border-b border-white/5 flex flex-col gap-2 bg-transparent">
                {/* Search Input Box */}
                <div className="relative flex items-center">
                    <div className="absolute left-0 z-10 p-1">
                        <button onClick={() => setShowReplace(!showReplace)} className="p-0.5 hover:bg-white/5 rounded transition-colors">
                            <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition-transform ${showReplace ? 'rotate-90' : ''}`} />
                        </button>
                    </div>
                    <div className="relative flex-1 ml-5">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={() => searchHistory.length > 0 && setShowHistory(true)}
                            onBlur={() => setTimeout(() => setShowHistory(false), 200)}
                            placeholder={t('searchPlaceholder', language)}
                            className="w-full bg-black/20 border border-white/5 rounded-md py-1.5 pl-2 pr-20 text-xs text-text-primary focus:border-accent/50 focus:bg-black/40 focus:ring-1 focus:ring-accent/50 focus:outline-none transition-all placeholder:text-text-muted/50"
                        />

                        {/* Search History Dropdown */}
                        {showHistory && searchHistory.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border-subtle rounded-md shadow-lg z-20 max-h-48 overflow-y-auto animate-slide-in">
                                <div className="px-2 py-1 text-[10px] text-text-muted font-semibold border-b border-border-subtle">
                                    Recent Searches
                                </div>
                                {searchHistory.map((item, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => {
                                            setQuery(item)
                                            setShowHistory(false)
                                        }}
                                        className="px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover cursor-pointer truncate"
                                    >
                                        {item}
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Toggles */}
                        <div className="absolute right-1 top-1 flex gap-0.5">
                            <button
                                onClick={() => setIsCaseSensitive(!isCaseSensitive)}
                                title={t('matchCase', language)}
                                className={`p-0.5 rounded transition-colors ${isCaseSensitive ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
                            >
                                <span className="text-[10px] font-bold px-1">Aa</span>
                            </button>
                            <button
                                onClick={() => setIsWholeWord(!isWholeWord)}
                                title={t('matchWholeWord', language)}
                                className={`p-0.5 rounded transition-colors ${isWholeWord ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
                            >
                                <span className="text-[10px] font-bold px-0.5 border border-current rounded-[2px]">ab</span>
                            </button>
                            <button
                                onClick={() => setIsRegex(!isRegex)}
                                title={t('useRegex', language)}
                                className={`p-0.5 rounded transition-colors ${isRegex ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-surface-active'}`}
                            >
                                <span className="text-[10px] font-bold px-1">.*</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Replace Input Box */}
                {showReplace && (
                    <div className="relative flex items-center ml-5 animate-slide-in gap-1">
                        <input
                            type="text"
                            value={replaceQuery}
                            onChange={(e) => setReplaceQuery(e.target.value)}
                            placeholder={t('replacePlaceholder', language)}
                            className="flex-1 bg-surface/50 border border-transparent rounded-md py-1.5 pl-2 pr-2 text-xs text-text-primary focus:border-accent focus:bg-surface focus:ring-1 focus:ring-accent focus:outline-none transition-all placeholder:text-text-muted/50"
                        />
                        <button
                            onClick={handleReplaceInFile}
                            disabled={!replaceQuery || searchResults.length === 0}
                            className="p-1.5 hover:bg-surface-active rounded transition-colors disabled:opacity-30"
                            title={t('replace', language)}
                        >
                            <Edit2 className="w-3 h-3 text-text-muted" />
                        </button>
                        <button
                            onClick={handleReplaceAll}
                            disabled={!replaceQuery || searchResults.length === 0}
                            className="p-1.5 hover:bg-surface-active rounded transition-colors disabled:opacity-30"
                            title={t('replaceAll', language)}
                        >
                            <span className="text-[10px] font-bold text-text-muted">All</span>
                        </button>
                    </div>
                )}

                {/* Details Toggle */}
                <div className="ml-5">
                    <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary mb-1 transition-colors"
                    >
                        <MoreHorizontal className="w-3 h-3" />
                        {t('filesToExclude', language)}
                    </button>

                    {showDetails && (
                        <div className="flex flex-col gap-2 animate-slide-in">
                            <input
                                type="text"
                                value={excludePattern}
                                onChange={(e) => setExcludePattern(e.target.value)}
                                placeholder={t('excludePlaceholder', language)}
                                className="w-full bg-surface/50 border border-transparent rounded-md py-1 px-2 text-xs text-text-primary focus:border-accent focus:bg-surface focus:outline-none transition-all"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar bg-background-secondary">
                {isSearching && (
                    <div className="p-4 flex justify-center">
                        <Loader2 className="w-5 h-5 text-accent animate-spin" />
                    </div>
                )}

                {!isSearching && searchResults.length > 0 && (
                    <div className="flex flex-col">
                        <div className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-background-secondary border-b border-border-subtle sticky top-0 z-10">
                            {t('searchResultsCount', language, { results: String(searchResults.length), files: String(Object.keys(resultsByFile).length) })}
                        </div>

                        {Object.entries(resultsByFile).map(([filePath, results]) => {
                            const fileName = getFileName(filePath)
                            const isCollapsed = collapsedFiles.has(filePath)

                            return (
                                <div key={filePath} className="flex flex-col">
                                    {/* File Header */}
                                    <div
                                        onClick={() => toggleFileCollapse(filePath)}
                                        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-surface-hover text-text-secondary sticky top-0 bg-background-secondary/95 backdrop-blur-sm z-0"
                                    >
                                        <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                                        <FileText className="w-3.5 h-3.5 text-text-muted" />
                                        <span className="text-xs font-medium truncate flex-1" title={filePath}>{fileName}</span>
                                        <span className="text-[10px] text-text-muted bg-surface-active px-1.5 rounded-full">{results.length}</span>
                                    </div>

                                    {/* Matches */}
                                    {!isCollapsed && (
                                        <div className="flex flex-col">
                                            {results.map((res, idx) => (
                                                <div
                                                    key={idx}
                                                    onClick={() => handleResultClick(res)}
                                                    className="pl-8 pr-2 py-0.5 cursor-pointer hover:bg-accent/10 hover:text-text-primary group flex gap-2 text-[11px] font-mono text-text-muted border-l-2 border-transparent hover:border-accent transition-colors"
                                                >
                                                    <span className="w-6 text-right flex-shrink-0 opacity-50 select-none">{res.line}:</span>
                                                    <span className="truncate opacity-80 group-hover:opacity-100">{res.text}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}

                {!isSearching && query && searchResults.length === 0 && (
                    <div className="p-6 text-center text-xs text-text-muted opacity-60">
                        {t('noResults', language)}
                    </div>
                )}
            </div>
        </div>
    )
}

function GitView() {
    const { workspacePath, language, openFile, setActiveFile } = useStore()
    const [status, setStatus] = useState<GitStatus | null>(null)
    const [commits, setCommits] = useState<GitCommit[]>([])
    const [commitMessage, setCommitMessage] = useState('')
    const [isCommitting, setIsCommitting] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showCommits, setShowCommits] = useState(true)

    // 新增状态
    const [branches, setBranches] = useState<{ name: string; current: boolean; remote: boolean }[]>([])
    const [showBranches, setShowBranches] = useState(false)
    const [showStash, setShowStash] = useState(false)
    const [stashList, setStashList] = useState<{ index: number; message: string; branch: string }[]>([])
    const [showNewBranch, setShowNewBranch] = useState(false)
    const [newBranchName, setNewBranchName] = useState('')
    const [isPushing, setIsPushing] = useState(false)
    const [isPulling, setIsPulling] = useState(false)

    const refreshStatus = useCallback(async () => {
        if (!workspacePath) return
        setIsRefreshing(true)
        setError(null)
        try {
            // Ensure workspace is set
            gitService.setWorkspace(workspacePath)

            const [s, c, b, st] = await Promise.all([
                gitService.getStatus(),
                gitService.getRecentCommits(),
                gitService.getBranches(),
                gitService.getStashList()
            ])
            setStatus(s)
            setCommits(c)
            setBranches(b)
            setStashList(st)
        } catch (e: unknown) {
            console.error('Git status error:', e)
            setError('Failed to load git status')
        } finally {
            setIsRefreshing(false)
        }
    }, [workspacePath])

    useEffect(() => {
        refreshStatus()
        const interval = setInterval(refreshStatus, getEditorConfig().performance.indexStatusIntervalMs)
        return () => clearInterval(interval)
    }, [refreshStatus])

    const handleInit = async () => {
        if (!workspacePath) return
        await gitService.init()
        refreshStatus()
    }

    const handleStage = async (path: string) => {
        await gitService.stageFile(path)
        refreshStatus()
    }

    const handleUnstage = async (path: string) => {
        await gitService.unstageFile(path)
        refreshStatus()
    }

    const handleCommit = async () => {
        if (!commitMessage.trim()) return
        setIsCommitting(true)
        const result = await gitService.commit(commitMessage)
        setIsCommitting(false)
        if (result.success) {
            setCommitMessage('')
            refreshStatus()
            toast.success('Commit successful')
        } else {
            toast.error('Commit failed', result.error)
        }
    }

    const handlePush = async () => {
        setIsPushing(true)
        const result = await gitService.push()
        setIsPushing(false)
        if (!result.success) {
            toast.error('Push failed', result.error)
        } else {
            refreshStatus()
            toast.success('Push successful')
        }
    }

    const handlePull = async () => {
        setIsPulling(true)
        const result = await gitService.pull()
        setIsPulling(false)
        if (!result.success) {
            toast.error('Pull failed', result.error)
        } else {
            refreshStatus()
            toast.success('Pull successful')
        }
    }

    const handleCheckoutBranch = async (branchName: string) => {
        const result = await gitService.checkoutBranch(branchName)
        if (result.success) {
            refreshStatus()
            setShowBranches(false)
            toast.success('Branch switched', branchName)
        } else {
            toast.error('Checkout failed', result.error)
        }
    }

    const handleCreateBranch = async () => {
        if (!newBranchName.trim()) return
        const result = await gitService.createBranch(newBranchName, true)
        if (result.success) {
            setNewBranchName('')
            setShowNewBranch(false)
            refreshStatus()
            toast.success('Branch created', newBranchName)
        } else {
            toast.error('Create branch failed', result.error)
        }
    }

    const handleStash = async () => {
        const result = await gitService.stash()
        if (result.success) {
            refreshStatus()
            toast.success('Changes stashed')
        } else {
            toast.error('Stash failed', result.error)
        }
    }

    const handleStashPop = async (index: number) => {
        const result = await gitService.stashApply(index, true)
        if (result.success) {
            refreshStatus()
            toast.success('Stash applied')
        } else {
            toast.error('Stash pop failed', result.error)
        }
    }

    const handleFileClick = async (path: string, fileStatus: string) => {
        const content = await window.electronAPI.readFile(path) || ''

        // If modified, try to show diff
        if (fileStatus === 'modified' || fileStatus === 'renamed') {
            const original = await gitService.getHeadFileContent(path)
            if (original !== null) {
                openFile(path, content, original)
                setActiveFile(path)
                return
            }
        }

        openFile(path, content)
        setActiveFile(path)
    }

    if (!workspacePath) return <div className="p-4 text-xs text-text-muted text-center">{t('noFolderOpened', language)}</div>

    // Not a repo state
    if (!status && !isRefreshing) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-12 h-12 bg-surface-hover rounded-full flex items-center justify-center mb-3">
                    <GitBranch className="w-6 h-6 text-text-muted opacity-50" />
                </div>
                <p className="text-xs text-text-muted mb-4">No source control active.</p>
                <button
                    onClick={handleInit}
                    className="px-4 py-2 bg-accent text-white text-xs font-medium rounded hover:bg-accent-hover transition-colors shadow-glow"
                >
                    Initialize Repository
                </button>
                {error && <p className="text-[10px] text-status-error mt-2">{error}</p>}
            </div>
        )
    }

    // Repo loaded but maybe empty
    const hasChanges = status ? (status.staged.length > 0 || status.unstaged.length > 0 || status.untracked.length > 0) : false

    return (
        <div className="flex flex-col h-full bg-transparent text-sm">
            <div className="h-10 px-3 flex items-center justify-between border-b border-white/5 sticky top-0 z-10 bg-transparent">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
                    Source Control
                </span>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={handlePull}
                        disabled={isPulling}
                        className="p-1 hover:bg-surface-active rounded transition-colors disabled:opacity-50"
                        title="Pull"
                    >
                        <ArrowRight className={`w-3.5 h-3.5 text-text-muted hover:text-text-primary rotate-90 ${isPulling ? 'animate-pulse' : ''}`} />
                    </button>
                    <button
                        onClick={handlePush}
                        disabled={isPushing}
                        className="p-1 hover:bg-surface-active rounded transition-colors disabled:opacity-50"
                        title="Push"
                    >
                        <ArrowRight className={`w-3.5 h-3.5 text-text-muted hover:text-text-primary -rotate-90 ${isPushing ? 'animate-pulse' : ''}`} />
                    </button>
                    <button onClick={refreshStatus} className={`p-1 hover:bg-surface-active rounded transition-colors ${isRefreshing ? 'animate-spin' : ''}`} title="Refresh">
                        <RefreshCw className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* Branch Selector */}
                {status && (
                    <div className="px-3 py-2 border-b border-border-subtle bg-surface/30">
                        <div
                            className="flex items-center gap-2 cursor-pointer hover:bg-surface-hover rounded px-2 py-1 transition-colors"
                            onClick={() => setShowBranches(!showBranches)}
                        >
                            <GitBranch className="w-3.5 h-3.5 text-accent" />
                            <span className="text-xs font-medium text-text-primary flex-1">{status.branch}</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${showBranches ? 'rotate-180' : ''}`} />
                        </div>

                        {showBranches && (
                            <div className="mt-2 bg-background rounded border border-border-subtle max-h-48 overflow-y-auto animate-slide-in">
                                {/* New Branch */}
                                <div className="p-2 border-b border-border-subtle">
                                    {showNewBranch ? (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="text"
                                                value={newBranchName}
                                                onChange={(e) => setNewBranchName(e.target.value)}
                                                placeholder="Branch name"
                                                className="flex-1 bg-black/20 border border-white/5 rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/50 focus:bg-black/40 text-text-primary"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleCreateBranch()
                                                    if (e.key === 'Escape') setShowNewBranch(false)
                                                }}
                                                autoFocus
                                            />
                                            <button onClick={handleCreateBranch} className="p-1 hover:bg-surface-active rounded">
                                                <Check className="w-3 h-3 text-status-success" />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setShowNewBranch(true)}
                                            className="flex items-center gap-2 text-xs text-text-muted hover:text-text-primary w-full px-2 py-1 hover:bg-surface-hover rounded"
                                        >
                                            <Plus className="w-3 h-3" />
                                            Create new branch
                                        </button>
                                    )}
                                </div>

                                {/* Local Branches */}
                                {branches.filter(b => !b.remote).map(branch => (
                                    <div
                                        key={branch.name}
                                        onClick={() => !branch.current && handleCheckoutBranch(branch.name)}
                                        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors ${branch.current
                                            ? 'bg-accent/10 text-accent'
                                            : 'text-text-secondary hover:bg-surface-hover'
                                            }`}
                                    >
                                        {branch.current && <Check className="w-3 h-3" />}
                                        <span className={branch.current ? '' : 'ml-5'}>{branch.name}</span>
                                    </div>
                                ))}

                                {/* Remote Branches */}
                                {branches.filter(b => b.remote).length > 0 && (
                                    <>
                                        <div className="px-3 py-1 text-[10px] text-text-muted font-semibold bg-surface-active/30">
                                            REMOTE
                                        </div>
                                        {branches.filter(b => b.remote).map(branch => (
                                            <div
                                                key={branch.name}
                                                onClick={() => handleCheckoutBranch(branch.name)}
                                                className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover cursor-pointer"
                                            >
                                                <span className="ml-5">{branch.name}</span>
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Commit Area */}
                <div className="p-3 border-b border-white/5 bg-transparent">
                    <div className="relative">
                        <textarea
                            value={commitMessage}
                            onChange={(e) => setCommitMessage(e.target.value)}
                            placeholder="Message (Ctrl+Enter to commit)"
                            className="w-full bg-black/20 border border-white/5 rounded-md p-2 text-xs text-text-primary focus:border-accent/50 focus:bg-black/40 focus:outline-none resize-none min-h-[60px] block placeholder:text-text-muted/50"
                            onKeyDown={(e) => {
                                if (e.ctrlKey && e.key === 'Enter') handleCommit()
                            }}
                        />
                    </div>
                    <button
                        onClick={handleCommit}
                        disabled={isCommitting || (status?.staged.length === 0)}
                        className="w-full mt-2 py-1.5 bg-accent/90 text-white text-xs font-medium rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center justify-center gap-2"
                    >
                        {isCommitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        {isCommitting ? 'Committing...' : 'Commit'}
                    </button>
                </div>

                {!hasChanges && status && (
                    <div className="p-4 text-center text-xs text-text-muted opacity-60">
                        No changes detected.
                    </div>
                )}

                {/* Staged Changes */}
                {status && status.staged.length > 0 && (
                    <div className="flex flex-col">
                        <div className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle sticky top-0 flex items-center justify-between group/header">
                            <span>STAGEDCHANGES</span>
                            <span className="bg-surface-active px-1.5 rounded-full">{status.staged.length}</span>
                        </div>
                        {status.staged.map(file => (
                            <div key={file.path} className="group flex items-center px-3 py-1 hover:bg-surface-hover cursor-pointer" onClick={() => handleFileClick(file.path, file.status)}>
                                <span className="text-[10px] font-mono text-accent w-4 text-center flex-shrink-0">{file.status[0].toUpperCase()}</span>
                                <span className="text-xs text-text-secondary truncate flex-1">{file.path}</span>
                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleUnstage(file.path) }}
                                        className="p-1 hover:bg-surface-active rounded text-text-muted hover:text-text-primary"
                                        title="Unstage"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Changes (Unstaged + Untracked) */}
                {status && (status.unstaged.length > 0 || status.untracked.length > 0) && (
                    <div className="flex flex-col mt-2">
                        <div className="px-3 py-1.5 text-[10px] text-text-muted font-semibold bg-surface-active/30 border-y border-border-subtle sticky top-0 flex items-center justify-between">
                            <span>CHANGES</span>
                            <span className="bg-surface-active px-1.5 rounded-full">{status.unstaged.length + status.untracked.length}</span>
                        </div>
                        {/* Unstaged */}
                        {status.unstaged.map(file => (
                            <div key={file.path} className="group flex items-center px-3 py-1 hover:bg-surface-hover cursor-pointer" onClick={() => handleFileClick(file.path, file.status)}>
                                <span className="text-[10px] font-mono text-warning w-4 text-center flex-shrink-0">{file.status[0].toUpperCase()}</span>
                                <span className="text-xs text-text-secondary truncate flex-1">{file.path}</span>
                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleStage(file.path) }}
                                        className="p-1 hover:bg-surface-active rounded text-text-muted hover:text-text-primary"
                                        title="Stage"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                        {/* Untracked */}
                        {status.untracked.map(path => (
                            <div key={path} className="group flex items-center px-3 py-1 hover:bg-surface-hover cursor-pointer" onClick={() => handleFileClick(path, 'untracked')}>
                                <span className="text-[10px] font-mono text-status-success w-4 text-center flex-shrink-0">U</span>
                                <span className="text-xs text-text-secondary truncate flex-1">{path}</span>
                                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleStage(path) }}
                                        className="p-1 hover:bg-surface-active rounded text-text-muted hover:text-text-primary"
                                        title="Stage"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Stash Section */}
                <div className="flex flex-col mt-2 border-t border-border-subtle">
                    <div
                        className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-surface-hover select-none group"
                        onClick={() => setShowStash(!showStash)}
                    >
                        <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${showStash ? '' : '-rotate-90'}`} />
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider flex-1">STASH</span>
                        {stashList.length > 0 && (
                            <span className="text-[10px] text-text-muted bg-surface-active px-1.5 rounded-full">{stashList.length}</span>
                        )}
                        <button
                            onClick={(e) => { e.stopPropagation(); handleStash() }}
                            className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Stash changes"
                        >
                            <Plus className="w-3 h-3 text-text-muted" />
                        </button>
                    </div>

                    {showStash && (
                        <div className="pb-2">
                            {stashList.length === 0 ? (
                                <div className="px-4 py-2 text-xs text-text-muted opacity-60">No stashed changes</div>
                            ) : (
                                stashList.map((stash) => (
                                    <div key={stash.index} className="px-4 py-1.5 hover:bg-surface-hover cursor-pointer group flex items-center gap-2">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs text-text-primary truncate">{stash.message}</div>
                                            <div className="text-[10px] text-text-muted">stash@{`{${stash.index}}`} on {stash.branch}</div>
                                        </div>
                                        <button
                                            onClick={() => handleStashPop(stash.index)}
                                            className="p-1 hover:bg-surface-active rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Pop stash"
                                        >
                                            <ArrowRight className="w-3 h-3 text-text-muted" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                {/* Commits List */}
                {commits.length > 0 && (
                    <div className="flex flex-col border-t border-border-subtle">
                        <div
                            className="px-3 py-2 flex items-center gap-2 cursor-pointer hover:bg-surface-hover select-none"
                            onClick={() => setShowCommits(!showCommits)}
                        >
                            <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${showCommits ? '' : '-rotate-90'}`} />
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">COMMITS</span>
                        </div>

                        {showCommits && (
                            <div className="pb-2">
                                {commits.map((commit) => (
                                    <div key={commit.hash} className="px-4 py-1.5 hover:bg-surface-hover cursor-pointer group border-l-2 border-transparent hover:border-accent">
                                        <div className="text-xs text-text-primary truncate font-medium">{commit.message}</div>
                                        <div className="flex items-center justify-between mt-0.5">
                                            <span className="text-[10px] text-text-muted flex items-center gap-1">
                                                <GitBranch className="w-3 h-3" />
                                                {commit.shortHash}
                                            </span>
                                            <span className="text-[10px] text-text-muted opacity-60">
                                                {commit.author}, {new Date(commit.date).toLocaleDateString()}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// 问题面板 - 显示所有诊断错误
function ProblemsView() {
    const { openFile, setActiveFile, language } = useStore()
    const [diagnostics, setDiagnostics] = useState<Map<string, LspDiagnostic[]>>(new Map())
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set())
    const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all')

    // 监听 LSP 诊断
    useEffect(() => {
        const unsubscribe = onDiagnostics((uri, diags) => {
            setDiagnostics(prev => {
                const next = new Map(prev)
                if (diags.length === 0) {
                    next.delete(uri)
                } else {
                    next.set(uri, diags)
                }
                return next
            })
        })
        return unsubscribe
    }, [])

    const toggleFile = (uri: string) => {
        setExpandedFiles(prev => {
            const next = new Set(prev)
            if (next.has(uri)) next.delete(uri)
            else next.add(uri)
            return next
        })
    }

    const handleDiagnosticClick = async (uri: string, diag: LspDiagnostic) => {
        // 从 URI 提取文件路径 - 处理 Windows 和 Unix 路径
        let filePath = uri
        if (uri.startsWith('file:///')) {
            // Windows: file:///C:/path -> C:/path
            // Unix: file:///path -> /path
            filePath = uri.slice(8)
            // 处理 Windows 盘符 (file:///c%3A/path -> C:/path)
            filePath = decodeURIComponent(filePath)
            // 如果是 Windows 路径，确保使用正确的分隔符
            if (/^[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.replace(/\//g, '\\')
            }
        }

        const content = await window.electronAPI.readFile(filePath)
        if (content !== null) {
            openFile(filePath, content)
            setActiveFile(filePath)

            // 发送跳转到行的事件（编辑器会监听）
            window.dispatchEvent(new CustomEvent('editor:goto-line', {
                detail: {
                    line: diag.range.start.line + 1,
                    column: diag.range.start.character + 1
                }
            }))
        }
    }

    // 统计
    const stats = useMemo(() => {
        let errors = 0, warnings = 0, infos = 0
        diagnostics.forEach(diags => {
            diags.forEach(d => {
                if (d.severity === 1) errors++
                else if (d.severity === 2) warnings++
                else infos++
            })
        })
        return { errors, warnings, infos, total: errors + warnings + infos }
    }, [diagnostics])

    // 过滤后的诊断
    const filteredDiagnostics = useMemo(() => {
        const result = new Map<string, LspDiagnostic[]>()
        diagnostics.forEach((diags, uri) => {
            const filtered = diags.filter(d => {
                if (filter === 'errors') return d.severity === 1
                if (filter === 'warnings') return d.severity === 2
                return true
            })
            if (filtered.length > 0) result.set(uri, filtered)
        })
        return result
    }, [diagnostics, filter])

    const getSeverityIcon = (severity: number | undefined) => {
        if (severity === 1) return <AlertCircle className="w-3.5 h-3.5 text-status-error" />
        if (severity === 2) return <AlertTriangle className="w-3.5 h-3.5 text-status-warning" />
        return <Info className="w-3.5 h-3.5 text-blue-400" />
    }

    return (
        <div className="flex flex-col h-full bg-transparent">
            <div className="h-10 px-3 flex items-center justify-between border-b border-white/5 bg-transparent sticky top-0 z-10">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
                    {language === 'zh' ? '问题' : 'Problems'}
                </span>
                <div className="flex items-center gap-2 text-[10px]">
                    {stats.errors > 0 && (
                        <span className="flex items-center gap-1 text-status-error">
                            <AlertCircle className="w-3 h-3" /> {stats.errors}
                        </span>
                    )}
                    {stats.warnings > 0 && (
                        <span className="flex items-center gap-1 text-status-warning">
                            <AlertTriangle className="w-3 h-3" /> {stats.warnings}
                        </span>
                    )}
                </div>
            </div>

            {/* 过滤器 */}
            <div className="px-3 py-2 border-b border-border-subtle flex gap-1">
                {(['all', 'errors', 'warnings'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2 py-1 text-[10px] rounded transition-colors ${filter === f
                            ? 'bg-accent/20 text-accent'
                            : 'text-text-muted hover:bg-surface-hover'
                            }`}
                    >
                        {f === 'all' ? (language === 'zh' ? '全部' : 'All') :
                            f === 'errors' ? (language === 'zh' ? '错误' : 'Errors') :
                                (language === 'zh' ? '警告' : 'Warnings')}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {filteredDiagnostics.size === 0 ? (
                    <div className="p-6 text-center text-xs text-text-muted">
                        {language === 'zh' ? '没有发现问题' : 'No problems detected'}
                    </div>
                ) : (
                    Array.from(filteredDiagnostics.entries()).map(([uri, diags]) => {
                        const fileName = uri.split(/[\\/]/).pop() || uri
                        const isExpanded = expandedFiles.has(uri)

                        return (
                            <div key={uri} className="border-b border-border-subtle/50">
                                <div
                                    onClick={() => toggleFile(uri)}
                                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hover"
                                >
                                    <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                    <FileText className="w-3.5 h-3.5 text-text-muted" />
                                    <span className="text-xs text-text-secondary flex-1 truncate">{fileName}</span>
                                    <span className="text-[10px] text-text-muted bg-surface-active px-1.5 rounded">{diags.length}</span>
                                </div>

                                {isExpanded && (
                                    <div className="pb-1">
                                        {diags.map((diag, idx) => (
                                            <div
                                                key={idx}
                                                onClick={() => handleDiagnosticClick(uri, diag)}
                                                className="flex items-start gap-2 px-3 py-1.5 pl-8 cursor-pointer hover:bg-surface-hover group"
                                            >
                                                {getSeverityIcon(diag.severity)}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs text-text-primary truncate">{diag.message}</p>
                                                    <p className="text-[10px] text-text-muted">
                                                        {language === 'zh' ? '行' : 'Line'} {diag.range.start.line + 1}
                                                        {diag.source && ` • ${diag.source}`}
                                                        {diag.code && ` (${diag.code})`}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

// 大纲视图 - 显示当前文件的符号结构
function OutlineView() {
    const { activeFilePath, language, openFile, setActiveFile } = useStore()
    const [symbols, setSymbols] = useState<LspDocumentSymbol[]>([])
    const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set())
    const [isLoading, setIsLoading] = useState(false)
    const [filter, setFilter] = useState('')

    // 加载符号
    useEffect(() => {
        if (!activeFilePath) {
            setSymbols([])
            return
        }

        const loadSymbols = async () => {
            setIsLoading(true)
            try {
                const result = await getDocumentSymbols(activeFilePath)
                setSymbols(result || [])
                // 默认展开第一层
                const firstLevel = new Set(result?.map((s: LspDocumentSymbol) => s.name) || [])
                setExpandedSymbols(firstLevel)
            } catch (e) {
                console.error('Failed to load symbols:', e)
                setSymbols([])
            } finally {
                setIsLoading(false)
            }
        }

        loadSymbols()
    }, [activeFilePath])

    const toggleSymbol = (name: string, e: React.MouseEvent) => {
        e.stopPropagation()
        setExpandedSymbols(prev => {
            const next = new Set(prev)
            if (next.has(name)) next.delete(name)
            else next.add(name)
            return next
        })
    }

    // 点击符号跳转到对应行
    const handleSymbolClick = useCallback((symbol: LspDocumentSymbol) => {
        if (!activeFilePath || !symbol.range?.start) return

        // 发送跳转到行的事件
        window.dispatchEvent(new CustomEvent('editor:goto-line', {
            detail: {
                line: symbol.range.start.line + 1,
                column: symbol.range.start.character + 1
            }
        }))
    }, [activeFilePath])

    const getSymbolIcon = (kind: number | undefined) => {
        // LSP SymbolKind
        switch (kind) {
            case 5: // Class
            case 10: // Enum
                return <Box className="w-3.5 h-3.5 text-yellow-400" />
            case 6: // Method
            case 12: // Function
                return <Code className="w-3.5 h-3.5 text-purple-400" />
            case 8: // Field
            case 13: // Variable
            case 14: // Constant
                return <Hash className="w-3.5 h-3.5 text-blue-400" />
            case 11: // Interface
                return <Braces className="w-3.5 h-3.5 text-green-400" />
            default:
                return <Code className="w-3.5 h-3.5 text-text-muted" />
        }
    }

    const renderSymbol = (symbol: LspDocumentSymbol, depth = 0) => {
        const hasChildren = symbol.children && symbol.children.length > 0
        const isExpanded = expandedSymbols.has(symbol.name)
        const matchesFilter = !filter || symbol.name.toLowerCase().includes(filter.toLowerCase())

        if (!matchesFilter && !hasChildren) return null

        return (
            <div key={`${symbol.name}-${symbol.range?.start?.line ?? depth}`}>
                <div
                    onClick={() => handleSymbolClick(symbol)}
                    className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-surface-hover group transition-colors"
                    style={{ paddingLeft: `${depth * 12 + 8}px` }}
                >
                    {hasChildren ? (
                        <button
                            onClick={(e) => toggleSymbol(symbol.name, e)}
                            className="p-0.5 hover:bg-surface-active rounded"
                        >
                            <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                    ) : (
                        <span className="w-4" />
                    )}
                    {getSymbolIcon(symbol.kind)}
                    <span className="text-xs text-text-primary truncate flex-1">{symbol.name}</span>
                    <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 tabular-nums">
                        {symbol.range?.start?.line !== undefined ? symbol.range.start.line + 1 : ''}
                    </span>
                </div>

                {hasChildren && isExpanded && (
                    <div>
                        {symbol.children!.map(child => renderSymbol(child, depth + 1))}
                    </div>
                )}
            </div>
        )
    }

    const fileName = activeFilePath ? getFileName(activeFilePath) : ''

    return (
        <div className="flex flex-col h-full bg-transparent">
            <div className="h-10 px-3 flex items-center justify-between border-b border-white/5 bg-transparent sticky top-0 z-10">
                <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
                    {language === 'zh' ? '大纲' : 'Outline'}
                </span>
                {isLoading && <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />}
            </div>

            {/* 搜索过滤 */}
            <div className="px-3 py-2 border-b border-border-subtle">
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={language === 'zh' ? '过滤符号...' : 'Filter symbols...'}
                    className="w-full bg-surface/50 border border-transparent rounded px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
                />
            </div>

            {/* 当前文件 */}
            {activeFilePath && (
                <div className="px-3 py-1.5 border-b border-border-subtle bg-surface/30">
                    <div className="flex items-center gap-2 text-xs text-text-secondary">
                        <FileText className="w-3.5 h-3.5" />
                        <span className="truncate">{fileName}</span>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
                {!activeFilePath ? (
                    <div className="p-6 text-center text-xs text-text-muted">
                        {language === 'zh' ? '没有打开的文件' : 'No file open'}
                    </div>
                ) : symbols.length === 0 && !isLoading ? (
                    <div className="p-6 text-center text-xs text-text-muted">
                        {language === 'zh' ? '没有找到符号' : 'No symbols found'}
                    </div>
                ) : (
                    symbols.map(symbol => renderSymbol(symbol))
                )}
            </div>
        </div>
    )
}

export default function Sidebar() {
    const { activeSidePanel } = useStore()

    if (!activeSidePanel) return null

    return (
        <div className="w-full bg-background/60 backdrop-blur-xl border-r border-white/5 flex flex-col h-full animate-slide-in relative z-10 shadow-2xl shadow-black/50">
            {activeSidePanel === 'explorer' && <ExplorerView />}
            {activeSidePanel === 'search' && <SearchView />}
            {activeSidePanel === 'git' && <GitView />}
            {activeSidePanel === 'problems' && <ProblemsView />}
            {activeSidePanel === 'outline' && <OutlineView />}
        </div>
    )
}
