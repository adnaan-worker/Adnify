/**
 * 消息构建服务
 * 
 * 职责：构建发送给 LLM 的消息列表
 * 发送前预估 token 并动态调整压缩等级
 */

import { logger } from '@utils/Logger'
import { useAgentStore } from '../store/AgentStore'
import { buildOpenAIMessages, validateOpenAIMessages, OpenAIMessage } from './MessageConverter'
import { prepareMessages, estimateMessagesTokens, CompressionLevel, LEVEL_NAMES } from '../context/CompressionManager'
import { MessageContent, ChatMessage } from '../types'

// 从 ContextBuilder 导入已有的函数
export { buildContextContent, buildUserContent, calculateContextStats } from './ContextBuilder'

/**
 * 构建发送给 LLM 的消息列表
 * 
 * 核心逻辑：发送前预估 token，动态提升压缩等级直到满足上下文限制
 */
export async function buildLLMMessages(
  currentMessage: MessageContent,
  contextContent: string,
  systemPrompt: string
): Promise<OpenAIMessage[]> {
  const store = useAgentStore.getState()
  const historyMessages = store.getMessages()
  const currentThread = store.getCurrentThread()
  
  // 获取上下文限制
  const agentConfig = (await import('../utils/AgentConfig')).getAgentConfig()
  const contextLimit = agentConfig.maxContextTokens || 128_000
  const targetRatio = 0.85 // 目标使用率，留 15% 给输出

  // 检查是否有 handoff 上下文需要注入
  let enhancedSystemPrompt = systemPrompt
  if (currentThread && (currentThread as any).handoffContext) {
    const handoffContext = (currentThread as any).handoffContext
    enhancedSystemPrompt = `${systemPrompt}\n\n${handoffContext}`
    logger.agent.info('[MessageBuilder] Injected handoff context')
  }

  // 预估当前用户消息的 token（包括 context）
  const { buildUserContent } = await import('./ContextBuilder')
  const userContent = buildUserContent(currentMessage, contextContent)
  const userMessageTokens = Math.ceil(
    (typeof userContent === 'string' ? userContent : JSON.stringify(userContent)).length / 4
  )

  // 动态压缩：从 L0 开始，逐步提升直到满足限制
  // 不再从上次等级开始，而是每次重新评估
  let currentLevel: CompressionLevel = 0
  let preparedMessages: ChatMessage[] = []
  let appliedLevel: CompressionLevel = 0
  let truncatedToolCalls = 0
  let clearedToolResults = 0
  let removedMessages = 0
  let estimatedTokens = 0

  // 最多尝试到 L4
  while (currentLevel <= 4) {
    const result = prepareMessages(historyMessages as ChatMessage[], currentLevel)
    preparedMessages = result.messages
    appliedLevel = currentLevel
    truncatedToolCalls = result.truncatedToolCalls
    clearedToolResults = result.clearedToolResults
    removedMessages = result.removedMessages

    // 估算 token（包括 system prompt + 当前用户消息）
    estimatedTokens = estimateMessagesTokens(preparedMessages)
      + Math.ceil(enhancedSystemPrompt.length / 4)
      + userMessageTokens
    const ratio = estimatedTokens / contextLimit

    if (ratio <= targetRatio || currentLevel >= 4) {
      break
    }

    // 提升等级继续压缩
    currentLevel = (currentLevel + 1) as CompressionLevel
    logger.agent.info(`[MessageBuilder] Upgrading compression: L${currentLevel - 1} → L${currentLevel} (ratio: ${(ratio * 100).toFixed(1)}%)`)
  }

  // 计算最终使用率
  const finalRatio = estimatedTokens / contextLimit

  // L4 且仍然超限：提前警告
  if (appliedLevel >= 4 && finalRatio > 0.95) {
    logger.agent.warn(`[MessageBuilder] Context overflow at L4: ${(finalRatio * 100).toFixed(1)}%`)
    store.setHandoffRequired(true)
  }

  // 设置压缩阶段（用于 UI 显示）
  if (truncatedToolCalls > 0 || clearedToolResults > 0 || removedMessages > 0) {
    store.setCompressionPhase('compressing')
  }

  // 排除最后一条用户消息（会在后面重新添加带上下文的版本）
  const lastMsg = preparedMessages[preparedMessages.length - 1]
  const messagesToConvert = lastMsg?.role === 'user' 
    ? preparedMessages.slice(0, -1) 
    : preparedMessages

  // 转换为 OpenAI 格式
  const openaiMessages = buildOpenAIMessages(messagesToConvert as any, enhancedSystemPrompt)

  // 添加当前用户消息（复用已构建的 userContent）
  openaiMessages.push({ role: 'user', content: userContent as any })

  // 验证消息格式
  const validation = validateOpenAIMessages(openaiMessages)
  if (!validation.valid) {
    logger.agent.warn('[MessageBuilder] Validation warning:', validation.error)
  }

  // 更新压缩统计
  store.setCompressionStats({
    level: appliedLevel,
    levelName: LEVEL_NAMES[appliedLevel],
    ratio: finalRatio,
    inputTokens: estimatedTokens,
    outputTokens: 0,
    contextLimit,
    savedTokens: 0,
    savedPercent: 0,
    messageCount: openaiMessages.length,
    needsHandoff: appliedLevel >= 4,
    lastUpdatedAt: Date.now(),
  })

  logger.agent.info(
    `[MessageBuilder] Built ${openaiMessages.length} messages, ` +
    `L${appliedLevel} (${LEVEL_NAMES[appliedLevel]}), ` +
    `~${estimatedTokens}/${contextLimit} tokens (${(finalRatio * 100).toFixed(1)}%)`
  )

  return openaiMessages
}
