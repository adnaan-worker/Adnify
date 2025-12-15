/**
 * 增强版 Agent Hook
 * 支持工具审批流程和检查点
 */

import { useCallback, useEffect, useRef } from 'react'
import { useStore, ToolCall } from '../store'
import { getTools, executeToolCall, buildSystemPrompt, getToolApprovalType } from '../agent/tools'
import { checkpointService } from '../agent/checkpointService'
import { ToolStatus } from '../agent/toolTypes'

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
	} = useStore()

	const abortRef = useRef(false)
	const approvalResolverRef = useRef<((approved: boolean) => void) | null>(null)

	// 监听 LLM 事件
	useEffect(() => {
		const unsubStream = window.electronAPI.onLLMStream((data) => {
			if (data.type === 'text' && data.content) {
				updateLastMessage(
					(useStore.getState().messages.at(-1)?.content || '') + data.content
				)
			} else if (data.type === 'tool_call') {
				const approvalType = getToolApprovalType(data.name)
				addToolCall({
					id: data.id,
					name: data.name,
					arguments: data.arguments,
					approvalType,
				})
			}
		})

		const unsubError = window.electronAPI.onLLMError((error) => {
			console.error('LLM Error:', error)
			setIsStreaming(false)
			addMessage({
				role: 'assistant',
				content: `❌ Error: ${error}`,
			})
		})

		const unsubDone = window.electronAPI.onLLMDone(() => {
			const lastMsg = useStore.getState().messages.at(-1)
			if (lastMsg?.isStreaming) {
				updateLastMessage(lastMsg.content)
			}
		})

		return () => {
			unsubStream()
			unsubError()
			unsubDone()
		}
	}, [addMessage, updateLastMessage, setIsStreaming, addToolCall])

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
	const sendMessage = useCallback(async (userMessage: string) => {
		if (!llmConfig.apiKey) return

		abortRef.current = false
		setIsStreaming(true)

		// 创建用户消息检查点
		if (workspacePath) {
			const checkpoint = await checkpointService.createCheckpoint(
				'user_message',
				`Before: "${userMessage.slice(0, 50)}..."`,
				[] // 可以添加当前打开的文件
			)
			addCheckpoint(checkpoint)
		}

		// 添加用户消息
		addMessage({ role: 'user', content: userMessage })

		// 构建对话历史
		const conversationMessages = [
			...messages.map(m => ({
				role: m.role,
				content: m.content,
				toolCallId: m.toolCallId,
				toolName: m.toolName,
			})),
			{ role: 'user' as const, content: userMessage }
		]

		// Agent 循环
		let shouldContinue = true
		let loopCount = 0
		const maxLoops = 15

		while (shouldContinue && loopCount < maxLoops && !abortRef.current) {
			loopCount++
			shouldContinue = false

			// 添加助手响应占位符
			addMessage({ role: 'assistant', content: '', isStreaming: true })

			// 获取工具（仅 agent 模式）
			const tools = chatMode === 'agent' ? getTools() : undefined

			// 获取当前打开的文件和活动文件
			const state = useStore.getState()
			const openFilePaths = state.openFiles.map(f => f.path)
			const activeFilePath = state.activeFilePath || undefined

			const systemPrompt = buildSystemPrompt(chatMode, workspacePath, {
				openFiles: openFilePaths,
				activeFile: activeFilePath,
			})

			// 发送到 LLM
			// 先注册监听器，再发送请求，避免竞态条件
			const resultPromise = new Promise<{ toolCalls?: any[]; error?: string } | null>((resolve) => {
				let resolved = false

				const cleanup = () => {
					if (!resolved) {
						resolved = true
						unsubDone()
						unsubError()
					}
				}

				const unsubDone = window.electronAPI.onLLMDone((result) => {
					cleanup()
					resolve(result)
				})

				const unsubError = window.electronAPI.onLLMError((error) => {
					cleanup()
					resolve({ error })
				})

				// 超时保护
				setTimeout(() => {
					if (!resolved) {
						cleanup()
						resolve({ error: 'Request timeout' })
					}
				}, 120000) // 2分钟超时
			})

			// 发送请求
			await window.electronAPI.sendMessage({
				config: llmConfig,
				messages: conversationMessages,
				tools,
				systemPrompt,
			})

			// 等待响应完成
			const result = await resultPromise

			// 处理错误
			if (result?.error) {
				setIsStreaming(false)
				break
			}

			const assistantContent = useStore.getState().messages.at(-1)?.content || ''

			conversationMessages.push({
				role: 'assistant' as const,
				content: assistantContent,
				toolCallId: undefined,
				toolName: undefined,
			})

			// 处理工具调用
			if (result?.toolCalls && result.toolCalls.length > 0 && chatMode === 'agent') {
				for (const toolCall of result.toolCalls) {
					if (abortRef.current) break

					const approvalType = getToolApprovalType(toolCall.name)
					const toolCallWithApproval: ToolCall = {
						id: toolCall.id,
						name: toolCall.name,
						arguments: toolCall.arguments,
						status: 'pending' as ToolStatus,
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

									addMessage({
										role: 'tool',
										content: '❌ Tool call rejected by user',
										toolCallId: toolCall.id,
										toolName: toolCall.name,
									})

									conversationMessages.push({
										role: 'tool',
										content: 'Tool call was rejected by the user.',
										toolCallId: toolCall.id,
										toolName: toolCall.name,
									})

									continue
								}
							}

							// 执行工具
							updateToolCall(toolCall.id, { status: 'running' as ToolStatus })

							// 编辑类工具创建检查点
							if (approvalType === 'edits' && toolCall.arguments.path) {
								const checkpoint = await checkpointService.createCheckpoint(
									'tool_edit',
									`Before ${toolCall.name}: ${toolCall.arguments.path}`,
									[toolCall.arguments.path]
								)
								addCheckpoint(checkpoint)
							}

							try {
								const toolResult = await executeToolCall(toolCall.name, toolCall.arguments)

								updateToolCall(toolCall.id, {
									status: 'success' as ToolStatus,
									result: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
								})

								addMessage({
									role: 'tool',
									content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
									toolCallId: toolCall.id,
									toolName: toolCall.name,
								})

								conversationMessages.push({
									role: 'assistant',
									content: JSON.stringify(toolCall.arguments),
									toolCallId: toolCall.id,
									toolName: toolCall.name,
								})
								conversationMessages.push({
									role: 'tool',
									content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
									toolCallId: toolCall.id,
									toolName: toolCall.name,
								})

								shouldContinue = true
							} catch (error: any) {
								updateToolCall(toolCall.id, {
									status: 'error' as ToolStatus,
									error: error.message
								})

								addMessage({
									role: 'tool',
									content: `❌ Error: ${error.message}`,
									toolCallId: toolCall.id,
									toolName: toolCall.name,
								})

								conversationMessages.push({
									role: 'tool',
									content: `Error: ${error.message}`,
									toolCallId: toolCall.id,
									toolName: toolCall.name,
								})
							}
						}
					}
		}

		if (loopCount >= maxLoops) {
			addMessage({
				role: 'assistant',
				content: '⚠️ Reached maximum tool call limit. Please continue with a new message if needed.',
			})
		}

		setIsStreaming(false)
	}, [
		chatMode, messages, llmConfig, workspacePath, autoApprove,
		addMessage, updateLastMessage, setIsStreaming, addToolCall, updateToolCall,
		setPendingToolCall, addCheckpoint, waitForApproval
	])

	// 中止
	const abort = useCallback(() => {
		abortRef.current = true
		window.electronAPI.abortMessage()
		setIsStreaming(false)

		// 如果有等待审批的工具，拒绝它
		if (approvalResolverRef.current) {
			approvalResolverRef.current(false)
			approvalResolverRef.current = null
		}
		setPendingToolCall(null)
	}, [setIsStreaming, setPendingToolCall])

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
