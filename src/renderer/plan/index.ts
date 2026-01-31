/**
 * Plan 模式入口
 * 
 * 工作流系统 - 文件形式
 */

// 核心
export { PlanEngine } from './core/PlanEngine'
export { PlanValidator } from './core/PlanValidator'

// 类型
export type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowExecution,
  WorkflowTemplate,
  WorkflowConfig,
  ExecutionContext,
  ExecutionEvent,
  NodeType,
  NodeStatus,
  ExecutionStatus,
  NodeConfig,
  ToolNodeConfig,
  AskNodeConfig,
  DecisionNodeConfig,
  ParallelNodeConfig,
  LoopNodeConfig,
  DelayNodeConfig,
  TransformNodeConfig,
  LLMNodeConfig,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types/workflow'

// 工具
export { planToolRegistry } from './tools/registry'
export type {
  PlanTool,
  ToolParameter,
  PlanToolContext,
  ToolResult,
} from './tools/registry'

// Agent 工具
export {
  createWorkflowFile,
  updateWorkflowFile,
  listWorkflowFiles,
} from './tools/agentTools'

// 模板
export {
  WORKFLOW_TEMPLATES,
  getTemplate,
  getAllTemplates,
  getTemplatesByCategory,
  getTemplatesByTag,
  featureDevelopmentTemplate,
  bugFixTemplate,
  codeReviewTemplate,
  refactoringTemplate,
} from './templates'
