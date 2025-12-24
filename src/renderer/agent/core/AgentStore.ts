/**
 * Agent 状态管理
 * 参考 Cursor/Void 的架构设计
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { agentStorage } from './agentStorage'
import {
  ChatThread,
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  CheckpointMessage,
  ContextItem,
  StreamState,
  ToolCall,
  MessageContent,
  FileSnapshot,
  ToolResultType,
  AssistantPart,
  PendingChange,
  MessageCheckpoint,
  // 类型守卫
  isAssistantMessage,
  isTextPart,
  Plan,
  PlanItem,
} from './types'

// ===== Store 类型 =====

interface AgentState {
  // 线程管理
  threads: Record<string, ChatThread>
  currentThreadId: string | null

  // 流状态（不持久化）
  streamState: StreamState

  // 待确认的更改（不持久化）
  pendingChanges: PendingChange[]

  // 消息级别的检查点（不持久化，用于回退）
  messageCheckpoints: MessageCheckpoint[]

  // 配置
  autoApprove: {
    edits: boolean
    terminal: boolean
    dangerous: boolean
  }

  // Plan Mode 状态
  plan: Plan | null
}

interface AgentActions {
  // 线程操作
  createThread: () => string
  switchThread: (threadId: string) => void
  deleteThread: (threadId: string) => void

  // 消息操作
  addUserMessage: (content: MessageContent, contextItems?: ContextItem[]) => string
  addAssistantMessage: (content?: string) => string
  appendToAssistant: (messageId: string, content: string) => void
  finalizeAssistant: (messageId: string) => void
  _doAppendToAssistant: (messageId: string, content: string) => void
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void
  addToolResult: (toolCallId: string, name: string, content: string, type: ToolResultType, rawParams?: Record<string, unknown>) => string
  addCheckpoint: (type: 'user_message' | 'tool_edit', fileSnapshots: Record<string, FileSnapshot>) => string
  clearMessages: () => void
  deleteMessagesAfter: (messageId: string) => void

  // 工具调用操作（Cursor 风格：内联到 parts）
  addToolCallPart: (messageId: string, toolCall: Omit<ToolCall, 'status'>) => void
  updateToolCall: (messageId: string, toolCallId: string, updates: Partial<ToolCall>) => void

  // 上下文操作
  addContextItem: (item: ContextItem) => void
  removeContextItem: (index: number) => void
  clearContextItems: () => void

  // 流状态操作
  setStreamState: (state: Partial<StreamState>) => void
  setStreamPhase: (phase: StreamState['phase'], toolCall?: ToolCall, error?: string) => void

  // 配置操作
  setAutoApprove: (type: keyof AgentState['autoApprove'], value: boolean) => void

  // 待确认更改操作
  addPendingChange: (change: Omit<PendingChange, 'id' | 'timestamp' | 'status'>) => void
  acceptAllChanges: () => void
  undoAllChanges: () => Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }>
  acceptChange: (filePath: string) => void
  undoChange: (filePath: string) => Promise<boolean>
  clearPendingChanges: () => void

  // 消息检查点操作
  createMessageCheckpoint: (messageId: string, description: string) => Promise<string>
  addSnapshotToCurrentCheckpoint: (filePath: string, content: string | null) => void
  restoreToCheckpoint: (checkpointId: string) => Promise<{ success: boolean; restoredFiles: string[]; errors: string[] }>
  getCheckpointForMessage: (messageId: string) => MessageCheckpoint | null
  clearMessageCheckpoints: () => void

  // Plan 操作
  createPlan: (items: Array<{ title: string; description?: string }>) => void
  updatePlanStatus: (status: Plan['status']) => void

  updatePlanItem: (itemId: string, updates: Partial<PlanItem>) => void
  addPlanItem: (item: { title: string; description?: string }) => void
  deletePlanItem: (itemId: string) => void
  setPlanStep: (stepId: string | null) => void
  clearPlan: () => void

  // 获取器
  getCurrentThread: () => ChatThread | null
  getMessages: () => ChatMessage[]
  getPendingChanges: () => PendingChange[]
  getMessageCheckpoints: () => MessageCheckpoint[]
}

type AgentStore = AgentState & AgentActions

// ===== 辅助函数 =====

const generateId = () => crypto.randomUUID()
const generateShortId = () => crypto.randomUUID().slice(0, 8)

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

// ===== 流式响应节流优化 =====
// 使用 requestAnimationFrame 批量更新流式内容，减少状态更新频率
class StreamingBuffer {
  private buffer: Map<string, string> = new Map() // messageId -> pending content
  private rafId: number | null = null
  private flushCallback: ((messageId: string, content: string) => void) | null = null

  setFlushCallback(callback: (messageId: string, content: string) => void) {
    this.flushCallback = callback
  }

  append(messageId: string, content: string): void {
    const existing = this.buffer.get(messageId) || ''
    this.buffer.set(messageId, existing + content)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.rafId) return // 已有待执行的刷新
    this.rafId = requestAnimationFrame(() => {
      this.flush()
      this.rafId = null
    })
  }

  private flush(): void {
    if (!this.flushCallback) return
    this.buffer.forEach((content, messageId) => {
      if (content) {
        this.flushCallback!(messageId, content)
      }
    })
    this.buffer.clear()
  }

  // 立即刷新（用于流式结束时）
  flushNow(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.flush()
  }

  clear(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.buffer.clear()
  }
}

const streamingBuffer = new StreamingBuffer()

// ===== 存储配置 =====
// 使用固定key，通过项目的.adnify目录实现隔离
const STORE_NAME = 'adnify-agent-store'

// ===== Store 实现 =====

export const useAgentStore = create<AgentStore>()(
  persist(
    (set: any, get: () => AgentStore): AgentStore => ({
      // 初始状态
      threads: {},
      currentThreadId: null,
      streamState: { phase: 'idle' },
      pendingChanges: [],
      messageCheckpoints: [],
      autoApprove: {
        edits: false,
        terminal: false,
        dangerous: false,
      },
      plan: null,

      // 线程操作
      createThread: () => {
        const thread = createEmptyThread()
        set((state: AgentStore) => ({
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
        set((state: AgentStore) => {
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

      // 消息操作
      addUserMessage: (content, contextItems) => {
        const state = get()
        let threadId = state.currentThreadId

        if (!threadId || !state.threads[threadId]) {
          threadId = get().createThread()
        }

        const message: UserMessage = {
          id: generateId(),
          role: 'user',
          content,
          timestamp: Date.now(),
          contextItems,
        }

        set((state: AgentStore) => {
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
          role: 'assistant',
          content,
          timestamp: Date.now(),
          isStreaming: true,
          parts: content ? [{ type: 'text', content }] : [],
          toolCalls: [],
        }

        set((state: AgentStore) => {
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
        // 使用 StreamingBuffer 批量更新，通过 requestAnimationFrame 节流
        streamingBuffer.append(messageId, content)
      },

      // 内部方法：实际执行内容追加（由 StreamingBuffer 调用）
      _doAppendToAssistant: (messageId: string, content: string) => {
        const state = get()
        const threadId = state.currentThreadId
        if (!threadId) return

        set((state: AgentStore) => {
          const thread = state.threads[threadId]
          if (!thread) return state

          // 使用类型守卫替代类型断言，并优化更新逻辑
          const messageIdx = thread.messages.findIndex(
            msg => msg.id === messageId && isAssistantMessage(msg)
          )
          if (messageIdx === -1) return state

          const assistantMsg = thread.messages[messageIdx] as AssistantMessage
          const newContent = assistantMsg.content + content

          // 优化 parts 更新：直接修改最后一个 text part 而不是复制整个数组
          let newParts: AssistantPart[]
          const lastPart = assistantMsg.parts[assistantMsg.parts.length - 1]

          if (lastPart && isTextPart(lastPart)) {
            // 只复制最后一个元素进行更新
            newParts = [...assistantMsg.parts]
            newParts[newParts.length - 1] = { type: 'text', content: lastPart.content + content }
          } else {
            newParts = [...assistantMsg.parts, { type: 'text', content }]
          }

          // 只更新需要更新的消息，避免遍历所有消息
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
        // 先刷新缓冲区，确保所有内容都已写入
        streamingBuffer.flushNow()

        const state = get()
        const threadId = state.currentThreadId
        if (!threadId) return

        set((state: AgentStore) => {
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

      updateMessage: (messageId, updates) => {
        const state = get()
        const threadId = state.currentThreadId
        if (!threadId) return

        set((state: AgentStore) => {
          const thread = state.threads[threadId]
          if (!thread) return state

          const messages = thread.messages.map(msg => {
            if (msg.id === messageId) {
              return { ...msg, ...updates }
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

      addToolResult: (toolCallId, name, content, type, rawParams) => {
        const state = get()
        const threadId = state.currentThreadId
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

        set((state: AgentStore) => {
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
          role: 'checkpoint',
          type,
          timestamp: Date.now(),
          fileSnapshots,
        }

        set((state: AgentStore) => {
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

        set((state: AgentStore) => {
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

        set((state: AgentStore) => {
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

      // 工具调用操作（Cursor 风格：内联到 parts）
      addToolCallPart: (messageId, toolCall) => {
        const state = get()
        const threadId = state.currentThreadId
        if (!threadId) return

        set((state: AgentStore) => {
          const thread = state.threads[threadId]
          if (!thread) return state

          const messages = thread.messages.map(msg => {
            if (msg.id === messageId && msg.role === 'assistant') {
              const assistantMsg = msg as AssistantMessage

              // 防止重复添加相同的 toolCallId
              if (assistantMsg.toolCalls?.some(tc => tc.id === toolCall.id)) {
                return msg
              }

              const newToolCall: ToolCall = { ...toolCall, status: 'pending' }

              // 添加到 parts（内联显示）
              const newParts: AssistantPart[] = [...assistantMsg.parts, { type: 'tool_call', toolCall: newToolCall }]
              // 同时添加到 toolCalls（兼容）
              const newToolCalls = [...(assistantMsg.toolCalls || []), newToolCall]

              return {
                ...assistantMsg,
                parts: newParts,
                toolCalls: newToolCalls,
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

      updateToolCall: (messageId, toolCallId, updates) => {
        const state = get()
        const threadId = state.currentThreadId
        if (!threadId) return

        set((state: AgentStore) => {
          const thread = state.threads[threadId]
          if (!thread) return state

          const messages = thread.messages.map(msg => {
            if (msg.id === messageId && msg.role === 'assistant') {
              const assistantMsg = msg as AssistantMessage

              // 更新 parts 中的 tool_call
              const newParts = assistantMsg.parts.map(part => {
                if (part.type === 'tool_call' && part.toolCall.id === toolCallId) {
                  return { ...part, toolCall: { ...part.toolCall, ...updates } }
                }
                return part
              })

              // 更新 toolCalls 数组
              const newToolCalls = assistantMsg.toolCalls?.map(tc =>
                tc.id === toolCallId ? { ...tc, ...updates } : tc
              )

              return {
                ...assistantMsg,
                parts: newParts,
                toolCalls: newToolCalls,
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

      // 上下文操作
      addContextItem: (item) => {
        let state = get()
        let threadId = state.currentThreadId

        if (!threadId || !state.threads[threadId]) {
          threadId = get().createThread()
          state = get()
        }

        if (!threadId) return

        set((state: AgentStore) => {
          const thread = state.threads[threadId]
          if (!thread) return state

          // 检查是否已存在
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

        set((state: AgentStore) => {
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

        set((state: AgentStore) => {
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

      // 流状态操作
      setStreamState: (newState) => {
        set((state: AgentStore) => ({
          streamState: { ...state.streamState, ...newState },
        }))
      },

      setStreamPhase: (phase, toolCall, error) => {
        set({ streamState: { phase, currentToolCall: toolCall, error } })
      },

      // 配置操作
      setAutoApprove: (type, value) => {
        set((state: AgentStore) => ({
          autoApprove: { ...state.autoApprove, [type]: value },
        }))
      },

      // 待确认更改操作
      addPendingChange: (change) => {
        set((state: AgentStore) => {
          // 检查是否已存在相同文件的更改，如果存在则更新
          const existingIdx = state.pendingChanges.findIndex(c => c.filePath === change.filePath)
          if (existingIdx !== -1) {
            // 保留原始快照，更新其他信息
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

          // 添加新的更改
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
        // 清空所有待确认更改（文件已保存，只是确认）
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
              // 文件原本不存在，删除它
              const deleted = await window.electronAPI.deleteFile(change.filePath)
              if (deleted) {
                restoredFiles.push(change.filePath)
              } else {
                errors.push(`Failed to delete: ${change.filePath}`)
              }
            } else {
              // 恢复文件内容
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

        // 清空待确认更改
        set({ pendingChanges: [] })

        return {
          success: errors.length === 0,
          restoredFiles,
          errors,
        }
      },

      acceptChange: (filePath) => {
        set((state: AgentStore) => ({
          pendingChanges: state.pendingChanges.filter(c => c.filePath !== filePath),
        }))
      },

      undoChange: async (filePath) => {
        const state = get()
        const change = state.pendingChanges.find(c => c.filePath === filePath)
        if (!change) return false

        try {
          if (change.snapshot.content === null) {
            const deleted = await window.electronAPI.deleteFile(change.filePath)
            if (!deleted) return false
          } else {
            const written = await window.electronAPI.writeFile(change.filePath, change.snapshot.content)
            if (!written) return false
          }

          // 从列表中移除
          set((state: AgentStore) => ({
            pendingChanges: state.pendingChanges.filter(c => c.filePath !== filePath),
          }))
          return true
        } catch {
          return false
        }
      },

      clearPendingChanges: () => {
        set({ pendingChanges: [] })
      },

      // 消息检查点操作
      createMessageCheckpoint: async (messageId, description) => {
        const state = get()
        const threadId = state.currentThreadId
        if (!threadId) return ''

        // 创建检查点时，记录当前所有 pendingChanges 中的文件快照
        // 这样每个检查点都有独立的快照记录
        const fileSnapshots: Record<string, FileSnapshot> = {}

        // 复制当前 pendingChanges 中的快照到检查点
        for (const change of state.pendingChanges) {
          fileSnapshots[change.filePath] = { ...change.snapshot }
        }

        const checkpoint: MessageCheckpoint = {
          id: crypto.randomUUID(),
          messageId,
          timestamp: Date.now(),
          fileSnapshots,
          description,
        }

        console.log('[Checkpoint] Created checkpoint:', checkpoint.id, 'for message:', messageId, 'with files:', Object.keys(fileSnapshots))

        set((state: AgentStore) => ({
          messageCheckpoints: [...state.messageCheckpoints, checkpoint],
        }))

        return checkpoint.id
      },

      // 添加文件快照到当前检查点（在文件修改前调用）
      addSnapshotToCurrentCheckpoint: (filePath: string, content: string | null) => {
        console.log('[Checkpoint] Adding snapshot for:', filePath, 'content length:', content?.length ?? 'null')

        set((state: AgentStore) => {
          // 找到最新的检查点
          if (state.messageCheckpoints.length === 0) {
            console.log('[Checkpoint] No checkpoints exist, cannot add snapshot')
            return state
          }

          const checkpoints = [...state.messageCheckpoints]
          const lastCheckpoint = checkpoints[checkpoints.length - 1]

          console.log('[Checkpoint] Current checkpoint:', lastCheckpoint.id, 'existing files:', Object.keys(lastCheckpoint.fileSnapshots))

          // 如果该文件还没有快照，添加它（只保留最早的快照）
          if (!(filePath in lastCheckpoint.fileSnapshots)) {
            checkpoints[checkpoints.length - 1] = {
              ...lastCheckpoint,
              fileSnapshots: {
                ...lastCheckpoint.fileSnapshots,
                [filePath]: { fsPath: filePath, content },
              },
            }
            console.log('[Checkpoint] Added snapshot for:', filePath)
            return { messageCheckpoints: checkpoints }
          }

          console.log('[Checkpoint] Snapshot already exists for:', filePath)
          return state
        })
      },

      restoreToCheckpoint: async (checkpointId) => {
        const state = get()
        const checkpointIdx = state.messageCheckpoints.findIndex(cp => cp.id === checkpointId)

        console.log('[Restore] Looking for checkpoint:', checkpointId)
        console.log('[Restore] All checkpoints:', state.messageCheckpoints.map(cp => ({
          id: cp.id,
          messageId: cp.messageId,
          files: Object.keys(cp.fileSnapshots),
        })))

        if (checkpointIdx === -1) {
          return { success: false, restoredFiles: [], errors: ['Checkpoint not found'] }
        }

        const checkpoint = state.messageCheckpoints[checkpointIdx]
        const restoredFiles: string[] = []
        const errors: string[] = []

        // 收集该检查点及之后所有检查点的文件快照
        // 我们需要恢复到该检查点之前的状态
        const filesToRestore: Record<string, FileSnapshot> = {}

        // 从该检查点开始，收集所有需要恢复的文件
        for (let i = checkpointIdx; i < state.messageCheckpoints.length; i++) {
          const cp = state.messageCheckpoints[i]
          for (const [path, snapshot] of Object.entries(cp.fileSnapshots)) {
            // 只保留最早的快照（即该检查点的快照）
            if (!(path in filesToRestore)) {
              filesToRestore[path] = snapshot
            }
          }
        }

        // 同时检查 pendingChanges 中的文件（可能有检查点之后新增的修改）
        for (const change of state.pendingChanges) {
          if (!(change.filePath in filesToRestore)) {
            filesToRestore[change.filePath] = change.snapshot
          }
        }

        console.log('[Restore] Files to restore:', Object.keys(filesToRestore))
        console.log('[Restore] PendingChanges:', state.pendingChanges.map(c => c.filePath))

        // 恢复所有文件
        for (const [filePath, snapshot] of Object.entries(filesToRestore)) {
          try {
            if (snapshot.content === null) {
              // 文件原本不存在，删除它
              const deleted = await window.electronAPI.deleteFile(filePath)
              if (deleted) {
                restoredFiles.push(filePath)
              }
            } else {
              // 恢复文件内容
              const written = await window.electronAPI.writeFile(filePath, snapshot.content)
              if (written) {
                restoredFiles.push(filePath)
              } else {
                errors.push(`Failed to restore: ${filePath}`)
              }
            }
          } catch (e) {
            errors.push(`Error restoring ${filePath}: ${e}`)
          }
        }

        // 删除该检查点关联消息及之后的所有消息
        const threadId = state.currentThreadId
        if (threadId) {
          const thread = state.threads[threadId]
          if (thread) {
            const messageIdx = thread.messages.findIndex(m => m.id === checkpoint.messageId)
            if (messageIdx !== -1) {
              // 删除该消息及之后的所有消息（保留该消息之前的）
              set((state: AgentStore) => {
                const thread = state.threads[threadId]
                if (!thread) return state
                return {
                  threads: {
                    ...state.threads,
                    [threadId]: {
                      ...thread,
                      messages: thread.messages.slice(0, messageIdx),
                      lastModified: Date.now(),
                    },
                  },
                }
              })
            }
          }
        }

        // 删除该检查点及之后的检查点，清空待确认更改
        set((state: AgentStore) => ({
          messageCheckpoints: state.messageCheckpoints.slice(0, checkpointIdx),
          pendingChanges: [],
        }))

        return {
          success: errors.length === 0,
          restoredFiles,
          errors,
        }
      },

      getCheckpointForMessage: (messageId) => {
        const state = get()
        return state.messageCheckpoints.find(cp => cp.messageId === messageId) || null
      },

      clearMessageCheckpoints: () => {
        set({ messageCheckpoints: [] })
      },

      // 获取器
      getCurrentThread: () => {
        const state = get()
        if (!state.currentThreadId) return null
        return state.threads[state.currentThreadId] || null
      },

      getMessages: () => {
        const thread = get().getCurrentThread()
        return thread?.messages || []
      },

      getPendingChanges: () => {
        return get().pendingChanges
      },

      getMessageCheckpoints: () => {
        return get().messageCheckpoints
      },

      // Plan 操作实现
      createPlan: (items) => {
        set(() => ({
          plan: {
            id: crypto.randomUUID(),
            items: items.map(item => ({
              id: generateShortId(),
              title: item.title,
              description: item.description,
              status: 'pending'
            })),
            status: 'draft',
            currentStepId: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        }))
      },

      updatePlanStatus: (status) => {
        set((state: AgentStore) => {
          if (!state.plan) return {}
          return {
            plan: {
              ...state.plan,
              status,
              updatedAt: Date.now()
            }
          }
        })
      },

      updatePlanItem: (itemId, updates) => {
        set((state: AgentStore) => {
          if (!state.plan) return {}
          return {
            plan: {
              ...state.plan,
              items: state.plan.items.map(item =>
                item.id === itemId ? { ...item, ...updates } : item
              ),
              updatedAt: Date.now()
            }
          }
        })
      },

      addPlanItem: (item) => {
        set((state: AgentStore) => {
          if (!state.plan) return {}
          const newItem: PlanItem = {
            id: generateShortId(),
            title: item.title,
            description: item.description,
            status: 'pending',
          }
          return {
            plan: {
              ...state.plan,
              items: [...state.plan.items, newItem],
              updatedAt: Date.now(),
            },
          }
        })
      },

      deletePlanItem: (itemId) => {
        set((state: AgentStore) => {
          if (!state.plan) return {}
          return {
            plan: {
              ...state.plan,
              items: state.plan.items.filter(item => item.id !== itemId),
              updatedAt: Date.now(),
            },
          }
        })
      },

      setPlanStep: (stepId) => {
        set((state: AgentStore) => {
          if (!state.plan) return {}
          return {
            plan: {
              ...state.plan,
              currentStepId: stepId,
              updatedAt: Date.now()
            }
          }
        })
      },

      clearPlan: () => {
        set({ plan: null })
      }
    }),
    {
      name: 'adnify-agent-store',
      storage: createJSONStorage(() => agentStorage),
      partialize: (state) => ({
        threads: state.threads,
        currentThreadId: state.currentThreadId,
        autoApprove: state.autoApprove,
        plan: state.plan,
      }),
    }
  ) as any
)

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

// ===== StreamingBuffer 初始化 =====
// 在 store 创建后设置回调
streamingBuffer.setFlushCallback((messageId: string, content: string) => {
  const store = useAgentStore.getState() as any
  store._doAppendToAssistant(messageId, content)
})

// ===== Store 初始化 =====
/**
 * 初始化 AgentStore，从项目的 .adnify/sessions.json 恢复会话数据
 * 通过项目目录实现隔离，同项目多窗口共享会话
 */
export async function initializeAgentStore(): Promise<void> {
  try {
    // 触发数据恢复
    const persistApi = (useAgentStore as any).persist
    if (persistApi) {
      await persistApi.rehydrate()
      console.log('[AgentStore] Rehydrated from project storage:', STORE_NAME)
    }
  } catch (error) {
    console.error('[AgentStore] Failed to initialize storage:', error)
    // 降级到默认行为，不阻塞应用启动
  }
}
