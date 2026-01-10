/**
 * 运行时默认配置
 * 
 * 从 shared/config/defaults.ts 构建完整的默认配置对象
 * 用于渲染进程
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
} from '@shared/config/defaults'
import { BUILTIN_PROVIDERS, getAdapterConfig } from '@shared/config/providers'
import type {
  LLMConfig,
  LLMParameters,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  ProviderConfig,
  SecuritySettings,
} from '@shared/config/types'

// ============================================
// LLM 默认配置
// ============================================

export const defaultLLMParameters: LLMParameters = {
  temperature: LLM_DEFAULTS.temperature,
  topP: LLM_DEFAULTS.topP,
  maxTokens: LLM_DEFAULTS.maxTokens,
}

export const defaultLLMConfig: LLMConfig = {
  provider: LLM_DEFAULTS.defaultProvider,
  model: LLM_DEFAULTS.defaultModel,
  apiKey: '',
  parameters: defaultLLMParameters,
  adapterConfig: getAdapterConfig(LLM_DEFAULTS.defaultProvider),
}

// ============================================
// Agent 默认配置
// ============================================

export const defaultAgentConfig: AgentConfig = {
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

// ============================================
// 自动审批默认配置
// ============================================

export const defaultAutoApprove: AutoApproveSettings = {
  ...AUTO_APPROVE_DEFAULTS,
}

// ============================================
// 编辑器默认配置
// ============================================

export const defaultEditorConfig: EditorConfig = {
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

// ============================================
// 安全设置默认配置
// ============================================

export const defaultSecuritySettings: SecuritySettings = {
  enablePermissionConfirm: SECURITY_SETTINGS_DEFAULTS.enablePermissionConfirm,
  enableAuditLog: SECURITY_SETTINGS_DEFAULTS.enableAuditLog,
  strictWorkspaceMode: SECURITY_SETTINGS_DEFAULTS.strictWorkspaceMode,
  allowedShellCommands: [...SECURITY_SETTINGS_DEFAULTS.allowedShellCommands],
  showSecurityWarnings: SECURITY_SETTINGS_DEFAULTS.showSecurityWarnings,
}

// ============================================
// Provider 默认配置
// ============================================

export function generateDefaultProviderConfigs(): Record<string, ProviderConfig> {
  const configs: Record<string, ProviderConfig> = {}
  for (const [id, def] of Object.entries(BUILTIN_PROVIDERS)) {
    configs[id] = {
      model: def.defaultModel,
      baseUrl: def.baseUrl,
      customModels: [],
    }
  }
  return configs
}

export const defaultProviderConfigs = generateDefaultProviderConfigs()
