/**
 * Agent 服务 (Refactored)
 * 核心的 Agent 循环逻辑，处理 LLM 通信和工具执行
 */

import { useAgentStore } from './AgentStore'
import { useModeStore } from '@/renderer/modes'
import { useStore, ChatMode } from '../../store'
import { executeTool, getToolDefinitions, getToolApprovalType } from './ToolExecutor'
import { buildContextContent, buildLLMMessages } from './MessageBuilder'
import {
    UserMessage,
    AssistantMessage,
    ToolResultMessage,
    ContextItem,
    MessageContent,
    ToolDefinition,
    TextContent,
    ToolStatus,
    ToolExecutionResult,
} from './types'
import { MessageRole, StreamPhase, ToolResultType } from './enums'
import { LLMStreamChunk, LLMToolCall } from '@/renderer/types/electron'
import { logger } from '@/renderer/utils/Logger'
import { AGENT_DEFAULTS, READ_ONLY_TOOLS, isFileModifyingTool } from '@/shared/constants'
import { IAgentEnvironment } from './interfaces'
import { ElectronEnvironment } from './ElectronEnvironment'
import { ContextCompression } from './ContextCompression'
import { parsePartialJson, truncateToolResult } from '@/renderer/utils/partialJson'
import { parseXMLToolCalls } from './XMLToolParser'
import { PlanManager } from './PlanManager'
import { OpenAIMessage } from './MessageConverter'

export interface LLMCallConfig {
    provider: string
    model: string
    apiKey: string
    baseUrl?: string
    timeout?: number
    maxTokens?: number
    adapterId?: string
    adapterConfig?: import('@/shared/types/llmAdapter').LLMAdapterConfig
}

const READ_TOOLS = READ_ONLY_TOOLS as readonly string[]

// 从 store 获取动态配置
const getConfig = () => {
    const agentConfig = useStore.getState().agentConfig || {}
    return {
        maxToolLoops: agentConfig.maxToolLoops ?? AGENT_DEFAULTS.MAX_TOOL_LOOPS,
        maxHistoryMessages: agentConfig.maxHistoryMessages ?? 50,
        maxToolResultChars: agentConfig.maxToolResultChars ?? 10000,
        maxFileContentChars: agentConfig.maxFileContentChars ?? AGENT_DEFAULTS.MAX_FILE_CONTENT_CHARS,
        maxTotalContextChars: agentConfig.maxTotalContextChars ?? 50000,
        maxRetries: AGENT_DEFAULTS.MAX_RETRIES,
        retryDelayMs: AGENT_DEFAULTS.RETRY_DELAY_MS,
        retryBackoffMultiplier: AGENT_DEFAULTS.RETRY_BACKOFF_MULTIPLIER,
        toolTimeoutMs: AGENT_DEFAULTS.TOOL_TIMEOUT_MS,
        contextCompressThreshold: AGENT_DEFAULTS.CONTEXT_COMPRESS_THRESHOLD,
        keepRecentTurns: AGENT_DEFAULTS.KEEP_RECENT_TURNS,
    }
}

const RETRYABLE_ERROR_CODES = new Set([
    'RATE_LIMIT',
    'TIMEOUT',
    'NETWORK_ERROR',
    'SERVER_ERROR',
])

export class AgentServiceClass {
    private abortController: AbortController | null = null
    private approvalResolver: ((approved: boolean) => void) | null = null
    private currentAssistantId: string | null = null
    private isRunning = false
    private unsubscribers: (() => void)[] = []
    private readFilesInSession = new Set<string>()
    private contentBuffer: string = ''
    private activeStreamingToolCalls: Set<string> = new Set()

    private env: IAgentEnvironment
    private compression: ContextCompression
    private planManager: PlanManager

    constructor(env?: IAgentEnvironment) {
        this.env = env || new ElectronEnvironment()
        this.compression = new ContextCompression({
            maxContextChars: AGENT_DEFAULTS.CONTEXT_COMPRESS_THRESHOLD,
            maxToolResultChars: 2000,
            maxAssistantChars: 4000,
            recentKeepCount: 6
        })
        this.planManager = new PlanManager()
    }

    hasReadFile(filePath: string): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
        return this.readFilesInSession.has(normalizedPath)
    }

    markFileAsRead(filePath: string): void {
        const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase()
        this.readFilesInSession.add(normalizedPath)
        logger.agent.debug('File marked as read', { filePath })
    }

    clearSession(): void {
        this.readFilesInSession.clear()
        logger.agent.info('Session cleared')
    }

    async calculateContextStats(contextItems: ContextItem[], currentInput: string): Promise<void> {
        const state = useStore.getState()
        const agentStore = useAgentStore.getState()
        const messages = agentStore.getMessages()
        const filteredMessages = messages.filter(m => m.role !== MessageRole.Checkpoint)

        let totalChars = 0
        let fileCount = 0
        let semanticResultCount = 0

        for (const msg of filteredMessages) {
            if (msg.role === MessageRole.User || msg.role === MessageRole.Assistant) {
                const content = (msg as UserMessage | AssistantMessage).content
                if (typeof content === 'string') {
                    totalChars += content.length
                } else if (Array.isArray(content)) {
                    for (const part of content) {
                        if (part.type === 'text') totalChars += part.text.length
                    }
                }
            } else if (msg.role === MessageRole.Tool) {
                totalChars += (msg as ToolResultMessage).content.length
            }
        }

        totalChars += currentInput.length

        for (const item of contextItems) {
            if (item.type === 'File') {
                fileCount++
                const filePath = (item as any).uri
                if (filePath) {
                    try {
                        const content = await this.env.readFile(filePath)
                        if (content) {
                            totalChars += Math.min(content.length, getConfig().maxFileContentChars)
                        }
                    } catch (e) { }
                }
            } else if (item.type === 'Codebase') {
                semanticResultCount++
                totalChars += 2000
            }
        }

        const currentConfig = getConfig()
        const userAssistantMessages = filteredMessages.filter(m => m.role === MessageRole.User || m.role === MessageRole.Assistant)

        state.setContextStats({
            totalChars,
            maxChars: currentConfig.maxTotalContextChars,
            fileCount,
            maxFiles: 10,
            messageCount: userAssistantMessages.length,
            maxMessages: currentConfig.maxHistoryMessages,
            semanticResultCount,
            terminalChars: 0
        })
    }

    async sendMessage(
        userMessage: MessageContent,
        config: LLMCallConfig,
        workspacePath: string | null,
        systemPrompt: string,
        chatMode: ChatMode = 'agent'
    ): Promise<void> {
        if (this.isRunning) {
            logger.agent.warn('Already running, ignoring new request')
            return
        }

        const store = useAgentStore.getState()

        if (!config.apiKey) {
            this.showError('Please configure your API key in settings.')
            return
        }

        this.isRunning = true
        this.abortController = new AbortController()

        try {
            const contextItems = store.getCurrentThread()?.contextItems || []
            const userQuery = typeof userMessage === 'string' ? userMessage :
                (Array.isArray(userMessage) ? userMessage.filter(p => p.type === 'text').map(p => (p as TextContent).text).join('') : '')

            const contextContent = await buildContextContent(contextItems, workspacePath, userQuery)

            const userMessageId = store.addUserMessage(userMessage, contextItems)
            store.clearContextItems()

            const messageText = typeof userMessage === 'string'
                ? userMessage.slice(0, 50)
                : 'User message'
            await store.createMessageCheckpoint(userMessageId, messageText)

            const llmMessages = await buildLLMMessages(userMessage, contextContent, systemPrompt)

            this.currentAssistantId = store.addAssistantMessage()
            store.setStreamPhase(StreamPhase.Streaming)

            await this.runAgentLoop(config, llmMessages, workspacePath, chatMode, systemPrompt)

        } catch (error) {
            logger.agent.error('Error in sendMessage', { error })
            this.showError(error instanceof Error ? error.message : 'Unknown error occurred')
        } finally {
            this.cleanup()
        }
    }

    approve(): void {
        if (this.approvalResolver) {
            this.approvalResolver(true)
            this.approvalResolver = null
        }
    }

    reject(): void {
        if (this.approvalResolver) {
            this.approvalResolver(false)
            this.approvalResolver = null
        }
    }

    approveAndEnableAuto(): void {
        const streamState = useAgentStore.getState().streamState
        if (streamState.currentToolCall) {
            const approvalType = getToolApprovalType(streamState.currentToolCall.name)
            if (approvalType) {
                useStore.getState().setAutoApprove({ [approvalType]: true })
                logger.agent.info('Auto-approve enabled for type', { approvalType })
            }
        }
        this.approve()
    }

    abort(): void {
        if (this.abortController) {
            this.abortController.abort()
        }
        this.env.abortMessage()

        if (this.approvalResolver) {
            this.approvalResolver(false)
            this.approvalResolver = null
        }

        const store = useAgentStore.getState()
        if (this.currentAssistantId) {
            const thread = store.getCurrentThread()
            if (thread) {
                const assistantMsg = thread.messages.find(
                    m => m.id === this.currentAssistantId && m.role === MessageRole.Assistant
                )
                if (assistantMsg && assistantMsg.role === MessageRole.Assistant) {
                    for (const tc of (assistantMsg as any).toolCalls || []) {
                        if (['running', 'awaiting', 'pending'].includes(tc.status)) {
                            store.updateToolCall(this.currentAssistantId, tc.id, {
                                status: ToolStatus.Error,
                                error: 'Aborted by user',
                            })
                        }
                    }
                }
            }
        }

        this.cleanup()
    }

    private async runAgentLoop(
        config: LLMCallConfig,
        llmMessages: OpenAIMessage[],
        workspacePath: string | null,
        chatMode: ChatMode,
        systemPrompt: string
    ): Promise<void> {
        const store = useAgentStore.getState()
        let loopCount = 0
        let shouldContinue = true

        const recentToolCalls: string[] = []
        const MAX_RECENT_CALLS = 5
        let consecutiveRepeats = 0
        const MAX_CONSECUTIVE_REPEATS = 3

        const agentLoopConfig = getConfig()

        this.compression = new ContextCompression({
            maxContextChars: agentLoopConfig.contextCompressThreshold,
            maxToolResultChars: agentLoopConfig.maxToolResultChars,
            maxAssistantChars: 4000,
            recentKeepCount: agentLoopConfig.keepRecentTurns
        })

        while (shouldContinue && loopCount < agentLoopConfig.maxToolLoops && !this.abortController?.signal.aborted) {
            loopCount++
            shouldContinue = false

            logger.agent.info('Loop iteration', { iteration: loopCount })

            const compressedMessages = this.compression.compress(llmMessages)
            llmMessages.length = 0
            llmMessages.push(...compressedMessages)

            const result = await this.callLLMWithRetry(config, llmMessages, chatMode, systemPrompt)

            if (this.abortController?.signal.aborted) break

            if (result.error) {
                store.appendToAssistant(this.currentAssistantId!, `\n\n❌ Error: ${result.error}`)
                break
            }

            if (this.currentAssistantId && result.content !== undefined) {
                const currentMsg = store.getMessages().find(m => m.id === this.currentAssistantId)
                if (currentMsg && currentMsg.role === MessageRole.Assistant && currentMsg.content !== result.content) {
                    const newParts = currentMsg.parts.map(p =>
                        p.type === 'text' ? { ...p, content: result.content! } : p
                    )
                    store.updateMessage(this.currentAssistantId, {
                        content: result.content,
                        parts: newParts
                    })
                }
            }

            if (!result.toolCalls || result.toolCalls.length === 0) {
                if (this.planManager.processPlanLogic(llmMessages) && loopCount < agentLoopConfig.maxToolLoops) {
                    shouldContinue = true
                    continue
                }

                logger.agent.info('No tool calls, task complete')
                break
            }

            const currentCallSignature = result.toolCalls
                .map(tc => `${tc.name}:${JSON.stringify(tc.arguments)}`)
                .sort()
                .join('|')

            if (this.currentAssistantId) {
                const currentMsg = store.getMessages().find(m => m.id === this.currentAssistantId)
                if (currentMsg && currentMsg.role === MessageRole.Assistant) {
                    const existingToolCalls = (currentMsg as any).toolCalls || []
                    for (const tc of result.toolCalls) {
                        const existing = existingToolCalls.find((e: any) => e.id === tc.id)
                        if (!existing) {
                            store.addToolCallPart(this.currentAssistantId, {
                                id: tc.id,
                                name: tc.name,
                                arguments: tc.arguments,
                            })
                        } else if (!existing.status) {
                            store.updateToolCall(this.currentAssistantId, tc.id, { status: ToolStatus.Pending })
                        }
                    }
                }
            }

            if (recentToolCalls.includes(currentCallSignature)) {
                consecutiveRepeats++
                logger.agent.warn('Detected repeated tool call', { consecutiveRepeats, maxRepeats: MAX_CONSECUTIVE_REPEATS })
                if (consecutiveRepeats >= MAX_CONSECUTIVE_REPEATS) {
                    logger.agent.error('Too many repeated calls, stopping loop')
                    store.appendToAssistant(this.currentAssistantId!, '\n\n⚠️ Detected repeated operations. Stopping to prevent infinite loop.')
                    break
                }
            } else {
                consecutiveRepeats = 0
            }

            recentToolCalls.push(currentCallSignature)
            if (recentToolCalls.length > MAX_RECENT_CALLS) {
                recentToolCalls.shift()
            }

            llmMessages.push({
                role: 'assistant',
                content: result.content || null,
                tool_calls: result.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments),
                    },
                })),
            })

            let userRejected = false
            logger.agent.info('Executing tool calls', { count: result.toolCalls.length })

            const readToolCalls = result.toolCalls.filter(tc => READ_TOOLS.includes(tc.name))
            const writeToolCalls = result.toolCalls.filter(tc => !READ_TOOLS.includes(tc.name))

            if (readToolCalls.length > 0 && !this.abortController?.signal.aborted) {
                logger.agent.info('Executing read tools in parallel', { count: readToolCalls.length })
                const readResults = await Promise.all(
                    readToolCalls.map(async (toolCall) => {
                        logger.tool.debug('Executing read tool', { name: toolCall.name, arguments: toolCall.arguments })
                        try {
                            const toolResult = await this.executeToolCall(toolCall, workspacePath)
                            return { toolCall, toolResult }
                        } catch (error: any) {
                            logger.tool.error('Error executing read tool', { name: toolCall.name, error })
                            return {
                                toolCall,
                                toolResult: { success: false, content: `Error executing tool: ${error.message}`, rejected: false }
                            }
                        }
                    })
                )

                for (const { toolCall, toolResult } of readResults) {
                    llmMessages.push({
                        role: 'tool' as const,
                        tool_call_id: toolCall.id,
                        content: toolResult.content,
                    })
                    if (toolResult.rejected) userRejected = true
                }
            }

            for (const toolCall of writeToolCalls) {
                if (this.abortController?.signal.aborted || userRejected) break
                await new Promise(resolve => setTimeout(resolve, 0))

                logger.tool.debug('Executing write tool', { name: toolCall.name, arguments: toolCall.arguments })
                let toolResult
                try {
                    toolResult = await this.executeToolCall(toolCall, workspacePath)
                } catch (error: any) {
                    logger.tool.error('Error executing write tool', { name: toolCall.name, error })
                    toolResult = { success: false, content: `Error executing tool: ${error.message}`, rejected: false }
                }

                llmMessages.push({
                    role: 'tool' as const,
                    tool_call_id: toolCall.id,
                    content: toolResult.content,
                })

                if (toolResult.rejected) userRejected = true
            }

            // Observe Phase
            const { agentConfig } = useStore.getState()
            if (agentConfig.enableAutoFix && !userRejected && writeToolCalls.length > 0 && workspacePath) {
                const observation = await this.observeChanges(workspacePath, writeToolCalls)
                if (observation.hasErrors && observation.errors.length > 0) {
                    const observeMessage = `[Observation] 检测到以下代码问题，请修复：\n\n${observation.errors.slice(0, 3).join('\n\n')}`
                    llmMessages.push({
                        role: 'user' as const,
                        content: observeMessage,
                    })
                    store.appendToAssistant(this.currentAssistantId!, `\n\n🔍 **Auto-check**: Detected ${observation.errors.length} issue(s). Attempting to fix...`)
                    shouldContinue = true
                }
            }

            if (userRejected) break
            shouldContinue = true
            store.setStreamPhase(StreamPhase.Streaming)
        }

        if (loopCount >= agentLoopConfig.maxToolLoops) {
            store.appendToAssistant(this.currentAssistantId!, '\n\n⚠️ Reached maximum tool call limit.')
        }
    }

    private async callLLMWithRetry(
        config: LLMCallConfig,
        messages: OpenAIMessage[],
        chatMode: ChatMode,
        systemPrompt: string
    ): Promise<{ content?: string; toolCalls?: LLMToolCall[]; error?: string }> {
        let lastError: string | undefined
        const retryConfig = getConfig()
        let delay = retryConfig.retryDelayMs

        for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
            if (this.abortController?.signal.aborted) return { error: 'Aborted' }

            if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, delay))
                delay *= retryConfig.retryBackoffMultiplier
            }

            const result = await this.callLLM(config, messages, chatMode, systemPrompt)
            if (!result.error) return result

            if (!this.isRetryableError(result.error) || attempt === retryConfig.maxRetries) return result
            lastError = result.error
        }

        return { error: lastError || 'Max retries exceeded' }
    }

    private async callLLM(
        config: LLMCallConfig,
        messages: OpenAIMessage[],
        chatMode: ChatMode,
        systemPrompt: string
    ): Promise<{ content?: string; toolCalls?: LLMToolCall[]; error?: string }> {
        const store = useAgentStore.getState()

        return new Promise((resolve) => {
            let content = ''
            const toolCalls: LLMToolCall[] = []
            let currentToolCall: { id: string; name: string; argsString: string } | null = null

            const cleanupListeners = () => {
                this.unsubscribers.forEach(unsub => unsub())
                this.unsubscribers = []
            }

            const isValidToolName = (name: string) => {
                if (!/^[a-zA-Z0-9_-]+$/.test(name)) return false
                const isPlanMode = useModeStore.getState().currentMode === 'plan'
                return getToolDefinitions(isPlanMode).some((t: ToolDefinition) => t.name === name)
            }

            let isReasoning = false

            this.unsubscribers.push(
                this.env.onLLMStream((chunk: LLMStreamChunk) => {
                    if (chunk.type === 'text' && chunk.content) {
                        content += chunk.content
                        this.contentBuffer += chunk.content
                        if (this.currentAssistantId) {
                            store.appendToAssistant(this.currentAssistantId, chunk.content)
                            this.detectStreamingXMLToolCalls()
                        }
                    }

                    if (chunk.type === 'reasoning' && chunk.content) {
                        if (this.currentAssistantId) {
                            if (!isReasoning) {
                                isReasoning = true
                                const startTime = Date.now()
                                const openTag = `\n<thinking startTime="${startTime}">\n`
                                content += openTag
                                store.appendToAssistant(this.currentAssistantId, openTag)
                            }
                            content += chunk.content
                            store.appendToAssistant(this.currentAssistantId, chunk.content)
                        }
                    }

                    if (isReasoning && chunk.type !== 'reasoning') {
                        isReasoning = false
                        const closeTag = '\n</thinking>\n'
                        content += closeTag
                        if (this.currentAssistantId) {
                            store.appendToAssistant(this.currentAssistantId, closeTag)
                        }
                    }

                    // Tool call streaming
                    if (chunk.type === 'tool_call_start' && chunk.toolCallDelta) {
                        const toolId = chunk.toolCallDelta.id || `tool_${Date.now()}`
                        const toolName = chunk.toolCallDelta.name || 'unknown'
                        if (toolName !== 'unknown' && !isValidToolName(toolName)) return

                        currentToolCall = { id: toolId, name: toolName, argsString: '' }
                        if (this.currentAssistantId) {
                            store.addToolCallPart(this.currentAssistantId, {
                                id: toolId,
                                name: toolName,
                                arguments: { _streaming: true }
                            })
                        }
                    }

                    if (chunk.type === 'tool_call_delta' && chunk.toolCallDelta && currentToolCall) {
                        if (chunk.toolCallDelta.name) {
                            const newName = chunk.toolCallDelta.name
                            if (isValidToolName(newName)) {
                                currentToolCall.name = newName
                                if (this.currentAssistantId) {
                                    store.updateToolCall(this.currentAssistantId, currentToolCall.id, { name: newName })
                                }
                            }
                        }
                        if (chunk.toolCallDelta.args) {
                            currentToolCall.argsString += chunk.toolCallDelta.args
                            const partialArgs = this.parsePartialArgs(currentToolCall.argsString, currentToolCall.name)
                            if (this.currentAssistantId) {
                                store.updateToolCall(this.currentAssistantId, currentToolCall.id, {
                                    arguments: { ...partialArgs, _streaming: true }
                                })
                            }
                        }
                    }

                    if (chunk.type === 'tool_call_end' && currentToolCall) {
                        try {
                            const args = JSON.parse(currentToolCall.argsString || '{}')
                            toolCalls.push({ id: currentToolCall.id, name: currentToolCall.name, arguments: args })
                            if (this.currentAssistantId) {
                                store.updateToolCall(this.currentAssistantId, currentToolCall.id, {
                                    arguments: args,
                                    status: ToolStatus.Pending
                                })
                            }
                        } catch (e) {
                            toolCalls.push({ id: currentToolCall.id, name: currentToolCall.name, arguments: { _parseError: true, _rawArgs: currentToolCall.argsString } })
                        }
                        currentToolCall = null
                    }

                    if (chunk.type === 'tool_call' && chunk.toolCall) {
                        if (!isValidToolName(chunk.toolCall.name)) return
                        if (!toolCalls.find(tc => tc.id === chunk.toolCall!.id)) {
                            toolCalls.push(chunk.toolCall)
                            if (this.currentAssistantId) {
                                store.addToolCallPart(this.currentAssistantId, {
                                    id: chunk.toolCall.id,
                                    name: chunk.toolCall.name,
                                    arguments: chunk.toolCall.arguments
                                })
                            }
                        }
                    }
                })
            )

            this.unsubscribers.push(
                this.env.onLLMToolCall((toolCall) => {
                    if (!isValidToolName(toolCall.name)) return
                    if (!toolCalls.find(tc => tc.id === toolCall.id)) {
                        toolCalls.push(toolCall)
                        if (this.currentAssistantId) {
                            store.addToolCallPart(this.currentAssistantId, {
                                id: toolCall.id,
                                name: toolCall.name,
                                arguments: toolCall.arguments
                            })
                        }
                    }
                })
            )

            this.unsubscribers.push(
                this.env.onLLMDone((result) => {
                    if (isReasoning) {
                        isReasoning = false
                        if (this.currentAssistantId) {
                            store.appendToAssistant(this.currentAssistantId, '\n</thinking>\n')
                        }
                    }
                    cleanupListeners()
                    if (result.toolCalls) {
                        for (const tc of result.toolCalls) {
                            if (!toolCalls.find(t => t.id === tc.id)) toolCalls.push(tc)
                        }
                    }

                    let finalContent = content || result.content || ''
                    if (finalContent) {
                        const xmlToolCalls = parseXMLToolCalls(finalContent)
                        if (xmlToolCalls.length > 0) {
                            finalContent = finalContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
                            for (const tc of xmlToolCalls) {
                                const existing = toolCalls.find(t => t.name === tc.name && JSON.stringify(t.arguments) === JSON.stringify(tc.arguments))
                                if (!existing) {
                                    toolCalls.push(tc)
                                    if (this.currentAssistantId) {
                                        store.addToolCallPart(this.currentAssistantId, {
                                            id: tc.id,
                                            name: tc.name,
                                            arguments: tc.arguments,
                                        })
                                    }
                                }
                            }
                        }
                    }

                    resolve({ content: finalContent, toolCalls })
                })
            )

            this.unsubscribers.push(
                this.env.onLLMError((error) => {
                    if (isReasoning) {
                        isReasoning = false
                        if (this.currentAssistantId) {
                            store.appendToAssistant(this.currentAssistantId, '\n</thinking>\n')
                        }
                    }
                    cleanupListeners()
                    resolve({ error: error.message })
                })
            )

            const tools = getToolDefinitions(useModeStore.getState().currentMode === 'plan')
            this.env.sendMessage({
                config,
                messages,
                tools,
                systemPrompt
            }).catch(err => {
                cleanupListeners()
                resolve({ error: err.message })
            })
        })
    }

    private async executeToolCall(toolCall: LLMToolCall, workspacePath: string | null): Promise<any> {
        const store = useAgentStore.getState()
        const { id, name, arguments: args } = toolCall
        const approvalType = getToolApprovalType(name)
        const { autoApprove } = useStore.getState()
        const needsApproval = approvalType && !(autoApprove as any)[approvalType]

        if (this.currentAssistantId) {
            store.updateToolCall(this.currentAssistantId, id, {
                status: needsApproval ? ToolStatus.Awaiting : ToolStatus.Running,
            })
        }

        if (needsApproval) {
            store.setStreamPhase(StreamPhase.ToolPending, { id, name, arguments: args, status: ToolStatus.Awaiting })
            const approved = await new Promise<boolean>((resolve) => {
                this.approvalResolver = resolve
            })

            if (!approved) {
                if (this.currentAssistantId) {
                    store.updateToolCall(this.currentAssistantId, id, { status: ToolStatus.Rejected, error: 'Rejected by user' })
                }
                store.addToolResult(id, name, 'Tool call was rejected by the user.', ToolResultType.Rejected, args as Record<string, unknown>)
                return { success: false, content: 'Tool call was rejected by the user.', rejected: true }
            }

            if (this.currentAssistantId) {
                store.updateToolCall(this.currentAssistantId, id, { status: ToolStatus.Running })
            }
        }

        store.setStreamPhase(StreamPhase.ToolRunning, { id, name, arguments: args, status: ToolStatus.Running })

        const startTime = Date.now()
        useStore.getState().addToolCallLog({ type: 'request', toolName: name, data: { name, arguments: args } })

        let originalContent: string | null = null
        let fullPath: string | null = null
        if (isFileModifyingTool(name)) {
            const filePath = args.path as string
            if (filePath && workspacePath) {
                fullPath = filePath.startsWith(workspacePath) ? filePath : `${workspacePath}/${filePath}`.replace(/\/+/g, '/')
                originalContent = await this.env.readFile(fullPath)
                store.addSnapshotToCurrentCheckpoint(fullPath, originalContent)
            }
        }

        const config = getConfig()
        const timeoutMs = config.toolTimeoutMs
        const maxRetries = config.maxRetries
        const retryDelayMs = config.retryDelayMs

        const executeWithTimeout = () => Promise.race([
            executeTool(name, args, workspacePath || undefined),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
            )
        ])

        let result: ToolExecutionResult | undefined
        let lastError: string = ''

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                result = await executeWithTimeout()
                if (result.success) break
                lastError = result.error || 'Unknown error'
                if (attempt < maxRetries && this.isRetryableError(lastError)) {
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt))
                } else {
                    break
                }
            } catch (error: any) {
                lastError = error.message
                if (attempt < maxRetries && this.isRetryableError(lastError)) {
                    await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt))
                } else {
                    result = { success: false, result: '', error: lastError }
                    break
                }
            }
        }

        if (!result) {
            result = { success: false, result: '', error: lastError || 'Tool execution failed' }
        }

        useStore.getState().addToolCallLog({
            type: 'response',
            toolName: name,
            data: { success: result.success, result: result.result?.slice?.(0, 500), error: result.error },
            duration: Date.now() - startTime
        })

        const status: ToolStatus = result.success ? ToolStatus.Success : ToolStatus.Error
        if (this.currentAssistantId) {
            store.updateToolCall(this.currentAssistantId, id, {
                status,
                result: result.result,
                error: result.error,
                arguments: { ...args, _meta: result.meta },
            })
        }

        if (result.success && fullPath && isFileModifyingTool(name)) {
            const meta = result.meta as { linesAdded?: number; linesRemoved?: number; newContent?: string; isNewFile?: boolean } | undefined
            store.addPendingChange({
                filePath: fullPath,
                toolCallId: id,
                toolName: name,
                snapshot: { fsPath: fullPath, content: originalContent },
                linesAdded: meta?.linesAdded || 0,
                linesRemoved: meta?.linesRemoved || 0,
            })
        }

        const resultContent = result.success ? (result.result || '') : `Error: ${result.error || 'Unknown error'}`
        const truncatedContent = truncateToolResult(resultContent, name, config.maxToolResultChars)
        const resultType = result.success ? ToolResultType.Success : ToolResultType.ToolError
        store.addToolResult(id, name, truncatedContent, resultType, args as Record<string, unknown>)

        return { success: result.success, content: truncatedContent, rejected: false }
    }

    private detectStreamingXMLToolCalls(): void {
        if (!this.currentAssistantId) return
        const store = useAgentStore.getState()
        const content = this.contentBuffer

        const funcStartRegex = /<function[=\s]+["']?([^"'>\s]+)["']?\s*>/gi
        let match
        let lastFunc: { name: string, index: number, fullMatch: string } | null = null

        while ((match = funcStartRegex.exec(content)) !== null) {
            lastFunc = {
                name: match[1],
                index: match.index,
                fullMatch: match[0]
            }
        }

        if (!lastFunc) return

        const remainingContent = content.slice(lastFunc.index + lastFunc.fullMatch.length)
        const isClosed = remainingContent.includes('</function>')

        const args: Record<string, unknown> = {}
        const paramRegex = /<parameter[=\s]+["']?([^"'>\s]+)["']?\s*>([\s\S]*?)(?:<\/parameter>|$)/gi
        let paramMatch
        while ((paramMatch = paramRegex.exec(remainingContent)) !== null) {
            const paramName = paramMatch[1]
            let paramValue = paramMatch[2].trim()
            if (paramValue.startsWith('{') || paramValue.startsWith('[')) {
                const parsed = parsePartialJson(paramValue)
                if (parsed) paramValue = parsed as any
            }
            args[paramName] = paramValue
        }

        const streamingId = `stream-xml-${lastFunc.name}-${lastFunc.index}`
        if (!this.activeStreamingToolCalls.has(streamingId)) {
            this.activeStreamingToolCalls.add(streamingId)
            store.addToolCallPart(this.currentAssistantId, {
                id: streamingId,
                name: lastFunc.name,
                arguments: { ...args, _streaming: true }
            })
        } else {
            store.updateToolCall(this.currentAssistantId, streamingId, {
                arguments: { ...args, _streaming: !isClosed }
            })
        }
    }

    private parsePartialArgs(argsString: string, _toolName: string): Record<string, unknown> {
        if (!argsString || argsString.length < 2) return {}
        const parsed = parsePartialJson(argsString)
        return (parsed && Object.keys(parsed).length > 0) ? parsed : {}
    }

    private isRetryableError(error: string): boolean {
        const retryablePatterns = [
            /timeout/i,
            /ECONNRESET/i,
            /ETIMEDOUT/i,
            /ENOTFOUND/i,
            /network/i,
            /temporarily unavailable/i,
            /rate limit/i,
            /429/,
            /503/,
            /502/,
        ]
        return retryablePatterns.some(pattern => pattern.test(error))
    }

    private async observeChanges(
        workspacePath: string,
        writeToolCalls: LLMToolCall[]
    ): Promise<{ hasErrors: boolean; errors: string[] }> {
        const errors: string[] = []
        const editedFiles = writeToolCalls
            .filter(tc => ['edit_file', 'write_file', 'create_file_or_folder'].includes(tc.name))
            .map(tc => {
                const filePath = tc.arguments.path as string
                return filePath.startsWith(workspacePath) ? filePath : `${workspacePath}/${filePath}`.replace(/\/+/g, '/')
            })
            .filter(path => !path.endsWith('/'))

        for (const filePath of editedFiles) {
            try {
                const lintResult = await executeTool('get_lint_errors', { path: filePath }, workspacePath)
                if (lintResult.success && lintResult.result) {
                    const result = lintResult.result.trim()
                    if (result && result !== '[]' && result !== 'No diagnostics found') {
                        const hasActualError = /\[error\]/i.test(result) ||
                            result.toLowerCase().includes('failed to compile') ||
                            result.toLowerCase().includes('syntax error')
                        if (hasActualError) {
                            errors.push(`File: ${filePath}\n${result}`)
                        }
                    }
                }
            } catch (e) { }
        }
        return { hasErrors: errors.length > 0, errors }
    }

    private showError(message: string): void {
        const store = useAgentStore.getState()
        const id = store.addAssistantMessage()
        store.appendToAssistant(id, `❌ ${message}`)
        store.finalizeAssistant(id)
    }

    private cleanup(): void {
        this.isRunning = false
        this.currentAssistantId = null
        this.unsubscribers.forEach(unsub => unsub())
        this.unsubscribers = []
        this.contentBuffer = ''
        this.activeStreamingToolCalls.clear()

        const store = useAgentStore.getState()
        store.setStreamPhase(StreamPhase.Idle)
    }
}

export const AgentService = new AgentServiceClass()
