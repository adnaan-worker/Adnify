/**
 * 设置模块
 * 
 * 统一导出设置相关功能
 */

// 服务
export {
  settingsService,
  getEditorConfig,
  saveEditorConfig,
  resetEditorConfig,
} from './service'

// Schema 和类型（从 shared 重新导出）
export {
  SETTINGS,
  type SettingsState,
  type SettingKey,
  type SettingValue,
  type ProviderModelConfig,
  getAllDefaults,
  getDefault,
  // 默认值
  defaultLLMConfig,
  defaultAgentConfig,
  defaultEditorConfig,
  defaultSecuritySettings,
  defaultAutoApprove,
  defaultWebSearchConfig,
  defaultMcpConfig,
  defaultTaskTrustSettings,
} from '@shared/config/settings'

// 类型重新导出
export type {
  LLMConfig,
  AgentConfig,
  AutoApproveSettings,
  EditorConfig,
  SecuritySettings,
  WebSearchConfig,
  McpConfig,
  ProviderConfig,
} from '@shared/config/types'

// 配置导出/导入工具
export { exportSettings, importSettings, downloadSettings } from './exportImport'
