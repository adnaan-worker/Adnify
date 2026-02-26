/**
 * Settings 组件共享类型定义
 */

import { Language } from '@renderer/i18n'
import type { LLMConfig, AutoApproveSettings, AgentConfig, WebSearchConfig } from '@shared/config/types'
import type { ProviderModelConfig } from '@shared/config/settings'

export type SettingsTab = 'provider' | 'editor' | 'snippets' | 'agent' | 'rules' | 'skills' | 'mcp' | 'lsp' | 'keybindings' | 'indexing' | 'security' | 'system'

export interface ProviderSettingsProps {
    localConfig: LLMConfig
    setLocalConfig: React.Dispatch<React.SetStateAction<LLMConfig>>
    localProviderConfigs: Record<string, ProviderModelConfig>
    setLocalProviderConfigs: React.Dispatch<React.SetStateAction<Record<string, ProviderModelConfig>>>
    showApiKey: boolean
    setShowApiKey: (show: boolean) => void
    selectedProvider: { id: string; name: string; models: string[] } | undefined
    providers: { id: string; name: string; models: string[] }[]
    language: Language
    setProvider: (id: string, config: ProviderModelConfig) => void
}

export interface EditorSettingsState {
    // 编辑器外观
    fontSize: number
    tabSize: number
    wordWrap: 'on' | 'off' | 'wordWrapColumn'
    lineNumbers: 'on' | 'off' | 'relative'
    minimap: boolean
    bracketPairColorization: boolean
    formatOnSave: boolean
    autoSave: 'off' | 'afterDelay' | 'onFocusChange'
    autoSaveDelay: number
    theme: string

    // AI 补全
    completionEnabled: boolean
    completionDebounceMs: number
    completionMaxTokens: number
    completionTriggerChars: string[]

    // 终端
    terminalScrollback: number
    terminalMaxOutputLines: number

    // LSP
    lspTimeoutMs: number
    lspCompletionTimeoutMs: number

    // 性能
    largeFileWarningThresholdMB: number
    largeFileLineCount: number
    commandTimeoutMs: number
    workerTimeoutMs: number
    healthCheckTimeoutMs: number
    maxProjectFiles: number
    maxFileTreeDepth: number
    maxSearchResults: number
    saveDebounceMs: number
    flushIntervalMs: number
}

export interface EditorSettingsProps {
    settings: EditorSettingsState
    setSettings: (settings: EditorSettingsState) => void
    advancedConfig: import('@renderer/settings').EditorConfig
    setAdvancedConfig: (config: import('@renderer/settings').EditorConfig) => void
    language: Language
}

export interface AgentSettingsProps {
    autoApprove: AutoApproveSettings
    setAutoApprove: (value: AutoApproveSettings) => void
    aiInstructions: string
    setAiInstructions: (value: string) => void
    promptTemplateId: string
    setPromptTemplateId: (value: string) => void
    agentConfig: AgentConfig
    setAgentConfig: React.Dispatch<React.SetStateAction<AgentConfig>>
    webSearchConfig: WebSearchConfig
    setWebSearchConfig: React.Dispatch<React.SetStateAction<WebSearchConfig>>
    language: Language
}

export interface PromptPreviewModalProps {
    templateId: string
    language: Language
    onClose: () => void
}

export const LANGUAGES: { id: Language; name: string }[] = [
    { id: 'en', name: 'English' },
    { id: 'zh', name: '中文' },
]
