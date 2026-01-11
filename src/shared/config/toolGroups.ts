/**
 * 工具分组与按需加载
 * 
 * 架构设计：
 * - 工具组：按功能分组的工具集合
 * - 模式工具：不同工作模式（code/plan/chat）加载不同工具
 * - 角色工具：不同角色（模板）可以扩展额外工具
 * 
 * 加载规则：
 * - chat 模式：无工具
 * - code 模式：core 工具组
 * - plan 模式：core + plan 工具组
 * - 角色扩展：在模式基础上添加角色专属工具组
 */

// ============================================
// 类型定义
// ============================================

/** 工作模式 */
export type WorkMode = 'code' | 'plan' | 'chat'

/** 工具组配置 */
export interface ToolGroupConfig {
  id: string
  name: string
  tools: string[]
}

/** 工具加载上下文 */
export interface ToolLoadingContext {
  /** 工作模式 */
  mode: WorkMode
  /** 角色模板 ID（可选） */
  templateId?: string
}

/** 角色工具配置 */
export interface TemplateToolConfig {
  /** 角色需要的额外工具组 */
  toolGroups: string[]
}

// ============================================
// 工具组定义
// ============================================

/** 核心工具 - code/plan 模式共用 */
const CORE_TOOLS: string[] = [
  // 文件读取
  'read_file',
  'list_directory',
  'get_dir_tree',
  'search_files',
  'search_in_file',
  'read_multiple_files',
  // 文件编辑
  'edit_file',
  'write_file',
  'replace_file_content',
  'create_file_or_folder',
  'delete_file_or_folder',
  // 终端
  'run_command',
  'get_lint_errors',
  // 代码智能
  'find_references',
  'go_to_definition',
  'get_hover_info',
  'get_document_symbols',
  // 搜索
  'codebase_search',
  // 网络
  'web_search',
  'read_url',
]

/** 计划工具 - plan 模式专用 */
const PLAN_TOOLS: string[] = [
  'create_plan',
  'update_plan',
  'ask_user',
]

/** UI/UX 工具 - uiux-designer 角色专用 */
const UIUX_TOOLS: string[] = [
  'uiux_search',
  'uiux_recommend',
]

/** 工具组注册表 */
const TOOL_GROUPS: Record<string, string[]> = {
  core: CORE_TOOLS,
  plan: PLAN_TOOLS,
  uiux: UIUX_TOOLS,
}

/** 角色工具配置注册表 */
const TEMPLATE_TOOLS: Record<string, TemplateToolConfig> = {
  'uiux-designer': { toolGroups: ['uiux'] },
}

// ============================================
// 工具组管理
// ============================================

/**
 * 注册工具组
 */
export function registerToolGroup(id: string, tools: string[]): void {
  TOOL_GROUPS[id] = tools
}

/**
 * 注册角色工具配置
 */
export function registerTemplateTools(templateId: string, config: TemplateToolConfig): void {
  TEMPLATE_TOOLS[templateId] = config
}

/**
 * 获取工具组
 */
export function getToolGroup(id: string): string[] | undefined {
  return TOOL_GROUPS[id]
}

// ============================================
// 工具加载
// ============================================

/**
 * 根据上下文获取工具列表
 * 
 * 加载规则：
 * - chat: 空（无工具）
 * - code: core
 * - plan: core + plan
 * - 角色: 在模式基础上 + 角色专属工具组
 */
export function getToolsForContext(context: ToolLoadingContext): string[] {
  // chat 模式无工具
  if (context.mode === 'chat') {
    return []
  }

  // 收集工具（使用 Set 去重）
  const tools = new Set<string>()

  // 1. 添加 core 工具
  for (const tool of CORE_TOOLS) {
    tools.add(tool)
  }

  // 2. plan 模式添加 plan 工具
  if (context.mode === 'plan') {
    for (const tool of PLAN_TOOLS) {
      tools.add(tool)
    }
  }

  // 3. 添加角色专属工具
  if (context.templateId) {
    const templateConfig = TEMPLATE_TOOLS[context.templateId]
    if (templateConfig) {
      for (const groupId of templateConfig.toolGroups) {
        const groupTools = TOOL_GROUPS[groupId]
        if (groupTools) {
          for (const tool of groupTools) {
            tools.add(tool)
          }
        }
      }
    }
  }

  return Array.from(tools)
}

/**
 * 检查工具是否在上下文中可用
 */
export function isToolAvailable(toolName: string, context: ToolLoadingContext): boolean {
  return getToolsForContext(context).includes(toolName)
}
