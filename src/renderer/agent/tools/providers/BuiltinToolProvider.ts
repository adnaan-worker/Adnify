/**
 * 内置工具提供者
 * 
 * 职责：
 * - 包装 toolRegistry，提供统一的 ToolProvider 接口
 * - 根据 ToolLoadingContext 过滤可用工具
 */

import { toolRegistry } from '../registry'
import type { ToolProvider } from './types'
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolApprovalType,
} from '@/shared/types'
import { type ToolLoadingContext, getToolsForContext } from '@/shared/config/toolGroups'

export class BuiltinToolProvider implements ToolProvider {
  readonly id = 'builtin'
  readonly name = 'Built-in Tools'

  private context: ToolLoadingContext = { mode: 'agent' }

  /**
   * 设置工具加载上下文
   */
  setContext(context: ToolLoadingContext): void {
    this.context = context
  }

  /**
   * 获取当前上下文
   */
  getContext(): ToolLoadingContext {
    return this.context
  }

  hasTool(toolName: string): boolean {
    if (toolName.startsWith('mcp_')) return false
    return toolRegistry.has(toolName)
  }

  getToolDefinitions(): ToolDefinition[] {
    const allowedTools = getToolsForContext(this.context)
    return toolRegistry
      .getAll()
      .filter(tool => allowedTools.includes(tool.name))
      .map(tool => tool.definition)
  }

  getApprovalType(toolName: string): ToolApprovalType {
    return toolRegistry.getApprovalType(toolName)
  }

  validateArgs(toolName: string, args: unknown): { valid: boolean; error?: string } {
    const result = toolRegistry.validate(toolName, args)
    return { valid: result.success, error: result.error }
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    return toolRegistry.execute(toolName, args, context)
  }
}

export const builtinToolProvider = new BuiltinToolProvider()
