/**
 * Electron 环境实现
 */

import { IAgentEnvironment } from './interfaces'
import { LLMCallConfig } from './AgentService'
import { LLMStreamChunk, LLMToolCall, LLMResult } from '@/renderer/types/electron'
import { OpenAIMessage } from './MessageConverter'
import { ToolDefinition } from './types'
import { logger } from '@/renderer/utils/Logger'

export class ElectronEnvironment implements IAgentEnvironment {
    async readFile(path: string): Promise<string | null> {
        return window.electronAPI.readFile(path)
    }

    async writeFile(path: string, content: string): Promise<boolean> {
        return window.electronAPI.writeFile(path, content)
    }

    async deleteFile(path: string): Promise<boolean> {
        return window.electronAPI.deleteFile(path)
    }

    async getSetting(key: string): Promise<any> {
        return window.electronAPI.getSetting(key)
    }

    async sendMessage({
        config,
        messages,
        tools,
        systemPrompt
    }: {
        config: LLMCallConfig
        messages: OpenAIMessage[]
        tools: ToolDefinition[]
        systemPrompt: string
    }): Promise<void> {
        return window.electronAPI.sendMessage({
            config,
            messages: messages as any,
            tools,
            systemPrompt
        }).catch(err => {
            logger.llm.error('Failed to send message', { error: err })
        })
    }

    abortMessage(): void {
        window.electronAPI.abortMessage()
    }

    onLLMStream(callback: (chunk: LLMStreamChunk) => void): () => void {
        return window.electronAPI.onLLMStream(callback)
    }

    onLLMToolCall(callback: (toolCall: LLMToolCall) => void): () => void {
        return window.electronAPI.onLLMToolCall(callback)
    }

    onLLMDone(callback: (result: LLMResult) => void): () => void {
        return window.electronAPI.onLLMDone(callback)
    }

    onLLMError(callback: (error: any) => void): () => void {
        return window.electronAPI.onLLMError(callback)
    }
}
