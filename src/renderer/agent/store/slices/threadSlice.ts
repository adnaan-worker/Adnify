/**
 * 线程管理 Slice
 * 负责聊天线程的创建、切换、删除
 */

import type { StateCreator } from 'zustand'
import type { ChatThread } from '../../types'
import { contextManager } from '../../context'

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
        const currentState = get() as any
        const currentThreadId = currentState.currentThreadId
        
        // 保存当前线程的压缩状态
        if (currentThreadId && currentState.threads[currentThreadId]) {
            const currentSummary = currentState.contextSummary
            if (currentSummary) {
                set(state => ({
                    threads: {
                        ...state.threads,
                        [currentThreadId]: {
                            ...state.threads[currentThreadId],
                            contextSummary: currentSummary,
                        }
                    }
                }))
            }
        }
        
        // 重置 ContextManager 状态（新线程从空白开始）
        contextManager.clear()
        
        const thread = createEmptyThread()
        set(state => ({
            threads: { ...state.threads, [thread.id]: thread },
            currentThreadId: thread.id,
            // 新线程没有压缩状态
            contextSummary: null,
            isCompacting: false,
        } as any))
        return thread.id
    },

    // 切换线程
    switchThread: (threadId) => {
        const currentState = get() as any
        const currentThreadId = currentState.currentThreadId
        
        if (!currentState.threads[threadId]) return
        
        // 保存当前线程的压缩状态
        if (currentThreadId && currentState.threads[currentThreadId]) {
            const currentSummary = currentState.contextSummary
            set(state => ({
                threads: {
                    ...state.threads,
                    [currentThreadId]: {
                        ...state.threads[currentThreadId],
                        contextSummary: currentSummary || null,
                    }
                }
            }))
        }
        
        // 切换到目标线程，恢复其压缩状态
        const targetThread = currentState.threads[threadId]
        set({ 
            currentThreadId: threadId,
            contextSummary: targetThread.contextSummary || null,
            isCompacting: false,
        } as any)
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
