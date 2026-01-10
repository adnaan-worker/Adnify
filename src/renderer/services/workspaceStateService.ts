/**
 * 工作区状态持久化服务
 * 保存和恢复打开的文件、活动文件等状态
 * 
 * 数据通过 adnifyDir 服务统一管理
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getEditorConfig } from '@renderer/settings'
import { adnifyDir, WorkspaceStateData } from './adnifyDirService'

/**
 * 保存工作区状态
 */
export async function saveWorkspaceState(): Promise<void> {
  const { openFiles, activeFilePath, expandedFolders, sidebarWidth, chatWidth, terminalVisible, terminalLayout } = useStore.getState()

  if (!adnifyDir.isInitialized()) return

  const state: WorkspaceStateData = {
    openFiles: openFiles.map((f: { path: string }) => f.path),
    activeFile: activeFilePath,
    expandedFolders: Array.from(expandedFolders),
    scrollPositions: {},
    cursorPositions: {},
    layout: {
      sidebarWidth,
      chatWidth,
      terminalVisible,
      terminalLayout
    }
  }

  await adnifyDir.saveWorkspaceState(state)
  logger.system.info('[WorkspaceState] Saved:', state.openFiles.length, 'files')
}

/**
 * 恢复工作区状态
 */
export async function restoreWorkspaceState(): Promise<void> {
  const { openFile, setActiveFile, toggleFolder, setSidebarWidth, setChatWidth, setTerminalVisible, setTerminalLayout } = useStore.getState()

  if (!adnifyDir.isInitialized()) return

  const state = await adnifyDir.getWorkspaceState()
  if (!state.openFiles.length && !state.layout) {
    logger.system.info('[WorkspaceState] No saved state')
    return
  }

  logger.system.info('[WorkspaceState] Restoring:', state.openFiles.length, 'files')

  // 恢复展开的文件夹
  for (const folder of state.expandedFolders) {
    toggleFolder(folder)
  }

  // 恢复打开的文件
  for (const filePath of state.openFiles) {
    try {
      const fileContent = await api.file.read(filePath)
      if (fileContent !== null) {
        openFile(filePath, fileContent)
      }
    } catch {
      logger.system.warn('[WorkspaceState] Failed to restore file:', filePath)
    }
  }

  // 恢复活动文件
  if (state.activeFile) {
    setActiveFile(state.activeFile)
  }

  // 恢复布局
  if (state.layout) {
    setSidebarWidth(state.layout.sidebarWidth)
    setChatWidth(state.layout.chatWidth)
    setTerminalVisible(state.layout.terminalVisible)
    setTerminalLayout(state.layout.terminalLayout)
  }

  logger.system.info('[WorkspaceState] Restored successfully')
}

/**
 * 设置自动保存
 */
let saveTimeout: NodeJS.Timeout | null = null

export function scheduleStateSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  // 延迟保存，避免频繁写入
  saveTimeout = setTimeout(() => {
    saveWorkspaceState()
  }, getEditorConfig().performance.saveDebounceMs)
}

/**
 * 监听状态变化并自动保存
 */
export function initWorkspaceStateSync(): () => void {
  // 订阅 store 变化
  const unsubscribe = useStore.subscribe(
    (state, prevState) => {
      if (
        state.openFiles !== prevState.openFiles ||
        state.activeFilePath !== prevState.activeFilePath ||
        state.expandedFolders !== prevState.expandedFolders ||
        state.sidebarWidth !== prevState.sidebarWidth ||
        state.chatWidth !== prevState.chatWidth ||
        state.terminalVisible !== prevState.terminalVisible ||
        state.terminalLayout !== prevState.terminalLayout
      ) {
        scheduleStateSave()
      }
    }
  )

  // 窗口关闭前保存所有数据
  const handleBeforeUnload = async () => {
    await adnifyDir.flush()
  }
  window.addEventListener('beforeunload', handleBeforeUnload)

  return () => {
    unsubscribe()
    window.removeEventListener('beforeunload', handleBeforeUnload)
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
  }
}
