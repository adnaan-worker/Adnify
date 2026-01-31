/**
 * Agent 专用配置
 * 
 * 此文件只包含 Agent 特有的复杂配置（缓存策略、工具截断等）
 * 基础默认值从 defaults.ts 导入
 * 
 * 配置优先级：
 * 1. 用户配置 (UI 设置)
 * 2. 项目配置 (.adnify/agent.json)
 * 3. 默认配置 (defaults.ts + 本文件)
 */

import { AGENT_DEFAULTS } from './defaults'

// ============================================
// 缓存配置（Agent 专用，不暴露给用户 UI）
// ============================================

export type EvictionPolicy = 'lru' | 'lfu' | 'fifo'

export interface CacheConfigDef {
  maxSize: number
  ttlMs: number
  maxMemory?: number
  evictionPolicy?: EvictionPolicy
  slidingExpiration?: boolean
  cleanupInterval?: number
}

export interface CacheConfigs {
  lint: CacheConfigDef
  completion: CacheConfigDef
  directory: CacheConfigDef
  fileContent: CacheConfigDef
  searchResult: CacheConfigDef
  llmProvider: CacheConfigDef
  lspDiagnostics: CacheConfigDef
  healthCheck: CacheConfigDef
}

export const CACHE_DEFAULTS: CacheConfigs = {
  lint: { maxSize: 100, ttlMs: 30000, evictionPolicy: 'lru' },
  completion: { maxSize: 100, ttlMs: 60000, evictionPolicy: 'lru', slidingExpiration: true },
  directory: { maxSize: 200, ttlMs: 300000, evictionPolicy: 'lru' },
  fileContent: { maxSize: 500, ttlMs: 300000, maxMemory: 100 * 1024 * 1024, evictionPolicy: 'lru' },
  searchResult: { maxSize: 100, ttlMs: 120000, maxMemory: 10 * 1024 * 1024, evictionPolicy: 'lfu' },
  llmProvider: { maxSize: 10, ttlMs: 1800000, evictionPolicy: 'lfu', cleanupInterval: 300000 },
  lspDiagnostics: { maxSize: 500, ttlMs: 0, evictionPolicy: 'lru', cleanupInterval: 0 },
  healthCheck: { maxSize: 20, ttlMs: 300000, evictionPolicy: 'fifo' },
}

// ============================================
// 工具结果截断配置（Agent 专用，不暴露给用户 UI）
// ============================================

export interface ToolTruncateConfig {
  maxLength: number
  headRatio: number
  tailRatio: number
}

export const TOOL_TRUNCATE_DEFAULTS: Record<string, ToolTruncateConfig> = {
  // 文件读取
  read_file: { maxLength: 20000, headRatio: 0.8, tailRatio: 0.15 },
  read_multiple_files: { maxLength: 30000, headRatio: 0.8, tailRatio: 0.15 },
  // 搜索结果
  search_files: { maxLength: 10000, headRatio: 0.9, tailRatio: 0.05 },
  codebase_search: { maxLength: 10000, headRatio: 0.9, tailRatio: 0.05 },
  find_references: { maxLength: 8000, headRatio: 0.85, tailRatio: 0.1 },
  grep_search: { maxLength: 10000, headRatio: 0.9, tailRatio: 0.05 },
  // 目录结构
  get_dir_tree: { maxLength: 8000, headRatio: 0.85, tailRatio: 0.1 },
  list_directory: { maxLength: 8000, headRatio: 0.85, tailRatio: 0.1 },
  // 命令输出
  run_command: { maxLength: 15000, headRatio: 0.2, tailRatio: 0.75 },
  execute_command: { maxLength: 15000, headRatio: 0.2, tailRatio: 0.75 },
  // 符号/定义
  get_document_symbols: { maxLength: 8000, headRatio: 0.6, tailRatio: 0.35 },
  get_definition: { maxLength: 5000, headRatio: 0.7, tailRatio: 0.25 },
  get_hover_info: { maxLength: 3000, headRatio: 0.7, tailRatio: 0.25 },
  // Lint
  get_lint_errors: { maxLength: 8000, headRatio: 0.85, tailRatio: 0.1 },
  // 默认
  default: { maxLength: 12000, headRatio: 0.7, tailRatio: 0.25 },
}

// ============================================
// 模式后处理钩子配置
// ============================================

export type ModePostProcessHook = (context: {
  mode: string
  messages: unknown[]
  hasWriteOps: boolean
  hasSpecificTool: (toolName: string) => boolean
  iteration: number
  maxIterations: number
}) => { shouldContinue: boolean; reminderMessage?: string } | null

export interface ModePostProcessConfig {
  enabled: boolean
  hook: ModePostProcessHook
}

// ============================================
// 工具依赖配置
// ============================================

export interface ToolDependency {
  /** 依赖的工具名称 */
  dependsOn: string[]
  /** 依赖类型：sequential（必须按顺序）或 parallel（可并行但需等待） */
  type: 'sequential' | 'parallel'
}

// ============================================
// Agent 运行时配置类型
// ============================================

export interface AgentRuntimeConfig {
  // 循环控制
  maxToolLoops: number
  maxHistoryMessages: number

  // 上下文限制
  maxToolResultChars: number
  maxFileContentChars: number
  maxTotalContextChars: number
  maxContextTokens: number
  maxSingleFileChars: number
  maxContextFiles: number
  maxSemanticResults: number
  maxTerminalChars: number

  // 重试配置
  maxRetries: number
  retryDelayMs: number
  retryBackoffMultiplier: number

  // 工具执行
  toolTimeoutMs: number
  enableAutoFix: boolean
  
  // 动态并发控制
  dynamicConcurrency: {
    enabled: boolean
    minConcurrency: number
    maxConcurrency: number
    cpuMultiplier: number  // CPU 核心数的倍数
  }

  // 上下文压缩
  keepRecentTurns: number
  deepCompressionTurns: number
  maxImportantOldTurns: number
  enableLLMSummary: boolean
  autoHandoff: boolean
  
  // 摘要生成配置
  summaryMaxContextChars: {
    quick: number
    detailed: number
    handoff: number
  }
  
  // Prune 配置
  pruneMinimumTokens: number
  pruneProtectTokens: number

  // 循环检测（支持动态调整）
  loopDetection: {
    maxHistory: number
    maxExactRepeats: number
    maxSameTargetRepeats: number
    dynamicThreshold: boolean  // 是否根据任务复杂度动态调整
  }

  // 目录忽略列表
  ignoredDirectories: string[]
  
  // 模式后处理钩子
  modePostProcessHooks?: Record<string, ModePostProcessConfig>
  
  // 工具依赖声明
  toolDependencies?: Record<string, ToolDependency>

  // 子配置（可选覆盖）
  cache?: Partial<CacheConfigs>
  toolTruncate?: Partial<Record<string, ToolTruncateConfig>>
}

// 从 defaults.ts 构建完整的 Agent 配置
export const DEFAULT_AGENT_CONFIG: AgentRuntimeConfig = {
  ...AGENT_DEFAULTS,
  loopDetection: { 
    ...AGENT_DEFAULTS.loopDetection,
    dynamicThreshold: true,
  },
  summaryMaxContextChars: { ...AGENT_DEFAULTS.summaryMaxContextChars },
  ignoredDirectories: [...AGENT_DEFAULTS.ignoredDirectories],
  dynamicConcurrency: {
    enabled: true,
    minConcurrency: 4,
    maxConcurrency: 16,
    cpuMultiplier: 2,
  },
  modePostProcessHooks: {
    plan: {
      enabled: true,
      hook: (context) => {
        // Plan 模式工作流检查：
        // 1. 必须使用 ask_user 收集需求（至少一次）
        // 2. 最终必须调用 create_workflow
        
        const messages = context.messages as Array<{ 
          role: string
          content?: string
          tool_calls?: Array<{ function: { name: string } }> 
        }>
        
        // 统计已使用的工具
        const toolsUsed = new Set<string>()
        let askUserCount = 0
        for (const msg of messages) {
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              toolsUsed.add(tc.function.name)
              if (tc.function.name === 'ask_user') {
                askUserCount++
              }
            }
          }
        }
        
        const hasUsedAskUser = toolsUsed.has('ask_user')
        const hasUsedCreateWorkflow = toolsUsed.has('create_workflow')
        
        // 检查最后一条消息
        const lastMessage = messages[messages.length - 1]
        const lastHasToolCalls = lastMessage?.tool_calls && lastMessage.tool_calls.length > 0
        
        // 如果 AI 没有调用工具（想结束对话）
        if (!lastHasToolCalls) {
          // 优先级 1：必须至少使用一次 ask_user
          if (!hasUsedAskUser) {
            console.log('[Plan Mode Hook] Forcing ask_user usage')
            return {
              shouldContinue: true,
              reminderMessage: `⚠️ PLAN MODE: You must use ask_user to gather requirements.

You can read files to understand the project, but you MUST also use ask_user to collect requirements from the user.

Example:
\`\`\`json
{
  "question": "What type of workflow would you like to create?",
  "options": [
    {"id": "feature", "label": "Feature Development"},
    {"id": "bugfix", "label": "Bug Fix"},
    {"id": "refactor", "label": "Refactoring"}
  ]
}
\`\`\`

Call ask_user NOW.`
            }
          }
          
          // 优先级 2：使用过 ask_user 但没创建工作流
          if (hasUsedAskUser && !hasUsedCreateWorkflow) {
            console.log('[Plan Mode Hook] Forcing create_workflow usage')
            return {
              shouldContinue: true,
              reminderMessage: `⚠️ PLAN MODE: You gathered requirements (${askUserCount} rounds) but didn't create the workflow.

Now you must call create_workflow with:
- name: Workflow name (kebab-case)
- description: Brief description
- requirements: Complete Markdown document with all gathered information

Call create_workflow NOW.`
            }
          }
        }
        
        return null
      }
    }
  },
  toolDependencies: {
    edit_file: {
      dependsOn: ['read_file'],
      type: 'sequential',
    },
    replace_file_content: {
      dependsOn: ['read_file'],
      type: 'sequential',
    },
  },
}

// ============================================
// 配置获取辅助函数
// ============================================

export function getCacheConfig(type: keyof CacheConfigs, override?: Partial<CacheConfigDef>): CacheConfigDef {
  const base = CACHE_DEFAULTS[type]
  return override ? { ...base, ...override } : base
}

export function getToolTruncateConfig(toolName: string): ToolTruncateConfig {
  return TOOL_TRUNCATE_DEFAULTS[toolName] || TOOL_TRUNCATE_DEFAULTS.default
}


