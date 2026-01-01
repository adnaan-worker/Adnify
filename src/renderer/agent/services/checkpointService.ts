/**
 * 检查点服务 - 支持文件状态回滚
 * 
 * 数据存储在项目目录 .adnify/sessions.json
 * 支持配置保留策略（数量、时间、文件大小限制）
 */

import { logger } from '@utils/Logger'
import { Checkpoint, FileSnapshot } from '../types'
import { adnifyDir, DEFAULT_PROJECT_SETTINGS } from '@services/adnifyDirService'
import { useStore } from '@store'

/** 检查点数据结构 */
interface CheckpointData {
  checkpoints: Checkpoint[]
  currentIdx: number
}

class CheckpointService {
  private checkpoints: Checkpoint[] = []
  private currentIdx: number = -1
  private autoSaveEnabled: boolean = true
  private isLoaded: boolean = false
  
  // 保留策略配置
  private maxCheckpoints: number = DEFAULT_PROJECT_SETTINGS.checkpointRetention.maxCount
  private maxAgeDays: number = DEFAULT_PROJECT_SETTINGS.checkpointRetention.maxAgeDays
  private maxFileSizeKB: number = DEFAULT_PROJECT_SETTINGS.checkpointRetention.maxFileSizeKB

  constructor() {
    // 延迟加载，等待 workspacePath 设置
  }

  /**
   * 初始化 - 从项目目录加载检查点
   */
  async init(): Promise<void> {
    if (this.isLoaded) return
    
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return
    
    // 加载保留策略配置
    const settings = await adnifyDir.getSettings()
    this.maxCheckpoints = settings.checkpointRetention.maxCount
    this.maxAgeDays = settings.checkpointRetention.maxAgeDays
    this.maxFileSizeKB = settings.checkpointRetention.maxFileSizeKB
    
    // 加载检查点数据
    const sessions = await adnifyDir.getSessions()
    const data = sessions['checkpoints'] as CheckpointData | undefined
    if (data) {
      this.checkpoints = data.checkpoints
      this.currentIdx = data.currentIdx ?? this.checkpoints.length - 1
      
      // 清理过期检查点
      this.cleanupOldCheckpoints()
      
      logger.agent.info(`[Checkpoint] Loaded ${this.checkpoints.length} checkpoints from project`)
    }
    
    this.isLoaded = true
  }

  /**
   * 清理过期检查点
   */
  private cleanupOldCheckpoints(): void {
    const now = Date.now()
    const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000
    
    const before = this.checkpoints.length
    this.checkpoints = this.checkpoints.filter(cp => {
      return (now - cp.timestamp) < maxAge
    })
    
    if (this.checkpoints.length < before) {
      logger.agent.info(`[Checkpoint] Cleaned up ${before - this.checkpoints.length} old checkpoints`)
      this.currentIdx = Math.min(this.currentIdx, this.checkpoints.length - 1)
      this.saveToStorage()
    }
  }

  /**
   * 保存检查点到项目目录
   */
  private async saveToStorage(): Promise<void> {
    if (!this.autoSaveEnabled) return
    
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return
    
    const data: CheckpointData = {
      checkpoints: this.checkpoints,
      currentIdx: this.currentIdx,
    }
    
    try {
      await adnifyDir.updateSessionsPartial('checkpoints', data)
    } catch {
      logger.agent.warn('[Checkpoint] Failed to save to project storage')
    }
  }

  /**
   * 启用/禁用自动保存
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled
  }

  /**
   * 创建检查点前获取文件快照
   */
  async createSnapshot(filePath: string): Promise<FileSnapshot | null> {
    try {
      const content = await window.electronAPI.readFile(filePath)
      
      // 检查文件大小限制（如果文件存在）
      if (content !== null) {
        const sizeKB = content.length / 1024
        if (sizeKB > this.maxFileSizeKB) {
          logger.agent.warn(`[Checkpoint] File too large (${sizeKB.toFixed(1)}KB), skipping: ${filePath}`)
          return null
        }
      }

      return {
        path: filePath,
        content,
        timestamp: Date.now(),
      }
    } catch {
      return null
    }
  }

  /**
   * 创建新检查点
   */
  async createCheckpoint(
    type: 'user_message' | 'tool_edit',
    description: string,
    filePaths: string[],
    messageId?: string
  ): Promise<Checkpoint> {
    // 确保已初始化
    await this.init()
    
    const snapshots: Record<string, FileSnapshot> = {}
    const maxSnapshots = 20

    // 只保存前 N 个文件的快照
    const pathsToSnapshot = filePaths.slice(0, maxSnapshots)

    for (const path of pathsToSnapshot) {
      const snapshot = await this.createSnapshot(path)
      if (snapshot) {
        snapshots[path] = snapshot
      }
    }

    const checkpoint: Checkpoint = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      snapshots,
      description,
      messageId,
    }

    // 如果当前不在最新位置，删除后面的检查点
    if (this.currentIdx < this.checkpoints.length - 1) {
      this.checkpoints = this.checkpoints.slice(0, this.currentIdx + 1)
    }

    this.checkpoints.push(checkpoint)
    this.currentIdx = this.checkpoints.length - 1

    // 限制检查点数量
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints = this.checkpoints.slice(-this.maxCheckpoints)
      this.currentIdx = this.checkpoints.length - 1
    }

    // 保存到项目目录
    await this.saveToStorage()

    return checkpoint
  }

  /**
   * 获取所有检查点
   */
  getCheckpoints(): Checkpoint[] {
    return [...this.checkpoints]
  }

  /**
   * 获取当前检查点索引
   */
  getCurrentIndex(): number {
    return this.currentIdx
  }

  /**
   * 根据消息 ID 获取检查点
   */
  getCheckpointByMessageId(messageId: string): Checkpoint | undefined {
    return this.checkpoints.find(cp => cp.messageId === messageId)
  }

  /**
   * 回滚到指定检查点
   */
  async rollbackTo(checkpointId: string): Promise<{
    success: boolean
    restoredFiles: string[]
    errors: string[]
  }> {
    const idx = this.checkpoints.findIndex(c => c.id === checkpointId)
    if (idx === -1) {
      return { success: false, restoredFiles: [], errors: ['Checkpoint not found'] }
    }

    const checkpoint = this.checkpoints[idx]
    const restoredFiles: string[] = []
    const errors: string[] = []

    for (const [path, snapshot] of Object.entries(checkpoint.snapshots)) {
      try {
        if (snapshot.content === null) {
          // 文件原本不存在，删除它
          const deleted = await window.electronAPI.deleteFile(path)
          if (deleted) {
            restoredFiles.push(path)
          } else {
            errors.push(`Failed to delete: ${path}`)
          }
        } else {
          const success = await window.electronAPI.writeFile(path, snapshot.content)
          if (success) {
            restoredFiles.push(path)
          } else {
            errors.push(`Failed to restore: ${path}`)
          }
        }
      } catch (e: unknown) {
        const err = e as { message?: string }
        errors.push(`Error restoring ${path}: ${err.message}`)
      }
    }

    this.currentIdx = idx

    // 保存状态
    await this.saveToStorage()

    return {
      success: errors.length === 0,
      restoredFiles,
      errors,
    }
  }

  /**
   * 回滚到上一个检查点
   */
  async rollbackToPrevious(): Promise<{
    success: boolean
    checkpoint: Checkpoint | null
    restoredFiles: string[]
    errors: string[]
  }> {
    if (this.currentIdx <= 0) {
      return {
        success: false,
        checkpoint: null,
        restoredFiles: [],
        errors: ['No previous checkpoint available'],
      }
    }

    const prevCheckpoint = this.checkpoints[this.currentIdx - 1]
    const result = await this.rollbackTo(prevCheckpoint.id)

    return {
      ...result,
      checkpoint: prevCheckpoint,
    }
  }

  /**
   * 获取文件在指定检查点的内容
   */
  getFileAtCheckpoint(checkpointId: string, filePath: string): string | null {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId)
    if (!checkpoint) return null

    return checkpoint.snapshots[filePath]?.content ?? null
  }

  /**
   * 获取两个检查点之间的文件变化
   */
  getChangesBetween(
    fromCheckpointId: string,
    toCheckpointId: string
  ): { path: string; type: 'added' | 'modified' | 'deleted' }[] {
    const fromIdx = this.checkpoints.findIndex(c => c.id === fromCheckpointId)
    const toIdx = this.checkpoints.findIndex(c => c.id === toCheckpointId)

    if (fromIdx === -1 || toIdx === -1) return []

    const fromCheckpoint = this.checkpoints[fromIdx]
    const toCheckpoint = this.checkpoints[toIdx]

    const changes: { path: string; type: 'added' | 'modified' | 'deleted' }[] = []
    const allPaths = new Set([
      ...Object.keys(fromCheckpoint.snapshots),
      ...Object.keys(toCheckpoint.snapshots),
    ])

    for (const path of allPaths) {
      const fromSnapshot = fromCheckpoint.snapshots[path]
      const toSnapshot = toCheckpoint.snapshots[path]

      if (!fromSnapshot && toSnapshot) {
        changes.push({ path, type: 'added' })
      } else if (fromSnapshot && !toSnapshot) {
        changes.push({ path, type: 'deleted' })
      } else if (fromSnapshot && toSnapshot && fromSnapshot.content !== toSnapshot.content) {
        changes.push({ path, type: 'modified' })
      }
    }

    return changes
  }

  /**
   * 清除所有检查点
   */
  async clear(): Promise<void> {
    this.checkpoints = []
    this.currentIdx = -1
    await this.saveToStorage()
  }

  /**
   * 重置（切换项目时调用）
   */
  reset(): void {
    this.checkpoints = []
    this.currentIdx = -1
    this.isLoaded = false
  }
}

// 单例导出
export const checkpointService = new CheckpointService()
