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
import type { CompressionStats } from '../context'
import type { HandoffDocument } from '../context/types'
import { buildHandoffContext } from '../context/HandoffManager'

// ===== Store 类型 =====

// 上下文统计信息
export interface ContextStats {
    totalChars: number
    maxChars: number
    fileCount: number
    maxFiles: number
    messageCount: number
    maxMessages: number
    semanticResultCount: number
    terminalChars: number
}

// UI 相关状态（从 chatSlice 迁移）
interface UIState {
    contextStats: ContextStats | null
    inputPrompt: string
    currentSessionId: string | null
    setContextStats: (stats: ContextStats | null) => void
    setInputPrompt: (prompt: string) => void
    setCurrentSessionId: (id: string | null) => void
}

// Handoff 会话创建结果
interface HandoffSessionResult {
    threadId: string
    autoResume: boolean
    objective: string
    pendingSteps: string[]
    fileChanges: Array<{ action: string; path: string; summary: string }>
}

// 压缩阶段
type CompressionPhase = 'idle' | 'analyzing' | 'compressing' | 'summarizing' | 'done'

// 上下文压缩状态
interface ContextCompressionState {
    compressionStats: CompressionStats | null
    handoffDocument: HandoffDocument | null
    handoffRequired: boolean  // 是否需要强制 Handoff（L4 触发后为 true，阻止继续对话）
    contextSummary: import('../context/types').StructuredSummary | null  // 上下文摘要
    isCompacting: boolean  // 是否正在压缩
    compressionPhase: CompressionPhase  // 压缩阶段
    setCompressionStats: (stats: CompressionStats | null) => void
    setHandoffDocument: (doc: HandoffDocument | null) => void
    setCompressionPhase: (phase: CompressionPhase) => void
    setHandoffRequired: (required: boolean) => void
    setContextSummary: (summary: import('../context/types').StructuredSummary | null) => void
    setIsCompacting: (compacting: boolean) => void
    createHandoffSession: () => HandoffSessionResult | null
}

export type AgentStore = ThreadSlice & MessageSlice & CheckpointSlice & PlanSlice & StreamSlice & BranchSlice & ContextCompressionState & UIState

// ===== 流式响应节流优化 =====

class StreamingBuffer {
    private buffer: Map<string, string> = new Map()
    private timerId: ReturnType<typeof setTimeout> | null = null
    private flushCallback: ((messageId: string, content: string) => void) | null = null
    private lastFlushTime = 0
    private readonly FLUSH_INTERVAL = 16 // 约 60fps，更流畅的更新

    setFlushCallback(callback: (messageId: string, content: string) => void) {
        this.flushCallback = callback
    }

    append(messageId: string, content: string): void {
        const existing = this.buffer.get(messageId) || ''
        this.buffer.set(messageId, existing + content)
        this.scheduleFlush()
    }

    private scheduleFlush(): void {
        if (this.timerId) return
        
        // 使用 requestAnimationFrame 获得更流畅的更新
        // 同时保持最小间隔避免过度渲染
        const now = performance.now()
        const elapsed = now - this.lastFlushTime
        
        if (elapsed >= this.FLUSH_INTERVAL) {
            // 已经过了足够时间，立即用 rAF 刷新
            this.timerId = requestAnimationFrame(() => {
                this.timerId = null
                this.flush()
            }) as unknown as ReturnType<typeof setTimeout>
        } else {
            // 还需要等待，用 setTimeout
            this.timerId = setTimeout(() => {
                this.timerId = null
                this.flush()
            }, this.FLUSH_INTERVAL - elapsed)
        }
    }

    private flush(): void {
        if (!this.flushCallback) return
        this.lastFlushTime = performance.now()
        
        const updates = new Map(this.buffer)
        this.buffer.clear()
        
        updates.forEach((content, messageId) => {
            if (content) {
                this.flushCallback!(messageId, content)
            }
        })
    }

    flushNow(): void {
        if (this.timerId) {
            // 尝试取消两种类型的定时器
            clearTimeout(this.timerId)
            cancelAnimationFrame(this.timerId as unknown as number)
            this.timerId = null
        }
        this.flush()
    }

    clear(): void {
        if (this.timerId) {
            clearTimeout(this.timerId)
            cancelAnimationFrame(this.timerId as unknown as number)
            this.timerId = null
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

            // 上下文压缩状态
            const [set, get] = args
            const contextCompressionState: ContextCompressionState = {
                compressionStats: null,
                handoffDocument: null,
                handoffRequired: false,
                contextSummary: null,
                isCompacting: false,
                compressionPhase: 'idle',
                setCompressionStats: (stats) => set({ compressionStats: stats } as any),
                setHandoffDocument: (doc) => set({ handoffDocument: doc } as any),
                setHandoffRequired: (required) => set({ handoffRequired: required } as any),
                setContextSummary: (summary) => set({ contextSummary: summary } as any),
                setIsCompacting: (compacting) => set({ isCompacting: compacting } as any),
                setCompressionPhase: (phase) => set({ compressionPhase: phase } as any),
                createHandoffSession: () => {
                    const state = get() as any
                    const handoff = state.handoffDocument as HandoffDocument | null
                    
                    if (!handoff) {
                        logger.agent.warn('[AgentStore] No handoff document to create session from')
                        return null
                    }
                    
                    // 创建新线程（会自动切换到新线程）
                    const newThreadId = threadSlice.createThread()
                    
                    // 构建 handoff 上下文（用于注入到 system prompt）
                    const handoffContext = buildHandoffContext(handoff)
                    
                    // 不再显示欢迎消息，直接准备自动继续
                    // 摘要信息会在底部栏的弹窗中显示
                    
                    // 清除 handoff 状态，但保留 compressionStats 用于 UI 显示
                    set({ 
                        handoffDocument: null, 
                        handoffRequired: false,
                        // 保留 contextSummary 用于底部栏显示
                        contextSummary: handoff.summary,
                    } as any)
                    
                    // 重置 contextManager 并设置 handoff 摘要
                    import('../context').then(({ contextManager }) => {
                        contextManager.clear()
                        contextManager.setSummary(handoff.summary)
                        contextManager.setSessionId(newThreadId)
                    })
                    
                    // 存储 handoff 上下文到线程元数据
                    const threads = (get() as any).threads
                    if (threads[newThreadId]) {
                        threads[newThreadId].handoffContext = handoffContext
                        // 存储待完成任务，用于自动继续
                        threads[newThreadId].pendingObjective = handoff.summary.objective
                        threads[newThreadId].pendingSteps = handoff.summary.pendingSteps
                        set({ threads: { ...threads } } as any)
                    }
                    
                    logger.agent.info('[AgentStore] Created handoff session:', newThreadId)
                    
                    // 返回包含自动继续信息的对象
                    return {
                        threadId: newThreadId,
                        autoResume: true,
                        objective: handoff.summary.objective,
                        pendingSteps: handoff.summary.pendingSteps,
                        fileChanges: handoff.summary.fileChanges,
                    }
                },
            }

            // UI 状态（从 chatSlice 迁移）
            const uiState: UIState = {
                contextStats: null,
                inputPrompt: '',
                currentSessionId: null,
                setContextStats: (stats) => set({ contextStats: stats } as any),
                setInputPrompt: (prompt) => set({ inputPrompt: prompt } as any),
                setCurrentSessionId: (id) => set({ currentSessionId: id } as any),
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
                ...contextCompressionState,
                ...uiState,
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
                messageCheckpoints: state.messageCheckpoints,
                compressionStats: state.compressionStats,
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

export const selectContextStats = (state: AgentStore) => state.contextStats
export const selectInputPrompt = (state: AgentStore) => state.inputPrompt
export const selectCurrentSessionId = (state: AgentStore) => state.currentSessionId
export const selectCompressionStats = (state: AgentStore) => state.compressionStats
export const selectHandoffDocument = (state: AgentStore) => state.handoffDocument
export const selectHandoffRequired = (state: AgentStore) => state.handoffRequired
export const selectContextSummary = (state: AgentStore) => state.contextSummary
export const selectCompressionPhase = (state: AgentStore) => state.compressionPhase
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
        
        // 监听线程切换，重置压缩状态
        const { contextManager } = await import('../context')
        let lastThreadId = useAgentStore.getState().currentThreadId
        
        useAgentStore.subscribe((state) => {
            if (state.currentThreadId !== lastThreadId) {
                lastThreadId = state.currentThreadId
                // 重置压缩状态
                contextManager.clear()
                // 重置 handoff 状态
                useAgentStore.getState().setHandoffRequired(false)
                useAgentStore.getState().setHandoffDocument(null)
                useAgentStore.getState().setCompressionStats(null)
                logger.agent.info('[AgentStore] Thread changed, context manager reset')
            }
        })
    } catch (error) {
        logger.agent.error('[AgentStore] Failed to initialize:', error)
    }
}
