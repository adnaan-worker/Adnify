/**
 * Agent Hook
 * 处理 AI 对话和工具调用
 */

import { useCallback, useRef } from 'react'
import { useStore } from '../store'
import { chatThreadService } from '../agent/chatThreadService'
import { useChatThreads } from './useChatThread'
import { getToolDefinitions, executeTool, getToolApprovalType } from '../agent/toolsService'
import { checkpointService } from '../agent/checkpointService'
import { contextService, buildContextString } from '../agent/contextService'
import { getEditorConfig } from '../config/editorConfig'
import { sendToLLM, LLMMessageForSend } from './agent/llmClient'
import { buildSystemPrompt } from '../agent/prompts'
import { MessageContent, ToolMessageType, FileSnapshot, ToolMessage } from '../agent/types/chatTypes'
import { LLMToolCall } from '../types/electron'
import { truncateToolResult } from '../agent/messageSummaryService'

// 配置
const getMaxToolLoops = () => getEditorConfig().ai.maxToolLoops
const getMaxHistoryMessages = () => getEditorConfig().ai.maxHistoryMessages
const getMaxToolResultChars = () => getEditorConfig().ai.maxToolResultChars

// 工具错误消息
const TOOL_ERROR_MESSAGES = {
  rejected: 'Tool call was rejected by the user.',
  interrupted: 'Tool call was interrupted by the user.',
  parseError: 'Failed to parse tool call arguments.',
}

export function useAgent() {
  const { llmConfig, workspacePath, autoApprove, promptTemplateId } = useStore()

  const {
    messages,
    streamState,
    isStreaming,
    isAwaitingApproval,
    stagingSelections,
    addUserMessage,
    addAssistantMessage,
    addToolMessage,
    updateToolMessage,
    appendToLastAssistantMessage,
    linkToolCallToMessage,
    addInlineToolCall,
    updateInlineToolCall,
    finalizeLastMessage,
    setStreamRunning,
    setStreamError,
    addCheckpoint,
    clearMessages,
    clearStagingSelections,
  } = useChatThreads()

  const abortRef = useRef(false)
  const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null)
  const currentAssistantMsgIdRef = useRef<string | null>(null)

  // ===== 工具审批 =====

  const waitForApproval = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      approvalResolverRef.current = resolve
      setStreamRunning('awaiting_user')
    })
  }, [setStreamRunning])

  const approveCurrentTool = useCallback(() => {
    if (approvalResolverRef.current) {
      approvalResolverRef.current(true)
      approvalResolverRef.current = null
    }
  }, [])

  const rejectCurrentTool = useCallback(() => {
    if (approvalResolverRef.current) {
      approvalResolverRef.current(false)
      approvalResolverRef.current = null
    }
  }, [])

  // ===== 执行工具调用 (Cursor 风格 - 内嵌到 assistant 消息) =====

  const executeToolCall = useCallback(
    async (
      toolCall: LLMToolCall,
      conversationMessages: LLMMessageForSend[]
    ): Promise<{ shouldContinue: boolean; interrupted: boolean }> => {
      const { id, name, arguments: rawParams } = toolCall

      // 检查是否是解析错误的工具调用
      if (rawParams._parseError) {
        const errorMsg = `Tool call arguments could not be parsed. Raw args: ${rawParams._rawArgs || '(not available)'}`
        
        // 添加错误状态的工具调用
        if (currentAssistantMsgIdRef.current) {
          addInlineToolCall(currentAssistantMsgIdRef.current, {
            id,
            name,
            status: 'tool_error',
            rawParams: {},
          })
          updateInlineToolCall(currentAssistantMsgIdRef.current, id, {
            status: 'tool_error',
            error: errorMsg,
          })
        }

        const toolMsgId = addToolMessage('tool_error', name, id, {}, errorMsg, {})
        if (currentAssistantMsgIdRef.current) {
          linkToolCallToMessage(currentAssistantMsgIdRef.current, toolMsgId)
        }

        conversationMessages.push({
          role: 'tool',
          content: `Error: ${errorMsg}`,
          toolCallId: id,
          toolName: name,
          rawParams: {},
        })

        return { shouldContinue: true, interrupted: false }
      }

      // 检查是否需要审批
      const approvalType = getToolApprovalType(name)
      const needsApproval =
        approvalType &&
        (approvalType === 'edits' ||
          approvalType === 'terminal' ||
          approvalType === 'dangerous') &&
        !autoApprove[approvalType as keyof typeof autoApprove]

      // 更新内嵌工具调用状态（流式时可能已添加 pending 状态）
      const initialStatus: ToolMessageType = needsApproval ? 'tool_request' : 'running_now'
      
      if (currentAssistantMsgIdRef.current) {
        // 先尝试添加（如果流式没有触发），再更新状态
        addInlineToolCall(currentAssistantMsgIdRef.current, {
          id,
          name,
          status: initialStatus,
          rawParams,
        })
      }

      // 同时添加独立的工具消息（用于对话历史）
      const toolMsgId = addToolMessage(initialStatus, name, id, rawParams, '(Processing...)', rawParams)
      if (currentAssistantMsgIdRef.current) {
        linkToolCallToMessage(currentAssistantMsgIdRef.current, toolMsgId)
      }

      // 如果需要审批，等待用户
      if (needsApproval) {
        setStreamRunning('awaiting_user')
        const approved = await waitForApproval()

        if (!approved) {
          // 更新内嵌工具调用状态
          if (currentAssistantMsgIdRef.current) {
            updateInlineToolCall(currentAssistantMsgIdRef.current, id, {
              status: 'rejected',
              error: TOOL_ERROR_MESSAGES.rejected,
            })
          }
          updateToolMessage(toolMsgId, {
            type: 'rejected',
            content: TOOL_ERROR_MESSAGES.rejected,
          })

          conversationMessages.push({
            role: 'tool',
            content: TOOL_ERROR_MESSAGES.rejected,
            toolCallId: id,
            toolName: name,
            rawParams,
          })

          return { shouldContinue: false, interrupted: false }
        }

        // 更新为 running_now
        if (currentAssistantMsgIdRef.current) {
          updateInlineToolCall(currentAssistantMsgIdRef.current, id, { status: 'running_now' })
        }
        updateToolMessage(toolMsgId, { type: 'running_now' })
      }

      // 设置流状态为工具执行中
      setStreamRunning('tool', {
        toolInfo: {
          toolName: name,
          toolParams: rawParams,
          id,
          content: '',
          rawParams,
        },
      })

      // 创建工具编辑检查点
      if (approvalType === 'edits' && rawParams.path) {
        const path = String(rawParams.path)
        const content = await window.electronAPI.readFile(path)
        if (content !== null) {
          const snapshots: Record<string, FileSnapshot> = {
            [path]: { content },
          }
          addCheckpoint('tool_edit', `Before ${name}: ${path}`, snapshots)
        }
      }

      // 执行工具
      try {
        const { result, error } = await executeTool(name, rawParams, workspacePath ?? undefined)

        if (abortRef.current) {
          if (currentAssistantMsgIdRef.current) {
            updateInlineToolCall(currentAssistantMsgIdRef.current, id, {
              status: 'rejected',
              error: TOOL_ERROR_MESSAGES.interrupted,
            })
          }
          updateToolMessage(toolMsgId, {
            type: 'rejected',
            content: TOOL_ERROR_MESSAGES.interrupted,
          })
          return { shouldContinue: false, interrupted: true }
        }

        if (error) {
          if (currentAssistantMsgIdRef.current) {
            updateInlineToolCall(currentAssistantMsgIdRef.current, id, {
              status: 'tool_error',
              error,
            })
          }
          updateToolMessage(toolMsgId, {
            type: 'tool_error',
            content: error,
          })

          conversationMessages.push({
            role: 'tool',
            content: `Error: ${error}`,
            toolCallId: id,
            toolName: name,
            rawParams,
          })

          return { shouldContinue: true, interrupted: false }
        }

        // 成功 - 更新内嵌工具调用和独立工具消息
        if (currentAssistantMsgIdRef.current) {
          updateInlineToolCall(currentAssistantMsgIdRef.current, id, {
            status: 'success',
            result,
          })
        }
        updateToolMessage(toolMsgId, {
          type: 'success',
          content: result,
          result,
        })

        conversationMessages.push({
          role: 'tool',
          content: result,
          toolCallId: id,
          toolName: name,
          rawParams,
        })

        return { shouldContinue: true, interrupted: false }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        if (currentAssistantMsgIdRef.current) {
          updateInlineToolCall(currentAssistantMsgIdRef.current, id, {
            status: 'tool_error',
            error: errorMsg,
          })
        }
        updateToolMessage(toolMsgId, {
          type: 'tool_error',
          content: errorMsg,
        })

        conversationMessages.push({
          role: 'tool',
          content: `Error: ${errorMsg}`,
          toolCallId: id,
          toolName: name,
          rawParams,
        })

        return { shouldContinue: true, interrupted: false }
      }
    },
    [
      autoApprove,
      workspacePath,
      addToolMessage,
      updateToolMessage,
      linkToolCallToMessage,
      addInlineToolCall,
      updateInlineToolCall,
      setStreamRunning,
      waitForApproval,
      addCheckpoint,
    ]
  )

  // ===== 发送消息 =====

  const sendMessage = useCallback(
    async (userMessage: MessageContent) => {
      if (!llmConfig.apiKey) {
        addAssistantMessage('❌ Please configure your API key in Settings first.')
        return
      }

      abortRef.current = false

      // 提取文本内容
      const textContent =
        typeof userMessage === 'string'
          ? userMessage
          : userMessage
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('')

      // 创建用户消息检查点
      if (workspacePath) {
        const checkpoint = await checkpointService.createCheckpoint(
          'user_message',
          `Before: "${textContent.slice(0, 50)}..."`,
          []
        )
        const snapshots: Record<string, FileSnapshot> = {}
        for (const [path, data] of Object.entries(checkpoint.snapshots || {})) {
          snapshots[path] = { content: data.content }
        }
        addCheckpoint('user_message', checkpoint.description, snapshots)
      }

      // 收集上下文（统一处理所有上下文类型）
      const {
        files: contextFiles,
        semanticResults,
        cleanedMessage,
        projectStructure,
        symbolsContext,
        gitContext,
        terminalContext,
        attachedFilesContext,
      } = await contextService.collectContext(textContent, {
        includeActiveFile: true,
        includeOpenFiles: false,
        includeProjectStructure: true,
        contextItems: stagingSelections.map(s => ({
          type: s.type,
          uri: 'uri' in s ? s.uri : undefined,
          range: s.type === 'CodeSelection' ? (s as { range: [number, number] }).range : undefined,
          query: s.type === 'Codebase' ? (s as { query?: string }).query : undefined,
        })),
      })

      // 构建带上下文的消息
      let messageWithContext = cleanedMessage
      
      if (
        contextFiles.length > 0 ||
        projectStructure ||
        semanticResults.length > 0 ||
        symbolsContext ||
        gitContext ||
        terminalContext ||
        attachedFilesContext
      ) {
        messageWithContext +=
          '\n\n' +
          buildContextString(
            contextFiles,
            projectStructure,
            semanticResults,
            symbolsContext,
            gitContext,
            terminalContext,
            attachedFilesContext
          )
      }
      
      // 清除 staging selections（发送后清除）
      if (stagingSelections.length > 0) {
        clearStagingSelections()
      }

      // 添加用户消息
      addUserMessage(userMessage)

      // 构建对话历史（硬截断策略）
      const maxHistory = getMaxHistoryMessages()
      const maxToolResult = getMaxToolResultChars()
      const recentMessages = messages.slice(-maxHistory)

      // 构建当前用户消息内容
      let currentUserContent: MessageContent
      if (typeof userMessage === 'string') {
        currentUserContent = messageWithContext
      } else {
        currentUserContent = userMessage.map((part) => {
          if (part.type === 'text') {
            return { type: 'text' as const, text: messageWithContext }
          }
          return part
        })
      }

      // 构建对话历史 - 过滤掉无效消息，截断工具结果
      const validMessages = recentMessages.filter((m) => {
        if (m.role === 'checkpoint') return false
        if (m.role === 'tool') {
          const toolMsg = m as ToolMessage
          return toolMsg.toolCallId && !toolMsg.toolCallId.includes(':')
        }
        return true
      })

      // 构建对话消息数组（工具结果硬截断）
      const conversationMessages: LLMMessageForSend[] = [
        ...validMessages.map((m) => {
          const content = 'content' in m ? (m.content as string) : ''
          // 工具消息结果截断
          const truncatedContent = m.role === 'tool' 
            ? truncateToolResult(content, maxToolResult)
            : content
          
          return {
            role: m.role as 'user' | 'assistant' | 'tool',
            content: truncatedContent,
            toolCallId: m.role === 'tool' ? (m as ToolMessage).toolCallId : undefined,
            toolName: m.role === 'tool' ? (m as ToolMessage).name : undefined,
            rawParams: m.role === 'tool' ? (m as ToolMessage).rawParams : undefined,
          }
        }),
        { role: 'user' as const, content: currentUserContent },
      ]

      // Agent 循环
      let shouldContinue = true
      let loopCount = 0
      const chatMode = useStore.getState().chatMode

      // 创建初始助手消息
      currentAssistantMsgIdRef.current = addAssistantMessage('', true)
      setStreamRunning('LLM', {
        llmInfo: {
          displayContentSoFar: '',
          reasoningSoFar: '',
          toolCallSoFar: null,
        },
      })

      while (shouldContinue && loopCount < getMaxToolLoops() && !abortRef.current) {
        loopCount++
        shouldContinue = false

        // 获取工具
        const tools = chatMode === 'agent' ? getToolDefinitions() : undefined

        // 获取上下文信息
        const state = useStore.getState()
        const openFilePaths = state.openFiles.map((f) => f.path)
        const activeFilePath = state.activeFilePath || undefined

        const systemPrompt = await buildSystemPrompt(chatMode, workspacePath, {
          openFiles: openFilePaths,
          activeFile: activeFilePath,
          promptTemplateId,
        })

        // Token 估算日志（1 token ≈ 4 字符）
        const estimateTokens = (text: string) => Math.ceil(text.length / 4)
        const systemTokens = estimateTokens(systemPrompt)
        const messagesTokens = conversationMessages.reduce((sum, m) => {
          const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          return sum + estimateTokens(content)
        }, 0)
        const totalEstimate = systemTokens + messagesTokens
        console.log(`[Token估算] 系统提示: ${systemTokens}, 消息历史: ${messagesTokens}, 总计: ~${totalEstimate} tokens`)

        // 用于跟踪当前流式工具调用
        let currentToolCallSoFar: {
          id: string
          name: string
          rawParams: Record<string, unknown>
          argsString: string
          isDone: boolean
        } | null = null

        // 发送到 LLM
        const result = await sendToLLM({
          config: llmConfig,
          messages: conversationMessages,
          tools,
          systemPrompt,
          onStream: (chunk) => {
            if (chunk.type === 'text' && chunk.content) {
              appendToLastAssistantMessage(chunk.content)
            }
            
            // 处理流式工具调用
            if (chunk.type === 'tool_call_start' && chunk.toolCallDelta) {
              // 工具调用开始 - 立即在 UI 中显示 pending 状态
              currentToolCallSoFar = {
                id: chunk.toolCallDelta.id || '',
                name: chunk.toolCallDelta.name || '',
                rawParams: {},
                argsString: '',
                isDone: false,
              }
              
              // 立即添加到 assistant 消息中显示 loading
              if (currentAssistantMsgIdRef.current && currentToolCallSoFar.id) {
                addInlineToolCall(currentAssistantMsgIdRef.current, {
                  id: currentToolCallSoFar.id,
                  name: currentToolCallSoFar.name,
                  status: 'pending',
                  rawParams: {},
                })
              }
            }
            
            if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta && currentToolCallSoFar) {
              // 工具调用参数增量
              if (chunk.toolCallDelta.args) {
                currentToolCallSoFar.argsString += chunk.toolCallDelta.args
                // 尝试解析参数
                try {
                  currentToolCallSoFar.rawParams = JSON.parse(currentToolCallSoFar.argsString)
                  // 更新 UI 中的参数
                  if (currentAssistantMsgIdRef.current && currentToolCallSoFar.id) {
                    updateInlineToolCall(currentAssistantMsgIdRef.current, currentToolCallSoFar.id, {
                      rawParams: currentToolCallSoFar.rawParams,
                    })
                  }
                } catch {
                  // 参数还不完整，继续累积
                }
              }
            }
            
            if (chunk.type === 'tool_call_end' && currentToolCallSoFar) {
              // 工具调用流式完成，更新参数
              currentToolCallSoFar.isDone = true
              if (chunk.toolCall) {
                currentToolCallSoFar.rawParams = chunk.toolCall.arguments
              }
            }
          },
          onToolCall: () => {
            // 工具调用完成时的回调
          },
        })

        // 处理错误
        if (result.error) {
          const errorMessage = result.error.retryable
            ? `\n\n❌ ${result.error.message}\n\nThis error may be temporary. Please try again.`
            : `\n\n❌ ${result.error.message}`

          appendToLastAssistantMessage(errorMessage)
          setStreamError(result.error.message)
          finalizeLastMessage()
          return
        }

        // 更新对话历史 - 添加 assistant 消息
        // 按照 void 的方式：只添加一个 assistant 消息，tool_calls 会在 main 进程中
        // 遇到 tool 消息时动态添加到前一个 assistant 消息
        const currentThread = chatThreadService.getCurrentThread()
        const lastMsg = currentThread.messages[currentThread.messages.length - 1]
        const hasToolCalls = result.data?.toolCalls && result.data.toolCalls.length > 0

        if (lastMsg && lastMsg.role === 'assistant' && 'content' in lastMsg) {
          conversationMessages.push({
            role: 'assistant',
            content: lastMsg.content || '',
          })
        }

        // 处理工具调用
        if (hasToolCalls && chatMode === 'agent') {
          for (const toolCall of result.data!.toolCalls!) {
            if (abortRef.current) break

            const { shouldContinue: continueLoop, interrupted } = await executeToolCall(
              toolCall,
              conversationMessages
            )

            if (interrupted) break
            shouldContinue = continueLoop
          }

          // 如果需要继续，不创建新消息，继续使用当前 assistant 消息
          // Cursor 风格：工具执行后 LLM 继续输出追加到同一个消息
          if (shouldContinue && !abortRef.current) {
            // 不调用 finalizeLastMessage()，保持当前消息为 streaming 状态
            // 不创建新的 assistant 消息，继续使用 currentAssistantMsgIdRef.current
            setStreamRunning('LLM', {
              llmInfo: {
                displayContentSoFar: '',
                reasoningSoFar: '',
                toolCallSoFar: null,
              },
            })
          }
        }
      }

      if (loopCount >= getMaxToolLoops()) {
        appendToLastAssistantMessage(
          '\n\n⚠️ Reached maximum tool call limit. Please continue with a new message if needed.'
        )
      }

      setStreamRunning(undefined)
      finalizeLastMessage()
      currentAssistantMsgIdRef.current = null
    },
    [
      llmConfig,
      workspacePath,
      messages,
      stagingSelections,
      addUserMessage,
      addAssistantMessage,
      appendToLastAssistantMessage,
      linkToolCallToMessage,
      finalizeLastMessage,
      setStreamRunning,
      setStreamError,
      addCheckpoint,
      executeToolCall,
      clearStagingSelections,
    ]
  )

  // ===== 中止 =====

  const abort = useCallback(() => {
    abortRef.current = true
    window.electronAPI.abortMessage()

    // 如果正在等待审批，拒绝
    if (approvalResolverRef.current) {
      approvalResolverRef.current(false)
      approvalResolverRef.current = null
    }

    setStreamRunning(undefined)
    finalizeLastMessage()
    currentAssistantMsgIdRef.current = null
  }, [setStreamRunning, finalizeLastMessage])

  // ===== 回滚 =====

  const rollbackToCheckpoint = useCallback(
    async (checkpointId: string) => {
      const result = await checkpointService.rollbackTo(checkpointId)
      if (result.success) {
        addAssistantMessage(
          `✅ Rolled back to checkpoint. Restored ${result.restoredFiles.length} file(s).`
        )
      } else {
        addAssistantMessage(`⚠️ Rollback completed with errors:\n${result.errors.join('\n')}`)
      }
      return result
    },
    [addAssistantMessage]
  )

  return {
    // 状态
    messages,
    streamState,
    isStreaming,
    isAwaitingApproval,

    // 操作
    sendMessage,
    abort,
    approveCurrentTool,
    rejectCurrentTool,
    rollbackToCheckpoint,
    clearMessages,
  }
}
