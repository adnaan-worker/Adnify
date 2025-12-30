/**
 * 上下文压缩服务
 * 当对话历史过长时，使用 LLM 生成摘要以压缩上下文
 * 参考 Claude Code 的 PreCompact 机制
 */

import { ChatMessage, isAssistantMessage, TextContent, ToolCallPart } from '../types'
import { getAgentConfig } from './AgentConfig'

// 压缩配置（默认值，会被 AgentConfig 覆盖）
export const COMPACT_CONFIG = {
    // 触发压缩的消息数阈值
    messageThreshold: 30,
    // 触发压缩的字符数阈值（从 AgentConfig 获取）
    get charThreshold() {
        return getAgentConfig().contextCompressThreshold
    },
    // 触发压缩的 Token 数阈值（估算）
    tokenThreshold: 10000,
    // 压缩后保留的最近消息数（从 AgentConfig 获取，keepRecentTurns * 2 因为一轮 = user + assistant）
    get keepRecentMessages() {
        return getAgentConfig().keepRecentTurns * 2
    },
    // 摘要最大字符数
    maxSummaryChars: 2000,
    // 保留的关键工具调用类型
    importantToolTypes: ['edit_file', 'write_file', 'create_file_or_folder', 'delete_file_or_folder', 'run_command'],
} as const

// 可压缩的消息类型（排除 checkpoint）
type CompactableMessage = Exclude<ChatMessage, { role: 'checkpoint' }>

/**
 * 检查消息是否可压缩（排除 checkpoint）
 */
function isCompactableMessage(msg: ChatMessage): msg is CompactableMessage {
    return msg.role !== 'checkpoint'
}

/**
 * 从消息中安全提取文本内容
 */
function getMessageTextContent(msg: CompactableMessage): string {
    if (!('content' in msg)) return ''
    const content = msg.content
    if (typeof content === 'string') {
        return content
    }
    if (Array.isArray(content)) {
        return content
            .filter((p): p is TextContent => p.type === 'text')
            .map(p => p.text)
            .join('\n')
    }
    return ''
}

/**
 * 估算 Token 数量
 * 中文约 1.5 字符/token，英文约 4 字符/token
 */
function estimateTokens(text: string): number {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * 检查是否需要压缩上下文
 */
export function shouldCompactContext(messages: ChatMessage[]): boolean {
    // 过滤掉 checkpoint 消息
    const compactable = messages.filter(isCompactableMessage)

    // 检查消息数量
    if (compactable.length > COMPACT_CONFIG.messageThreshold) {
        return true
    }

    // 检查总字符数和估算 Token 数
    let totalChars = 0
    for (const msg of compactable) {
        totalChars += getMessageTextContent(msg).length
    }

    if (totalChars > COMPACT_CONFIG.charThreshold) {
        return true
    }

    const estimatedTokens = estimateTokens(compactable.map(getMessageTextContent).join(''))
    return estimatedTokens > COMPACT_CONFIG.tokenThreshold
}

/**
 * 提取消息中的关键信息
 */
interface MessageSummary {
    role: string
    content: string
    toolCalls?: string[]
    isImportant: boolean
}

function extractMessageSummary(msg: CompactableMessage): MessageSummary {
    const content = getMessageTextContent(msg)
    let toolCalls: string[] = []
    let isImportant = false

    // 检查助手消息中的工具调用
    if (isAssistantMessage(msg) && msg.parts) {
        toolCalls = msg.parts
            .filter((p): p is ToolCallPart => p.type === 'tool_call')
            .map(p => p.toolCall.name || 'tool')

        // 检查是否包含重要工具调用
        isImportant = toolCalls.some(tc => 
            (COMPACT_CONFIG.importantToolTypes as readonly string[]).includes(tc)
        )
    }

    // 用户消息通常都是重要的
    if (msg.role === 'user') {
        isImportant = true
    }

    return {
        role: msg.role,
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        isImportant,
    }
}

/**
 * 构建用于生成摘要的提示词
 * @param messages 需要压缩的消息
 * @param existingSummary 已有的摘要（如果有，让 LLM 整合而非简单拼接）
 */
export function buildCompactPrompt(messages: ChatMessage[], existingSummary?: string): string {
    const compactable = messages.filter(isCompactableMessage)
    const summaries = compactable.map(extractMessageSummary)

    // 构建对话历史摘要
    const conversationHistory = summaries.map((summary) => {
        const role = summary.role === 'user' ? 'User' : summary.role === 'assistant' ? 'Assistant' : 'Tool'
        const content = summary.content

        // 对于工具结果，只显示简短摘要
        if (summary.role === 'tool') {
            const truncated = content.length > 200 ? content.slice(0, 200) + '...' : content
            return `[${role}]: ${truncated}`
        }

        // 对于助手消息，检查工具调用
        if (summary.toolCalls && summary.toolCalls.length > 0) {
            const textContent = content.slice(0, 300)
            return `[${role}] Used tools: ${summary.toolCalls.join(', ')}. ${textContent}`
        }

        // 普通消息截断
        const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content
        return `[${role}]: ${truncated}`
    }).join('\n\n')

    // 如果有已有摘要，让 LLM 整合
    const existingContext = existingSummary 
        ? `\n\nPrevious Summary (integrate key points from this):\n${existingSummary}\n`
        : ''

    return `Please summarize the following conversation history into a concise summary (max ${COMPACT_CONFIG.maxSummaryChars} chars).${existingContext}
Focus on:
1. The user's main requests and goals
2. Key decisions made
3. Files that were modified (list file paths)
4. Important context that should be preserved
5. Any errors or issues encountered

New Conversation History:
${conversationHistory}

Summary:`
}

/**
 * 将消息历史压缩为摘要 + 最近消息
 */
export interface CompactedContext {
    summary: string
    recentMessages: ChatMessage[]
    compactedCount: number
}

/**
 * 准备待压缩的消息（不包括最近的消息）
 * 改进：保留重要的工具调用结果
 */
export function prepareMessagesForCompact(messages: ChatMessage[]): {
    messagesToCompact: ChatMessage[]
    recentMessages: ChatMessage[]
    importantMessages: ChatMessage[]
} {
    const keepCount = COMPACT_CONFIG.keepRecentMessages

    if (messages.length <= keepCount) {
        return {
            messagesToCompact: [],
            recentMessages: messages,
            importantMessages: [],
        }
    }

    const recentMessages = messages.slice(-keepCount)
    const olderMessages = messages.slice(0, -keepCount)

    // 从旧消息中提取重要消息
    const importantMessages: ChatMessage[] = []
    const messagesToCompact: ChatMessage[] = []

    for (const msg of olderMessages) {
        if (!isCompactableMessage(msg)) continue

        const summary = extractMessageSummary(msg)
        if (summary.isImportant) {
            importantMessages.push(msg)
        } else {
            messagesToCompact.push(msg)
        }
    }

    return {
        messagesToCompact,
        recentMessages,
        importantMessages,
    }
}

/**
 * 创建压缩后的系统消息
 */
export function createCompactedSystemMessage(summary: string, importantContext?: string): string {
    let message = `## Conversation Summary

The following is a summary of the earlier conversation:

${summary}`

    if (importantContext) {
        message += `

## Important Context

${importantContext}`
    }

    message += `

---

Continue the conversation based on the above context.`

    return message
}

/**
 * 智能压缩工具结果
 * 保留关键信息，移除冗余内容
 */
export function compressToolResult(content: string, toolName: string): string {
    const maxLength = 500

    // 对于读取类工具，保留文件路径和行数信息
    if (['read_file', 'list_directory', 'search_files'].includes(toolName)) {
        if (content.length <= maxLength) return content

        // 保留前后部分
        const head = content.slice(0, maxLength / 2)
        const tail = content.slice(-maxLength / 4)
        return `${head}\n...[${content.length - maxLength} chars truncated]...\n${tail}`
    }

    // 对于其他工具，简单截断
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength) + '...[truncated]'
}

/**
 * 计算压缩后节省的 Token 数
 */
export function calculateSavings(
    originalMessages: ChatMessage[],
    compactedSummary: string
): { originalTokens: number; compactedTokens: number; savedTokens: number; savedPercent: number } {
    const originalText = originalMessages
        .filter(isCompactableMessage)
        .map(getMessageTextContent)
        .join('')

    const originalTokens = estimateTokens(originalText)
    const compactedTokens = estimateTokens(compactedSummary)
    const savedTokens = originalTokens - compactedTokens
    const savedPercent = Math.round((savedTokens / originalTokens) * 100)

    return { originalTokens, compactedTokens, savedTokens, savedPercent }
}
