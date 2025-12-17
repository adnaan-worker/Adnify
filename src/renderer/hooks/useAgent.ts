/**
 * Agent Hook
 * 提供 Agent 功能的 React Hook 接口
 */

import { useCallback, useMemo, useEffect } from 'react'
import { useStore } from '@/renderer/store'
import {
  useAgentStore,
  selectMessages,
  selectStreamState,
  selectContextItems,
  selectIsStreaming,
  selectIsAwaitingApproval,
  selectPendingChanges,
} from '@/renderer/agent/core/AgentStore'
import { AgentService } from '@/renderer/agent/core/AgentService'
import { MessageContent, ChatThread, ToolCall } from '@/renderer/agent/core/types'
import { buildSystemPrompt } from '@/renderer/agent/prompts'

export function useAgent() {
  // 从主 store 获取配置
  const { llmConfig, workspacePath, chatMode } = useStore()

  // 从 Agent store 获取状态（使用选择器避免不必要的重渲染）
  const messages = useAgentStore(selectMessages)
  const streamState = useAgentStore(selectStreamState)
  const contextItems = useAgentStore(selectContextItems)
  const isStreaming = useAgentStore(selectIsStreaming)
  const isAwaitingApproval = useAgentStore(selectIsAwaitingApproval)
  const pendingChanges = useAgentStore(selectPendingChanges)

  // 获取线程相关状态
  const threads = useAgentStore(state => state.threads)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  
  // 确保有一个默认线程（首次加载时）
  const createThreadAction = useAgentStore(state => state.createThread)
  useEffect(() => {
    const state = useAgentStore.getState()
    if (!state.currentThreadId || !state.threads[state.currentThreadId]) {
      createThreadAction()
    }
  }, [])

  // 分开获取每个 action（避免每次渲染创建新对象导致无限循环）
  const createThread = useAgentStore(state => state.createThread)
  const switchThread = useAgentStore(state => state.switchThread)
  const deleteThread = useAgentStore(state => state.deleteThread)
  const clearMessages = useAgentStore(state => state.clearMessages)
  const deleteMessagesAfter = useAgentStore(state => state.deleteMessagesAfter)
  const addContextItem = useAgentStore(state => state.addContextItem)
  const removeContextItem = useAgentStore(state => state.removeContextItem)
  const clearContextItems = useAgentStore(state => state.clearContextItems)
  
  // 待确认更改操作
  const acceptAllChanges = useAgentStore(state => state.acceptAllChanges)
  const undoAllChanges = useAgentStore(state => state.undoAllChanges)
  const acceptChange = useAgentStore(state => state.acceptChange)
  const undoChange = useAgentStore(state => state.undoChange)

  // 发送消息
  const sendMessage = useCallback(async (content: MessageContent) => {
    const systemPrompt = await buildSystemPrompt(chatMode, workspacePath)
    
    await AgentService.sendMessage(
      content,
      {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
      },
      workspacePath,
      systemPrompt
    )
  }, [llmConfig, workspacePath, chatMode])

  // 中止
  const abort = useCallback(() => {
    AgentService.abort()
  }, [])

  // 批准当前工具
  const approveCurrentTool = useCallback(() => {
    AgentService.approve()
  }, [])

  // 拒绝当前工具
  const rejectCurrentTool = useCallback(() => {
    AgentService.reject()
  }, [])

  // 获取当前等待审批的工具调用
  const pendingToolCall = useMemo((): ToolCall | undefined => {
    if (streamState.phase === 'tool_pending' && streamState.currentToolCall) {
      return streamState.currentToolCall
    }
    return undefined
  }, [streamState])

  // 所有线程列表
  const allThreads = useMemo((): ChatThread[] => {
    return Object.values(threads).sort((a, b) => b.lastModified - a.lastModified)
  }, [threads])

  return {
    // 状态
    messages,
    streamState,
    contextItems,
    isStreaming,
    isAwaitingApproval,
    pendingToolCall,
    pendingChanges,
    
    // 线程
    allThreads,
    currentThreadId,
    createThread,
    switchThread,
    deleteThread,
    
    // 消息操作
    sendMessage,
    abort,
    clearMessages,
    deleteMessagesAfter,
    
    // 工具审批
    approveCurrentTool,
    rejectCurrentTool,
    
    // 待确认更改操作
    acceptAllChanges,
    undoAllChanges,
    acceptChange,
    undoChange,
    
    // 上下文操作
    addContextItem,
    removeContextItem,
    clearContextItems,
  }
}
