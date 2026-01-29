/**
 * 工具管理器
 * 统一管理多个工具提供者，提供统一的工具访问接口
 */

import { logger } from '@utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import type { ToolProvider, ToolMeta } from './types'
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolApprovalType,
} from '@/shared/types'

class ToolManager {
  private providers = new Map<string, ToolProvider>()
  private providerOrder: string[] = []

  /**
   * 注册工具提供者
   * @param provider 工具提供者
   * @param priority 优先级（数字越小优先级越高）
   */
  registerProvider(provider: ToolProvider, priority = 100): void {
    if (this.providers.has(provider.id)) {
      logger.agent.warn(`[ToolManager] Provider ${provider.id} already registered, replacing`)
    }

    this.providers.set(provider.id, provider)
    
    // 按优先级排序
    this.providerOrder = Array.from(this.providers.keys()).sort((a, b) => {
      const priorityA = a === 'builtin' ? 0 : priority
      const priorityB = b === 'builtin' ? 0 : priority
      return priorityA - priorityB
    })

    logger.agent.info(`[ToolManager] Registered provider: ${provider.id} (${provider.name})`)
  }

  /**
   * 移除工具提供者
   */
  unregisterProvider(providerId: string): boolean {
    const removed = this.providers.delete(providerId)
    if (removed) {
      this.providerOrder = this.providerOrder.filter(id => id !== providerId)
      logger.agent.info(`[ToolManager] Unregistered provider: ${providerId}`)
    }
    return removed
  }

  /**
   * 获取工具提供者
   */
  getProvider(providerId: string): ToolProvider | undefined {
    return this.providers.get(providerId)
  }

  /**
   * 查找工具所属的提供者
   */
  findProviderForTool(toolName: string): ToolProvider | undefined {
    for (const providerId of this.providerOrder) {
      const provider = this.providers.get(providerId)
      if (provider?.hasTool(toolName)) {
        return provider
      }
    }
    return undefined
  }

  /**
   * 检查工具是否存在
   */
  hasTool(toolName: string): boolean {
    return this.findProviderForTool(toolName) !== undefined
  }

  /**
   * 获取所有工具定义
   */
  getAllToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = []
    const seenNames = new Set<string>()

    for (const providerId of this.providerOrder) {
      const provider = this.providers.get(providerId)
      if (!provider) continue

      for (const def of provider.getToolDefinitions()) {
        if (!seenNames.has(def.name)) {
          definitions.push(def)
          seenNames.add(def.name)
        }
      }
    }

    return definitions
  }

  /**
   * 获取工具元信息
   */
  getToolMeta(toolName: string): ToolMeta | undefined {
    const provider = this.findProviderForTool(toolName)
    if (!provider) return undefined

    const definitions = provider.getToolDefinitions()
    const definition = definitions.find(d => d.name === toolName)
    if (!definition) return undefined

    return {
      name: toolName,
      providerId: provider.id,
      providerName: provider.name,
      definition,
      approvalType: provider.getApprovalType(toolName),
    }
  }

  /**
   * 获取工具审批类型
   */
  getApprovalType(toolName: string): ToolApprovalType {
    const provider = this.findProviderForTool(toolName)
    return provider?.getApprovalType(toolName) || 'dangerous'
  }

  /**
   * 验证工具参数
   */
  validateArgs(toolName: string, args: unknown): { valid: boolean; error?: string } {
    const provider = this.findProviderForTool(toolName)
    if (!provider) {
      return { valid: false, error: `Unknown tool: ${toolName}` }
    }
    return provider.validateArgs(toolName, args)
  }

  /**
   * 执行工具
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const provider = this.findProviderForTool(toolName)
    if (!provider) {
      return {
        success: false,
        result: '',
        error: `Unknown tool: ${toolName}`,
      }
    }

    // 验证参数
    const validation = provider.validateArgs(toolName, args)
    if (!validation.valid) {
      return {
        success: false,
        result: '',
        error: `Validation failed: ${validation.error}`,
      }
    }

    // 执行
    try {
      return await provider.execute(toolName, args, context)
    } catch (err) {
      logger.agent.error(`[ToolManager] Tool execution failed:`, err)
      return {
        success: false,
        result: '',
        error: `Execution error: ${toAppError(err).message}`,
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    providers: number
    totalTools: number
    byProvider: Record<string, number>
  } {
    const byProvider: Record<string, number> = {}
    let totalTools = 0

    for (const [id, provider] of this.providers) {
      const count = provider.getToolDefinitions().length
      byProvider[id] = count
      totalTools += count
    }

    return {
      providers: this.providers.size,
      totalTools,
      byProvider,
    }
  }
}

/** 工具管理器单例 */
export const toolManager = new ToolManager()
