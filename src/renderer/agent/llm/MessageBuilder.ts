/**
 * 消息构建服务
 * 
 * 职责：构建发送给 LLM 的消息列表
 * 发送前预估 token 并动态调整压缩等级
 */

import { logger } from '@utils/Logger'
import { useAgentStore } from '../store/AgentStore'
import { buildLLMApiMessages, validateLLMMessages } from './MessageConverter'
import type { LLMMessage } from '@/shared/types'
import { prepareMessages, estimateMessagesTokens, CompressionLevel, LEVEL_NAMES } from '../context/CompressionManager'
import { compressionPredictor } from '../context/compressionPredictor'
import { countTokens } from '@shared/utils/tokenCounter'
import { MessageContent, ChatMessage } from '../types'
import { getAgentConfig } from '../utils/AgentConfig'

// 从 ContextBuilder 导入已有的函数（同时静态引入供内部使用）
export { buildContextContent, buildUserContent } from './ContextBuilder'
import { buildUserContent } from './ContextBuilder'

/**
 * 构建发送给 LLM 的消息列表
 * 
 * 核心逻辑：发送前预估 token，动态提升压缩等级直到满足上下文限制
 */
export async function buildLLMMessages(
  currentMessage: MessageContent,
  contextContent: string,
  systemPrompt: string
): Promise<LLMMessage[]> {
  const store = useAgentStore.getState()
  const historyMessages = store.getMessages()
  const currentThread = store.getCurrentThread()

  // 获取上下文限制
  const agentConfig = getAgentConfig()
  const contextLimit = agentConfig.maxContextTokens || 128_000
  const targetRatio = 0.85 // 目标使用率，留 15% 给输出

  // 检查是否有 handoff 上下文需要注入
  let enhancedSystemPrompt = systemPrompt
  if (currentThread) {
    const threadWithHandoff = currentThread as import('../types').ChatThread & { handoffContext?: string }
    if (threadWithHandoff.handoffContext) {
      enhancedSystemPrompt = `${systemPrompt}\n\n${threadWithHandoff.handoffContext}`
      logger.agent.info('[MessageBuilder] Injected handoff context')
    }
  }

  // 预估当前用户消息的 token（包括 context）
  const userContent = buildUserContent(currentMessage, contextContent)

  // 正确估算用户消息 token（支持图片）
  let userMessageTokens = 0
  if (typeof userContent === 'string') {
    userMessageTokens = countTokens(userContent)
  } else {
    // 处理结构化内容（可能包含文本和图片）
    for (const part of userContent) {
      if (part.type === 'text' && part.text) {
        userMessageTokens += countTokens(part.text)
      } else if (part.type === 'image') {
        // 图片固定估算为 1600 tokens（不按 base64 长度计算）
        userMessageTokens += 1600
      }
    }
  }

  // 动态压缩：使用预测器确定起始等级
  const predictedLevel = compressionPredictor.predictLevel(
    historyMessages.length,
    contextContent.length
  )
  
  let currentLevel: CompressionLevel = predictedLevel
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
      + countTokens(enhancedSystemPrompt)
      + userMessageTokens
    const ratio = estimatedTokens / contextLimit

    if (ratio <= targetRatio || currentLevel >= 4) {
      break
    }

    // 提升等级继续压缩
    currentLevel = (currentLevel + 1) as CompressionLevel
    logger.agent.info(`[MessageBuilder] Upgrading compression: L${currentLevel - 1} → L${currentLevel} (ratio: ${(ratio * 100).toFixed(1)}%)`)
  }

  // 记录本次压缩结果到预测器
  compressionPredictor.record(
    historyMessages.length,
    contextContent.length,
    appliedLevel
  )

  // 计算最终使用率
  const finalRatio = estimatedTokens / contextLimit

  // L4 且仍然超限：提前警告
  if (appliedLevel >= 4 && finalRatio > 0.95) {
    logger.agent.warn(`[MessageBuilder] Context overflow at L4: ${(finalRatio * 100).toFixed(1)}%`)
    store.setHandoffRequired(true)
  }

  // 排除最后一条用户消息（会在后面重新添加带上下文的版本）
  const lastMsg = preparedMessages[preparedMessages.length - 1]
  const messagesToConvert = lastMsg?.role === 'user'
    ? preparedMessages.slice(0, -1)
    : preparedMessages

  // 转换为 LLM API 格式
  const llmMessages = buildLLMApiMessages(messagesToConvert, enhancedSystemPrompt)

  // 添加当前用户消息（复用已构建的 userContent）
  llmMessages.push({ role: 'user', content: userContent })

  // 验证消息格式
  const validation = validateLLMMessages(llmMessages)
  if (!validation.valid) {
    logger.agent.warn('[MessageBuilder] Validation warning:', validation.error)
  }

  // 不在这里更新统计，等 LLM 返回真实 usage 后再更新
  // 这样避免估算值和真实值导致的百分比跳动
  // 只记录应用的压缩等级，供后续使用
  logger.agent.debug(
    `[MessageBuilder] Applied compression L${appliedLevel}, ` +
    `estimated ratio: ${(finalRatio * 100).toFixed(1)}%`
  )

  logger.agent.info(
    `[MessageBuilder] Built ${llmMessages.length} messages, ` +
    `L${appliedLevel} (${LEVEL_NAMES[appliedLevel]}), ` +
    `~${estimatedTokens}/${contextLimit} tokens (${(finalRatio * 100).toFixed(1)}%), ` +
    `compressed: ${truncatedToolCalls + clearedToolResults + removedMessages > 0}`
  )

  return llmMessages
}
