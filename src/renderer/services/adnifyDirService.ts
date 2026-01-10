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
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { getEditorConfig } from '@renderer/settings'

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
  layout?: {
    sidebarWidth: number
    chatWidth: number
    terminalVisible: boolean
    terminalLayout: 'tabs' | 'split'
  }
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
  private primaryRoot: string | null = null
  private initializedRoots: Set<string> = new Set()
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

  // 脏标记
  private dirty: {
    sessions: boolean
    workspaceState: boolean
    settings: boolean
  } = {
      sessions: false,
      workspaceState: false,
      settings: false,
    }

  // 定时刷盘
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 初始化指定根目录的 .adnify 结构
   */
  async initialize(rootPath: string): Promise<boolean> {
    if (this.initializedRoots.has(rootPath)) return true

    try {
      const adnifyPath = `${rootPath}/${ADNIFY_DIR_NAME}`
      const exists = await api.file.exists(adnifyPath)

      if (!exists) {
        await api.file.ensureDir(adnifyPath)
      }

      // 创建 index 子目录
      const indexPath = `${adnifyPath}/${ADNIFY_FILES.INDEX_DIR}`
      const indexExists = await api.file.exists(indexPath)
      if (!indexExists) {
        await api.file.ensureDir(indexPath)
      }

      this.initializedRoots.add(rootPath)
      logger.system.info('[AdnifyDir] Root initialized:', rootPath)
      return true
    } catch (error) {
      logger.system.error('[AdnifyDir] Root initialization failed:', rootPath, error)
      return false
    }
  }

  /**
   * 设置主根目录（用于存储全局数据）
   */
  async setPrimaryRoot(rootPath: string): Promise<void> {
    if (this.primaryRoot === rootPath) return

    // 如果之前有主根目录，先保存数据
    if (this.primaryRoot) {
      await this.flush()
    }

    this.primaryRoot = rootPath
    await this.initialize(rootPath)
    await this.loadAllData()
    this.initialized = true
    logger.system.info('[AdnifyDir] Primary root set:', rootPath)
  }

  reset(): void {
    this.primaryRoot = null
    this.initializedRoots.clear()
    this.initialized = false
    this.cache = { sessions: null, workspaceState: null, settings: null }
    this.dirty = { sessions: false, workspaceState: false, settings: false }
    logger.system.info('[AdnifyDir] Reset')
  }

  async flush(): Promise<void> {
    // 取消待定的定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (!this.initialized || !this.primaryRoot) return

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

    if (promises.length > 0) {
      await Promise.all(promises)
      logger.system.info('[AdnifyDir] Flushed all dirty data')
    }
  }

  /**
   * 调度延迟刷盘（防抖）
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return // 已有待定刷盘
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush().catch(err => logger.system.error('[AdnifyDir] Flush error:', err))
    }, getEditorConfig().performance.flushIntervalMs)
  }

  isInitialized(): boolean {
    return this.initialized && this.primaryRoot !== null
  }

  getPrimaryRoot(): string | null {
    return this.primaryRoot
  }

  getDirPath(rootPath?: string): string {
    const targetRoot = rootPath || this.primaryRoot
    if (!targetRoot) {
      throw new Error('[AdnifyDir] Not initialized')
    }
    return `${targetRoot}/${ADNIFY_DIR_NAME}`
  }

  getFilePath(file: AdnifyFile | string, rootPath?: string): string {
    return `${this.getDirPath(rootPath)}/${file}`
  }

  // ============ 数据操作 (基于 Primary Root) ============

  async getSessions(): Promise<SessionsData> {
    if (this.cache.sessions) return this.cache.sessions
    if (!this.isInitialized()) return {}
    const data = await this.readJsonFile<SessionsData>(ADNIFY_FILES.SESSIONS)
    this.cache.sessions = data || {}
    return this.cache.sessions
  }

  /**
   * 保存 sessions（立即写入，用于关键操作）
   */
  async saveSessions(data: SessionsData): Promise<void> {
    this.cache.sessions = data
    this.dirty.sessions = true
    if (this.isInitialized()) {
      await this.writeJsonFile(ADNIFY_FILES.SESSIONS, data)
      this.dirty.sessions = false
    }
  }

  /**
   * 更新 sessions 部分数据（立即写入，用于关键操作）
   */
  async updateSessionsPartial(key: string, value: unknown): Promise<void> {
    const sessions = await this.getSessions()
    sessions[key] = value
    await this.saveSessions(sessions)
  }

  /**
   * 设置 sessions 部分数据为脏（延迟写入，用于频繁更新）
   * 这是推荐的高频更新方法
   */
  setSessionsPartialDirty(key: string, value: unknown): void {
    if (!this.cache.sessions) {
      this.cache.sessions = {}
    }
    this.cache.sessions[key] = value
    this.dirty.sessions = true
    this.scheduleFlush()
  }

  async getWorkspaceState(): Promise<WorkspaceStateData> {
    if (this.cache.workspaceState) return this.cache.workspaceState
    if (!this.isInitialized()) return { ...DEFAULT_WORKSPACE_STATE }
    const data = await this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE)
    this.cache.workspaceState = data || { ...DEFAULT_WORKSPACE_STATE }
    return this.cache.workspaceState
  }

  async saveWorkspaceState(data: WorkspaceStateData): Promise<void> {
    this.cache.workspaceState = data
    this.dirty.workspaceState = true
  }

  async getSettings(): Promise<ProjectSettingsData> {
    if (this.cache.settings) return this.cache.settings
    if (!this.isInitialized()) return { ...DEFAULT_PROJECT_SETTINGS }
    const data = await this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS)
    this.cache.settings = data ? { ...DEFAULT_PROJECT_SETTINGS, ...data } : { ...DEFAULT_PROJECT_SETTINGS }
    return this.cache.settings
  }

  async saveSettings(data: ProjectSettingsData): Promise<void> {
    this.cache.settings = data
    this.dirty.settings = true
    if (this.isInitialized()) {
      await this.writeJsonFile(ADNIFY_FILES.SETTINGS, data)
      this.dirty.settings = false
    }
  }

  // ============ 通用文件操作 ============

  async readText(file: AdnifyFile | string, rootPath?: string): Promise<string | null> {
    try {
      return await api.file.read(this.getFilePath(file, rootPath))
    } catch {
      return null
    }
  }

  async writeText(file: AdnifyFile | string, content: string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.write(this.getFilePath(file, rootPath), content)
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write ${file}:`, error)
      return false
    }
  }

  async fileExists(file: AdnifyFile | string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.exists(this.getFilePath(file, rootPath))
    } catch {
      return false
    }
  }

  async deleteFile(file: AdnifyFile | string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.delete(this.getFilePath(file, rootPath))
    } catch {
      return false
    }
  }

  // ============ 内部方法 ============

  private async loadAllData(): Promise<void> {
    const [sessions, workspaceState, settings] = await Promise.all([
      this.readJsonFile<SessionsData>(ADNIFY_FILES.SESSIONS),
      this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE),
      this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS),
    ])
    this.cache.sessions = sessions || {}
    this.cache.workspaceState = workspaceState || { ...DEFAULT_WORKSPACE_STATE }
    this.cache.settings = settings ? { ...DEFAULT_PROJECT_SETTINGS, ...settings } : { ...DEFAULT_PROJECT_SETTINGS }
    logger.system.info('[AdnifyDir] Loaded all data from disk')
  }

  private async readJsonFile<T>(file: AdnifyFile): Promise<T | null> {
    try {
      const content = await api.file.read(this.getFilePath(file))
      if (!content) return null
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  private async writeJsonFile<T>(file: AdnifyFile, data: T): Promise<void> {
    try {
      const content = JSON.stringify(data, null, 2)
      await api.file.write(this.getFilePath(file), content)
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write ${file}:`, error)
    }
  }
}

export const adnifyDir = new AdnifyDirService()
export { DEFAULT_PROJECT_SETTINGS, DEFAULT_WORKSPACE_STATE }
