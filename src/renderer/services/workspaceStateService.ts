/**
 * 工作区状态持久化服务
 * 保存和恢复打开的文件、活动文件等状态
 * 数据存储在 .adnify/workspace-state.json
 */

import { useStore } from '../store'

interface WorkspaceState {
  openFiles: string[] // 打开的文件路径列表
  activeFilePath: string | null
  expandedFolders: string[]
  savedAt: number
}

const STATE_FILE = '.adnify/workspace-state.json'

/**
 * 保存工作区状态
 */
export async function saveWorkspaceState(): Promise<void> {
  const { workspacePath, openFiles, activeFilePath, expandedFolders } = useStore.getState()
  
  if (!workspacePath) return
  
  const state: WorkspaceState = {
    openFiles: openFiles.map(f => f.path),
    activeFilePath,
    expandedFolders: Array.from(expandedFolders),
    savedAt: Date.now(),
  }
  
  try {
    const statePath = `${workspacePath}/${STATE_FILE}`
    // 确保 .adnify 目录存在
    await window.electronAPI.ensureDir(`${workspacePath}/.adnify`)
    await window.electronAPI.writeFile(statePath, JSON.stringify(state, null, 2))
    console.log('[WorkspaceState] Saved:', state.openFiles.length, 'files')
  } catch (error) {
    console.error('[WorkspaceState] Failed to save:', error)
  }
}

/**
 * 恢复工作区状态
 */
export async function restoreWorkspaceState(): Promise<void> {
  const { workspacePath, openFile, setActiveFile, toggleFolder } = useStore.getState()
  
  if (!workspacePath) return
  
  try {
    const statePath = `${workspacePath}/${STATE_FILE}`
    const content = await window.electronAPI.readFile(statePath)
    
    if (!content) return
    
    const state: WorkspaceState = JSON.parse(content)
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
    if (state.activeFilePath) {
      setActiveFile(state.activeFilePath)
    }
    
    console.log('[WorkspaceState] Restored successfully')
  } catch (error) {
    // 文件不存在或解析失败，忽略
    console.log('[WorkspaceState] No saved state or failed to restore')
  }
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
      // 检测打开文件或活动文件变化
      if (
        state.openFiles !== prevState.openFiles ||
        state.activeFilePath !== prevState.activeFilePath ||
        state.expandedFolders !== prevState.expandedFolders
      ) {
        scheduleStateSave()
      }
    }
  )
  
  // 窗口关闭前保存
  const handleBeforeUnload = () => {
    saveWorkspaceState()
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
