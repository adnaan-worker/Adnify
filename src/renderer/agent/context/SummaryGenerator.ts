/**
 * 摘要生成器
 * 
 * 支持两种模式：
 * 1. 快速摘要：不调用 LLM，直接提取关键信息
 * 2. LLM 摘要：调用 LLM 生成高质量结构化摘要
 */

import type { OpenAIMessage } from '../llm/MessageConverter'
import type { 
  StructuredSummary, 
  MessageGroup, 
  HandoffDocument 
} from './types'
import { extractDecisionPoints, extractFileChanges } from './ImportanceScorer'
import { isWriteTool } from '@/shared/config/tools'

/**
 * 快速生成摘要（不调用 LLM）
 */
export function generateQuickSummary(
  messages: OpenAIMessage[],
  groups: MessageGroup[],
  turnRange: [number, number]
): StructuredSummary {
  const decisions = extractDecisionPoints(messages, groups)
  const fileChanges = extractFileChanges(messages, groups)
  
  // 提取任务目标（第一条用户消息）
  const firstUserMsg = messages.find(m => m.role === 'user')
  const objective = firstUserMsg 
    ? extractObjective(typeof firstUserMsg.content === 'string' ? firstUserMsg.content : '')
    : 'Unknown objective'

  // 提取已完成步骤
  const completedSteps = extractCompletedSteps(messages, groups)
  
  // 提取待完成步骤（从最后一条助手消息推断）
  const pendingSteps = extractPendingSteps(messages)
  
  // 提取错误和修复
  const errorsAndFixes = extractErrorsAndFixes(messages, groups)
  
  // 提取用户重要指示
  const userInstructions = extractUserInstructions(messages, groups)

  return {
    objective,
    completedSteps,
    pendingSteps,
    decisions,
    fileChanges,
    errorsAndFixes,
    userInstructions,
    generatedAt: Date.now(),
    turnRange,
  }
}

/**
 * 生成 LLM 摘要的 prompt
 */
export function buildSummaryPrompt(
  _messages: OpenAIMessage[],
  quickSummary: StructuredSummary
): string {
  const fileChangesList = quickSummary.fileChanges
    .map(f => `- ${f.action}: ${f.path} (${f.summary})`)
    .join('\n')

  const decisionsList = quickSummary.decisions
    .map(d => `- [${d.type}] ${d.description}`)
    .join('\n')

  return `Based on the conversation above, generate a detailed summary for continuing this task in a new context.

## Quick Analysis (for reference):
- Objective: ${quickSummary.objective}
- File Changes:
${fileChangesList || '  None'}
- Key Decisions:
${decisionsList || '  None'}
- Errors Encountered: ${quickSummary.errorsAndFixes.length}

## Required Output Format (JSON):
{
  "objective": "Clear description of the main task/goal",
  "completedSteps": ["Step 1 completed", "Step 2 completed"],
  "pendingSteps": ["Next step to do", "Another pending task"],
  "keyInsights": ["Important insight 1", "Important insight 2"],
  "blockers": ["Any blocking issues"],
  "suggestedApproach": "Recommended approach for continuing"
}

Focus on:
1. What was the user trying to achieve?
2. What has been done so far?
3. What still needs to be done?
4. Any important decisions or constraints mentioned?
5. Any errors that were fixed or still need fixing?`
}

/**
 * 生成 Handoff 文档
 */
export function generateHandoffDocument(
  sessionId: string,
  messages: OpenAIMessage[],
  _groups: MessageGroup[],
  summary: StructuredSummary,
  workingDirectory: string
): HandoffDocument {
  // 提取最后的用户请求
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  const lastUserRequest = lastUserMsg 
    ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : 'Continue the task')
    : 'Continue the task'

  // 提取关键文件快照（最近修改的文件）
  const recentFiles = summary.fileChanges
    .filter(f => f.action !== 'delete')
    .slice(-5)
    .map(f => ({
      path: f.path,
      content: '', // 实际内容需要从文件系统读取
      reason: f.summary,
    }))

  // 生成建议的下一步
  const suggestedNextSteps = generateSuggestedNextSteps(summary)

  return {
    fromSessionId: sessionId,
    createdAt: Date.now(),
    summary,
    workingDirectory,
    keyFileSnapshots: recentFiles,
    lastUserRequest: lastUserRequest.slice(0, 500),
    suggestedNextSteps,
  }
}

/**
 * 将 Handoff 文档转换为 System Prompt 注入
 */
export function handoffToSystemPrompt(handoff: HandoffDocument): string {
  const fileChanges = handoff.summary.fileChanges
    .map(f => `- [${f.action.toUpperCase()}] ${f.path}: ${f.summary}`)
    .join('\n')

  const decisions = handoff.summary.decisions
    .slice(-10) // 只保留最近 10 个决策
    .map(d => `- ${d.description}`)
    .join('\n')

  const errors = handoff.summary.errorsAndFixes
    .map(e => `- Error: ${e.error}\n  Fix: ${e.fix}`)
    .join('\n')

  const instructions = handoff.summary.userInstructions
    .slice(-5)
    .map(i => `- ${i}`)
    .join('\n')

  return `## Session Handoff Context

This is a continuation of a previous session. Here's what happened:

### Objective
${handoff.summary.objective}

### Completed Steps
${handoff.summary.completedSteps.map(s => `✓ ${s}`).join('\n') || 'None recorded'}

### Pending Steps
${handoff.summary.pendingSteps.map(s => `○ ${s}`).join('\n') || 'None recorded'}

### File Changes Made
${fileChanges || 'None'}

### Key Decisions
${decisions || 'None'}

### Errors & Fixes
${errors || 'None'}

### User Instructions to Remember
${instructions || 'None'}

### Last User Request
"${handoff.lastUserRequest}"

### Suggested Next Steps
${handoff.suggestedNextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

---
Continue from where we left off. The user may provide additional context or corrections.`
}

// ===== 辅助函数 =====

function extractObjective(content: string): string {
  // 提取第一句话或前 200 字符作为目标
  const firstSentence = content.match(/^[^.!?。！？]+[.!?。！？]?/)?.[0]
  if (firstSentence && firstSentence.length > 20) {
    return firstSentence.slice(0, 200)
  }
  return content.slice(0, 200)
}

function extractCompletedSteps(messages: OpenAIMessage[], groups: MessageGroup[]): string[] {
  const steps: string[] = []
  
  for (const group of groups) {
    if (!group.hasWriteOps) continue
    if (group.assistantIndex === null) continue
    
    const assistantMsg = messages[group.assistantIndex]
    if (!assistantMsg.tool_calls) continue
    
    for (const tc of assistantMsg.tool_calls) {
      if (isWriteTool(tc.function.name)) {
        const args = safeParseArgs(tc.function.arguments)
        if (args.path) {
          steps.push(`${tc.function.name}: ${args.path}`)
        }
      }
    }
  }
  
  // 去重并限制数量
  return [...new Set(steps)].slice(-20)
}

function extractPendingSteps(messages: OpenAIMessage[]): string[] {
  // 从最后一条助手消息中提取待办事项
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  if (!lastAssistant) return []
  
  const content = typeof lastAssistant.content === 'string' ? lastAssistant.content : ''
  
  // 查找列表项
  const listItems = content.match(/(?:^|\n)\s*[-*•]\s*(.+)/g) || []
  const numberedItems = content.match(/(?:^|\n)\s*\d+[.)]\s*(.+)/g) || []
  
  const items = [...listItems, ...numberedItems]
    .map(item => item.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter(item => item.length > 10 && item.length < 200)
    .slice(0, 5)
  
  return items
}

function extractErrorsAndFixes(
  messages: OpenAIMessage[], 
  groups: MessageGroup[]
): { error: string; fix: string }[] {
  const results: { error: string; fix: string }[] = []
  
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (!group.hasErrors) continue
    
    // 查找错误内容
    for (const toolIdx of group.toolIndices) {
      const toolMsg = messages[toolIdx]
      const content = typeof toolMsg.content === 'string' ? toolMsg.content : ''
      
      if (hasErrorContent(content)) {
        const errorSummary = extractErrorSummary(content)
        
        // 查找后续的修复
        const nextGroup = groups[i + 1]
        let fix = 'Not yet fixed'
        
        if (nextGroup?.hasWriteOps) {
          fix = 'Fixed in subsequent changes'
        }
        
        results.push({ error: errorSummary, fix })
      }
    }
  }
  
  return results.slice(-5) // 只保留最近 5 个
}

function extractUserInstructions(messages: OpenAIMessage[], groups: MessageGroup[]): string[] {
  const instructions: string[] = []
  
  for (const group of groups) {
    const userMsg = messages[group.userIndex]
    const content = typeof userMsg.content === 'string' ? userMsg.content : ''
    
    // 检查是否包含指示性语言
    if (isInstructional(content)) {
      instructions.push(content.slice(0, 150))
    }
  }
  
  return instructions.slice(-5)
}

function generateSuggestedNextSteps(summary: StructuredSummary): string[] {
  const steps: string[] = []
  
  // 基于待完成步骤
  if (summary.pendingSteps.length > 0) {
    steps.push(...summary.pendingSteps.slice(0, 3))
  }
  
  // 基于未修复的错误
  const unfixedErrors = summary.errorsAndFixes.filter(e => e.fix === 'Not yet fixed')
  if (unfixedErrors.length > 0) {
    steps.push(`Fix remaining error: ${unfixedErrors[0].error.slice(0, 50)}`)
  }
  
  // 默认建议
  if (steps.length === 0) {
    steps.push('Review the changes made so far')
    steps.push('Continue with the next logical step')
  }
  
  return steps.slice(0, 5)
}

function hasErrorContent(content: string): boolean {
  return /error|failed|exception|denied/i.test(content.slice(0, 500))
}

function extractErrorSummary(content: string): string {
  // 提取错误的第一行
  const lines = content.split('\n')
  for (const line of lines) {
    if (/error|failed|exception/i.test(line)) {
      return line.slice(0, 100)
    }
  }
  return content.slice(0, 100)
}

function isInstructional(content: string): boolean {
  const patterns = [
    /请|要|必须|不要|别|应该|需要/,
    /please|must|should|don't|always|never/i,
    /记住|注意|重要/,
    /remember|note|important/i,
  ]
  return patterns.some(p => p.test(content))
}

function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}
