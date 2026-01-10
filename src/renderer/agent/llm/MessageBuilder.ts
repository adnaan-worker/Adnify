/**
 * 消息构建服务
 * 
 * 职责：构建发送给 LLM 的消息列表
 * 使用 ContextManager 进行上下文优化
 */

import { logger } from '@utils/Logger'
import { useAgentStore } from '../store/AgentStore'
import { buildOpenAIMessages, validateOpenAIMessages, OpenAIMessage } from './MessageConverter'
import { MessageContent } from '../types'

// 从 ContextBuilder 导入已有的函数
export { buildContextContent, buildUserContent, calculateContextStats } from './ContextBuilder'

/**
 * 构建发送给 LLM 的消息列表
 * 注意：不在这里进行上下文优化，优化在 runAgentLoop 中进行
 */
export async function buildLLMMessages(
  currentMessage: MessageContent,
  contextContent: string,
  systemPrompt: string
): Promise<OpenAIMessage[]> {
  const store = useAgentStore.getState()
  const historyMessages = store.getMessages()
  const currentThread = store.getCurrentThread()

  const { buildUserContent } = await import('./ContextBuilder')

  // 检查是否有 handoff 上下文需要注入
  let enhancedSystemPrompt = systemPrompt
  if (currentThread && (currentThread as any).handoffContext) {
    const handoffContext = (currentThread as any).handoffContext
    enhancedSystemPrompt = `${systemPrompt}\n\n${handoffContext}`
    logger.agent.info('[MessageBuilder] Injected handoff context into system prompt')
  }

  // 过滤掉 checkpoint 消息
  type NonCheckpointMessage = Exclude<typeof historyMessages[number], { role: 'checkpoint' }>
  const filteredMessages: NonCheckpointMessage[] = historyMessages.filter(
    (m): m is NonCheckpointMessage => m.role !== 'checkpoint'
  )

  // 排除最后一条用户消息（会在后面重新添加带上下文的版本）
  const lastMsg = filteredMessages[filteredMessages.length - 1]
  const messagesToConvert = lastMsg?.role === 'user' 
    ? filteredMessages.slice(0, -1) 
    : filteredMessages

  // 转换为 OpenAI 格式（不进行优化，优化在 runAgentLoop 中进行）
  const openaiMessages = buildOpenAIMessages(messagesToConvert as any, enhancedSystemPrompt)

  // 添加当前用户消息
  const userContent = buildUserContent(currentMessage, contextContent)
  openaiMessages.push({ role: 'user', content: userContent as any })

  // 验证消息格式
  const validation = validateOpenAIMessages(openaiMessages)
  if (!validation.valid) {
    logger.agent.warn('[MessageBuilder] Validation warning:', validation.error)
  }

  logger.agent.info(`[MessageBuilder] Built ${openaiMessages.length} messages`)

  return openaiMessages
}


