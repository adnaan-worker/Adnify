/**
 * 消息管理 Slice
 * 负责消息的添加、更新、删除
 */

import type { StateCreator } from 'zustand'
import type {
    ChatMessage,
    UserMessage,
    AssistantMessage,
    ToolResultMessage,
    CheckpointMessage,
    MessageContent,
    ContextItem,
    ToolCall,
    ToolResultType,
    FileSnapshot,
    AssistantPart,
    ReasoningPart,
    SearchPart,
    InteractiveContent,
} from '../../types'
import { streamingBuffer } from '../StreamingBuffer'
import type { ThreadSlice } from './threadSlice'

// ===== 类型定义 =====

export interface MessageActions {
    // 消息操作（支持可选的 targetThreadId，默认使用 currentThreadId）
    addUserMessage: (content: MessageContent, contextItems?: ContextItem[], targetThreadId?: string) => string
    prepareExecution: (content: MessageContent, contextItems: ContextItem[], targetThreadId?: string) => { userMessageId: string, assistantId: string }
    addAssistantMessage: (content?: string, targetThreadId?: string) => string
    appendToAssistant: (messageId: string, content: string, targetThreadId?: string) => void
    finalizeAssistant: (messageId: string, targetThreadId?: string) => void
    finalizeTextBeforeToolCall: (messageId: string, targetThreadId?: string) => void
    updateMessage: (messageId: string, updates: Partial<ChatMessage>, targetThreadId?: string) => void
    addToolResult: (toolCallId: string, name: string, content: string, type: ToolResultType, rawParams?: Record<string, unknown>, targetThreadId?: string) => string
    addCheckpoint: (type: 'user_message' | 'tool_edit', fileSnapshots: Record<string, FileSnapshot>, targetThreadId?: string) => string
    clearMessages: (targetThreadId?: string) => void
    deleteMessagesAfter: (messageId: string, targetThreadId?: string) => void
    getMessages: (targetThreadId?: string) => ChatMessage[]

    // 工具调用操作
    addToolCallPart: (messageId: string, toolCall: Omit<ToolCall, 'status'>, targetThreadId?: string) => void
    updateToolCall: (messageId: string, toolCallId: string, updates: Partial<ToolCall>, targetThreadId?: string) => void

    // Reasoning 操作
    addReasoningPart: (messageId: string, targetThreadId?: string) => string
    updateReasoningPart: (messageId: string, partId: string, content: string, isStreaming?: boolean, targetThreadId?: string) => void
    finalizeReasoningPart: (messageId: string, partId: string, targetThreadId?: string) => void

    // Search 操作
    addSearchPart: (messageId: string, targetThreadId?: string) => string
    updateSearchPart: (messageId: string, partId: string, content: string, isStreaming?: boolean, append?: boolean, targetThreadId?: string) => void
    finalizeSearchPart: (messageId: string, partId: string, targetThreadId?: string) => void

    // 交互式内容操作
    setInteractive: (messageId: string, interactive: InteractiveContent, targetThreadId?: string) => void

    // 上下文操作
    addContextItem: (item: ContextItem, targetThreadId?: string) => void
    removeContextItem: (index: number, targetThreadId?: string) => void
    clearContextItems: (targetThreadId?: string) => void

    // 内部方法
    _doAppendToAssistant: (messageId: string, content: string, targetThreadId?: string) => void
}

export type MessageSlice = MessageActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()

// ===== Slice 创建器 =====

export const createMessageSlice: StateCreator<
    ThreadSlice & MessageSlice,
    [],
    [],
    MessageSlice
> = (set, get) => ({
    // 添加用户消息
    addUserMessage: (content, contextItems) => {
        let threadId = get().currentThreadId

        if (!threadId || !get().threads[threadId]) {
            threadId = get().createThread()
        }

        const message: UserMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now(),
            contextItems,
        }

        set(state => {
            const thread = state.threads[threadId!]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId!]: {
                        ...thread,
                        messages: [...thread.messages, message],
                        lastModified: Date.now(),
                    },
                },
            }
        })

        return message.id
    },

    // 批量初始化执行环境（性能优化：合并渲染与持久化）
    prepareExecution: (content, contextItems, targetThreadId) => {
        let threadId = targetThreadId || get().currentThreadId

        if (!threadId || !get().threads[threadId]) {
            threadId = get().createThread()
        }

        const userMessage: UserMessage = {
            id: generateId(),
            role: 'user',
            content,
            timestamp: Date.now(),
            contextItems: [...(contextItems || [])],
        }

        const assistantMessage: AssistantMessage = {
            id: generateId(),
            role: 'assistant',
            content: '',
            timestamp: Date.now() + 1, // 确保在用户消息之后
            isStreaming: true,
            parts: [],
            toolCalls: [],
        }

        set(state => {
            const thread = state.threads[threadId!]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId!]: {
                        ...thread,
                        messages: [...thread.messages, userMessage, assistantMessage],
                        lastModified: Date.now(),
                        streamState: { ...thread.streamState, phase: 'streaming' },
                        contextItems: [], // 同时清理上下文
                    },
                },
            }
        })

        return { userMessageId: userMessage.id, assistantId: assistantMessage.id }
    },

    // 添加助手消息
    addAssistantMessage: (content = '') => {
        const threadId = get().currentThreadId
        if (!threadId) return ''

        const message: AssistantMessage = {
            id: generateId(),
            role: 'assistant',
            content,
            timestamp: Date.now(),
            isStreaming: true,
            parts: content ? [{ type: 'text', content }] : [],
            toolCalls: [],
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [...thread.messages, message],
                        lastModified: Date.now(),
                        streamState: { ...thread.streamState, phase: 'streaming' },
                    },
                },
            }
        })

        return message.id
    },

    /**
     * 追加内容到助手消息
     * 
     * 通过 StreamingBuffer 进行节流优化，减少 React 渲染次数。
     * StreamingBuffer 会批量收集内容，然后调用 _doAppendToAssistant 执行实际更新。
     */
    appendToAssistant: (messageId, content, targetThreadId) => {
        streamingBuffer.append(messageId, content, targetThreadId)
    },

    // 内部方法：实际执行内容追加（由 StreamingBuffer 调用）
    _doAppendToAssistant: (messageId: string, content: string, targetThreadId?: string) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messageIdx = thread.messages.findIndex(
                msg => msg.id === messageId && msg.role === 'assistant'
            )
            if (messageIdx === -1) return state

            const assistantMsg = thread.messages[messageIdx] as AssistantMessage
            const newContent = assistantMsg.content + content

            let newParts: AssistantPart[]
            const lastPart = assistantMsg.parts[assistantMsg.parts.length - 1]

            // 检查是否有 _textFinalized 标记（表示文本已结束，工具调用即将开始）
            const textFinalized = (assistantMsg as any)._textFinalized

            // 如果文本已 finalized，或最后一个 part 不是 text，创建新的 text part
            if (textFinalized || !lastPart || lastPart.type !== 'text') {
                newParts = [...assistantMsg.parts, { type: 'text', content }]
                // 清除 finalized 标记
                delete (assistantMsg as any)._textFinalized
            } else {
                // 追加到现有的 text part
                newParts = [...assistantMsg.parts]
                newParts[newParts.length - 1] = { type: 'text', content: lastPart.content + content }
            }

            const newMessages = [...thread.messages]
            newMessages[messageIdx] = { ...assistantMsg, content: newContent, parts: newParts }

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages: newMessages, lastModified: Date.now() },
                },
            }
        })
    },

    // 完成助手消息
    finalizeAssistant: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    return { ...msg, isStreaming: false }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages,
                        streamState: { ...thread.streamState, phase: 'idle' },
                    },
                },
            }
        })
    },

    /**
     * 在工具调用前结束文本输出
     * 确保工具调用出现在文本之后的正确位置
     */
    finalizeTextBeforeToolCall: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messageIdx = thread.messages.findIndex(
                msg => msg.id === messageId && msg.role === 'assistant'
            )
            if (messageIdx === -1) return state

            const assistantMsg = thread.messages[messageIdx] as AssistantMessage
            const lastPart = assistantMsg.parts[assistantMsg.parts.length - 1]

            // 如果最后一个 part 是 text 且正在流式输出，标记为已完成
            // 这样后续的工具调用会作为新的 part 添加，而不是插入到文本中间
            if (lastPart && lastPart.type === 'text') {
                // 添加一个标记，表示这个文本 part 已经完成
                // 后续的 appendToAssistant 会创建新的 text part
                const newMessages = [...thread.messages]
                newMessages[messageIdx] = {
                    ...assistantMsg,
                    _textFinalized: true, // 内部标记
                }

                return {
                    threads: {
                        ...state.threads,
                        [threadId]: { ...thread, messages: newMessages },
                    },
                }
            }

            return state
        })
    },

    // 更新消息
    updateMessage: (messageId, updates) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId) {
                    return { ...msg, ...updates } as ChatMessage
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages, lastModified: Date.now() },
                },
            }
        })
    },

    // 添加工具结果
    addToolResult: (toolCallId, name, content, type, rawParams) => {
        const threadId = get().currentThreadId
        if (!threadId) return ''

        const message: ToolResultMessage = {
            id: generateId(),
            role: 'tool',
            toolCallId,
            name,
            content,
            timestamp: Date.now(),
            type,
            rawParams,
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [...thread.messages, message],
                        lastModified: Date.now(),
                    },
                },
            }
        })

        return message.id
    },

    // 添加检查点
    addCheckpoint: (type, fileSnapshots) => {
        const threadId = get().currentThreadId
        if (!threadId) return ''

        const message: CheckpointMessage = {
            id: generateId(),
            role: 'checkpoint',
            type,
            timestamp: Date.now(),
            fileSnapshots,
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const newMessages = [...thread.messages, message]

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: newMessages,
                    },
                },
            }
        })

        return message.id
    },

    // 清空消息（同时清理检查点和待确认更改）
    clearMessages: () => {
        const threadId = get().currentThreadId
        if (!threadId) return

        // 压缩状态会在 store 中重置

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: [],
                        contextItems: [],
                        lastModified: Date.now(),
                        state: { currentCheckpointIdx: null, isStreaming: false },
                    },
                },
                // 同时清理检查点和待确认更改
                messageCheckpoints: [],
                pendingChanges: [],
            }
        })

        // 清理工具调用日志（在 useStore 中）
        // 注意：这里需要导入 useStore，但为了避免循环依赖，我们在调用处处理
    },

    // 删除指定消息之后的所有消息
    deleteMessagesAfter: (messageId) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        // 重置 handoff 状态（回退消息后可能不再需要 handoff）

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const index = thread.messages.findIndex(m => m.id === messageId)
            if (index === -1) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: thread.messages.slice(0, index + 1),
                        lastModified: Date.now(),
                    },
                },
                // 重置 handoff 相关状态
                handoffRequired: false,
                handoffDocument: null,
                compressionStats: null,
            }
        })
    },

    // 获取消息列表
    getMessages: () => {
        const thread = get().getCurrentThread()
        return thread?.messages || []
    },

    // 添加工具调用部分
    addToolCallPart: (messageId, toolCall) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        // 关键修复：在添加工具调用 part 之前，先刷新文本缓冲区
        // 这确保了工具调用 part 会出现在正确的位置（在之前的文本之后）
        // 注意：这个调用是同步的，不会影响性能
        const store = get() as any
        if (store._flushTextBuffer) {
            store._flushTextBuffer(messageId)
        }

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage

                    if (assistantMsg.toolCalls?.some(tc => tc.id === toolCall.id)) {
                        return msg
                    }

                    const newToolCall: ToolCall = { ...toolCall, status: 'pending' }
                    const newParts: AssistantPart[] = [...assistantMsg.parts, { type: 'tool_call', toolCall: newToolCall }]
                    const newToolCalls = [...(assistantMsg.toolCalls || []), newToolCall]

                    return { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })
    },

    // 更新工具调用（如果不存在则添加）
    updateToolCall: (messageId, toolCallId, updates) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            let updated = false
            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage

                    // 检查工具调用是否已存在
                    const existingToolCall = assistantMsg.toolCalls?.find(tc => tc.id === toolCallId)

                    if (existingToolCall) {
                        // 更新已存在的工具调用
                        updated = true

                        // 只合并非 undefined 的字段
                        const cleanUpdates = Object.fromEntries(
                            Object.entries(updates).filter(([_, v]) => v !== undefined)
                        ) as Partial<ToolCall>

                        // 自动清理：如果状态变为非pending/awaiting，自动清除streamingState
                        if (cleanUpdates.status && !['pending', 'awaiting'].includes(cleanUpdates.status)) {
                            if (cleanUpdates.streamingState === undefined) {
                                // 已经显式设置为undefined，保持
                            } else if (!('streamingState' in cleanUpdates)) {
                                // 没有提供streamingState，自动清除
                                cleanUpdates.streamingState = undefined
                            }
                        }

                        // 创建新的 toolCall 对象（确保引用变化）
                        const updatedToolCall = { ...existingToolCall, ...cleanUpdates }

                        const newParts = assistantMsg.parts.map(part => {
                            if (part.type === 'tool_call' && part.toolCall.id === toolCallId) {
                                return { ...part, toolCall: updatedToolCall }
                            }
                            return part
                        })

                        const newToolCalls = assistantMsg.toolCalls?.map(tc =>
                            tc.id === toolCallId ? updatedToolCall : tc
                        )

                        return { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }
                    } else {
                        // 工具调用不存在，添加新的
                        updated = true

                        const newToolCall: ToolCall = {
                            id: toolCallId,
                            name: (updates.name as string) || '',
                            arguments: (updates.arguments as Record<string, unknown>) || {},
                            status: (updates.status as ToolCall['status']) || 'pending',
                            ...updates,
                        }
                        const newParts: AssistantPart[] = [...assistantMsg.parts, { type: 'tool_call', toolCall: newToolCall }]
                        const newToolCalls = [...(assistantMsg.toolCalls || []), newToolCall]

                        return { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }
                    }
                }
                return msg
            })

            // 如果没有更新，返回原状态避免不必要的重渲染
            if (!updated) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages, lastModified: Date.now() },
                },
            }
        })
    },

    // 添加推理部分
    addReasoningPart: (messageId) => {
        const threadId = get().currentThreadId
        if (!threadId) return ''

        const partId = `reasoning-${Date.now()}`

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newPart: ReasoningPart = {
                        type: 'reasoning',
                        content: '',
                        startTime: Date.now(),
                        isStreaming: true,
                    }
                    // 临时添加 id 用于查找，但不包含在类型中
                    const partWithId = { ...newPart, id: partId }
                    return { ...assistantMsg, parts: [...assistantMsg.parts, partWithId as ReasoningPart] }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })

        return partId
    },

    // 更新推理部分
    updateReasoningPart: (messageId, partId, content, isStreaming = true) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newParts = assistantMsg.parts.map(part => {
                        // 使用临时 id 属性进行匹配
                        const partWithId = part as ReasoningPart & { id?: string }
                        if (part.type === 'reasoning' && partWithId.id === partId) {
                            return { ...part, content: (part as ReasoningPart).content + content, isStreaming }
                        }
                        return part
                    })
                    return { ...assistantMsg, parts: newParts }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })
    },

    // 完成推理部分
    finalizeReasoningPart: (messageId, partId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newParts = assistantMsg.parts.map(part => {
                        // 使用临时 id 属性进行匹配
                        const partWithId = part as ReasoningPart & { id?: string }
                        if (part.type === 'reasoning' && partWithId.id === partId) {
                            return { ...part, isStreaming: false }
                        }
                        return part
                    })
                    return { ...assistantMsg, parts: newParts }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })
    },

    // 添加搜索部分
    addSearchPart: (messageId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return ''

        const partId = `search-${Date.now()}`

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newPart: SearchPart = {
                        type: 'search',
                        content: '',
                        isStreaming: true,
                    }
                    // 临时添加 id 用于查找
                    const partWithId = { ...newPart, id: partId }
                    return { ...assistantMsg, parts: [...assistantMsg.parts, partWithId as SearchPart] }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })

        return partId
    },

    // 更新搜索部分
    updateSearchPart: (messageId, partId, content, isStreaming = true, append = false, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newParts = assistantMsg.parts.map(part => {
                        const partWithId = part as SearchPart & { id?: string }
                        if (part.type === 'search' && partWithId.id === partId) {
                            const newContent = append ? (part as SearchPart).content + content : content
                            return { ...part, content: newContent, isStreaming }
                        }
                        return part
                    })
                    return { ...assistantMsg, parts: newParts }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })
    },

    // 完成搜索部分
    finalizeSearchPart: (messageId, partId, targetThreadId) => {
        const threadId = targetThreadId || get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    const newParts = assistantMsg.parts.map(part => {
                        const partWithId = part as SearchPart & { id?: string }
                        if (part.type === 'search' && partWithId.id === partId) {
                            return { ...part, isStreaming: false }
                        }
                        return part
                    })
                    return { ...assistantMsg, parts: newParts }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
                },
            }
        })
    },

    // 设置交互式内容（用于 ask_user 工具）
    setInteractive: (messageId, interactive) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    return { ...msg, interactive, isStreaming: false }
                }
                return msg
            })

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages,
                        streamState: { ...thread.streamState, phase: 'idle' },
                        lastModified: Date.now(),
                    },
                },
            }
        })
    },

    // 添加上下文项
    addContextItem: (item) => {
        let threadId = get().currentThreadId

        if (!threadId || !get().threads[threadId]) {
            threadId = get().createThread()
        }

        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            const exists = thread.contextItems.some(existing => {
                if (existing.type !== item.type) return false
                if ('uri' in existing && 'uri' in item) {
                    return existing.uri === item.uri
                }
                return existing.type === item.type
            })

            if (exists) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        contextItems: [...thread.contextItems, item],
                    },
                },
            }
        })
    },

    // 移除上下文项
    removeContextItem: (index) => {
        const threadId = get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        contextItems: thread.contextItems.filter((_, i) => i !== index),
                    },
                },
            }
        })
    },

    // 清空上下文项
    clearContextItems: () => {
        const threadId = get().currentThreadId
        if (!threadId) return

        set(state => {
            const thread = state.threads[threadId]
            if (!thread) return state

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, contextItems: [] },
                },
            }
        })
    },
})
