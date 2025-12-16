/**
 * Agent Hook
 * 管理 AI 对话和工具调用流程
 */

import { useCallback, useRef } from 'react'
import { useStore, ToolCall } from '../store'
import { getTools, executeToolCall, buildSystemPrompt, getToolApprovalType } from '../agent/tools'
import { checkpointService } from '../agent/checkpointService'
import { contextService, buildContextString } from '../agent/contextService'
import { ToolStatus } from '../agent/toolTypes'
import { LLMStreamChunk, LLMToolCall, LLMResult, LLMError } from '../types/electron'

const MAX_TOOL_LOOPS = 15
const REQUEST_TIMEOUT = 120000 // 2 分钟

export function useAgent() {
	const {
		chatMode,
		messages,
		llmConfig,
		workspacePath,
		autoApprove,
		pendingToolCall,
		addMessage,
		updateLastMessage,
		setIsStreaming,
		addToolCall,
		updateToolCall,
		setPendingToolCall,
		addCheckpoint,
        finalizeLastMessage,
	} = useStore()

	const abortRef = useRef(false)
	const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null)

	// 等待用户审批
	const waitForApproval = useCallback((toolCall: ToolCall): Promise<boolean> => {
		return new Promise((resolve) => {
			approvalResolverRef.current = resolve
			setPendingToolCall(toolCall)
		})
	}, [setPendingToolCall])

	// 审批工具调用
	const approveCurrentTool = useCallback(() => {
		if (approvalResolverRef.current) {
			approvalResolverRef.current(true)
			approvalResolverRef.current = null
		}
		setPendingToolCall(null)
	}, [setPendingToolCall])

	const rejectCurrentTool = useCallback(() => {
		if (approvalResolverRef.current) {
			approvalResolverRef.current(false)
			approvalResolverRef.current = null
		}
		setPendingToolCall(null)
	}, [setPendingToolCall])

	// 发送消息
	const sendMessage = useCallback(async (userMessage: string | any[]) => {
		if (!llmConfig.apiKey) {
			addMessage({
				role: 'assistant',
				content: '❌ Please configure your API key in Settings first.',
			})
			return
		}

		abortRef.current = false
		setIsStreaming(true)
		
		// 提取文本内容用于上下文处理
		const textContent = typeof userMessage === 'string' 
			? userMessage 
			: userMessage.filter(c => c.type === 'text').map(c => c.text).join('')

		// 创建用户消息检查点
		if (workspacePath) {
			const checkpoint = await checkpointService.createCheckpoint(
				'user_message',
				`Before: "${userMessage.slice(0, 50)}..."`,
				[]
			)
			addCheckpoint(checkpoint)
		}

		// 处理 @file 和特殊上下文引用，收集上下文
		const { 
			files: contextFiles, 
			semanticResults, 
			cleanedMessage, 
			projectStructure,
			symbolsContext,
			gitContext,
			terminalContext
		} = await contextService.collectContext(
			textContent,
			{ includeActiveFile: true, includeOpenFiles: false, includeProjectStructure: true }
		)

		// 构建带上下文的消息
		let messageWithContext = cleanedMessage
		if (contextFiles.length > 0 || projectStructure || semanticResults.length > 0 || symbolsContext || gitContext || terminalContext) {
			messageWithContext += '\n\n' + buildContextString(contextFiles, projectStructure, semanticResults, symbolsContext, gitContext, terminalContext)
		}

		// 添加用户消息（显示原始消息，但发送带上下文的消息）
		addMessage({ role: 'user', content: userMessage as any })

		// 构建对话历史 - 将消息内容转换为字符串
		const conversationMessages: LLMMessageForSend[] = [
			...messages.map(m => ({
				role: m.role,
				content: typeof m.content === 'string' 
					? m.content 
					: m.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join(''),
				toolCallId: m.toolCallId,
				toolName: m.toolName,
			})),
			{ role: 'user' as const, content: messageWithContext }
		]

		// Agent 循环
		let shouldContinue = true
		let loopCount = 0
		
		// 创建一条助手消息，整个对话过程中复用这条消息
		addMessage({ role: 'assistant', content: '', isStreaming: true })

		while (shouldContinue && loopCount < MAX_TOOL_LOOPS && !abortRef.current) {
			loopCount++
			shouldContinue = false

			// 获取工具（仅 agent 模式）
			const tools = chatMode === 'agent' ? getTools() : undefined

			// 获取上下文信息
			const state = useStore.getState()
			const openFilePaths = state.openFiles.map(f => f.path)
			const activeFilePath = state.activeFilePath || undefined

			const systemPrompt = await buildSystemPrompt(chatMode, workspacePath, {
				openFiles: openFilePaths,
				activeFile: activeFilePath,
			})

			// 等待 LLM 响应
			const result = await sendToLLM({
				config: llmConfig,
				messages: conversationMessages,
				tools,
				systemPrompt,
				onStream: (chunk) => {
                    const state = useStore.getState()
					if (chunk.type === 'text' && chunk.content) {
                        state.appendTokenToLastMessage(chunk.content)
					} else if (chunk.type === 'tool_call_start' && chunk.toolCallDelta) {
                        const { id, name } = chunk.toolCallDelta
                        if (id && name) {
                            state.startToolCall(id, name)
                        }
                    } else if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta) {
                        const { id, args } = chunk.toolCallDelta
                        if (id && args) {
                            state.appendToolCallArgs(id, args)
                        }
                    }
				},
				onToolCall: (toolCall) => {
                    const state = useStore.getState()
					const approvalType = getToolApprovalType(toolCall.name)
                    
                    // Check if it already exists (from streaming)
                    const exists = state.currentToolCalls.some(tc => tc.id === toolCall.id)
                    
                    if (exists) {
                        // Update with final parsed arguments
                        updateToolCall(toolCall.id, {
                            arguments: toolCall.arguments,
                            approvalType
                        })
                    } else {
                        addToolCall({
                            id: toolCall.id,
                            name: toolCall.name,
                            arguments: toolCall.arguments,
                            approvalType,
                        })
                    }
				}
			})

			// 处理错误
			if (result.error) {
				const errorMessage = result.error.retryable
					? `\n\n❌ ${result.error.message}\n\nThis error may be temporary. Please try again.`
					: `\n\n❌ ${result.error.message}`

                const state = useStore.getState()
                state.appendTokenToLastMessage(errorMessage)
				setIsStreaming(false)
                finalizeLastMessage()
				return
			}

			// 确保消息已上屏 (处理非流式响应或极快响应)
            const finalContent = result.data?.content || ''
            if (finalContent) {
                const lastMsg = useStore.getState().messages.at(-1)
                if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.toolCallId) {
                    // 如果流式传输不完整，追加缺失的内容
                    const lastMsgText = typeof lastMsg.content === 'string' ? lastMsg.content : ''
                    if (!lastMsgText.includes(finalContent)) {
                        const state = useStore.getState()
                        if (lastMsgText.length === 0) {
                            state.updateLastMessage(finalContent)
                        }
                    }
                }
            }

			// 更新对话历史（用于下一轮 LLM 调用）
			const lastMsgContent = useStore.getState().messages.at(-1)?.content
			const assistantContent = typeof lastMsgContent === 'string' ? lastMsgContent : ''
			if (assistantContent) {
				conversationMessages.push({
					role: 'assistant' as const,
					content: assistantContent,
					toolCallId: undefined,
					toolName: undefined,
				})
			}

			// 处理工具调用
			if (result.data?.toolCalls && result.data.toolCalls.length > 0 && chatMode === 'agent') {
				for (const toolCall of result.data.toolCalls) {
					if (abortRef.current) break

					shouldContinue = await processToolCallSilent(
						toolCall,
						conversationMessages,
						autoApprove,
                        workspacePath,
						waitForApproval,
						updateToolCall,
						addCheckpoint
					)
				}
			}
		}

		if (loopCount >= MAX_TOOL_LOOPS) {
			addMessage({
				role: 'assistant',
				content: '⚠️ Reached maximum tool call limit. Please continue with a new message if needed.',
			})
		}

		setIsStreaming(false)
        finalizeLastMessage()
	}, [
		chatMode, messages, llmConfig, workspacePath, autoApprove,
		addMessage, updateLastMessage, setIsStreaming, addToolCall, updateToolCall,
		addCheckpoint, waitForApproval, finalizeLastMessage
	])

	// 中止
	const abort = useCallback(() => {
		abortRef.current = true
		window.electronAPI.abortMessage()
		setIsStreaming(false)
        finalizeLastMessage()

		if (approvalResolverRef.current) {
			approvalResolverRef.current(false)
			approvalResolverRef.current = null
		}
		setPendingToolCall(null)
	}, [setIsStreaming, setPendingToolCall, finalizeLastMessage])

	// 回滚到检查点
	const rollbackToCheckpoint = useCallback(async (checkpointId: string) => {
		const result = await checkpointService.rollbackTo(checkpointId)
		if (result.success) {
			addMessage({
				role: 'assistant',
				content: `✅ Rolled back to checkpoint. Restored ${result.restoredFiles.length} file(s).`,
			})
		} else {
			addMessage({
				role: 'assistant',
				content: `⚠️ Rollback completed with errors:\n${result.errors.join('\n')}`,
			})
		}
		return result
	}, [addMessage])

	return {
		sendMessage,
		abort,
		approveCurrentTool,
		rejectCurrentTool,
		rollbackToCheckpoint,
		pendingToolCall,
	}
}

interface LLMMessageForSend {
	role: 'user' | 'assistant' | 'system' | 'tool'
	content: string
	toolCallId?: string
	toolName?: string
}

interface ToolDefinitionForSend {
	name: string
	description: string
	parameters: {
		type: 'object'
		properties: Record<string, {
			type: string
			description: string
			enum?: string[]
		}>
		required?: string[]
	}
}

interface LLMConfigForSend {
	provider: string
	model: string
	apiKey: string
	baseUrl?: string
}

/**
 * 发送请求到 LLM 并等待响应
 */
async function sendToLLM(params: {
	config: LLMConfigForSend
	messages: LLMMessageForSend[]
	tools?: ToolDefinitionForSend[]
	systemPrompt: string
	onStream: (chunk: LLMStreamChunk) => void
	onToolCall: (toolCall: LLMToolCall) => void
}): Promise<{ data?: LLMResult; error?: LLMError }> {
	return new Promise((resolve) => {
		let resolved = false
		const unsubscribers: (() => void)[] = []

		const cleanup = () => {
			if (!resolved) {
				resolved = true
				unsubscribers.forEach(unsub => unsub())
			}
		}

		// 监听流式响应
		unsubscribers.push(
			window.electronAPI.onLLMStream(params.onStream)
		)

		// 监听工具调用
		unsubscribers.push(
			window.electronAPI.onLLMToolCall(params.onToolCall)
		)

		// 监听完成
		unsubscribers.push(
			window.electronAPI.onLLMDone((result) => {
				cleanup()
				resolve({ data: result })
			})
		)

		// 监听错误
		unsubscribers.push(
			window.electronAPI.onLLMError((error) => {
				cleanup()
				resolve({ error })
			})
		)

		// 超时保护
		setTimeout(() => {
			if (!resolved) {
				cleanup()
				resolve({
					error: {
						message: 'Request timeout. Please try again.',
						code: 'TIMEOUT',
						retryable: true
					}
				})
			}
		}, REQUEST_TIMEOUT)

		// 发送请求
		window.electronAPI.sendMessage({
			config: params.config,
			messages: params.messages,
			tools: params.tools,
			systemPrompt: params.systemPrompt,
		}).catch((err) => {
			if (!resolved) {
				cleanup()
				resolve({
					error: {
						message: err.message || 'IPC call failed',
						code: 'IPC_ERROR',
						retryable: false
					}
				})
			}
		})
	})
}

interface CheckpointToAdd {
	id: string
	type: 'user_message' | 'tool_edit'
	timestamp: number
	snapshots: Record<string, { path: string; content: string; timestamp: number }>
	description: string
}

/**
 * 处理单个工具调用（静默模式 - 不添加 tool 消息到 UI）
 * 工具结果在 ToolCallCard 中内联显示
 */
async function processToolCallSilent(
	toolCall: LLMToolCall,
	conversationMessages: LLMMessageForSend[],
	autoApprove: { edits: boolean; terminal: boolean; dangerous: boolean },
    workspacePath: string | null,
	waitForApproval: (tc: ToolCall) => Promise<boolean>,
	updateToolCall: (id: string, updates: Partial<ToolCall>) => void,
	addCheckpoint: (cp: CheckpointToAdd) => void
): Promise<boolean> {
	const approvalType = getToolApprovalType(toolCall.name)
	const toolCallWithApproval: ToolCall = {
		id: toolCall.id,
		name: toolCall.name,
		arguments: toolCall.arguments,
		status: 'running' as ToolStatus,
		approvalType,
	}

	// 检查是否需要审批
	let approved = true
	if (approvalType && !autoApprove[approvalType]) {
		updateToolCall(toolCall.id, { status: 'awaiting_user' as ToolStatus })
		approved = await waitForApproval(toolCallWithApproval)

		if (!approved) {
			updateToolCall(toolCall.id, {
				status: 'rejected' as ToolStatus,
				error: 'Rejected by user'
			})

			// 只添加到对话历史，不添加到 UI
			conversationMessages.push({
				role: 'tool',
				content: 'Tool call was rejected by the user.',
				toolCallId: toolCall.id,
				toolName: toolCall.name,
			})

			return false
		}
	}

	// 执行工具
	updateToolCall(toolCall.id, { status: 'running' as ToolStatus })

	// 编辑类工具创建检查点
	if (approvalType === 'edits' && toolCall.arguments.path) {
		// 解析完整路径以确保检查点能正确读取文件
		const relativePath = toolCall.arguments.path as string
		let fullPath = relativePath
		if (workspacePath && !relativePath.startsWith('/') && !relativePath.match(/^[a-zA-Z]:/)) {
			const sep = workspacePath.includes('\\') ? '\\' : '/'
			fullPath = `${workspacePath}${sep}${relativePath}`
		}
		
		const checkpoint = await checkpointService.createCheckpoint(
			'tool_edit',
			`Before ${toolCall.name}: ${relativePath}`,
			[fullPath]  // 使用完整路径创建快照
		)
		addCheckpoint(checkpoint)
	}

	try {
		const toolResult = await executeToolCall(toolCall.name, toolCall.arguments, workspacePath)
		const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)

		updateToolCall(toolCall.id, {
			status: 'success' as ToolStatus,
			result: resultStr
		})

		// 添加到对话历史（用于 LLM 上下文）
		conversationMessages.push({
			role: 'assistant',
			content: JSON.stringify(toolCall.arguments),
			toolCallId: toolCall.id,
			toolName: toolCall.name,
		})
		conversationMessages.push({
			role: 'tool',
			content: resultStr,
			toolCallId: toolCall.id,
			toolName: toolCall.name,
		})

		return true

	} catch (error: unknown) {
		const err = error as { message?: string }
		updateToolCall(toolCall.id, {
			status: 'error' as ToolStatus,
			error: err.message
		})

		conversationMessages.push({
			role: 'tool',
			content: `Error: ${err.message}`,
			toolCallId: toolCall.id,
			toolName: toolCall.name,
		})

		return false
	}
}
