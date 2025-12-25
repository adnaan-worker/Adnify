import { OpenAIMessage } from './MessageConverter'
import { logger } from '@/renderer/utils/Logger'

export interface CompressionConfig {
    maxContextChars: number
    maxToolResultChars: number
    maxAssistantChars: number
    recentKeepCount: number
}

export class ContextCompression {
    constructor(private config: CompressionConfig) { }

    /**
     * 压缩消息列表以适应上下文限制
     * 策略：
     * 1. 保留最近 N 条消息完整
     * 2. 截断中间消息的工具结果
     * 3. 截断中间消息的长助手回复
     * 4. 如果仍然超长，丢弃最旧的中间消息（保留 System 和首条 User 消息通常较好，但这里简化为保留最近）
     */
    compress(messages: OpenAIMessage[]): OpenAIMessage[] {
        const totalChars = this.calculateTotalChars(messages)
        if (totalChars <= this.config.maxContextChars) {
            return messages
        }

        logger.agent.info('Context size exceeds limit, compressing', { totalChars, limit: this.config.maxContextChars })

        // 识别保留区域
        // 保留最后 recentKeepCount 条消息 (通常是 User + Assistant + Tools 的组合)
        // 同时也保留 System Prompt (通常是第一条)

        const systemMessage = messages.find(m => m.role === 'system')
        const otherMessages = messages.filter(m => m.role !== 'system')

        // 如果消息太少，直接返回（避免破坏）
        if (otherMessages.length <= this.config.recentKeepCount) {
            return messages
        }

        const recentMessages = otherMessages.slice(-this.config.recentKeepCount)
        const olderMessages = otherMessages.slice(0, -this.config.recentKeepCount)

        const compressedOlderMessages = olderMessages.map(msg => this.compressMessage(msg))

        // 重新组合
        const result = systemMessage ? [systemMessage, ...compressedOlderMessages, ...recentMessages] : [...compressedOlderMessages, ...recentMessages]

        // 如果仍然超长，可能需要进一步丢弃 olderMessages
        // 这里暂时只做内容截断
        return result
    }

    private compressMessage(msg: OpenAIMessage): OpenAIMessage {
        const newMsg = { ...msg }

        if (msg.role === 'tool' && typeof msg.content === 'string') {
            if (msg.content.length > this.config.maxToolResultChars) {
                newMsg.content = msg.content.slice(0, this.config.maxToolResultChars) + '\n...[Tool output truncated]'
            }
        } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
            // 如果包含 tool_calls，通常 content 为 null 或简短说明，但如果有长思维链，可以压缩
            // 只有当没有 tool_calls 时才激进压缩文本，避免破坏工具调用上下文
            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                if (msg.content.length > this.config.maxAssistantChars) {
                    const half = Math.floor(this.config.maxAssistantChars / 2)
                    newMsg.content = msg.content.slice(0, half) + '\n...[Content truncated]...\n' + msg.content.slice(-half)
                }
            }
        }

        return newMsg
    }

    private calculateTotalChars(messages: OpenAIMessage[]): number {
        let total = 0
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                total += msg.content.length
            } else if (Array.isArray(msg.content)) {
                // 简略估算
                total += 1000
            }
        }
        return total
    }
}
