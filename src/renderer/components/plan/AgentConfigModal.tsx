/**
 * AgentConfigModal - 智能体配置弹窗
 * 
 * 集成系统配置的模型和角色选择
 */

import { useState, useMemo } from 'react'
import { Bot, Sparkles, ChevronDown } from 'lucide-react'
import { useStore } from '@store'
import { Modal } from '../ui/Modal'
import { BUILTIN_PROVIDERS } from '@/shared/config/providers'
import { PROMPT_TEMPLATES } from '@/renderer/agent/prompts/promptTemplates'
import { isCustomProvider } from '@renderer/types/provider'
import type { PlanAgentConfig } from '@renderer/store/slices/planSlice'

interface AgentConfigModalProps {
    mode: 'create' | 'edit'
    defaultName?: string
    defaultConfig: Partial<PlanAgentConfig>
    onConfirm: (name: string, config: PlanAgentConfig) => void
    onClose: () => void
}

export function AgentConfigModal({
    mode,
    defaultName = '',
    defaultConfig,
    onConfirm,
    onClose,
}: AgentConfigModalProps) {
    const { language, llmConfig, providerConfigs } = useStore()

    const [name, setName] = useState(defaultName)
    const [providerId, setProviderId] = useState(defaultConfig.providerId || llmConfig.provider)
    const [model, setModel] = useState(defaultConfig.model || llmConfig.model)
    const [templateId, setTemplateId] = useState(defaultConfig.templateId || 'default')
    const [customPrompt, setCustomPrompt] = useState(defaultConfig.systemPrompt || '')
    const [temperature, setTemperature] = useState(defaultConfig.temperature ?? 0.7)

    // 获取所有可用的 providers（内置 + 自定义）
    const availableProviders = useMemo(() => {
        const providers: Array<{ id: string; name: string; isCustom: boolean }> = []

        // 内置 providers
        Object.values(BUILTIN_PROVIDERS).forEach(p => {
            providers.push({ id: p.id, name: p.displayName, isCustom: false })
        })

        // 自定义 providers
        Object.entries(providerConfigs).forEach(([id, config]) => {
            if (isCustomProvider(id)) {
                providers.push({
                    id,
                    name: config.displayName || id.replace('custom-', ''),
                    isCustom: true
                })
            }
        })

        return providers
    }, [providerConfigs])

    // 获取当前 provider 可用的模型
    const availableModels = useMemo(() => {
        const models: string[] = []

        // 内置模型
        const builtin = BUILTIN_PROVIDERS[providerId]
        if (builtin) {
            models.push(...builtin.models)
        }

        // 用户自定义模型
        const userConfig = providerConfigs[providerId]
        if (userConfig?.customModels) {
            userConfig.customModels.forEach(m => {
                if (!models.includes(m)) models.push(m)
            })
        }

        return models
    }, [providerId, providerConfigs])

    // 当 provider 变化时，更新默认模型
    const handleProviderChange = (newProviderId: string) => {
        setProviderId(newProviderId)

        // 设置该 provider 的默认模型
        const builtin = BUILTIN_PROVIDERS[newProviderId]
        const userConfig = providerConfigs[newProviderId]
        const defaultModel = userConfig?.model || builtin?.defaultModel || builtin?.models[0] || ''
        setModel(defaultModel)
    }

    // 获取当前模板
    const selectedTemplate = useMemo(() => {
        return PROMPT_TEMPLATES.find(t => t.id === templateId) || PROMPT_TEMPLATES[0]
    }, [templateId])

    const handleConfirm = () => {
        if (!name.trim()) return
        onConfirm(name.trim(), {
            model,
            providerId,
            templateId,
            systemPrompt: customPrompt.trim() || undefined,
            temperature,
        })
    }

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={
                mode === 'create'
                    ? (language === 'zh' ? '新建计划' : 'New Plan')
                    : (language === 'zh' ? '编辑计划' : 'Edit Plan')
            }
        >
            <div className="space-y-4">
                {/* Name */}
                <div>
                    <label className="block text-xs text-text-muted mb-1.5">
                        {language === 'zh' ? '计划名称' : 'Plan Name'}
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={language === 'zh' ? '输入计划名称...' : 'Enter plan name...'}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                        autoFocus
                    />
                </div>

                {/* Provider Selection */}
                <div>
                    <label className="block text-xs text-text-muted mb-1.5 flex items-center gap-1">
                        <Bot className="w-3 h-3" />
                        {language === 'zh' ? '模型提供商' : 'Model Provider'}
                    </label>
                    <div className="relative">
                        <select
                            value={providerId}
                            onChange={(e) => handleProviderChange(e.target.value)}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                        >
                            {availableProviders.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.name} {p.isCustom ? '(自定义)' : ''}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    </div>
                </div>

                {/* Model Selection */}
                <div>
                    <label className="block text-xs text-text-muted mb-1.5">
                        {language === 'zh' ? '模型' : 'Model'}
                    </label>
                    <div className="relative">
                        <select
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                        >
                            {availableModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    </div>
                </div>

                {/* Template Selection */}
                <div>
                    <label className="block text-xs text-text-muted mb-1.5 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        {language === 'zh' ? '角色模板' : 'Role Template'}
                    </label>
                    <div className="relative">
                        <select
                            value={templateId}
                            onChange={(e) => setTemplateId(e.target.value)}
                            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                        >
                            {PROMPT_TEMPLATES.map(t => (
                                <option key={t.id} value={t.id}>
                                    {language === 'zh' ? t.nameZh : t.name} - {language === 'zh' ? t.descriptionZh : t.description}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                    </div>
                    <p className="mt-1.5 text-[10px] text-text-muted line-clamp-2">
                        {language === 'zh' ? selectedTemplate.descriptionZh : selectedTemplate.description}
                    </p>
                </div>

                {/* Custom Prompt */}
                <div>
                    <label className="block text-xs text-text-muted mb-1.5">
                        {language === 'zh' ? '自定义提示词（可选，追加到模板后）' : 'Custom Prompt (Optional, appended to template)'}
                    </label>
                    <textarea
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder={
                            language === 'zh'
                                ? '额外的指令或上下文...'
                                : 'Additional instructions or context...'
                        }
                        rows={2}
                        className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors resize-none"
                    />
                </div>

                {/* Temperature */}
                <div>
                    <label className="block text-xs text-text-muted mb-1.5">
                        {language === 'zh' ? '温度' : 'Temperature'}: {temperature}
                    </label>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                        className="w-full accent-accent"
                    />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
                    >
                        {language === 'zh' ? '取消' : 'Cancel'}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!name.trim()}
                        className="px-4 py-2 text-sm bg-accent text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
                    >
                        {mode === 'create'
                            ? (language === 'zh' ? '创建' : 'Create')
                            : (language === 'zh' ? '保存' : 'Save')}
                    </button>
                </div>
            </div>
        </Modal>
    )
}
