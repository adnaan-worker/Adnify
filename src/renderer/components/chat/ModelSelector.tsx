/**
 * 模型选择器组件
 * 支持先选择供应商，再选择该供应商下的模型
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/config/providers'

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
  const { llmConfig, update, providerConfigs } = useStore(useShallow(s => ({ llmConfig: s.llmConfig, update: s.update, providerConfigs: s.providerConfigs })))
  const [isProviderOpen, setIsProviderOpen] = useState(false)
  const [isModelOpen, setIsModelOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isProviderOpen && !isModelOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsProviderOpen(false)
        setIsModelOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isProviderOpen, isModelOpen])

  const hasApiKey = useCallback((providerId: string) => {
    const config = providerConfigs[providerId]
    if (config?.apiKey) return true
    return llmConfig.provider === providerId && !!llmConfig.apiKey
  }, [llmConfig, providerConfigs])

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

  const getIcon = useCallback((providerId: string) => {
    return PROVIDER_ICONS[providerId] || '🔮'
  }, [])

  const currentProviderGroup = useMemo(() => {
    return groupedModels.find(group => group.providerId === llmConfig.provider) || groupedModels[0]
  }, [groupedModels, llmConfig.provider])

  const currentModel = useMemo(() => {
    if (!currentProviderGroup) return null
    return currentProviderGroup.models.find(model => model.id === llmConfig.model) || currentProviderGroup.models[0] || null
  }, [currentProviderGroup, llmConfig.model])

  const applyProviderConfig = useCallback((providerId: string, modelId: string) => {
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
  }, [llmConfig, providerConfigs, update])

  const handleSelectProvider = useCallback((providerId: string) => {
    const targetGroup = groupedModels.find(group => group.providerId === providerId)
    const nextModelId = targetGroup?.models[0]?.id
    if (!nextModelId) return

    applyProviderConfig(providerId, nextModelId)
    setIsProviderOpen(false)
    setIsModelOpen(false)
  }, [applyProviderConfig, groupedModels])

  const handleSelectModel = useCallback((modelId: string) => {
    if (!currentProviderGroup) return

    applyProviderConfig(currentProviderGroup.providerId, modelId)
    setIsModelOpen(false)
  }, [applyProviderConfig, currentProviderGroup])

  if (!currentProviderGroup || !currentModel) return null

  return (
    <div ref={containerRef} className={`relative flex items-center gap-2 ${className}`}>
      <div className="relative">
        <button
          onClick={() => {
            setIsProviderOpen((prev) => !prev)
            setIsModelOpen(false)
          }}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium border border-transparent
            transition-all duration-200 max-w-[130px]
            ${isProviderOpen
              ? 'bg-surface-active text-text-primary shadow-[0_0_0_2px_rgba(var(--accent)/0.15)]'
              : 'bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.08]'
            }
          `}
        >
          <span className="text-[10px] grayscale opacity-80">{getIcon(currentProviderGroup.providerId)}</span>
          <span className="truncate" title={currentProviderGroup.providerName}>
            {currentProviderGroup.providerName}
          </span>
          <ChevronDown className={`w-3 h-3 text-text-muted transition-transform flex-shrink-0 ${isProviderOpen ? 'rotate-180' : ''}`} />
        </button>

        {isProviderOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-48 max-h-72 overflow-y-auto bg-surface border border-border rounded-xl shadow-2xl z-50 py-1 animate-scale-in">
            {groupedModels.map(group => {
              const isSelected = currentProviderGroup.providerId === group.providerId
              return (
                <button
                  key={group.providerId}
                  onClick={() => handleSelectProvider(group.providerId)}
                  className={`
                    w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors
                    ${isSelected
                      ? 'bg-accent/10 text-accent font-medium'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                    }
                  `}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] grayscale opacity-80 flex-shrink-0">{getIcon(group.providerId)}</span>
                    <span className="truncate">{group.providerName}</span>
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => {
            setIsModelOpen((prev) => !prev)
            setIsProviderOpen(false)
          }}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium border border-transparent
            transition-all duration-200
            ${isModelOpen
              ? 'bg-surface-active text-text-primary shadow-[0_0_0_2px_rgba(var(--accent)/0.15)]'
              : 'bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.08]'
            }
          `}
        >
          <span className="max-w-[120px] truncate" title={currentModel.name}>
            {currentModel.name.split('/').pop()}
          </span>
          <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isModelOpen ? 'rotate-180' : ''}`} />
        </button>

        {isModelOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-64 max-h-80 overflow-y-auto bg-surface border border-border rounded-xl shadow-2xl z-50 animate-scale-in">
            <div className="sticky top-0 px-3 py-2 text-[10px] font-bold text-text-muted/80 uppercase tracking-wider bg-surface/95 backdrop-blur-sm border-b border-border/50">
              <span className="mr-1.5 grayscale">{getIcon(currentProviderGroup.providerId)}</span>
              {currentProviderGroup.providerName}
            </div>
            <div className="py-1">
              {currentProviderGroup.models.map(model => {
                const isSelected = llmConfig.provider === currentProviderGroup.providerId && llmConfig.model === model.id
                return (
                  <button
                    key={`${currentProviderGroup.providerId}-${model.id}`}
                    onClick={() => handleSelectModel(model.id)}
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
        )}
      </div>
    </div>
  )
}
