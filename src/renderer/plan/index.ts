/**
 * Plan 模式入口
 * 
 * Plan 模式是一个 Kanban 看板系统：
 * 
 * - 多智能体协同任务管理
 * - 每个卡片可配置独立的 AI 模型
 * - 拖拽式任务状态管理（Planning → In Progress → Completed）
 * - 卡片内嵌对话功能
 */

// 核心引擎
export { PlanEngine } from './core/PlanEngine'
export { PlanValidator } from './core/PlanValidator'
export { WorkflowManager, workflowManager } from './core/WorkflowManager'

// Agent 工具（供 Agent 调用）
export {
  createWorkflowFile,
  updateWorkflowFile,
  listWorkflowFiles,
} from './tools/agentTools'

// Plan 专属工具注册表
export { planToolRegistry } from './tools/registry'
export type {
  PlanTool,
  ToolParameter,
  PlanToolContext,
  ToolResult,
} from './tools/registry'

// 工作流模板
export {
  WORKFLOW_TEMPLATES,
  getTemplate,
  getAllTemplates,
  getTemplatesByCategory,
  getTemplatesByTag,
  searchTemplates,
  applyTemplateParameters,
  validateTemplateParameters,
  featureDevelopmentTemplate,
  bugFixTemplate,
  refactoringTemplate,
  codeReviewTemplate,
} from './templates'

// 类型定义
export type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowConfig,
  WorkflowMetadata,
  WorkflowExecution,
  WorkflowTemplate,
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
