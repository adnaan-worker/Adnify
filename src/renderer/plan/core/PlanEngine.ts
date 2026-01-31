/**
 * Plan 工作流引擎
 * 
 * 职责：
 * - 工作流执行调度
 * - 节点状态管理
 * - 事件发布
 * - 错误处理
 */

import { logger } from '@utils/Logger'
import type {
  Workflow,
  WorkflowNode,
  WorkflowExecution,
  ExecutionEvent,
  NodeStatus,
  ExecutionStatus,
} from '../types/workflow'

export class PlanEngine {
  private workflow: Workflow
  private execution: WorkflowExecution | null = null
  private abortController: AbortController | null = null
  private eventListeners: Map<string, Set<(event: ExecutionEvent) => void>> = new Map()

  constructor(workflow: Workflow) {
    this.workflow = workflow
  }

  // ===== 执行控制 =====

  /**
   * 开始执行工作流
   */
  async start(initialVariables?: Record<string, unknown>): Promise<void> {
    if (this.execution && this.execution.status === 'running') {
      throw new Error('Workflow is already running')
    }

    // 创建执行上下文
    this.execution = {
      id: crypto.randomUUID(),
      workflowId: this.workflow.id,
      status: 'running',
      startTime: Date.now(),
      context: {
        variables: { ...this.workflow.config.variables, ...initialVariables },
        outputs: {},
        userInputs: {},
        loops: {},
      },
      history: [],
    }

    this.abortController = new AbortController()

    // 发布开始事件
    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId: '',
      type: 'workflow_start',
    })

    try {
      // 找到开始节点
      const startNode = this.workflow.nodes.find(n => n.type === 'start')
      if (!startNode) {
        throw new Error('No start node found')
      }

      // 执行工作流
      await this.executeNode(startNode.id)

      // 完成
      this.execution.status = 'completed'
      this.execution.endTime = Date.now()

      this.emitEvent({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        nodeId: '',
        type: 'workflow_complete',
      })

      logger.plan.info('[PlanEngine] Workflow completed:', this.workflow.id)
    } catch (error) {
      this.execution.status = 'failed'
      this.execution.endTime = Date.now()
      this.execution.error = error instanceof Error ? error.message : String(error)

      this.emitEvent({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        nodeId: '',
        type: 'workflow_error',
        error: this.execution.error,
      })

      logger.plan.error('[PlanEngine] Workflow failed:', error)
      throw error
    }
  }

  /**
   * 暂停执行
   */
  pause(): void {
    if (!this.execution || this.execution.status !== 'running') {
      return
    }

    this.execution.status = 'paused'
    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId: this.execution.currentNodeId || '',
      type: 'workflow_pause',
    })

    logger.plan.info('[PlanEngine] Workflow paused')
  }

  /**
   * 恢复执行
   */
  async resume(): Promise<void> {
    if (!this.execution || this.execution.status !== 'paused') {
      return
    }

    this.execution.status = 'running'
    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId: this.execution.currentNodeId || '',
      type: 'workflow_resume',
    })

    logger.plan.info('[PlanEngine] Workflow resumed')

    // 继续执行当前节点
    if (this.execution.currentNodeId) {
      await this.executeNode(this.execution.currentNodeId)
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    if (!this.execution) {
      return
    }

    this.execution.status = 'cancelled'
    this.execution.endTime = Date.now()
    this.abortController?.abort()

    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId: this.execution.currentNodeId || '',
      type: 'workflow_cancel',
    })

    logger.plan.info('[PlanEngine] Workflow cancelled')
  }

  // ===== 节点执行 =====

  /**
   * 执行单个节点
   */
  private async executeNode(nodeId: string): Promise<void> {
    if (!this.execution) {
      throw new Error('No execution context')
    }

    // 检查是否被取消
    if (this.abortController?.signal.aborted) {
      throw new Error('Workflow cancelled')
    }

    // 检查是否暂停
    if (this.execution.status === 'paused') {
      return
    }

    const node = this.workflow.nodes.find(n => n.id === nodeId)
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`)
    }

    // 更新当前节点
    this.execution.currentNodeId = nodeId

    // 检查条件
    if (node.config.condition) {
      const shouldExecute = this.evaluateCondition(node.config.condition)
      if (!shouldExecute) {
        this.updateNodeStatus(nodeId, 'skipped')
        this.emitEvent({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          nodeId,
          type: 'node_skip',
        })
        
        // 执行下一个节点
        await this.executeNextNodes(nodeId)
        return
      }
    }

    // 开始执行
    this.updateNodeStatus(nodeId, 'running')
    node.startTime = Date.now()

    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId,
      type: 'node_start',
    })

    try {
      // 根据节点类型执行
      const output = await this.executeNodeByType(node)

      // 保存输出
      this.execution.context.outputs[nodeId] = output
      node.output = output

      // 完成
      this.updateNodeStatus(nodeId, 'completed')
      node.endTime = Date.now()

      this.emitEvent({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        nodeId,
        type: 'node_complete',
        data: output,
      })

      // 执行下一个节点
      await this.executeNextNodes(nodeId)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      
      this.updateNodeStatus(nodeId, 'failed')
      node.endTime = Date.now()
      node.error = errorMsg

      this.emitEvent({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        nodeId,
        type: 'node_error',
        error: errorMsg,
      })

      // 检查是否继续执行
      if (!node.config.continueOnError && !this.workflow.config.continueOnError) {
        throw error
      }

      logger.plan.warn('[PlanEngine] Node failed but continuing:', nodeId, errorMsg)
      
      // 继续执行下一个节点
      await this.executeNextNodes(nodeId)
    }
  }

  /**
   * 根据节点类型执行
   */
  private async executeNodeByType(node: WorkflowNode): Promise<unknown> {
    switch (node.type) {
      case 'start':
      case 'end':
        return null

      case 'tool':
        return this.executeToolNode(node)

      case 'ask':
        return this.executeAskNode(node)

      case 'decision':
        return this.executeDecisionNode(node)

      case 'parallel':
        return this.executeParallelNode(node)

      case 'loop':
        return this.executeLoopNode(node)

      case 'delay':
        return this.executeDelayNode(node)

      case 'transform':
        return this.executeTransformNode(node)

      case 'llm':
        return this.executeLLMNode(node)

      default:
        throw new Error(`Unknown node type: ${node.type}`)
    }
  }

  /**
   * 执行工具节点
   */
  private async executeToolNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    const toolName = config.toolName
    const args = config.arguments || {}

    logger.plan.info('[PlanEngine] Executing tool node:', node.id, toolName)

    try {
      // 动态导入 Agent 工具注册表
      const { toolRegistry } = await import('@/renderer/agent/tools/registry')

      // 构建执行上下文
      const context = {
        workspacePath: null, // TODO: 从工作流配置获取
        mode: 'agent' as const,
      }

      // 执行工具
      const result = await toolRegistry.execute(toolName, args, context)

      if (!result.success) {
        throw new Error(result.error || 'Tool execution failed')
      }

      return {
        success: true,
        result: result.result,
        toolName,
      }
    } catch (error) {
      logger.plan.error('[PlanEngine] Tool execution failed:', error)
      throw error
    }
  }

  /**
   * 执行交互节点
   */
  private async executeAskNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    
    logger.plan.info('[PlanEngine] Executing ask node:', node.id)
    
    // 暂停工作流等待用户输入
    this.updateNodeStatus(node.id, 'waiting')
    this.pause()

    // 发布用户输入事件
    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId: node.id,
      type: 'user_input',
      data: {
        question: config.question,
        type: config.type || 'input',
        options: config.options,
        defaultValue: config.defaultValue,
      },
    })

    // 返回 null，等待用户输入后恢复
    return null
  }

  /**
   * 执行决策节点
   */
  private async executeDecisionNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    
    logger.plan.info('[PlanEngine] Executing decision node:', node.id)

    // 评估条件
    const result = this.evaluateCondition(config.condition)

    // 根据结果选择下一个节点
    const nextNodeId = result ? config.trueNext : config.falseNext

    logger.plan.info('[PlanEngine] Decision result:', result, 'next:', nextNodeId)

    return {
      decision: result,
      nextNodeId,
    }
  }

  /**
   * 执行并行节点
   */
  private async executeParallelNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    
    logger.plan.info('[PlanEngine] Executing parallel node:', node.id)

    const tasks = config.tasks || []
    const waitAll = config.waitAll !== false

    // 并行执行所有任务
    const promises = tasks.map(async (task: any) => {
      try {
        await this.executeNode(task.nodeId)
        return { taskId: task.id, success: true }
      } catch (error) {
        return {
          taskId: task.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    if (waitAll) {
      // 等待所有任务完成
      const results = await Promise.all(promises)
      return { results }
    } else {
      // 等待任意一个完成
      const result = await Promise.race(promises)
      return { result }
    }
  }

  /**
   * 执行循环节点
   */
  private async executeLoopNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    
    logger.plan.info('[PlanEngine] Executing loop node:', node.id)

    if (!this.execution) {
      throw new Error('No execution context')
    }

    // 获取循环项
    const itemsVar = config.items
    const items = this.execution.context.variables[itemsVar] || []
    
    if (!Array.isArray(items)) {
      throw new Error(`Loop items must be an array: ${itemsVar}`)
    }

    const maxIterations = config.maxIterations || items.length
    const iterations = Math.min(items.length, maxIterations)

    // 创建循环上下文
    this.execution.context.loops[node.id] = {
      items,
      currentIndex: 0,
      currentItem: items[0],
    }

    const results = []

    // 执行循环
    for (let i = 0; i < iterations; i++) {
      // 检查是否被取消
      if (this.abortController?.signal.aborted) {
        break
      }

      // 更新循环上下文
      this.execution.context.loops[node.id].currentIndex = i
      this.execution.context.loops[node.id].currentItem = items[i]

      // 设置循环变量
      this.execution.context.variables[config.itemVariable] = items[i]
      if (config.indexVariable) {
        this.execution.context.variables[config.indexVariable] = i
      }

      // 执行循环体
      try {
        await this.executeNode(config.bodyNodeId)
        results.push({ index: i, success: true })
      } catch (error) {
        results.push({
          index: i,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })

        // 如果不继续执行，则中断循环
        if (!node.config.continueOnError) {
          break
        }
      }
    }

    // 清理循环上下文
    delete this.execution.context.loops[node.id]

    return { iterations, results }
  }

  /**
   * 执行延迟节点
   */
  private async executeDelayNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    const seconds = config.seconds || 1
    
    logger.plan.info('[PlanEngine] Delaying for', seconds, 'seconds')
    
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    
    return { delayed: seconds }
  }

  /**
   * 执行转换节点
   */
  private async executeTransformNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    
    logger.plan.info('[PlanEngine] Executing transform node:', node.id)

    if (!this.execution) {
      throw new Error('No execution context')
    }

    // 获取输入数据
    const inputVar = config.input
    const input = this.execution.context.variables[inputVar]

    // 执行转换
    try {
      const transform = config.transform
      const fn = new Function('input', 'context', `with(context) { return ${transform} }`)
      const output = fn(input, {
        variables: this.execution.context.variables,
        outputs: this.execution.context.outputs,
        userInputs: this.execution.context.userInputs,
      })

      // 保存输出
      if (config.output) {
        this.execution.context.variables[config.output] = output
      }

      return output
    } catch (error) {
      logger.plan.error('[PlanEngine] Transform failed:', error)
      throw new Error(`Transform failed: ${error}`)
    }
  }

  /**
   * 执行 LLM 节点
   */
  private async executeLLMNode(node: WorkflowNode): Promise<unknown> {
    const config = node.config as any
    
    logger.plan.info('[PlanEngine] Executing LLM node:', node.id)

    if (!this.execution) {
      throw new Error('No execution context')
    }

    try {
      // 构建提示词（支持变量替换）
      let prompt = config.prompt
      const variables = this.execution.context.variables
      
      // 简单的变量替换 ${variables.xxx}
      prompt = prompt.replace(/\$\{variables\.(\w+)\}/g, (_: string, key: string) => {
        return String(variables[key] || '')
      })

      // TODO: 实现完整的 LLM 调用流程
      // 这里需要集成 Agent 的 LLM 服务
      logger.plan.warn('[PlanEngine] LLM node execution not fully implemented yet')

      const response = `[LLM Response for: ${prompt.slice(0, 50)}...]`

      // 保存输出
      if (config.outputVariable) {
        this.execution.context.variables[config.outputVariable] = response
      }

      return { response }
    } catch (error) {
      logger.plan.error('[PlanEngine] LLM execution failed:', error)
      throw error
    }
  }

  /**
   * 执行下一个节点
   */
  private async executeNextNodes(currentNodeId: string): Promise<void> {
    // 找到所有出边
    const outgoingEdges = this.workflow.edges.filter(e => e.source === currentNodeId)

    if (outgoingEdges.length === 0) {
      // 没有下一个节点，检查是否是结束节点
      const currentNode = this.workflow.nodes.find(n => n.id === currentNodeId)
      if (currentNode?.type === 'end') {
        return
      }
      
      logger.plan.warn('[PlanEngine] No outgoing edges from node:', currentNodeId)
      return
    }

    // 执行所有满足条件的下一个节点
    for (const edge of outgoingEdges) {
      // 检查边的条件
      if (edge.condition) {
        const shouldFollow = this.evaluateCondition(edge.condition)
        if (!shouldFollow) {
          continue
        }
      }

      await this.executeNode(edge.target)
    }
  }

  // ===== 辅助方法 =====

  /**
   * 更新节点状态
   */
  private updateNodeStatus(nodeId: string, status: NodeStatus): void {
    const node = this.workflow.nodes.find(n => n.id === nodeId)
    if (node) {
      node.status = status
    }
  }

  /**
   * 评估条件表达式
   */
  private evaluateCondition(condition: string): boolean {
    if (!this.execution) {
      return false
    }

    try {
      // 创建安全的执行上下文
      const context = {
        variables: this.execution.context.variables,
        outputs: this.execution.context.outputs,
        userInputs: this.execution.context.userInputs,
      }

      // 使用 Function 构造器评估表达式
      const fn = new Function('context', `with(context) { return ${condition} }`)
      return Boolean(fn(context))
    } catch (error) {
      logger.plan.error('[PlanEngine] Failed to evaluate condition:', condition, error)
      return false
    }
  }

  /**
   * 设置变量
   */
  setVariable(name: string, value: unknown): void {
    if (!this.execution) {
      throw new Error('No execution context')
    }

    this.execution.context.variables[name] = value

    this.emitEvent({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      nodeId: this.execution.currentNodeId || '',
      type: 'variable_set',
      data: { name, value },
    })
  }

  /**
   * 获取变量
   */
  getVariable(name: string): unknown {
    return this.execution?.context.variables[name]
  }

  // ===== 事件系统 =====

  /**
   * 监听事件
   */
  on(eventType: string, listener: (event: ExecutionEvent) => void): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set())
    }

    this.eventListeners.get(eventType)!.add(listener)

    // 返回取消监听函数
    return () => {
      this.eventListeners.get(eventType)?.delete(listener)
    }
  }

  /**
   * 发布事件
   */
  private emitEvent(event: ExecutionEvent): void {
    // 添加到历史
    this.execution?.history.push(event)

    // 通知监听器
    const listeners = this.eventListeners.get(event.type)
    if (listeners) {
      listeners.forEach(listener => listener(event))
    }

    // 通知所有事件监听器
    const allListeners = this.eventListeners.get('*')
    if (allListeners) {
      allListeners.forEach(listener => listener(event))
    }
  }

  // ===== Getter =====

  getWorkflow(): Workflow {
    return this.workflow
  }

  getExecution(): WorkflowExecution | null {
    return this.execution
  }

  getStatus(): ExecutionStatus {
    return this.execution?.status || 'idle'
  }
}
