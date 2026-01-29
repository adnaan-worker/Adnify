/**
 * 工作区管理器
 * 
 * 统一管理工作区的切换、状态保存和加载
 * 确保多窗口场景下数据隔离正确
 * 
 * 设计原则：
 * 1. 单一数据源：useStore.workspace 是唯一的工作区状态
 * 2. 统一入口：所有工作区操作都通过此服务
 * 3. 原子操作：切换是原子的，要么完全成功，要么回滚
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore } from '@renderer/agent/store/AgentStore'
import { adnifyDir } from './adnifyDirService'
import { mcpService } from './mcpService'
import { gitService } from '@renderer/agent/services/gitService'
import { resetLspState } from './lspService'
import { clearExtraLibs } from './monacoTypeService'
import { lintService } from '@renderer/agent/services/lintService'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { clearHealthCache } from './healthCheckService'
import { toAppError } from '@shared/utils/errorHandler'
import type { WorkspaceConfig } from '@store'

class WorkspaceManager {
  private switching = false
  
  /**
   * 获取当前工作区路径（主根目录）
   */
  getCurrentWorkspacePath(): string | null {
    return useStore.getState().workspacePath
  }
  
  /**
   * 获取当前工作区配置
   */
  getCurrentWorkspace(): WorkspaceConfig | null {
    return useStore.getState().workspace
  }
  
  /**
   * 检查是否正在切换工作区
   */
  isSwitching(): boolean {
    return this.switching
  }

  /**
   * 切换到新工作区
   * 这是唯一的工作区切换入口
   */
  async switchTo(newWorkspace: WorkspaceConfig): Promise<boolean> {
    if (this.switching) {
      logger.system.warn('[WorkspaceManager] Already switching, ignoring request')
      return false
    }
    
    const oldWorkspace = this.getCurrentWorkspace()
    
    // 如果是同一个工作区，不需要切换
    if (this.isSameWorkspace(oldWorkspace, newWorkspace)) {
      logger.system.info('[WorkspaceManager] Same workspace, skipping switch')
      return true
    }
    
    this.switching = true
    logger.system.info('[WorkspaceManager] Switching workspace:', {
      from: oldWorkspace?.roots[0] || 'none',
      to: newWorkspace.roots[0] || 'none'
    })
    
    try {
      // 1. 先检查是否已在其他窗口打开（在做任何状态变更之前）
      if (newWorkspace.roots.length > 0) {
        const result = await api.workspace.setActive(newWorkspace.roots)
        // 如果返回 redirected，说明已聚焦到其他窗口，关闭当前窗口
        if (result && typeof result === 'object' && 'redirected' in result) {
          logger.system.info('[WorkspaceManager] Workspace already open in another window, closing this window')
          this.switching = false
          // 关闭当前窗口
          api.window.close()
          return false
        }
      }
      
      // 2. 保存当前工作区数据
      await this.saveCurrentWorkspace()
      
      // 3. 重置所有状态
      this.resetAllStates()
      
      // 4. 切换到新工作区
      await this.loadNewWorkspace(newWorkspace)
      
      // 5. 如果是从空窗口切换，调整窗口大小
      if (!oldWorkspace || oldWorkspace.roots.length === 0) {
        await api.window.resize(1600, 1000, 1200, 700)
      }
      
      logger.system.info('[WorkspaceManager] Switch completed successfully')
      return true
    } catch (err) {
      const error = toAppError(err)
      logger.system.error(`[WorkspaceManager] Switch failed: ${error.code}`, error)
      // 尝试恢复到旧工作区
      if (oldWorkspace) {
        try {
          await this.loadNewWorkspace(oldWorkspace)
        } catch {
          // 恢复也失败了，只能清空
          this.resetAllStates()
        }
      }
      return false
    } finally {
      this.switching = false
    }
  }
  
  /**
   * 打开文件夹作为工作区
   * @throws Error 如果文件夹不存在
   */
  async openFolder(folderPath: string): Promise<boolean> {
    // 检查路径是否存在
    const exists = await api.file.exists(folderPath)
    if (!exists) {
      // 从最近列表中移除
      await api.workspace.removeFromRecent(folderPath)
      throw new Error(`文件夹不存在: ${folderPath}`)
    }
    return this.switchTo({
      configPath: null,
      roots: [folderPath]
    })
  }
  
  /**
   * 关闭当前工作区
   */
  async closeWorkspace(): Promise<void> {
    await this.saveCurrentWorkspace()
    this.resetAllStates()
    
    const { setWorkspace, setFiles } = useStore.getState()
    setWorkspace(null)
    setFiles([])
    
    adnifyDir.reset()
  }
  
  /**
   * 添加文件夹到当前工作区
   */
  async addFolder(folderPath: string): Promise<void> {
    const { addRoot } = useStore.getState()
    addRoot(folderPath)
    
    // 初始化新文件夹的 .adnify 目录
    await adnifyDir.initialize(folderPath)
  }
  
  /**
   * 从当前工作区移除文件夹
   */
  removeFolder(folderPath: string): void {
    const { removeRoot } = useStore.getState()
    removeRoot(folderPath)
  }
  
  // =================== 私有方法 ===================
  
  /**
   * 检查两个工作区是否相同
   */
  private isSameWorkspace(a: WorkspaceConfig | null, b: WorkspaceConfig | null): boolean {
    if (!a && !b) return true
    if (!a || !b) return false
    if (a.roots.length !== b.roots.length) return false
    
    const normalizeRoots = (roots: string[]) => 
      roots.map(r => r.toLowerCase().replace(/\\/g, '/')).sort()
    
    const aRoots = normalizeRoots(a.roots)
    const bRoots = normalizeRoots(b.roots)
    
    return aRoots.every((root, i) => root === bRoots[i])
  }
  
  /**
   * 保存当前工作区数据
   */
  private async saveCurrentWorkspace(): Promise<void> {
    if (!adnifyDir.isInitialized()) return
    
    logger.system.info('[WorkspaceManager] Saving current workspace data...')
    await adnifyDir.flush()
  }
  
  /**
   * 重置所有状态
   */
  private resetAllStates(): void {
    logger.system.info('[WorkspaceManager] Resetting all states...')
    
    // 重置文件编辑器状态
    useStore.setState({
      openFiles: [],
      activeFilePath: null,
      expandedFolders: new Set(),
      selectedFolderPath: null,
    })
    
    // 重置 AgentStore（对话、线程等）
    useAgentStore.setState({
      // ThreadSlice
      threads: {},
      currentThreadId: null,
      
      // MessageSlice
      pendingChanges: [],
      
      // CheckpointSlice
      messageCheckpoints: [],
      
      // PlanSlice
      plan: null,
      
      // StreamSlice
      streamState: {
        phase: 'idle',
        currentToolCall: undefined,
        error: undefined,
      },
      
      // BranchSlice
      branches: {},
      activeBranchId: {},
      
      // ContextSummaryState
      contextSummary: null,
      isCompacting: false,
      
      // UIState
      contextStats: null,
      inputPrompt: '',
      currentSessionId: null,
    })
    
    // 重置工具调用日志
    useStore.getState().clearToolCallLogs()
    
    // 重置 LSP 状态（文档版本追踪等）
    resetLspState()
    
    // 清理 Monaco extraLib 缓存
    clearExtraLibs()
    
    // 清理 Lint 服务缓存
    lintService.clearCache()
    
    // 清理流式编辑状态
    streamingEditService.clearAll()
    
    // 清理健康检查缓存
    clearHealthCache()
    
    // 重置 adnifyDir
    adnifyDir.reset()
  }
  
  /**
   * 加载新工作区
   */
  private async loadNewWorkspace(workspace: WorkspaceConfig): Promise<void> {
    const { setWorkspace, setFiles } = useStore.getState()
    
    // 1. 设置工作区状态
    setWorkspace(workspace)
    
    if (workspace.roots.length === 0) {
      setFiles([])
      gitService.setWorkspace(null)
      return
    }
    
    const primaryRoot = workspace.roots[0]
    
    // 2. 初始化 adnifyDir
    await adnifyDir.setPrimaryRoot(primaryRoot)
    
    // 3. 设置 gitService 工作区
    gitService.setWorkspace(primaryRoot)
    
    // 4. 加载文件列表
    try {
      const items = await api.file.readDir(primaryRoot)
      setFiles(items)
    } catch (err) {
      const error = toAppError(err)
      logger.system.error(`[WorkspaceManager] Failed to read directory: ${error.code}`, error)
      setFiles([])
    }
    
    // 5. 重新加载 AgentStore 持久化数据
    const store = useAgentStore as typeof useAgentStore & {
      persist?: { rehydrate: () => Promise<void> }
    }
    if (store.persist) {
      await store.persist.rehydrate()
      logger.agent.info('[WorkspaceManager] Agent store rehydrated')
    }
    
    // 6. 初始化 MCP 服务
    await mcpService.initialize(workspace.roots)
  }
}

// 导出单例
export const workspaceManager = new WorkspaceManager()
