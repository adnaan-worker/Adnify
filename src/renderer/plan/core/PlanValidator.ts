/**
 * 工作流验证器
 * 
 * 职责：
 * - 验证工作流结构
 * - 检查节点配置
 * - 检测循环依赖
 * - 验证变量引用
 */

import { logger } from '@utils/Logger'
import type {
  Workflow,
  WorkflowNode,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '../types/workflow'

export class PlanValidator {
  private workflow: Workflow
  private errors: ValidationError[] = []
  private warnings: ValidationWarning[] = []

  constructor(workflow: Workflow) {
    this.workflow = workflow
  }

  /**
   * 验证工作流
   */
  validate(): ValidationResult {
    this.errors = []
    this.warnings = []

    // 基础验证
    this.validateBasicStructure()
    
    // 节点验证
    this.validateNodes()
    
    // 边验证
    this.validateEdges()
    
    // 拓扑验证
    this.validateTopology()
    
    // 变量验证
    this.validateVariables()
    
    // 配置验证
    this.validateConfig()

    const result: ValidationResult = {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    }

    if (!result.valid) {
      logger.plan.error('[PlanValidator] Validation failed:', result.errors)
    } else if (this.warnings.length > 0) {
      logger.plan.warn('[PlanValidator] Validation warnings:', result.warnings)
    }

    return result
  }

  /**
   * 验证基础结构
   */
  private validateBasicStructure(): void {
    // 检查必需字段
    if (!this.workflow.id) {
      this.errors.push({
        message: 'Workflow must have an id',
        code: 'MISSING_ID',
      })
    }

    if (!this.workflow.name) {
      this.errors.push({
        message: 'Workflow must have a name',
        code: 'MISSING_NAME',
      })
    }

    if (!this.workflow.nodes || this.workflow.nodes.length === 0) {
      this.errors.push({
        message: 'Workflow must have at least one node',
        code: 'NO_NODES',
      })
    }

    // 检查开始节点
    const startNodes = this.workflow.nodes.filter(n => n.type === 'start')
    if (startNodes.length === 0) {
      this.errors.push({
        message: 'Workflow must have a start node',
        code: 'NO_START_NODE',
      })
    } else if (startNodes.length > 1) {
      this.errors.push({
        message: 'Workflow can only have one start node',
        code: 'MULTIPLE_START_NODES',
      })
    }

    // 检查结束节点
    const endNodes = this.workflow.nodes.filter(n => n.type === 'end')
    if (endNodes.length === 0) {
      this.warnings.push({
        message: 'Workflow should have at least one end node',
      })
    }
  }

  /**
   * 验证节点
   */
  private validateNodes(): void {
    const nodeIds = new Set<string>()

    for (const node of this.workflow.nodes) {
      // 检查节点 ID 唯一性
      if (nodeIds.has(node.id)) {
        this.errors.push({
          nodeId: node.id,
          message: `Duplicate node id: ${node.id}`,
          code: 'DUPLICATE_NODE_ID',
        })
      }
      nodeIds.add(node.id)

      // 检查节点标签
      if (!node.label) {
        this.warnings.push({
          nodeId: node.id,
          message: 'Node should have a label',
        })
      }

      // 验证节点配置
      this.validateNodeConfig(node)
    }
  }

  /**
   * 验证节点配置
   */
  private validateNodeConfig(node: WorkflowNode): void {
    switch (node.type) {
      case 'tool':
        this.validateToolNode(node)
        break
      case 'ask':
        this.validateAskNode(node)
        break
      case 'decision':
        this.validateDecisionNode(node)
        break
      case 'parallel':
        this.validateParallelNode(node)
        break
      case 'loop':
        this.validateLoopNode(node)
        break
      case 'delay':
        this.validateDelayNode(node)
        break
      case 'transform':
        this.validateTransformNode(node)
        break
      case 'llm':
        this.validateLLMNode(node)
        break
    }
  }

  /**
   * 验证工具节点
   */
  private validateToolNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.toolName) {
      this.errors.push({
        nodeId: node.id,
        message: 'Tool node must specify toolName',
        code: 'MISSING_TOOL_NAME',
      })
    }

    if (!config.arguments) {
      this.warnings.push({
        nodeId: node.id,
        message: 'Tool node should specify arguments',
      })
    }
  }

  /**
   * 验证交互节点
   */
  private validateAskNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.question) {
      this.errors.push({
        nodeId: node.id,
        message: 'Ask node must have a question',
        code: 'MISSING_QUESTION',
      })
    }

    if (!config.outputVariable) {
      this.errors.push({
        nodeId: node.id,
        message: 'Ask node must specify outputVariable',
        code: 'MISSING_OUTPUT_VARIABLE',
      })
    }

    if (config.type === 'select' || config.type === 'multiselect') {
      if (!config.options || config.options.length === 0) {
        this.errors.push({
          nodeId: node.id,
          message: 'Select/multiselect node must have options',
          code: 'MISSING_OPTIONS',
        })
      }
    }
  }

  /**
   * 验证决策节点
   */
  private validateDecisionNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.condition) {
      this.errors.push({
        nodeId: node.id,
        message: 'Decision node must have a condition',
        code: 'MISSING_CONDITION',
      })
    }

    if (!config.trueNext) {
      this.errors.push({
        nodeId: node.id,
        message: 'Decision node must specify trueNext',
        code: 'MISSING_TRUE_NEXT',
      })
    }

    if (!config.falseNext) {
      this.errors.push({
        nodeId: node.id,
        message: 'Decision node must specify falseNext',
        code: 'MISSING_FALSE_NEXT',
      })
    }

    // 检查目标节点是否存在
    if (config.trueNext && !this.workflow.nodes.find(n => n.id === config.trueNext)) {
      this.errors.push({
        nodeId: node.id,
        message: `trueNext node not found: ${config.trueNext}`,
        code: 'INVALID_TRUE_NEXT',
      })
    }

    if (config.falseNext && !this.workflow.nodes.find(n => n.id === config.falseNext)) {
      this.errors.push({
        nodeId: node.id,
        message: `falseNext node not found: ${config.falseNext}`,
        code: 'INVALID_FALSE_NEXT',
      })
    }
  }

  /**
   * 验证并行节点
   */
  private validateParallelNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.tasks || config.tasks.length === 0) {
      this.errors.push({
        nodeId: node.id,
        message: 'Parallel node must have at least one task',
        code: 'NO_TASKS',
      })
    }

    // 检查任务节点是否存在
    if (config.tasks) {
      for (const task of config.tasks) {
        if (!this.workflow.nodes.find(n => n.id === task.nodeId)) {
          this.errors.push({
            nodeId: node.id,
            message: `Task node not found: ${task.nodeId}`,
            code: 'INVALID_TASK_NODE',
          })
        }
      }
    }
  }

  /**
   * 验证循环节点
   */
  private validateLoopNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.items) {
      this.errors.push({
        nodeId: node.id,
        message: 'Loop node must specify items',
        code: 'MISSING_ITEMS',
      })
    }

    if (!config.itemVariable) {
      this.errors.push({
        nodeId: node.id,
        message: 'Loop node must specify itemVariable',
        code: 'MISSING_ITEM_VARIABLE',
      })
    }

    if (!config.bodyNodeId) {
      this.errors.push({
        nodeId: node.id,
        message: 'Loop node must specify bodyNodeId',
        code: 'MISSING_BODY_NODE',
      })
    }

    // 检查循环体节点是否存在
    if (config.bodyNodeId && !this.workflow.nodes.find(n => n.id === config.bodyNodeId)) {
      this.errors.push({
        nodeId: node.id,
        message: `Loop body node not found: ${config.bodyNodeId}`,
        code: 'INVALID_BODY_NODE',
      })
    }

    // 检查最大迭代次数
    if (config.maxIterations && config.maxIterations < 1) {
      this.errors.push({
        nodeId: node.id,
        message: 'maxIterations must be at least 1',
        code: 'INVALID_MAX_ITERATIONS',
      })
    }
  }

  /**
   * 验证延迟节点
   */
  private validateDelayNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (config.seconds === undefined || config.seconds === null) {
      this.errors.push({
        nodeId: node.id,
        message: 'Delay node must specify seconds',
        code: 'MISSING_SECONDS',
      })
    }

    if (config.seconds < 0) {
      this.errors.push({
        nodeId: node.id,
        message: 'Delay seconds must be non-negative',
        code: 'INVALID_SECONDS',
      })
    }

    if (config.seconds > 3600) {
      this.warnings.push({
        nodeId: node.id,
        message: 'Delay is longer than 1 hour',
      })
    }
  }

  /**
   * 验证转换节点
   */
  private validateTransformNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.input) {
      this.errors.push({
        nodeId: node.id,
        message: 'Transform node must specify input',
        code: 'MISSING_INPUT',
      })
    }

    if (!config.transform) {
      this.errors.push({
        nodeId: node.id,
        message: 'Transform node must specify transform expression',
        code: 'MISSING_TRANSFORM',
      })
    }

    if (!config.output) {
      this.errors.push({
        nodeId: node.id,
        message: 'Transform node must specify output',
        code: 'MISSING_OUTPUT',
      })
    }
  }

  /**
   * 验证 LLM 节点
   */
  private validateLLMNode(node: WorkflowNode): void {
    const config = node.config as any
    
    if (!config.prompt) {
      this.errors.push({
        nodeId: node.id,
        message: 'LLM node must have a prompt',
        code: 'MISSING_PROMPT',
      })
    }

    if (!config.outputVariable) {
      this.errors.push({
        nodeId: node.id,
        message: 'LLM node must specify outputVariable',
        code: 'MISSING_OUTPUT_VARIABLE',
      })
    }
  }

  /**
   * 验证边
   */
  private validateEdges(): void {
    const edgeIds = new Set<string>()

    for (const edge of this.workflow.edges) {
      // 检查边 ID 唯一性
      if (edgeIds.has(edge.id)) {
        this.errors.push({
          edgeId: edge.id,
          message: `Duplicate edge id: ${edge.id}`,
          code: 'DUPLICATE_EDGE_ID',
        })
      }
      edgeIds.add(edge.id)

      // 检查源节点
      if (!this.workflow.nodes.find(n => n.id === edge.source)) {
        this.errors.push({
          edgeId: edge.id,
          message: `Source node not found: ${edge.source}`,
          code: 'INVALID_SOURCE',
        })
      }

      // 检查目标节点
      if (!this.workflow.nodes.find(n => n.id === edge.target)) {
        this.errors.push({
          edgeId: edge.id,
          message: `Target node not found: ${edge.target}`,
          code: 'INVALID_TARGET',
        })
      }

      // 检查自环
      if (edge.source === edge.target) {
        this.warnings.push({
          message: `Edge creates a self-loop: ${edge.id}`,
        })
      }
    }
  }

  /**
   * 验证拓扑结构
   */
  private validateTopology(): void {
    // 检查孤立节点
    this.checkOrphanedNodes()
    
    // 检查循环依赖
    this.checkCycles()
    
    // 检查可达性
    this.checkReachability()
  }

  /**
   * 检查孤立节点
   */
  private checkOrphanedNodes(): void {
    const connectedNodes = new Set<string>()

    for (const edge of this.workflow.edges) {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    }

    for (const node of this.workflow.nodes) {
      if (node.type !== 'start' && node.type !== 'end' && !connectedNodes.has(node.id)) {
        this.warnings.push({
          nodeId: node.id,
          message: `Node is not connected: ${node.label}`,
        })
      }
    }
  }

  /**
   * 检查循环依赖
   */
  private checkCycles(): void {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId)
      recursionStack.add(nodeId)

      const outgoingEdges = this.workflow.edges.filter(e => e.source === nodeId)
      for (const edge of outgoingEdges) {
        if (!visited.has(edge.target)) {
          if (dfs(edge.target)) {
            return true
          }
        } else if (recursionStack.has(edge.target)) {
          this.errors.push({
            message: `Cycle detected involving node: ${edge.target}`,
            code: 'CYCLE_DETECTED',
          })
          return true
        }
      }

      recursionStack.delete(nodeId)
      return false
    }

    const startNode = this.workflow.nodes.find(n => n.type === 'start')
    if (startNode) {
      dfs(startNode.id)
    }
  }

  /**
   * 检查可达性
   */
  private checkReachability(): void {
    const startNode = this.workflow.nodes.find(n => n.type === 'start')
    if (!startNode) return

    const reachable = new Set<string>()
    const queue = [startNode.id]

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (reachable.has(nodeId)) continue

      reachable.add(nodeId)

      const outgoingEdges = this.workflow.edges.filter(e => e.source === nodeId)
      for (const edge of outgoingEdges) {
        queue.push(edge.target)
      }
    }

    for (const node of this.workflow.nodes) {
      if (node.type !== 'start' && !reachable.has(node.id)) {
        this.warnings.push({
          nodeId: node.id,
          message: `Node is unreachable from start: ${node.label}`,
        })
      }
    }
  }

  /**
   * 验证变量
   */
  private validateVariables(): void {
    const definedVariables = new Set<string>(Object.keys(this.workflow.config.variables))

    // 收集所有定义变量的节点
    for (const node of this.workflow.nodes) {
      const config = node.config as any
      
      if (config.outputVariable) {
        definedVariables.add(config.outputVariable)
      }
      
      if (config.output) {
        definedVariables.add(config.output)
      }
      
      if (config.itemVariable) {
        definedVariables.add(config.itemVariable)
      }
      
      if (config.indexVariable) {
        definedVariables.add(config.indexVariable)
      }
    }

    // 检查变量引用
    for (const node of this.workflow.nodes) {
      this.checkVariableReferences(node, definedVariables)
    }
  }

  /**
   * 检查变量引用
   */
  private checkVariableReferences(node: WorkflowNode, definedVariables: Set<string>): void {
    const config = node.config as any

    // 检查条件表达式中的变量
    if (config.condition) {
      this.checkExpressionVariables(node.id, config.condition, definedVariables)
    }

    // 检查输入变量
    if (config.input && typeof config.input === 'string') {
      if (!definedVariables.has(config.input)) {
        this.warnings.push({
          nodeId: node.id,
          message: `Variable not defined: ${config.input}`,
        })
      }
    }

    // 检查 items 变量（循环节点）
    if (config.items && typeof config.items === 'string') {
      if (!definedVariables.has(config.items)) {
        this.warnings.push({
          nodeId: node.id,
          message: `Variable not defined: ${config.items}`,
        })
      }
    }
  }

  /**
   * 检查表达式中的变量
   */
  private checkExpressionVariables(nodeId: string, expression: string, definedVariables: Set<string>): void {
    // 简单的变量提取（匹配 variables.xxx 或 outputs.xxx）
    const variablePattern = /(?:variables|outputs|userInputs)\.(\w+)/g
    let match

    while ((match = variablePattern.exec(expression)) !== null) {
      const varName = match[1]
      if (!definedVariables.has(varName)) {
        this.warnings.push({
          nodeId,
          message: `Variable referenced in expression may not be defined: ${varName}`,
        })
      }
    }
  }

  /**
   * 验证配置
   */
  private validateConfig(): void {
    const config = this.workflow.config

    if (config.maxRetries < 0) {
      this.errors.push({
        message: 'maxRetries must be non-negative',
        code: 'INVALID_MAX_RETRIES',
      })
    }

    if (config.timeout < 0) {
      this.errors.push({
        message: 'timeout must be non-negative',
        code: 'INVALID_TIMEOUT',
      })
    }

    if (config.maxRetries > 10) {
      this.warnings.push({
        message: 'maxRetries is very high (>10)',
      })
    }
  }
}
