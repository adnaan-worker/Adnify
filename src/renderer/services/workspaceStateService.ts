/**
 * 工作区状态持久化服务
 * 保存和恢复打开的文件、活动文件等状态
 * 
 * 数据通过 adnifyDir 服务统一管理
 */

import { useStore } from '../store'
import { adnifyDir, WorkspaceStateData } from './adnifyDirService'

/**
 * 保存工作区状态
 */
export async function saveWorkspaceState(): Promise<void> {
  const { openFiles, activeFilePath, expandedFolders } = useStore.getState()
  
  if (!adnifyDir.isInitialized()) return
  
  const state: WorkspaceStateData = {
    openFiles: openFiles.map((f: { path: string }) => f.path),
    activeFile: activeFilePath,
    expandedFolders: Array.from(expandedFolders),
    scrollPositions: {},
    cursorPositions: {},
  }
  
  await adnifyDir.saveWorkspaceState(state)
  console.log('[WorkspaceState] Saved:', state.openFiles.length, 'files')
}

/**
 * 恢复工作区状态
 */
export async function restoreWorkspaceState(): Promise<void> {
  const { openFile, setActiveFile, toggleFolder } = useStore.getState()
  
  if (!adnifyDir.isInitialized()) return
  
  const state = await adnifyDir.getWorkspaceState()
  if (!state.openFiles.length) {
    console.log('[WorkspaceState] No saved state')
    return
  }
  
  console.log('[WorkspaceState] Restoring:', state.openFiles.length, 'files')
  
  // 恢复展开的文件夹
  for (const folder of state.expandedFolders) {
    toggleFolder(folder)
  }
  
  // 恢复打开的文件
  for (const filePath of state.openFiles) {
    try {
      const fileContent = await window.electronAPI.readFile(filePath)
      if (fileContent !== null) {
        openFile(filePath, fileContent)
      }
    } catch {
      console.warn('[WorkspaceState] Failed to restore file:', filePath)
    }
  }
  
  // 恢复活动文件
  if (state.activeFile) {
    setActiveFile(state.activeFile)
  }
  
  console.log('[WorkspaceState] Restored successfully')
}

/**
 * 设置自动保存
 */
let saveTimeout: NodeJS.Timeout | null = null

export function scheduleStateSave(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  // 延迟 2 秒保存，避免频繁写入
  saveTimeout = setTimeout(() => {
    saveWorkspaceState()
  }, 2000)
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
        state.expandedFolders !== prevState.expandedFolders
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
