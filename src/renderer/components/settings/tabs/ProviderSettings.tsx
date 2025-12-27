/**
 * Provider 设置组件
 * 
 * 逻辑说明：
 * 1. 内置 Provider（OpenAI/Anthropic/Gemini）：显示标准配置 + AdapterOverridesEditor
 * 2. 已添加的自定义 Provider：显示标准配置 + AdapterOverridesEditor（回显 adapterConfig）
 * 3. 点击"+"添加时：显示 InlineProviderEditor 表单
 */

import { useState } from 'react'
import { Plus, Trash, Eye, EyeOff, Check, AlertTriangle, X } from 'lucide-react'
import { useStore } from '@store'
import { PROVIDERS, getAdapterConfig, type CustomProviderConfig, type LLMAdapterConfig } from '@/shared/config/providers'
import { toast } from '@components/common/ToastProvider'
import { Button, Input, Select } from '@components/ui'
import { ProviderSettingsProps } from '../types'
import { InlineProviderEditor } from './CustomProviderEditor'
import { AdapterOverridesEditor } from '../AdapterOverridesEditor'

/** 高级配置类型 */
interface AdvancedConfig {
  request?: { endpoint?: string; bodyTemplate?: Record<string, unknown> }
  response?: { contentField?: string; reasoningField?: string; toolCallField?: string; doneMarker?: string }
}

// 内置厂商 ID
const BUILTIN_PROVIDER_IDS = ['openai', 'anthropic', 'gemini']

/**
 * 将 CustomProviderConfig.customConfig 转换为 LLMAdapterConfig
 */
function convertCustomConfigToAdapterConfig(custom: CustomProviderConfig): LLMAdapterConfig {
    const cfg = custom.customConfig!
    return {
        id: custom.id,
        name: custom.name,
        description: custom.description || '自定义适配器',
        request: {
            endpoint: cfg.request.endpoint,
            method: cfg.request.method,
            headers: { 'Content-Type': 'application/json', ...(cfg.request.headers || {}) },
            bodyTemplate: cfg.request.bodyTemplate,
        },
        response: {
            contentField: cfg.response.streaming.contentField,
            reasoningField: cfg.response.streaming.reasoningField,
            toolCallField: cfg.response.streaming.toolCallsField,
            toolNamePath: cfg.response.streaming.toolNameField || 'function.name',
            toolArgsPath: cfg.response.streaming.toolArgsField || 'function.arguments',
            toolIdPath: cfg.response.streaming.toolIdField || 'id',
            argsIsObject: cfg.response.toolCall?.argsIsObject || false,
            finishReasonField: cfg.response.streaming.finishReasonField || 'finish_reason',
            doneMarker: cfg.response.sseConfig.doneMarker,
        },
    }
}

/**
 * 将 LLMAdapterConfig 转换为 AdvancedConfig（用于回显）
 */
function adapterConfigToAdvanced(config: LLMAdapterConfig | undefined, isCustom: boolean): AdvancedConfig | undefined {
    if (!config) return undefined
    if (!isCustom) return undefined
    return {
        request: {
            endpoint: config.request?.endpoint,
            bodyTemplate: config.request?.bodyTemplate,
        },
        response: {
            contentField: config.response?.contentField,
            reasoningField: config.response?.reasoningField,
            toolCallField: config.response?.toolCallField,
            doneMarker: config.response?.doneMarker,
        },
    }
}

function TestConnectionButton({ localConfig, language }: { localConfig: any; language: 'en' | 'zh' }) {
    const [testing, setTesting] = useState(false)
    const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')

    const handleTest = async () => {
        if (!localConfig.apiKey && localConfig.provider !== 'ollama') {
            setStatus('error')
            setErrorMsg(language === 'zh' ? '请先输入 API Key' : 'Please enter API Key first')
            return
        }
        setTesting(true)
        setStatus('idle')
        setErrorMsg('')
        try {
            const { checkProviderHealth } = await import('@/renderer/services/healthCheckService')
            const result = await checkProviderHealth(localConfig.provider, localConfig.apiKey, localConfig.baseUrl)
            if (result.status === 'healthy') {
                setStatus('success')
                toast.success(language === 'zh' ? `连接成功！延迟: ${result.latency}ms` : `Connected! Latency: ${result.latency}ms`)
            } else {
                setStatus('error')
                setErrorMsg(result.error || 'Connection failed')
            }
        } catch (err: any) {
            setStatus('error')
            setErrorMsg(err.message || 'Connection failed')
        } finally {
            setTesting(false)
        }
    }

    return (
        <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-8 px-3 text-xs">
                {testing ? (
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        {language === 'zh' ? '测试中...' : 'Testing...'}
                    </span>
                ) : (
                    language === 'zh' ? '测试连接' : 'Test Connection'
                )}
            </Button>
            {status === 'success' && (
                <span className="flex items-center gap-1 text-xs text-green-500">
                    <Check className="w-3.5 h-3.5" />
                    {language === 'zh' ? '连接正常' : 'Connected'}
                </span>
            )}
            {status === 'error' && (
                <span className="flex items-center gap-1 text-xs text-red-400" title={errorMsg}>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {errorMsg.length > 30 ? errorMsg.slice(0, 30) + '...' : errorMsg}
                </span>
            )}
        </div>
    )
}

export function ProviderSettings({
    localConfig,
    setLocalConfig,
    localProviderConfigs,
    setLocalProviderConfigs,
    showApiKey,
    setShowApiKey,
    selectedProvider,
    providers,
    language,
}: ProviderSettingsProps) {
    const { addCustomModel, removeCustomModel, providerConfigs, customProviders, removeCustomProvider, getProviderApiKey } = useStore()
    const [newModelName, setNewModelName] = useState('')
    const [isAddingCustom, setIsAddingCustom] = useState(false)

    // 当前选中的是自定义 Provider 吗？
    const selectedCustomProvider = customProviders.find((p) => p.id === localConfig.provider)
    const isCustomSelected = !!selectedCustomProvider

    // 获取当前 Provider 的 adapterConfig（用于回显）
    const currentAdapterConfig = localProviderConfigs[localConfig.provider]?.adapterConfig

    const handleAddModel = () => {
        if (newModelName.trim()) {
            addCustomModel(localConfig.provider, newModelName.trim())
            setNewModelName('')
        }
    }

    // 选择内置 Provider
    const handleSelectBuiltinProvider = (providerId: string) => {
        // 保存当前配置
        const updatedConfigs = {
            ...localProviderConfigs,
            [localConfig.provider]: {
                ...localProviderConfigs[localConfig.provider],
                apiKey: localConfig.apiKey,
                baseUrl: localConfig.baseUrl,
                timeout: localConfig.timeout,
                adapterConfig: localConfig.adapterConfig,
                model: localConfig.model,
            },
        }
        setLocalProviderConfigs(updatedConfigs)

        // 加载新 Provider 配置
        const nextConfig = updatedConfigs[providerId] || {}
        const providerInfo = PROVIDERS[providerId]
        setLocalConfig({
            ...localConfig,
            provider: providerId as any,
            apiKey: nextConfig.apiKey || '',
            baseUrl: nextConfig.baseUrl || providerInfo?.endpoint.default || '',
            timeout: nextConfig.timeout || providerInfo?.defaults.timeout || 120000,
            adapterConfig: nextConfig.adapterConfig || getAdapterConfig(providerId),
            model: nextConfig.model || providerInfo?.models[0] || '',
        })
        setIsAddingCustom(false)
    }

    // 选择自定义 Provider
    const handleSelectCustomProvider = (custom: CustomProviderConfig) => {
        // 保存当前配置
        const updatedConfigs = {
            ...localProviderConfigs,
            [localConfig.provider]: {
                ...localProviderConfigs[localConfig.provider],
                apiKey: localConfig.apiKey,
                baseUrl: localConfig.baseUrl,
                timeout: localConfig.timeout,
                adapterConfig: localConfig.adapterConfig,
                model: localConfig.model,
            },
        }
        setLocalProviderConfigs(updatedConfigs)

        // 获取已保存的配置
        const savedConfig = updatedConfigs[custom.id] || {}
        const savedApiKey = savedConfig.apiKey || getProviderApiKey(custom.id) || ''

        // 决定适配器配置
        let adapterConfig: LLMAdapterConfig
        if (custom.mode === 'custom' && custom.customConfig) {
            adapterConfig = savedConfig.adapterConfig || convertCustomConfigToAdapterConfig(custom)
        } else {
            adapterConfig = savedConfig.adapterConfig || getAdapterConfig(custom.mode)
        }

        setLocalConfig({
            ...localConfig,
            provider: custom.id as any,
            apiKey: savedApiKey,
            baseUrl: savedConfig.baseUrl || custom.baseUrl,
            timeout: savedConfig.timeout || custom.defaults?.timeout || 120000,
            adapterConfig,
            model: savedConfig.model || custom.models[0] || '',
        })
        setIsAddingCustom(false)
    }

    // 删除自定义 Provider
    const handleDeleteCustomProvider = (e: React.MouseEvent, custom: CustomProviderConfig) => {
        e.stopPropagation()
        if (confirm(language === 'zh' ? `删除 ${custom.name}？` : `Delete ${custom.name}?`)) {
            removeCustomProvider(custom.id)
            if (localConfig.provider === custom.id) {
                handleSelectBuiltinProvider('openai')
            }
        }
    }

    // 更新 adapterOverrides 并同步到 adapterConfig
    const handleAdvancedConfigChange = (advanced: AdvancedConfig | undefined) => {
        const newConfigs = { ...localProviderConfigs }
        if (!newConfigs[localConfig.provider]) {
            newConfigs[localConfig.provider] = { customModels: [] }
        }

        // 保存 advanced 配置
        newConfigs[localConfig.provider] = {
            ...newConfigs[localConfig.provider],
            advanced: advanced,
        }

        // 如果是自定义 Provider，同时更新 adapterConfig
        if (isCustomSelected && advanced) {
            const baseConfig = localConfig.adapterConfig || getAdapterConfig('openai')
            const updatedAdapterConfig: LLMAdapterConfig = {
                ...baseConfig,
                request: {
                    ...baseConfig.request,
                    endpoint: advanced.request?.endpoint || baseConfig.request.endpoint,
                    bodyTemplate: advanced.request?.bodyTemplate || baseConfig.request.bodyTemplate,
                },
                response: {
                    ...baseConfig.response,
                    contentField: advanced.response?.contentField || baseConfig.response.contentField,
                    reasoningField: advanced.response?.reasoningField,
                    toolCallField: advanced.response?.toolCallField,
                    doneMarker: advanced.response?.doneMarker || baseConfig.response.doneMarker,
                },
            }
            newConfigs[localConfig.provider].adapterConfig = updatedAdapterConfig
            setLocalConfig({ ...localConfig, adapterConfig: updatedAdapterConfig })
        }

        setLocalProviderConfigs(newConfigs)
    }

    const builtinProviders = providers.filter((p) => BUILTIN_PROVIDER_IDS.includes(p.id))

    return (
        <div className="space-y-8 animate-fade-in">
            {/* Provider 选择器 */}
            <section>
                <h4 className="text-sm font-medium text-text-secondary mb-4 uppercase tracking-wider text-xs">
                    {language === 'zh' ? '选择提供商' : 'Select Provider'}
                </h4>
                <div className="flex flex-wrap gap-3">
                    {/* 内置厂商 */}
                    {builtinProviders.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => handleSelectBuiltinProvider(p.id)}
                            className={`relative flex flex-col items-center justify-center px-6 py-3 rounded-xl border transition-all duration-200 ${
                                localConfig.provider === p.id
                                    ? 'border-accent bg-accent/10 text-accent shadow-[0_0_15px_rgba(var(--accent),0.15)]'
                                    : 'border-border-subtle bg-surface/30 text-text-muted hover:bg-surface hover:border-border hover:text-text-primary'
                            }`}
                        >
                            <span className="font-medium text-sm">{p.name}</span>
                            {localConfig.provider === p.id && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent animate-pulse" />}
                        </button>
                    ))}

                    {/* 已添加的自定义 Provider */}
                    {customProviders.map((custom) => (
                        <div
                            key={custom.id}
                            onClick={() => handleSelectCustomProvider(custom)}
                            className={`group relative flex flex-col items-center justify-center px-6 py-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                                localConfig.provider === custom.id
                                    ? 'border-accent bg-accent/10 text-accent shadow-[0_0_15px_rgba(var(--accent),0.15)]'
                                    : 'border-border-subtle bg-surface/30 text-text-muted hover:bg-surface hover:border-border hover:text-text-primary'
                            }`}
                        >
                            <span className="font-medium text-sm">{custom.name}</span>
                            {localConfig.provider === custom.id && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent animate-pulse" />}
                            <button
                                onClick={(e) => handleDeleteCustomProvider(e, custom)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                                title={language === 'zh' ? '删除' : 'Delete'}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}

                    {/* 添加按钮 */}
                    <button
                        onClick={() => setIsAddingCustom(true)}
                        className={`flex flex-col items-center justify-center px-6 py-3 rounded-xl border-2 border-dashed transition-all duration-200 ${
                            isAddingCustom
                                ? 'border-accent bg-accent/10 text-accent'
                                : 'border-border-subtle text-text-muted hover:border-accent/50 hover:text-accent hover:bg-accent/5'
                        }`}
                    >
                        <Plus className="w-5 h-5" />
                        <span className="text-xs mt-1">{language === 'zh' ? '添加' : 'Add'}</span>
                    </button>
                </div>

                {/* 添加新 Provider 表单（仅点击"+"时显示） */}
                {isAddingCustom && (
                    <div className="mt-4">
                        <InlineProviderEditor
                            language={language}
                            isNew
                            onSave={(newConfig) => {
                                if (newConfig.customConfig) {
                                    const adapterConfig = convertCustomConfigToAdapterConfig(newConfig)
                                    const newConfigs = { ...localProviderConfigs }
                                    newConfigs[newConfig.id] = {
                                        ...newConfigs[newConfig.id],
                                        adapterConfig,
                                        model: newConfig.defaultModel || newConfig.models[0] || '',
                                        customModels: newConfig.models,
                                    }
                                    setLocalProviderConfigs(newConfigs)
                                    setLocalConfig({ ...localConfig, provider: newConfig.id })
                                }
                                setIsAddingCustom(false)
                            }}
                            onCancel={() => setIsAddingCustom(false)}
                        />
                    </div>
                )}
            </section>

            {/* 配置区域（非添加模式时显示） */}
            {!isAddingCustom && (
                <section className="space-y-6 p-6 bg-surface/30 rounded-xl border border-border-subtle">
                    <h4 className="text-sm font-medium text-text-secondary uppercase tracking-wider text-xs mb-2">
                        {language === 'zh' ? '配置' : 'Configuration'}
                    </h4>

                    {/* 模型选择 */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-text-primary">{language === 'zh' ? '模型' : 'Model'}</label>
                        <Select
                            value={localConfig.model}
                            onChange={(value) => setLocalConfig({ ...localConfig, model: value })}
                            options={(() => {
                                const modelsSet = new Set<string>()
                                if (isCustomSelected) {
                                    selectedCustomProvider.models.forEach((m) => modelsSet.add(m))
                                } else if (selectedProvider) {
                                    selectedProvider.models.forEach((m) => modelsSet.add(m))
                                }
                                const customModels = providerConfigs[localConfig.provider]?.customModels || []
                                customModels.forEach((m) => modelsSet.add(m))
                                return Array.from(modelsSet).map((m) => ({ value: m, label: m }))
                            })()}
                            className="w-full"
                        />

                        {/* 添加自定义模型 */}
                        <div className="flex gap-2 items-center mt-3 pt-3 border-t border-border-subtle">
                            <Input
                                value={newModelName}
                                onChange={(e) => setNewModelName(e.target.value)}
                                placeholder={language === 'zh' ? '添加自定义模型...' : 'Add custom model...'}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                                className="flex-1 h-9 text-sm"
                            />
                            <Button variant="secondary" size="sm" onClick={handleAddModel} disabled={!newModelName.trim()} className="h-9 px-3">
                                <Plus className="w-4 h-4" />
                            </Button>
                        </div>

                        {providerConfigs[localConfig.provider]?.customModels?.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                {providerConfigs[localConfig.provider]?.customModels.map((model: string) => (
                                    <div
                                        key={model}
                                        className="flex items-center gap-1.5 px-2.5 py-1 bg-surface rounded-full border border-border-subtle text-xs text-text-secondary"
                                    >
                                        <span>{model}</span>
                                        <button onClick={() => removeCustomModel(localConfig.provider, model)} className="text-text-muted hover:text-red-400">
                                            <Trash className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* API Key */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-text-primary">API Key</label>
                        <Input
                            type={showApiKey ? 'text' : 'password'}
                            value={localConfig.apiKey}
                            onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                            placeholder={PROVIDERS[localConfig.provider]?.auth.placeholder || 'Enter API Key'}
                            rightIcon={
                                <button onClick={() => setShowApiKey(!showApiKey)} className="text-text-muted hover:text-text-primary">
                                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            }
                        />
                        {!isCustomSelected && PROVIDERS[localConfig.provider]?.auth.helpUrl && (
                            <div className="flex justify-end">
                                <a href={PROVIDERS[localConfig.provider]?.auth.helpUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                                    {language === 'zh' ? '获取 API Key →' : 'Get API Key →'}
                                </a>
                            </div>
                        )}
                    </div>

                    <TestConnectionButton localConfig={localConfig} language={language} />

                    {/* LLM 参数 */}
                    <div className="space-y-4 pt-4 border-t border-border-subtle">
                        <h5 className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                            {language === 'zh' ? 'LLM 参数' : 'LLM Parameters'}
                        </h5>
                        
                        {/* Max Tokens */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">{language === 'zh' ? '最大 Token' : 'Max Tokens'}</label>
                                <span className="text-xs text-text-muted font-mono">{localConfig.parameters?.maxTokens || 8192}</span>
                            </div>
                            <input
                                type="range"
                                min={1024}
                                max={32768}
                                step={1024}
                                value={localConfig.parameters?.maxTokens || 8192}
                                onChange={(e) => setLocalConfig({
                                    ...localConfig,
                                    parameters: { ...localConfig.parameters, maxTokens: parseInt(e.target.value) }
                                })}
                                className="w-full h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-accent"
                            />
                            <div className="flex justify-between text-[10px] text-text-muted">
                                <span>1K</span>
                                <span>32K</span>
                            </div>
                        </div>

                        {/* Temperature */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">Temperature</label>
                                <span className="text-xs text-text-muted font-mono">{(localConfig.parameters?.temperature || 0.7).toFixed(1)}</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={2}
                                step={0.1}
                                value={localConfig.parameters?.temperature || 0.7}
                                onChange={(e) => setLocalConfig({
                                    ...localConfig,
                                    parameters: { ...localConfig.parameters, temperature: parseFloat(e.target.value) }
                                })}
                                className="w-full h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-accent"
                            />
                            <div className="flex justify-between text-[10px] text-text-muted">
                                <span>{language === 'zh' ? '精确' : 'Precise'}</span>
                                <span>{language === 'zh' ? '创意' : 'Creative'}</span>
                            </div>
                        </div>

                        {/* Top P */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-text-secondary">Top P</label>
                                <span className="text-xs text-text-muted font-mono">{(localConfig.parameters?.topP || 1).toFixed(1)}</span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={localConfig.parameters?.topP || 1}
                                onChange={(e) => setLocalConfig({
                                    ...localConfig,
                                    parameters: { ...localConfig.parameters, topP: parseFloat(e.target.value) }
                                })}
                                className="w-full h-1.5 bg-surface rounded-full appearance-none cursor-pointer accent-accent"
                            />
                            <div className="flex justify-between text-[10px] text-text-muted">
                                <span>0</span>
                                <span>1</span>
                            </div>
                        </div>
                    </div>

                    {/* 高级设置 */}
                    <details className="group pt-2">
                        <summary className="flex items-center gap-2 text-xs font-medium text-text-muted cursor-pointer hover:text-text-primary select-none">
                            <span className="group-open:rotate-90 transition-transform">▶</span>
                            {language === 'zh' ? '高级设置' : 'Advanced Settings'}
                        </summary>
                        <div className="mt-4 space-y-4 pl-4 border-l border-border-subtle">
                            <div>
                                <label className="text-xs text-text-secondary mb-1.5 block">{language === 'zh' ? '自定义端点' : 'Custom Endpoint'}</label>
                                <Input
                                    value={localConfig.baseUrl || ''}
                                    onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value || undefined })}
                                    placeholder="https://api.example.com/v1"
                                    className="text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-text-secondary mb-1.5 block">{language === 'zh' ? '超时 (秒)' : 'Timeout (sec)'}</label>
                                <Input
                                    type="number"
                                    value={(localConfig.timeout || 120000) / 1000}
                                    onChange={(e) => setLocalConfig({ ...localConfig, timeout: (parseInt(e.target.value) || 120) * 1000 })}
                                    min={30}
                                    max={600}
                                    className="w-32 text-sm"
                                />
                            </div>
                        </div>
                    </details>

                    {/* 适配器配置（显示默认配置，支持覆盖） */}
                    <AdapterOverridesEditor
                        overrides={localProviderConfigs[localConfig.provider]?.advanced || adapterConfigToAdvanced(currentAdapterConfig, isCustomSelected)}
                        onChange={handleAdvancedConfigChange}
                        language={language}
                        defaultEndpoint={getAdapterConfig(localConfig.provider)?.request?.endpoint || '/chat/completions'}
                        defaultConfig={isCustomSelected ? currentAdapterConfig : getAdapterConfig(localConfig.provider)}
                    />
                </section>
            )}
        </div>
    )
}
