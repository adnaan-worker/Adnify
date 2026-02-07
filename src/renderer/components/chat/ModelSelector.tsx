/**
 * 模型选择器组件
 * 支持按厂商分组选择模型，包括内置厂商和自定义厂商
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useStore } from '@store'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/config/providers'

// Provider 图标映射
const PROVIDER_ICONS: Record<string, string> = {
  openai: '🤖',
  anthropic: '🧠',
  gemini: '✨',
  deepseek: '🔍',
  groq: '⚡',
  mistral: '🌀',
  ollama: '🦙',
}

interface ModelGroup {
  providerId: string
  providerName: string
  models: Array<{ id: string; name: string; isCustom?: boolean }>
}

interface ModelSelectorProps {
  className?: string
}

export default function ModelSelector({ className = '' }: ModelSelectorProps) {
  const { llmConfig, update, providerConfigs } = useStore()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // 检查 Provider 是否有可用的 API Key
  const hasApiKey = useCallback((providerId: string) => {
    const config = providerConfigs[providerId]
    if (config?.apiKey) return true
    return llmConfig.provider === providerId && !!llmConfig.apiKey
  }, [llmConfig, providerConfigs])

  // 构建分组的模型列表
  const groupedModels = useMemo<ModelGroup[]>(() => {
    const groups: ModelGroup[] = []

    for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      if (!hasApiKey(providerId)) continue

      const providerConfig = providerConfigs[providerId]
      const customModels = providerConfig?.customModels || []
      const builtinModelIds = new Set(provider.models)

      const models = [
        ...provider.models.map(id => ({ id, name: id })),
        ...customModels
          .filter(id => !builtinModelIds.has(id))
          .map(id => ({ id, name: id, isCustom: true })),
      ]

      if (models.length > 0) {
        groups.push({ providerId, providerName: provider.displayName, models })
      }
    }

    for (const [providerId, config] of Object.entries(providerConfigs)) {
      if (!providerId.startsWith('custom-')) continue
      if (!config?.apiKey) continue

      const modelIds = config.customModels || []
      if (modelIds.length === 0) continue

      const models = modelIds.map(id => ({ id, name: id }))
      const providerName = config.displayName || providerId

      groups.push({ providerId, providerName, models })
    }

    return groups
  }, [providerConfigs, hasApiKey])

  // 选择模型
  const handleSelectModel = useCallback((providerId: string, modelId: string) => {
    const builtinProvider = getBuiltinProvider(providerId)
    const config = providerConfigs[providerId]

    const newConfig: Partial<typeof llmConfig> = { provider: providerId, model: modelId }

    if (builtinProvider) {
      newConfig.apiKey = config?.apiKey || (llmConfig.provider === providerId ? llmConfig.apiKey : undefined)
      newConfig.baseUrl = config?.baseUrl || builtinProvider.baseUrl
    } else if (providerId.startsWith('custom-') && config) {
      newConfig.apiKey = config.apiKey || (llmConfig.provider === providerId ? llmConfig.apiKey : undefined)
      newConfig.baseUrl = config.baseUrl
    }

    update('llmConfig', newConfig)
    setIsOpen(false)
  }, [llmConfig, providerConfigs, update])

  const getIcon = (providerId: string) => PROVIDER_ICONS[providerId] || '🔮'

  if (groupedModels.length === 0) return null

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium border
          transition-all duration-200
          ${isOpen
            ? 'bg-surface text-text-primary border-accent/30 shadow-[0_0_0_2px_rgba(var(--accent)/0.1)]'
            : 'bg-surface/50 border-border text-text-secondary hover:text-text-primary hover:bg-surface hover:border-border-active'
          }
        `}
      >
        <span className="text-[10px] grayscale opacity-80">{getIcon(llmConfig.provider)}</span>
        <span className="max-w-[120px] truncate" title={llmConfig.model}>
          {llmConfig.model.split('/').pop()}
        </span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 max-h-80 overflow-y-auto bg-surface border border-border rounded-xl shadow-2xl z-50 animate-scale-in">
          {groupedModels.map(group => (
            <div key={group.providerId}>
              <div className="sticky top-0 px-3 py-2 text-[10px] font-bold text-text-muted/80 uppercase tracking-wider bg-surface/95 backdrop-blur-sm border-b border-border/50">
                <span className="mr-1.5 grayscale">{getIcon(group.providerId)}</span>
                {group.providerName}
              </div>
              <div className="py-1">
                {group.models.map(model => {
                  const isSelected = llmConfig.provider === group.providerId && llmConfig.model === model.id
                  return (
                    <button
                      key={`${group.providerId}-${model.id}`}
                      onClick={() => handleSelectModel(group.providerId, model.id)}
                      className={`
                        w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors
                        ${isSelected ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
                      `}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{model.name}</span>
                        {model.isCustom && (
                          <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] bg-purple-500/10 text-purple-500 rounded border border-purple-500/20">
                            Custom
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
