/**
 * Provider 设置组件
 * 
 * 重构后版本：移除 CustomProviderEditor 和 AdapterOverridesEditor 依赖
 * 使用内联表单添加自定义厂商，使用 AI SDK 原生配置
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash, Eye, EyeOff, Check, AlertTriangle, X, Server, Sliders, Box, RefreshCw } from 'lucide-react'
import { PROVIDERS, type ApiProtocol, getProviderDefaultHeaders } from '@/shared/config/providers'
import { LLM_DEFAULTS } from '@/shared/config/defaults'
import { toast } from '@components/common/ToastProvider'
import { Button, Input, Select, ScrollShadow, Switch } from '@components/ui'
import { ProviderSettingsProps } from '../types'
import { isCustomProvider } from '@renderer/types/provider'

// 内置厂商 ID
const BUILTIN_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'deepseek', 'groq']

// 协议类型选项
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'openai-responses', label: 'OpenAI Responses API' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'custom', label: 'Custom' },
]

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
      const result = await checkProviderHealth(localConfig.provider, localConfig.apiKey, localConfig.baseUrl, localConfig.protocol)
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
      <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-9 px-4 text-xs font-medium">
        {testing ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {language === 'zh' ? '测试中...' : 'Testing...'}
          </span>
        ) : (
          language === 'zh' ? '测试连接' : 'Test Connection'
        )}
      </Button>
      {status === 'success' && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full border border-emerald-400/20">
          <Check className="w-3 h-3" />
          {language === 'zh' ? '连接成功' : 'Connected'}
        </span>
      )}
      {status === 'error' && (
        <span className="flex items-center gap-1.5 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-1 rounded-full border border-red-400/20" title={errorMsg}>
          <AlertTriangle className="w-3 h-3" />
          {errorMsg.length > 30 ? errorMsg.slice(0, 30) + '...' : errorMsg}
        </span>
      )}
    </div>
  )
}

function TestModelButton({ localConfig, language }: { localConfig: any; language: 'en' | 'zh' }) {
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    if (!localConfig.apiKey && localConfig.provider !== 'ollama') {
      toast.error(language === 'zh' ? '请先输入 API Key' : 'Please enter API Key first')
      return
    }
    if (!localConfig.model) {
      toast.error(language === 'zh' ? '请先选择或输入模型' : 'Please select or enter a model first')
      return
    }

    setTesting(true)
    try {
      const { testModelCall } = await import('@/renderer/services/healthCheckService')
      const result = await testModelCall(localConfig)

      if (result.success) {
        const message = language === 'zh'
          ? `调用成功！延时: ${result.latency}ms, 结果: ${result.content}`
          : `Call success! Latency: ${result.latency}ms, Result: ${result.content}`
        toast.success(message)
      } else {
        const errorMsg = result.error || 'Test failed'
        toast.error(language === 'zh' ? `调用失败: ${errorMsg}` : `Call failed: ${errorMsg}`)
      }
    } catch (err: any) {
      toast.error(err.message || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-9 px-4 text-xs font-medium">
      {testing ? (
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {language === 'zh' ? '调用中...' : 'Calling...'}
        </span>
      ) : (
        language === 'zh' ? '测试模型调用' : 'Test Model Call'
      )}
    </Button>
  )
}

function FetchModelsButton({
  provider,
  apiKey,
  baseUrl,
  protocol,
  language,
  existingModels = [],
  onModelsFetched,
  onModelRemoved,
  onBatchRemoved
}: {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  protocol?: string;
  language: 'en' | 'zh';
  existingModels?: string[];
  onModelsFetched: (models: string[]) => void;
  onModelRemoved?: (model: string) => void;
  onBatchRemoved?: (models: string[]) => void;
}) {
  const [fetching, setFetching] = useState(false)
  const [showList, setShowList] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleFetch = async () => {
    if (!apiKey && provider !== 'ollama') {
      toast.error(language === 'zh' ? '请先输入 API Key' : 'Please enter API Key first')
      return
    }

    // 计算位置
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }

    setFetching(true)
    setSearchQuery('')
    try {
      const { fetchModelsCall } = await import('@/renderer/services/healthCheckService')
      const result = await fetchModelsCall(provider, apiKey, baseUrl, protocol)
      if (result.success && result.models) {
        setFetchedModels(result.models)
        setShowList(true)
        if (result.models.length === 0) {
          toast.info(language === 'zh' ? '未找到可用模型' : 'No models found')
        }
      } else {
        toast.error(language === 'zh' ? `获取失败: ${result.error}` : `Fetch failed: ${result.error}`)
      }
    } catch (err: any) {
      toast.error(err.message || 'Fetch failed')
    } finally {
      setFetching(false)
    }
  }

  // 点击外部关闭列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // 还要检查是否点击了 portal 里的内容
        const portal = document.getElementById('fetch-models-portal')
        if (portal && portal.contains(event.target as Node)) return
        setShowList(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 监听滚动和调整大小以更新位置
  useEffect(() => {
    if (!showList) return

    const updateCoords = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setCoords({
          top: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width
        })
      }
    }

    window.addEventListener('scroll', updateCoords, true)
    window.addEventListener('resize', updateCoords)
    return () => {
      window.removeEventListener('scroll', updateCoords, true)
      window.removeEventListener('resize', updateCoords)
    }
  }, [showList])

  // 搜索过滤
  const filteredModels = searchQuery
    ? fetchedModels.filter(m => m.toLowerCase().includes(searchQuery.toLowerCase()))
    : fetchedModels

  const dropdownMenu = showList && fetchedModels.length > 0 && createPortal(
    <div
      id="fetch-models-portal"
      className="fixed z-[9999] mt-2 w-72 overflow-hidden bg-surface border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col"
      style={{
        top: coords.top,
        left: Math.max(10, coords.left + coords.width - 288),
        maxHeight: Math.min(384, window.innerHeight - coords.top - 24), // 动态计算：视口底部留 24px 安全边距
      }}
    >
      {/* 搜索和统计 */}
      <div className="p-2 border-b border-border bg-background/50 flex-shrink-0 space-y-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={language === 'zh' ? '搜索模型...' : 'Search models...'}
          className="w-full px-2.5 py-1.5 text-xs bg-surface/50 border border-border rounded-lg outline-none focus:border-accent/50 transition-colors text-text-primary placeholder:text-text-muted"
          autoFocus
        />
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">
            {searchQuery
              ? (language === 'zh' ? `匹配 ${filteredModels.length}/${fetchedModels.length}` : `${filteredModels.length}/${fetchedModels.length} matched`)
              : (language === 'zh' ? `共 ${fetchedModels.length} 个模型` : `${fetchedModels.length} models`)
            }
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const toAdd = filteredModels.filter(m => !existingModels.includes(m))
                if (toAdd.length > 0) onModelsFetched(toAdd)
              }}
              className="text-[9px] text-accent hover:text-accent-hover px-1.5 py-0.5 rounded hover:bg-accent/10 transition-colors"
            >
              {language === 'zh' ? '全选' : 'All'}
            </button>
            <button
              onClick={() => {
                const toRemove = filteredModels.filter(m => existingModels.includes(m))
                if (toRemove.length > 0) onBatchRemoved?.(toRemove)
              }}
              className="text-[9px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-400/10 transition-colors"
            >
              {language === 'zh' ? '全取消' : 'None'}
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
        {filteredModels.map(model => {
          const isAdded = existingModels.includes(model)
          return (
            <button
              key={model}
              onClick={() => {
                if (isAdded) {
                  onModelRemoved?.(model)
                } else {
                  onModelsFetched([model])
                }
              }}
              className={`w-full text-left px-3 py-1.5 text-[11px] rounded-lg transition-all flex items-center justify-between group mb-0.5 ${isAdded
                ? 'text-accent bg-accent/5 hover:bg-accent/10'
                : 'text-text-secondary hover:text-accent hover:bg-accent/5 active:scale-[0.98]'
                }`}
            >
              <span className="truncate mr-2 flex-1">{model}</span>
              {isAdded ? (
                <Check className="w-3 h-3" />
              ) : (
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-accent" />
              )}
            </button>
          )
        })}
      </div>
      <div className="p-1.5 border-t border-border bg-background/50 flex-shrink-0 flex gap-2">
        <button
          onClick={() => {
            const addedModels = fetchedModels.filter(m => existingModels.includes(m))
            if (addedModels.length > 0) {
              onBatchRemoved?.(addedModels)
            }
            setShowList(false)
          }}
          className="flex-1 py-1.5 text-[10px] font-bold text-text-muted hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-colors uppercase flex items-center justify-center gap-1.5 border border-transparent hover:border-red-400/20"
        >
          <Trash className="w-3 h-3" />
          {language === 'zh' ? '全部清空' : 'Clear All'}
        </button>
        <button
          onClick={() => {
            const toAdd = fetchedModels.filter(m => !existingModels.includes(m))
            if (toAdd.length > 0) {
              onModelsFetched(toAdd)
            }
            setShowList(false)
          }}
          className="flex-1 py-1.5 text-[10px] font-bold bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors uppercase flex items-center justify-center gap-1.5 shadow-lg shadow-accent/20"
        >
          <Check className="w-3 h-3" />
          {language === 'zh' ? '全部添加' : 'Add All'}
        </button>
      </div>
    </div>,
    document.body
  )

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="sm"
        onClick={handleFetch}
        disabled={fetching}
        className="h-8 px-2.5 flex items-center gap-1.5"
        title={language === 'zh' ? '从 API 获取模型列表' : 'Fetch models from API'}
      >
        <RefreshCw className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
        <span className="text-[10px] font-semibold">{language === 'zh' ? '获取模型' : 'Fetch Models'}</span>
      </Button>

      {dropdownMenu}
    </div>
  )
}

// 内联的添加自定义 Provider 表单
function InlineCustomProviderForm({
  language,
  onSave,
  onCancel
}: {
  language: 'en' | 'zh'
  onSave: (config: { displayName: string; baseUrl: string; apiKey: string; protocol: string; model: string; customModels: string[] }) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [protocol, setProtocol] = useState('openai')
  const [model, setModel] = useState('')
  const [customModels, setCustomModels] = useState<string[]>([])

  const handleSubmit = () => {
    if (!displayName.trim() || !baseUrl.trim()) {
      toast.error(language === 'zh' ? '请填写名称和 API 端点' : 'Please enter name and API endpoint')
      return
    }
    onSave({
      displayName: displayName.trim(),
      baseUrl: baseUrl.trim(),
      apiKey,
      protocol,
      model: model.trim() || customModels[0] || '',
      customModels: [...new Set([...customModels, ...(model ? [model] : [])])]
    })
  }

  const handleFetchModels = (models: string[]) => {
    const newModels = models.filter(m => !customModels.includes(m))
    if (newModels.length > 0) {
      setCustomModels([...customModels, ...newModels])
      if (!model && newModels.length > 0) {
        setModel(newModels[0])
      }
      toast.success(language === 'zh' ? `已获取并添加 ${newModels.length} 个模型` : `Fetched and added ${newModels.length} models`)
    }
  }

  const handleBatchRemoveModels = (models: string[]) => {
    const remaining = customModels.filter(m => !models.includes(m))
    setCustomModels(remaining)
    if (models.includes(model)) {
      setModel(remaining[0] || '')
    }
    toast.success(language === 'zh' ? `已清空 ${models.length} 个模型` : `Cleared ${models.length} models`)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {language === 'zh' ? '显示名称' : 'Display Name'}
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={language === 'zh' ? '例如: 智谱 GLM' : 'e.g. My Provider'}
            className="bg-background/50 border-border text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {language === 'zh' ? '协议类型' : 'Protocol'}
          </label>
          <Select
            value={protocol}
            onChange={setProtocol}
            options={PROTOCOL_OPTIONS}
            className="bg-background/50 border-border"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">
          {language === 'zh' ? 'API 端点' : 'API Endpoint'}
        </label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className="bg-background/50 border-border font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">API Key</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="bg-background/50 border-border font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-secondary">
              {language === 'zh' ? '默认模型' : 'Default Model'}
            </label>
            <FetchModelsButton
              provider="custom"
              apiKey={apiKey}
              baseUrl={baseUrl}
              protocol={protocol}
              language={language}
              existingModels={customModels}
              onModelsFetched={handleFetchModels}
              onModelRemoved={(m) => setCustomModels(customModels.filter(x => x !== m))}
              onBatchRemoved={handleBatchRemoveModels}
            />
          </div>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={language === 'zh' ? '例如: gpt-4 (支持逗号分隔)' : 'e.g. gpt-4 (Supports comma)'}
            className="bg-background/50 border-border text-xs"
          />
        </div>
      </div>

      {customModels.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {language === 'zh' ? `已添加模型 (${customModels.length})` : `Added Models (${customModels.length})`}
          </label>
          <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 bg-background/30 rounded-xl border border-border/50 custom-scrollbar">
            {customModels.map(m => (
              <div key={m} className="group flex items-center gap-1.5 px-2 py-1 bg-surface/50 rounded-md border border-border text-xs text-text-secondary hover:border-accent/30 transition-all">
                <span className="truncate max-w-[150px]">{m}</span>
                <button
                  onClick={() => setCustomModels(customModels.filter(x => x !== m))}
                  className="text-text-muted hover:text-red-400 opacity-50 group-hover:opacity-100 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {language === 'zh' ? '取消' : 'Cancel'}
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit}>
          {language === 'zh' ? '添加' : 'Add'}
        </Button>
      </div>
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
  setProvider,
}: ProviderSettingsProps) {
  const [newModelName, setNewModelName] = useState('')
  const [isAddingCustom, setIsAddingCustom] = useState(false)
  const [logitBiasString, setLogitBiasString] = useState('')

  // Headers 状态
  const [customHeaders, setCustomHeaders] = useState<Array<{ key: string; value: string }>>([])

  // 从 localProviderConfigs 获取自定义厂商列表
  const customProviders = useMemo(() => {
    return Object.entries(localProviderConfigs)
      .filter(([id]) => isCustomProvider(id))
      .map(([id, config]) => ({ id, config }))
  }, [localProviderConfigs])

  // 当前选中的是自定义 Provider 吗？
  const isCustomSelected = isCustomProvider(localConfig.provider)
  const selectedCustomConfig = isCustomSelected ? localProviderConfigs[localConfig.provider] : null

  // 获取当前 provider 的协议（用于获取默认请求头）
  const getCurrentProtocol = (): ApiProtocol | undefined => {
    if (isCustomSelected && selectedCustomConfig) {
      return selectedCustomConfig.protocol
    }
    return undefined // 内置 provider 不需要传协议
  }

  // Sync logitBiasString with localConfig
  useEffect(() => {
    setLogitBiasString(localConfig.logitBias ? JSON.stringify(localConfig.logitBias, null, 2) : '')
  }, [localConfig.logitBias])

  // 不再使用 useEffect 同步，而是在初始化时设置
  // customHeaders 只用于额外的请求头，不包括默认请求头

  // 添加模型到本地配置
  const handleAddModel = (name?: string) => {
    const modelName = name || newModelName
    if (!modelName.trim()) return

    const namesToAdd = modelName.split(',').map(s => s.trim()).filter(Boolean)
    handleBatchAddModels(namesToAdd)
    if (!name) setNewModelName('')
  }

  // 批量添加模型
  const handleBatchAddModels = (models: string[]) => {
    if (models.length === 0) return

    const currentConfig = localProviderConfigs[localConfig.provider] || {}
    const currentModels = currentConfig.customModels || []

    // 过滤掉已存在的
    const newModels = models.filter(n => !currentModels.includes(n))
    if (newModels.length === 0) return

    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        customModels: [...currentModels, ...newModels]
      }
    }

    setLocalProviderConfigs(updatedConfigs)
    setProvider(localConfig.provider, updatedConfigs[localConfig.provider])

    toast.success(language === 'zh' ? `已添加 ${newModels.length} 个模型` : `Added ${newModels.length} models`)
  }

  // 删除模型从本地配置
  const handleRemoveModel = (model: string) => {
    handleBatchRemoveModels([model])
  }

  // 批量删除模型
  const handleBatchRemoveModels = (models: string[]) => {
    const currentConfig = localProviderConfigs[localConfig.provider]
    if (!currentConfig) return

    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        customModels: (currentConfig.customModels || []).filter(m => !models.includes(m))
      }
    }

    setLocalProviderConfigs(updatedConfigs)
    setProvider(localConfig.provider, updatedConfigs[localConfig.provider])

    if (models.length === 1) {
      toast.success(language === 'zh' ? `已删除模型: ${models[0]}` : `Removed model: ${models[0]}`)
    } else {
      toast.success(language === 'zh' ? `已清空 ${models.length} 个模型` : `Cleared ${models.length} models`)
    }
  }

  // 选择内置 Provider
  const handleSelectBuiltinProvider = (providerId: string, skipSaveCurrent = false) => {
    // 保存当前配置（仅当当前 provider 未被删除时）
    let updatedConfigs = localProviderConfigs
    if (!skipSaveCurrent && (localProviderConfigs[localConfig.provider] || BUILTIN_PROVIDER_IDS.includes(localConfig.provider))) {
      updatedConfigs = {
        ...localProviderConfigs,
        [localConfig.provider]: {
          ...localProviderConfigs[localConfig.provider],
          apiKey: localConfig.apiKey,
          baseUrl: localConfig.baseUrl,
          timeout: localConfig.timeout,
          model: localConfig.model,
          headers: localConfig.headers,
          protocol: localConfig.protocol,
        },
      }
      setLocalProviderConfigs(updatedConfigs)
    }

    // 加载新 Provider 配置
    const nextConfig = updatedConfigs[providerId] || {}
    const providerInfo = PROVIDERS[providerId]
    setLocalConfig({
      ...localConfig,
      provider: providerId as any,
      apiKey: nextConfig.apiKey || '',
      baseUrl: nextConfig.baseUrl || providerInfo?.baseUrl || '',
      timeout: nextConfig.timeout || providerInfo?.defaults.timeout || 120000,
      model: nextConfig.model || providerInfo?.models[0] || '',
      headers: nextConfig.headers,
      protocol: nextConfig.protocol || providerInfo?.protocol,
    })
    setIsAddingCustom(false)
  }

  // 选择自定义 Provider
  const handleSelectCustomProvider = (id: string) => {
    // 保存当前配置（包括 headers）
    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...localProviderConfigs[localConfig.provider],
        apiKey: localConfig.apiKey,
        baseUrl: localConfig.baseUrl,
        timeout: localConfig.timeout,
        model: localConfig.model,
        headers: localConfig.headers,  // 保存当前 provider 的 headers
      },
    }
    setLocalProviderConfigs(updatedConfigs)

    // 获取自定义厂商配置（从更新后的配置中获取）
    const customConfig = updatedConfigs[id] || {}
    const models = customConfig.customModels || []

    setLocalConfig({
      ...localConfig,
      provider: id as any,
      apiKey: customConfig.apiKey || '',
      baseUrl: customConfig.baseUrl || '',
      timeout: customConfig.timeout || 120000,
      model: customConfig.model || models[0] || '',
      headers: customConfig.headers,  // 加载新 provider 的 headers
      protocol: customConfig.protocol, // 增加协议同步
    })
    setIsAddingCustom(false)
  }

  // 添加自定义 Provider（只更新本地状态）
  const handleAddCustomProvider = (config: { displayName: string; baseUrl: string; apiKey: string; protocol: string; model: string; customModels: string[] }) => {
    const id = `custom-${Date.now()}`
    const newConfig = {
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      protocol: config.protocol as ApiProtocol,
      model: config.model,
      customModels: config.customModels || (config.model ? [config.model] : []),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // 只更新本地状态，保存时由 SettingsModal 统一处理
    setLocalProviderConfigs({
      ...localProviderConfigs,
      [id]: newConfig
    })

    toast.success(language === 'zh' ? `已添加 ${config.displayName}` : `Added ${config.displayName}`)
    setIsAddingCustom(false)

    // 自动选择新添加的 Provider
    setLocalConfig({
      ...localConfig,
      provider: id as any,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: 120000,
      model: config.model,
      protocol: config.protocol as ApiProtocol, // 增加协议同步
    })
  }

  // 删除自定义 Provider（只更新本地状态）
  const handleDeleteCustomProvider = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    const { globalConfirm } = await import('@components/common/ConfirmDialog')
    const confirmed = await globalConfirm({
      title: language === 'zh' ? '删除提供商' : 'Delete Provider',
      message: language === 'zh' ? `删除 ${name}？` : `Delete ${name}?`,
      variant: 'danger',
    })
    if (confirmed) {
      // 如果当前选中的是被删除的 provider，先切换到默认（跳过保存当前配置）
      if (localConfig.provider === id) {
        handleSelectBuiltinProvider('openai', true)
      }

      // 从本地配置中删除（放在切换之后，确保不会被重新创建）
      setLocalProviderConfigs(prev => {
        const { [id]: _, ...rest } = prev
        return rest
      })
    }
  }

  const builtinProviders = providers.filter((p) => BUILTIN_PROVIDER_IDS.includes(p.id))

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Provider 选择器 */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Box className="w-4 h-4 text-accent" />
          <h4 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
            {language === 'zh' ? '选择提供商' : 'Select Provider'}
          </h4>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* 内置厂商 */}
          {builtinProviders.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectBuiltinProvider(p.id)}
              className={`group relative flex flex-col items-center justify-center p-5 rounded-2xl border transition-all duration-300 ${localConfig.provider === p.id
                ? 'border-accent bg-accent/5 text-accent shadow-xl shadow-accent/5 ring-1 ring-accent/20'
                : 'border-border bg-surface/30 text-text-secondary hover:bg-surface/50 hover:border-accent/30 hover:text-text-primary'
                }`}
            >
              <span className={`font-bold text-sm ${localConfig.provider === p.id ? 'text-text-primary' : ''}`}>{p.name}</span>
              {localConfig.provider === p.id && (
                <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </div>
              )}
            </button>
          ))}

          {/* 自定义 Provider */}
          {customProviders.map(({ id, config }) => {
            const displayName = config.displayName || id
            return (
              <div
                key={id}
                onClick={() => handleSelectCustomProvider(id)}
                className={`group relative flex flex-col items-center justify-center p-5 rounded-2xl border transition-all duration-300 cursor-pointer ${localConfig.provider === id
                  ? 'border-accent bg-accent/5 text-accent shadow-xl shadow-accent/5 ring-1 ring-accent/20'
                  : 'border-border bg-surface/30 text-text-secondary hover:bg-surface/50 hover:border-accent/30 hover:text-text-primary'
                  }`}
              >
                <span className={`font-bold text-sm truncate w-full text-center ${localConfig.provider === id ? 'text-text-primary' : ''}`}>{displayName}</span>
                {localConfig.provider === id && (
                  <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </div>
                )}
                <button
                  onClick={(e) => handleDeleteCustomProvider(e, id, displayName)}
                  className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center rounded-full bg-background border border-border text-text-muted shadow-xl opacity-0 group-hover:opacity-100 hover:text-red-500 hover:border-red-500/30 transition-all scale-90 hover:scale-100 z-10"
                  title={language === 'zh' ? '删除' : 'Delete'}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}

          {/* 添加按钮 */}
          <button
            onClick={() => setIsAddingCustom(true)}
            className={`flex flex-col items-center justify-center p-5 rounded-2xl border-2 border-dashed transition-all duration-300 ${isAddingCustom
              ? 'border-accent bg-accent/5 text-accent shadow-inner'
              : 'border-border bg-white/5 text-text-muted hover:border-accent/50 hover:text-accent hover:bg-accent/5'
              }`}
          >
            <Plus className="w-6 h-6 mb-1" />
            <span className="text-xs font-bold uppercase tracking-tighter">{language === 'zh' ? '添加自定义' : 'Add Custom'}</span>
          </button>
        </div>

        {/* 添加新 Provider 表单 */}
        {isAddingCustom && (
          <div className="mt-6 p-6 rounded-2xl bg-surface/30 border border-border animate-slide-down">
            <div className="flex justify-between items-center mb-4">
              <h5 className="text-sm font-medium text-text-primary">
                {language === 'zh' ? '添加新提供商' : 'Add New Provider'}
              </h5>
              <Button variant="ghost" size="sm" onClick={() => setIsAddingCustom(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <InlineCustomProviderForm
              language={language}
              onSave={handleAddCustomProvider}
              onCancel={() => setIsAddingCustom(false)}
            />
          </div>
        )}
      </section>

      {/* 配置区域（非添加模式时显示） */}
      {!isAddingCustom && (
        <div className="space-y-6">
          {/* 上方两列：模型配置 + 生成参数 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 左列：模型配置 */}
            <section className="p-5 bg-surface/30 rounded-xl border border-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Box className="w-4 h-4 text-accent" />
                  <h5 className="text-sm font-medium text-text-primary">
                    {language === 'zh' ? '模型配置' : 'Model Configuration'}
                  </h5>
                </div>
                <FetchModelsButton
                  provider={localConfig.provider}
                  apiKey={localConfig.apiKey}
                  baseUrl={localConfig.baseUrl}
                  protocol={isCustomSelected ? selectedCustomConfig?.protocol : localConfig.protocol}
                  language={language}
                  existingModels={(() => {
                    const models = new Set<string>()
                    if (isCustomSelected && selectedCustomConfig) {
                      (selectedCustomConfig.customModels || []).forEach(m => models.add(m))
                    } else if (selectedProvider) {
                      selectedProvider.models.forEach(m => models.add(m))
                    }
                    const localCustomModels = localProviderConfigs[localConfig.provider]?.customModels || []
                    localCustomModels.forEach(m => models.add(m))
                    return Array.from(models)
                  })()}
                  onModelsFetched={(models) => {
                    handleBatchAddModels(models)
                  }}
                  onModelRemoved={(m) => handleRemoveModel(m)}
                  onBatchRemoved={(models) => handleBatchRemoveModels(models)}
                />
              </div>

              <ScrollShadow maxHeight="500px" className="pr-2">
                <div className="space-y-4 pr-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-secondary">
                      {language === 'zh' ? '选择模型' : 'Select Model'}
                    </label>
                    <Select
                      value={localConfig.model}
                      onChange={(value) => setLocalConfig({ ...localConfig, model: value })}
                      options={(() => {
                        const modelsSet = new Set<string>()

                        // 1. 获取当前 provider 的内置模型或自定义配置的基础模型
                        if (isCustomSelected && selectedCustomConfig) {
                          (selectedCustomConfig.customModels || []).forEach((m) => modelsSet.add(m))
                        } else if (selectedProvider) {
                          selectedProvider.models.forEach((m) => modelsSet.add(m))
                        }

                        // 2. 获取本地存储的额外自定义模型
                        const localCustomModels = localProviderConfigs[localConfig.provider]?.customModels || []
                        localCustomModels.forEach((m) => modelsSet.add(m))

                        // 3. 确保当前选中的模型也在列表中
                        if (localConfig.model) {
                          modelsSet.add(localConfig.model)
                        }

                        return Array.from(modelsSet).map((m) => ({ value: m, label: m }))
                      })()}
                      className="w-full bg-background/50 border-border"
                    />
                  </div>

                  {/* 添加自定义模型 */}
                  <div className="pt-2">
                    <div className="flex gap-2">
                      <Input
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                        placeholder={language === 'zh' ? '输入模型名称 (支持逗号分隔)...' : 'Enter model names (Supports comma)...'}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                        className="flex-1 h-9 text-xs bg-background/50 border-border"
                      />
                      <Button variant="secondary" size="sm" onClick={() => handleAddModel()} disabled={!newModelName.trim()} className="h-9 px-3">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>

                    {(localProviderConfigs[localConfig.provider]?.customModels?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {localProviderConfigs[localConfig.provider]?.customModels?.map((model: string) => (
                          <div
                            key={model}
                            className="group flex items-center gap-1.5 px-2 py-1 bg-surface/50 rounded-md border border-border text-xs text-text-secondary hover:border-border"
                          >
                            <span>{model}</span>
                            <button
                              onClick={() => handleRemoveModel(model)}
                              className="text-text-muted hover:text-red-400 opacity-50 group-hover:opacity-100 transition-opacity"
                            >
                              <Trash className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollShadow>
            </section>

            {/* 右列：生成参数 */}
            <section className="p-5 bg-surface/30 rounded-xl border border-border">
              <div className="flex items-center gap-2 mb-4">
                <Sliders className="w-4 h-4 text-accent" />
                <h5 className="text-sm font-medium text-text-primary">
                  {language === 'zh' ? '生成参数' : 'Generation Parameters'}
                </h5>
              </div>

              <ScrollShadow maxHeight="500px" className="pr-2">
                <div className="space-y-5 pr-2">

                  {/* Max Tokens */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-text-secondary">{language === 'zh' ? '最大 Token' : 'Max Tokens'}</label>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1024}
                      max={32768}
                      step={1024}
                      value={localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        maxTokens: parseInt(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Temperature */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-text-secondary">
                        {language === 'zh' ? '随机性 (Temperature)' : 'Temperature'}
                      </label>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.temperature ?? LLM_DEFAULTS.temperature).toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={localConfig.temperature ?? LLM_DEFAULTS.temperature}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        temperature: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                    <div className="flex justify-between text-[10px] text-text-muted px-1">
                      <span>{language === 'zh' ? '精确' : 'Precise'}</span>
                      <span>{language === 'zh' ? '创意' : 'Creative'}</span>
                    </div>
                  </div>

                  {/* Top P */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Top P</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '核采样：仅考虑累积概率达到 P 的 Token 集合'
                            : 'Nucleus sampling: considers tokens with top_p probability mass'}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.topP ?? LLM_DEFAULTS.topP).toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={localConfig.topP ?? LLM_DEFAULTS.topP}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        topP: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Top K */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Top K</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '仅从概率最高的 K 个 Token 中采样'
                            : 'Limits selection to the top K tokens'}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {localConfig.topK ?? 'Default'}
                      </span>
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={localConfig.topK ?? ''}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        topK: e.target.value ? parseInt(e.target.value) : undefined
                      })}
                      placeholder="Default"
                      className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                    />
                  </div>

                  {/* 深度思考模式 */}
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5 flex-1">
                        <label className="text-xs font-medium text-text-secondary">
                          {language === 'zh' ? '深度思考模式' : 'Extended Thinking'}
                        </label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '启用后，模型会进行更深入的推理（如 Claude thinking, OpenAI o1/o3）'
                            : 'Enable deeper reasoning (e.g., Claude thinking, OpenAI o1/o3)'}
                        </p>
                      </div>
                      <Switch
                        checked={localConfig.enableThinking}
                        onChange={(e) => setLocalConfig({ ...localConfig, enableThinking: e.target.checked })}
                        className="flex-shrink-0"
                      />
                    </div>

                    {/* 思考模式详细配置 - 仅在启用时展示 */}
                    {localConfig.enableThinking && (
                      <div className="space-y-3 pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
                        {/* 推理深度 */}
                        <div className="space-y-2">
                          <div className="space-y-0.5">
                            <label className="text-xs text-text-secondary">
                              {language === 'zh' ? '推理深度' : 'Reasoning Effort'}
                            </label>
                            <p className="text-[10px] text-text-muted">
                              {language === 'zh'
                                ? 'OpenAI / Gemini 3 使用此参数控制推理深度'
                                : 'Controls reasoning depth for OpenAI / Gemini 3'}
                            </p>
                          </div>
                          <Select
                            options={[
                              { value: 'low', label: language === 'zh' ? '低' : 'Low' },
                              { value: 'medium', label: language === 'zh' ? '中' : 'Medium' },
                              { value: 'high', label: language === 'zh' ? '高' : 'High' },
                            ]}
                            value={localConfig.reasoningEffort || 'medium'}
                            onChange={(val) => setLocalConfig({ ...localConfig, reasoningEffort: val as 'low' | 'medium' | 'high' })}
                          />
                        </div>

                        {/* Thinking Budget */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <label className="text-xs text-text-secondary">
                                {language === 'zh' ? '思考 Token 预算' : 'Thinking Budget'}
                              </label>
                              <p className="text-[10px] text-text-muted">
                                {language === 'zh'
                                  ? 'Anthropic / Gemini 2.5 使用此参数控制思考 token 上限'
                                  : 'Max thinking tokens for Anthropic / Gemini 2.5'}
                              </p>
                            </div>
                            <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                              {(localConfig.thinkingBudget || 10000).toLocaleString()}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={1024}
                            max={100000}
                            step={1024}
                            value={localConfig.thinkingBudget || 10000}
                            onChange={(e) => setLocalConfig({
                              ...localConfig,
                              thinkingBudget: parseInt(e.target.value)
                            })}
                            className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                          />
                          <div className="flex justify-between text-[10px] text-text-muted px-1">
                            <span>1K</span>
                            <span>100K</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Frequency Penalty */}
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Frequency Penalty</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '根据 Token 出现频率降低其重复概率'
                            : 'Penalizes tokens based on their frequency in the text'}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.frequencyPenalty || 0).toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={0.1}
                      value={localConfig.frequencyPenalty || 0}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        frequencyPenalty: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Presence Penalty */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Presence Penalty</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '根据 Token 是否出现过降低其重复概率'
                            : 'Penalizes tokens based on their presence in the text'}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {(localConfig.presencePenalty || 0).toFixed(1)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-2}
                      max={2}
                      step={0.1}
                      value={localConfig.presencePenalty || 0}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        presencePenalty: parseFloat(e.target.value)
                      })}
                      className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                    />
                  </div>

                  {/* Seed */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Seed</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '固定随机种子以获得可重现的结果'
                            : 'Fixed seed for reproducible outputs'}
                        </p>
                      </div>
                      <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                        {localConfig.seed ?? 'Random'}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={localConfig.seed ?? ''}
                      onChange={(e) => setLocalConfig({
                        ...localConfig,
                        seed: e.target.value ? parseInt(e.target.value) : undefined
                      })}
                      placeholder="Random"
                      className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                    />
                  </div>

                  {/* Stop Sequences */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Stop Sequences</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '遇到这些字符时停止生成'
                            : 'Stop generation when these sequences are encountered'}
                        </p>
                      </div>
                      <span className="text-[10px] text-text-muted bg-background/50 px-1.5 py-0.5 rounded">
                        Comma separated
                      </span>
                    </div>
                    <input
                      type="text"
                      value={localConfig.stopSequences?.join(', ') || ''}
                      onChange={(e) => {
                        const val = e.target.value
                        setLocalConfig({
                          ...localConfig,
                          stopSequences: val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined
                        })
                      }}
                      placeholder="e.g. \n, User:"
                      className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                    />
                  </div>

                  {/* Logit Bias */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">Logit Bias (JSON)</label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '调整特定 Token 出现的概率 (-100 到 100)'
                            : 'Modify likelihood of specific tokens (-100 to 100)'}
                        </p>
                      </div>
                      <span className="text-[10px] text-text-muted bg-background/50 px-1.5 py-0.5 rounded">
                        Token ID: Bias
                      </span>
                    </div>
                    <textarea
                      value={logitBiasString}
                      onChange={(e) => setLogitBiasString(e.target.value)}
                      onBlur={() => {
                        try {
                          if (!logitBiasString.trim()) {
                            setLocalConfig({ ...localConfig, logitBias: undefined })
                            return
                          }
                          const parsed = JSON.parse(logitBiasString)
                          if (typeof parsed === 'object' && parsed !== null) {
                            setLocalConfig({ ...localConfig, logitBias: parsed })
                          }
                        } catch {
                          // Invalid JSON
                        }
                      }}
                      placeholder='{"50256": -100}'
                      className="w-full h-20 bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all font-mono"
                    />
                  </div>

                  {/* Custom Headers */}
                  <div className="space-y-3 pt-3 border-t border-border/50">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-xs text-text-secondary">
                          {language === 'zh' ? '自定义请求头' : 'Custom Headers'}
                        </label>
                        <p className="text-[10px] text-text-muted">
                          {language === 'zh'
                            ? '添加额外的 HTTP 请求头（如组织 ID、项目 ID 等）'
                            : 'Add extra HTTP headers (e.g., organization ID, project ID, etc.)'}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setCustomHeaders([...customHeaders, { key: '', value: '' }])
                        }}
                        className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 flex-shrink-0"
                      >
                        <Plus className="w-3 h-3" />
                        {language === 'zh' ? '添加' : 'Add'}
                      </button>
                    </div>

                    {/* 默认请求头（可编辑） */}
                    {(() => {
                      const protocol = getCurrentProtocol()
                      const defaultHeaders = getProviderDefaultHeaders(localConfig.provider, protocol)
                      const defaultKeys = Object.keys(defaultHeaders)

                      return defaultKeys.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '默认请求头（可修改）' : 'Default Headers (Editable)'}
                          </div>
                          {defaultKeys.map((key) => {
                            const defaultValue = defaultHeaders[key]
                            const currentValue = localConfig.headers?.[key] ?? defaultValue
                            return (
                              <div key={key} className="p-3 bg-surface/20 rounded-lg border border-accent/20 space-y-2">
                                <div className="flex items-center justify-between">
                                  <Input
                                    type="text"
                                    value={key}
                                    onChange={(e) => {
                                      const newKey = e.target.value
                                      if (!newKey) return

                                      // 重命名 key
                                      const newHeaders = { ...localConfig.headers }
                                      delete newHeaders[key]
                                      newHeaders[newKey] = currentValue
                                      setLocalConfig({
                                        ...localConfig,
                                        headers: newHeaders
                                      })
                                    }}
                                    className="flex-1 bg-background/50 border-border text-xs font-mono h-8"
                                  />
                                  <span className="text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20 flex-shrink-0 ml-2">
                                    {language === 'zh' ? '默认' : 'Default'}
                                  </span>
                                </div>
                                <Input
                                  type="text"
                                  value={currentValue}
                                  onChange={(e) => {
                                    const newHeaders = { ...localConfig.headers, [key]: e.target.value }
                                    setLocalConfig({
                                      ...localConfig,
                                      headers: newHeaders
                                    })
                                  }}
                                  placeholder={defaultValue}
                                  className="bg-background/50 border-border text-xs font-mono h-8"
                                />
                                <p className="text-[10px] text-text-muted">
                                  {language === 'zh'
                                    ? '使用 {{apiKey}} 作为 API Key 的占位符'
                                    : 'Use {{apiKey}} as placeholder for API Key'}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {/* 自定义请求头 */}
                    {customHeaders.length > 0 && (
                      <div className="space-y-2">
                        {Object.keys(getProviderDefaultHeaders(localConfig.provider, getCurrentProtocol())).length > 0 && (
                          <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                            {language === 'zh' ? '额外请求头' : 'Additional Headers'}
                          </div>
                        )}
                        {customHeaders.map((header, index) => (
                          <div key={index} className="space-y-1.5 p-2.5 bg-background/30 rounded-lg border border-border/50">
                            <div className="flex items-start gap-2">
                              <div className="flex-1 space-y-1.5">
                                <Select
                                  value={header.key}
                                  onChange={(value) => {
                                    const newHeaders = [...customHeaders]
                                    newHeaders[index].key = value
                                    setCustomHeaders(newHeaders)
                                    // 更新 localConfig - 合并默认请求头和自定义请求头
                                    const protocol = getCurrentProtocol()
                                    const defaultHeaders = getProviderDefaultHeaders(localConfig.provider, protocol)
                                    const customHeadersObj: Record<string, string> = {}
                                    newHeaders.forEach(h => {
                                      if (h.key && h.key !== 'X-Custom-Header') {
                                        customHeadersObj[h.key] = h.value || ''
                                      }
                                    })
                                    // 合并：默认请求头 + 自定义请求头（自定义会覆盖默认）
                                    const allHeaders = { ...defaultHeaders, ...customHeadersObj }
                                    setLocalConfig({
                                      ...localConfig,
                                      headers: Object.keys(allHeaders).length > 0 ? allHeaders : undefined
                                    })
                                  }}
                                  options={[
                                    { value: '', label: language === 'zh' ? '选择请求头' : 'Select header' },
                                    { value: 'X-Request-ID', label: 'X-Request-ID' },
                                    { value: 'X-Organization', label: 'X-Organization' },
                                    { value: 'X-Project-ID', label: 'X-Project-ID' },
                                    { value: 'User-Agent', label: 'User-Agent' },
                                    { value: 'Content-Type', label: 'Content-Type' },
                                    { value: 'Accept', label: 'Accept' },
                                    { value: 'X-Custom-Header', label: language === 'zh' ? '自定义...' : 'Custom...' }
                                  ]}
                                  className="w-full bg-surface-active border-border text-xs h-8"
                                />
                                {header.key === 'X-Custom-Header' && (
                                  <Input
                                    type="text"
                                    value=""
                                    onChange={(e) => {
                                      const newHeaders = [...customHeaders]
                                      newHeaders[index].key = e.target.value
                                      setCustomHeaders(newHeaders)
                                    }}
                                    placeholder={language === 'zh' ? '请求头名称' : 'Header name'}
                                    className="bg-surface-active border-border text-xs font-mono h-8"
                                  />
                                )}
                                <Input
                                  type="text"
                                  value={header.value}
                                  onChange={(e) => {
                                    const newHeaders = [...customHeaders]
                                    newHeaders[index].value = e.target.value
                                    setCustomHeaders(newHeaders)
                                    // 更新 localConfig - 合并默认请求头和自定义请求头
                                    const protocol = getCurrentProtocol()
                                    const defaultHeaders = getProviderDefaultHeaders(localConfig.provider, protocol)
                                    const customHeadersObj: Record<string, string> = {}
                                    newHeaders.forEach(h => {
                                      if (h.key && h.key !== 'X-Custom-Header') {
                                        customHeadersObj[h.key] = h.value || ''
                                      }
                                    })
                                    const allHeaders = { ...defaultHeaders, ...customHeadersObj }
                                    setLocalConfig({
                                      ...localConfig,
                                      headers: Object.keys(allHeaders).length > 0 ? allHeaders : undefined
                                    })
                                  }}
                                  placeholder={language === 'zh' ? '值' : 'Value'}
                                  className="bg-surface-active border-border text-xs font-mono h-8"
                                />
                              </div>
                              <button
                                onClick={() => {
                                  const newHeaders = customHeaders.filter((_, i) => i !== index)
                                  setCustomHeaders(newHeaders)
                                  // 更新 localConfig - 合并默认请求头和自定义请求头
                                  const protocol = getCurrentProtocol()
                                  const defaultHeaders = getProviderDefaultHeaders(localConfig.provider, protocol)
                                  const customHeadersObj: Record<string, string> = {}
                                  newHeaders.forEach(h => {
                                    if (h.key && h.key !== 'X-Custom-Header') {
                                      customHeadersObj[h.key] = h.value || ''
                                    }
                                  })
                                  const allHeaders = { ...defaultHeaders, ...customHeadersObj }
                                  setLocalConfig({
                                    ...localConfig,
                                    headers: Object.keys(allHeaders).length > 0 ? allHeaders : undefined
                                  })
                                }}
                                className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors flex-shrink-0 mt-0.5"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {customHeaders.length === 0 && Object.keys(getProviderDefaultHeaders(localConfig.provider, getCurrentProtocol())).length === 0 && (
                      <div className="text-[10px] text-text-muted bg-background/50 px-3 py-2 rounded-lg border border-border text-center">
                        {language === 'zh'
                          ? '点击"添加"按钮添加自定义请求头'
                          : 'Click "Add" to add custom headers'}
                      </div>
                    )}
                  </div>
                </div>
              </ScrollShadow>
            </section>
          </div>

          {/* 下方全宽：认证 & 网络配置 */}
          <section className="p-6 bg-surface/30 rounded-xl border border-border">
            <div className="flex items-center gap-2 mb-5">
              <Server className="w-4 h-4 text-accent" />
              <h5 className="text-sm font-medium text-text-primary">
                {language === 'zh' ? '认证 & 网络配置' : 'Authentication & Network'}
              </h5>
            </div>

            {/* 基础配置：三列布局 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">
              {/* API Key */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary">
                  API Key
                </label>
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={localConfig.apiKey}
                  onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                  placeholder={PROVIDERS[localConfig.provider]?.auth.placeholder || 'sk-...'}
                  className="bg-background/50 border-border font-mono text-xs"
                  rightIcon={
                    <button onClick={() => setShowApiKey(!showApiKey)} className="text-text-muted hover:text-text-primary">
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                />
              </div>

              {/* API 端点 */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? 'API 端点' : 'API Endpoint'}
                </label>
                <Input
                  value={localConfig.baseUrl || ''}
                  onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value || undefined })}
                  placeholder="https://api.example.com/v1"
                  className="bg-background/50 border-border text-xs font-mono"
                />
              </div>

              {/* 超时时间 */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '超时时间 (秒)' : 'Timeout (seconds)'}
                </label>
                <Input
                  type="number"
                  value={(localConfig.timeout || 120000) / 1000}
                  onChange={(e) => setLocalConfig({ ...localConfig, timeout: (parseInt(e.target.value) || 120) * 1000 })}
                  min={10}
                  max={600}
                  className="bg-background/50 border-border text-xs"
                />
              </div>
            </div>

            {/* OpenAI API 协议选择（仅内置 OpenAI provider 显示） */}
            {localConfig.provider === 'openai' && (
              <div className="mt-4 pt-4 border-t border-border/50">
                <div className="space-y-2">
                  <div className="space-y-0.5">
                    <label className="text-xs font-medium text-text-secondary">
                      {language === 'zh' ? 'API 协议' : 'API Protocol'}
                    </label>
                    <p className="text-[10px] text-text-muted">
                      {language === 'zh'
                        ? 'Chat Completions 适用于 GPT 系列，Responses API 适用于 o1/o3/o4 等推理模型'
                        : 'Chat Completions for GPT series, Responses API for reasoning models like o1/o3/o4'}
                    </p>
                  </div>
                  <Select
                    value={localConfig.protocol || 'openai'}
                    onChange={(value) => setLocalConfig({ ...localConfig, protocol: value as ApiProtocol })}
                    options={[
                      { value: 'openai', label: 'Chat Completions (/v1/chat/completions)' },
                      { value: 'openai-responses', label: 'Responses API (/v1/responses)' },
                    ]}
                    className="w-full max-w-md bg-background/50 border-border"
                  />
                </div>
              </div>
            )}

            {/* 操作按钮行 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TestConnectionButton localConfig={localConfig} language={language} />
                <TestModelButton localConfig={localConfig} language={language} />
                {!isCustomSelected && PROVIDERS[localConfig.provider]?.auth.helpUrl && (
                  <a
                    href={PROVIDERS[localConfig.provider]?.auth.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-text-muted hover:text-accent hover:underline flex items-center gap-1"
                  >
                    {language === 'zh' ? '获取 Key' : 'Get Key'} <span className="opacity-50">↗</span>
                  </a>
                )}
              </div>
              <p className="text-[10px] text-text-muted">
                {language === 'zh' ? '留空端点使用默认值，超时建议 60-300 秒' : 'Leave endpoint empty for default, timeout recommended 60-300s'}
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
