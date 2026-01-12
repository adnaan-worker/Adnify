/**
 * 工具执行服务
 * 负责工具的审批流程和执行管理
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { performanceMonitor, withRetry, withTimeout, isRetryableError } from '@shared/utils'
import { AppError } from '@/shared/errors'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { toolManager, initializeToolProviders } from '../tools'
import { ToolStatus } from '../types'
import type { ToolExecutionResult } from '../tools'
import { LLMToolCall } from '@/renderer/types/electron'
import { truncateToolResult } from '@/renderer/utils/partialJson'
import { isWriteTool } from '@/shared/config/tools'
import { getAgentConfig } from '../utils/AgentConfig'
import { truncateToolResult as compressToolResult } from '../context/MessageTruncator'
import { streamingEditService } from './streamingEditService'
import { pathStartsWith, joinPath } from '@shared/utils/pathUtils'

export interface ToolExecutionContext {
  workspacePath: string | null
  currentAssistantId: string | null
}

export class ToolExecutionService {
  private approvalResolver: ((approved: boolean) => void) | null = null

  /**
   * 执行单个工具调用
   */
  async executeToolCall(
    toolCall: LLMToolCall,
    context: ToolExecutionContext
  ): Promise<{ success: boolean; content: string; rejected?: boolean; meta?: Record<string, unknown> }> {
    const store = useAgentStore.getState()
    const { id, name, arguments: args } = toolCall
    const { workspacePath, currentAssistantId } = context

    // 检查是否需要审批
    // 确保工具提供者已初始化
    initializeToolProviders()
    const approvalType = toolManager.getApprovalType(name)
    const { autoApprove } = useStore.getState()
    // 只有 terminal 和 dangerous 类型需要审批，none 类型不需要
    const needsApproval = approvalType !== 'none' && approvalType in autoApprove && !autoApprove[approvalType as keyof typeof autoApprove]

    // 更新工具状态
    if (currentAssistantId) {
      store.updateToolCall(currentAssistantId, id, {
        status: needsApproval ? 'awaiting' : 'running',
      })
    }

    // 等待用户审批
    if (needsApproval) {
      store.setStreamPhase('tool_pending', { id, name, arguments: args, status: 'awaiting' })
      const approved = await this.waitForApproval()

      if (!approved) {
        if (currentAssistantId) {
          store.updateToolCall(currentAssistantId, id, { status: 'rejected', error: 'Rejected by user' })
        }
        store.addToolResult(id, name, 'Tool call was rejected by the user.', 'rejected', args as Record<string, unknown>)
        return { success: false, content: 'Tool call was rejected by the user.', rejected: true }
      }

      if (currentAssistantId) {
        store.updateToolCall(currentAssistantId, id, { status: 'running' })
      }
    }

    store.setStreamPhase('tool_running', { id, name, arguments: args, status: 'running' })

    // 开始性能监控 - 使用 toolCallId 确保并行调用时 timer 名称唯一
    const timerName = `tool:${name}:${id}`
    performanceMonitor.start(timerName, 'tool', { toolId: id })

    // 记录开始时间
    const startTime = Date.now()
    useStore.getState().addToolCallLog({ type: 'request', toolName: name, data: { name, arguments: args } })

    // 保存文件快照（用于撤销）
    let originalContent: string | null = null
    let fullPath: string | null = null
    let streamingEditId: string | null = null

    if (isWriteTool(name)) {
      const filePath = args.path as string
      if (filePath && workspacePath) {
        fullPath = pathStartsWith(filePath, workspacePath) ? filePath : joinPath(workspacePath, filePath)
        originalContent = await api.file.read(fullPath)
        store.addSnapshotToCurrentCheckpoint(fullPath, originalContent)

        // 启动流式编辑追踪
        streamingEditId = streamingEditService.startEdit(fullPath, originalContent || '')
        logger.agent.debug(`[ToolExecutionService] Started streaming edit for ${fullPath}, editId: ${streamingEditId}`)
      }
    }

    // 执行工具（带重试）
    const result = await this.executeWithRetry(name, args, workspacePath, currentAssistantId)

    // 结束性能监控
    performanceMonitor.end(timerName, result.success)

    // 计算执行时间
    const duration = Date.now() - startTime

    // 记录执行日志
    useStore.getState().addToolCallLog({
      type: 'response',
      toolName: name,
      data: { success: result.success, result: result.result?.slice?.(0, 500), error: result.error },
      duration,
      success: result.success,
      error: result.error,
    })

    // 更新工具状态
    const status: ToolStatus = result.success ? 'success' : 'error'
    if (currentAssistantId) {
      store.updateToolCall(currentAssistantId, id, {
        status,
        result: result.result,
        error: result.error,
        richContent: result.richContent,
        arguments: { ...args, _meta: result.meta },
      })
    }

    // 记录文件变更
    if (result.success && fullPath && isWriteTool(name)) {
      // 完成流式编辑
      if (streamingEditId) {
        const finalContent = result.meta?.newContent as string || ''
        streamingEditService.replaceContent(streamingEditId, finalContent)
        streamingEditService.completeEdit(streamingEditId)
        logger.agent.debug(`[ToolExecutionService] Completed streaming edit for ${fullPath}`)
      }
      
      await this.recordFileChange(store, fullPath, id, name, originalContent, result, workspacePath)
    } else if (streamingEditId) {
      // 工具执行失败，取消流式编辑
      streamingEditService.cancelEdit(streamingEditId)
    }

    // 格式化结果 - 先用智能压缩，再用通用截断
    const config = getAgentConfig()
    const resultContent = result.success ? (result.result || '') : `Error: ${result.error || 'Unknown error'}`
    // 对于读取类工具使用智能压缩，保留头尾信息
    const compressedContent = compressToolResult(resultContent, name)
    // 再用通用截断确保不超过最大长度
    const truncatedContent = truncateToolResult(compressedContent, name, config.maxToolResultChars)
    const resultType = result.success ? 'success' : 'tool_error'
    store.addToolResult(id, name, truncatedContent, resultType, args as Record<string, unknown>)

    return { success: result.success, content: truncatedContent, rejected: false, meta: result.meta }
  }

  /**
   * 带重试的工具执行
   */
  private async executeWithRetry(
    name: string,
    args: Record<string, unknown>,
    workspacePath: string | null,
    currentAssistantId: string | null
  ): Promise<ToolExecutionResult> {
    const config = getAgentConfig()

    try {
      return await withRetry(
        async () => {
          const result = await withTimeout(
            toolManager.execute(name, args, { workspacePath, currentAssistantId }),
            config.toolTimeoutMs,
            new Error(`Tool execution timed out after ${config.toolTimeoutMs / 1000}s`)
          )
          if (!result.success && result.error && isRetryableError(result.error)) {
            throw new Error(result.error)
          }
          return result
        },
        {
          maxRetries: config.maxRetries,
          initialDelayMs: config.retryDelayMs,
          backoffMultiplier: 1.5,
          isRetryable: isRetryableError,
          onRetry: (attempt, error) => {
            logger.agent.info(`[ToolExecutionService] Tool ${name} failed (attempt ${attempt}), retrying...`, error)
          },
        }
      )
    } catch (error) {
      const appError = AppError.fromError(error)
      return { success: false, result: '', error: appError.message }
    }
  }

  /**
   * 记录文件变更
   */
  private async recordFileChange(
    store: ReturnType<typeof useAgentStore.getState>,
    fullPath: string,
    toolCallId: string,
    toolName: string,
    originalContent: string | null,
    result: ToolExecutionResult,
    _workspacePath: string | null
  ): Promise<void> {
    const meta = result.meta as { linesAdded?: number; linesRemoved?: number; newContent?: string; isNewFile?: boolean } | undefined
    
    // 确定变更类型
    const changeType = toolName === 'delete_file_or_folder' ? 'delete' as const
      : (meta?.isNewFile ? 'create' as const : 'modify' as const)
    
    store.addPendingChange({
      filePath: fullPath,
      toolCallId,
      toolName,
      snapshot: { path: fullPath, content: originalContent },
      newContent: meta?.newContent || null,
      changeType,
      linesAdded: meta?.linesAdded || 0,
      linesRemoved: meta?.linesRemoved || 0,
    })
  }

  /**
   * 等待用户审批
   */
  private waitForApproval(): Promise<boolean> {
    return new Promise((resolve) => {
      this.approvalResolver = resolve
    })
  }

  /**
   * 用户批准
   */
  approve(): void {
    if (this.approvalResolver) {
      this.approvalResolver(true)
      this.approvalResolver = null
    }
  }

  /**
   * 用户拒绝
   */
  reject(): void {
    if (this.approvalResolver) {
      this.approvalResolver(false)
      this.approvalResolver = null
    }
  }


}

// 单例导出
export const toolExecutionService = new ToolExecutionService()
