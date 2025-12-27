/**
 * 自定义 Provider 列表组件 (内联编辑版)
 * 使用内联展开式编辑，不再使用弹窗
 */

import { useState } from 'react'
import { Plus, Edit2, Trash2, Settings, ChevronRight, ChevronDown } from 'lucide-react'
import { Button } from '@components/ui'
import { useStore } from '@store'
import type { CustomProviderConfig } from '@shared/config/providers'
import { InlineProviderEditor } from './CustomProviderEditor'

interface CustomProvidersListProps {
    language: 'en' | 'zh'
    onSelectProvider?: (provider: CustomProviderConfig) => void
}

const MODE_LABELS: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    custom: '自定义',
}

export function CustomProvidersList({ language, onSelectProvider }: CustomProvidersListProps) {
    const { customProviders, removeCustomProvider, getProviderApiKey } = useStore()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [isAddingNew, setIsAddingNew] = useState(false)

    const handleDelete = (provider: CustomProviderConfig) => {
        if (confirm(language === 'zh' ? `删除 ${provider.name}？` : `Delete ${provider.name}?`)) {
            removeCustomProvider(provider.id)
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
                    <Button variant="secondary" size="sm" onClick={() => setIsAddingNew(true)} className="h-8 px-3 text-xs">
                        <Plus className="w-4 h-4 mr-1" />
                        {language === 'zh' ? '添加' : 'Add'}
                    </Button>
                )}
            </div>

            {/* 新增编辑器 (内联展开) */}
            {isAddingNew && (
                <InlineProviderEditor
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
                        {language === 'zh' ? '点击上方按钮添加自定义 Provider' : 'Click Add to create a custom provider'}
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {customProviders.map((provider) => {
                        const hasApiKey = !!getProviderApiKey(provider.id)
                        const isEditing = editingId === provider.id

                        return (
                            <div key={provider.id} className="space-y-2">
                                {/* Provider 卡片 */}
                                <div
                                    className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${isEditing
                                            ? 'border-accent bg-accent/5'
                                            : 'border-border-subtle bg-surface/30 hover:bg-surface/50 hover:border-border cursor-pointer'
                                        }`}
                                    onClick={() => !isEditing && onSelectProvider?.(provider)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                                            <span className="text-sm font-bold text-accent">{provider.name.charAt(0).toUpperCase()}</span>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm text-text-primary">{provider.name}</span>
                                                <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-elevated border border-border-subtle text-text-muted">
                                                    {MODE_LABELS[provider.mode]}
                                                </span>
                                                {hasApiKey && <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="API Key 已配置" />}
                                            </div>
                                            <p className="text-xs text-text-muted">{provider.models.length} 模型 · {provider.baseUrl}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setEditingId(isEditing ? null : provider.id) }}
                                            className={`p-1.5 rounded-lg transition-colors ${isEditing ? 'bg-accent/20 text-accent' : 'hover:bg-surface-elevated text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100'}`}
                                            title={language === 'zh' ? '编辑' : 'Edit'}
                                        >
                                            {isEditing ? <ChevronDown className="w-4 h-4" /> : <Edit2 className="w-4 h-4" />}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(provider) }}
                                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                            title={language === 'zh' ? '删除' : 'Delete'}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                        {!isEditing && <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100" />}
                                    </div>
                                </div>

                                {/* 内联编辑器 (仅当编辑时展开) */}
                                {isEditing && (
                                    <InlineProviderEditor
                                        provider={provider}
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
