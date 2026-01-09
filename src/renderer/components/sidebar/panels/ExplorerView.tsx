/**
 * 文件资源管理器视图
 */

import { api } from '@/renderer/services/electronAPI'
import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, Plus, RefreshCw, FolderPlus, GitBranch, FilePlus, ExternalLink, Crosshair } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { joinPath, pathStartsWith } from '@shared/utils/pathUtils'
import { gitService } from '@renderer/agent/services/gitService'
import { getEditorConfig } from '@renderer/config/editorConfig'
import { toast } from '../../common/ToastProvider'
import { workspaceManager } from '@services/WorkspaceManager'
import { directoryCacheService } from '@services/directoryCacheService'
import { Button, Tooltip, ContextMenu, ContextMenuItem } from '../../ui'
import { VirtualFileTree } from '../../tree/VirtualFileTree'

export function ExplorerView() {
  const {
    workspacePath,
    workspace,
    files,
    setFiles,
    language,
    triggerFileTreeRefresh,
    gitStatus,
    setGitStatus,
    isGitRepo,
    setIsGitRepo,
    expandFolder,
    activeFilePath,
  } = useStore()

  const [creatingIn, setCreatingIn] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)
  const [rootContextMenu, setRootContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Reveal active file in explorer
  const handleRevealActiveFile = useCallback(() => {
    if (activeFilePath) {
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
    }
  }, [activeFilePath])

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
  }, [workspacePath, setGitStatus, setIsGitRepo])

  // 刷新文件列表
  const refreshFiles = useCallback(async () => {
    if (workspacePath) {
      directoryCacheService.clear()
      const items = await directoryCacheService.getDirectory(workspacePath, true)
      setFiles(items)
      updateGitStatus()
      triggerFileTreeRefresh()
    }
  }, [workspacePath, setFiles, updateGitStatus, triggerFileTreeRefresh])

  // 工作区变化时更新 Git 状态（只在初始化时执行一次）
  useEffect(() => {
    if (!workspacePath) return
    updateGitStatus()
  }, [workspacePath])

  // 监听文件变化事件
  useEffect(() => {
    if (!workspacePath) return

    const config = getEditorConfig()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let gitDebounceTimer: ReturnType<typeof setTimeout> | null = null
    let pendingChanges: Array<{ path: string; event: string }> = []

    const unsubscribe = api.file.onChanged((event: { event: 'create' | 'update' | 'delete'; path: string }) => {
      if (pathStartsWith(event.path, workspacePath)) {
        pendingChanges.push({ path: event.path, event: event.event })

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          pendingChanges.forEach((change) => {
            const eventType = change.event === 'create' ? 'create' : change.event === 'delete' ? 'delete' : 'update'
            directoryCacheService.handleFileChange(change.path, eventType)
          })
          pendingChanges = []
          refreshFiles()
        }, config.performance.fileChangeDebounceMs)
        
        // 如果启用了自动刷新且是 .git 目录变化，延迟刷新 Git 状态
        if (config.git.autoRefresh && event.path.includes('.git')) {
          if (gitDebounceTimer) clearTimeout(gitDebounceTimer)
          gitDebounceTimer = setTimeout(updateGitStatus, 500)
        }
      }
    })

    return () => {
      unsubscribe()
      if (debounceTimer) clearTimeout(debounceTimer)
      if (gitDebounceTimer) clearTimeout(gitDebounceTimer)
    }
  }, [workspacePath, refreshFiles, updateGitStatus])

  const handleOpenFolder = async () => {
    const path = await api.file.openFolder()
    if (path && typeof path === 'string') {
      directoryCacheService.clear()
      await workspaceManager.openFolder(path)
    }
  }

  const handleStartCreate = useCallback((path: string, type: 'file' | 'folder') => {
    // 确保父文件夹展开
    expandFolder(path)
    setCreatingIn({ path, type })
  }, [expandFolder])

  const handleCancelCreate = useCallback(() => {
    setCreatingIn(null)
  }, [])

  const handleCreateSubmit = useCallback(
    async (parentPath: string, name: string, type: 'file' | 'folder') => {
      const fullPath = joinPath(parentPath, name)
      let success = false

      if (type === 'file') {
        success = await api.file.write(fullPath, '')
      } else {
        success = await api.file.mkdir(fullPath)
      }

      if (success) {
        directoryCacheService.invalidate(parentPath)
        await refreshFiles()
        toast.success(type === 'file' ? 'File created' : 'Folder created')
      }
      setCreatingIn(null)
    },
    [refreshFiles]
  )

  const handleRootCreate = useCallback(
    (type: 'file' | 'folder') => {
      if (workspacePath) {
        setCreatingIn({ path: workspacePath, type })
      }
    },
    [workspacePath]
  )

  const handleRootContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (workspacePath) {
        setRootContextMenu({ x: e.clientX, y: e.clientY })
      }
    },
    [workspacePath]
  )

  const rootMenuItems: ContextMenuItem[] = [
    { id: 'newFile', label: t('newFile', language), icon: FilePlus, onClick: () => handleRootCreate('file') },
    { id: 'newFolder', label: t('newFolder', language), icon: FolderPlus, onClick: () => handleRootCreate('folder') },
    { id: 'sep1', label: '', separator: true },
    { id: 'refresh', label: t('refresh', language), icon: RefreshCw, onClick: refreshFiles },
    {
      id: 'reveal',
      label: 'Reveal in Explorer',
      icon: ExternalLink,
      onClick: () => workspacePath && api.file.showInFolder(workspacePath),
    },
  ]

  return (
    <div className="h-full flex flex-col bg-background-secondary">
      <div className="h-10 px-4 flex items-center justify-between group border-b border-border bg-transparent sticky top-0 z-10">
        <span className="text-[10px] font-black text-text-muted uppercase tracking-[0.2em] opacity-50">
          {t('explorer', language)}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip content={t('revealActiveFile', language) || 'Reveal Active File'}>
            <button onClick={handleRevealActiveFile} disabled={!activeFilePath} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-all">
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t('newFile', language)}>
            <button onClick={() => handleRootCreate('file')} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-all">
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t('newFolder', language)}>
            <button onClick={() => handleRootCreate('folder')} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-all">
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip content={t('refresh', language)}>
            <button onClick={refreshFiles} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 text-text-muted hover:text-text-primary transition-all">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col" onContextMenu={handleRootContextMenu}>
        {workspace && workspace.roots.length > 0 && files.length > 0 ? (
          <VirtualFileTree
            items={files}
            onRefresh={refreshFiles}
            creatingIn={creatingIn}
            onStartCreate={handleStartCreate}
            onCancelCreate={handleCancelCreate}
            onCreateSubmit={handleCreateSubmit}
          />
        ) : workspace && workspace.roots.length > 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-16 h-16 bg-surface/20 backdrop-blur-md rounded-3xl flex items-center justify-center mb-6 border border-border shadow-inner">
              <FolderOpen className="w-8 h-8 text-text-muted opacity-50" />
            </div>
            <p className="text-sm font-medium text-text-primary mb-1">{t('noFolderOpened', language)}</p>
            <p className="text-xs text-text-muted mb-6 opacity-60">Open a folder to start coding</p>
            <Button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl shadow-lg shadow-accent/20"
            >
              <Plus className="w-4 h-4" />
              {t('openFolder', language)}
            </Button>
          </div>
        )}
      </div>

      {isGitRepo && gitStatus && (
        <div className="px-3 py-2 border-t border-border bg-transparent">
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <GitBranch className="w-3.5 h-3.5 text-accent opacity-80" />
            <span className="font-medium">{gitStatus.branch}</span>
            {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20">
                {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
                {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
              </span>
            )}
            <Tooltip content={t('git.refreshStatus', language) || 'Refresh Git Status'}>
              <button
                onClick={updateGitStatus}
                className="ml-auto p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {rootContextMenu && (
        <ContextMenu x={rootContextMenu.x} y={rootContextMenu.y} items={rootMenuItems} onClose={() => setRootContextMenu(null)} />
      )}
    </div>
  )
}
