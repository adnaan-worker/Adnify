import { StateCreator } from 'zustand'
import {
    ChatThread,
    ChatMessage,
    UserMessage,
    AssistantMessage,
    ToolResultMessage,
    CheckpointMessage,
    ContextItem,
    MessageContent,
    FileSnapshot,
    ToolResultType,
    AssistantPart,
    MessageCheckpoint,
    PendingChange,
    ToolCall,
    // Type guards
    isAssistantMessage,
    isTextPart,
} from '../types'
import { MessageRole, ToolStatus } from '../enums'
import { AgentStore } from './index'
import { StreamingBuffer } from '../StreamingBuffer'

export interface ThreadSlice {
    // State
    threads: Record<string, ChatThread>
    currentThreadId: string | null
    messageCheckpoints: MessageCheckpoint[]
    pendingChanges: PendingChange[]

    // Actions
    createThread: () => string
    switchThread: (threadId: string) => void
    deleteThread: (threadId: string) => void

    addUserMessage: (content: MessageContent, contextItems?: ContextItem[]) => string
    addAssistantMessage: (content?: string) => string
    appendToAssistant: (messageId: string, content: string) => void
    _doAppendToAssistant: (messageId: string, content: string) => void
    finalizeAssistant: (messageId: string) => void
    updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void
    addToolCallPart: (messageId: string, toolCall: Omit<ToolCall, 'status'>) => void
    updateToolCall: (messageId: string, toolCallId: string, updates: Partial<ToolCall>) => void
    addToolResult: (toolCallId: string, name: string, content: string, type: ToolResultType, rawParams?: Record<string, unknown>) => string
    addCheckpoint: (type: 'user_message' | 'tool_edit', fileSnapshots: Record<string, FileSnapshot>) => string
    clearMessages: () => void
    deleteMessagesAfter: (messageId: string) => void

    addContextItem: (item: ContextItem) => void
    removeContextItem: (index: number) => void
    clearContextItems: () => void

    // Pending Changes
    addPendingChange: (change: Omit<PendingChange, 'id' | 'timestamp' | 'status'>) => void
    acceptAllChanges: () => void
    undoAllChanges: () => Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }>
    acceptChange: (filePath: string) => void
    undoChange: (filePath: string) => Promise<boolean>
    clearPendingChanges: () => void

    // Checkpoints
    createMessageCheckpoint: (messageId: string, description: string) => Promise<string>
    addSnapshotToCurrentCheckpoint: (filePath: string, content: string | null) => void
    restoreToCheckpoint: (checkpointId: string) => Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }>
    getCheckpointForMessage: (messageId: string) => MessageCheckpoint | null
    clearMessageCheckpoints: () => void

    // Getters
    getCurrentThread: () => ChatThread | null
    getMessages: () => ChatMessage[]
    getPendingChanges: () => PendingChange[]
    getMessageCheckpoints: () => MessageCheckpoint[]
}

const generateId = () => crypto.randomUUID()

const createEmptyThread = (): ChatThread => ({
    id: generateId(),
    createdAt: Date.now(),
    lastModified: Date.now(),
    messages: [],
    contextItems: [],
    state: {
        currentCheckpointIdx: null,
        isStreaming: false,
    },
})

// Singleton buffer instance
let streamingBuffer: StreamingBuffer | null = null

export const createThreadSlice: StateCreator<AgentStore, [], [], ThreadSlice> = (set, get) => {
    // Initialize buffer lazily
    if (!streamingBuffer) {
        streamingBuffer = new StreamingBuffer((messageId, content) => {
            get()._doAppendToAssistant(messageId, content)
        })
    }

    return {
        threads: {},
        currentThreadId: null,
        messageCheckpoints: [],
        pendingChanges: [],

        createThread: () => {
            const thread = createEmptyThread()
            set((state) => ({
                threads: { ...state.threads, [thread.id]: thread },
                currentThreadId: thread.id,
            }))
            return thread.id
        },

        switchThread: (threadId) => {
            if (get().threads[threadId]) {
                set({ currentThreadId: threadId })
            }
        },

        deleteThread: (threadId) => {
            set((state) => {
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

        addUserMessage: (content, contextItems) => {
            const state = get()
            let threadId = state.currentThreadId

            if (!threadId || !state.threads[threadId]) {
                threadId = get().createThread()
            }

            const message: UserMessage = {
                id: generateId(),
                role: MessageRole.User,
                content,
                timestamp: Date.now(),
                contextItems,
            }

            set((state) => {
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

        addAssistantMessage: (content = '') => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return ''

            const message: AssistantMessage = {
                id: generateId(),
                role: MessageRole.Assistant,
                content,
                timestamp: Date.now(),
                isStreaming: true,
                parts: content ? [{ type: 'text', content }] : [],
                toolCalls: [],
            }

            set((state) => {
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

        appendToAssistant: (messageId, content) => {
            streamingBuffer?.append(messageId, content)
        },

        _doAppendToAssistant: (messageId, content) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
                const thread = state.threads[threadId]
                if (!thread) return state

                const messageIdx = thread.messages.findIndex(
                    msg => msg.id === messageId && isAssistantMessage(msg)
                )
                if (messageIdx === -1) return state

                const assistantMsg = thread.messages[messageIdx] as AssistantMessage
                const newContent = assistantMsg.content + content

                let newParts: AssistantPart[]
                const lastPart = assistantMsg.parts[assistantMsg.parts.length - 1]

                if (lastPart && isTextPart(lastPart)) {
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

        finalizeAssistant: (messageId) => {
            streamingBuffer?.flushNow()

            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
                const thread = state.threads[threadId]
                if (!thread) return state

                const messages = thread.messages.map(msg => {
                    if (msg.id === messageId && msg.role === MessageRole.Assistant) {
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

        updateMessage: (messageId, updates) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
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

        addToolCallPart: (messageId, toolCall) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
                const thread = state.threads[threadId]
                if (!thread) return state

                const messageIdx = thread.messages.findIndex(m => m.id === messageId && isAssistantMessage(m))
                if (messageIdx === -1) return state

                const assistantMsg = thread.messages[messageIdx] as AssistantMessage
                const newToolCall: ToolCall = { ...toolCall, status: ToolStatus.Pending }

                const newParts = [...assistantMsg.parts, { type: 'tool_call', toolCall: newToolCall } as const]
                const newToolCalls = [...(assistantMsg.toolCalls || []), newToolCall]

                const newMessages = [...thread.messages]
                newMessages[messageIdx] = { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }

                return {
                    threads: {
                        ...state.threads,
                        [threadId]: { ...thread, messages: newMessages, lastModified: Date.now() }
                    }
                }
            })
        },

        updateToolCall: (messageId, toolCallId, updates) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
                const thread = state.threads[threadId]
                if (!thread) return state

                const messageIdx = thread.messages.findIndex(m => m.id === messageId && isAssistantMessage(m))
                if (messageIdx === -1) return state

                const assistantMsg = thread.messages[messageIdx] as AssistantMessage

                const newToolCalls = (assistantMsg.toolCalls || []).map(tc =>
                    tc.id === toolCallId ? { ...tc, ...updates } : tc
                )

                const newParts = assistantMsg.parts.map(part => {
                    if (part.type === 'tool_call' && part.toolCall.id === toolCallId) {
                        return { ...part, toolCall: { ...part.toolCall, ...updates } }
                    }
                    return part
                })

                const newMessages = [...thread.messages]
                newMessages[messageIdx] = { ...assistantMsg, parts: newParts, toolCalls: newToolCalls }

                return {
                    threads: {
                        ...state.threads,
                        [threadId]: { ...thread, messages: newMessages, lastModified: Date.now() }
                    }
                }
            })
        },

        addToolResult: (toolCallId, name, content, type, rawParams) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return ''

            const message: ToolResultMessage = {
                id: generateId(),
                role: MessageRole.Tool,
                toolCallId,
                name,
                content,
                timestamp: Date.now(),
                type,
                rawParams,
            }

            set((state) => {
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

        addCheckpoint: (type, fileSnapshots) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return ''

            const message: CheckpointMessage = {
                id: generateId(),
                role: MessageRole.Checkpoint,
                type,
                timestamp: Date.now(),
                fileSnapshots,
            }

            set((state) => {
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

        clearMessages: () => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
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
                }
            })
        },

        deleteMessagesAfter: (messageId) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
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
                }
            })
        },

        addContextItem: (item) => {
            let state = get()
            let threadId = state.currentThreadId

            if (!threadId || !state.threads[threadId]) {
                threadId = get().createThread()
                state = get()
            }

            if (!threadId) return

            set((state) => {
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

        removeContextItem: (index) => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
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

        clearContextItems: () => {
            const state = get()
            const threadId = state.currentThreadId
            if (!threadId) return

            set((state) => {
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

        addPendingChange: (change) => {
            set((state) => {
                const existingIdx = state.pendingChanges.findIndex(c => c.filePath === change.filePath)
                if (existingIdx !== -1) {
                    const existing = state.pendingChanges[existingIdx]
                    const updated = [...state.pendingChanges]
                    updated[existingIdx] = {
                        ...existing,
                        toolCallId: change.toolCallId,
                        toolName: change.toolName,
                        linesAdded: existing.linesAdded + change.linesAdded,
                        linesRemoved: existing.linesRemoved + change.linesRemoved,
                    }
                    return { pendingChanges: updated }
                }

                const newChange: PendingChange = {
                    ...change,
                    id: crypto.randomUUID(),
                    status: 'pending',
                    timestamp: Date.now(),
                }
                return { pendingChanges: [...state.pendingChanges, newChange] }
            })
        },

        acceptAllChanges: () => {
            set({ pendingChanges: [] })
        },

        undoAllChanges: async () => {
            const state = get()
            const changes = state.pendingChanges
            const restoredFiles: string[] = []
            const errors: string[] = []

            for (const change of changes) {
                try {
                    if (change.snapshot.content === null) {
                        const deleted = await window.electronAPI.deleteFile(change.filePath)
                        if (deleted) {
                            restoredFiles.push(change.filePath)
                        } else {
                            errors.push(`Failed to delete: ${change.filePath}`)
                        }
                    } else {
                        const written = await window.electronAPI.writeFile(change.filePath, change.snapshot.content)
                        if (written) {
                            restoredFiles.push(change.filePath)
                        } else {
                            errors.push(`Failed to restore: ${change.filePath}`)
                        }
                    }
                } catch (e) {
                    errors.push(`Error restoring ${change.filePath}: ${e}`)
                }
            }

            set({ pendingChanges: [] })

            return {
                success: errors.length === 0,
                restoredFiles,
                errors
            }
        },

        acceptChange: (filePath) => {
            set((state) => ({
                pendingChanges: state.pendingChanges.filter(c => c.filePath !== filePath)
            }))
        },

        undoChange: async (filePath) => {
            const state = get()
            const change = state.pendingChanges.find(c => c.filePath === filePath)
            if (!change) return false

            try {
                if (change.snapshot.content === null) {
                    await window.electronAPI.deleteFile(filePath)
                } else {
                    await window.electronAPI.writeFile(filePath, change.snapshot.content)
                }
                set((state) => ({
                    pendingChanges: state.pendingChanges.filter(c => c.filePath !== filePath)
                }))
                return true
            } catch (e) {
                return false
            }
        },

        clearPendingChanges: () => {
            set({ pendingChanges: [] })
        },

        createMessageCheckpoint: async (messageId, description) => {
            const state = get()
            const thread = state.getCurrentThread()
            if (!thread) return ''

            const id = generateId()
            const checkpoint: MessageCheckpoint = {
                id,
                messageId,
                timestamp: Date.now(),
                fileSnapshots: {}, // Needs implementation
                description
            }

            set(state => ({
                messageCheckpoints: [...state.messageCheckpoints, checkpoint]
            }))

            return id
        },

        addSnapshotToCurrentCheckpoint: (_filePath, _content) => {
            // Implementation placeholder
        },

        restoreToCheckpoint: async (_checkpointId) => {
            // Implementation placeholder
            return { success: true, restoredFiles: [], errors: [] }
        },

        getCheckpointForMessage: (messageId) => {
            return get().messageCheckpoints.find(cp => cp.messageId === messageId) || null
        },

        clearMessageCheckpoints: () => {
            set({ messageCheckpoints: [] })
        },

        getCurrentThread: () => {
            const state = get()
            return state.currentThreadId ? state.threads[state.currentThreadId] || null : null
        },

        getMessages: () => {
            const thread = get().getCurrentThread()
            return thread ? thread.messages : []
        },

        getPendingChanges: () => get().pendingChanges,
        getMessageCheckpoints: () => get().messageCheckpoints,
    }
}
