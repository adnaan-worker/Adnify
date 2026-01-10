/**
 * LLM 摘要生成器
 * 
 * 调用 LLM 生成高质量的结构化摘要
 * 异步执行，不阻塞主流程
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { OpenAIMessage } from '../llm/MessageConverter'
import type { StructuredSummary, MessageGroup } from './types'
import { generateQuickSummary } from './SummaryGenerator'

/**
 * 使用 LLM 生成高质量摘要
 */
export async function generateLLMSummary(
  messages: OpenAIMessage[],
  groups: MessageGroup[],
  turnRange: [number, number]
): Promise<StructuredSummary> {
  // 先生成快速摘要作为基础和 fallback
  const quickSummary = generateQuickSummary(messages, groups, turnRange)
  
  // 获取 AgentStore 用于更新压缩阶段
  const { useAgentStore } = await import('../store/AgentStore')
  const setCompressionPhase = useAgentStore.getState().setCompressionPhase
  
  try {
    // 获取 LLM 配置
    const { useStore } = await import('@store')
    const state = useStore.getState()
    const llmConfig = state.llmConfig
    
    // llmConfig.apiKey 就是当前配置的 API key
    if (!llmConfig?.apiKey) {
      logger.agent.warn('[LLMSummarizer] No API key configured, using quick summary')
      return quickSummary
    }

    logger.agent.info('[LLMSummarizer] Generating LLM summary...')
    
    // 更新阶段为 summarizing（正在调用 LLM 生成摘要）
    setCompressionPhase('summarizing')

    // 构建摘要请求的消息
    const summaryMessages = buildSummaryMessages(messages, groups, turnRange, quickSummary)
    
    // 调用 LLM（使用当前配置的 provider 和 model）
    const result = await api.llm.compactContext({
      config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        maxTokens: 1500,
        temperature: 0.3,
        adapterConfig: llmConfig.adapterConfig,
      },
      messages: summaryMessages as any,
      tools: [],
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
    })

    if (result.error || !result.content) {
      logger.agent.warn('[LLMSummarizer] LLM call failed:', result.error)
      return quickSummary
    }

    // 解析 LLM 返回的结果
    const enhanced = parseLLMResponse(result.content, quickSummary)
    logger.agent.info('[LLMSummarizer] Generated LLM summary successfully')
    
    // 完成后重置阶段
    setCompressionPhase('done')
    setTimeout(() => setCompressionPhase('idle'), 500)
    
    return enhanced
  } catch (error) {
    logger.agent.error('[LLMSummarizer] Error:', error)
    // 出错时也重置阶段
    setCompressionPhase('idle')
    return quickSummary
  }
}

/**
 * 构建发送给 LLM 的摘要请求消息
 */
function buildSummaryMessages(
  messages: OpenAIMessage[],
  groups: MessageGroup[],
  turnRange: [number, number],
  quickSummary: StructuredSummary
): OpenAIMessage[] {
  const result: OpenAIMessage[] = []
  
  // 添加需要摘要的对话内容（简化版本）
  for (const group of groups) {
    if (group.turnIndex < turnRange[0] || group.turnIndex > turnRange[1]) continue
    
    const userMsg = messages[group.userIndex]
    if (userMsg) {
      const content = typeof userMsg.content === 'string' ? userMsg.content : ''
      result.push({
        role: 'user',
        content: truncate(content, 300),
      })
    }
    
    if (group.assistantIndex !== null) {
      const assistantMsg = messages[group.assistantIndex]
      if (assistantMsg) {
        // 提取工具调用摘要
        const toolSummary = assistantMsg.tool_calls
          ?.map(tc => {
            const args = safeParseArgs(tc.function.arguments)
            const path = args.path ? ` (${args.path})` : ''
            return `[${tc.function.name}${path}]`
          })
          .join(' ') || ''
        
        const content = typeof assistantMsg.content === 'string' ? assistantMsg.content : ''
        result.push({
          role: 'assistant',
          content: truncate(content, 200) + (toolSummary ? `\n${toolSummary}` : ''),
        })
      }
    }
  }
  
  // 添加快速摘要作为参考
  const quickSummaryText = formatQuickSummaryForLLM(quickSummary)
  
  // 添加摘要请求
  result.push({
    role: 'user',
    content: `Based on the conversation above, generate a structured summary.

## Quick Analysis (for reference):
${quickSummaryText}

## Output Format (JSON):
{
  "objective": "Main task/goal in one sentence",
  "completedSteps": ["Step 1", "Step 2"],
  "pendingSteps": ["Next step 1", "Next step 2"],
  "keyDecisions": ["Important decision 1"],
  "userInstructions": ["Important user instruction"]
}

Focus on: what was done, what needs to be done, important decisions, user preferences.
Output ONLY valid JSON.`,
  })
  
  return result
}

/**
 * 解析 LLM 返回的摘要
 */
function parseLLMResponse(
  content: string,
  fallback: StructuredSummary
): StructuredSummary {
  try {
    // 尝试提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return fallback
    }
    
    const parsed = JSON.parse(jsonMatch[0])
    
    // 合并 LLM 结果和快速摘要
    return {
      ...fallback,
      objective: parsed.objective || fallback.objective,
      completedSteps: mergeArrays(fallback.completedSteps, parsed.completedSteps),
      pendingSteps: parsed.pendingSteps || fallback.pendingSteps,
      userInstructions: mergeArrays(fallback.userInstructions, parsed.userInstructions),
    }
  } catch {
    return fallback
  }
}

/**
 * 格式化快速摘要供 LLM 参考
 */
function formatQuickSummaryForLLM(summary: StructuredSummary): string {
  const parts: string[] = []
  
  parts.push(`Objective: ${summary.objective}`)
  
  if (summary.completedSteps.length > 0) {
    parts.push(`Completed: ${summary.completedSteps.slice(-5).join(', ')}`)
  }
  
  if (summary.fileChanges.length > 0) {
    const files = summary.fileChanges.slice(-5).map(f => `${f.action}:${f.path}`).join(', ')
    parts.push(`Files: ${files}`)
  }
  
  if (summary.errorsAndFixes.length > 0) {
    parts.push(`Errors: ${summary.errorsAndFixes.length} encountered`)
  }
  
  return parts.join('\n')
}

/**
 * 合并数组，去重
 */
function mergeArrays(arr1: string[], arr2?: string[]): string[] {
  if (!arr2) return arr1
  const set = new Set([...arr1, ...arr2])
  return Array.from(set)
}

/**
 * 截断文本
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * 安全解析 JSON 参数
 */
function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summarizer. Your task is to create concise, structured summaries of coding conversations.

Rules:
1. Focus on actions taken, not explanations
2. List concrete file changes and decisions
3. Identify pending work clearly
4. Note any user preferences or corrections
5. Output valid JSON only`
