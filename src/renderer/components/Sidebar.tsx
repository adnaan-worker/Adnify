import { useState, useEffect, useCallback } from 'react'
import {
  FolderOpen, File, ChevronRight, ChevronDown,
  Plus, RefreshCw, FolderPlus, GitBranch, Circle,
  Search as SearchIcon, MoreHorizontal
} from 'lucide-react'
import { useStore } from '../store'
import { FileItem } from '../types/electron'
import { t } from '../i18n'
import { gitService, GitStatus } from '../agent/gitService'

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

function FileTreeItem({ item, depth = 0 }: { item: FileItem; depth?: number }) {
  const { expandedFolders, toggleFolder, openFile, setActiveFile, activeFilePath } = useStore()
  const [children, setChildren] = useState<FileItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const isExpanded = expandedFolders.has(item.path)
  const isActive = activeFilePath === item.path

  useEffect(() => {
    if (item.isDirectory && isExpanded) {
      setIsLoading(true)
      window.electronAPI.readDir(item.path).then((items) => {
        setChildren(items)
        setIsLoading(false)
      })
    }
  }, [item.path, item.isDirectory, isExpanded])

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
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

  return (
    <div>
      <div
        onClick={handleClick}
        className={`
            group flex items-center gap-1.5 py-1 pr-2 cursor-pointer transition-colors relative
            ${isActive ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}
        `}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
      >
        {/* Indent Guide */}
        {depth > 0 && (
             <div className="absolute left-0 top-0 bottom-0 border-l border-border-subtle" 
                  style={{ left: `${depth * 12}px` }} 
             />
        )}

        {item.isDirectory ? (
          <>
             <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                 <ChevronRight className="w-3.5 h-3.5 opacity-70" />
             </span>
            {isLoading ? (
                <div className="w-3.5 h-3.5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
            ) : (
                <FolderOpen className={`w-3.5 h-3.5 ${isExpanded ? 'text-accent' : 'text-text-muted'}`} />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" /> {/* Spacer for alignment */}
            <File className={`w-3.5 h-3.5 ${getFileIcon(item.name)}`} />
          </>
        )}
        <span className="text-[13px] truncate leading-normal">{item.name}</span>
      </div>
      
      {item.isDirectory && isExpanded && (
        <div className="relative">
             {/* Vertical line for folder content */}
             <div className="absolute left-0 top-0 bottom-0 border-l border-border-subtle/50" 
                  style={{ left: `${(depth + 1) * 12}px` }} 
             />
          {children
            .sort((a, b) => {
              if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
              return a.isDirectory ? -1 : 1
            })
            .map((child) => (
              <FileTreeItem key={child.path} item={child} depth={depth + 1} />
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

    // 工作区变化时更新 Git 状态
    useEffect(() => {
        updateGitStatus()
        // 定期刷新 Git 状态
        const interval = setInterval(updateGitStatus, 5000)
        return () => clearInterval(interval)
    }, [updateGitStatus])

    const handleOpenFolder = async () => {
        const path = await window.electronAPI.openFolder()
        if (path) {
        setWorkspacePath(path)
        const items = await window.electronAPI.readDir(path)
        setFiles(items)
        }
    }

    const refreshFiles = async () => {
        if (workspacePath) {
        const items = await window.electronAPI.readDir(workspacePath)
        setFiles(items)
        updateGitStatus()
        }
    }

    return (
        <div className="h-full flex flex-col">
            <div className="h-9 px-3 flex items-center justify-between group">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    {t('explorer', language)}
                </span>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                     <button onClick={handleOpenFolder} className="p-1 hover:bg-surface-active rounded transition-colors" title={t('openFolder', language)}>
                        <FolderPlus className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                    <button onClick={refreshFiles} className="p-1 hover:bg-surface-active rounded transition-colors" title={t('refresh', language)}>
                        <RefreshCw className="w-3.5 h-3.5 text-text-muted hover:text-text-primary" />
                    </button>
                </div>
            </div>

             <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar py-1">
                {workspacePath ? (
                files
                    .sort((a, b) => {
                    if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
                    return a.isDirectory ? -1 : 1
                    })
                    .map((item) => (
                    <FileTreeItem key={item.path} item={item} />
                    ))
                ) : (
                <div className="flex flex-col items-center justify-center h-full text-center px-6">
                    <div className="w-12 h-12 bg-surface-hover rounded-xl flex items-center justify-center mb-4">
                        <FolderOpen className="w-6 h-6 text-text-muted" />
                    </div>
                    <p className="text-sm text-text-muted mb-4 font-medium">No Folder Opened</p>
                    <button
                    onClick={handleOpenFolder}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-medium rounded-lg hover:bg-primary-hover transition-colors shadow-glow"
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
        </div>
    )
}

function SearchView() {
    return (
        <div className="p-4 text-center">
            <SearchIcon className="w-8 h-8 text-text-muted mx-auto mb-2" />
            <p className="text-sm text-text-muted">Search functionality coming soon.</p>
        </div>
    )
}

export default function Sidebar() {
  const { activeSidePanel } = useStore()

  if (!activeSidePanel) return null

  return (
    <div className="w-64 bg-background-secondary border-r border-border-subtle flex flex-col h-full animate-slide-in">
      {activeSidePanel === 'explorer' && <ExplorerView />}
      {activeSidePanel === 'search' && <SearchView />}
      {activeSidePanel === 'git' && <div className="p-4 text-sm text-text-muted">Git Control</div>}
    </div>
  )
}
