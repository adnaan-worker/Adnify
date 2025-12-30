/**
 * Agent 状态管理
 * 使用 Zustand slice 模式组织代码
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { logger } from '@utils/Logger'
import { agentStorage } from './agentStorage'
import {
    createThreadSlice,
    createMessageSlice,
    createCheckpointSlice,
    createPlanSlice,
    createStreamSlice,
    createBranchSlice,
    type ThreadSlice,
    type MessageSlice,
    type CheckpointSlice,
    type PlanSlice,
    type StreamSlice,
    type BranchSlice,
    type Branch,
} from './slices'
import type { ChatMessage, ContextItem } from '../types'

// ===== Store 类型 =====

// 上下文摘要状态
interface ContextSummaryState {
    contextSummary: string | null
    isCompacting: boolean
    setContextSummary: (summary: string | null) => void
    setIsCompacting: (isCompacting: boolean) => void
}

export type AgentStore = ThreadSlice & MessageSlice & CheckpointSlice & PlanSlice & StreamSlice & BranchSlice & ContextSummaryState

// ===== 流式响应节流优化 =====

class StreamingBuffer {
    private buffer: Map<string, string> = new Map()
    private rafId: number | null = null
    private flushCallback: ((messageId: string, content: string) => void) | null = null
    private lastFlushTime = 0
    private readonly MIN_FLUSH_INTERVAL = 50 // 最小刷新间隔 50ms

    setFlushCallback(callback: (messageId: string, content: string) => void) {
        this.flushCallback = callback
    }

    append(messageId: string, content: string): void {
        const existing = this.buffer.get(messageId) || ''
        this.buffer.set(messageId, existing + content)
        this.scheduleFlush()
    }

    private scheduleFlush(): void {
        if (this.rafId) return
        
        const now = performance.now()
        const timeSinceLastFlush = now - this.lastFlushTime
        
        // 如果距离上次刷新不足 MIN_FLUSH_INTERVAL，延迟刷新
        if (timeSinceLastFlush < this.MIN_FLUSH_INTERVAL) {
            this.rafId = window.setTimeout(() => {
                this.rafId = null
                this.flush()
            }, this.MIN_FLUSH_INTERVAL - timeSinceLastFlush) as unknown as number
        } else {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null
                this.flush()
            })
        }
    }

    private flush(): void {
        if (!this.flushCallback) return
        this.lastFlushTime = performance.now()
        
        // 批量更新：合并所有待更新的消息
        const updates = new Map(this.buffer)
        this.buffer.clear()
        
        updates.forEach((content, messageId) => {
            if (content) {
                this.flushCallback!(messageId, content)
            }
        })
    }

    flushNow(): void {
        if (this.rafId) {
            if (typeof this.rafId === 'number' && this.rafId > 1000) {
                clearTimeout(this.rafId)
            } else {
                cancelAnimationFrame(this.rafId)
            }
            this.rafId = null
        }
        this.flush()
    }

    clear(): void {
        if (this.rafId) {
            if (typeof this.rafId === 'number' && this.rafId > 1000) {
                clearTimeout(this.rafId)
            } else {
                cancelAnimationFrame(this.rafId)
            }
            this.rafId = null
        }
        this.buffer.clear()
    }
}

const streamingBuffer = new StreamingBuffer()

// ===== Store 实现 =====

export const useAgentStore = create<AgentStore>()(
    persist(
        (...args) => {
            // 创建各个 slice
            const threadSlice = createThreadSlice(...args)
            const messageSlice = createMessageSlice(...args)
            const checkpointSlice = createCheckpointSlice(...args)
            const planSlice = createPlanSlice(...args)
            const streamSlice = createStreamSlice(...args)
            const branchSlice = createBranchSlice(...args)

            // 上下文摘要状态
            const [set, get] = args
            const contextSummaryState: ContextSummaryState = {
                contextSummary: null,
                isCompacting: false,
                setContextSummary: (summary) => {
                    const state = get() as any
                    const currentThreadId = state.currentThreadId
                    
                    // 更新全局状态
                    set({ contextSummary: summary } as any)
                    
                    // 同时更新当前线程的 contextSummary
                    if (currentThreadId && state.threads[currentThreadId]) {
                        set((s: any) => ({
                            threads: {
                                ...s.threads,
                                [currentThreadId]: {
                                    ...s.threads[currentThreadId],
                                    contextSummary: summary,
                                }
                            }
                        }))
                    }
                },
                setIsCompacting: (isCompacting) => set({ isCompacting } as any),
            }

            // 重写 appendToAssistant 使用 StreamingBuffer
            messageSlice.appendToAssistant = (messageId: string, content: string) => {
                streamingBuffer.append(messageId, content)
            }

            // 重写 finalizeAssistant 先刷新缓冲区
            const originalFinalizeAssistant = messageSlice.finalizeAssistant
            messageSlice.finalizeAssistant = (messageId: string) => {
                streamingBuffer.flushNow()
                originalFinalizeAssistant(messageId)
            }

            return {
                ...threadSlice,
                ...messageSlice,
                ...checkpointSlice,
                ...planSlice,
                ...streamSlice,
                ...branchSlice,
                ...contextSummaryState,
            }
        },
        {
            name: 'adnify-agent-store',
            storage: createJSONStorage(() => agentStorage),
            partialize: (state) => ({
                threads: state.threads,
                currentThreadId: state.currentThreadId,
                plan: state.plan,
                branches: state.branches,
                activeBranchId: state.activeBranchId,
                contextSummary: state.contextSummary,
                messageCheckpoints: state.messageCheckpoints,
            }),
        }
    )
)

// ===== Selectors =====

const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_CONTEXT_ITEMS: ContextItem[] = []

export const selectCurrentThread = (state: AgentStore) => {
    if (!state.currentThreadId) return null
    return state.threads[state.currentThreadId] || null
}

export const selectMessages = (state: AgentStore) => {
    if (!state.currentThreadId) return EMPTY_MESSAGES
    const thread = state.threads[state.currentThreadId]
    return thread?.messages || EMPTY_MESSAGES
}

export const selectStreamState = (state: AgentStore) => state.streamState

export const selectContextItems = (state: AgentStore) => {
    if (!state.currentThreadId) return EMPTY_CONTEXT_ITEMS
    const thread = state.threads[state.currentThreadId]
    return thread?.contextItems || EMPTY_CONTEXT_ITEMS
}

export const selectIsStreaming = (state: AgentStore) =>
    state.streamState.phase === 'streaming' || state.streamState.phase === 'tool_running'

export const selectIsAwaitingApproval = (state: AgentStore) =>
    state.streamState.phase === 'tool_pending'

export const selectPendingChanges = (state: AgentStore) => state.pendingChanges

export const selectHasPendingChanges = (state: AgentStore) => state.pendingChanges.length > 0

export const selectMessageCheckpoints = (state: AgentStore) => state.messageCheckpoints

// 分支相关 selectors
const EMPTY_BRANCHES: Branch[] = []

export const selectBranches = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return EMPTY_BRANCHES
    return state.branches[threadId] || EMPTY_BRANCHES
}

export const selectActiveBranch = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return null
    const branchId = state.activeBranchId[threadId]
    if (!branchId) return null
    const branches = state.branches[threadId]
    if (!branches) return null
    return branches.find(b => b.id === branchId) || null
}

export const selectIsOnBranch = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return false
    return state.activeBranchId[threadId] != null
}

export const selectContextSummary = (state: AgentStore) => state.contextSummary
export const selectIsCompacting = (state: AgentStore) => state.isCompacting

// ===== StreamingBuffer 初始化 =====

streamingBuffer.setFlushCallback((messageId: string, content: string) => {
    const store = useAgentStore.getState()
    store._doAppendToAssistant(messageId, content)
})

// ===== Store 初始化 =====

export async function initializeAgentStore(): Promise<void> {
    try {
        const persistApi = (useAgentStore as any).persist
        if (persistApi) {
            await persistApi.rehydrate()
            logger.agent.info('[AgentStore] Rehydrated from project storage')
        }

        const { initializeTools } = await import('../tools')
        await initializeTools()
        logger.agent.info('[AgentStore] Tools initialized')
        
        // 监听线程切换，重置压缩服务状态
        const { contextCompactionService } = await import('../services/ContextCompactionService')
        let lastThreadId = useAgentStore.getState().currentThreadId
        
        useAgentStore.subscribe((state) => {
            if (state.currentThreadId !== lastThreadId) {
                lastThreadId = state.currentThreadId
                // 重置压缩服务状态
                contextCompactionService.reset()
                // 从新线程恢复摘要
                if (state.currentThreadId) {
                    contextCompactionService.restoreFromStore()
                }
                logger.agent.info('[AgentStore] Thread changed, compaction service reset')
            }
        })
    } catch (error) {
        logger.agent.error('[AgentStore] Failed to initialize:', error)
    }
}
