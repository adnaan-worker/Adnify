/**
 * 文件资源管理器视图
 */

import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, Plus, RefreshCw, FolderPlus, GitBranch, FilePlus, ExternalLink } from 'lucide-react'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import { joinPath } from '@utils/pathUtils'
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
  } = useStore()

  const [creatingIn, setCreatingIn] = useState<{ path: string; type: 'file' | 'folder' } | null>(null)
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

  // 工作区变化时更新 Git 状态
  useEffect(() => {
    updateGitStatus()
    const interval = setInterval(updateGitStatus, getEditorConfig().performance.gitStatusIntervalMs)
    return () => clearInterval(interval)
  }, [updateGitStatus])

  // 监听文件变化事件
  useEffect(() => {
    if (!workspacePath) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let pendingChanges: Array<{ path: string; event: string }> = []

    const unsubscribe = window.electronAPI.onFileChanged((event) => {
      if (event.path.startsWith(workspacePath)) {
        pendingChanges.push({ path: event.path, event: event.event })

        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          pendingChanges.forEach((change) => {
            const eventType = change.event === 'create' ? 'create' : change.event === 'delete' ? 'delete' : 'update'
            directoryCacheService.handleFileChange(change.path, eventType)
          })
          pendingChanges = []
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
        success = await window.electronAPI.writeFile(fullPath, '')
      } else {
        success = await window.electronAPI.mkdir(fullPath)
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
      onClick: () => workspacePath && window.electronAPI.showItemInFolder(workspacePath),
    },
  ]

  return (
    <div className="h-full flex flex-col bg-background-secondary">
      <div className="h-10 px-3 flex items-center justify-between group border-b border-white/5 bg-transparent sticky top-0 z-10">
        <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider opacity-80">
          {t('explorer', language)}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip content={t('newFile', language)}>
            <Button variant="icon" size="icon" onClick={() => handleRootCreate('file')} className="w-6 h-6">
              <FilePlus className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('newFolder', language)}>
            <Button variant="icon" size="icon" onClick={() => handleRootCreate('folder')} className="w-6 h-6">
              <FolderPlus className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content={t('refresh', language)}>
            <Button variant="icon" size="icon" onClick={refreshFiles} className="w-6 h-6">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
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
            <div className="w-12 h-12 bg-surface-hover rounded-xl flex items-center justify-center mb-4 border border-white/5">
              <FolderOpen className="w-6 h-6 text-text-muted" />
            </div>
            <p className="text-sm text-text-muted mb-4 font-medium">{t('noFolderOpened', language)}</p>
            <Button
              onClick={handleOpenFolder}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent-hover transition-colors shadow-glow"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('openFolder', language)}
            </Button>
          </div>
        )}
      </div>

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

      {rootContextMenu && (
        <ContextMenu x={rootContextMenu.x} y={rootContextMenu.y} items={rootMenuItems} onClose={() => setRootContextMenu(null)} />
      )}
    </div>
  )
}
