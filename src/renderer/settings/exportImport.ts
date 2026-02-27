/**
 * 设置导出/导入工具
 */

import { isBuiltinProvider } from '@shared/config/providers'
import type { SettingsState, ProviderModelConfig } from '@shared/config/settings'
import type { AppSettings } from '@shared/config/types'

export interface ExportedSettings {
  version: string
  exportedAt: string
  settings: Partial<SettingsState>
}

/**
 * 导出配置（不包含敏感信息如 API Key）
 */
export function exportSettings(settings: SettingsState, includeApiKeys = false): ExportedSettings {
  const exported: Partial<SettingsState> = {
    language: settings.language,
    autoApprove: settings.autoApprove,
    promptTemplateId: settings.promptTemplateId,
    agentConfig: settings.agentConfig,
    aiInstructions: settings.aiInstructions,
    editorConfig: settings.editorConfig,
    securitySettings: settings.securitySettings,
    webSearchConfig: settings.webSearchConfig,
    mcpConfig: settings.mcpConfig,
    enableFileLogging: settings.enableFileLogging,
    onboardingCompleted: settings.onboardingCompleted,
    llmConfig: {
      provider: settings.llmConfig.provider,
      model: settings.llmConfig.model,
    } as SettingsState['llmConfig'],
    providerConfigs: {},
  }

  for (const [id, config] of Object.entries(settings.providerConfigs)) {
    const cleanedConfig: Partial<ProviderModelConfig> = {
      model: config.model,
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      customModels: config.customModels,
      headers: config.headers,  // 导出 headers
    }

    if (includeApiKeys && config.apiKey) {
      cleanedConfig.apiKey = config.apiKey
    }

    if (!isBuiltinProvider(id)) {
      cleanedConfig.displayName = config.displayName
      cleanedConfig.protocol = config.protocol
    }

    exported.providerConfigs![id] = cleanedConfig as ProviderModelConfig
  }

  return {
    version: 'export-v1',
    exportedAt: new Date().toISOString(),
    settings: exported,
  }
}

/**
 * 从 JSON 导入配置
 */
export function importSettings(json: string): { success: boolean; settings?: Partial<AppSettings>; error?: string } {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>

    // 判断是否是新的带 version 格式
    if (parsed.version && parsed.settings && typeof parsed.settings === 'object') {
      return { success: true, settings: parsed.settings as Partial<AppSettings> }
    }

    // 尝试识别旧格式的 config.json (包含 llmConfig, providerConfigs 等)
    if (Reflect.has(parsed, 'llmConfig') || Reflect.has(parsed, 'providerConfigs') || Reflect.has(parsed, 'language')) {
      return { success: true, settings: parsed as Partial<AppSettings> }
    }

    return { success: false, error: 'Invalid settings file format' }

  } catch (e) {
    return { success: false, error: `Failed to parse JSON: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }
}

/**
 * 下载配置文件
 */
export function downloadSettings(settings: SettingsState, includeApiKeys = false): void {
  const exported = exportSettings(settings, includeApiKeys)
  const json = JSON.stringify(exported, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `adnify-settings-${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
