/**
 * Plan 专属工具注册表
 * 
 * 职责：
 * - 注册 Plan 专属工具
 * - 工具执行
 * - 工具验证
 */

import { logger } from '@utils/Logger'

// ===== 工具类型定义 =====

export interface PlanTool {
  name: string
  description: string
  category: 'interaction' | 'control' | 'data' | 'workflow' | 'template'
  parameters: Record<string, ToolParameter>
  execute: (args: Record<string, unknown>, context: PlanToolContext) => Promise<ToolResult>
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any'
  description: string
  required: boolean
  default?: unknown
  options?: Array<{ label: string; value: unknown }>
  validation?: {
    min?: number
    max?: number
    pattern?: string
  }
}

export interface PlanToolContext {
  workflowId: string
  executionId: string
  nodeId: string
  variables: Record<string, unknown>
  outputs: Record<string, unknown>
  userInputs: Record<string, unknown>
  workspacePath: string | null
}

export interface ToolResult {
  success: boolean
  output?: unknown
  error?: string
  meta?: Record<string, unknown>
}

// ===== 工具注册表 =====

class PlanToolRegistry {
  private tools: Map<string, PlanTool> = new Map()

  /**
   * 注册工具
   */
  register(tool: PlanTool): void {
    if (this.tools.has(tool.name)) {
      logger.plan.warn('[PlanToolRegistry] Tool already registered:', tool.name)
    }
    this.tools.set(tool.name, tool)
    logger.plan.info('[PlanToolRegistry] Registered tool:', tool.name)
  }

  /**
   * 获取工具
   */
  get(name: string): PlanTool | undefined {
    return this.tools.get(name)
  }

  /**
   * 获取所有工具
   */
  getAll(): PlanTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 按类别获取工具
   */
  getByCategory(category: PlanTool['category']): PlanTool[] {
    return this.getAll().filter(t => t.category === category)
  }

  /**
   * 执行工具
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: PlanToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName)
    
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
      }
    }

    try {
      // 验证参数
      const validation = this.validateArguments(tool, args)
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid arguments: ${validation.errors.join(', ')}`,
        }
      }

      // 执行工具
      logger.plan.info('[PlanToolRegistry] Executing tool:', toolName, args)
      const result = await tool.execute(args, context)
      
      logger.plan.info('[PlanToolRegistry] Tool executed:', toolName, result.success)
      return result
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.plan.error('[PlanToolRegistry] Tool execution failed:', toolName, errorMsg)
      
      return {
        success: false,
        error: errorMsg,
      }
    }
  }

  /**
   * 验证参数
   */
  private validateArguments(
    tool: PlanTool,
    args: Record<string, unknown>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
      const value = args[paramName]

      // 检查必需参数
      if (paramDef.required && (value === undefined || value === null)) {
        errors.push(`Missing required parameter: ${paramName}`)
        continue
      }

      // 跳过可选参数
      if (value === undefined || value === null) {
        continue
      }

      // 类型检查
      const actualType = Array.isArray(value) ? 'array' : typeof value
      if (paramDef.type !== 'any' && actualType !== paramDef.type) {
        errors.push(`Parameter ${paramName} must be ${paramDef.type}, got ${actualType}`)
      }

      // 验证规则
      if (paramDef.validation) {
        const validation = paramDef.validation
        
        if (typeof value === 'number') {
          if (validation.min !== undefined && value < validation.min) {
            errors.push(`Parameter ${paramName} must be >= ${validation.min}`)
          }
          if (validation.max !== undefined && value > validation.max) {
            errors.push(`Parameter ${paramName} must be <= ${validation.max}`)
          }
        }

        if (typeof value === 'string' && validation.pattern) {
          const regex = new RegExp(validation.pattern)
          if (!regex.test(value)) {
            errors.push(`Parameter ${paramName} does not match pattern: ${validation.pattern}`)
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

// 导出单例
export const planToolRegistry = new PlanToolRegistry()

// ===== 注册内置工具 =====

// 交互工具
planToolRegistry.register({
  name: 'ask_user',
  description: '向用户提问并等待回答',
  category: 'interaction',
  parameters: {
    question: {
      type: 'string',
      description: '问题内容',
      required: true,
    },
    type: {
      type: 'string',
      description: '交互类型',
      required: false,
      default: 'input',
      options: [
        { label: '单选', value: 'select' },
        { label: '多选', value: 'multiselect' },
        { label: '输入', value: 'input' },
        { label: '确认', value: 'confirm' },
        { label: '文本域', value: 'textarea' },
      ],
    },
    options: {
      type: 'array',
      description: '选项列表（用于 select/multiselect）',
      required: false,
    },
    defaultValue: {
      type: 'any',
      description: '默认值',
      required: false,
    },
  },
  async execute(args, _context) {
    // 实际实现会暂停工作流并等待用户输入
    return {
      success: true,
      output: null,
      meta: {
        waitingForUser: true,
        question: args.question,
        type: args.type || 'input',
        options: args.options,
      },
    }
  },
})

planToolRegistry.register({
  name: 'ask_approval',
  description: '请求用户批准继续执行',
  category: 'interaction',
  parameters: {
    message: {
      type: 'string',
      description: '批准请求消息',
      required: true,
    },
    details: {
      type: 'string',
      description: '详细信息',
      required: false,
    },
  },
  async execute(args, _context) {
    return {
      success: true,
      output: null,
      meta: {
        waitingForApproval: true,
        message: args.message,
        details: args.details,
      },
    }
  },
})

// 决策工具
planToolRegistry.register({
  name: 'evaluate_condition',
  description: '评估条件表达式',
  category: 'control',
  parameters: {
    expression: {
      type: 'string',
      description: '条件表达式',
      required: true,
    },
  },
  async execute(args, context) {
    try {
      const expression = args.expression as string
      const fn = new Function('context', `with(context) { return ${expression} }`)
      const result = fn({
        variables: context.variables,
        outputs: context.outputs,
        userInputs: context.userInputs,
      })
      
      return {
        success: true,
        output: Boolean(result),
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to evaluate expression: ${error}`,
      }
    }
  },
})

// 流程控制工具
planToolRegistry.register({
  name: 'delay',
  description: '延迟执行',
  category: 'control',
  parameters: {
    seconds: {
      type: 'number',
      description: '延迟秒数',
      required: true,
      validation: { min: 0, max: 3600 },
    },
    message: {
      type: 'string',
      description: '延迟消息',
      required: false,
    },
  },
  async execute(args, _context) {
    const seconds = args.seconds as number
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    
    return {
      success: true,
      output: { delayed: seconds },
    }
  },
})

// 数据工具
planToolRegistry.register({
  name: 'transform_data',
  description: '转换数据格式',
  category: 'data',
  parameters: {
    input: {
      type: 'any',
      description: '输入数据',
      required: true,
    },
    transform: {
      type: 'string',
      description: 'JavaScript 转换表达式',
      required: true,
    },
  },
  async execute(args, context) {
    try {
      const input = args.input
      const transform = args.transform as string
      
      const fn = new Function('input', 'context', `with(context) { return ${transform} }`)
      const output = fn(input, {
        variables: context.variables,
        outputs: context.outputs,
        userInputs: context.userInputs,
      })
      
      return {
        success: true,
        output,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to transform data: ${error}`,
      }
    }
  },
})

planToolRegistry.register({
  name: 'merge_data',
  description: '合并多个数据源',
  category: 'data',
  parameters: {
    sources: {
      type: 'array',
      description: '数据源数组',
      required: true,
    },
    strategy: {
      type: 'string',
      description: '合并策略',
      required: false,
      default: 'merge',
      options: [
        { label: '合并', value: 'merge' },
        { label: '连接', value: 'concat' },
        { label: '覆盖', value: 'override' },
      ],
    },
  },
  async execute(args, _context) {
    const sources = args.sources as unknown[]
    const strategy = (args.strategy as string) || 'merge'
    
    let result: unknown

    switch (strategy) {
      case 'merge':
        result = Object.assign({}, ...sources)
        break
      case 'concat':
        result = sources.flat()
        break
      case 'override':
        result = sources[sources.length - 1]
        break
      default:
        return {
          success: false,
          error: `Unknown strategy: ${strategy}`,
        }
    }

    return {
      success: true,
      output: result,
    }
  },
})

planToolRegistry.register({
  name: 'set_variable',
  description: '设置变量值',
  category: 'data',
  parameters: {
    name: {
      type: 'string',
      description: '变量名',
      required: true,
    },
    value: {
      type: 'any',
      description: '变量值',
      required: true,
    },
  },
  async execute(args, context) {
    const name = args.name as string
    const value = args.value
    
    context.variables[name] = value
    
    return {
      success: true,
      output: { name, value },
    }
  },
})

planToolRegistry.register({
  name: 'get_variable',
  description: '获取变量值',
  category: 'data',
  parameters: {
    name: {
      type: 'string',
      description: '变量名',
      required: true,
    },
  },
  async execute(args, context) {
    const name = args.name as string
    const value = context.variables[name]
    
    if (value === undefined) {
      return {
        success: false,
        error: `Variable not found: ${name}`,
      }
    }
    
    return {
      success: true,
      output: value,
    }
  },
})

logger.plan.info('[PlanToolRegistry] Initialized with', planToolRegistry.getAll().length, 'tools')
