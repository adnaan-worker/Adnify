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

  // 上下文压缩
  keepRecentTurns: number
  deepCompressionTurns: number
  maxImportantOldTurns: number
  enableLLMSummary: boolean
  autoHandoff: boolean

  // 循环检测
  loopDetection: {
    maxHistory: number
    maxExactRepeats: number
    maxSameTargetRepeats: number
  }

  // 目录忽略列表
  ignoredDirectories: string[]

  // 子配置（可选覆盖）
  cache?: Partial<CacheConfigs>
  toolTruncate?: Partial<Record<string, ToolTruncateConfig>>
}

// 从 defaults.ts 构建完整的 Agent 配置
export const DEFAULT_AGENT_CONFIG: AgentRuntimeConfig = {
  ...AGENT_DEFAULTS,
  loopDetection: { ...AGENT_DEFAULTS.loopDetection },
  ignoredDirectories: [...AGENT_DEFAULTS.ignoredDirectories],
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


