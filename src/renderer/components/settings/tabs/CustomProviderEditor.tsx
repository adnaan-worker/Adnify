/**
 * 自定义 Provider 编辑器 - 升级版
 * 采用全玻璃质感卡片与现代布局
 */

import { useState } from 'react'
import { ChevronDown, Plus, Zap, X, Save, Code2 } from 'lucide-react'
import { Button, Input, Select } from '@components/ui'
import { useStore } from '@store'
import type { AdvancedConfig, ApiProtocol, LLMAdapterConfig } from '@shared/config/providers'
import { BUILTIN_ADAPTERS } from '@shared/config/providers'
import { VENDOR_PRESETS } from '@shared/types/customProviderPresets'
import { toast } from '@components/common/ToastProvider'
import { AdapterOverridesEditor } from '../AdapterOverridesEditor'
import type { ProviderModelConfig } from '@renderer/types/provider'
import { generateCustomProviderId } from '@renderer/types/provider'

interface CustomProviderEditorProps {
  providerId?: string
  config?: ProviderModelConfig
  language: 'en' | 'zh'
  onSave: () => void
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

export function CustomProviderEditor({ 
  providerId, 
  config, 
  language, 
  onSave, 
  onCancel, 
  isNew = false 
}: CustomProviderEditorProps) {
  const { setProviderConfig } = useStore()

  const [name, setName] = useState(config?.displayName || '')
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || '')
  const [apiKey, setApiKey] = useState(config?.apiKey || '')
  const [models, setModels] = useState<string[]>(config?.customModels || [])
  const [newModel, setNewModel] = useState('')
  const [mode, setMode] = useState<ApiProtocol>(config?.protocol || 'openai')
  const [timeout, setTimeout] = useState(config?.timeout ? config.timeout / 1000 : 120)
  const [selectedPreset, setSelectedPreset] = useState('')

  const [advancedConfig, setAdvancedConfig] = useState<AdvancedConfig | undefined>(config?.advanced)
  const [showCustomConfig, setShowCustomConfig] = useState(false)

  const handleLoadPreset = (presetId: string) => {
    const preset = VENDOR_PRESETS[presetId]
    if (!preset) return
    
    setName(preset.name || presetId)
    setBaseUrl(preset.baseUrl || '')
    setModels(preset.models || [])
    setMode(preset.protocol || 'openai')
    if (preset.defaults?.timeout) {
      setTimeout(preset.defaults.timeout / 1000)
    }
    setSelectedPreset(presetId)

    if (preset.protocol === 'custom') {
      setShowCustomConfig(true)
    }

    if (preset.adapter) {
      const adapter = preset.adapter as LLMAdapterConfig
      setAdvancedConfig({
        request: { endpoint: adapter.request?.endpoint, bodyTemplate: adapter.request?.bodyTemplate },
        response: adapter.response ? {
          contentField: adapter.response.contentField,
          reasoningField: adapter.response.reasoningField,
          toolCallField: adapter.response.toolCallField,
          doneMarker: adapter.response.doneMarker,
        } : undefined,
      })
    }
  }

  const handleAddModel = () => {
    const trimmed = newModel.trim()
    if (trimmed && !models.includes(trimmed)) {
      setModels([...models, trimmed])
      setNewModel('')
    }
  }

  const buildAdapterConfig = (): LLMAdapterConfig => {
    const baseAdapter = BUILTIN_ADAPTERS[mode] || BUILTIN_ADAPTERS.openai
    const adapter: LLMAdapterConfig = {
      ...baseAdapter,
      id: providerId || generateCustomProviderId(),
      name: name,
      description: '自定义适配器',
      protocol: mode,
    }

    if (advancedConfig) {
      if (advancedConfig.request) {
        adapter.request = {
          ...adapter.request,
          endpoint: advancedConfig.request.endpoint || adapter.request.endpoint,
          headers: { ...adapter.request.headers, ...advancedConfig.request.headers },
          bodyTemplate: advancedConfig.request.bodyTemplate || adapter.request.bodyTemplate,
        }
      }
      if (advancedConfig.response) {
        adapter.response = {
          ...adapter.response,
          ...advancedConfig.response,
        }
      }
    }
    return adapter
  }

  const handleSave = () => {
    if (!name.trim() || !baseUrl.trim() || models.length === 0) {
      toast.error(language === 'zh' ? '请填写所有必填项' : 'Please fill in all required fields')
      return
    }

    const id = providerId || generateCustomProviderId()
    const now = Date.now()

    const newConfig: ProviderModelConfig = {
      displayName: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey || undefined,
      customModels: models,
      protocol: mode,
      timeout: timeout * 1000,
      adapterConfig: buildAdapterConfig(),
      advanced: advancedConfig,
      createdAt: config?.createdAt || now,
      updatedAt: now,
    }

    setProviderConfig(id, newConfig)
    toast.success(language === 'zh' ? '已保存' : 'Saved')
    onSave()
  }

  return (
    <div className="p-6 bg-surface/20 backdrop-blur-xl border border-accent/20 rounded-2xl space-y-6 animate-scale-in shadow-2xl">
      {/* 快速预设 */}
      {isNew && (
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-text-muted uppercase tracking-[0.2em] flex items-center gap-2 ml-1">
            <Zap className="w-3.5 h-3.5 text-yellow-500" />
            {language === 'zh' ? '快速预设' : 'Quick Preset'}
          </label>
          <Select
            value={selectedPreset}
            onChange={handleLoadPreset}
            options={[{ value: '', label: language === 'zh' ? '选择官方/社区预设...' : 'Select a preset...' }, ...VENDOR_OPTIONS]}
            className="w-full h-10 rounded-xl"
          />
        </div>
      )}

      {/* 基础信息 */}
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
            {language === 'zh' ? '提供商名称' : 'Provider Name'} *
          </label>
          <Input 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
            placeholder="e.g. DeepSeek" 
            className="h-10 rounded-xl bg-black/20" 
          />
        </div>
        <div className="space-y-2">
          <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
            {language === 'zh' ? '协议模式' : 'Protocol Mode'} *
          </label>
          <Select 
            value={mode} 
            onChange={(v) => setMode(v as ApiProtocol)} 
            options={MODE_OPTIONS} 
            className="h-10 rounded-xl" 
          />
        </div>
      </div>

      {/* API URL */}
      <div className="space-y-2">
        <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">API Endpoint URL *</label>
        <Input 
          value={baseUrl} 
          onChange={(e) => setBaseUrl(e.target.value)} 
          placeholder="https://api.provider.com/v1" 
          className="h-10 rounded-xl bg-black/20 font-mono text-xs" 
        />
      </div>

      {/* API Key */}
      <div className="space-y-2">
        <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">API Authentication Key</label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="h-10 rounded-xl bg-black/20 font-mono"
        />
      </div>

      {/* 模型列表 */}
      <div className="space-y-2">
        <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
          {language === 'zh' ? '模型名称列表' : 'Available Models'} *
        </label>
        <div className="flex gap-2">
          <Input
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder={language === 'zh' ? '输入模型 ID 并回车...' : 'Model ID...'}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddModel())}
            className="flex-1 h-10 rounded-xl bg-black/20"
          />
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleAddModel} 
            disabled={!newModel.trim()} 
            className="h-10 px-4 rounded-xl"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {models.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 p-3 bg-black/20 rounded-xl border border-border">
            {models.map((model) => (
              <div 
                key={model} 
                className="flex items-center gap-2 px-3 py-1 bg-surface/40 rounded-full border border-border text-[11px] font-bold text-text-secondary transition-all hover:border-accent/30 shadow-sm"
              >
                <span>{model}</span>
                <button 
                  onClick={() => setModels(models.filter((m) => m !== model))} 
                  className="text-text-muted hover:text-red-400 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 完全自定义模式配置 */}
      {mode === 'custom' && (
        <div className="border border-accent/20 rounded-2xl overflow-hidden shadow-xl animate-scale-in">
          <button
            onClick={() => setShowCustomConfig(!showCustomConfig)}
            className="w-full flex items-center gap-3 px-5 py-4 bg-accent/5 hover:bg-accent/10 transition-all group"
          >
            <ChevronDown className={`w-4 h-4 text-accent transition-transform duration-300 ${showCustomConfig ? '' : '-rotate-90'}`} />
            <Code2 className="w-4 h-4 text-accent" />
            <span className="text-sm font-bold text-text-primary uppercase tracking-tight">
              {language === 'zh' ? '高级适配器映射配置' : 'Full Adapter Mapping'}
            </span>
          </button>
          {showCustomConfig && (
            <div className="p-6 bg-black/20 border-t border-accent/10 shadow-inner">
              <AdapterOverridesEditor 
                overrides={advancedConfig} 
                onChange={setAdvancedConfig} 
                language={language} 
                defaultEndpoint="/chat/completions"
                fullCustomMode={true}
                defaultSupportsVision={false}
              />
            </div>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex justify-end gap-3 pt-4 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-10 px-6 rounded-xl font-bold uppercase tracking-widest text-[11px]">
          {language === 'zh' ? '取消' : 'Cancel'}
        </Button>
        <Button size="sm" onClick={handleSave} className="h-10 px-8 rounded-xl font-bold uppercase tracking-widest text-[11px] shadow-lg shadow-accent/20">
          <Save className="w-4 h-4 mr-2" />
          {language === 'zh' ? '保存提供商' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

export { CustomProviderEditor as InlineProviderEditor }