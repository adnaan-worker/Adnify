/**
 * 结构化提示词构建器
 * 
 * 从 promptTemplates.ts 导入静态常量，动态构建完整提示词
 * 不依赖字符串占位符替换
 */

import { WorkMode } from '@/renderer/modes/types'
import { generateAllToolsPromptDescription } from '@/shared/config/tools'
import type { MemoryItem } from '../services/memoryService'
import type { ProjectRules } from '../services/rulesService'
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
} from './promptTemplates'

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
}

// ============================================
// 动态部分构建函数
// ============================================

function buildTools(mode: WorkMode): string {
  const baseTools = generateAllToolsPromptDescription()
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
  return `## Plan Mode Workflow

**Phase 1: Gather Requirements**
- Use \`ask_user\` to understand what the user wants
- After calling \`ask_user\`, STOP and wait for user selection
- Continue asking until you have enough information

**Phase 2: Create Plan**
- Only after user answers your questions, use \`create_plan\`
- Do NOT create plan before gathering requirements

**Phase 3: Execute**
- Execute plan steps one by one
- Use \`update_plan\` to mark each step as completed/failed

**Rules:**
- Never skip Phase 1
- Never create plan immediately
- Always wait for user response after \`ask_user\``
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
    buildTools(ctx.mode),
    CODE_CONVENTIONS,
    WORKFLOW_GUIDELINES,
    OUTPUT_FORMAT,
    buildEnvironment(ctx),
    buildProjectRules(ctx.projectRules),
    buildMemory(ctx.memories),
    buildCustomInstructions(ctx.customInstructions),
    ctx.mode === 'plan' ? buildPlanModeGuidelines() : null,
    ctx.mode === 'plan' ? buildPlanSection(ctx.plan) : null,
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
