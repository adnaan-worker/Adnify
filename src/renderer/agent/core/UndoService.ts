/**
 * Undo 服务
 * 管理文件快照，支持撤销 Agent 的更改
 * 
 * 与 AgentStore 的 checkpoint 消息配合使用：
 * - checkpoint 消息存储在消息列表中（用于 UI 显示和持久化）
 * - UndoService 提供实际的撤销操作
 */

import { useAgentStore } from './AgentStore'
import { isCheckpointMessage, FileSnapshot } from './types'

// ===== Undo 服务类 =====

class UndoServiceClass {
  /**
   * 获取所有 checkpoint 中的文件快照
   */
  getAllSnapshots(): Record<string, FileSnapshot> {
    const store = useAgentStore.getState()
    const messages = store.getMessages()
    const snapshots: Record<string, FileSnapshot> = {}

    // 遍历所有 checkpoint，收集最早的快照（用于完全撤销）
    for (const msg of messages) {
      if (isCheckpointMessage(msg)) {
        for (const [path, snapshot] of Object.entries(msg.fileSnapshots)) {
          // 只保留最早的快照
          if (!(path in snapshots)) {
            snapshots[path] = snapshot
          }
        }
      }
    }

    return snapshots
  }

  /**
   * 获取最近一个 checkpoint 的快照
   */
  getLatestSnapshots(): Record<string, FileSnapshot> | null {
    const store = useAgentStore.getState()
    const messages = store.getMessages()

    // 从后往前找最近的 checkpoint
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (isCheckpointMessage(msg)) {
        return msg.fileSnapshots
      }
    }

    return null
  }

  /**
   * 撤销最近一次更改
   */
  async undoLatest(): Promise<{
    success: boolean
    restoredFiles: string[]
    errors: string[]
  }> {
    const snapshots = this.getLatestSnapshots()
    if (!snapshots) {
      return { success: false, restoredFiles: [], errors: ['No checkpoints available'] }
    }

    return this.restoreSnapshots(snapshots)
  }

  /**
   * 撤销当前会话的所有更改
   */
  async undoAll(): Promise<{
    success: boolean
    restoredFiles: string[]
    errors: string[]
  }> {
    const snapshots = this.getAllSnapshots()
    if (Object.keys(snapshots).length === 0) {
      return { success: false, restoredFiles: [], errors: ['No checkpoints available'] }
    }

    return this.restoreSnapshots(snapshots)
  }

  /**
   * 恢复快照
   */
  private async restoreSnapshots(snapshots: Record<string, FileSnapshot>): Promise<{
    success: boolean
    restoredFiles: string[]
    errors: string[]
  }> {
    const restoredFiles: string[] = []
    const errors: string[] = []

    for (const [path, snapshot] of Object.entries(snapshots)) {
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
          // 恢复文件内容
          const written = await window.electronAPI.writeFile(path, snapshot.content)
          if (written) {
            restoredFiles.push(path)
          } else {
            errors.push(`Failed to restore: ${path}`)
          }
        }
      } catch (e) {
        errors.push(`Error restoring ${path}: ${e}`)
      }
    }

    return {
      success: errors.length === 0,
      restoredFiles,
      errors,
    }
  }

  /**
   * 清空所有检查点（Keep 操作）
   * 注意：这不会从消息列表中删除 checkpoint 消息，
   * 只是标记它们为"已确认"，不再用于撤销
   */
  clearCheckpoints(): void {
    // 在当前实现中，我们不需要做任何事情
    // 因为 checkpoint 消息会随着新的对话而被覆盖
    // 如果需要更复杂的逻辑，可以在这里添加
    console.log('[UndoService] Checkpoints cleared (changes kept)')
  }

  /**
   * 获取已修改的文件列表
   */
  getModifiedFiles(): string[] {
    const snapshots = this.getAllSnapshots()
    return Object.keys(snapshots)
  }

  /**
   * 检查是否有可撤销的更改
   */
  hasUndoableChanges(): boolean {
    return Object.keys(this.getAllSnapshots()).length > 0
  }
}

// 单例导出
export const UndoService = new UndoServiceClass()
