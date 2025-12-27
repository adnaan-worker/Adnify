/**
 * 自定义 Provider 编辑器（内联版本）
 * 
 * 仅用于新建自定义 Provider，支持：
 * - 兼容模式（OpenAI/Anthropic/Gemini）
 * - 完全自定义模式
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash, Zap, X, Save, Code2 } from 'lucide-react'
import { Button, Input, Select } from '@components/ui'
import { useStore } from '@store'
import type { CustomProviderConfig, AdvancedConfig, ProviderMode, CustomModeConfig, AuthType } from '@shared/config/providers'
import { VENDOR_PRESETS, validateCustomProviderConfig } from '@shared/types/customProviderPresets'
import { toast } from '@components/common/ToastProvider'
import { AdapterOverridesEditor } from '../AdapterOverridesEditor'

interface InlineProviderEditorProps {
    provider?: CustomProviderConfig  // 编辑现有 provider 时传入
    language: 'en' | 'zh'
    onSave: (config: CustomProviderConfig) => void
    onCancel: () => void
    isNew?: boolean
}

const MODE_OPTIONS = [
    { value: 'openai', label: 'OpenAI 兼容' },
    { value: 'anthropic', label: 'Anthropic 兼容' },
    { value: 'gemini', label: 'Gemini 兼容' },
    { value: 'custom', label: '完全自定义' },
]

const VENDOR_OPTIONS = Object.entries(VENDOR_PRESETS).map(([id, preset]) => ({
    value: id,
    label: preset.name || id,
}))

export function InlineProviderEditor({ provider, language, onSave, onCancel, isNew = false }: InlineProviderEditorProps) {
    const { addCustomProvider, setProviderApiKey } = useStore()

    // 基础状态 - 如果有 provider 则使用其值初始化
    const [name, setName] = useState(provider?.name || '')
    const [baseUrl, setBaseUrl] = useState(provider?.baseUrl || '')
    const [apiKey, setApiKey] = useState('')
    const [models, setModels] = useState<string[]>(provider?.models || [])
    const [newModel, setNewModel] = useState('')
    const [mode, setMode] = useState<ProviderMode>(provider?.mode || 'openai')
    const [timeout, setTimeout] = useState(120)
    const [selectedPreset, setSelectedPreset] = useState('')

    // 自定义模式配置
    const [advancedConfig, setAdvancedConfig] = useState<AdvancedConfig | undefined>(undefined)
    const [showCustomConfig, setShowCustomConfig] = useState(false)

    // 从厂商预设加载
    const handleLoadPreset = (presetId: string) => {
        const preset = VENDOR_PRESETS[presetId]
        if (preset) {
            setName(preset.name || presetId)
            setBaseUrl(preset.baseUrl || '')
            setModels(preset.models || [])
            setMode(preset.mode || 'openai')
            if (preset.defaults?.timeout) {
                setTimeout(preset.defaults.timeout / 1000)
            }
            setSelectedPreset(presetId)

            if (preset.customConfig) {
                const cfg = preset.customConfig
                setAdvancedConfig({
                    request: { endpoint: cfg.request.endpoint, bodyTemplate: cfg.request.bodyTemplate },
                    response: {
                        contentField: cfg.response.streaming.contentField,
                        reasoningField: cfg.response.streaming.reasoningField,
                        toolCallField: cfg.response.streaming.toolCallsField,
                        doneMarker: cfg.response.sseConfig.doneMarker,
                    },
                    auth: { type: cfg.auth.type as AuthType, headerName: cfg.auth.headerName },
                })
            }
        }
    }

    const handleAddModel = () => {
        if (newModel.trim() && !models.includes(newModel.trim())) {
            setModels([...models, newModel.trim()])
            setNewModel('')
        }
    }

    // 构建 customConfig
    const buildCustomConfig = (): CustomModeConfig | undefined => {
        if (mode !== 'custom') return undefined
        if (!advancedConfig) return undefined

        return {
            request: {
                endpoint: advancedConfig.request?.endpoint || '/chat/completions',
                method: 'POST',
                bodyTemplate: advancedConfig.request?.bodyTemplate || {
                    model: '{{model}}',
                    messages: '{{messages}}',
                    stream: true,
                },
            },
            response: {
                sseConfig: { dataPrefix: 'data: ', doneMarker: advancedConfig.response?.doneMarker || '[DONE]' },
                streaming: {
                    contentField: advancedConfig.response?.contentField || 'delta.content',
                    reasoningField: advancedConfig.response?.reasoningField,
                    toolCallsField: advancedConfig.response?.toolCallField,
                    toolNameField: 'function.name',
                    toolArgsField: 'function.arguments',
                    toolIdField: 'id',
                    finishReasonField: 'finish_reason',
                },
                toolCall: { mode: 'streaming' },
            },
            auth: { type: advancedConfig.auth?.type || 'bearer', headerName: advancedConfig.auth?.headerName },
        }
    }

    const handleSave = () => {
        const customConfig = mode === 'custom' ? buildCustomConfig() : undefined

        if (mode === 'custom' && !customConfig) {
            toast.error(language === 'zh' ? '请配置自定义参数' : 'Please configure custom parameters')
            return
        }

        const config: Partial<CustomProviderConfig> = {
            id: `custom-${Date.now()}`,
            name,
            baseUrl,
            models,
            mode,
            customConfig,
            defaults: { maxTokens: 8192, temperature: 0.7, topP: 1, timeout: timeout * 1000 },
        }

        const validation = validateCustomProviderConfig(config)
        if (!validation.valid) {
            toast.error(validation.errors.join(', '))
            return
        }

        addCustomProvider(config as CustomProviderConfig)
        toast.success(language === 'zh' ? '已添加' : 'Added')

        if (apiKey) {
            setProviderApiKey(config.id!, apiKey)
        }

        onSave(config as CustomProviderConfig)
    }

    const isCustomMode = mode === 'custom'

    return (
        <div className="p-4 bg-surface-elevated border border-accent/30 rounded-xl space-y-4 animate-fade-in">
            {/* 快速预设 */}
            {isNew && (
                <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-yellow-500" />
                        {language === 'zh' ? '快速预设' : 'Quick Preset'}
                    </label>
                    <Select
                        value={selectedPreset}
                        onChange={handleLoadPreset}
                        options={[{ value: '', label: language === 'zh' ? '选择预设...' : 'Select...' }, ...VENDOR_OPTIONS]}
                        className="text-sm"
                    />
                </div>
            )}

            {/* 基础信息 */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '名称' : 'Name'} *</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="DeepSeek" className="text-sm h-9" />
                </div>
                <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '模式' : 'Mode'} *</label>
                    <Select value={mode} onChange={(v) => setMode(v as ProviderMode)} options={MODE_OPTIONS} className="text-sm" />
                </div>
            </div>

            {/* API URL */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">API URL *</label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" className="text-sm h-9" />
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">API Key</label>
                <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={language === 'zh' ? '输入 API Key' : 'Enter API Key'}
                    className="text-sm h-9"
                />
            </div>

            {/* 模型列表 */}
            <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '模型列表' : 'Models'} *</label>
                <div className="flex gap-2">
                    <Input
                        value={newModel}
                        onChange={(e) => setNewModel(e.target.value)}
                        placeholder={language === 'zh' ? '添加模型...' : 'Add model...'}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                        className="flex-1 text-sm h-9"
                    />
                    <Button variant="secondary" size="sm" onClick={handleAddModel} disabled={!newModel.trim()} className="h-9 px-3">
                        <Plus className="w-4 h-4" />
                    </Button>
                </div>
                {models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {models.map((model) => (
                            <div key={model} className="flex items-center gap-1 px-2 py-0.5 bg-surface rounded-full border border-border-subtle text-xs">
                                <span>{model}</span>
                                <button onClick={() => setModels(models.filter((m) => m !== model))} className="text-text-muted hover:text-red-400">
                                    <Trash className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 完全自定义模式配置 */}
            {isCustomMode && (
                <div className="border border-accent/20 rounded-lg overflow-hidden">
                    <button
                        onClick={() => setShowCustomConfig(!showCustomConfig)}
                        className="w-full flex items-center gap-2 px-4 py-3 bg-accent/5 hover:bg-accent/10 transition-colors"
                    >
                        {showCustomConfig ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        <Code2 className="w-4 h-4 text-accent" />
                        <span className="text-sm font-medium text-text-primary">
                            {language === 'zh' ? '自定义请求/响应配置' : 'Custom Request/Response Config'}
                        </span>
                        <span className="ml-auto text-xs text-accent">{language === 'zh' ? '必填' : 'Required'}</span>
                    </button>
                    {showCustomConfig && (
                        <div className="p-4 bg-surface/30">
                            <AdapterOverridesEditor overrides={advancedConfig} onChange={setAdvancedConfig} language={language} defaultEndpoint="/chat/completions" />
                        </div>
                    )}
                </div>
            )}

            {/* 非自定义模式的高级设置 */}
            {!isCustomMode && (
                <details className="group">
                    <summary className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary cursor-pointer">
                        {language === 'zh' ? '高级设置' : 'Advanced'}
                    </summary>
                    <div className="mt-2 pl-4 border-l border-border-subtle">
                        <label className="text-xs text-text-secondary">{language === 'zh' ? '超时 (秒)' : 'Timeout (sec)'}</label>
                        <Input type="number" value={timeout} onChange={(e) => setTimeout(parseInt(e.target.value) || 120)} min={30} max={600} className="w-24 text-sm h-8 mt-1" />
                    </div>
                </details>
            )}

            {/* 操作按钮 */}
            <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
                <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 px-3">
                    <X className="w-4 h-4 mr-1" />
                    {language === 'zh' ? '取消' : 'Cancel'}
                </Button>
                <Button size="sm" onClick={handleSave} className="h-8 px-3">
                    <Save className="w-4 h-4 mr-1" />
                    {language === 'zh' ? '保存' : 'Save'}
                </Button>
            </div>
        </div>
    )
}
