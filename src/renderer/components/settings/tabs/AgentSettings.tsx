/**
 * Agent 设置组件
 * 完整的 Agent 高级配置面板
 */

import { useState } from 'react'
import { getPromptTemplates } from '@renderer/agent/prompts/promptTemplates'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { Button, Input, Select, Switch } from '@components/ui'
import { AgentSettingsProps } from '../types'
import { PromptPreviewModal } from './PromptPreviewModal'
import { Bot, FileText, Zap, BrainCircuit, AlertOctagon, Terminal } from 'lucide-react'

export function AgentSettings({
    autoApprove, setAutoApprove, aiInstructions, setAiInstructions,
    promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig, language
}: AgentSettingsProps) {
    const templates = getPromptTemplates()
    const [showPreview, setShowPreview] = useState(false)
    const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<string | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    
    // 使用 DEFAULT_AGENT_CONFIG 中的忽略目录作为默认值
    const defaultIgnoredDirs = DEFAULT_AGENT_CONFIG.ignoredDirectories
    const [ignoredDirsInput, setIgnoredDirsInput] = useState(
        (agentConfig.ignoredDirectories || defaultIgnoredDirs).join(', ')
    )

    const handlePreviewTemplate = (templateId: string) => {
        setSelectedTemplateForPreview(templateId)
        setShowPreview(true)
    }

    const handleIgnoredDirsChange = (value: string) => {
        setIgnoredDirsInput(value)
        const dirs = value.split(',').map(d => d.trim()).filter(Boolean)
        setAgentConfig({ ...agentConfig, ignoredDirectories: dirs })
    }

    const resetIgnoredDirs = () => {
        setIgnoredDirsInput(defaultIgnoredDirs.join(', '))
        setAgentConfig({ ...agentConfig, ignoredDirectories: defaultIgnoredDirs })
    }

    const t = (zh: string, en: string) => language === 'zh' ? zh : en

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                    {/* 自动化权限 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('自动化权限', 'Automation Permissions')}</h5>
                        </div>
                        <div className="space-y-3">
                            <Switch
                                label={t('自动批准终端命令', 'Auto-approve terminal commands')}
                                checked={autoApprove.terminal}
                                onChange={(e) => setAutoApprove({ ...autoApprove, terminal: e.target.checked })}
                            />
                            <Switch
                                label={t('自动批准危险操作', 'Auto-approve dangerous operations')}
                                checked={autoApprove.dangerous}
                                onChange={(e) => setAutoApprove({ ...autoApprove, dangerous: e.target.checked })}
                            />
                            <Switch
                                label={t('启用自动检查与修复', 'Enable Auto-check & Fix')}
                                checked={agentConfig.enableAutoFix}
                                onChange={(e) => setAgentConfig({ ...agentConfig, enableAutoFix: e.target.checked })}
                            />
                        </div>
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs">
                            <AlertOctagon className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>{t('开启后，Agent 将无需确认直接执行相应操作。请谨慎使用。', 'When enabled, the Agent will execute operations without confirmation. Use with caution.')}</p>
                        </div>
                    </section>

                    {/* Prompt 模板 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Bot className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('Prompt 模板', 'Prompt Template')}</h5>
                        </div>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('选择模板', 'Select Template')}</label>
                                <Select
                                    value={promptTemplateId}
                                    onChange={(value) => setPromptTemplateId(value)}
                                    options={templates.map(t => ({
                                        value: t.id,
                                        label: `${t.name} ${t.isDefault ? '(Default)' : ''}`
                                    }))}
                                    className="w-full bg-black/20 border-border text-xs"
                                />
                            </div>

                            <div className="bg-surface/50 p-3 rounded-lg border border-border space-y-2">
                                <div className="flex items-start gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-text-primary">
                                        {templates.find(t => t.id === promptTemplateId)?.name}
                                    </span>
                                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-black/20 rounded border border-border">
                                        P{templates.find(t => t.id === promptTemplateId)?.priority}
                                    </span>
                                    {templates.find(t => t.id === promptTemplateId)?.tags?.map(tag => (
                                        <span key={tag} className="text-[10px] text-accent px-1.5 py-0.5 bg-accent/10 rounded">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-xs text-text-secondary line-clamp-2">
                                    {language === 'zh'
                                        ? templates.find(t => t.id === promptTemplateId)?.descriptionZh
                                        : templates.find(t => t.id === promptTemplateId)?.description}
                                </p>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handlePreviewTemplate(promptTemplateId)}
                                    className="w-full text-xs h-7 mt-2"
                                >
                                    {t('预览完整提示词', 'Preview Full Prompt')}
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* 自定义系统指令 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('自定义系统指令', 'Custom Instructions')}</h5>
                        </div>
                        <textarea
                            value={aiInstructions}
                            onChange={(e) => setAiInstructions(e.target.value)}
                            placeholder={t(
                                '在此输入全局系统指令，例如："总是使用中文回答"、"代码风格偏好..."',
                                'Enter global system instructions here...'
                            )}
                            className="w-full h-32 p-3 bg-black/20 rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none text-xs font-mono custom-scrollbar text-text-primary placeholder-text-muted/50"
                        />
                    </section>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* 基础配置 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <BrainCircuit className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('基础配置', 'Basic Configuration')}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('最大循环', 'Max Loops')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxToolLoops}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxToolLoops: parseInt(e.target.value) || 20 })}
                                    min={5}
                                    max={100}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('最大历史消息', 'Max History')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxHistoryMessages}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxHistoryMessages: parseInt(e.target.value) || 60 })}
                                    min={10}
                                    max={200}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                        </div>
                    </section>

                    {/* 上下文限制 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('上下文限制', 'Context Limits')}</h5>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('工具结果限制', 'Tool Result Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxToolResultChars}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxToolResultChars: parseInt(e.target.value) || 10000 })}
                                    step={5000}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('上下文 Token 限制', 'Context Token Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextTokens ?? 128000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextTokens: parseInt(e.target.value) || 128000 })}
                                    step={10000}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('单文件内容限制', 'File Content Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxFileContentChars ?? 15000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxFileContentChars: parseInt(e.target.value) || 15000 })}
                                    step={5000}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('最大文件数', 'Max Files')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextFiles ?? 6}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextFiles: parseInt(e.target.value) || 6 })}
                                    min={1}
                                    max={20}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('语义搜索结果数', 'Semantic Results')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxSemanticResults ?? 5}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxSemanticResults: parseInt(e.target.value) || 5 })}
                                    min={1}
                                    max={20}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('终端输出限制', 'Terminal Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxTerminalChars ?? 3000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxTerminalChars: parseInt(e.target.value) || 3000 })}
                                    step={1000}
                                    className="bg-black/20 border-border text-xs"
                                />
                            </div>
                        </div>
                    </section>

                    {/* 高级配置（可折叠） */}
                    <div className="pt-2">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-2 text-xs font-medium text-text-muted hover:text-accent transition-colors select-none w-full p-2 hover:bg-surface/30 rounded-lg"
                        >
                            <span className={`transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
                            {t('显示高级配置', 'Show Advanced Configuration')}
                        </button>

                        {showAdvanced && (
                            <div className="mt-3 space-y-4 animate-slide-down pl-2">
                                {/* 重试 & 超时 */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('最大重试', 'Max Retries')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.maxRetries ?? 3}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxRetries: parseInt(e.target.value) || 3 })}
                                            min={0}
                                            max={10}
                                            className="bg-black/20 border-border text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('重试延迟 (ms)', 'Retry Delay')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.retryDelayMs ?? 1000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, retryDelayMs: parseInt(e.target.value) || 1000 })}
                                            step={500}
                                            className="bg-black/20 border-border text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('工具超时 (ms)', 'Tool Timeout')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.toolTimeoutMs ?? 60000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, toolTimeoutMs: parseInt(e.target.value) || 60000 })}
                                            step={5000}
                                            className="bg-black/20 border-border text-xs"
                                        />
                                    </div>
                                </div>

                                {/* 上下文压缩 */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-text-secondary">{t('上下文压缩', 'Context Compression')}</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-text-muted">{t('保留最近轮次', 'Keep Recent Turns')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.keepRecentTurns ?? 5}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, keepRecentTurns: parseInt(e.target.value) || 5 })}
                                                min={2}
                                                max={20}
                                                className="bg-black/20 border-border text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-text-muted">{t('深度压缩轮次', 'Deep Compression Turns')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.deepCompressionTurns ?? 2}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, deepCompressionTurns: parseInt(e.target.value) || 2 })}
                                                min={1}
                                                max={5}
                                                className="bg-black/20 border-border text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-text-muted">{t('重要旧轮次', 'Important Old Turns')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.maxImportantOldTurns ?? 3}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, maxImportantOldTurns: parseInt(e.target.value) || 3 })}
                                                min={0}
                                                max={10}
                                                className="bg-black/20 border-border text-xs"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex gap-4 mt-2">
                                        <Switch
                                            label={t('启用 LLM 摘要', 'Enable LLM Summary')}
                                            checked={agentConfig.enableLLMSummary ?? true}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, enableLLMSummary: e.target.checked })}
                                        />
                                        <Switch
                                            label={t('自动会话交接', 'Auto Handoff')}
                                            checked={agentConfig.autoHandoff ?? true}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, autoHandoff: e.target.checked })}
                                        />
                                    </div>
                                </div>

                                {/* 循环检测 */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-text-secondary">{t('循环检测', 'Loop Detection')}</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-text-muted">{t('历史记录', 'History')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxHistory ?? 20}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxHistory: parseInt(e.target.value) || 20
                                                    }
                                                })}
                                                min={5}
                                                max={50}
                                                className="bg-black/20 border-border text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-text-muted">{t('精确重复', 'Exact Repeats')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxExactRepeats ?? 4}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxExactRepeats: parseInt(e.target.value) || 4
                                                    }
                                                })}
                                                min={1}
                                                max={10}
                                                className="bg-black/20 border-border text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] text-text-muted">{t('同目标重复', 'Same Target')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxSameTargetRepeats ?? 5}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxSameTargetRepeats: parseInt(e.target.value) || 5
                                                    }
                                                })}
                                                min={1}
                                                max={10}
                                                className="bg-black/20 border-border text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 忽略目录 */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-medium text-text-secondary">{t('忽略目录', 'Ignored Dirs')}</label>
                                        <button onClick={resetIgnoredDirs} className="text-[10px] text-accent hover:underline">
                                            {t('重置', 'Reset')}
                                        </button>
                                    </div>
                                    <textarea
                                        value={ignoredDirsInput}
                                        onChange={(e) => handleIgnoredDirsChange(e.target.value)}
                                        className="w-full h-20 p-2 bg-black/20 rounded-lg border border-border focus:border-accent/50 outline-none text-xs font-mono resize-none text-text-secondary"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {showPreview && selectedTemplateForPreview && (
                <PromptPreviewModal
                    templateId={selectedTemplateForPreview}
                    language={language}
                    onClose={() => setShowPreview(false)}
                />
            )}
        </div>
    )
}