/**
 * Chat Thread Hook
 * 提供对 ChatThreadService 的 React 集成
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { chatThreadService } from '../agent/chatThreadService'
import { useStore } from '../store'
import {
  ChatThread,
  ChatMessage,
  StreamState,
  StagingSelectionItem,
  MessageContent,
  ToolMessageType,
  FileSnapshot,
} from '../agent/types/chatTypes'

// ===== Hook: useChatThreads =====

export function useChatThreads() {
  const [state, setState] = useState(() => chatThreadService.getState())
  const [streamState, setStreamState] = useState<StreamState | undefined>(() =>
    chatThreadService.getStreamState()
  )

  useEffect(() => {
    const unsubThread = chatThreadService.onThreadChange(() => {
      // 深拷贝以确保 React 能检测到所有变化（包括 stagingSelections）
      const newState = chatThreadService.getState()
      const deepCopiedThreads: Record<string, ChatThread | undefined> = {}
      
      for (const [id, thread] of Object.entries(newState.allThreads)) {
        if (thread) {
          deepCopiedThreads[id] = {
            ...thread,
            messages: [...thread.messages],
            state: {
              ...thread.state,
              stagingSelections: [...thread.state.stagingSelections],
            },
          }
        }
      }
      
      setState({
        allThreads: deepCopiedThreads,
        currentThreadId: newState.currentThreadId,
      })
    })

    const unsubStream = chatThreadService.onStreamStateChange(() => {
      const newStreamState = chatThreadService.getStreamState()
      setStreamState(newStreamState ? { ...newStreamState } : undefined)
    })

    return () => {
      unsubThread()
      unsubStream()
    }
  }, [])

  const currentThread = useMemo(() => {
    return state.allThreads[state.currentThreadId]
  }, [state])

  const allThreads = useMemo(() => {
    return Object.values(state.allThreads).filter((t): t is ChatThread => !!t)
  }, [state.allThreads])

  const messages = useMemo(() => {
    return currentThread?.messages || []
  }, [currentThread])

  // ===== 线程操作 =====

  const openNewThread = useCallback(() => {
    return chatThreadService.openNewThread()
  }, [])

  const switchToThread = useCallback((threadId: string) => {
    chatThreadService.switchToThread(threadId)
  }, [])

  const deleteThread = useCallback((threadId: string) => {
    chatThreadService.deleteThread(threadId)
  }, [])

  const duplicateThread = useCallback((threadId: string) => {
    return chatThreadService.duplicateThread(threadId)
  }, [])

  // ===== 消息操作 =====

  const addUserMessage = useCallback(
    (content: MessageContent, selections?: StagingSelectionItem[]) => {
      return chatThreadService.addUserMessage(content, selections)
    },
    []
  )

  const addAssistantMessage = useCallback((content: string = '', isStreaming: boolean = false) => {
    return chatThreadService.addAssistantMessage(content, isStreaming)
  }, [])

  const addToolMessage = useCallback(
    (
      type: ToolMessageType,
      name: string,
      toolCallId: string,
      rawParams: Record<string, unknown>,
      content: string,
      params?: Record<string, unknown>,
      result?: unknown
    ) => {
      return chatThreadService.addToolMessage(type, name, toolCallId, rawParams, content, params, result)
    },
    []
  )

  const updateMessage = useCallback((messageId: string, updates: Partial<ChatMessage>) => {
    chatThreadService.updateMessage(messageId, updates)
  }, [])

  const appendToLastAssistantMessage = useCallback((content: string) => {
    chatThreadService.appendToLastAssistantMessage(content)
  }, [])

  const linkToolCallToMessage = useCallback((messageId: string, toolCallId: string) => {
    chatThreadService.linkToolCallToMessage(messageId, toolCallId)
  }, [])

  // ===== 内嵌工具调用 (Cursor 风格) =====

  const addInlineToolCall = useCallback(
    (
      messageId: string,
      toolCall: {
        id: string
        name: string
        status: ToolMessageType
        rawParams: Record<string, unknown>
      }
    ) => {
      chatThreadService.addInlineToolCall(messageId, toolCall)
    },
    []
  )

  const updateInlineToolCall = useCallback(
    (
      messageId: string,
      toolCallId: string,
      updates: Partial<{ status: ToolMessageType; result: string; error: string; rawParams: Record<string, unknown> }>
    ) => {
      chatThreadService.updateInlineToolCall(messageId, toolCallId, updates)
    },
    []
  )

  const finalizeLastMessage = useCallback(() => {
    chatThreadService.finalizeLastMessage()
  }, [])

  const deleteMessagesAfter = useCallback((messageId: string) => {
    chatThreadService.deleteMessagesAfter(messageId)
  }, [])

  const clearMessages = useCallback(() => {
    chatThreadService.clearMessages()
  }, [])

  const loadMessages = useCallback((messages: ChatMessage[]) => {
    chatThreadService.loadMessages(messages)
  }, [])

  // ===== 工具消息 =====

  const updateToolMessage = useCallback(
    (
      toolId: string,
      updates: Partial<{
        type: ToolMessageType
        content: string
        result: unknown
        params: Record<string, unknown>
      }>
    ) => {
      chatThreadService.updateToolMessage(toolId, updates)
    },
    []
  )

  // ===== 检查点 =====

  const addCheckpoint = useCallback(
    (
      type: 'user_message' | 'tool_edit',
      description: string,
      snapshots: Record<string, FileSnapshot>
    ) => {
      const checkpointId = chatThreadService.addCheckpoint(type, description, snapshots)
      // 同步到全局 store（用于 CheckpointPanel 显示）
      if (checkpointId) {
        const timestamp = Date.now()
        // 转换 snapshots 格式以匹配 store 的 Checkpoint 类型
        const storeSnapshots: Record<string, { path: string; content: string; timestamp: number }> = {}
        for (const [path, snap] of Object.entries(snapshots)) {
          storeSnapshots[path] = {
            path,
            content: snap.content,
            timestamp,
          }
        }
        const checkpoint = {
          id: checkpointId,
          type,
          timestamp,
          description,
          snapshots: storeSnapshots,
        }
        useStore.getState().addCheckpoint(checkpoint)
      }
      return checkpointId
    },
    []
  )

  const getCheckpoints = useCallback(() => {
    return chatThreadService.getCheckpoints()
  }, [])

  // ===== 流状态 =====

  const setStreamRunning = useCallback(
    (
      isRunning: StreamState['isRunning'],
      info?: { llmInfo?: StreamState['llmInfo']; toolInfo?: StreamState['toolInfo'] }
    ) => {
      chatThreadService.setStreamRunning(isRunning, info)
    },
    []
  )

  const setStreamError = useCallback((message: string, fullError: Error | null = null) => {
    chatThreadService.setStreamError(message, fullError)
  }, [])

  const clearStreamError = useCallback(() => {
    chatThreadService.clearStreamError()
  }, [])

  // ===== Staging Selections =====

  const stagingSelections = useMemo(() => {
    return currentThread?.state.stagingSelections || []
  }, [currentThread])

  const addStagingSelection = useCallback((selection: StagingSelectionItem) => {
    chatThreadService.addStagingSelection(selection)
  }, [])

  const removeStagingSelection = useCallback((index: number) => {
    chatThreadService.removeStagingSelection(index)
  }, [])

  const clearStagingSelections = useCallback(() => {
    chatThreadService.clearStagingSelections()
  }, [])

  // ===== 计算属性 =====

  const isStreaming = useMemo(() => {
    return streamState?.isRunning === 'LLM' || streamState?.isRunning === 'tool'
  }, [streamState])

  const isAwaitingApproval = useMemo(() => {
    return streamState?.isRunning === 'awaiting_user'
  }, [streamState])

  const streamError = useMemo(() => {
    return streamState?.error
  }, [streamState])

  return {
    // 状态
    state,
    currentThread,
    allThreads,
    messages,
    streamState,
    stagingSelections,

    // 计算属性
    isStreaming,
    isAwaitingApproval,
    streamError,

    // 线程操作
    openNewThread,
    switchToThread,
    deleteThread,
    duplicateThread,

    // 消息操作
    addUserMessage,
    addAssistantMessage,
    addToolMessage,
    updateMessage,
    appendToLastAssistantMessage,
    linkToolCallToMessage,
    finalizeLastMessage,
    deleteMessagesAfter,
    clearMessages,
    loadMessages,

    // 工具消息
    updateToolMessage,

    // 内嵌工具调用 (Cursor 风格)
    addInlineToolCall,
    updateInlineToolCall,

    // 检查点
    addCheckpoint,
    getCheckpoints,

    // 流状态
    setStreamRunning,
    setStreamError,
    clearStreamError,

    // Staging Selections
    addStagingSelection,
    removeStagingSelection,
    clearStagingSelections,
  }
}

// ===== Hook: useCurrentThread =====

export function useCurrentThread() {
  const { currentThread, messages, streamState, isStreaming, isAwaitingApproval } =
    useChatThreads()

  return {
    thread: currentThread,
    messages,
    streamState,
    isStreaming,
    isAwaitingApproval,
  }
}

// ===== Hook: useThreadMessages =====

export function useThreadMessages() {
  const { messages, addUserMessage, addAssistantMessage, clearMessages, deleteMessagesAfter } =
    useChatThreads()

  return {
    messages,
    addUserMessage,
    addAssistantMessage,
    clearMessages,
    deleteMessagesAfter,
  }
}
