/**
 * 摘要生成服务
 * 
 * 参考 OpenCode 的实现：
 * - 使用 LLM 生成对话摘要
 * - 用于 L3 深度压缩和 L4 会话交接
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { getAdapterConfig } from '@/shared/config/providers'
import type { StructuredSummary, HandoffDocument, FileChangeRecord } from './types'
import type { ChatMessage, AssistantMessage, UserMessage } from '../types'
import { getMessageText } from '../types'

// ===== Prompts =====

const COMPACTION_PROMPT = `You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation. 
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.`

const SUMMARY_PROMPT = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions`

// ===== Types =====

export interface SummaryResult {
  summary: string
  objective: string
  completedSteps: string[]
  pendingSteps: string[]
  fileChanges: FileChangeRecord[]
}

// ===== Helper Functions =====

/**
 * 从消息中提取文件变更记录
 */
function extractFileChanges(messages: ChatMessage[]): FileChangeRecord[] {
  const changes: FileChangeRecord[] = []
  let turnIndex = 0

  for (const msg of messages) {
    if (msg.role === 'user') turnIndex++
    
    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      for (const tc of assistantMsg.toolCalls || []) {
        if (tc.status === 'success') {
          const args = tc.arguments as Record<string, unknown>
          const path = args.path as string
          
          if (tc.name === 'write_file' || tc.name === 'create_file') {
            changes.push({
              path,
              action: 'create',
              summary: `Created ${path}`,
              turnIndex,
            })
          } else if (tc.name === 'edit_file' || tc.name === 'replace_file_content') {
            changes.push({
              path,
              action: 'modify',
              summary: `Modified ${path}`,
              turnIndex,
            })
          } else if (tc.name === 'delete_file') {
            changes.push({
              path,
              action: 'delete',
              summary: `Deleted ${path}`,
              turnIndex,
            })
          }
        }
      }
    }
  }

  return changes
}

/**
 * 从消息中提取用户请求
 */
function extractUserRequests(messages: ChatMessage[]): string[] {
  const requests: string[] = []
  
  for (const msg of messages) {
    if (msg.role === 'user') {
      const userMsg = msg as UserMessage
      const content = getMessageText(userMsg.content)
      
      if (content.trim()) {
        requests.push(content.slice(0, 200))
      }
    }
  }

  return requests
}

/**
 * 构建用于摘要的消息文本
 */
function buildConversationText(messages: ChatMessage[], maxLength = 8000): string {
  const parts: string[] = []
  let totalLength = 0

  // 从后往前取消息，确保最近的对话被包含
  for (let i = messages.length - 1; i >= 0 && totalLength < maxLength; i--) {
    const msg = messages[i]
    let text = ''

    if (msg.role === 'user') {
      const content = typeof (msg as UserMessage).content === 'string'
        ? (msg as UserMessage).content as string
        : ''
      text = `User: ${content.slice(0, 500)}`
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      text = `Assistant: ${(assistantMsg.content || '').slice(0, 500)}`
      
      // 添加工具调用摘要
      if (assistantMsg.toolCalls?.length) {
        const toolSummary = assistantMsg.toolCalls
          .filter(tc => tc.status === 'success')
          .map(tc => `- ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`)
          .join('\n')
        if (toolSummary) {
          text += `\nTools used:\n${toolSummary}`
        }
      }
    }

    if (text) {
      parts.unshift(text)
      totalLength += text.length
    }
  }

  return parts.join('\n\n')
}

// ===== Main Service =====

/**
 * 使用 LLM 生成对话摘要
 */
export async function generateSummary(
  messages: ChatMessage[],
  options: {
    type: 'quick' | 'detailed' | 'handoff'
    maxTokens?: number
  } = { type: 'quick' }
): Promise<SummaryResult> {
  const { llmConfig } = useStore.getState()
  
  // 如果没有配置 API Key，返回基于规则的摘要
  if (!llmConfig.apiKey) {
    return generateRuleBasedSummary(messages)
  }

  const conversationText = buildConversationText(messages)
  const fileChanges = extractFileChanges(messages)
  const userRequests = extractUserRequests(messages)

  const prompt = options.type === 'handoff' ? COMPACTION_PROMPT : SUMMARY_PROMPT
  const userPrompt = options.type === 'handoff'
    ? `Please summarize the following conversation for handoff to a new session:\n\n${conversationText}`
    : `Please summarize the following conversation:\n\n${conversationText}`

  try {
    // 使用同步 LLM 调用
    const result = await api.llm.compactContext({
      config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        baseUrl: llmConfig.baseUrl,
        timeout: llmConfig.timeout,
        maxTokens: options.maxTokens || 500,
        temperature: 0.3,
        adapterConfig: llmConfig.adapterConfig || getAdapterConfig(llmConfig.provider),
      },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userPrompt },
      ],
    })

    if (result.error) {
      logger.agent.warn('[SummaryService] LLM error, falling back to rule-based:', result.error)
      return generateRuleBasedSummary(messages)
    }

    const summary = result.content || ''
    
    return {
      summary,
      objective: userRequests[0] || 'Unknown objective',
      completedSteps: extractCompletedSteps(messages),
      pendingSteps: [],
      fileChanges,
    }
  } catch (error) {
    logger.agent.error('[SummaryService] Error generating summary:', error)
    return generateRuleBasedSummary(messages)
  }
}

/**
 * 基于规则生成摘要（不使用 LLM）
 */
function generateRuleBasedSummary(messages: ChatMessage[]): SummaryResult {
  const fileChanges = extractFileChanges(messages)
  const userRequests = extractUserRequests(messages)
  const completedSteps = extractCompletedSteps(messages)

  // 构建简单摘要
  const parts: string[] = []
  
  if (userRequests.length > 0) {
    parts.push(`Objective: ${userRequests[0].slice(0, 100)}`)
  }
  
  if (fileChanges.length > 0) {
    parts.push(`Files modified: ${fileChanges.length}`)
    parts.push(fileChanges.slice(-5).map(f => `- ${f.action}: ${f.path}`).join('\n'))
  }
  
  if (completedSteps.length > 0) {
    parts.push(`Completed: ${completedSteps.length} steps`)
  }

  return {
    summary: parts.join('\n'),
    objective: userRequests[0] || 'Unknown objective',
    completedSteps,
    pendingSteps: [],
    fileChanges,
  }
}

/**
 * 从消息中提取已完成的步骤
 */
function extractCompletedSteps(messages: ChatMessage[]): string[] {
  const steps: string[] = []

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const assistantMsg = msg as AssistantMessage
      for (const tc of assistantMsg.toolCalls || []) {
        if (tc.status === 'success') {
          const args = tc.arguments as Record<string, unknown>
          
          switch (tc.name) {
            case 'write_file':
            case 'create_file':
              steps.push(`Created file: ${args.path}`)
              break
            case 'edit_file':
            case 'replace_file_content':
              steps.push(`Modified file: ${args.path}`)
              break
            case 'execute_command':
            case 'run_terminal_command':
              steps.push(`Executed: ${String(args.command || args.cmd).slice(0, 50)}`)
              break
            case 'read_file':
              steps.push(`Read file: ${args.path}`)
              break
          }
        }
      }
    }
  }

  return steps.slice(-20) // 保留最近 20 个步骤
}

/**
 * 生成 Handoff 文档
 */
export async function generateHandoffDocument(
  sessionId: string,
  messages: ChatMessage[],
  workspacePath: string
): Promise<HandoffDocument> {
  const summaryResult = await generateSummary(messages, { type: 'handoff', maxTokens: 1000 })
  const userRequests = extractUserRequests(messages)
  const lastUserRequest = userRequests[userRequests.length - 1] || ''

  const structuredSummary: StructuredSummary = {
    objective: summaryResult.objective,
    completedSteps: summaryResult.completedSteps,
    pendingSteps: summaryResult.pendingSteps,
    decisions: [],
    fileChanges: summaryResult.fileChanges,
    errorsAndFixes: [],
    userInstructions: userRequests.slice(-5),
    generatedAt: Date.now(),
    turnRange: [0, messages.filter(m => m.role === 'user').length],
  }

  return {
    fromSessionId: sessionId,
    createdAt: Date.now(),
    summary: structuredSummary,
    workingDirectory: workspacePath,
    keyFileSnapshots: [],
    lastUserRequest,
    suggestedNextSteps: summaryResult.pendingSteps,
  }
}

logger.agent.info('[SummaryService] Module loaded')
