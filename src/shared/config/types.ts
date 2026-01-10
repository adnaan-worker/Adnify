/**
 * 配置类型定义 - 单一真相来源
 * 
 * 所有配置相关的类型都在这里定义，避免重复
 * 其他文件应从此处导入类型，而非重复定义
 */

import type { LLMAdapterConfig, AdvancedConfig } from './providers'

// ============================================
// LLM 配置
// ============================================

export interface LLMParameters {
  temperature: number
  topP: number
  maxTokens: number
}

export interface LLMConfig {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  timeout?: number
  parameters: LLMParameters
  adapterConfig?: LLMAdapterConfig
  advanced?: AdvancedConfig
}

// ============================================
// Provider 配置（保存到文件的格式）
// ============================================

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  model?: string
  timeout?: number
  customModels?: string[]
  advanced?: AdvancedConfig
  adapterConfig?: LLMAdapterConfig
  // 自定义 Provider 元数据
  displayName?: string
  protocol?: string
  createdAt?: number
  updatedAt?: number
}

// ============================================
// 自动审批设置
// ============================================

export interface AutoApproveSettings {
  terminal: boolean
  dangerous: boolean
}

// ============================================
// Agent 配置
// ============================================

export interface LoopDetectionConfig {
  maxHistory: number
  maxExactRepeats: number
  maxSameTargetRepeats: number
}

export interface AgentConfig {
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
  retryBackoffMultiplier?: number  // 可选，内部使用
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
  loopDetection: LoopDetectionConfig
  // 目录忽略
  ignoredDirectories: string[]
}

// ============================================
// 编辑器配置
// ============================================

export interface TerminalConfig {
  fontSize: number
  fontFamily: string
  lineHeight: number
  cursorBlink: boolean
  scrollback: number
  maxOutputLines: number
}

export interface GitConfig {
  autoRefresh: boolean
}

export interface LspConfig {
  timeoutMs: number
  completionTimeoutMs: number
  crashCooldownMs: number
}

export interface PerformanceConfig {
  maxProjectFiles: number
  maxFileTreeDepth: number
  fileChangeDebounceMs: number
  completionDebounceMs: number
  searchDebounceMs: number
  saveDebounceMs: number
  indexStatusIntervalMs: number
  fileWatchIntervalMs: number
  flushIntervalMs: number
  requestTimeoutMs: number
  commandTimeoutMs: number
  workerTimeoutMs: number
  healthCheckTimeoutMs: number
  terminalBufferSize: number
  maxResultLength: number
  largeFileWarningThresholdMB: number
  largeFileLineCount: number
  veryLargeFileLineCount: number
  maxSearchResults: number
}

export interface AiCompletionConfig {
  completionEnabled: boolean
  completionMaxTokens: number
  completionTemperature: number
  completionTriggerChars: string[]
}

export interface EditorConfig {
  // 编辑器外观
  fontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: 'on' | 'off' | 'wordWrapColumn'
  lineHeight: number
  minimap: boolean
  minimapScale: number
  lineNumbers: 'on' | 'off' | 'relative'
  bracketPairColorization: boolean
  // 编辑器行为
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay: number
  // 子配置
  terminal: TerminalConfig
  git: GitConfig
  lsp: LspConfig
  performance: PerformanceConfig
  ai: AiCompletionConfig
}

// ============================================
// 安全设置
// ============================================

export interface SecuritySettings {
  enablePermissionConfirm: boolean
  enableAuditLog: boolean
  strictWorkspaceMode: boolean
  allowedShellCommands: string[]
  showSecurityWarnings: boolean
}

// ============================================
// 完整应用设置（保存到 app-settings）
// ============================================

export interface AppSettings {
  llmConfig: Pick<LLMConfig, 'provider' | 'model'>  // 只保存 provider 和 model
  language: string
  autoApprove: AutoApproveSettings
  promptTemplateId?: string
  agentConfig: AgentConfig
  providerConfigs: Record<string, ProviderConfig>
  aiInstructions: string
  onboardingCompleted: boolean
}

// ============================================
// 运行时完整设置（内存中使用）
// ============================================

export interface RuntimeSettings extends Omit<AppSettings, 'llmConfig'> {
  llmConfig: LLMConfig  // 运行时包含完整 LLMConfig
  editorConfig: EditorConfig
  securitySettings: SecuritySettings
}
