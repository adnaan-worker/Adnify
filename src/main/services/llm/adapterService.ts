/**
 * Provider Adapter Service
 * 管理内置和自定义的 Provider 适配器
 * 提供工具格式转换和响应解析功能
 */

import {
    type LLMAdapterConfig,
    type XMLParseConfig,
    type ParsedToolCall,
    getBuiltinAdapter,
    getBuiltinAdapters
} from '../../../shared/config/providers'
import type { ToolDefinition, LLMMessage } from './types'

// ===== 适配器服务类 =====

class ProviderAdapterServiceClass {
    private customAdapters: Map<string, LLMAdapterConfig> = new Map()

    getAdapter(adapterId: string): LLMAdapterConfig | null {
        if (this.customAdapters.has(adapterId)) {
            return this.customAdapters.get(adapterId)!
        }
        return getBuiltinAdapter(adapterId) || null
    }

    getAllAdapters(): LLMAdapterConfig[] {
        const all = [...getBuiltinAdapters()]
        this.customAdapters.forEach(adapter => all.push(adapter))
        return all
    }

    registerAdapter(adapter: LLMAdapterConfig): void {
        this.customAdapters.set(adapter.id, adapter)
    }

    removeAdapter(adapterId: string): boolean {
        return this.customAdapters.delete(adapterId)
    }

    convertTools(tools: ToolDefinition[], adapterId: string): unknown[] {
        const adapter = this.getAdapter(adapterId) || getBuiltinAdapter('openai')!
        // 默认使用 OpenAI 格式
        const config = adapter.toolFormat || getBuiltinAdapter('openai')!.toolFormat!

        return tools.map(tool => {
            const toolDef: Record<string, unknown> = {
                name: tool.name,
                description: tool.description,
                [config.parameterField]: tool.parameters
            }

            if (config.wrapMode === 'function' && config.wrapField) {
                const wrapped: Record<string, unknown> = {
                    [config.wrapField]: toolDef
                }
                if (config.includeType) {
                    wrapped.type = 'function'
                }
                return wrapped
            }

            if (config.includeType && config.wrapMode === 'tool') {
                return { type: 'tool', ...toolDef }
            }

            return toolDef
        })
    }

    parseToolCalls(response: unknown, adapterId: string): ParsedToolCall[] {
        const adapter = this.getAdapter(adapterId) || getBuiltinAdapter('openai')!
        // 优先使用 toolParse 配置，否则回退到 response 配置（兼容旧逻辑）
        const toolParse = adapter.toolParse
        const responseConfig = adapter.response

        // 如果有明确的 toolParse 配置
        if (toolParse) {
            if (toolParse.responseFormat === 'xml') {
                return this.parseXMLToolCalls(response as string, toolParse.xmlConfig!)
            }

            if (toolParse.responseFormat === 'mixed') {
                // 尝试 JSON 解析
                const jsonCalls = this.parseJSONToolCalls(response, {
                    toolCallPath: toolParse.toolCallPath,
                    toolNamePath: toolParse.toolNamePath,
                    toolArgsPath: toolParse.toolArgsPath,
                    argsIsObject: toolParse.argsIsObject,
                    toolIdPath: toolParse.toolIdPath,
                    autoGenerateId: toolParse.autoGenerateId
                })
                if (jsonCalls.length > 0) return jsonCalls

                // 回退到 XML 解析
                if (typeof response === 'string' && toolParse.xmlConfig) {
                    return this.parseXMLToolCalls(response, toolParse.xmlConfig)
                }
            }

            // 默认 JSON 解析
            return this.parseJSONToolCalls(response, {
                toolCallPath: toolParse.toolCallPath,
                toolNamePath: toolParse.toolNamePath,
                toolArgsPath: toolParse.toolArgsPath,
                argsIsObject: toolParse.argsIsObject,
                toolIdPath: toolParse.toolIdPath,
                autoGenerateId: toolParse.autoGenerateId
            })
        }

        // 兼容旧的 response 配置 (仅支持 JSON)
        return this.parseJSONToolCalls(response, {
            toolCallPath: responseConfig.toolCallField,
            toolNamePath: responseConfig.toolNamePath,
            toolArgsPath: responseConfig.toolArgsPath,
            argsIsObject: responseConfig.argsIsObject,
            toolIdPath: responseConfig.toolIdPath,
            autoGenerateId: false // 旧配置默认不自动生成 ID
        })
    }

    private parseJSONToolCalls(response: unknown, config: {
        toolCallPath?: string
        toolNamePath?: string
        toolArgsPath?: string
        argsIsObject?: boolean
        toolIdPath?: string
        autoGenerateId?: boolean
    }): ParsedToolCall[] {
        const results: ParsedToolCall[] = []
        const toolCalls = this.getByPath(response, config.toolCallPath || 'tool_calls')
        if (!toolCalls) return results

        const callArray = Array.isArray(toolCalls) ? toolCalls : [toolCalls]

        for (const tc of callArray) {
            const name = this.getByPath(tc, config.toolNamePath || 'function.name') as string
            const rawArgs = this.getByPath(tc, config.toolArgsPath || 'function.arguments')
            const id = this.getByPath(tc, config.toolIdPath || 'id') as string ||
                (config.autoGenerateId ? this.generateId() : '')

            if (!name) continue

            let args: Record<string, unknown>
            if (config.argsIsObject) {
                args = rawArgs as Record<string, unknown> || {}
            } else {
                try {
                    args = JSON.parse(rawArgs as string || '{}')
                } catch {
                    args = {}
                }
            }

            results.push({ id, name, arguments: args })
        }

        return results
    }

    private parseXMLToolCalls(content: string, config: XMLParseConfig): ParsedToolCall[] {
        const results: ParsedToolCall[] = []
        const tagPattern = new RegExp(`<${config.toolCallTag}[^>]*>([\\s\\S]*?)</${config.toolCallTag}>`, 'gi')

        let match
        while ((match = tagPattern.exec(content)) !== null) {
            const innerContent = match[1]
            let name = ''
            let args: Record<string, unknown> = {}

            if (config.nameSource.startsWith('@')) {
                const attrName = config.nameSource.slice(1)
                const attrPattern = new RegExp(`${attrName}=["']([^"']+)["']`)
                const attrMatch = match[0].match(attrPattern)
                if (attrMatch) name = attrMatch[1]
            } else {
                const namePattern = new RegExp(`<${config.nameSource}>([^<]+)</${config.nameSource}>`)
                const nameMatch = innerContent.match(namePattern)
                if (nameMatch) name = nameMatch[1].trim()
            }

            const argsPattern = new RegExp(`<${config.argsTag}>([\\s\\S]*?)</${config.argsTag}>`)
            const argsMatch = innerContent.match(argsPattern)
            if (argsMatch) {
                const argsContent = argsMatch[1].trim()
                if (config.argsFormat === 'json') {
                    try {
                        args = JSON.parse(argsContent)
                    } catch {
                        args = {}
                    }
                } else if (config.argsFormat === 'key-value') {
                    const kvPattern = /<(\w+)>([^<]*)<\/\1>/g
                    let kvMatch
                    while ((kvMatch = kvPattern.exec(argsContent)) !== null) {
                        args[kvMatch[1]] = kvMatch[2]
                    }
                }
            }

            if (name) {
                results.push({ id: this.generateId(), name, arguments: args })
            }
        }

        return results
    }

    formatToolResultMessage(
        toolCallId: string,
        _toolName: string, // 保留以支持未来扩展（如日志记录）
        result: string,
        adapterId: string
    ): LLMMessage {
        const adapter = this.getAdapter(adapterId) || getBuiltinAdapter('openai')!
        // 默认使用 OpenAI 格式
        const config = adapter.messageFormat || getBuiltinAdapter('openai')!.messageFormat!

        const msg: LLMMessage = {
            role: config.toolResultRole as 'tool' | 'user',
            content: result,
            [config.toolCallIdField]: toolCallId
        }

        if (config.wrapToolResult && config.toolResultWrapper) {
            msg.content = [{
                type: config.toolResultWrapper,
                content: result,
                tool_use_id: toolCallId
            }] as unknown as string
        }

        return msg
    }

    private getByPath(obj: unknown, path: string): unknown {
        if (!obj || !path) return undefined
        const parts = path.split('.')
        let current: unknown = obj
        for (const part of parts) {
            if (current && typeof current === 'object' && part in (current as object)) {
                current = (current as Record<string, unknown>)[part]
            } else {
                return undefined
            }
        }
        return current
    }

    private generateId(): string {
        return `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    }
}

export const adapterService = new ProviderAdapterServiceClass()
