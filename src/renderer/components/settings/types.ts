/**
 * Settings 组件共享类型定义
 */

import { Language } from '@renderer/i18n'
import { LLMConfig, AutoApproveSettings } from '@store'
import { ProviderModelConfig } from '@app-types/provider'
import { AgentConfig } from '@renderer/store/slices/settingsSlice'

export type SettingsTab = 'provider' | 'editor' | 'agent' | 'mcp' | 'lsp' | 'keybindings' | 'indexing' | 'security' | 'system'

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
}

export interface EditorSettingsState {
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
    completionEnabled: boolean
    completionDebounceMs: number
    completionMaxTokens: number
    completionTriggerChars: string[]
    largeFileWarningThresholdMB: number
    commandTimeoutMs: number
    // 新增性能配置
    maxProjectFiles: number
    maxFileTreeDepth: number
    terminalScrollback: number
}

export interface EditorSettingsProps {
    settings: EditorSettingsState
    setSettings: (settings: EditorSettingsState) => void
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
