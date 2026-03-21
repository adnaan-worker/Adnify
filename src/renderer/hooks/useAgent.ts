/**
 * Agent Hook
 * 提供 Agent 功能的 React Hook 接口
 *
 * 性能优化：
 * - 所有 selector 都返回稳定引用
 * - action 函数通过 getState() 获取，不作为 selector 订阅
 * - allThreads 使用引用缓存，threads 不变时返回同一数组
 */

import { api } from '@/renderer/services/electronAPI'
import { useCallback, useMemo, useEffect, useState, useRef } from 'react'
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
import { Agent, getAgentConfig } from '@/renderer/agent'
import { MessageContent, ChatThread, ToolCall } from '@/renderer/agent/types'

// ========== 独立 selector hooks（按需使用，避免全部订阅） ==========

/** useAllThreads 的引用缓存，threads 对象不变时返回同一排序数组 */
let _threadsRef: Record<string, ChatThread> | null = null
let _sortedResult: ChatThread[] = []

/** 获取排序后的所有线程列表（仅在需要时使用） */
export function useAllThreads(): ChatThread[] {
  return useAgentStore(state => {
    if (state.threads === _threadsRef) return _sortedResult
    _threadsRef = state.threads
    _sortedResult = Object.values(state.threads).sort((a, b) => b.lastModified - a.lastModified)
    return _sortedResult
  })
}

// ========== Actions 直接获取（引用永远稳定，不需要 selector 订阅） ==========

const getActions = () => useAgentStore.getState()

// ========== 主 hook ==========

export function useAgent() {
  // 从主 store 获取配置（使用 selector 分离，setter 引用稳定）
  const llmConfig = useStore(state => state.llmConfig)
  const workspacePath = useStore(state => state.workspacePath)
  const promptTemplateId = useStore(state => state.promptTemplateId)
  const openFiles = useStore(state => state.openFiles)
  const activeFilePath = useStore(state => state.activeFilePath)

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

  // 线程 ID（轻量 selector，不订阅整个 threads 对象）
  const currentThreadId = useAgentStore(state => state.currentThreadId)
  const orchestratorPhase = useAgentStore(state => state.phase)

  // 确保有一个默认线程（首次加载时）
  useEffect(() => {
    const state = useAgentStore.getState()
    if (!state.currentThreadId || !state.threads[state.currentThreadId]) {
      state.createThread()
    }
  }, [])

  // 清空消息（包括工具调用日志和 handoff 状态）
  const clearMessages = useCallback(() => {
    getActions().clearMessages()
    useStore.getState().clearToolCallLogs()
    getActions().setHandoffRequired(false)
    getActions().setHandoffDocument(null)
    getActions().setCompressionStats(null)
  }, [])

  // 使用 ref 持有最新值，避免 sendMessage 回调频繁重建
  const sendParamsRef = useRef({ llmConfig, workspacePath, chatMode, promptTemplateId, aiInstructions, openFiles, activeFilePath, orchestratorPhase })
  sendParamsRef.current = { llmConfig, workspacePath, chatMode, promptTemplateId, aiInstructions, openFiles, activeFilePath, orchestratorPhase }

  // 发送消息 — 依赖通过 ref 访问，回调引用永远稳定
  const sendMessage = useCallback(async (content: MessageContent) => {
    const { llmConfig: cfg, workspacePath: ws, chatMode: mode, promptTemplateId: tplId, aiInstructions: ai, openFiles: files, activeFilePath: active, orchestratorPhase: phase } = sendParamsRef.current
    const openFilePaths = files.map(f => f.path)
    const agentConfig = getAgentConfig()

    await Agent.send(
      content,
      {
        provider: cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        timeout: cfg.timeout,
        maxTokens: cfg.maxTokens,
        temperature: cfg.temperature,
        topP: cfg.topP,
        enableThinking: cfg.enableThinking,
        thinkingBudget: cfg.thinkingBudget,
        reasoningEffort: cfg.reasoningEffort,
        protocol: cfg.protocol,
        headers: cfg.headers,
        contextLimit: agentConfig.maxContextTokens,
      },
      ws,
      mode,
      {
        openFiles: openFilePaths,
        activeFile: active || undefined,
        customInstructions: ai,
        promptTemplateId: tplId,
        orchestratorPhase: mode === 'orchestrator' ? phase : undefined,
      }
    )
  }, [])

  // 中止
  const abort = useCallback(() => { Agent.abort() }, [])

  // 工具审批
  const approveCurrentTool = useCallback(() => { Agent.approve() }, [])
  const rejectCurrentTool = useCallback(() => { Agent.reject() }, [])

  // 获取当前等待审批的工具调用
  const pendingToolCall = useMemo((): ToolCall | undefined => {
    if (streamState.phase === 'tool_pending' && streamState.currentToolCall) {
      return streamState.currentToolCall
    }
    return undefined
  }, [streamState])

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
    currentThreadId,
    createThread: getActions().createThread,
    switchThread: getActions().switchThread,
    deleteThread: getActions().deleteThread,

    // 消息操作
    sendMessage,
    abort,
    clearMessages,
    deleteMessagesAfter: getActions().deleteMessagesAfter,

    // 工具审批
    approveCurrentTool,
    rejectCurrentTool,

    // 待确认更改操作
    acceptAllChanges: getActions().acceptAllChanges,
    undoAllChanges: getActions().undoAllChanges,
    acceptChange: getActions().acceptChange,
    undoChange: getActions().undoChange,

    // 消息检查点操作
    restoreToCheckpoint: getActions().restoreToCheckpoint,
    getCheckpointForMessage: getActions().getCheckpointForMessage,
    clearCheckpoints: getActions().clearMessageCheckpoints,

    // 上下文操作
    addContextItem: getActions().addContextItem,
    removeContextItem: getActions().removeContextItem,
    clearContextItems: getActions().clearContextItems,

    // 分支
    createBranch: getActions().createBranch,
    switchBranch: getActions().switchBranch,
    regenerateFromMessage: getActions().regenerateFromMessage,
  }
}
