/**
 * Chat Thread Service
 * 管理聊天线程、消息、检查点和流状态
 * 参考 void 编辑器的 chatThreadService.ts
 */

// 使用 crypto.randomUUID() 代替 uuid 库
const uuid = () => crypto.randomUUID()
import {
  ChatThread,
  ThreadsState,
  ChatMessage,
  StreamState,
  StreamRunningType,
  UserMessage,
  AssistantMessage,
  ToolMessage,
  ToolMessageType,
  CheckpointEntry,
  StagingSelectionItem,
  MessageContent,
  FileSnapshot,
  isToolMessage,
} from './types/chatTypes'
// ===== 常量 =====

const STORAGE_KEY = 'adnify_chat_threads'

// ===== 事件类型 =====

type ThreadChangeListener = () => void
type StreamStateListener = (threadId: string) => void

// ===== ChatThreadService =====

class ChatThreadService {
  private state: ThreadsState
  private streamState: Record<string, StreamState | undefined> = {}
  
  private threadChangeListeners: Set<ThreadChangeListener> = new Set()
  private streamStateListeners: Set<StreamStateListener> = new Set()

  constructor() {
    // 从 localStorage 恢复状态
    const { state, migrated } = this.loadFromStorage()
    this.state = state || {
      allThreads: {},
      currentThreadId: '',
    }

    // 如果进行了数据迁移，立即保存
    if (migrated) {
      this.saveToStorage()
      console.log('[ChatThreadService] Data migration completed and saved')
    }

    // 确保有一个当前线程
    if (!this.state.currentThreadId || !this.state.allThreads[this.state.currentThreadId]) {
      this.openNewThread()
    }
  }

  // ===== 存储 =====

  private loadFromStorage(): { state: ThreadsState | null; migrated: boolean } {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return { state: null, migrated: false }
      const state = JSON.parse(stored) as ThreadsState
      
      let migrated = false
      
      // 数据迁移和清理
      for (const threadId of Object.keys(state.allThreads)) {
        const thread = state.allThreads[threadId]
        if (thread) {
          const originalLength = thread.messages.length
          thread.messages = thread.messages.filter((m) => {
            if (m.role === 'tool') {
              const toolMsg = m as ToolMessage
              // 过滤掉没有 toolCallId 或使用旧格式（如 "read_file:0"）的工具消息
              if (!toolMsg.toolCallId || toolMsg.toolCallId.includes(':')) {
                return false
              }
            }
            return true
          })
          
          // 重置所有 assistant 消息的 isStreaming 状态（历史消息不应该显示光标）
          thread.messages = thread.messages.map((m) => {
            if (m.role === 'assistant' && (m as AssistantMessage).isStreaming) {
              return { ...m, isStreaming: false }
            }
            return m
          })
          
          if (thread.messages.length !== originalLength) {
            migrated = true
          }
        }
      }
      
      return { state, migrated }
    } catch {
      return { state: null, migrated: false }
    }
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (e) {
      console.error('Failed to save threads to storage:', e)
    }
  }

  // ===== 事件 =====

  onThreadChange(listener: ThreadChangeListener): () => void {
    this.threadChangeListeners.add(listener)
    return () => this.threadChangeListeners.delete(listener)
  }

  onStreamStateChange(listener: StreamStateListener): () => void {
    this.streamStateListeners.add(listener)
    return () => this.streamStateListeners.delete(listener)
  }

  private emitThreadChange(): void {
    this.threadChangeListeners.forEach((l) => l())
    this.saveToStorage()
  }

  private emitStreamStateChange(threadId: string): void {
    this.streamStateListeners.forEach((l) => l(threadId))
  }

  // ===== 线程管理 =====

  getCurrentThread(): ChatThread {
    const thread = this.state.allThreads[this.state.currentThreadId]
    if (!thread) {
      return this.openNewThread()
    }
    return thread
  }

  getThread(threadId: string): ChatThread | undefined {
    return this.state.allThreads[threadId]
  }

  getAllThreads(): ChatThread[] {
    return Object.values(this.state.allThreads).filter((t): t is ChatThread => !!t)
  }

  openNewThread(): ChatThread {
    const now = new Date().toISOString()
    const thread: ChatThread = {
      id: uuid(),
      createdAt: now,
      lastModified: now,
      messages: [],
      state: {
        currCheckpointIdx: null,
        stagingSelections: [],
        focusedMessageIdx: undefined,
      },
    }

    this.state.allThreads[thread.id] = thread
    this.state.currentThreadId = thread.id
    this.emitThreadChange()
    return thread
  }

  switchToThread(threadId: string): void {
    if (!this.state.allThreads[threadId]) return
    this.state.currentThreadId = threadId
    this.emitThreadChange()
  }

  deleteThread(threadId: string): void {
    delete this.state.allThreads[threadId]
    delete this.streamState[threadId]

    // 如果删除的是当前线程，切换到其他线程或创建新线程
    if (this.state.currentThreadId === threadId) {
      const remaining = Object.keys(this.state.allThreads)
      if (remaining.length > 0) {
        this.state.currentThreadId = remaining[0]
      } else {
        this.openNewThread()
      }
    }

    this.emitThreadChange()
  }

  duplicateThread(threadId: string): ChatThread | null {
    const original = this.state.allThreads[threadId]
    if (!original) return null

    const now = new Date().toISOString()
    const newThread: ChatThread = {
      ...JSON.parse(JSON.stringify(original)),
      id: uuid(),
      createdAt: now,
      lastModified: now,
    }

    this.state.allThreads[newThread.id] = newThread
    this.emitThreadChange()
    return newThread
  }

  // ===== 消息管理 =====

  addMessage(message: Omit<ChatMessage, 'id'> & { id?: string }): string {
    const thread = this.getCurrentThread()
    const id = message.id || uuid()
    const fullMessage = { ...message, id } as ChatMessage

    thread.messages.push(fullMessage)
    thread.lastModified = new Date().toISOString()
    this.emitThreadChange()
    return id
  }

  addUserMessage(content: MessageContent, selections?: StagingSelectionItem[]): string {
    const message: Omit<UserMessage, 'id'> = {
      role: 'user',
      content,
      selections,
      state: {
        stagingSelections: selections || [],
        isBeingEdited: false,
      },
    }
    return this.addMessage(message)
  }

  addAssistantMessage(content: string = '', isStreaming: boolean = false): string {
    const message: Omit<AssistantMessage, 'id'> = {
      role: 'assistant',
      content,
      isStreaming,
      toolCallIds: [],
    }
    return this.addMessage(message)
  }

  addToolMessage(
    type: ToolMessageType,
    name: string,
    toolCallId: string,
    rawParams: Record<string, unknown>,
    content: string,
    params?: Record<string, unknown>,
    result?: unknown
  ): string {
    const message: Omit<ToolMessage, 'id'> = {
      role: 'tool',
      type,
      name,
      toolCallId,
      rawParams,
      content,
      params,
      result,
    }
    return this.addMessage(message)
  }

  updateMessage(messageId: string, updates: Partial<ChatMessage>): void {
    const thread = this.getCurrentThread()
    const index = thread.messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    thread.messages[index] = { ...thread.messages[index], ...updates } as ChatMessage
    thread.lastModified = new Date().toISOString()
    this.emitThreadChange()
  }

  appendToLastAssistantMessage(content: string): void {
    const thread = this.getCurrentThread()
    const lastMsg = thread.messages[thread.messages.length - 1]
    
    if (lastMsg && lastMsg.role === 'assistant') {
      ;(lastMsg as AssistantMessage).content += content
      this.emitThreadChange()
    }
  }

  // ===== 内嵌工具调用管理 (Cursor 风格) =====

  addInlineToolCall(
    messageId: string,
    toolCall: {
      id: string
      name: string
      status: ToolMessageType
      rawParams: Record<string, unknown>
    }
  ): void {
    const thread = this.getCurrentThread()
    const msg = thread.messages.find((m) => m.id === messageId)
    
    if (msg && msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      if (!assistantMsg.toolCalls) {
        assistantMsg.toolCalls = []
      }
      // 检查是否已存在，避免重复添加
      const existing = assistantMsg.toolCalls.find((tc) => tc.id === toolCall.id)
      if (existing) {
        // 更新已存在的工具调用
        Object.assign(existing, {
          name: toolCall.name,
          status: toolCall.status,
          rawParams: toolCall.rawParams,
        })
      } else {
        // 添加新的工具调用
        assistantMsg.toolCalls.push({
          id: toolCall.id,
          name: toolCall.name,
          status: toolCall.status,
          rawParams: toolCall.rawParams,
        })
      }
      this.emitThreadChange()
    }
  }

  updateInlineToolCall(
    messageId: string,
    toolCallId: string,
    updates: Partial<{ status: ToolMessageType; result: string; error: string; rawParams: Record<string, unknown> }>
  ): void {
    const thread = this.getCurrentThread()
    const msg = thread.messages.find((m) => m.id === messageId)
    
    if (msg && msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      const toolCall = assistantMsg.toolCalls?.find((tc) => tc.id === toolCallId)
      if (toolCall) {
        Object.assign(toolCall, updates)
        this.emitThreadChange()
      }
    }
  }

  linkToolCallToMessage(messageId: string, toolCallId: string): void {
    const thread = this.getCurrentThread()
    const msg = thread.messages.find((m) => m.id === messageId)
    
    if (msg && msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      if (!assistantMsg.toolCallIds) {
        assistantMsg.toolCallIds = []
      }
      if (!assistantMsg.toolCallIds.includes(toolCallId)) {
        assistantMsg.toolCallIds.push(toolCallId)
        this.emitThreadChange()
      }
    }
  }

  finalizeLastMessage(): void {
    const thread = this.getCurrentThread()
    const lastIndex = thread.messages.length - 1
    const lastMsg = thread.messages[lastIndex]
    
    if (lastMsg && lastMsg.role === 'assistant' && (lastMsg as AssistantMessage).isStreaming) {
      // 创建新对象以触发 React 更新
      thread.messages[lastIndex] = {
        ...lastMsg,
        isStreaming: false,
      } as AssistantMessage
      this.emitThreadChange()
    }
  }

  deleteMessagesAfter(messageId: string): void {
    const thread = this.getCurrentThread()
    const index = thread.messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    thread.messages = thread.messages.slice(0, index + 1)
    thread.lastModified = new Date().toISOString()
    this.emitThreadChange()
  }

  clearMessages(): void {
    const thread = this.getCurrentThread()
    thread.messages = []
    thread.state.currCheckpointIdx = null
    thread.lastModified = new Date().toISOString()
    this.emitThreadChange()
  }

  // ===== 工具消息更新 =====

  updateToolMessage(
    toolId: string,
    updates: Partial<Pick<ToolMessage, 'type' | 'content' | 'result' | 'params'>>
  ): void {
    const thread = this.getCurrentThread()
    const msg = thread.messages.find(
      (m) => isToolMessage(m) && m.id === toolId
    ) as ToolMessage | undefined

    if (msg) {
      Object.assign(msg, updates)
      this.emitThreadChange()
    }
  }

  // ===== 检查点 =====

  addCheckpoint(
    type: 'user_message' | 'tool_edit',
    description: string,
    snapshots: Record<string, FileSnapshot>
  ): string {
    const checkpoint: Omit<CheckpointEntry, 'id'> = {
      role: 'checkpoint',
      type,
      timestamp: new Date().toISOString(),
      description,
      snapshots,
    }
    return this.addMessage(checkpoint)
  }

  getCheckpoints(): CheckpointEntry[] {
    const thread = this.getCurrentThread()
    return thread.messages.filter((m): m is CheckpointEntry => m.role === 'checkpoint')
  }

  // ===== 流状态 =====

  getStreamState(threadId?: string): StreamState | undefined {
    const id = threadId || this.state.currentThreadId
    return this.streamState[id]
  }

  setStreamState(state: StreamState | undefined, threadId?: string): void {
    const id = threadId || this.state.currentThreadId
    this.streamState[id] = state
    this.emitStreamStateChange(id)
  }

  setStreamRunning(
    isRunning: StreamRunningType,
    info?: { llmInfo?: StreamState['llmInfo']; toolInfo?: StreamState['toolInfo'] }
  ): void {
    const threadId = this.state.currentThreadId
    this.streamState[threadId] = {
      isRunning,
      ...info,
    }
    this.emitStreamStateChange(threadId)
  }

  setStreamError(message: string, fullError: Error | null = null): void {
    const threadId = this.state.currentThreadId
    this.streamState[threadId] = {
      isRunning: undefined,
      error: { message, fullError },
    }
    this.emitStreamStateChange(threadId)
  }

  clearStreamError(): void {
    const threadId = this.state.currentThreadId
    if (this.streamState[threadId]?.error) {
      this.streamState[threadId] = { isRunning: undefined }
      this.emitStreamStateChange(threadId)
    }
  }

  // ===== Staging Selections =====

  getStagingSelections(): StagingSelectionItem[] {
    return this.getCurrentThread().state.stagingSelections
  }

  addStagingSelection(selection: StagingSelectionItem): void {
    const thread = this.getCurrentThread()
    
    // 检查是否已存在
    const exists = thread.state.stagingSelections.some((s) => {
      if (s.type !== selection.type) return false
      // 只有 File, CodeSelection, Folder 类型有 uri
      if ('uri' in s && 'uri' in selection) {
        if (s.uri !== selection.uri) return false
      }
      if (s.type === 'CodeSelection' && selection.type === 'CodeSelection') {
        return s.range[0] === selection.range[0] && s.range[1] === selection.range[1]
      }
      return true
    })

    if (!exists) {
      thread.state.stagingSelections.push(selection)
      this.emitThreadChange()
    }
  }

  removeStagingSelection(index: number): void {
    const thread = this.getCurrentThread()
    // 创建新数组以确保 React 检测到变化
    thread.state.stagingSelections = [
      ...thread.state.stagingSelections.slice(0, index),
      ...thread.state.stagingSelections.slice(index + 1),
    ]
    this.emitThreadChange()
  }

  clearStagingSelections(): void {
    const thread = this.getCurrentThread()
    thread.state.stagingSelections = []
    this.emitThreadChange()
  }

  // ===== 状态访问 =====

  getState(): ThreadsState {
    // 返回浅拷贝（深拷贝在 useChatThread hook 中处理）
    return {
      allThreads: { ...this.state.allThreads },
      currentThreadId: this.state.currentThreadId,
    }
  }

  getCurrentThreadId(): string {
    return this.state.currentThreadId
  }

  getMessages(): ChatMessage[] {
    return this.getCurrentThread().messages
  }

  // ===== 加载会话消息 =====

  loadMessages(messages: ChatMessage[]): void {
    const thread = this.getCurrentThread()
    thread.messages = messages
    thread.lastModified = new Date().toISOString()
    this.emitThreadChange()
  }

  // ===== 重置 =====

  resetState(): void {
    this.state = {
      allThreads: {},
      currentThreadId: '',
    }
    this.streamState = {}
    this.openNewThread()
  }
}

// 单例导出
export const chatThreadService = new ChatThreadService()

// 类型导出
export type { ChatThreadService }
