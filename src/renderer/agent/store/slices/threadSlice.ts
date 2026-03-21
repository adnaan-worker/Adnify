/**
 * Thread slice.
 * Owns thread lifecycle plus thread-scoped ephemeral streaming preview state.
 */

import type { StateCreator } from 'zustand'
import type { ChatThread, StreamState, CompressionPhase, TodoItem } from '../../types'
import type { CompressionStats } from '../../core/types'
import type { StructuredSummary } from '../../context/types'
import type { BranchSlice } from './branchSlice'
import type { ToolStreamingPreview } from '@/shared/types'

export interface ThreadStoreState {
    threads: Record<string, ChatThread>
    currentThreadId: string | null
}

export interface ThreadActions {
    createThread: () => string
    switchThread: (threadId: string) => void
    deleteThread: (threadId: string) => void
    getCurrentThread: () => ChatThread | null

    setStreamState: (state: Partial<StreamState>, threadId?: string) => void
    setStreamPhase: (phase: StreamState['phase'], threadId?: string) => void
    setToolStreamingPreview: (toolCallId: string, preview: ToolStreamingPreview, threadId?: string) => void
    clearToolStreamingPreview: (toolCallId: string, threadId?: string) => void
    clearToolStreamingPreviews: (threadId?: string) => void
    getToolStreamingPreview: (toolCallId: string, threadId?: string) => ToolStreamingPreview | undefined
    setCompressionStats: (stats: CompressionStats | null, threadId?: string) => void
    setContextSummary: (summary: StructuredSummary | null, threadId?: string) => void
    setCompressionPhase: (phase: CompressionPhase, threadId?: string) => void
    setHandoffRequired: (required: boolean, threadId?: string) => void
    setIsCompacting: (compacting: boolean, threadId?: string) => void

    setTodos: (todos: TodoItem[], threadId?: string) => void
    getTodos: (threadId?: string) => TodoItem[]
}

export type ThreadSlice = ThreadStoreState & ThreadActions

const generateId = () => crypto.randomUUID()

export const createEmptyThread = (): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    contextItems: [],
    streamState: { phase: 'idle' },
    toolStreamingPreviews: {},
    compressionStats: null,
    contextSummary: null,
    handoffRequired: false,
    isCompacting: false,
    compressionPhase: 'idle',
})

const updateThread = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads

    return {
        ...threads,
        [threadId]: { ...thread, ...updates, lastModified: Date.now() },
    }
}

const updateThreadEphemeral = (
    threads: Record<string, ChatThread>,
    threadId: string,
    updates: Partial<ChatThread>
): Record<string, ChatThread> => {
    const thread = threads[threadId]
    if (!thread) return threads

    return {
        ...threads,
        [threadId]: { ...thread, ...updates },
    }
}

const arePreviewArgsEqual = (
    left?: Record<string, unknown>,
    right?: Record<string, unknown>
): boolean => {
    if (left === right) return true
    if (!left || !right) return !left && !right

    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
        if (left[key] !== right[key]) {
            return false
        }
    }

    return true
}

export const createThreadSlice: StateCreator<
    ThreadSlice & BranchSlice,
    [],
    [],
    ThreadSlice
> = (set, get) => ({
    threads: {},
    currentThreadId: null,

    createThread: () => {
        const thread = createEmptyThread()

        set(state => {
            const newThreads = { ...state.threads, [thread.id]: thread }
            let newBranches = state.branches
            let newActiveBranch = state.activeBranchId

            const MAX_THREADS = 50
            const threadIds = Object.keys(newThreads)
            if (threadIds.length > MAX_THREADS) {
                const sorted = threadIds
                    .filter(id => id !== thread.id)
                    .map(id => ({ id, lastModified: newThreads[id].lastModified }))
                    .sort((a, b) => a.lastModified - b.lastModified)

                const toDelete = sorted.slice(0, threadIds.length - MAX_THREADS)
                newBranches = { ...newBranches }
                newActiveBranch = { ...newActiveBranch }

                for (const { id } of toDelete) {
                    delete newThreads[id]
                    delete newBranches[id]
                    delete newActiveBranch[id]
                }
            }

            return {
                threads: newThreads,
                currentThreadId: thread.id,
                branches: newBranches,
                activeBranchId: newActiveBranch,
            }
        })

        return thread.id
    },

    switchThread: (threadId) => {
        const state = get()
        if (!state.threads[threadId]) return
        set({ currentThreadId: threadId })
    },

    deleteThread: (threadId) => {
        set(state => {
            const { [threadId]: _thread, ...remaining } = state.threads
            const remainingIds = Object.keys(remaining)
            const { [threadId]: _branch, ...remainingBranches } = state.branches || {}
            const { [threadId]: _activeBranch, ...remainingActiveBranch } = state.activeBranchId || {}

            return {
                threads: remaining,
                currentThreadId: state.currentThreadId === threadId
                    ? (remainingIds[0] || null)
                    : state.currentThreadId,
                branches: remainingBranches,
                activeBranchId: remainingActiveBranch,
            }
        })
    },

    getCurrentThread: () => {
        const state = get()
        if (!state.currentThreadId) return null
        return state.threads[state.currentThreadId] || null
    },

    setStreamState: (streamState, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            return {
                threads: updateThread(state.threads, targetId, {
                    streamState: { ...thread.streamState, ...streamState },
                }),
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
                    streamState: { ...thread.streamState, phase },
                }),
            }
        })
    },

    setToolStreamingPreview: (toolCallId, preview, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread) return state

            const currentPreview = thread.toolStreamingPreviews?.[toolCallId]
            const nextPreview: ToolStreamingPreview = {
                ...currentPreview,
                ...preview,
            }

            if (
                currentPreview?.isStreaming === nextPreview.isStreaming &&
                currentPreview?.name === nextPreview.name &&
                currentPreview?.lastUpdateTime === nextPreview.lastUpdateTime &&
                arePreviewArgsEqual(currentPreview?.partialArgs, nextPreview.partialArgs)
            ) {
                return state
            }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: {
                        ...(thread.toolStreamingPreviews || {}),
                        [toolCallId]: nextPreview,
                    },
                }),
            }
        })
    },

    clearToolStreamingPreview: (toolCallId, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.toolStreamingPreviews?.[toolCallId]) return state

            const { [toolCallId]: _preview, ...rest } = thread.toolStreamingPreviews
            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: rest,
                }),
            }
        })
    },

    clearToolStreamingPreviews: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => {
            const thread = state.threads[targetId]
            if (!thread?.toolStreamingPreviews || Object.keys(thread.toolStreamingPreviews).length === 0) {
                return state
            }

            return {
                threads: updateThreadEphemeral(state.threads, targetId, {
                    toolStreamingPreviews: {},
                }),
            }
        })
    },

    getToolStreamingPreview: (toolCallId, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return undefined
        return get().threads[targetId]?.toolStreamingPreviews?.[toolCallId]
    },

    setCompressionStats: (stats, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { compressionStats: stats }),
        }))
    },

    setContextSummary: (summary, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { contextSummary: summary }),
        }))
    },

    setCompressionPhase: (phase, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { compressionPhase: phase }),
        }))
    },

    setHandoffRequired: (required, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { handoffRequired: required }),
        }))
    },

    setIsCompacting: (compacting, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { isCompacting: compacting }),
        }))
    },

    setTodos: (todos, threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return

        set(state => ({
            threads: updateThread(state.threads, targetId, { todos }),
        }))
    },

    getTodos: (threadId) => {
        const targetId = threadId ?? get().currentThreadId
        if (!targetId) return []

        const thread = get().threads[targetId]
        return thread?.todos || []
    },
})
