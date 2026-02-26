/**
 * .adnify 目录统一管理服务
 * 
 * 所有项目级数据都存储在 .adnify 目录下：
 * .adnify/
 *   ├── index/              # 代码库向量索引
 *   ├── sessions/           # Agent 会话（按线程拆分）
 *   │   ├── _meta.json      # 线程元数据（currentThreadId, threadIds）
 *   │   └── {threadId}.json # 单个线程数据
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
  SESSIONS_DIR: 'sessions',
  SETTINGS: 'settings.json',
  WORKSPACE_STATE: 'workspace-state.json',
  RULES: 'rules.md',
} as const

type AdnifyFile = typeof ADNIFY_FILES[keyof typeof ADNIFY_FILES]

// ============ 数据类型定义 ============

/** 线程元数据 */
export interface SessionMeta {
  currentThreadId: string | null
  threadIds: string[]
  /** 非线程数据（branches, messageCheckpoints 等） */
  extra: Record<string, unknown>
  version: number
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

const DEFAULT_SESSION_META: SessionMeta = {
  currentThreadId: null,
  threadIds: [],
  extra: {},
  version: 0,
}

// ============ 服务实现 ============

class AdnifyDirService {
  private primaryRoot: string | null = null
  private initializedRoots: Set<string> = new Set()
  private initialized = false

  // 内存缓存
  private cache: {
    sessionMeta: SessionMeta | null
    threads: Map<string, unknown>
    workspaceState: WorkspaceStateData | null
    settings: ProjectSettingsData | null
  } = {
      sessionMeta: null,
      threads: new Map(),
      workspaceState: null,
      settings: null,
    }

  // 脏标记
  private dirty: {
    sessionMeta: boolean
    dirtyThreads: Set<string>
    workspaceState: boolean
    settings: boolean
  } = {
      sessionMeta: false,
      dirtyThreads: new Set(),
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

      // 创建 sessions 子目录
      const sessionsPath = `${adnifyPath}/${ADNIFY_FILES.SESSIONS_DIR}`
      const sessionsExists = await api.file.exists(sessionsPath)
      if (!sessionsExists) {
        await api.file.ensureDir(sessionsPath)
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
    await this.migrateOldSessions()
    await this.loadAllData()
    this.initialized = true
    logger.system.info('[AdnifyDir] Primary root set:', rootPath)
  }

  reset(): void {
    this.primaryRoot = null
    this.initializedRoots.clear()
    this.initialized = false
    this.cache = { sessionMeta: null, threads: new Map(), workspaceState: null, settings: null }
    this.dirty = { sessionMeta: false, dirtyThreads: new Set(), workspaceState: false, settings: false }
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

    // 刷新 session meta
    if (this.dirty.sessionMeta && this.cache.sessionMeta) {
      promises.push(this.writeSessionFile('_meta.json', this.cache.sessionMeta))
      this.dirty.sessionMeta = false
    }

    // 刷新 dirty 线程（只写变化的）
    for (const threadId of this.dirty.dirtyThreads) {
      const data = this.cache.threads.get(threadId)
      if (data) {
        promises.push(this.writeSessionFile(`${threadId}.json`, data))
      }
    }
    this.dirty.dirtyThreads.clear()

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

  // ============ Session 操作（线程级别） ============

  async getSessionMeta(): Promise<SessionMeta> {
    if (this.cache.sessionMeta) return this.cache.sessionMeta
    if (!this.isInitialized()) return { ...DEFAULT_SESSION_META }
    const data = await this.readSessionFile<SessionMeta>('_meta.json')
    this.cache.sessionMeta = data || { ...DEFAULT_SESSION_META }
    return this.cache.sessionMeta
  }

  async getThreadData(threadId: string): Promise<unknown | null> {
    if (this.cache.threads.has(threadId)) return this.cache.threads.get(threadId)!
    if (!this.isInitialized()) return null
    const data = await this.readSessionFile<unknown>(`${threadId}.json`)
    if (data) {
      this.cache.threads.set(threadId, data)
    }
    return data
  }

  /**
   * 设置线程数据为脏（延迟写入）
   * 这是 agentStorage 调用的主入口
   */
  setThreadDirty(threadId: string, data: unknown): void {
    this.cache.threads.set(threadId, data)
    this.dirty.dirtyThreads.add(threadId)
    this.scheduleFlush()
  }

  /**
   * 设置 session meta 为脏（延迟写入）
   */
  setSessionMetaDirty(meta: SessionMeta): void {
    this.cache.sessionMeta = meta
    this.dirty.sessionMeta = true
    this.scheduleFlush()
  }

  /**
   * 删除线程数据文件
   */
  async deleteThreadData(threadId: string): Promise<void> {
    this.cache.threads.delete(threadId)
    this.dirty.dirtyThreads.delete(threadId)

    // 更新 meta
    const meta = await this.getSessionMeta()
    meta.threadIds = meta.threadIds.filter(id => id !== threadId)
    this.setSessionMetaDirty(meta)

    // 删除文件
    if (this.isInitialized()) {
      try {
        const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${threadId}.json`
        await api.file.delete(filePath)
      } catch { /* ignore */ }
    }
  }

  /**
   * 清除所有 session 数据
   */
  async clearAllSessions(): Promise<void> {
    const meta = await this.getSessionMeta()
    for (const threadId of meta.threadIds) {
      this.cache.threads.delete(threadId)
      try {
        const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${threadId}.json`
        await api.file.delete(filePath)
      } catch { /* ignore */ }
    }
    this.cache.sessionMeta = { ...DEFAULT_SESSION_META }
    this.dirty.sessionMeta = true
    this.dirty.dirtyThreads.clear()
    await this.writeSessionFile('_meta.json', this.cache.sessionMeta)
  }

  /**
   * 兼容方法：供 agentStorage 使用
   * 从线程级文件构建完整的 store persist 数据
   */
  async getFullSessionData(): Promise<Record<string, unknown> | null> {
    const meta = await this.getSessionMeta()
    if (meta.threadIds.length === 0 && !meta.currentThreadId) return null

    const threads: Record<string, unknown> = {}
    for (const threadId of meta.threadIds) {
      const data = await this.getThreadData(threadId)
      if (data) threads[threadId] = data
    }

    return {
      state: {
        threads,
        currentThreadId: meta.currentThreadId,
        ...meta.extra,
      },
      version: meta.version,
    }
  }

  /**
   * 兼容方法：供 agentStorage 使用
   * 将完整 store persist 数据拆分到线程级文件
   */
  setFullSessionDataDirty(_storeKey: string, parsed: Record<string, unknown>): void {
    const state = parsed.state as Record<string, unknown> | undefined
    if (!state) return

    const threads = (state.threads || {}) as Record<string, unknown>
    const currentThreadId = state.currentThreadId as string | null
    const { threads: _, currentThreadId: __, ...extra } = state

    // 更新 meta
    const threadIds = Object.keys(threads)
    const meta: SessionMeta = {
      currentThreadId,
      threadIds,
      extra,
      version: (parsed.version as number) || 0,
    }
    this.setSessionMetaDirty(meta)

    // 标记变化的线程为 dirty
    for (const [threadId, data] of Object.entries(threads)) {
      const cached = this.cache.threads.get(threadId)
      // 只在数据有变化时才标记（简单引用比较）
      if (cached !== data) {
        this.setThreadDirty(threadId, data)
      }
    }

    // 清理已删除的线程缓存
    for (const cachedId of this.cache.threads.keys()) {
      if (!threads[cachedId]) {
        this.cache.threads.delete(cachedId)
      }
    }
  }

  // ============ workspace / settings 操作 ============

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

  /**
   * 旧 sessions.json → 新 sessions/ 目录迁移
   */
  private async migrateOldSessions(): Promise<void> {
    if (!this.primaryRoot) return

    const oldPath = `${this.getDirPath()}/sessions.json`
    try {
      const exists = await api.file.exists(oldPath)
      if (!exists) return

      const content = await api.file.read(oldPath)
      if (!content) return

      const oldData = JSON.parse(content)

      // 旧格式：{ 'adnify-agent-store': { state: { threads, currentThreadId }, version } }
      const storeData = oldData['adnify-agent-store']
      if (!storeData?.state?.threads) {
        // 无有效数据，删除旧文件
        await api.file.delete(oldPath)
        return
      }

      const { threads, currentThreadId, ...extra } = storeData.state as Record<string, unknown>
      const threadsMap = threads as Record<string, unknown>
      const threadIds = Object.keys(threadsMap)

      // 写入各线程文件
      for (const [threadId, data] of Object.entries(threadsMap)) {
        await this.writeSessionFile(`${threadId}.json`, data)
      }

      // 写入 meta
      const meta: SessionMeta = {
        currentThreadId: currentThreadId as string | null,
        threadIds,
        extra,
        version: storeData.version || 0,
      }
      await this.writeSessionFile('_meta.json', meta)

      // 删除旧文件
      await api.file.delete(oldPath)
      logger.system.info(`[AdnifyDir] Migrated sessions.json → sessions/ (${threadIds.length} threads)`)
    } catch (error) {
      logger.system.error('[AdnifyDir] Sessions migration failed:', error)
    }
  }

  private async loadAllData(): Promise<void> {
    const [sessionMeta, workspaceState, settings] = await Promise.all([
      this.readSessionFile<SessionMeta>('_meta.json'),
      this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE),
      this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS),
    ])
    this.cache.sessionMeta = sessionMeta || { ...DEFAULT_SESSION_META }
    this.cache.workspaceState = workspaceState || { ...DEFAULT_WORKSPACE_STATE }
    this.cache.settings = settings ? { ...DEFAULT_PROJECT_SETTINGS, ...settings } : { ...DEFAULT_PROJECT_SETTINGS }
    logger.system.info('[AdnifyDir] Loaded all data from disk')
  }

  private async readSessionFile<T>(fileName: string): Promise<T | null> {
    try {
      const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${fileName}`
      const content = await api.file.read(filePath)
      if (!content) return null
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  private async writeSessionFile<T>(fileName: string, data: T): Promise<void> {
    try {
      const filePath = `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}/${fileName}`
      const content = JSON.stringify(data, null, 2)
      await api.file.write(filePath, content)
    } catch (error) {
      logger.system.error(`[AdnifyDir] Failed to write session file ${fileName}:`, error)
    }
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
