/**
 * 消息构建服务
 * 负责构建发送给 LLM 的消息，包括上下文处理和历史消息管理
 * 从 AgentService 拆分出来，专注于消息构建职责
 */

import { logger } from '@utils/Logger'
import { useAgentStore } from '../store/AgentStore'
import { buildOpenAIMessages, validateOpenAIMessages, OpenAIMessage } from './MessageConverter'
import { MessageContent } from '../types'
import { truncateToolResult } from '@/renderer/utils/partialJson'
import { getAgentConfig } from '../utils/AgentConfig'
import {
  shouldCompactContext,
  prepareMessagesForCompact,
  createCompactedSystemMessage,
  calculateSavings,
} from '../utils/ContextCompressor'
import { contextCompactionService } from '../services/ContextCompactionService'
import { ChatMessage, isAssistantMessage, isUserMessage, ToolCallPart, TextContent } from '../types'

// 从 ContextBuilder 导入已有的函数
export { buildContextContent, buildUserContent, calculateContextStats } from './ContextBuilder'

/**
 * 生成简单摘要（不调用 LLM）
 * 提取关键信息：用户请求、文件操作、重要决策
 */
function generateSimpleSummary(messages: ChatMessage[], importantMessages?: ChatMessage[]): string {
  const userRequests: string[] = []
  const fileOperations: string[] = []
  const toolsUsed = new Set<string>()
  const importantContent: string[] = []

  // 处理重要消息（用户消息和关键工具调用）
  if (importantMessages && importantMessages.length > 0) {
    for (const msg of importantMessages) {
      if (isUserMessage(msg)) {
        const content = typeof msg.content === 'string' 
          ? msg.content 
          : (msg.content as TextContent[])?.find(p => p.type === 'text')?.text || ''
        if (content.length > 0) {
          const truncated = content.length > 150 ? content.slice(0, 150) + '...' : content
          importantContent.push(`[User] ${truncated}`)
        }
      }
    }
  }

  for (const msg of messages) {
    // 提取用户请求
    if (isUserMessage(msg)) {
      const content = typeof msg.content === 'string' 
        ? msg.content 
        : (msg.content as TextContent[])?.find(p => p.type === 'text')?.text || ''
      if (content.length > 0) {
        // 截取前 200 字符
        const truncated = content.length > 200 ? content.slice(0, 200) + '...' : content
        userRequests.push(truncated)
      }
    }

    // 提取工具调用
    if (isAssistantMessage(msg) && msg.parts) {
      for (const part of msg.parts) {
        if (part.type === 'tool_call') {
          const toolCall = (part as ToolCallPart).toolCall
          toolsUsed.add(toolCall.name)
          
          // 记录文件操作
          if (['edit_file', 'write_file', 'create_file_or_folder', 'delete_file_or_folder', 'read_file'].includes(toolCall.name)) {
            const args = toolCall.arguments as any
            const path = args?.path || args?.file_path || args?.target_file || ''
            if (path) {
              fileOperations.push(`${toolCall.name}: ${path}`)
            }
          }
        }
      }
    }
  }

  // 构建摘要
  const parts: string[] = []
  
  // 重要内容优先
  if (importantContent.length > 0) {
    parts.push(`## Key Context\n${importantContent.slice(0, 5).join('\n')}`)
  }
  
  if (userRequests.length > 0) {
    parts.push(`## User Requests (${userRequests.length} total)\n${userRequests.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join('\n')}`)
  }
  
  if (fileOperations.length > 0) {
    const uniqueOps = [...new Set(fileOperations)].slice(0, 20)
    parts.push(`## File Operations\n${uniqueOps.join('\n')}`)
  }
  
  if (toolsUsed.size > 0) {
    parts.push(`## Tools Used\n${[...toolsUsed].join(', ')}`)
  }

  return parts.join('\n\n') || 'Previous conversation context (details compacted)'
}

/**
 * 智能截断消息，保持 tool_call 和 tool_result 的配对完整
 */
function smartTruncateMessages<T extends { role: string; id?: string; toolCallId?: string }>(
  messages: T[],
  maxMessages: number
): T[] {
  if (messages.length <= maxMessages) return messages

  // 从后往前找到一个安全的截断点
  let cutIndex = messages.length - maxMessages
  
  // 收集截断点之后所有消息中引用的 toolCallId
  const referencedToolCallIds = new Set<string>()
  for (let i = cutIndex; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'tool' && (msg as any).toolCallId) {
      referencedToolCallIds.add((msg as any).toolCallId)
    }
  }
  
  // 向前扩展，包含所有被引用的 tool_call 的 assistant 消息
  for (let i = cutIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      const parts = (msg as any).parts || []
      const hasReferencedToolCall = parts.some((p: any) => 
        p.type === 'tool_call' && referencedToolCallIds.has(p.toolCall?.id)
      )
      if (hasReferencedToolCall) {
        cutIndex = i
      }
    }
  }
  
  return messages.slice(cutIndex)
}

/**
 * 构建发送给 LLM 的消息列表
 */
export async function buildLLMMessages(
  currentMessage: MessageContent,
  contextContent: string,
  systemPrompt: string
): Promise<OpenAIMessage[]> {
  const store = useAgentStore.getState()
  const historyMessages = store.getMessages()

  // 从 ContextBuilder 导入 buildUserContent
  const { buildUserContent } = await import('./ContextBuilder')

  // 过滤掉 checkpoint 消息
  type NonCheckpointMessage = Exclude<typeof historyMessages[number], { role: 'checkpoint' }>
  let filteredMessages: NonCheckpointMessage[] = historyMessages.filter(
    (m): m is NonCheckpointMessage => m.role !== 'checkpoint'
  )

  let compactedSummary: string | null = null
  const llmConfig = getAgentConfig()

  // 检查是否需要压缩上下文
  if (shouldCompactContext(filteredMessages)) {
    logger.agent.info('[MessageBuilder] Context exceeds threshold, compacting...')

    const { recentMessages, messagesToCompact, importantMessages } = prepareMessagesForCompact(filteredMessages as any)
    
    // 检查是否有已有的摘要
    const existingSummary = store.contextSummary || contextCompactionService.getSummary()
    
    if (existingSummary && messagesToCompact.length > 0) {
      // 有摘要，使用它
      compactedSummary = existingSummary
      
      // 计算并记录压缩节省的 Token 数
      const savings = calculateSavings(messagesToCompact as any, existingSummary)
      logger.agent.info(`[MessageBuilder] Using existing summary: saved ${savings.savedTokens} tokens (${savings.savedPercent}%)`)
      
      filteredMessages = recentMessages as NonCheckpointMessage[]
      
      // 如果有新消息需要压缩，异步更新摘要（LLM 会整合旧摘要）
      if (messagesToCompact.length >= 10) {
        logger.agent.info(`[MessageBuilder] ${messagesToCompact.length} messages to compact, requesting LLM update...`)
        contextCompactionService.requestCompaction(messagesToCompact as any).then(llmSummary => {
          if (llmSummary && llmSummary.length > 100) {
            store.setContextSummary(llmSummary)
            logger.agent.info('[MessageBuilder] Summary updated with integrated content')
          }
        }).catch(err => {
          logger.agent.warn('[MessageBuilder] Failed to update summary:', err)
        })
      }
    } else if (existingSummary) {
      // 有摘要，没有新消息需要压缩
      compactedSummary = existingSummary
      filteredMessages = recentMessages as NonCheckpointMessage[]
    } else if (messagesToCompact.length > 0) {
      // 没有摘要，需要首次压缩
      // 先生成简单摘要（立即可用），包含重要消息
      const simpleSummary = generateSimpleSummary(messagesToCompact as any, importantMessages as any)
      compactedSummary = simpleSummary
      store.setContextSummary(simpleSummary)
      
      logger.agent.info(`[MessageBuilder] Generated simple summary, compacted ${messagesToCompact.length} messages`)
      filteredMessages = recentMessages as NonCheckpointMessage[]
      
      // 异步请求 LLM 生成更好的摘要（下次请求时使用）
      contextCompactionService.requestCompaction(messagesToCompact as any).then(llmSummary => {
        if (llmSummary && llmSummary.length > 100) {
          store.setContextSummary(llmSummary)
          logger.agent.info('[MessageBuilder] LLM summary generated and saved for next request')
        }
      }).catch(err => {
        logger.agent.warn('[MessageBuilder] Failed to generate LLM summary:', err)
      })
    } else {
      // 当前请求使用智能截断（保持 tool_call/tool_result 配对）
      filteredMessages = smartTruncateMessages(filteredMessages, llmConfig.maxHistoryMessages)
    }
  } else {
    filteredMessages = smartTruncateMessages(filteredMessages, llmConfig.maxHistoryMessages)
  }

  // 构建系统提示
  const effectiveSystemPrompt = compactedSummary
    ? `${systemPrompt}\n\n${createCompactedSystemMessage(compactedSummary)}`
    : systemPrompt

  logger.agent.info(`[MessageBuilder] System prompt size: ${effectiveSystemPrompt.length} chars`)

  // 转换为 OpenAI 格式
  const openaiMessages = buildOpenAIMessages(filteredMessages as any, effectiveSystemPrompt)

  // 截断过长的工具结果
  for (const msg of openaiMessages) {
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      if (msg.content.length > llmConfig.maxToolResultChars) {
        msg.content = truncateToolResult(msg.content, 'default', llmConfig.maxToolResultChars)
      }
    }
  }

  // 添加当前用户消息
  const userContent = buildUserContent(currentMessage, contextContent)
  openaiMessages.push({ role: 'user', content: userContent as any })

  // 验证消息格式
  const validation = validateOpenAIMessages(openaiMessages)
  if (!validation.valid) {
    logger.agent.warn('[MessageBuilder] Message validation warning:', validation.error)
  }

  // 调试：检查消息内容是否有效
  for (let i = 0; i < openaiMessages.length; i++) {
    const msg = openaiMessages[i]
    if (msg.role === 'user' || msg.role === 'assistant') {
      if (msg.content === undefined) {
        logger.agent.error(`[MessageBuilder] Message ${i} has undefined content:`, msg)
      } else if (msg.content === null && msg.role === 'user') {
        logger.agent.error(`[MessageBuilder] User message ${i} has null content:`, msg)
      } else if (Array.isArray(msg.content)) {
        for (let j = 0; j < msg.content.length; j++) {
          const part = msg.content[j]
          if (part.type === 'text' && (part.text === undefined || part.text === null)) {
            logger.agent.error(`[MessageBuilder] Message ${i} part ${j} has invalid text:`, part)
          }
        }
      }
    }
  }

  return openaiMessages
}

/**
 * 压缩上下文（移除旧的工具结果和截断大内容）
 */
export async function compressContext(
  messages: OpenAIMessage[],
  maxChars: number
): Promise<void> {
  let totalChars = 0

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text?.length || 0
        } else {
          totalChars += 1000 // 估算图片等内容
        }
      }
    }
  }

  logger.agent.info(`[MessageBuilder] Context check: ${totalChars} chars, limit ${maxChars}`)

  if (totalChars <= maxChars) return

  logger.agent.info(`[MessageBuilder] Context size ${totalChars} exceeds limit ${maxChars}, compressing...`)

  // 找到最近 3 轮用户消息的位置
  let userCount = 0
  let cutOffIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userCount++
      if (userCount === 3) {
        cutOffIndex = i
        break
      }
    }
  }

  // 压缩早期消息
  for (let i = 0; i < cutOffIndex; i++) {
    const msg = messages[i]

    // 移除旧的工具输出
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 100) {
      msg.content = '[Tool output removed to save context]'
    }

    // 截断旧的助手消息
    if (msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.length > 500) {
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        msg.content = msg.content.slice(0, 200) + '\n...[Content truncated]...\n' + msg.content.slice(-200)
      }
    }
    
    // 截断旧的用户消息中的大内容（保留最近的完整）
    if (msg.role === 'user') {
      if (typeof msg.content === 'string' && msg.content.length > 2000) {
        msg.content = msg.content.slice(0, 500) + '\n...[Content truncated to save context]...\n' + msg.content.slice(-500)
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text && part.text.length > 2000) {
            part.text = part.text.slice(0, 500) + '\n...[Content truncated to save context]...\n' + part.text.slice(-500)
          }
        }
      }
    }
  }
  
  // 重新计算压缩后的大小
  let newTotalChars = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      newTotalChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          newTotalChars += part.text?.length || 0
        }
      }
    }
  }
  
  logger.agent.info(`[MessageBuilder] Compressed: ${totalChars} -> ${newTotalChars} chars (saved ${Math.round((1 - newTotalChars/totalChars) * 100)}%)`)
}
