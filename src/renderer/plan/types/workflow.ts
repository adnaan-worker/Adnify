/**
 * 工作流类型定义
 */

// ===== 核心类型 =====

export interface Workflow {
  id: string
  name: string
  description?: string
  version: string
  createdAt: number
  updatedAt: number
  
  // 工作流定义
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  
  // 执行配置
  config: WorkflowConfig
  
  // 执行状态
  execution?: WorkflowExecution
  
  // 元数据
  metadata?: WorkflowMetadata
}

export interface WorkflowMetadata {
  author?: string
  tags?: string[]
  category?: string
  isTemplate?: boolean
  templateId?: string
}

// ===== 节点类型 =====

export interface WorkflowNode {
  id: string
  type: NodeType
  label: string
  description?: string
  
  // 节点配置
  config: NodeConfig
  
  // 位置（用于可视化）
  position?: { x: number; y: number }
  
  // 执行状态
  status?: NodeStatus
  startTime?: number
  endTime?: number
  output?: unknown
  error?: string
  
  // UI 相关
  collapsed?: boolean
}

export type NodeType = 
  | 'start'           // 开始节点
  | 'end'             // 结束节点
  | 'tool'            // 工具调用节点
  | 'ask'             // 用户交互节点
  | 'decision'        // 条件分支节点
  | 'parallel'        // 并行执行节点
  | 'loop'            // 循环节点
  | 'delay'           // 延迟节点
  | 'transform'       // 数据转换节点
  | 'llm'             // LLM 调用节点
  | 'group'           // 节点组（用于组织）

export type NodeStatus = 
  | 'pending'         // 等待执行
  | 'running'         // 执行中
  | 'completed'       // 已完成
  | 'failed'          // 失败
  | 'skipped'         // 跳过
  | 'waiting'         // 等待用户输入
  | 'paused'          // 暂停

// ===== 节点配置 =====

export type NodeConfig = 
  | ToolNodeConfig
  | AskNodeConfig
  | DecisionNodeConfig
  | ParallelNodeConfig
  | LoopNodeConfig
  | DelayNodeConfig
  | TransformNodeConfig
  | LLMNodeConfig
  | GroupNodeConfig
  | BaseNodeConfig  // For start/end nodes

export interface BaseNodeConfig {
  // 重试配置
  retries?: number
  retryDelay?: number
  
  // 超时配置
  timeout?: number
  
  // 错误处理
  continueOnError?: boolean
  
  // 条件执行
  condition?: string
}

export interface ToolNodeConfig extends BaseNodeConfig {
  toolName: string
  arguments: Record<string, unknown>
  
  // 输出映射
  outputMapping?: Record<string, string>
}

export interface AskNodeConfig extends BaseNodeConfig {
  question: string
  type: 'select' | 'multiselect' | 'input' | 'confirm' | 'textarea'
  options?: Array<{ label: string; value: string; description?: string }>
  defaultValue?: unknown
  validation?: {
    required?: boolean
    pattern?: string
    min?: number
    max?: number
  }
  
  // 输出变量名
  outputVariable: string
}

export interface DecisionNodeConfig extends BaseNodeConfig {
  condition: string
  trueNext: string  // 节点 ID
  falseNext: string // 节点 ID
}

export interface ParallelNodeConfig extends BaseNodeConfig {
  tasks: Array<{
    id: string
    label: string
    nodeId: string
  }>
  waitAll: boolean  // true: 等待所有完成, false: 任意一个完成即可
}

export interface LoopNodeConfig extends BaseNodeConfig {
  items: string     // 变量名或表达式
  itemVariable: string
  indexVariable?: string
  maxIterations?: number
  
  // 循环体节点 ID
  bodyNodeId: string
}

export interface DelayNodeConfig extends BaseNodeConfig {
  seconds: number
  message?: string
}

export interface TransformNodeConfig extends BaseNodeConfig {
  input: string     // 输入变量名
  transform: string // JavaScript 表达式
  output: string    // 输出变量名
}

export interface LLMNodeConfig extends BaseNodeConfig {
  prompt: string
  model?: string
  temperature?: number
  maxTokens?: number
  
  // 输出变量名
  outputVariable: string
}

export interface GroupNodeConfig extends BaseNodeConfig {
  childNodes: string[]  // 子节点 ID 列表
}

// ===== 边（连接）=====

export interface WorkflowEdge {
  id: string
  source: string      // 源节点 ID
  target: string      // 目标节点 ID
  
  // 条件（用于分支）
  condition?: string
  label?: string
  
  // UI 相关
  type?: 'default' | 'conditional' | 'error'
}

// ===== 工作流配置 =====

export interface WorkflowConfig {
  // 执行配置
  maxRetries: number
  timeout: number
  continueOnError: boolean
  
  // 变量
  variables: Record<string, unknown>
  
  // 环境
  environment: 'development' | 'production'
  
  // 通知
  notifications?: {
    onComplete?: boolean
    onError?: boolean
  }
}

// ===== 执行状态 =====

export interface WorkflowExecution {
  id: string
  workflowId: string
  status: ExecutionStatus
  startTime: number
  endTime?: number
  
  // 当前执行节点
  currentNodeId?: string
  
  // 执行上下文
  context: ExecutionContext
  
  // 执行历史
  history: ExecutionEvent[]
  
  // 错误信息
  error?: string
}

export type ExecutionStatus = 
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled'

export interface ExecutionContext {
  // 变量存储
  variables: Record<string, unknown>
  
  // 节点输出
  outputs: Record<string, unknown>
  
  // 用户输入
  userInputs: Record<string, unknown>
  
  // 循环上下文
  loops: Record<string, LoopContext>
}

export interface LoopContext {
  items: unknown[]
  currentIndex: number
  currentItem: unknown
}

export interface ExecutionEvent {
  id: string
  timestamp: number
  nodeId: string
  type: ExecutionEventType
  data?: unknown
  error?: string
}

export type ExecutionEventType = 
  | 'node_start'
  | 'node_complete'
  | 'node_error'
  | 'node_skip'
  | 'node_pause'
  | 'node_resume'
  | 'workflow_start'
  | 'workflow_complete'
  | 'workflow_error'
  | 'workflow_pause'
  | 'workflow_resume'
  | 'workflow_cancel'
  | 'user_input'
  | 'variable_set'

// ===== 工作流模板 =====

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  
  // 模板内容
  workflow: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt' | 'execution'>
  
  // 参数定义
  parameters?: Array<{
    name: string
    label: string
    type: 'string' | 'number' | 'boolean' | 'select'
    required: boolean
    defaultValue?: unknown
    options?: Array<{ label: string; value: unknown }>
  }>
  
  // 预览图
  thumbnail?: string
}

// ===== 工具函数类型 =====

export interface WorkflowValidator {
  validate(workflow: Workflow): ValidationResult
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  nodeId?: string
  edgeId?: string
  message: string
  code: string
}

export interface ValidationWarning {
  nodeId?: string
  message: string
}
