import { useMemo } from 'react'
import type { ToolCall } from '@renderer/agent/types'
import type { ToolStreamingPreview } from '@/shared/types'
import { selectToolStreamingPreview, useAgentStore } from '@renderer/agent/store/AgentStore'

const EMPTY_ARGS: Record<string, unknown> = {}

export interface ToolDisplayState {
    previewState?: ToolStreamingPreview
    effectiveName: string
    args: Record<string, unknown>
    status: ToolCall['status']
    isSuccess: boolean
    isError: boolean
    isRejected: boolean
    isRunning: boolean
    isFinalState: boolean
    isStreaming: boolean
}

export function useToolDisplayState(toolCall: ToolCall): ToolDisplayState {
    const previewSelector = useMemo(() => selectToolStreamingPreview(toolCall.id), [toolCall.id])
    const previewState = useAgentStore(previewSelector)

    const args = useMemo(() => {
        const previewArgs = previewState?.partialArgs

        if (!previewArgs || Object.keys(previewArgs).length === 0) {
            return (toolCall.arguments || EMPTY_ARGS) as Record<string, unknown>
        }

        return {
            ...(toolCall.arguments || EMPTY_ARGS),
            ...previewArgs,
        } as Record<string, unknown>
    }, [toolCall.arguments, previewState?.partialArgs])

    const status = toolCall.status
    const isSuccess = status === 'success'
    const isError = status === 'error'
    const isRejected = status === 'rejected'
    const isRunning = status === 'running' || status === 'pending'
    const isFinalState = isSuccess || isError || isRejected
    const isStreaming = !isFinalState && (
        !!previewState?.isStreaming ||
        args._streaming === true
    )

    return {
        previewState,
        effectiveName: previewState?.name || toolCall.name,
        args,
        status,
        isSuccess,
        isError,
        isRejected,
        isRunning,
        isFinalState,
        isStreaming,
    }
}
