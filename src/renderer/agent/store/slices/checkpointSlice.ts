/**
 * 检查点管理 Slice
 * 负责文件快照、撤销恢复功能
 */

import { api } from '@/renderer/services/electronAPI'
import type { StateCreator } from 'zustand'
import { logger } from '@utils/Logger'
import { internalWriteTracker } from '@/renderer/services/internalWriteTracker'
import type { FileSnapshot, PendingChange, MessageCheckpoint, CheckpointImage } from '../../types'
import type { ContextItem } from '../../types'
import type { ThreadSlice } from './threadSlice'

// ===== 类型定义 =====

export interface CheckpointState {
    pendingChanges: PendingChange[]
    messageCheckpoints: MessageCheckpoint[]
}

export interface CheckpointActions {
    // 待确认更改操作
    addPendingChange: (change: Omit<PendingChange, 'id' | 'timestamp' | 'status'>) => void
    acceptAllChanges: () => void
    undoAllChanges: () => Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }>
    acceptChange: (filePath: string) => void
    undoChange: (filePath: string) => Promise<boolean>
    clearPendingChanges: () => void
    getPendingChanges: () => PendingChange[]

    // 消息检查点操作
    createMessageCheckpoint: (messageId: string, description: string, images?: CheckpointImage[], contextItems?: ContextItem[], targetThreadId?: string) => Promise<string>
    addSnapshotToCurrentCheckpoint: (filePath: string, content: string | null) => void
    restoreToCheckpoint: (checkpointId: string) => Promise<{ success: boolean; restoredFiles: string[]; errors: string[]; images?: CheckpointImage[]; contextItems?: ContextItem[] }>
    getCheckpointForMessage: (messageId: string) => MessageCheckpoint | null
    clearMessageCheckpoints: () => void
    getMessageCheckpoints: () => MessageCheckpoint[]
}

export type CheckpointSlice = CheckpointState & CheckpointActions

// ===== Slice 创建器 =====

export const createCheckpointSlice: StateCreator<
    ThreadSlice & CheckpointSlice,
    [],
    [],
    CheckpointSlice
> = (set, get) => ({
    // 初始状态
    pendingChanges: [],
    messageCheckpoints: [],

    // 添加待确认更改
    addPendingChange: (change) => {
        set(state => {
            const existingIdx = state.pendingChanges.findIndex(c => c.filePath === change.filePath)
            if (existingIdx !== -1) {
                const existing = state.pendingChanges[existingIdx]
                const updated = [...state.pendingChanges]
                updated[existingIdx] = {
                    ...existing,
                    toolCallId: change.toolCallId,
                    toolName: change.toolName,
                    newContent: change.newContent,
                    changeType: change.changeType,
                    linesAdded: existing.linesAdded + change.linesAdded,
                    linesRemoved: existing.linesRemoved + change.linesRemoved,
                }
                return { pendingChanges: updated }
            }

            const newChange: PendingChange = {
                ...change,
                id: crypto.randomUUID(),
                status: 'pending',
                timestamp: Date.now(),
            }
            return { pendingChanges: [...state.pendingChanges, newChange] }
        })
    },

    // 接受所有更改
    acceptAllChanges: () => {
        set({ pendingChanges: [] })
    },

    // 撤销所有更改
    undoAllChanges: async () => {
        const changes = get().pendingChanges
        const restoredFiles: string[] = []
        const errors: string[] = []

        for (const change of changes) {
            try {
                if (change.snapshot.content === null) {
                    const deleted = await api.file.delete(change.filePath)
                    if (deleted) {
                        restoredFiles.push(change.filePath)
                    } else {
                        errors.push(`Failed to delete: ${change.filePath}`)
                    }
                } else {
                    internalWriteTracker.mark(change.filePath)
                    const written = await api.file.write(change.filePath, change.snapshot.content)
                    if (written) {
                        restoredFiles.push(change.filePath)
                    } else {
                        errors.push(`Failed to restore: ${change.filePath}`)
                    }
                }
            } catch (e) {
                errors.push(`Error restoring ${change.filePath}: ${e}`)
            }
        }

        set({ pendingChanges: [] })

        return { success: errors.length === 0, restoredFiles, errors }
    },

    // 接受单个更改
    acceptChange: (filePath) => {
        set(state => ({
            pendingChanges: state.pendingChanges.filter(c => c.filePath !== filePath),
        }))
    },

    // 撤销单个更改
    undoChange: async (filePath) => {
        const change = get().pendingChanges.find(c => c.filePath === filePath)
        if (!change) return false

        try {
            if (change.snapshot.content === null) {
                const deleted = await api.file.delete(change.filePath)
                if (!deleted) return false
            } else {
                internalWriteTracker.mark(change.filePath)
                const written = await api.file.write(change.filePath, change.snapshot.content)
                if (!written) return false
            }

            set(state => ({
                pendingChanges: state.pendingChanges.filter(c => c.filePath !== filePath),
            }))
            return true
        } catch {
            return false
        }
    },

    // 清空待确认更改
    clearPendingChanges: () => {
        set({ pendingChanges: [] })
    },

    // 获取待确认更改
    getPendingChanges: () => {
        return get().pendingChanges
    },

    // 创建消息检查点
    createMessageCheckpoint: async (messageId, description, images, contextItems, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const fileSnapshots: Record<string, FileSnapshot> = {}

        for (const change of get().pendingChanges) {
            fileSnapshots[change.filePath] = { ...change.snapshot }
        }

        const checkpoint: MessageCheckpoint = {
            id: crypto.randomUUID(),
            messageId,
            timestamp: Date.now(),
            fileSnapshots,
            description,
            images,
            contextItems,
        }

        logger.agent.info('[Checkpoint] Created checkpoint:', checkpoint.id, 'for message:', messageId, 'with files:', Object.keys(fileSnapshots), 'images:', images?.length ?? 0, 'contextItems:', contextItems?.length ?? 0)

        set(state => {
            let newCheckpoints = [...state.messageCheckpoints, checkpoint]
            // 限制 checkpoint 数量，超过时删除最旧的
            const MAX_CHECKPOINTS = 15
            if (newCheckpoints.length > MAX_CHECKPOINTS) {
                newCheckpoints = newCheckpoints.slice(-MAX_CHECKPOINTS)
            }
            return { messageCheckpoints: newCheckpoints }
        })

        return checkpoint.id
    },

    // 添加文件快照到当前检查点
    addSnapshotToCurrentCheckpoint: (filePath: string, content: string | null) => {
        logger.agent.info('[Checkpoint] Adding snapshot for:', filePath, 'content length:', content?.length ?? 'null')

        set(state => {
            if (state.messageCheckpoints.length === 0) {
                logger.agent.info('[Checkpoint] No checkpoints exist, cannot add snapshot')
                return state
            }

            const checkpoints = [...state.messageCheckpoints]
            const lastCheckpoint = checkpoints[checkpoints.length - 1]

            logger.agent.info('[Checkpoint] Current checkpoint:', lastCheckpoint.id, 'existing files:', Object.keys(lastCheckpoint.fileSnapshots))

            if (!(filePath in lastCheckpoint.fileSnapshots)) {
                checkpoints[checkpoints.length - 1] = {
                    ...lastCheckpoint,
                    fileSnapshots: {
                        ...lastCheckpoint.fileSnapshots,
                        [filePath]: { path: filePath, content },
                    },
                }
                logger.agent.info('[Checkpoint] Added snapshot for:', filePath)
                return { messageCheckpoints: checkpoints }
            }

            logger.agent.info('[Checkpoint] Snapshot already exists for:', filePath)
            return state
        })
    },

    // 恢复到检查点
    restoreToCheckpoint: async (checkpointId) => {
        const state = get()
        const checkpointIdx = state.messageCheckpoints.findIndex(cp => cp.id === checkpointId)

        logger.agent.info('[Restore] Looking for checkpoint:', checkpointId)

        if (checkpointIdx === -1) {
            return { success: false, restoredFiles: [], errors: ['Checkpoint not found'] }
        }

        const checkpoint = state.messageCheckpoints[checkpointIdx]
        const restoredFiles: string[] = []
        const errors: string[] = []

        const filesToRestore: Record<string, FileSnapshot> = {}

        for (let i = checkpointIdx; i < state.messageCheckpoints.length; i++) {
            const cp = state.messageCheckpoints[i]
            for (const [path, snapshot] of Object.entries(cp.fileSnapshots)) {
                if (!(path in filesToRestore)) {
                    filesToRestore[path] = snapshot
                }
            }
        }

        for (const change of state.pendingChanges) {
            if (!(change.filePath in filesToRestore)) {
                filesToRestore[change.filePath] = change.snapshot
            }
        }

        logger.agent.info('[Restore] Files to restore:', Object.keys(filesToRestore))

        for (const [filePath, snapshot] of Object.entries(filesToRestore)) {
            try {
                if (snapshot.content === null) {
                    const deleted = await api.file.delete(filePath)
                    if (deleted) {
                        restoredFiles.push(filePath)
                    }
                } else {
                    internalWriteTracker.mark(filePath)
                    const written = await api.file.write(filePath, snapshot.content)
                    if (written) {
                        restoredFiles.push(filePath)
                    } else {
                        errors.push(`Failed to restore: ${filePath}`)
                    }
                }
            } catch (e) {
                errors.push(`Error restoring ${filePath}: ${e}`)
            }
        }

        const threadId = state.currentThreadId
        if (threadId) {
            const thread = state.threads[threadId]
            if (thread) {
                const messageIdx = thread.messages.findIndex(m => m.id === checkpoint.messageId)
                if (messageIdx !== -1) {
                    set(state => {
                        const thread = state.threads[threadId]
                        if (!thread) return state
                        return {
                            threads: {
                                ...state.threads,
                                [threadId]: {
                                    ...thread,
                                    messages: thread.messages.slice(0, messageIdx),
                                    lastModified: Date.now(),
                                },
                            },
                        }
                    })
                }
            }
        }

        set(state => ({
            messageCheckpoints: state.messageCheckpoints.slice(0, checkpointIdx),
            pendingChanges: [],
        }))

        // 返回检查点中保存的图片和上下文，用于恢复到输入框
        return { 
            success: errors.length === 0, 
            restoredFiles, 
            errors,
            images: checkpoint.images,
            contextItems: checkpoint.contextItems,
        }
    },

    // 获取消息对应的检查点
    getCheckpointForMessage: (messageId) => {
        return get().messageCheckpoints.find(cp => cp.messageId === messageId) || null
    },

    // 清空消息检查点
    clearMessageCheckpoints: () => {
        set({ messageCheckpoints: [] })
    },

    // 获取消息检查点列表
    getMessageCheckpoints: () => {
        return get().messageCheckpoints
    },
})
