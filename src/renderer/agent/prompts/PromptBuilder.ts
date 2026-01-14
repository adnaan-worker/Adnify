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
import { useAgentStore } from '../store/AgentStore'
import type { Plan } from '../types'

// 从 promptTemplates 导入静态常量
import {
  APP_IDENTITY,
  PROFESSIONAL_OBJECTIVITY,
  SECURITY_RULES,
  CODE_CONVENTIONS,
  WORKFLOW_GUIDELINES,
  OUTPUT_FORMAT,
  TOOL_GUIDELINES,
  PLANNING_TOOLS_DESC,
  getPromptTemplateById,
  getDefaultPromptTemplate,
} from './promptTemplates'

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
  plan: Plan | null
  templateId?: string
}

// ============================================
// 动态部分构建函数
// ============================================

/**
 * 构建工具描述部分
 * 
 * 工具过滤逻辑：
 * 1. 根据模式排除类别（agent 模式排除 plan 类别）
 * 2. 根据 getToolsForContext 获取允许的工具列表（包含角色专属工具）
 * 3. 只生成允许工具的描述
 */
function buildTools(mode: WorkMode, templateId?: string): string {
  // 根据模式确定要排除的类别
  const excludeCategories: ToolCategory[] = mode === 'plan' ? [] : ['plan']
  
  // 获取当前上下文允许的工具列表（包含角色专属工具）
  const allowedTools = getToolsForContext({ mode, templateId })
  
  // 生成工具描述（双重过滤：类别 + 允许列表）
  const baseTools = generateToolsPromptDescriptionFiltered(excludeCategories, allowedTools)
  const planningSection = mode === 'plan' ? `\n\n${PLANNING_TOOLS_DESC}` : ''
  
  return `## Available Tools

${baseTools}${planningSection}

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

function buildPlanSection(plan: Plan | null): string | null {
  if (!plan || plan.items.length === 0) return null
  
  const statusMap: Record<string, string> = {
    completed: 'x',
    in_progress: '/',
    failed: '!',
    pending: ' ',
    skipped: '-',
  }
  
  const items = plan.items.map((item, i) => {
    const mark = statusMap[item.status] || ' '
    return `${i + 1}. [${mark}] ${item.title}`
  }).join('\n')
  
  return `## Current Plan
Status: ${plan.status}

${items}

### Plan Management
If a plan exists:
1. Check the current status of plan items
2. After completing a step, use \`update_plan\` to mark it as 'completed'
3. If a step fails, mark it as 'failed'
4. If you need to change the plan, use \`update_plan\` to modify items
5. ALWAYS keep the plan status in sync with your actions`
}

/**
 * Plan 模式引导指令
 */
function buildPlanModeGuidelines(): string {
  return `## ⚠️ PLAN MODE - CRITICAL RULES (READ FIRST!)

**You are in PLAN MODE. You MUST follow this workflow strictly:**

### Phase 1: Gather Requirements (MANDATORY)
- **FIRST ACTION**: Use \`ask_user\` to understand what the user wants
- After calling \`ask_user\`, you MUST STOP and wait for user selection
- Do NOT proceed until user responds
- Continue asking questions until you have enough information

### Phase 2: Create Plan (ONLY after Phase 1)
- ONLY after user answers your questions, use \`create_plan\`
- Do NOT create plan before gathering requirements
- Do NOT modify any files before creating a plan

### Phase 3: Execute (ONLY after Phase 2)
- Execute plan steps one by one
- Use \`update_plan\` to mark each step as completed/failed

### FORBIDDEN Actions in Plan Mode:
❌ Creating plan immediately without asking user first
❌ Modifying files before creating a plan
❌ Skipping the \`ask_user\` phase
❌ Assuming what the user wants without asking

### REQUIRED First Action:
✅ Call \`ask_user\` with relevant questions about the task`
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
    // Plan 模式的关键指令放在最前面，确保 AI 优先遵守
    ctx.mode === 'plan' ? buildPlanModeGuidelines() : null,
    ctx.mode === 'plan' ? buildPlanSection(ctx.plan) : null,
    PROFESSIONAL_OBJECTIVITY,
    SECURITY_RULES,
    buildTools(ctx.mode, ctx.templateId),
    CODE_CONVENTIONS,
    WORKFLOW_GUIDELINES,
    OUTPUT_FORMAT,
    buildEnvironment(ctx),
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
 * 2. 获取动态内容（规则、记忆）
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
    templateId: template.id,
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
