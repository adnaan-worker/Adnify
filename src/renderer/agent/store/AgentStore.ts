/**
 * Agent 状态管理
 * 使用 Zustand slice 模式组织代码
 * 
 * 架构原则：
 * - 所有线程相关状态只存于 ChatThread
 * - 切换线程只改变 currentThreadId，无需同步状态
 * - UI 通过 selector 从当前线程获取状态
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { logger } from '@utils/Logger'
import { agentStorage } from './agentStorage'
import { streamingBuffer, flushStreamingBuffer } from './StreamingBuffer'
import {
    createThreadSlice,
    createMessageSlice,
    createCheckpointSlice,
    createBranchSlice,
    type ThreadSlice,
    type MessageSlice,
    type CheckpointSlice,
    type BranchSlice,
    type Branch,
} from './slices'
import {
    createOrchestratorSlice,
    type OrchestratorSlice,
} from './slices/orchestratorSlice'
import type { ChatMessage, ContextItem, StreamState } from '../types'
import type { CompressionStats } from '../core/types'
import type { HandoffDocument, StructuredSummary } from '../context/types'
import { buildHandoffContext } from '../context/HandoffManager'
import type { EmotionDetection, EmotionHistory } from '../types/emotion'

// 重新导出刷新函数供外部使用
export { flushStreamingBuffer }

// ===== Store 类型 =====

// 上下文统计信息（用于底部栏显示）
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

// Handoff 会话创建结果
interface HandoffSessionResult {
    threadId: string
    autoResume: boolean
    objective: string
    pendingSteps: string[]
    fileChanges: Array<{ action: string; path: string; summary: string }>
}

// UI 相关状态（全局，非线程相关）
interface UIState {
    contextStats: ContextStats | null
    inputPrompt: string
    currentSessionId: string | null
    handoffDocument: HandoffDocument | null  // Handoff 文档（临时状态）
    // 代码审查状态
    codeReviewSession: import('../types/codeReview').CodeReviewSession | null
    reviewProgress: { current: number; total: number; currentFile: string } | null
    // 情绪感知状态
    emotionDetection: EmotionDetection | null
    emotionHistory: EmotionHistory[]
    setContextStats: (stats: ContextStats | null) => void
    setInputPrompt: (prompt: string) => void
    setCurrentSessionId: (id: string | null) => void
    setHandoffDocument: (doc: HandoffDocument | null) => void
    createHandoffSession: () => HandoffSessionResult | null
    // 代码审查方法
    setCodeReviewSession: (session: import('../types/codeReview').CodeReviewSession | null) => void
    updateReviewProgress: (current: number, total: number, currentFile: string) => void
    updateReviewComment: (comment: import('../types/codeReview').ReviewComment) => void
    // 情绪感知方法
    setEmotionDetection: (detection: EmotionDetection | null) => void
    updateEmotionHistory: (history: EmotionHistory) => void
}

// 线程绑定的 Store 操作接口
// 用于后台任务，确保操作不会影响其他线程
export interface ThreadBoundStore {
    readonly threadId: string

    // 消息操作
    addAssistantMessage: (content?: string) => string
    appendToAssistant: (messageId: string, content: string) => void
    finalizeAssistant: (messageId: string) => void
    finalizeTextBeforeToolCall: (messageId: string) => void
    updateMessage: (messageId: string, updates: Partial<import('../types').ChatMessage>) => void
    addToolResult: (toolCallId: string, name: string, content: string, type: import('../types').ToolResultType, rawParams?: Record<string, unknown>) => string

    // 工具调用操作
    addToolCallPart: (messageId: string, toolCall: Omit<import('../types').ToolCall, 'status'>) => void
    updateToolCall: (messageId: string, toolCallId: string, updates: Partial<import('../types').ToolCall>) => void

    // 状态操作
    setStreamState: (state: Partial<StreamState>) => void
    setStreamPhase: (phase: StreamState['phase']) => void
    setCompressionStats: (stats: CompressionStats | null) => void
    setContextSummary: (summary: StructuredSummary | null) => void
    setCompressionPhase: (phase: import('../types').CompressionPhase) => void
    setHandoffRequired: (required: boolean) => void
    setIsCompacting: (compacting: boolean) => void

    // Reasoning 操作
    addReasoningPart: (messageId: string) => string
    updateReasoningPart: (messageId: string, partId: string, content: string, isStreaming?: boolean) => void
    finalizeReasoningPart: (messageId: string, partId: string) => void

    // 交互式内容操作
    setInteractive: (messageId: string, interactive: import('../types').InteractiveContent) => void
}

export type AgentStore = ThreadSlice & MessageSlice & CheckpointSlice & BranchSlice & OrchestratorSlice & UIState & {
    _flushTextBuffer: (messageId: string) => void
    forThread: (threadId: string) => ThreadBoundStore
}

// ===== Store 实现 =====

export const useAgentStore = create<AgentStore>()(
    persist(
        (...args) => {
            // 创建各个 slice
            const threadSlice = createThreadSlice(...args)
            const messageSlice = createMessageSlice(...args)
            const checkpointSlice = createCheckpointSlice(...args)
            const branchSlice = createBranchSlice(...args)
            const orchestratorSlice = createOrchestratorSlice(...args)

            const [set, get] = args

            // 初始化 StreamingBuffer 的 callback（流式内容写入正确的线程）
            streamingBuffer.setFlushCallback((messageId, content, threadId) => {
                messageSlice._doAppendToAssistant(messageId, content, threadId)
            })

            // UI 状态（全局）
            const uiState: UIState = {
                contextStats: null,
                inputPrompt: '',
                currentSessionId: null,
                handoffDocument: null,
                codeReviewSession: null,
                reviewProgress: null,
                emotionDetection: null,
                emotionHistory: [],
                setContextStats: (stats) => set({ contextStats: stats }),
                setInputPrompt: (prompt) => set({ inputPrompt: prompt }),
                setCurrentSessionId: (id) => set({ currentSessionId: id }),
                setHandoffDocument: (doc) => set({ handoffDocument: doc }),
                createHandoffSession: () => {
                    const state = get()
                    const handoff = state.handoffDocument

                    if (!handoff) {
                        logger.agent.warn('[AgentStore] No handoff document to create session from')
                        return null
                    }

                    // 创建新线程
                    const newThreadId = threadSlice.createThread()

                    // 构建 handoff 上下文
                    const handoffContext = buildHandoffContext(handoff)

                    // 更新新线程的元数据
                    set(s => {
                        const thread = s.threads[newThreadId]
                        if (!thread) return s
                        return {
                            threads: {
                                ...s.threads,
                                [newThreadId]: {
                                    ...thread,
                                    handoffContext,
                                    pendingObjective: handoff.summary.objective,
                                    pendingSteps: handoff.summary.pendingSteps,
                                    contextSummary: handoff.summary,
                                }
                            },
                            handoffDocument: null,  // 清除 handoff 文档
                        }
                    })

                    logger.agent.info('[AgentStore] Created handoff session:', newThreadId)

                    return {
                        threadId: newThreadId,
                        autoResume: true,
                        objective: handoff.summary.objective,
                        pendingSteps: handoff.summary.pendingSteps,
                        fileChanges: handoff.summary.fileChanges,
                    }
                },
                // 代码审查方法
                setCodeReviewSession: (session) => set({ codeReviewSession: session }),
                updateReviewProgress: (current, total, currentFile) => 
                    set({ reviewProgress: { current, total, currentFile } }),
                updateReviewComment: (comment) => {
                    set(state => {
                        if (!state.codeReviewSession) return state
                        const files = state.codeReviewSession.files.map(file => {
                            const commentIndex = file.comments.findIndex(c => c.id === comment.id)
                            if (commentIndex === -1) return file
                            const newComments = [...file.comments]
                            newComments[commentIndex] = comment
                            return { ...file, comments: newComments }
                        })
                        return {
                            codeReviewSession: {
                                ...state.codeReviewSession,
                                files
                            }
                        }
                    })
                },
                // 情绪感知方法
                setEmotionDetection: (detection) => set({ emotionDetection: detection }),
                updateEmotionHistory: (history) => set(state => ({
                    emotionHistory: [...state.emotionHistory, history].slice(-1440) // 保留最近24小时
                })),
            }

            // 重写 finalizeAssistant 先刷新 StreamingBuffer
            const originalFinalizeAssistant = messageSlice.finalizeAssistant
            messageSlice.finalizeAssistant = (messageId: string, targetThreadId?: string) => {
                streamingBuffer.flushNow()
                originalFinalizeAssistant(messageId, targetThreadId)
            }

            // 内部方法：刷新文本缓冲区
            const _flushTextBuffer = (_messageId: string) => {
                streamingBuffer.flushNow()
            }

            // 创建线程绑定的 Store（用于后台任务）
            const forThread = (threadId: string): ThreadBoundStore => ({
                threadId,

                // 消息操作
                addAssistantMessage: (content) =>
                    messageSlice.addAssistantMessage(content, threadId),
                appendToAssistant: (messageId, content) => {
                    // 调用公开方法（经过 StreamingBuffer 缓冲），绑定 threadId
                    messageSlice.appendToAssistant(messageId, content, threadId)
                },
                finalizeAssistant: (messageId) =>
                    messageSlice.finalizeAssistant(messageId, threadId),
                finalizeTextBeforeToolCall: (messageId) =>
                    messageSlice.finalizeTextBeforeToolCall(messageId, threadId),
                updateMessage: (messageId, updates) =>
                    messageSlice.updateMessage(messageId, updates, threadId),
                addToolResult: (toolCallId, name, content, type, rawParams) =>
                    messageSlice.addToolResult(toolCallId, name, content, type, rawParams, threadId),

                // 工具调用操作
                addToolCallPart: (messageId, toolCall) =>
                    messageSlice.addToolCallPart(messageId, toolCall, threadId),
                updateToolCall: (messageId, toolCallId, updates) =>
                    messageSlice.updateToolCall(messageId, toolCallId, updates, threadId),

                // 状态操作
                setStreamState: (state) => threadSlice.setStreamState(state, threadId),
                setStreamPhase: (phase) => threadSlice.setStreamState({ phase }, threadId),
                setCompressionStats: (stats) => threadSlice.setCompressionStats(stats, threadId),
                setContextSummary: (summary) => threadSlice.setContextSummary(summary, threadId),
                setCompressionPhase: (phase) => threadSlice.setCompressionPhase(phase, threadId),
                setHandoffRequired: (required) => threadSlice.setHandoffRequired(required, threadId),
                setIsCompacting: (compacting) => threadSlice.setIsCompacting(compacting, threadId),

                // Reasoning 操作
                addReasoningPart: (messageId) =>
                    messageSlice.addReasoningPart(messageId, threadId),
                updateReasoningPart: (messageId, partId, content, isStreaming) =>
                    messageSlice.updateReasoningPart(messageId, partId, content, isStreaming, threadId),
                finalizeReasoningPart: (messageId, partId) =>
                    messageSlice.finalizeReasoningPart(messageId, partId, threadId),

                // 交互式内容操作
                setInteractive: (messageId, interactive) =>
                    messageSlice.setInteractive(messageId, interactive, threadId),
            })

            return {
                ...threadSlice,
                ...messageSlice,
                ...checkpointSlice,
                ...branchSlice,
                ...orchestratorSlice,
                ...uiState,
                _flushTextBuffer,
                forThread,
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
            }),
        }
    )
)

// ===== Selectors =====

const EMPTY_MESSAGES: ChatMessage[] = []
const EMPTY_CONTEXT_ITEMS: ContextItem[] = []
const DEFAULT_STREAM_STATE: StreamState = { phase: 'idle' }

export const selectCurrentThread = (state: AgentStore) => {
    if (!state.currentThreadId) return null
    return state.threads[state.currentThreadId] || null
}

export const selectMessages = (state: AgentStore) => {
    if (!state.currentThreadId) return EMPTY_MESSAGES
    const thread = state.threads[state.currentThreadId]
    return thread?.messages || EMPTY_MESSAGES
}

// 从当前线程获取流状态
export const selectStreamState = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    return thread?.streamState || DEFAULT_STREAM_STATE
}

export const selectContextItems = (state: AgentStore) => {
    if (!state.currentThreadId) return EMPTY_CONTEXT_ITEMS
    const thread = state.threads[state.currentThreadId]
    return thread?.contextItems || EMPTY_CONTEXT_ITEMS
}

export const selectIsStreaming = (state: AgentStore) => {
    const streamState = selectStreamState(state)
    return streamState.phase === 'streaming' || streamState.phase === 'tool_running'
}

export const selectIsAwaitingApproval = (state: AgentStore) => {
    const streamState = selectStreamState(state)
    return streamState.phase === 'tool_pending'
}

export const selectPendingChanges = (state: AgentStore) => state.pendingChanges

export const selectHasPendingChanges = (state: AgentStore) => state.pendingChanges.length > 0

export const selectMessageCheckpoints = (state: AgentStore) => state.messageCheckpoints

// 分支相关 selectors
const EMPTY_BRANCHES: Branch[] = []
const MAINLINE_BRANCH_ID = '__mainline__'

const filteredBranchesCache = new Map<string, { branches: Branch[]; filtered: Branch[] }>()

export const selectBranches = (state: AgentStore) => {
    const threadId = state.currentThreadId
    if (!threadId) return EMPTY_BRANCHES

    const allBranches = state.branches[threadId]
    if (!allBranches || allBranches.length === 0) return EMPTY_BRANCHES

    const cached = filteredBranchesCache.get(threadId)
    if (cached && cached.branches === allBranches) {
        return cached.filtered
    }

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

// 从当前线程获取压缩相关状态
export const selectContextStats = (state: AgentStore) => state.contextStats
export const selectInputPrompt = (state: AgentStore) => state.inputPrompt
export const selectCurrentSessionId = (state: AgentStore) => state.currentSessionId

export const selectCompressionStats = (state: AgentStore): CompressionStats | null => {
    const thread = selectCurrentThread(state)
    return thread?.compressionStats ?? null
}

export const selectHandoffDocument = (state: AgentStore) => state.handoffDocument

export const selectHandoffRequired = (state: AgentStore): boolean => {
    const thread = selectCurrentThread(state)
    return thread?.handoffRequired ?? false
}

export const selectContextSummary = (state: AgentStore): StructuredSummary | null => {
    const thread = selectCurrentThread(state)
    return thread?.contextSummary ?? null
}

export const selectCompressionPhase = (state: AgentStore) => {
    const thread = selectCurrentThread(state)
    return thread?.compressionPhase ?? 'idle'
}

export const selectIsCompacting = (state: AgentStore): boolean => {
    const thread = selectCurrentThread(state)
    return thread?.isCompacting ?? false
}

// ===== StreamingBuffer 初始化 =====

streamingBuffer.setFlushCallback((messageId: string, content: string) => {
    const store = useAgentStore.getState()
    store._doAppendToAssistant(messageId, content)
})

// ===== Store 初始化 =====

export async function initializeAgentStore(): Promise<void> {
    try {
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
    } catch (error) {
        logger.agent.error('[AgentStore] Failed to initialize:', error)
    }
}
