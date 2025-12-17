/**
 * .adnify 目录统一管理服务
 * 
 * 所有项目级数据都存储在 .adnify 目录下：
 * .adnify/
 *   ├── index/              # 代码库向量索引
 *   ├── sessions.json       # Agent 会话历史（包含检查点）
 *   ├── settings.json       # 项目级设置
 *   ├── workspace-state.json # 工作区状态（打开的文件等）
 *   └── rules.md            # 项目 AI 规则
 * 
 * 使用方法：
 *   import { adnifyDir } from './adnifyDirService'
 *   
 *   // 初始化（打开工作区时调用一次）
 *   await adnifyDir.initialize(workspacePath)
 *   
 *   // 读写数据
 *   const sessions = await adnifyDir.getSessions()
 *   await adnifyDir.saveSessions(sessions)
 *   
 *   // 切换工作区前
 *   await adnifyDir.flush()  // 保存所有缓存数据
 *   adnifyDir.reset()        // 重置服务
 */

// 目录名常量
export const ADNIFY_DIR_NAME = '.adnify'

// 子目录和文件
export const ADNIFY_FILES = {
  INDEX_DIR: 'index',
  SESSIONS: 'sessions.json',
  SETTINGS: 'settings.json',
  WORKSPACE_STATE: 'workspace-state.json',
  RULES: 'rules.md',
} as const

type AdnifyFile = typeof ADNIFY_FILES[keyof typeof ADNIFY_FILES]

// ============ 数据类型定义 ============

/** Agent 会话数据 */
export interface SessionsData {
  /** zustand store 数据 */
  'adnify-agent-store'?: {
    state: {
      threads: Record<string, unknown>
      currentThreadId: string | null
      autoApprove: {
        edits: boolean
        terminal: boolean
        dangerous: boolean
      }
    }
    version: number
  }
  /** 其他会话相关数据 */
  [key: string]: unknown
}

/** 工作区状态 */
export interface WorkspaceStateData {
  openFiles: string[]
  activeFile: string | null
  expandedFolders: string[]
  scrollPositions: Record<string, number>
  cursorPositions: Record<string, { line: number; column: number }>
}

/** 项目设置 */
export interface ProjectSettingsData {
  checkpointRetention: {
    maxCount: number
    maxAgeDays: number
    maxFileSizeKB: number
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    saveToFile: boolean
  }
  agent: {
    autoApproveReadOnly: boolean
    maxToolCallsPerTurn: number
  }
}

// ============ 默认值 ============

const DEFAULT_WORKSPACE_STATE: WorkspaceStateData = {
  openFiles: [],
  activeFile: null,
  expandedFolders: [],
  scrollPositions: {},
  cursorPositions: {},
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettingsData = {
  checkpointRetention: {
    maxCount: 50,
    maxAgeDays: 7,
    maxFileSizeKB: 100,
  },
  logging: {
    level: 'info',
    saveToFile: false,
  },
  agent: {
    autoApproveReadOnly: true,
    maxToolCallsPerTurn: 25,
  },
}

// ============ 服务实现 ============

class AdnifyDirService {
  private workspacePath: string | null = null
  private initialized = false
  
  // 内存缓存
  private cache: {
    sessions: SessionsData | null
    workspaceState: WorkspaceStateData | null
    settings: ProjectSettingsData | null
  } = {
    sessions: null,
    workspaceState: null,
    settings: null,
  }
  
  // 脏标记（标记哪些数据需要保存）
  private dirty: {
    sessions: boolean
    workspaceState: boolean
    settings: boolean
  } = {
    sessions: false,
    workspaceState: false,
    settings: false,
  }

  // ============ 初始化和重置 ============

  /**
   * 初始化 .adnify 目录
   */
  async initialize(workspacePath: string): Promise<boolean> {
    if (this.initialized && this.workspacePath === workspacePath) {
      return true
    }

    this.workspacePath = workspacePath
    
    try {
      const adnifyPath = this.getDirPath()
      const exists = await window.electronAPI.fileExists(adnifyPath)
      
      if (!exists) {
        const created = await window.electronAPI.ensureDir(adnifyPath)
        if (!created) {
          console.error('[AdnifyDir] Failed to create directory')
          return false
        }
      }

      // 创建 index 子目录
      const indexPath = this.getFilePath(ADNIFY_FILES.INDEX_DIR)
      const indexExists = await window.electronAPI.fileExists(indexPath)
      if (!indexExists) {
        await window.electronAPI.ensureDir(indexPath)
      }

      // 加载缓存数据
      await this.loadAllData()

      this.initialized = true
      console.log('[AdnifyDir] Initialized:', adnifyPath)
      return true
    } catch (error) {
      console.error('[AdnifyDir] Initialization failed:', error)
      return false
    }
  }

  /**
   * 重置服务（切换工作区时调用）
   */
  reset(): void {
    this.workspacePath = null
    this.initialized = false
    this.cache = { sessions: null, workspaceState: null, settings: null }
    this.dirty = { sessions: false, workspaceState: false, settings: false }
    console.log('[AdnifyDir] Reset')
  }

  /**
   * 保存所有脏数据到磁盘
   */
  async flush(): Promise<void> {
    if (!this.initialized) return

    const promises: Promise<void>[] = []
    
    if (this.dirty.sessions && this.cache.sessions) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.SESSIONS, this.cache.sessions))
      this.dirty.sessions = false
    }
    
    if (this.dirty.workspaceState && this.cache.workspaceState) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.WORKSPACE_STATE, this.cache.workspaceState))
      this.dirty.workspaceState = false
    }
    
    if (this.dirty.settings && this.cache.settings) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.SETTINGS, this.cache.settings))
      this.dirty.settings = false
    }

    await Promise.all(promises)
    console.log('[AdnifyDir] Flushed all data')
  }

  // ============ 状态查询 ============

  isInitialized(): boolean {
    return this.initialized && this.workspacePath !== null
  }

  getWorkspacePath(): string | null {
    return this.workspacePath
  }

  getDirPath(): string {
    if (!this.workspacePath) {
      throw new Error('[AdnifyDir] Not initialized')
    }
    return `${this.workspacePath}/${ADNIFY_DIR_NAME}`
  }

  getFilePath(file: AdnifyFile | string): string {
    return `${this.getDirPath()}/${file}`
  }

  // ============ Sessions 数据操作 ============

  async getSessions(): Promise<SessionsData> {
    if (this.cache.sessions) {
      return this.cache.sessions
    }
    
    if (!this.isInitialized()) {
      return {}
    }

    const data = await this.readJsonFile<SessionsData>(ADNIFY_FILES.SESSIONS)
    this.cache.sessions = data || {}
    return this.cache.sessions
  }

  async saveSessions(data: SessionsData): Promise<void> {
    this.cache.sessions = data
    this.dirty.sessions = true
    
    // 立即写入（会话数据重要）
    if (this.isInitialized()) {
      await this.writeJsonFile(ADNIFY_FILES.SESSIONS, data)
      this.dirty.sessions = false
    }
  }

  async updateSessionsPartial(key: string, value: unknown): Promise<void> {
    const sessions = await this.getSessions()
    sessions[key] = value
    await this.saveSessions(sessions)
  }

  // ============ WorkspaceState 数据操作 ============

  async getWorkspaceState(): Promise<WorkspaceStateData> {
    if (this.cache.workspaceState) {
      return this.cache.workspaceState
    }
    
    if (!this.isInitialized()) {
      return { ...DEFAULT_WORKSPACE_STATE }
    }

    const data = await this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE)
    this.cache.workspaceState = data || { ...DEFAULT_WORKSPACE_STATE }
    return this.cache.workspaceState
  }

  async saveWorkspaceState(data: WorkspaceStateData): Promise<void> {
    this.cache.workspaceState = data
    this.dirty.workspaceState = true
  }

  // ============ Settings 数据操作 ============

  async getSettings(): Promise<ProjectSettingsData> {
    if (this.cache.settings) {
      return this.cache.settings
    }
    
    if (!this.isInitialized()) {
      return { ...DEFAULT_PROJECT_SETTINGS }
    }

    const data = await this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS)
    this.cache.settings = data ? { ...DEFAULT_PROJECT_SETTINGS, ...data } : { ...DEFAULT_PROJECT_SETTINGS }
    return this.cache.settings
  }

  async saveSettings(data: ProjectSettingsData): Promise<void> {
    this.cache.settings = data
    this.dirty.settings = true
    
    // 立即写入
    if (this.isInitialized()) {
      await this.writeJsonFile(ADNIFY_FILES.SETTINGS, data)
      this.dirty.settings = false
    }
  }

  // ============ 通用文件操作 ============

  async readText(file: AdnifyFile | string): Promise<string | null> {
    if (!this.isInitialized()) return null

    try {
      return await window.electronAPI.readFile(this.getFilePath(file))
    } catch {
      return null
    }
  }

  async writeText(file: AdnifyFile | string, content: string): Promise<boolean> {
    if (!this.isInitialized()) return false

    try {
      return await window.electronAPI.writeFile(this.getFilePath(file), content)
    } catch (error) {
      console.error(`[AdnifyDir] Failed to write ${file}:`, error)
      return false
    }
  }

  async fileExists(file: AdnifyFile | string): Promise<boolean> {
    if (!this.isInitialized()) return false
    
    try {
      return await window.electronAPI.fileExists(this.getFilePath(file))
    } catch {
      return false
    }
  }

  async deleteFile(file: AdnifyFile | string): Promise<boolean> {
    if (!this.isInitialized()) return false

    try {
      return await window.electronAPI.deleteFile(this.getFilePath(file))
    } catch {
      return false
    }
  }

  // ============ 内部方法 ============

  private async loadAllData(): Promise<void> {
    // 并行加载所有数据
    const [sessions, workspaceState, settings] = await Promise.all([
      this.readJsonFile<SessionsData>(ADNIFY_FILES.SESSIONS),
      this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE),
      this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS),
    ])

    this.cache.sessions = sessions || {}
    this.cache.workspaceState = workspaceState || { ...DEFAULT_WORKSPACE_STATE }
    this.cache.settings = settings ? { ...DEFAULT_PROJECT_SETTINGS, ...settings } : { ...DEFAULT_PROJECT_SETTINGS }
    
    console.log('[AdnifyDir] Loaded all data from disk')
  }

  private async readJsonFile<T>(file: AdnifyFile): Promise<T | null> {
    try {
      const content = await window.electronAPI.readFile(this.getFilePath(file))
      if (!content) return null
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  private async writeJsonFile<T>(file: AdnifyFile, data: T): Promise<void> {
    try {
      const content = JSON.stringify(data, null, 2)
      await window.electronAPI.writeFile(this.getFilePath(file), content)
    } catch (error) {
      console.error(`[AdnifyDir] Failed to write ${file}:`, error)
    }
  }

  // ============ 兼容旧 API（逐步废弃） ============

  /** @deprecated 使用 getSessions/saveSessions */
  async readJson<T>(file: AdnifyFile): Promise<T | null> {
    return this.readJsonFile<T>(file)
  }

  /** @deprecated 使用 getSessions/saveSessions */
  async writeJson<T>(file: AdnifyFile, data: T): Promise<boolean> {
    try {
      await this.writeJsonFile(file, data)
      return true
    } catch {
      return false
    }
  }
}

// 单例导出
export const adnifyDir = new AdnifyDirService()

// 导出默认值供其他模块使用
export { DEFAULT_PROJECT_SETTINGS, DEFAULT_WORKSPACE_STATE }
