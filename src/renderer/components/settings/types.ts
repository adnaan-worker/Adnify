/**
 * Settings 组件共享类型定义
 */

import { Language } from '@renderer/i18n'
import type {
    LLMConfig,
    AutoApproveSettings,
    AgentConfig,
    WebSearchConfig,
    TaskTrustSettings as PersistedTaskTrustSettings,
    TaskRuntimeModelRole,
} from '@shared/config/types'
import type { ProviderModelConfig } from '@shared/config/settings'
import { DEFAULT_TRUST_POLICY, type TrustPolicy } from '@renderer/agent/types/trustPolicy'
import {
    createDefaultSpecialistProfile,
    createDefaultTaskBudget,
    type SpecialistKind,
    type SpecialistProfile,
    type TaskBudgetLimits,
} from '@renderer/agent/types/taskExecution'

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
    terminalScrollback: number
    terminalMaxOutputLines: number
    lspTimeoutMs: number
    lspCompletionTimeoutMs: number
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
    taskTrustSettings: TaskTrustSettings
    setTaskTrustSettings: React.Dispatch<React.SetStateAction<TaskTrustSettings>>
    currentLLMConfig: LLMConfig
    providerConfigs: Record<string, ProviderModelConfig>
    availableProviders: { id: string; name: string; models: string[] }[]
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

export interface TaskBudgetSettings {
    limits: TaskBudgetLimits
    warningThresholdRatio: number
    hardStop: boolean
}

export interface RollbackGovernanceSettings {
    autoRollbackIsolated: boolean
    requireConfirmationForMainWorkspace: boolean
    warnOnExternalSideEffects: boolean
}

export interface TaskGovernanceDefaults {
    budget: TaskBudgetSettings
    rollback: RollbackGovernanceSettings
}

export interface RuntimeModelSettings {
    provider: string | null
    model: string | null
}

export interface TaskTrustSettings {
    global: TrustPolicy
    workspaceOverrides: Record<string, TrustPolicy>
    allowTaskOverride: boolean
    governanceDefaults: TaskGovernanceDefaults
    runtimeModels: Record<TaskRuntimeModelRole, RuntimeModelSettings>
    specialistProfiles: Record<SpecialistKind, SpecialistProfile>
}

export function normalizeTaskTrustPolicy(input?: Partial<TrustPolicy>): TrustPolicy {
    return {
        ...DEFAULT_TRUST_POLICY,
        ...(input || {}),
    }
}

function normalizeTaskBudgetSettings(input?: PersistedTaskTrustSettings['governanceDefaults'] extends infer _T ? any : never): TaskBudgetSettings {
    const defaults = createDefaultTaskBudget()
    const limits = input?.budget?.limits || {}

    return {
        limits: {
            timeMs: typeof limits.timeMs === 'number' ? limits.timeMs : defaults.limits.timeMs,
            estimatedTokens: typeof limits.estimatedTokens === 'number' ? limits.estimatedTokens : defaults.limits.estimatedTokens,
            llmCalls: typeof limits.llmCalls === 'number' ? limits.llmCalls : defaults.limits.llmCalls,
            commands: typeof limits.commands === 'number' ? limits.commands : defaults.limits.commands,
            verifications: typeof limits.verifications === 'number' ? limits.verifications : defaults.limits.verifications,
        },
        warningThresholdRatio: typeof input?.budget?.warningThresholdRatio === 'number'
            ? input.budget.warningThresholdRatio
            : defaults.warningThresholdRatio,
        hardStop: typeof input?.budget?.hardStop === 'boolean' ? input.budget.hardStop : defaults.hardStop,
    }
}

function normalizeRollbackGovernanceSettings(input?: PersistedTaskTrustSettings['governanceDefaults'] extends infer _T ? any : never): RollbackGovernanceSettings {
    return {
        autoRollbackIsolated: typeof input?.rollback?.autoRollbackIsolated === 'boolean' ? input.rollback.autoRollbackIsolated : true,
        requireConfirmationForMainWorkspace: typeof input?.rollback?.requireConfirmationForMainWorkspace === 'boolean'
            ? input.rollback.requireConfirmationForMainWorkspace
            : true,
        warnOnExternalSideEffects: typeof input?.rollback?.warnOnExternalSideEffects === 'boolean'
            ? input.rollback.warnOnExternalSideEffects
            : true,
    }
}

function normalizeRuntimeModels(input?: PersistedTaskTrustSettings['runtimeModels']): Record<TaskRuntimeModelRole, RuntimeModelSettings> {
    const roles: TaskRuntimeModelRole[] = ['coordinator', 'reviewer', 'patrol']

    return roles.reduce<Record<TaskRuntimeModelRole, RuntimeModelSettings>>((acc, role) => {
        const override = input?.[role]
        acc[role] = {
            provider: typeof override?.provider === 'string' ? override.provider : null,
            model: typeof override?.model === 'string' ? override.model : null,
        }
        return acc
    }, {} as Record<TaskRuntimeModelRole, RuntimeModelSettings>)
}

function normalizeSpecialistProfiles(input?: PersistedTaskTrustSettings['specialistProfiles'] | Partial<Record<SpecialistKind, SpecialistProfile>>): Record<SpecialistKind, SpecialistProfile> {
    const roles: SpecialistKind[] = ['frontend', 'logic', 'verifier', 'reviewer']

    return roles.reduce<Record<SpecialistKind, SpecialistProfile>>((acc, role) => {
        const defaults = createDefaultSpecialistProfile(role)
        const override = input?.[role]
        acc[role] = {
            ...defaults,
            ...(override || {}),
            role,
            writableScopes: [...(override?.writableScopes || defaults.writableScopes)],
            budgetCap: { ...defaults.budgetCap, ...(override?.budgetCap || {}) },
        }
        return acc
    }, {} as Record<SpecialistKind, SpecialistProfile>)
}

export function normalizeTaskTrustSettings(
    input?: PersistedTaskTrustSettings | Partial<TaskTrustSettings>
): TaskTrustSettings {
    const workspaceOverrides = Object.entries(input?.workspaceOverrides || {}).reduce<Record<string, TrustPolicy>>(
        (acc, [workspace, policy]) => {
            acc[workspace] = normalizeTaskTrustPolicy(policy)
            return acc
        },
        {}
    )

    return {
        global: normalizeTaskTrustPolicy(input?.global),
        workspaceOverrides,
        allowTaskOverride: input?.allowTaskOverride ?? true,
        governanceDefaults: {
            budget: normalizeTaskBudgetSettings((input as PersistedTaskTrustSettings | undefined)?.governanceDefaults),
            rollback: normalizeRollbackGovernanceSettings((input as PersistedTaskTrustSettings | undefined)?.governanceDefaults),
        },
        runtimeModels: normalizeRuntimeModels((input as PersistedTaskTrustSettings | undefined)?.runtimeModels),
        specialistProfiles: normalizeSpecialistProfiles((input as PersistedTaskTrustSettings | undefined)?.specialistProfiles || (input as Partial<TaskTrustSettings> | undefined)?.specialistProfiles),
    }
}
