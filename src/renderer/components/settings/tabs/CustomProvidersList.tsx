/**
 * 自定义 Provider 列表组件
 * 
 * 从 providerConfigs 中读取 custom- 前缀的配置
 */

import { useState } from 'react'
import { Plus, Edit2, Trash2, Settings, ChevronRight, ChevronDown } from 'lucide-react'
import { Button } from '@components/ui'
import { useStore } from '@store'
import { CustomProviderEditor } from './CustomProviderEditor'

interface CustomProvidersListProps {
  language: 'en' | 'zh'
}

const MODE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  custom: '自定义',
}

export function CustomProvidersList({ language }: CustomProvidersListProps) {
  const { providerConfigs, removeProviderConfig } = useStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isAddingNew, setIsAddingNew] = useState(false)

  // 从 providerConfigs 中过滤出自定义厂商
  const customProviders = Object.entries(providerConfigs)
    .filter(([id]) => id.startsWith('custom-'))
    .map(([id, config]) => ({ id, config }))

  const handleDelete = (id: string, name: string) => {
    if (confirm(language === 'zh' ? `删除 ${name}？` : `Delete ${name}?`)) {
      removeProviderConfig(id)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-secondary uppercase tracking-wider flex items-center gap-2">
          <Settings className="w-4 h-4" />
          {language === 'zh' ? '自定义 Provider' : 'Custom Providers'}
        </h4>
        {!isAddingNew && (
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => setIsAddingNew(true)} 
            className="h-8 px-3 text-xs"
          >
            <Plus className="w-4 h-4 mr-1" />
            {language === 'zh' ? '添加' : 'Add'}
          </Button>
        )}
      </div>

      {/* 新增编辑器 */}
      {isAddingNew && (
        <CustomProviderEditor
          language={language}
          onSave={() => setIsAddingNew(false)}
          onCancel={() => setIsAddingNew(false)}
          isNew
        />
      )}

      {/* Provider 列表 */}
      {customProviders.length === 0 && !isAddingNew ? (
        <div className="p-6 text-center border border-dashed border-border-subtle rounded-xl bg-surface/20">
          <p className="text-sm text-text-muted">
            {language === 'zh' 
              ? '点击上方按钮添加自定义 Provider' 
              : 'Click Add to create a custom provider'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {customProviders.map(({ id, config }) => {
            const hasApiKey = !!config.apiKey
            const isEditing = editingId === id
            const displayName = config.displayName || id
            const modelCount = config.customModels?.length || 0

            return (
              <div key={id} className="space-y-2">
                {/* Provider 卡片 */}
                <div
                  className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${
                    isEditing
                      ? 'border-accent bg-accent/5'
                      : 'border-border-subtle bg-surface/30 hover:bg-surface/50 hover:border-border'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-accent">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-text-primary">
                          {displayName}
                        </span>
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-elevated border border-border-subtle text-text-muted">
                          {MODE_LABELS[config.mode || 'openai']}
                        </span>
                        {hasApiKey && (
                          <span 
                            className="w-1.5 h-1.5 rounded-full bg-green-500" 
                            title="API Key 已配置" 
                          />
                        )}
                      </div>
                      <p className="text-xs text-text-muted">
                        {modelCount} {language === 'zh' ? '个模型' : 'models'} · {config.baseUrl}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditingId(isEditing ? null : id)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        isEditing 
                          ? 'bg-accent/20 text-accent' 
                          : 'hover:bg-surface-elevated text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100'
                      }`}
                      title={language === 'zh' ? '编辑' : 'Edit'}
                    >
                      {isEditing ? <ChevronDown className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(id, displayName)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      title={language === 'zh' ? '删除' : 'Delete'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {!isEditing && (
                      <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100" />
                    )}
                  </div>
                </div>

                {/* 内联编辑器 */}
                {isEditing && (
                  <CustomProviderEditor
                    providerId={id}
                    config={config}
                    language={language}
                    onSave={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
