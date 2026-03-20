/**
 * Stream processing for assistant responses.
 * Collects text, reasoning, and tool-call events and resolves a final result.
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { parseXMLToolCalls } from '../utils/XMLToolParser'
import { EventBus } from './EventBus'
import { getErrorMessage, ErrorCode } from '@shared/utils/errorHandler'
import type { ToolCall, TokenUsage } from '../types'
import type { LLMCallResult } from './types'

// Tracks active IPC listeners for leak debugging.
let activeListenerCount = 0

export function getActiveListenerCount(): number {
  return activeListenerCount
}

const STREAMABLE_TOOL_ARG_KEYS = new Set([
  'path',
  'command',
  'query',
  'pattern',
  'url',
  'cwd',
  'line',
  'column',
  'terminal_id',
  'file_pattern',
  'is_background',
  'timeout',
  'refresh',
])

const PARTIAL_ARGS_SCAN_LIMIT = 4096

function arePartialArgsEqual(
  left?: Record<string, unknown>,
  right?: Record<string, unknown>
): boolean {
  if (left === right) return true
  if (!left || !right) return !left && !right

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false
    }
  }

  return true
}

function parseFinalJsonArgs(argsString: string): Record<string, unknown> | null {
  if (!argsString) return null

  try {
    const parsed = JSON.parse(argsString)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function parsePartialJsonArgs(argsString: string): Record<string, unknown> | null {
  if (!argsString) return null
  const scanTarget = argsString.length > PARTIAL_ARGS_SCAN_LIMIT
    ? argsString.slice(0, PARTIAL_ARGS_SCAN_LIMIT)
    : argsString

  try {
    const parsed = JSON.parse(scanTarget)
    if (!parsed || typeof parsed !== 'object') return null
    const filtered = Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) =>
        STREAMABLE_TOOL_ARG_KEYS.has(key) && typeof value !== 'object'
      )
    )
    return Object.keys(filtered).length > 0 ? filtered : null
  } catch {
    const result: Record<string, unknown> = {}

    // Match simple string fields.
    const stringFieldRegex = /"(\w+)":\s*"((?:[^"\\]|\\.)*)"/g
    let match
    while ((match = stringFieldRegex.exec(scanTarget)) !== null) {
      if (!STREAMABLE_TOOL_ARG_KEYS.has(match[1])) continue
      try {
        result[match[1]] = JSON.parse(`"${match[2]}"`)
      } catch {
        result[match[1]] = match[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
    }

    const boolFieldRegex = /"(\w+)":\s*(true|false)/g
    while ((match = boolFieldRegex.exec(scanTarget)) !== null) {
      if (!STREAMABLE_TOOL_ARG_KEYS.has(match[1])) continue
      result[match[1]] = match[2] === 'true'
    }

    // Match numeric fields.
    const numFieldRegex = /"(\w+)":\s*(-?\d+(?:\.\d+)?)/g
    while ((match = numFieldRegex.exec(scanTarget)) !== null) {
      if (!STREAMABLE_TOOL_ARG_KEYS.has(match[1])) continue
      result[match[1]] = parseFloat(match[2])
    }

    return Object.keys(result).length > 0 ? result : null
  }
}

// ===== Stream Processor =====

export interface StreamProcessor {
  wait: () => Promise<LLMCallResult>
  cleanup: () => void
}

export function createStreamProcessor(
  assistantId: string | null,
  store: import('../store/AgentStore').ThreadBoundStore,
  requestId: string
): StreamProcessor {

  let content = ''
  let reasoning = ''
  let isInReasoning = false
  let reasoningPartId: string | null = null
  let toolCalls: ToolCall[] = []
  let usage: TokenUsage | undefined
  let error: string | undefined
  let isCleanedUp = false

  const streamingToolCalls = new Map<string, {
    id: string
    name: string
    argsString: string
    lastPreviewArgs?: Record<string, unknown>
  }>()

  let toolUpdateRafId: number | null = null
  const pendingToolPreviewUpdates = new Map<string, {
    partialArgs?: Record<string, unknown>
    name?: string
    timestamp: number
  }>()

  // Cleanup callbacks for request-scoped listeners.
  const cleanups: (() => void)[] = []

  const flushToolPreviewUpdates = () => {
    if (toolUpdateRafId !== null) {
      cancelAnimationFrame(toolUpdateRafId)
      toolUpdateRafId = null
    }

    if (!assistantId || pendingToolPreviewUpdates.size === 0) return

    for (const [toolId, update] of pendingToolPreviewUpdates) {
      store.setToolStreamingPreview(toolId, {
        isStreaming: true,
        ...(update.partialArgs ? { partialArgs: update.partialArgs } : {}),
        ...(update.name ? { name: update.name } : {}),
        lastUpdateTime: update.timestamp,
      })
    }

    pendingToolPreviewUpdates.clear()
  }

  const scheduleToolPreviewUpdates = () => {
    if (toolUpdateRafId !== null) return

    toolUpdateRafId = requestAnimationFrame(() => {
      toolUpdateRafId = null
      flushToolPreviewUpdates()
    })
  }

  const queueToolPreviewUpdate = (
    toolId: string,
    update: {
      partialArgs?: Record<string, unknown>
      name?: string
      timestamp: number
    }
  ) => {
    const current = pendingToolPreviewUpdates.get(toolId)
    pendingToolPreviewUpdates.set(toolId, {
      ...current,
      ...update,
      timestamp: update.timestamp,
    })
    scheduleToolPreviewUpdates()
  }

  const cleanup = () => {
    if (isCleanedUp) return
    isCleanedUp = true

    if (toolUpdateRafId !== null) {
      cancelAnimationFrame(toolUpdateRafId)
      toolUpdateRafId = null
    }
    pendingToolPreviewUpdates.clear()

    for (const fn of cleanups) {
      try {
        fn()
        activeListenerCount--
      } catch (err) {
        logger.agent.error('[StreamProcessor] Cleanup error:', err)
      }
    }
    cleanups.length = 0
    logger.agent.info('[StreamProcessor] Active listeners remaining:', activeListenerCount)
  }

  const handleStream = (data: {
    type: string
    content?: string
    id?: string
    name?: string
    arguments?: unknown
    argumentsDelta?: string
    usage?: unknown
  }) => {
    switch (data.type) {
      case 'text':
        if (data.content) {
          if (isInReasoning && assistantId && reasoningPartId) {
            store.finalizeReasoningPart(assistantId, reasoningPartId)
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
            isInReasoning = false
          }

          content += data.content
          if (assistantId) {
            store.appendToAssistant(assistantId, data.content)
          }
          EventBus.emit({ type: 'stream:text', text: data.content })

          // Detect XML-style tool calls embedded in text streams.
          const detected = parseXMLToolCalls(content)
          for (const tc of detected) {
            if (!toolCalls.find((t) => t.id === tc.id)) {
              const toolCall: ToolCall = { ...tc, status: 'pending' }
              toolCalls.push(toolCall)
              if (assistantId) {
                store.addToolCallPart(assistantId, toolCall)
              }
              EventBus.emit({ type: 'stream:tool_available', id: tc.id, name: tc.name, args: tc.arguments })
            }
          }
        }
        break

      case 'reasoning': {
        const reasoningContent = data.content
        if (reasoningContent) {
          if (!isInReasoning) {
            isInReasoning = true
            if (assistantId) {
              reasoningPartId = store.addReasoningPart(assistantId)
              store.updateMessage(assistantId, {
                reasoningStartTime: Date.now(),
              } as Partial<import('../types').AssistantMessage>)
            }
            EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'start' })
          }
          reasoning += reasoningContent
          if (assistantId && reasoningPartId) {
            store.updateReasoningPart(assistantId, reasoningPartId, reasoningContent, true)
            store.updateMessage(assistantId, {
              reasoning,
            } as Partial<import('../types').AssistantMessage>)
          }
          EventBus.emit({ type: 'stream:reasoning', text: reasoningContent, phase: 'delta' })
        }
        break
      }

      case 'tool_call_start': {
        const toolId = data.id || `tool-${Date.now()}`
        const toolName = data.name || '...'

        if (isInReasoning && assistantId && reasoningPartId) {
          store.finalizeReasoningPart(assistantId, reasoningPartId)
          EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
          isInReasoning = false
        }

        streamingToolCalls.set(toolId, {
          id: toolId,
          name: toolName,
          argsString: '',
        })

        // Finalize text first so the tool card appears after prior text.
        if (assistantId && content.length > 0) {
          store.finalizeTextBeforeToolCall(assistantId)
        }

        if (assistantId) {
          store.addToolCallPart(assistantId, {
            id: toolId,
            name: toolName,
            arguments: {},
          })
          store.setToolStreamingPreview(toolId, {
            isStreaming: true,
            name: toolName,
          })
        }
        EventBus.emit({ type: 'stream:tool_start', id: toolId, name: toolName })
        break
      }

      case 'tool_call_delta': {
        const tcId = data.id
        const argsDelta = data.argumentsDelta

        if (tcId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            if (argsDelta) {
              tc.argsString += argsDelta

              if (assistantId) {
                const partialArgs = parsePartialJsonArgs(tc.argsString)
                if (partialArgs && Object.keys(partialArgs).length > 0) {
                  if (!arePartialArgsEqual(tc.lastPreviewArgs, partialArgs)) {
                    tc.lastPreviewArgs = partialArgs
                    queueToolPreviewUpdate(tc.id, {
                      partialArgs,
                      timestamp: Date.now(),
                    })
                  }
                }
              }
            }
            if (data.name && data.name !== tc.name) {
              tc.name = data.name
              if (assistantId) {
                queueToolPreviewUpdate(tc.id, {
                  name: data.name,
                  timestamp: Date.now(),
                })
              }
            }
            EventBus.emit({ type: 'stream:tool_delta', id: tc.id, args: tc.argsString })
          }
        }
        break
      }

      case 'tool_call_delta_end': {
        const tcId = data.id
        if (tcId && assistantId) {
          const tc = streamingToolCalls.get(tcId)
          if (tc) {
            flushToolPreviewUpdates()
            const finalArgs = parseFinalJsonArgs(tc.argsString) || {}
            if (finalArgs) {
              store.updateToolCall(assistantId, tc.id, {
                arguments: finalArgs,
                streamingState: undefined,
              })
            }

            const toolCall: ToolCall = {
              id: tc.id,
              name: tc.name,
              arguments: finalArgs,
              status: 'pending',
            }

            // Avoid duplicate tool calls in the final array.
            if (!toolCalls.find(t => t.id === tc.id)) {
              toolCalls.push(toolCall)
            }
          }
        }
        break
      }

      case 'tool_call_available': {
        const tcId = data.id || ''
        const toolName = data.name || ''
        const args = data.arguments as Record<string, unknown>

        if (tcId) {
          flushToolPreviewUpdates()
          streamingToolCalls.delete(tcId)
        }

        const toolCall: ToolCall = {
          id: tcId,
          name: toolName,
          arguments: args,
          status: 'pending',
        }

        // Avoid duplicate tool calls in the final array.
        if (!toolCalls.find(tc => tc.id === tcId)) {
          toolCalls.push(toolCall)
        }

        if (assistantId && tcId) {
          store.updateToolCall(assistantId, tcId, {
            name: toolName,
            arguments: args,
            status: 'pending',
            streamingState: undefined,
          })
        }

        EventBus.emit({ type: 'stream:tool_available', id: tcId, name: toolName, args })
        break
      }

      case 'usage':
        if (data.usage) {
          usage = data.usage as TokenUsage
        }
        break
    }
  }

  const finalizeReasoning = () => {
    if (isInReasoning) {
      if (assistantId && reasoningPartId) {
        store.finalizeReasoningPart(assistantId, reasoningPartId)
      }
      EventBus.emit({ type: 'stream:reasoning', text: '', phase: 'end' })
      isInReasoning = false
    }
  }

  // Promise resolver is hoisted to avoid listener registration races.
  let resolveWait: ((result: LLMCallResult) => void) | null = null
  let isResolved = false

  const waitPromise = new Promise<LLMCallResult>((resolve) => {
    resolveWait = resolve
  })

  const doResolve = (result: LLMCallResult) => {
    if (isResolved) return
    isResolved = true

    if (resolveWait) {
      resolveWait(result)
    }

    cleanup()
  }

  // Handle request error.
  const handleError = (err: { message?: string; code?: string } | string) => {
    let errorMsg: string

    if (typeof err === 'string') {
      errorMsg = err
    } else {
      if (err.code && err.code in ErrorCode) {
        const language = useStore.getState().language
        const baseMsg = getErrorMessage(err.code as ErrorCode, language)
        errorMsg = err.message ? `${baseMsg}: ${err.message}` : baseMsg
      } else {
        errorMsg = err.message || 'Unknown error'
      }
    }

    logger.agent.error('[StreamProcessor] Error:', errorMsg)
    error = errorMsg
    finalizeReasoning()
    doResolve({ content, toolCalls, usage, error: errorMsg })
  }

  const handleDone = (result: { usage?: unknown }) => {
    if (result?.usage) {
      usage = result.usage as TokenUsage
    }
    finalizeReasoning()
    doResolve({ content, toolCalls, usage, error })
  }

  // Subscribe only to this request's IPC channel.
  const unsubStream = api.llm.onStream(requestId, handleStream)
  const unsubError = api.llm.onError(requestId, handleError)
  const unsubDone = api.llm.onDone(requestId, handleDone)

  cleanups.push(unsubStream, unsubError, unsubDone)
  activeListenerCount += 3

  // Expose the already-created completion promise.
  const wait = (): Promise<LLMCallResult> => waitPromise

  return { wait, cleanup }
}

