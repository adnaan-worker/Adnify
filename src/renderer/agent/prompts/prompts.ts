/**
 * Agent 提示词系统入口
 */

import { WorkMode } from '@/renderer/modes/types'
import { rulesService } from '../services/rulesService'
import { memoryService } from '../services/memoryService'
import { useAgentStore } from '../store/AgentStore'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { PERFORMANCE_DEFAULTS } from '@shared/config/defaults'
import { buildSystemPrompt, buildChatPrompt, type PromptContext } from './PromptBuilder'
import { getPromptTemplateById, getDefaultPromptTemplate } from './promptTemplates'

// 限制常量导出（从配置获取）
export const MAX_FILE_CHARS = DEFAULT_AGENT_CONFIG.maxFileContentChars
export const MAX_DIR_ITEMS = 150  // 目录列表条目数，固定值
export const MAX_SEARCH_RESULTS = PERFORMANCE_DEFAULTS.maxSearchResults
export const MAX_TERMINAL_OUTPUT = DEFAULT_AGENT_CONFIG.maxTerminalChars
export const MAX_CONTEXT_CHARS = DEFAULT_AGENT_CONFIG.maxTotalContextChars

/**
 * 主系统提示词构建器
 */
export async function buildAgentSystemPrompt(
  mode: WorkMode,
  workspacePath: string | null,
  options?: {
    openFiles?: string[]
    activeFile?: string
    customInstructions?: string
    promptTemplateId?: string
  }
): Promise<string> {
  const { openFiles = [], activeFile, customInstructions, promptTemplateId } = options || {}

  // 获取模板
  const template = promptTemplateId
    ? getPromptTemplateById(promptTemplateId)
    : getDefaultPromptTemplate()

  if (!template) {
    throw new Error(`Template not found: ${promptTemplateId}`)
  }

  // 并行加载动态内容
  const [projectRules, memories] = await Promise.all([
    rulesService.getRules(),
    memoryService.getMemories(),
  ])

  // 获取 Plan（仅 plan 模式）
  const plan = mode === 'plan' ? useAgentStore.getState().plan : null

  // 构建上下文
  const ctx: PromptContext = {
    os: getOS(),
    workspacePath,
    activeFile: activeFile || null,
    openFiles,
    date: new Date().toLocaleDateString(),
    mode,
    personality: template.personality,
    projectRules,
    memories,
    customInstructions: customInstructions || null,
    plan,
  }

  // 根据模式选择构建器
  return mode === 'chat' ? buildChatPrompt(ctx) : buildSystemPrompt(ctx)
}

function getOS(): string {
  if (typeof navigator !== 'undefined') {
    return (navigator as any).userAgentData?.platform || navigator.platform || 'Unknown'
  }
  return 'Unknown'
}

// 用户消息格式化
export function formatUserMessage(
  message: string,
  context?: {
    selections?: Array<{
      type: 'file' | 'code' | 'folder'
      path: string
      content?: string
      range?: [number, number]
    }>
  }
): string {
  let formatted = message

  if (context?.selections && context.selections.length > 0) {
    const selectionsStr = context.selections
      .map((s) => {
        if (s.type === 'code' && s.content && s.range) {
          return `**${s.path}** (lines ${s.range[0]}-${s.range[1]}):\n\`\`\`\n${s.content}\n\`\`\``
        } else if (s.type === 'file' && s.content) {
          return `**${s.path}**:\n\`\`\`\n${s.content}\n\`\`\``
        } else {
          return `**${s.path}**`
        }
      })
      .join('\n\n')

    formatted += `\n\n---\n**Context:**\n${selectionsStr}`
  }

  return formatted
}

// 工具结果格式化
export function formatToolResult(toolName: string, result: string, success: boolean): string {
  return success ? result : `Error executing ${toolName}: ${result}`
}
