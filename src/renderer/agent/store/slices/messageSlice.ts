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
    InteractiveContent,
} from '../../types'
// 注意：不再使用 contextManager，压缩逻辑在 loop.ts 中处理
import type { ThreadSlice } from './threadSlice'

// ===== 类型定义 =====

export interface MessageActions {
    addUserMessage: (content: MessageContent, contextItems?: ContextItem[]) => string
    addAssistantMessage: (content?: string) => string
    appendToAssistant: (messageId: string, content: string) => void
    finalizeAssistant: (messageId: string) => void
    updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void
    addToolResult: (toolCallId: string, name: string, content: string, type: ToolResultType, rawParams?: Record<string, unknown>) => string
    addCheckpoint: (type: 'user_message' | 'tool_edit', fileSnapshots: Record<string, FileSnapshot>) => string
    clearMessages: () => void
    deleteMessagesAfter: (messageId: string) => void
    getMessages: () => ChatMessage[]

    // 工具调用操作
    addToolCallPart: (messageId: string, toolCall: Omit<ToolCall, 'status'>) => void
    updateToolCall: (messageId: string, toolCallId: string, updates: Partial<ToolCall>) => void

    // Reasoning 操作
    addReasoningPart: (messageId: string) => string
    updateReasoningPart: (messageId: string, partId: string, content: string, isStreaming?: boolean) => void
    finalizeReasoningPart: (messageId: string, partId: string) => void

    // 交互式内容操作
    setInteractive: (messageId: string, interactive: InteractiveContent) => void

    // 上下文操作
    addContextItem: (item: ContextItem) => void
    removeContextItem: (index: number) => void
    clearContextItems: () => void

    // 内部方法
    _doAppendToAssistant: (messageId: string, content: string) => void
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
                        state: { ...thread.state, isStreaming: true },
                    },
                },
            }
        })

        return message.id
    },

    /**
     * 追加内容到助手消息
     * 
     * 注意：此方法在 AgentStore.ts 中被重写，使用 StreamingBuffer 进行节流优化。
     * StreamingBuffer 会批量收集内容，然后调用 _doAppendToAssistant 执行实际更新。
     * 
     * @see AgentStore.ts - StreamingBuffer 实现
     * @see _doAppendToAssistant - 实际执行内容追加的方法
     */
    appendToAssistant: (_messageId, _content) => {
        // 占位实现 - 在 AgentStore.ts 中被 StreamingBuffer 重写
        // 直接调用此方法不会有任何效果
    },

    // 内部方法：实际执行内容追加（由 StreamingBuffer 调用）
    _doAppendToAssistant: (messageId: string, content: string) => {
        const threadId = get().currentThreadId
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

            if (lastPart && lastPart.type === 'text') {
                newParts = [...assistantMsg.parts]
                newParts[newParts.length - 1] = { type: 'text', content: lastPart.content + content }
            } else {
                newParts = [...assistantMsg.parts, { type: 'text', content }]
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
    finalizeAssistant: (messageId) => {
        const threadId = get().currentThreadId
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
                        state: { ...thread.state, isStreaming: false },
                    },
                },
            }
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
            const checkpointIdx = newMessages.length - 1

            return {
                threads: {
                    ...state.threads,
                    [threadId]: {
                        ...thread,
                        messages: newMessages,
                        state: { ...thread.state, currentCheckpointIdx: checkpointIdx },
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

            const messages = thread.messages.map(msg => {
                if (msg.id === messageId && msg.role === 'assistant') {
                    const assistantMsg = msg as AssistantMessage
                    
                    // 检查工具调用是否已存在
                    const existingToolCall = assistantMsg.toolCalls?.find(tc => tc.id === toolCallId)
                    
                    if (existingToolCall) {
                        // 更新已存在的工具调用
                        const newParts = assistantMsg.parts.map(part => {
                            if (part.type === 'tool_call' && part.toolCall.id === toolCallId) {
                                return { ...part, toolCall: { ...part.toolCall, ...updates } }
                            }
                            return part
                        })

                        const newToolCalls = assistantMsg.toolCalls?.map(tc =>
                            tc.id === toolCallId ? { ...tc, ...updates } : tc
                        )

                        return { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }
                    } else {
                        // 工具调用不存在，添加新的
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

            return {
                threads: {
                    ...state.threads,
                    [threadId]: { ...thread, messages },
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
    finalizeReasoningPart: (messageId, partId) => {
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
                        state: { ...thread.state, isStreaming: false },
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
