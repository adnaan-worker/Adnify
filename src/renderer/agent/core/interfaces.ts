/**
 * Agent 环境抽象接口
 * 用于解耦 Electron API，方便测试和扩展
 */

import { LLMCallConfig } from './AgentService'
import { LLMStreamChunk, LLMToolCall } from '@/renderer/types/electron'
import { OpenAIMessage } from './MessageConverter'
import { ToolDefinition } from './types'

export interface IAgentEnvironment {
    // 文件系统操作
    readFile(path: string): Promise<string | null>
    writeFile(path: string, content: string): Promise<boolean>
    deleteFile(path: string): Promise<boolean>

    // 设置
    getSetting(key: string): Promise<any>

    // LLM 通信
    sendMessage(params: {
        config: LLMCallConfig
        messages: OpenAIMessage[]
        tools: ToolDefinition[]
        systemPrompt: string
    }): Promise<void>

    abortMessage(): void

    // 事件监听
    onLLMStream(callback: (chunk: LLMStreamChunk) => void): () => void
    onLLMToolCall(callback: (toolCall: LLMToolCall) => void): () => void
    onLLMDone(callback: (result: { content?: string; toolCalls?: LLMToolCall[] }) => void): () => void
    onLLMError(callback: (error: Error) => void): () => void
}
