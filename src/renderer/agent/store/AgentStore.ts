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
    createStreamSlice,
    createBranchSlice,
    type ThreadSlice,
    type MessageSlice,
    type CheckpointSlice,
    type StreamSlice,
    type BranchSlice,
    type Branch,
} from './slices'
import type { ChatMessage, ContextItem } from '../types'
import type { CompressionStats } from '../core/types'
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

export type AgentStore = ThreadSlice & MessageSlice & CheckpointSlice & StreamSlice & BranchSlice & ContextCompressionState & UIState

// ===== 流式响应节流优化 =====

class StreamingBuffer {
    private buffer: Map<string, string> = new Map()
    private rafId: number | null = null
    private flushCallback: ((messageId: string, content: string) => void) | null = null
    private lastFlushTime = 0
    private readonly FLUSH_INTERVAL = 16 // 约 60fps

    setFlushCallback(callback: (messageId: string, content: string) => void) {
        this.flushCallback = callback
    }

    append(messageId: string, content: string): void {
        if (!content) return
        const existing = this.buffer.get(messageId) || ''
        this.buffer.set(messageId, existing + content)
        this.scheduleFlush()
    }

    private scheduleFlush(): void {
        if (this.rafId !== null) return
        
        const now = performance.now()
        const elapsed = now - this.lastFlushTime
        
        if (elapsed >= this.FLUSH_INTERVAL) {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null
                this.flush()
            })
        } else {
            // 使用 rAF 延迟执行
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null
                this.scheduleFlush()
            })
        }
    }

    private flush(): void {
        if (!this.flushCallback || this.buffer.size === 0) return
        this.lastFlushTime = performance.now()
        
        // 取出并清空 buffer
        const updates = new Map(this.buffer)
        this.buffer.clear()
        
        updates.forEach((content, messageId) => {
            if (content) {
                this.flushCallback!(messageId, content)
            }
        })
    }

    flushNow(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        this.flush()
    }

    clear(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId)
            this.rafId = null
        }
        this.buffer.clear()
    }
}

const streamingBuffer = new StreamingBuffer()

// 导出刷新函数，供外部在关键时刻调用
export function flushStreamingBuffer(): void {
    streamingBuffer.flushNow()
}

// ===== Store 实现 =====

export const useAgentStore = create<AgentStore>()(
    persist(
        (...args) => {
            // 创建各个 slice
            const threadSlice = createThreadSlice(...args)
            const messageSlice = createMessageSlice(...args)
            const checkpointSlice = createCheckpointSlice(...args)
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
                setCompressionStats: (stats) => {
                    // 存储到当前线程
                    const state = get()
                    const threadId = state.currentThreadId
                    if (threadId && state.threads[threadId]) {
                        state.threads[threadId].compressionStats = stats
                        set({ 
                            compressionStats: stats,
                            threads: { ...state.threads }
                        })
                    } else {
                        set({ compressionStats: stats })
                    }
                },
                setHandoffDocument: (doc) => set({ handoffDocument: doc }),
                setHandoffRequired: (required) => set({ handoffRequired: required }),
                setContextSummary: (summary) => set({ contextSummary: summary }),
                setIsCompacting: (compacting) => set({ isCompacting: compacting }),
                setCompressionPhase: (phase) => set({ compressionPhase: phase }),
                createHandoffSession: () => {
                    const state = get()
                    const handoff = state.handoffDocument
                    
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
                    })
                    
                    // 存储 handoff 上下文到线程元数据
                    const threads = get().threads
                    if (threads[newThreadId]) {
                        threads[newThreadId].handoffContext = handoffContext
                        // 存储待完成任务，用于自动继续
                        threads[newThreadId].pendingObjective = handoff.summary.objective
                        threads[newThreadId].pendingSteps = handoff.summary.pendingSteps
                        set({ threads: { ...threads } })
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
                setContextStats: (stats) => set({ contextStats: stats }),
                setInputPrompt: (prompt) => set({ inputPrompt: prompt }),
                setCurrentSessionId: (id) => set({ currentSessionId: id }),
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

            // 添加内部方法：刷新指定消息的文本缓冲区
            const _flushTextBuffer = (_messageId: string) => {
                streamingBuffer.flushNow()
            }

            return {
                ...threadSlice,
                ...messageSlice,
                ...checkpointSlice,
                ...streamSlice,
                ...branchSlice,
                ...contextCompressionState,
                ...uiState,
                _flushTextBuffer,
            }
        },
        {
            name: 'adnify-agent-store',
            storage: createJSONStorage(() => agentStorage),
            partialize: (state) => ({
                threads: state.threads,
                currentThreadId: state.currentThreadId,
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
const MAINLINE_BRANCH_ID = '__mainline__'

// 缓存：threadId -> 过滤后的分支数组
const filteredBranchesCache = new Map<string, { branches: Branch[]; filtered: Branch[] }>()

export const selectBranches = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return EMPTY_BRANCHES
    
    const allBranches = state.branches[threadId]
    if (!allBranches || allBranches.length === 0) return EMPTY_BRANCHES
    
    // 检查缓存
    const cached = filteredBranchesCache.get(threadId)
    if (cached && cached.branches === allBranches) {
        return cached.filtered
    }
    
    // 过滤并缓存
    const filtered = allBranches.filter(b => b.id !== MAINLINE_BRANCH_ID)
    filteredBranchesCache.set(threadId, { branches: allBranches, filtered })
    
    return filtered
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
export const selectCompressionStats = (state: AgentStore) => {
    // 优先从当前线程读取
    const threadId = state.currentThreadId
    if (threadId && state.threads[threadId]?.compressionStats) {
        return state.threads[threadId].compressionStats
    }
    // 降级到全局状态（兼容旧数据）
    return state.compressionStats
}
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
        // 使用类型安全的方式访问 persist API
        const store = useAgentStore as typeof useAgentStore & {
            persist?: { rehydrate: () => Promise<void> }
        }
        if (store.persist) {
            await store.persist.rehydrate()
            logger.agent.info('[AgentStore] Rehydrated from project storage')
        }

        const { initializeTools } = await import('../tools')
        await initializeTools()
        logger.agent.info('[AgentStore] Tools initialized')
        
        // 监听线程切换，重置压缩状态
        let lastThreadId = useAgentStore.getState().currentThreadId
        
        useAgentStore.subscribe((state) => {
            if (state.currentThreadId !== lastThreadId) {
                lastThreadId = state.currentThreadId
                // 重置 handoff 状态（但不重置 compressionStats，它现在存储在线程中）
                useAgentStore.getState().setHandoffRequired(false)
                useAgentStore.getState().setHandoffDocument(null)
                logger.agent.info('[AgentStore] Thread changed, handoff state reset')
            }
        })
    } catch (error) {
        logger.agent.error('[AgentStore] Failed to initialize:', error)
    }
}
