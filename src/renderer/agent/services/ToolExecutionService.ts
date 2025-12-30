/**
 * 工具执行服务
 * 负责工具的审批流程和执行管理
 * 从 AgentService 拆分出来，专注于工具执行职责
 */

import { logger } from '@utils/Logger'
import { performanceMonitor } from '@shared/utils/PerformanceMonitor'
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@store'
import { toolRegistry, getToolApprovalType } from '../tools'
import { ToolStatus } from '../types'
import type { ToolExecutionResult } from '../tools'
import { LLMToolCall } from '@/renderer/types/electron'
import { truncateToolResult } from '@/renderer/utils/partialJson'
import { isWriteTool } from '@/shared/config/tools'
import { getAgentConfig } from '../utils/AgentConfig'
import { compressToolResult } from '../utils/ContextCompressor'
import { streamingEditService } from './streamingEditService'

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
    const approvalType = getToolApprovalType(name)
    const { autoApprove } = useStore.getState()
    // 只有 terminal 和 dangerous 类型需要审批，none 类型不需要
    const needsApproval = approvalType !== 'none' && !(autoApprove as any)[approvalType]

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

    // 开始性能监控
    performanceMonitor.start(`tool:${name}`, 'tool', { toolId: id })

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
        fullPath = filePath.startsWith(workspacePath) ? filePath : `${workspacePath}/${filePath}`
        originalContent = await window.electronAPI.readFile(fullPath)
        store.addSnapshotToCurrentCheckpoint(fullPath, originalContent)
        
        // 启动流式编辑追踪
        streamingEditId = streamingEditService.startEdit(fullPath, originalContent || '')
        logger.agent.debug(`[ToolExecutionService] Started streaming edit for ${fullPath}, editId: ${streamingEditId}`)
      }
    }

    // 执行工具（带重试）
    const result = await this.executeWithRetry(name, args, workspacePath)

    // 结束性能监控
    performanceMonitor.end(`tool:${name}`, result.success)

    // 记录执行日志
    useStore.getState().addToolCallLog({
      type: 'response',
      toolName: name,
      data: { success: result.success, result: result.result?.slice?.(0, 500), error: result.error },
      duration: Date.now() - startTime
    })

    // 更新工具状态
    const status: ToolStatus = result.success ? 'success' : 'error'
    if (currentAssistantId) {
      store.updateToolCall(currentAssistantId, id, {
        status,
        result: result.result,
        error: result.error,
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
    workspacePath: string | null
  ): Promise<ToolExecutionResult> {
    const config = getAgentConfig()
    const timeoutMs = config.toolTimeoutMs
    const maxRetries = config.maxRetries
    const retryDelayMs = config.retryDelayMs

    const executeWithTimeout = () => Promise.race([
      toolRegistry.execute(name, args, { workspacePath }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
      )
    ])

    let result: ToolExecutionResult | undefined
    let lastError: string = ''

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await executeWithTimeout()
        if (result.success) break
        lastError = result.error || 'Unknown error'

        if (attempt < maxRetries && this.isRetryableError(lastError)) {
          logger.agent.info(`[ToolExecutionService] Tool ${name} failed (attempt ${attempt}/${maxRetries}), retrying...`)
          await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt))
        } else {
          break
        }
      } catch (error: any) {
        lastError = error.message
        if (attempt < maxRetries && this.isRetryableError(lastError)) {
          logger.agent.info(`[ToolExecutionService] Tool ${name} error (attempt ${attempt}/${maxRetries}): ${lastError}, retrying...`)
          await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt))
        } else {
          result = { success: false, result: '', error: lastError }
          break
        }
      }
    }

    return result ?? { success: false, result: '', error: lastError || 'Tool execution failed' }
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      'timeout',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'network',
      'temporarily unavailable'
    ]
    const lowerError = error.toLowerCase()
    return retryablePatterns.some(pattern => lowerError.includes(pattern.toLowerCase()))
  }

  /**
   * 记录文件变更到 Composer
   */
  private async recordFileChange(
    store: ReturnType<typeof useAgentStore.getState>,
    fullPath: string,
    toolCallId: string,
    toolName: string,
    originalContent: string | null,
    result: ToolExecutionResult,
    workspacePath: string | null
  ): Promise<void> {
    const meta = result.meta as { linesAdded?: number; linesRemoved?: number; newContent?: string; isNewFile?: boolean } | undefined
    
    store.addPendingChange({
      filePath: fullPath,
      toolCallId,
      toolName,
      snapshot: { path: fullPath, content: originalContent },
      linesAdded: meta?.linesAdded || 0,
      linesRemoved: meta?.linesRemoved || 0,
    })

    try {
      const { composerService } = await import('./composerService')
      const relativePath = workspacePath ? fullPath.replace(workspacePath, '').replace(/^[\\/]/, '') : fullPath
      composerService.addChange({
        filePath: fullPath,
        relativePath,
        oldContent: originalContent,
        newContent: meta?.newContent || null,
        changeType: toolName === 'delete_file_or_folder' ? 'delete' : (meta?.isNewFile ? 'create' : 'modify'),
        linesAdded: meta?.linesAdded || 0,
        linesRemoved: meta?.linesRemoved || 0,
        toolCallId,
      })
    } catch (e) {
      logger.agent.warn('[ToolExecutionService] Failed to add to composer:', e)
    }
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
