/**
 * 线程管理 Slice
 * 负责聊天线程的创建、切换、删除
 */

import type { StateCreator } from 'zustand'
import type { ChatThread } from '../../types'
// 注意：不再使用 contextManager，压缩逻辑在 loop.ts 中处理

// ===== 类型定义 =====

export interface ThreadState {
    threads: Record<string, ChatThread>
    currentThreadId: string | null
}

export interface ThreadActions {
    createThread: () => string
    switchThread: (threadId: string) => void
    deleteThread: (threadId: string) => void
    getCurrentThread: () => ChatThread | null
}

export type ThreadSlice = ThreadState & ThreadActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()

export const createEmptyThread = (): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    contextItems: [],
    state: {
        currentCheckpointIdx: null,
        isStreaming: false,
    },
    contextSummary: null,
    handoffContext: undefined,
    pendingObjective: undefined,
    pendingSteps: undefined,
})

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
        const state = get()
        const currentThreadId = state.currentThreadId
        
        // 保存当前线程的压缩状态
        if (currentThreadId && state.threads[currentThreadId]) {
            const stateWithCompression = state as ThreadSlice & { contextSummary?: unknown }
            const currentSummary = stateWithCompression.contextSummary
            if (currentSummary) {
                set(s => ({
                    threads: {
                        ...s.threads,
                        [currentThreadId]: {
                            ...s.threads[currentThreadId],
                            contextSummary: currentSummary as import('../../context/types').StructuredSummary,
                        }
                    }
                }))
            }
        }
        
        // 新线程从空白开始
        
        const thread = createEmptyThread()
        set(s => ({
            threads: { ...s.threads, [thread.id]: thread },
            currentThreadId: thread.id,
            // 新线程没有压缩状态
            ...(('contextSummary' in s) ? { contextSummary: null, isCompacting: false } : {})
        }))
        return thread.id
    },

    // 切换线程
    switchThread: (threadId) => {
        const state = get()
        const currentThreadId = state.currentThreadId
        
        if (!state.threads[threadId]) return
        
        // 保存当前线程的压缩状态
        if (currentThreadId && state.threads[currentThreadId]) {
            const stateWithCompression = state as ThreadSlice & { contextSummary?: unknown }
            const currentSummary = stateWithCompression.contextSummary
            set(s => ({
                threads: {
                    ...s.threads,
                    [currentThreadId]: {
                        ...s.threads[currentThreadId],
                        contextSummary: (currentSummary as import('../../context/types').StructuredSummary) || null,
                    }
                }
            }))
        }
        
        // 切换到目标线程，恢复其压缩状态
        const targetThread = state.threads[threadId]
        set({ 
            currentThreadId: threadId,
            ...(('contextSummary' in state) ? { 
                contextSummary: targetThread.contextSummary || null,
                isCompacting: false 
            } : {})
        })
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
})
