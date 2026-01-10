/**
 * Agent Hook
 * 提供 Agent 功能的 React Hook 接口
 */

import { api } from '@/renderer/services/electronAPI'
import { useCallback, useMemo, useEffect, useState } from 'react'
import { useStore, useModeStore } from '@/renderer/store'
import {
  useAgentStore,
  selectMessages,
  selectStreamState,
  selectContextItems,
  selectIsStreaming,
  selectIsAwaitingApproval,
  selectPendingChanges,
  selectMessageCheckpoints,
} from '@/renderer/agent/store/AgentStore'
import { AgentService } from '@/renderer/agent/services/AgentService'
import { MessageContent, ChatThread, ToolCall } from '@/renderer/agent/types'
import { buildAgentSystemPrompt } from '@/renderer/agent/prompts/prompts'

export function useAgent() {
  // 从主 store 获取配置
  const { llmConfig, workspacePath, promptTemplateId, openFiles, activeFilePath } = useStore()
  // 从 modeStore 获取当前模式
  const chatMode = useModeStore(state => state.currentMode)

  // 本地状态：aiInstructions（从 electron settings 获取）
  const [aiInstructions, setAiInstructions] = useState<string>('')

  // 加载 aiInstructions（从统一的 app-settings 读取）
  useEffect(() => {
    api.settings.get('app-settings').then((settings: any) => {
      if (settings?.aiInstructions) setAiInstructions(settings.aiInstructions)
    })
  }, [])

  // 从 Agent store 获取状态（使用选择器避免不必要的重渲染）
  const messages = useAgentStore(selectMessages)
  const streamState = useAgentStore(selectStreamState)
  const contextItems = useAgentStore(selectContextItems)
  const isStreaming = useAgentStore(selectIsStreaming)
  const isAwaitingApproval = useAgentStore(selectIsAwaitingApproval)
  const pendingChanges = useAgentStore(selectPendingChanges)
  const messageCheckpoints = useAgentStore(selectMessageCheckpoints)

  // 获取线程相关状态
  const threads = useAgentStore(state => state.threads)
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const plan = useAgentStore(state => state.plan)

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
  const clearMessagesAction = useAgentStore(state => state.clearMessages)
  const deleteMessagesAfter = useAgentStore(state => state.deleteMessagesAfter)
  const addContextItem = useAgentStore(state => state.addContextItem)
  const removeContextItem = useAgentStore(state => state.removeContextItem)
  const clearContextItems = useAgentStore(state => state.clearContextItems)

  // 待确认更改操作
  const acceptAllChanges = useAgentStore(state => state.acceptAllChanges)
  const undoAllChanges = useAgentStore(state => state.undoAllChanges)
  const acceptChange = useAgentStore(state => state.acceptChange)
  const undoChange = useAgentStore(state => state.undoChange)

  // 消息检查点操作
  const restoreToCheckpoint = useAgentStore(state => state.restoreToCheckpoint)
  const getCheckpointForMessage = useAgentStore(state => state.getCheckpointForMessage)
  
  // 清空消息（包括工具调用日志和 handoff 状态）
  const clearMessages = useCallback(() => {
    clearMessagesAction()
    // 同时清理工具调用日志
    useStore.getState().clearToolCallLogs()
    // 重置 handoff 状态
    useAgentStore.getState().setHandoffRequired(false)
    useAgentStore.getState().setHandoffDocument(null)
    useAgentStore.getState().setCompressionStats(null)
  }, [clearMessagesAction])
  const clearCheckpoints = useAgentStore(state => state.clearMessageCheckpoints)

  // Plan 操作
  const createPlan = useAgentStore(state => state.createPlan)
  const updatePlanStatus = useAgentStore(state => state.updatePlanStatus)
  const updatePlanItem = useAgentStore(state => state.updatePlanItem)
  const addPlanItem = useAgentStore(state => state.addPlanItem)
  const deletePlanItem = useAgentStore(state => state.deletePlanItem)
  const setPlanStep = useAgentStore(state => state.setPlanStep)
  const clearPlan = useAgentStore(state => state.clearPlan)

  // 分支操作
  const createBranch = useAgentStore(state => state.createBranch)
  const switchBranch = useAgentStore(state => state.switchBranch)
  const regenerateFromMessage = useAgentStore(state => state.regenerateFromMessage)

  // 发送消息
  const sendMessage = useCallback(async (content: MessageContent) => {
    // 类型转换：OpenFile[] -> string[], string | null -> string | undefined
    const openFilePaths = openFiles.map(f => f.path)
    const activeFile = activeFilePath || undefined

    const systemPrompt = await buildAgentSystemPrompt(chatMode, workspacePath, {
      openFiles: openFilePaths,
      activeFile,
      customInstructions: aiInstructions,
      promptTemplateId,
    })

    await AgentService.sendMessage(
      content,
      {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        timeout: llmConfig.timeout,
        maxTokens: llmConfig.parameters?.maxTokens,
        temperature: llmConfig.parameters?.temperature,
        topP: llmConfig.parameters?.topP,
        adapterConfig: llmConfig.adapterConfig,
        advanced: llmConfig.advanced,
      },
      workspacePath,
      systemPrompt,
      chatMode
    )
  }, [llmConfig, workspacePath, chatMode, promptTemplateId, aiInstructions, openFiles, activeFilePath])

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
    messageCheckpoints,

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

    // 消息检查点操作
    restoreToCheckpoint,
    getCheckpointForMessage,
    clearCheckpoints,

    // 上下文操作
    addContextItem,
    removeContextItem,
    clearContextItems,
    // Plan
    plan,
    createPlan,
    updatePlanStatus,

    updatePlanItem,
    addPlanItem,
    deletePlanItem,
    setPlanStep,
    clearPlan,

    // 分支
    createBranch,
    switchBranch,
    regenerateFromMessage,
  }
}
