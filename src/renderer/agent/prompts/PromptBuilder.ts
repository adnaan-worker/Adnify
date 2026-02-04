/**
 * 提示词构建器
 * 
 * 职责：
 * 1. 构建系统提示词（buildAgentSystemPrompt）
 * 2. 格式化用户消息和工具结果
 * 
 * 从 promptTemplates.ts 导入静态常量，动态构建完整提示词
 */

import { WorkMode } from '@/renderer/modes/types'
import { generateToolsPromptDescriptionFiltered, type ToolCategory } from '@/shared/config/tools'
import { getToolsForContext } from '@/shared/config/toolGroups'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { PERFORMANCE_DEFAULTS } from '@shared/config/defaults'
import { rulesService, type ProjectRules } from '../services/rulesService'
import { memoryService, type MemoryItem } from '../services/memoryService'

// 从 promptTemplates 导入静态常量
import {
  APP_IDENTITY,
  PROFESSIONAL_OBJECTIVITY,
  SECURITY_RULES,
  CODE_CONVENTIONS,
  WORKFLOW_GUIDELINES,
  OUTPUT_FORMAT,
  TOOL_GUIDELINES,
  getPromptTemplateById,
  getDefaultPromptTemplate,
} from './promptTemplates'

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'

// 项目摘要缓存
let projectSummaryCache: { path: string; summary: string; timestamp: number } | null = null
const SUMMARY_CACHE_TTL = 5 * 60 * 1000 // 5 分钟

/**
 * 加载项目摘要（带缓存）
 */
async function loadProjectSummary(workspacePath: string): Promise<string | null> {
  try {
    // 检查缓存
    if (
      projectSummaryCache &&
      projectSummaryCache.path === workspacePath &&
      Date.now() - projectSummaryCache.timestamp < SUMMARY_CACHE_TTL
    ) {
      logger.agent.info('[PromptBuilder] Using cached project summary')
      return projectSummaryCache.summary
    }

    const summary = await api.index.getProjectSummaryText(workspacePath)
    if (summary) {
      projectSummaryCache = { path: workspacePath, summary, timestamp: Date.now() }
      logger.agent.info('[PromptBuilder] Loaded project summary:', summary.slice(0, 200) + '...')
      return summary
    }
    logger.agent.info('[PromptBuilder] No project summary available')
    return null
  } catch (e) {
    logger.agent.info('[PromptBuilder] Failed to load project summary:', e)
    return null
  }
}

// ============================================
// 常量导出
// ============================================

export const MAX_FILE_CHARS = DEFAULT_AGENT_CONFIG.maxFileContentChars
export const MAX_DIR_ITEMS = 150
export const MAX_SEARCH_RESULTS = PERFORMANCE_DEFAULTS.maxSearchResults
export const MAX_TERMINAL_OUTPUT = DEFAULT_AGENT_CONFIG.maxTerminalChars
export const MAX_CONTEXT_CHARS = DEFAULT_AGENT_CONFIG.maxTotalContextChars

// ============================================
// 类型定义
// ============================================

export interface PromptContext {
  os: string
  workspacePath: string | null
  activeFile: string | null
  openFiles: string[]
  date: string
  mode: WorkMode
  personality: string
  projectRules: ProjectRules | null
  memories: MemoryItem[]
  customInstructions: string | null
  templateId?: string
  projectSummary?: string | null
}

// ============================================
// 动态部分构建函数
// ============================================

/**
 * 构建工具描述部分
 * 
 * 工具过滤逻辑：
 * 1. 根据 getToolsForContext 获取允许的工具列表（包含角色专属工具）
 * 2. 只生成允许工具的描述
 */
function buildTools(mode: WorkMode, templateId?: string): string {
  // 不排除任何类别
  const excludeCategories: ToolCategory[] = []

  // 获取当前上下文允许的工具列表（包含角色专属工具）
  const allowedTools = getToolsForContext({ mode, templateId })

  // 生成工具描述（双重过滤：类别 + 允许列表）
  const baseTools = generateToolsPromptDescriptionFiltered(excludeCategories, allowedTools)

  return `## Available Tools

${baseTools}

${TOOL_GUIDELINES}`
}

function buildEnvironment(ctx: PromptContext): string {
  return `## Environment
- OS: ${ctx.os}
- Workspace: ${ctx.workspacePath || 'No workspace open'}
- Active File: ${ctx.activeFile || 'None'}
- Open Files: ${ctx.openFiles.length > 0 ? ctx.openFiles.join(', ') : 'None'}
- Date: ${ctx.date}`
}

function buildProjectRules(rules: ProjectRules | null): string | null {
  if (!rules?.content) return null
  return `## Project Rules
${rules.content}`
}

function buildMemory(memories: MemoryItem[]): string | null {
  const enabled = memories.filter(m => m.enabled)
  if (enabled.length === 0) return null
  const lines = enabled.map(m => `- ${m.content}`).join('\n')
  return `## Project Memory
${lines}`
}

function buildCustomInstructions(instructions: string | null): string | null {
  if (!instructions?.trim()) return null
  return `## Custom Instructions
${instructions.trim()}`
}

function buildProjectSummary(summary: string | null): string | null {
  if (!summary?.trim()) return null
  logger.agent.info('[PromptBuilder] Injecting project summary into system prompt, length:', summary.length)
  return `## Project Overview
${summary.trim()}

Note: This is an auto-generated project summary. Use it to understand the codebase structure before exploring files.`
}

// ============================================
// 主构建函数
// ============================================

/**
 * 构建完整的系统提示词
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: (string | null)[] = [
    ctx.personality,
    APP_IDENTITY,
    PROFESSIONAL_OBJECTIVITY,
    SECURITY_RULES,
    buildTools(ctx.mode, ctx.templateId),
    CODE_CONVENTIONS,
    // 使用通用工作流指南
    WORKFLOW_GUIDELINES,
    OUTPUT_FORMAT,
    buildEnvironment(ctx),
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    buildCustomInstructions(ctx.customInstructions),
  ]

  return sections.filter(Boolean).join('\n\n')
}

/**
 * Chat 模式（移除工具部分）
 */
export function buildChatPrompt(ctx: PromptContext): string {
  const sections: (string | null)[] = [
    ctx.personality,
    APP_IDENTITY,
    PROFESSIONAL_OBJECTIVITY,
    SECURITY_RULES,
    CODE_CONVENTIONS,
    OUTPUT_FORMAT,
    buildEnvironment(ctx),
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    buildCustomInstructions(ctx.customInstructions),
  ]

  return sections.filter(Boolean).join('\n\n')
}

// ============================================
// 主入口函数
// ============================================

/**
 * 构建 Agent 系统提示词
 * 
 * 这是提示词系统的主入口，负责：
 * 1. 加载模板
 * 2. 获取动态内容（规则、记忆、项目摘要）
 * 3. 构建完整提示词
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

  // 并行加载动态内容（包括项目摘要）
  const [projectRules, memories, projectSummary] = await Promise.all([
    rulesService.getRules(),
    memoryService.getMemories(),
    workspacePath ? loadProjectSummary(workspacePath) : Promise.resolve(null),
  ])

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
    templateId: template.id,
    projectSummary,
  }

  // 根据模式选择构建器
  return mode === 'chat' ? buildChatPrompt(ctx) : buildSystemPrompt(ctx)
}

// ============================================
// 工具函数
// ============================================

function getOS(): string {
  if (typeof navigator !== 'undefined') {
    return (navigator as any).userAgentData?.platform || navigator.platform || 'Unknown'
  }
  return 'Unknown'
}

/**
 * 格式化用户消息
 */
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

/**
 * 格式化工具结果
 */
export function formatToolResult(toolName: string, result: string, success: boolean): string {
  return success ? result : `Error executing ${toolName}: ${result}`
}
