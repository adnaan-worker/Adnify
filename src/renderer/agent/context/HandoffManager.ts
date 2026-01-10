/**
 * Handoff 管理器
 * 
 * 负责 L4 级别的会话交接逻辑
 * - 构建 handoff 上下文
 * - 生成欢迎消息
 */

import { logger } from '@utils/Logger'
import type { HandoffDocument, StructuredSummary } from './types'

/**
 * 构建 Handoff 上下文字符串（注入到新会话的 system prompt）
 */
export function buildHandoffContext(handoff: HandoffDocument): string {
  return `## Context from Previous Session

**Previous Objective**: ${handoff.summary.objective}

**Completed Steps**:
${handoff.summary.completedSteps.slice(-10).map(s => `✓ ${s}`).join('\n') || '- None recorded'}

**Pending Steps**:
${handoff.summary.pendingSteps.slice(-5).map(s => `○ ${s}`).join('\n') || '- None recorded'}

**File Changes**:
${handoff.summary.fileChanges.slice(-10).map(f => `- [${f.action.toUpperCase()}] ${f.path}: ${f.summary}`).join('\n') || '- None'}

**User Instructions**:
${handoff.summary.userInstructions.slice(-5).map(i => `⚠️ ${i}`).join('\n') || '- None'}

**Last Request**: ${handoff.lastUserRequest.slice(0, 500)}${handoff.lastUserRequest.length > 500 ? '...' : ''}

---
Continue based on the above context. The user may continue where they left off.`
}

/**
 * 构建欢迎消息（显示在新会话中）
 */
export function buildWelcomeMessage(summary: StructuredSummary, language: 'zh' | 'en' = 'en'): string {
  if (language === 'zh') {
    return `🔄 **会话已继续**

此会话延续自上一个对话。我已了解您之前的工作内容。

**之前的目标**: ${summary.objective}

**已完成**: ${summary.completedSteps.length} 步
**待完成**: ${summary.pendingSteps.length} 步

您可以继续之前的工作。`
  }
  
  return `🔄 **Session Continued**

This session continues from a previous conversation. I have context about your previous work.

**Previous Objective**: ${summary.objective}

**Completed**: ${summary.completedSteps.length} steps
**Pending**: ${summary.pendingSteps.length} steps

You can continue where you left off.`
}

logger.agent.info('[HandoffManager] Module loaded')
