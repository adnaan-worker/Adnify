/**
 * Custom Provider
 * 
 * 完全自定义模式的 LLM Provider 实现
 * 使用 LLMAdapterConfig 配置，支持自定义请求体和响应解析
 */

import { BaseProvider } from './base'
import { ChatParams, ToolDefinition, LLMToolCall, LLMErrorClass, LLMErrorCode } from '../types'
import { getByPath } from '@shared/utils/jsonUtils'
import type { LLMAdapterConfig } from '@shared/config/providers'
import { AGENT_DEFAULTS } from '@shared/constants'

/** 请求构建结果 */
interface RequestData {
    url: string
    method: 'POST' | 'GET'
    headers: Record<string, string>
    body: Record<string, unknown>
}

/** 扩展的 ToolCall 类型，用于累加参数 */
interface ToolCallWithBuffer extends LLMToolCall {
    _argsBuffer?: string
}

export class CustomProvider extends BaseProvider {
    private adapterConfig: LLMAdapterConfig
    private apiKey: string
    private baseUrl: string
    private timeout: number

    constructor(
        adapterConfig: LLMAdapterConfig,
        apiKey: string,
        baseUrl: string,
        timeout?: number
    ) {
        super(`Custom:${adapterConfig.name}`)
        this.adapterConfig = adapterConfig
        this.apiKey = apiKey
        this.baseUrl = baseUrl
        this.timeout = timeout || AGENT_DEFAULTS.DEFAULT_LLM_TIMEOUT
    }

    async chat(params: ChatParams): Promise<void> {
        const { model, messages, tools, systemPrompt, maxTokens, temperature, topP, signal, onStream, onToolCall, onComplete, onError } = params

        try {
            this.log('info', 'Chat', { model, messageCount: messages.length })

            const { request, response } = this.adapterConfig

            // 1. 构建请求
            const requestData = this.buildRequest({
                requestConfig: request,
                model,
                messages,
                tools,
                systemPrompt,
                maxTokens,
                temperature,
                topP,
            })

            // 2. 发送请求
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), this.timeout)

            // 合并外部 signal
            if (signal) {
                signal.addEventListener('abort', () => controller.abort())
            }

            try {
                const httpResponse = await fetch(requestData.url, {
                    method: requestData.method,
                    headers: requestData.headers,
                    body: JSON.stringify(requestData.body),
                    signal: controller.signal,
                })

                clearTimeout(timeoutId)

                if (!httpResponse.ok) {
                    const errorText = await httpResponse.text()
                    throw new LLMErrorClass(
                        `HTTP ${httpResponse.status}: ${errorText}`,
                        this.mapHttpErrorCode(httpResponse.status),
                        httpResponse.status,
                        httpResponse.status === 429 || httpResponse.status >= 500
                    )
                }

                // 3. 解析响应
                await this.parseResponse(httpResponse, response, onStream, onToolCall, onComplete)
            } finally {
                clearTimeout(timeoutId)
            }
        } catch (error: unknown) {
            const llmError = this.parseError(error)
            // ABORTED 是用户主动取消，不是错误
            if (llmError.code === LLMErrorCode.ABORTED) {
                this.log('info', 'Chat aborted by user')
            } else {
                this.log('error', 'Chat failed', { code: llmError.code, message: llmError.message })
            }
            onError(llmError)
        }
    }

    /**
     * 构建 HTTP 请求
     */
    private buildRequest(params: {
        requestConfig: LLMAdapterConfig['request']
        model: string
        messages: ChatParams['messages']
        tools?: ToolDefinition[]
        systemPrompt?: string
        maxTokens?: number
        temperature?: number
        topP?: number
    }): RequestData {
        const { requestConfig, model, messages, tools, systemPrompt, maxTokens, temperature, topP } = params

        // 构建 URL
        const url = `${this.baseUrl}${requestConfig.endpoint}`

        // 构建请求头
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            ...requestConfig.headers,
        }

        // 转换消息格式
        const convertedMessages = this.convertMessages(messages, systemPrompt)

        // 转换工具定义
        const convertedTools = this.convertTools(tools)

        // 1. 先从 bodyTemplate 构建基础请求体
        const body = this.buildBodyFromTemplate(requestConfig.bodyTemplate)

        // 2. 填充核心字段
        body.model = model
        body.messages = convertedMessages
        if (convertedTools && convertedTools.length > 0) {
            body.tools = convertedTools
        }

        // 3. 填充 LLM 参数
        body.max_tokens = maxTokens || AGENT_DEFAULTS.DEFAULT_MAX_TOKENS
        if (temperature !== undefined) {
            body.temperature = temperature
        }
        if (topP !== undefined) {
            body.top_p = topP
        }

        // 4. 确保 stream 存在，并请求 usage 信息
        if (!('stream' in body)) {
            body.stream = true
        }
        // 请求返回 usage 信息（OpenAI 兼容 API）
        if (!('stream_options' in body)) {
            body.stream_options = { include_usage: true }
        }

        return { url, method: requestConfig.method, headers, body }
    }

    /**
     * 从模板构建请求体
     */
    private buildBodyFromTemplate(template: Record<string, unknown>): Record<string, unknown> {
        const body: Record<string, unknown> = {}

        for (const [key, value] of Object.entries(template)) {
            // 跳过占位符
            if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
                continue
            }
            // 跳过核心字段
            if (['model', 'messages', 'tools', 'max_tokens', 'temperature', 'top_p'].includes(key)) {
                continue
            }
            // 递归处理嵌套对象
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                body[key] = this.buildBodyFromTemplate(value as Record<string, unknown>)
            } else {
                body[key] = value
            }
        }

        return body
    }

    /**
     * 转换消息格式
     */
    private convertMessages(
        messages: ChatParams['messages'],
        systemPrompt?: string
    ): Array<{ role: string; content: unknown; tool_call_id?: string }> {
        const result: Array<{ role: string; content: unknown; tool_call_id?: string }> = []

        if (systemPrompt) {
            result.push({ role: 'system', content: systemPrompt })
        }

        for (const msg of messages) {
            if (msg.role === 'system') {
                result.push({ role: 'system', content: msg.content })
            } else if (msg.role === 'user') {
                result.push({ role: 'user', content: msg.content })
            } else if (msg.role === 'assistant') {
                const assistantMsg: any = { role: 'assistant', content: msg.content || '' }
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    assistantMsg.tool_calls = msg.tool_calls
                }
                result.push(assistantMsg)
            } else if (msg.role === 'tool') {
                result.push({
                    role: 'tool',
                    tool_call_id: (msg as any).tool_call_id,
                    content: msg.content,
                })
            }
        }

        return result
    }

    /**
     * 转换工具定义
     */
    private convertTools(tools?: ToolDefinition[]): Array<{ type: string; function: unknown }> | undefined {
        if (!tools || tools.length === 0) return undefined

        return tools.map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }))
    }

    /**
     * 解析响应流
     */
    private async parseResponse(
        httpResponse: Response,
        responseConfig: LLMAdapterConfig['response'],
        onStream: ChatParams['onStream'],
        onToolCall: ChatParams['onToolCall'],
        onComplete: ChatParams['onComplete']
    ): Promise<void> {
        const reader = httpResponse.body?.getReader()
        if (!reader) {
            throw new LLMErrorClass('Response body is not readable', LLMErrorCode.NETWORK_ERROR)
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        let fullReasoning = ''
        const toolCalls: Map<number, ToolCallWithBuffer> = new Map()
        let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

        const doneMarker = responseConfig.doneMarker || '[DONE]'
        const contentField = responseConfig.contentField || 'delta.content'
        const reasoningField = responseConfig.reasoningField
        const toolCallField = responseConfig.toolCallField || 'delta.tool_calls'
        const toolNamePath = responseConfig.toolNamePath || 'function.name'
        const toolArgsPath = responseConfig.toolArgsPath || 'function.arguments'
        const toolIdPath = responseConfig.toolIdPath || 'id'
        const argsIsObject = responseConfig.argsIsObject || false

        let streamEnded = false

        try {
            while (!streamEnded) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed) continue

                    let data = trimmed
                    if (trimmed.startsWith('data:')) {
                        data = trimmed.slice(5).trim()
                    }

                    if (data === doneMarker) {
                        streamEnded = true
                        break
                    }

                    let parsed: any
                    try {
                        parsed = JSON.parse(data)
                    } catch {
                        continue
                    }

                    // 提取 usage 信息（通常在最后一个 chunk 中）
                    if (parsed.usage) {
                        const u = parsed.usage
                        usage = {
                            promptTokens: u.prompt_tokens || u.promptTokens || 0,
                            completionTokens: u.completion_tokens || u.completionTokens || 0,
                            totalTokens: u.total_tokens || u.totalTokens || 0,
                        }
                    }

                    const choices = parsed.choices
                    if (!choices || !Array.isArray(choices) || choices.length === 0) continue
                    const choice = choices[0]

                    // 提取内容
                    const content = getByPath(choice, contentField)
                    if (content && typeof content === 'string') {
                        fullContent += content
                        onStream?.({ type: 'text', content })
                    }

                    // 提取推理
                    if (reasoningField) {
                        const reasoning = getByPath(choice, reasoningField)
                        if (reasoning && typeof reasoning === 'string') {
                            fullReasoning += reasoning
                            onStream?.({ type: 'reasoning', content: reasoning })
                        }
                    }

                    // 提取工具调用
                    const toolCallsData = getByPath(choice, toolCallField)
                    if (toolCallsData && Array.isArray(toolCallsData)) {
                        for (const tc of toolCallsData) {
                            const index = tc.index ?? 0
                            const id = getByPath(tc, toolIdPath) || `call_${index}`
                            const name = getByPath(tc, toolNamePath)
                            const argsData = getByPath(tc, toolArgsPath)

                            let existing = toolCalls.get(index)
                            if (!existing) {
                                existing = {
                                    id: String(id),
                                    name: typeof name === 'string' ? name : '',
                                    arguments: {},
                                    _argsBuffer: '',
                                }
                                toolCalls.set(index, existing)
                            }

                            if (typeof name === 'string') existing.name = name
                            if (id) existing.id = String(id)
                            
                            if (argsData) {
                                if (argsIsObject) {
                                    if (typeof argsData === 'object' && argsData !== null && !Array.isArray(argsData)) {
                                        existing.arguments = argsData as Record<string, unknown>
                                    } else if (typeof argsData === 'string') {
                                        try {
                                            existing.arguments = JSON.parse(argsData)
                                        } catch {
                                            existing._argsBuffer = (existing._argsBuffer || '') + argsData
                                            try {
                                                existing.arguments = JSON.parse(existing._argsBuffer)
                                            } catch {
                                                // 继续累加
                                            }
                                        }
                                    }
                                } else if (typeof argsData === 'string') {
                                    existing._argsBuffer = (existing._argsBuffer || '') + argsData
                                    try {
                                        existing.arguments = JSON.parse(existing._argsBuffer)
                                    } catch {
                                        // JSON 不完整，继续累加
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 完成：发送工具调用
            const finalToolCalls: LLMToolCall[] = []
            for (const tc of toolCalls.values()) {
                if (tc.name) {
                    const toolCall: LLMToolCall = {
                        id: tc.id,
                        name: tc.name,
                        arguments: tc.arguments,
                    }
                    finalToolCalls.push(toolCall)
                    onToolCall?.(toolCall)
                }
            }

            // 完成回调（包含 usage 信息）
            onComplete?.({
                content: fullContent,
                reasoning: fullReasoning || undefined,
                toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
                usage,
            })
        } finally {
            reader.releaseLock()
        }
    }

    /**
     * 映射 HTTP 错误码
     */
    private mapHttpErrorCode(status: number): LLMErrorCode {
        switch (status) {
            case 400: return LLMErrorCode.INVALID_REQUEST
            case 401: return LLMErrorCode.INVALID_API_KEY
            case 403: return LLMErrorCode.INVALID_API_KEY
            case 404: return LLMErrorCode.INVALID_REQUEST
            case 429: return LLMErrorCode.RATE_LIMIT
            case 500: return LLMErrorCode.UNKNOWN
            case 502: return LLMErrorCode.NETWORK_ERROR
            case 503: return LLMErrorCode.NETWORK_ERROR
            default: return LLMErrorCode.UNKNOWN
        }
    }
}
