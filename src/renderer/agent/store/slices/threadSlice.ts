/**
 * 线程管理 Slice
 * 负责聊天线程的创建、切换、删除
 * 
 * 注意：所有线程相关状态都存储在 ChatThread 中，切换只需改变 currentThreadId
 */

import type { StateCreator } from 'zustand'
import type { ChatThread, StreamState, CompressionPhase, TodoItem } from '../../types'
import type { CompressionStats } from '../../core/types'
import type { StructuredSummary } from '../../context/types'

// ===== 类型定义 =====

export interface ThreadStoreState {
    threads: Record<string, ChatThread>
    currentThreadId: string | null
}

export interface ThreadActions {
    // 线程管理
    createThread: () => string
    switchThread: (threadId: string) => void
    deleteThread: (threadId: string) => void
    getCurrentThread: () => ChatThread | null

    // 线程状态更新（操作当前或指定线程）
    setStreamState: (state: Partial<StreamState>, threadId?: string) => void
    setStreamPhase: (phase: StreamState['phase'], threadId?: string) => void
    setCompressionStats: (stats: CompressionStats | null, threadId?: string) => void
    setContextSummary: (summary: StructuredSummary | null, threadId?: string) => void
    setCompressionPhase: (phase: CompressionPhase, threadId?: string) => void
    setHandoffRequired: (required: boolean, threadId?: string) => void
    setIsCompacting: (compacting: boolean, threadId?: string) => void

    // 任务列表
    setTodos: (todos: TodoItem[], threadId?: string) => void
    getTodos: (threadId?: string) => TodoItem[]
}

export type ThreadSlice = ThreadStoreState & ThreadActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()

/** 创建空线程 - 包含完整初始状态 */
export const createEmptyThread = (): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    contextItems: [],
    // 执行状态
    streamState: { phase: 'idle' },
    // 压缩状态
    compressionStats: null,
    contextSummary: null,
    handoffRequired: false,
    isCompacting: false,
    compressionPhase: 'idle',
})

/** 更新指定线程的部分字段 */
const updateThread = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads
    return {
        ...threads,
        [threadId]: { ...thread, ...updates, lastModified: Date.now() }
    }
}

// ===== Slice 创建器 =====

export const createThreadSlice: StateCreator<
    ThreadSlice,
    [],
    [],
    ThreadSlice
> = (set, get) => ({
    // 初始状态
    threads: {},
    currentThreadId: null,

    // 创建线程
    createThread: () => {
        const thread = createEmptyThread()
        set(state => {
            const newThreads = { ...state.threads, [thread.id]: thread }

            // 限制线程数量，超过时删除最旧的非活跃线程
            const MAX_THREADS = 50
            const threadIds = Object.keys(newThreads)
            if (threadIds.length > MAX_THREADS) {
                const sorted = threadIds
                    .filter(id => id !== thread.id) // 不删除刚创建的
                    .map(id => ({ id, lastModified: newThreads[id].lastModified }))
                    .sort((a, b) => a.lastModified - b.lastModified)

                const toDelete = sorted.slice(0, threadIds.length - MAX_THREADS)
                for (const { id } of toDelete) {
                    delete newThreads[id]
                }
            }

            return {
                threads: newThreads,
                currentThreadId: thread.id,
            }
        })
        return thread.id
    },

    // 切换线程 - 只改变 currentThreadId，无需同步任何状态
    switchThread: (threadId) => {
        const state = get()
        if (!state.threads[threadId]) return
        set({ currentThreadId: threadId })
    },

    // 删除线程
    deleteThread: (threadId) => {
        set(state => {
            const { [threadId]: _, ...remaining } = state.threads
            const remainingIds = Object.keys(remaining)
            return {
                threads: remaining,
                currentThreadId: state.currentThreadId === threadId
                    ? (remainingIds[0] || null)
                    : state.currentThreadId,
            }
        })
    },

    // 获取当前线程
    getCurrentThread: () => {
        const state = get()
        if (!state.currentThreadId) return null
        return state.threads[state.currentThreadId] || null
    },

    // === 线程状态更新方法 ===

    setStreamState: (streamState, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state
            return {
                threads: updateThread(state.threads, targetId, {
                    streamState: { ...thread.streamState, ...streamState }
                })
            }
        })
    },

    setStreamPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state
            return {
                threads: updateThread(state.threads, targetId, {
                    streamState: { ...thread.streamState, phase }
                })
            }
        })
    },

    setCompressionStats: (stats, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => ({
            threads: updateThread(state.threads, targetId, { compressionStats: stats })
        }))
    },

    setContextSummary: (summary, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => ({
            threads: updateThread(state.threads, targetId, { contextSummary: summary })
        }))
    },

    setCompressionPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => ({
            threads: updateThread(state.threads, targetId, { compressionPhase: phase })
        }))
    },

    setHandoffRequired: (required, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => ({
            threads: updateThread(state.threads, targetId, { handoffRequired: required })
        }))
    },

    setIsCompacting: (compacting, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => ({
            threads: updateThread(state.threads, targetId, { isCompacting: compacting })
        }))
    },

    // === 任务列表 ===

    setTodos: (todos, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return
        set(state => ({
            threads: updateThread(state.threads, targetId, { todos })
        }))
    },

    getTodos: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return []
        const thread = get().threads[targetId]
        return thread?.todos || []
    },
})
