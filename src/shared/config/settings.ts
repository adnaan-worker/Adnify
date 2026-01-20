/**
 * 设置 Schema - 单一真相来源
 * 
 * 所有设置项在此声明式定义：
 * - 类型（通过 TypeScript 推断）
 * - 默认值
 * - 持久化键名
 * - 主进程同步标识
 * 
 * 新增设置只需：
 * 1. 在此文件添加定义
 * 2. 在 UI 组件中使用
 */

import {
  LLM_DEFAULTS,
  AGENT_DEFAULTS,
  AUTO_APPROVE_DEFAULTS,
  EDITOR_DEFAULTS,
  TERMINAL_DEFAULTS,
  GIT_DEFAULTS,
  LSP_DEFAULTS,
  PERFORMANCE_DEFAULTS,
  AI_COMPLETION_DEFAULTS,
  SECURITY_SETTINGS_DEFAULTS,
} from './defaults'
import type {
  LLMConfig,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  SecuritySettings,
  WebSearchConfig,
  McpConfig,
  ProviderConfig,
  LLMParameters,
} from './types'
import { BUILTIN_PROVIDERS, getAdapterConfig } from './providers'
import type { ApiProtocol } from './providers'

// ============================================
// Provider 扩展类型（运行时使用）
// ============================================

export interface ProviderModelConfig extends Omit<ProviderConfig, 'protocol'> {
  customModels?: string[]
  protocol?: ApiProtocol
}

// ============================================
// 设置项元数据
// ============================================

export interface SettingMeta<T> {
  /** 默认值 */
  default: T
  /** 持久化存储键（不设置则使用设置名） */
  storageKey?: string
  /** 只持久化部分字段 */
  persistFields?: readonly (keyof T)[]
  /** 需要同步到主进程的标识 */
  syncToMain?: string
}

// ============================================
// 默认值构建
// ============================================

const defaultLLMParameters: LLMParameters = {
  temperature: LLM_DEFAULTS.temperature,
  topP: LLM_DEFAULTS.topP,
  maxTokens: LLM_DEFAULTS.maxTokens,
}

const defaultLLMConfig: LLMConfig = {
  provider: LLM_DEFAULTS.defaultProvider,
  model: LLM_DEFAULTS.defaultModel,
  apiKey: '',
  parameters: defaultLLMParameters,
  adapterConfig: getAdapterConfig(LLM_DEFAULTS.defaultProvider),
}

const defaultAgentConfig: AgentConfig = {
  maxToolLoops: AGENT_DEFAULTS.maxToolLoops,
  maxHistoryMessages: AGENT_DEFAULTS.maxHistoryMessages,
  maxToolResultChars: AGENT_DEFAULTS.maxToolResultChars,
  maxFileContentChars: AGENT_DEFAULTS.maxFileContentChars,
  maxTotalContextChars: AGENT_DEFAULTS.maxTotalContextChars,
  maxContextTokens: AGENT_DEFAULTS.maxContextTokens,
  maxSingleFileChars: AGENT_DEFAULTS.maxSingleFileChars,
  maxContextFiles: AGENT_DEFAULTS.maxContextFiles,
  maxSemanticResults: AGENT_DEFAULTS.maxSemanticResults,
  maxTerminalChars: AGENT_DEFAULTS.maxTerminalChars,
  maxRetries: AGENT_DEFAULTS.maxRetries,
  retryDelayMs: AGENT_DEFAULTS.retryDelayMs,
  toolTimeoutMs: AGENT_DEFAULTS.toolTimeoutMs,
  enableAutoFix: AGENT_DEFAULTS.enableAutoFix,
  keepRecentTurns: AGENT_DEFAULTS.keepRecentTurns,
  deepCompressionTurns: AGENT_DEFAULTS.deepCompressionTurns,
  maxImportantOldTurns: AGENT_DEFAULTS.maxImportantOldTurns,
  enableLLMSummary: AGENT_DEFAULTS.enableLLMSummary,
  autoHandoff: AGENT_DEFAULTS.autoHandoff,
  loopDetection: { ...AGENT_DEFAULTS.loopDetection },
  ignoredDirectories: [...AGENT_DEFAULTS.ignoredDirectories],
}

const defaultEditorConfig: EditorConfig = {
  fontSize: EDITOR_DEFAULTS.fontSize,
  fontFamily: EDITOR_DEFAULTS.fontFamily,
  tabSize: EDITOR_DEFAULTS.tabSize,
  wordWrap: EDITOR_DEFAULTS.wordWrap,
  lineHeight: EDITOR_DEFAULTS.lineHeight,
  minimap: EDITOR_DEFAULTS.minimap,
  minimapScale: EDITOR_DEFAULTS.minimapScale,
  lineNumbers: EDITOR_DEFAULTS.lineNumbers,
  bracketPairColorization: EDITOR_DEFAULTS.bracketPairColorization,
  formatOnSave: EDITOR_DEFAULTS.formatOnSave,
  autoSave: EDITOR_DEFAULTS.autoSave,
  autoSaveDelay: EDITOR_DEFAULTS.autoSaveDelay,
  terminal: { ...TERMINAL_DEFAULTS },
  git: { ...GIT_DEFAULTS },
  lsp: { ...LSP_DEFAULTS },
  performance: { ...PERFORMANCE_DEFAULTS },
  ai: {
    completionEnabled: AI_COMPLETION_DEFAULTS.enabled,
    completionMaxTokens: AI_COMPLETION_DEFAULTS.maxTokens,
    completionTemperature: AI_COMPLETION_DEFAULTS.temperature,
    completionTriggerChars: [...AI_COMPLETION_DEFAULTS.triggerChars],
  },
}

const defaultSecuritySettings: SecuritySettings = {
  enablePermissionConfirm: SECURITY_SETTINGS_DEFAULTS.enablePermissionConfirm,
  enableAuditLog: SECURITY_SETTINGS_DEFAULTS.enableAuditLog,
  strictWorkspaceMode: SECURITY_SETTINGS_DEFAULTS.strictWorkspaceMode,
  allowedShellCommands: [...SECURITY_SETTINGS_DEFAULTS.allowedShellCommands],
  allowedGitSubcommands: [...SECURITY_SETTINGS_DEFAULTS.allowedGitSubcommands],
  showSecurityWarnings: SECURITY_SETTINGS_DEFAULTS.showSecurityWarnings,
}

const defaultAutoApprove: AutoApproveSettings = { ...AUTO_APPROVE_DEFAULTS }

const defaultWebSearchConfig: WebSearchConfig = {
  googleApiKey: '',
  googleCx: '',
}

const defaultMcpConfig: McpConfig = {
  autoConnect: true,
}

function generateDefaultProviderConfigs(): Record<string, ProviderModelConfig> {
  const configs: Record<string, ProviderModelConfig> = {}
  for (const [id, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    configs[id] = {
      customModels: [],
      adapterConfig: provider.adapter,
      model: provider.defaultModel || '',
      baseUrl: provider.baseUrl,
    }
  }
  return configs
}

// ============================================
// 设置 Schema
// ============================================

export const SETTINGS = {
  llmConfig: {
    default: defaultLLMConfig,
    persistFields: ['provider', 'model'] as const,
  },
  language: {
    default: 'en' as const,
  },
  autoApprove: {
    default: defaultAutoApprove,
  },
  promptTemplateId: {
    default: 'default' as string,
  },
  providerConfigs: {
    default: generateDefaultProviderConfigs(),
  },
  agentConfig: {
    default: defaultAgentConfig,
  },
  editorConfig: {
    default: defaultEditorConfig,
    storageKey: 'editorConfig',
  },
  securitySettings: {
    default: defaultSecuritySettings,
    storageKey: 'securitySettings',
  },
  webSearchConfig: {
    default: defaultWebSearchConfig,
    syncToMain: 'googleSearch',
  },
  mcpConfig: {
    default: defaultMcpConfig,
    syncToMain: 'mcpAutoConnect',
  },
  aiInstructions: {
    default: '' as string,
  },
  onboardingCompleted: {
    default: false as boolean,
  },
  enableFileLogging: {
    default: false as boolean,
  },
}

// ============================================
// 类型推断
// ============================================

export type SettingsSchema = typeof SETTINGS
export type SettingKey = keyof SettingsSchema

/** 设置值类型推断 */
export type SettingValue<K extends SettingKey> = SettingsSchema[K]['default']

/** 完整设置状态 */
export type SettingsState = {
  llmConfig: LLMConfig
  language: 'en' | 'zh'
  autoApprove: AutoApproveSettings
  promptTemplateId: string
  providerConfigs: Record<string, ProviderModelConfig>
  agentConfig: AgentConfig
  editorConfig: EditorConfig
  securitySettings: SecuritySettings
  webSearchConfig: WebSearchConfig
  mcpConfig: McpConfig
  aiInstructions: string
  onboardingCompleted: boolean
  enableFileLogging: boolean
}

// ============================================
// 工具函数
// ============================================

/** 获取单个设置的默认值 */
export function getDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].default as SettingValue<K>
}

/** 获取所有默认值 */
export function getAllDefaults(): SettingsState {
  return {
    llmConfig: SETTINGS.llmConfig.default,
    language: SETTINGS.language.default as 'en' | 'zh',
    autoApprove: SETTINGS.autoApprove.default,
    promptTemplateId: SETTINGS.promptTemplateId.default,
    providerConfigs: SETTINGS.providerConfigs.default,
    agentConfig: SETTINGS.agentConfig.default,
    editorConfig: SETTINGS.editorConfig.default,
    securitySettings: SETTINGS.securitySettings.default,
    webSearchConfig: SETTINGS.webSearchConfig.default,
    mcpConfig: SETTINGS.mcpConfig.default,
    aiInstructions: SETTINGS.aiInstructions.default,
    onboardingCompleted: SETTINGS.onboardingCompleted.default,
    enableFileLogging: SETTINGS.enableFileLogging.default,
  }
}

/** 获取需要同步到主进程的设置 */
export function getMainSyncSettings(): SettingKey[] {
  return (Object.keys(SETTINGS) as SettingKey[]).filter(
    key => (SETTINGS[key] as SettingMeta<unknown>).syncToMain
  )
}

// ============================================
// 默认值导出
// ============================================

export {
  defaultLLMConfig,
  defaultLLMParameters,
  defaultAgentConfig,
  defaultEditorConfig,
  defaultSecuritySettings,
  defaultAutoApprove,
  defaultWebSearchConfig,
  defaultMcpConfig,
}
