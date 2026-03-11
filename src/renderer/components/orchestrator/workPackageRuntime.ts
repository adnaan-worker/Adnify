import { getMessageText, isAssistantMessage, isUserMessage, type AssistantMessage, type ChatThread } from '@renderer/agent/types'
import type { WorkPackage } from '@renderer/agent/types/taskExecution'

export interface WorkPackageRuntimeActivity {
  threadId: string
  phase: ChatThread['streamState']['phase']
  phaseLabel: string
  userPreview: string | null
  assistantPreview: string | null
  toolPreview: string | null
  messageCount: number
  hasLiveOutput: boolean
  lastProgressAt: number | null
  stuckReason: string | null
}

const ACTIVE_TOOL_STATUSES = new Set(['pending', 'awaiting', 'running'])

function normalizePreview(text: string | null | undefined, maxLength = 180): string | null {
  const normalized = (text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function getAssistantPreview(message: AssistantMessage | undefined): string | null {
  if (!message) {
    return null
  }

  const directContent = normalizePreview(message.content)
  if (directContent) {
    return directContent
  }

  for (const part of [...message.parts].reverse()) {
    if (part.type === 'text' || part.type === 'reasoning' || part.type === 'search') {
      const preview = normalizePreview(part.content)
      if (preview) {
        return preview
      }
    }
  }

  return null
}

function getToolPreview(message: AssistantMessage | undefined): string | null {
  if (!message?.toolCalls?.length) {
    return null
  }

  const activeNames = Array.from(new Set(
    message.toolCalls
      .filter((toolCall) => ACTIVE_TOOL_STATUSES.has(toolCall.status))
      .map((toolCall) => toolCall.name),
  ))

  if (activeNames.length > 0) {
    return normalizePreview(activeNames.join(' · '), 120)
  }

  const latestNames = Array.from(new Set(message.toolCalls.slice(-3).map((toolCall) => toolCall.name)))
  return latestNames.length > 0 ? normalizePreview(latestNames.join(' · '), 120) : null
}

export function getWorkPackagePhaseLabel(phase: ChatThread['streamState']['phase']): string {
  switch (phase) {
    case 'streaming':
      return '输出中'
    case 'tool_pending':
      return '等待审批'
    case 'tool_running':
      return '工具执行中'
    case 'error':
      return '异常'
    case 'idle':
    default:
      return '待机'
  }
}

export function buildWorkPackageRuntimeActivity(
  workPackage: WorkPackage,
  thread?: ChatThread | null,
): WorkPackageRuntimeActivity | null {
  if (!workPackage.threadId) {
    return null
  }

  if (!thread) {
    return {
      threadId: workPackage.threadId,
      phase: 'idle',
      phaseLabel: '等待线程',
      userPreview: null,
      assistantPreview: null,
      toolPreview: null,
      messageCount: 0,
      hasLiveOutput: false,
      lastProgressAt: workPackage.heartbeat?.lastProgressAt ?? null,
      stuckReason: workPackage.heartbeat?.stuckReason ?? null,
    }
  }

  const messages = thread.messages || []
  const latestAssistantMessage = [...messages].reverse().find(isAssistantMessage)
  const latestUserMessage = [...messages].reverse().find(isUserMessage)
  const assistantPreview = getAssistantPreview(latestAssistantMessage)
  const userPreview = latestUserMessage ? normalizePreview(getMessageText(latestUserMessage.content)) : null
  const toolPreview = getToolPreview(latestAssistantMessage)

  return {
    threadId: workPackage.threadId,
    phase: thread.streamState.phase,
    phaseLabel: getWorkPackagePhaseLabel(thread.streamState.phase),
    userPreview,
    assistantPreview,
    toolPreview,
    messageCount: messages.length,
    hasLiveOutput: Boolean(assistantPreview || userPreview || toolPreview),
    lastProgressAt: workPackage.heartbeat?.lastProgressAt ?? null,
    stuckReason: workPackage.heartbeat?.stuckReason ?? null,
  }
}
