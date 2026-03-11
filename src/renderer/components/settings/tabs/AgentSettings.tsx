/**
 * Agent 设置组件
 * 完整的 Agent 高级配置面板
 */

import { useMemo, useState } from 'react'
import { getPromptTemplates } from '@renderer/agent/prompts/promptTemplates'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { Button, Input, Select, Switch } from '@components/ui'
import { AgentSettingsProps } from '../types'
import { PromptPreviewModal } from './PromptPreviewModal'
import { resolveSpecialistRoute } from '@renderer/agent/services/modelRoutingService'
import { Bot, FileText, Zap, BrainCircuit, AlertOctagon, Terminal, Search, Eye, EyeOff, RefreshCw } from 'lucide-react'

export function AgentSettings({
    autoApprove, setAutoApprove, aiInstructions, setAiInstructions,
    promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig,
    webSearchConfig, setWebSearchConfig, taskTrustSettings, setTaskTrustSettings,
    currentLLMConfig, providerConfigs, availableProviders, language
}: AgentSettingsProps) {
    const templates = getPromptTemplates()
    const [showPreview, setShowPreview] = useState(false)
    const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<string | null>(null)
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [showGoogleApiKey, setShowGoogleApiKey] = useState(false)

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

    const trustModeOptions = [
        { value: 'safe', label: t('安全模式', 'Safe Mode') },
        { value: 'balanced', label: t('平衡模式', 'Balanced Mode') },
        { value: 'autonomous', label: t('自主模式', 'Autonomous Mode') },
        { value: 'manual', label: t('完全手动', 'Manual Mode') },
    ]

    const executionTargetOptions = [
        { value: 'auto', label: t('自动判定', 'Automatic') },
        { value: 'current', label: t('当前工作区', 'Current Workspace') },
        { value: 'isolated', label: t('隔离任务副本', 'Isolated Workspace') },
    ]

    const interruptModeOptions = [
        { value: 'phase', label: t('阶段汇报', 'Per Phase') },
        { value: 'high-risk', label: t('仅高风险中断', 'High Risk Only') },
        { value: 'failure-only', label: t('仅失败中断', 'Failures Only') },
    ]

    const modelRoutingOptions = [
        { value: 'manual', label: t('手动', 'Manual') },
        { value: 'balanced', label: t('平衡路由', 'Balanced Routing') },
        { value: 'budget-aware', label: t('预算感知', 'Budget Aware') },
    ]

    const verificationModeOptions = [
        { value: 'static', label: t('静态检查', 'Static Review') },
        { value: 'regression', label: t('回归验证', 'Regression') },
        { value: 'browser', label: t('浏览器验证', 'Browser Verification') },
    ]

    const specialistRoles = ['frontend', 'logic', 'verifier', 'reviewer'] as const

    const toolPermissionOptions = [
        { value: 'read-mostly', label: t('偏只读', 'Read Mostly') },
        { value: 'workspace-write', label: t('工作区可写', 'Workspace Write') },
        { value: 'elevated', label: t('增强权限', 'Elevated') },
    ]

    const networkPermissionOptions = [
        { value: 'blocked', label: t('禁止网络', 'Blocked') },
        { value: 'workspace-only', label: t('工作区网络', 'Workspace Only') },
        { value: 'allowed', label: t('允许网络', 'Allowed') },
    ]

    const gitPermissionOptions = [
        { value: 'read-only', label: t('只读 Git', 'Read Only') },
        { value: 'task-branch', label: t('任务分支', 'Task Branch') },
        { value: 'workspace-write', label: t('工作区写入', 'Workspace Write') },
    ]

    const validationRoleOptions = [
        { value: 'none', label: t('无', 'None') },
        { value: 'secondary', label: t('辅助验证', 'Secondary') },
        { value: 'primary', label: t('主验证者', 'Primary') },
    ]

    const getOptionLabel = (options: Array<{ value: string, label: string }>, value?: string | null) => {
        if (!value) {
            return t('未设置', 'Not set')
        }

        return options.find((option) => option.value === value)?.label || value
    }


    const providerNameMap = useMemo(
        () => Object.fromEntries(availableProviders.map((provider) => [provider.id, provider.name])) as Record<string, string>,
        [availableProviders]
    )

    const resolveProviderContext = (providerId: string) => {
        const provider = availableProviders.find((candidate) => candidate.id === providerId)
        const configuredModel = providerConfigs[providerId]?.model
        const globalModel = currentLLMConfig.provider === providerId ? currentLLMConfig.model : ''
        const models = Array.from(new Set([
            globalModel,
            configuredModel || '',
            ...(provider?.models || []),
            ...(providerConfigs[providerId]?.customModels || []),
        ].filter(Boolean)))

        return {
            providerId,
            defaultModel: globalModel || configuredModel || models[0] || currentLLMConfig.model,
            availableModels: models,
        }
    }

    const resolvedSpecialistRoutes = useMemo(
        () => specialistRoles.map((role) => {
            const profile = taskTrustSettings.specialistProfiles[role]
            return {
                role,
                ...resolveSpecialistRoute({
                    policy: taskTrustSettings.global.modelRoutingPolicy,
                    specialist: role,
                    specialistProvider: profile.provider,
                    specialistModel: profile.model,
                    defaultProvider: currentLLMConfig.provider,
                    resolveProviderContext,
                }),
            }
        }),
        [specialistRoles, taskTrustSettings.specialistProfiles, taskTrustSettings.global.modelRoutingPolicy, currentLLMConfig.provider, currentLLMConfig.model, availableProviders, providerConfigs]
    )

    const collapsedSpecialistRoutes = useMemo(
        () => new Set(resolvedSpecialistRoutes.map((route) => `${route.providerId}:${route.model}`)).size <= 1,
        [resolvedSpecialistRoutes]
    )

    const specialistRoleMeta: Record<typeof specialistRoles[number], { title: string; description: string }> = {
        frontend: {
            title: 'Frontend',
            description: t('界面实现与交互细节', 'UI implementation and interaction details'),
        },
        logic: {
            title: 'Logic',
            description: t('状态管理、数据流与边界条件', 'State management, data flow, and edge cases'),
        },
        verifier: {
            title: 'Verifier',
            description: t('回归验证、复现确认与验收', 'Regression checks, reproduction, and acceptance'),
        },
        reviewer: {
            title: 'Reviewer',
            description: t('风险评审、范围控制与变更把关', 'Risk review, scope control, and change governance'),
        },
    }

    const updateBudgetLimit = (key: 'timeMs' | 'estimatedTokens' | 'llmCalls' | 'commands' | 'verifications', value: number) => {
        setTaskTrustSettings({
            ...taskTrustSettings,
            governanceDefaults: {
                ...taskTrustSettings.governanceDefaults,
                budget: {
                    ...taskTrustSettings.governanceDefaults.budget,
                    limits: {
                        ...taskTrustSettings.governanceDefaults.budget.limits,
                        [key]: value,
                    },
                },
            },
        })
    }

    const updateRollbackSetting = (key: 'autoRollbackIsolated' | 'requireConfirmationForMainWorkspace' | 'warnOnExternalSideEffects', value: boolean) => {
        setTaskTrustSettings({
            ...taskTrustSettings,
            governanceDefaults: {
                ...taskTrustSettings.governanceDefaults,
                rollback: {
                    ...taskTrustSettings.governanceDefaults.rollback,
                    [key]: value,
                },
            },
        })
    }

    const updateSpecialistProfile = (role: typeof specialistRoles[number], updates: Partial<typeof taskTrustSettings.specialistProfiles.frontend>) => {
        setTaskTrustSettings({
            ...taskTrustSettings,
            specialistProfiles: {
                ...taskTrustSettings.specialistProfiles,
                [role]: {
                    ...taskTrustSettings.specialistProfiles[role],
                    ...updates,
                },
            },
        })
    }

    return (
        <div className="space-y-8 animate-fade-in pb-24">
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


                    {/* 任务信任策略 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <BrainCircuit className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('任务信任策略', 'Task Trust Policy')}</h5>
                        </div>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('默认信任模式', 'Default Trust Mode')}</label>
                                <Select
                                    value={taskTrustSettings.global.mode}
                                    onChange={(value) => setTaskTrustSettings({
                                        ...taskTrustSettings,
                                        global: { ...taskTrustSettings.global, mode: value as typeof taskTrustSettings.global.mode }
                                    })}
                                    options={trustModeOptions}
                                    className="w-full bg-background/50 rounded-lg border-border text-xs"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-text-secondary">{t('默认执行环境', 'Default Execution Target')}</label>
                                    <Select
                                        value={taskTrustSettings.global.defaultExecutionTarget}
                                        onChange={(value) => setTaskTrustSettings({
                                            ...taskTrustSettings,
                                            global: { ...taskTrustSettings.global, defaultExecutionTarget: value as typeof taskTrustSettings.global.defaultExecutionTarget }
                                        })}
                                        options={executionTargetOptions}
                                        className="w-full bg-background/50 rounded-lg border-border text-xs"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-text-secondary">{t('中断策略', 'Interrupt Mode')}</label>
                                    <Select
                                        value={taskTrustSettings.global.interruptMode}
                                        onChange={(value) => setTaskTrustSettings({
                                            ...taskTrustSettings,
                                            global: { ...taskTrustSettings.global, interruptMode: value as typeof taskTrustSettings.global.interruptMode }
                                        })}
                                        options={interruptModeOptions}
                                        className="w-full bg-background/50 rounded-lg border-border text-xs"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-text-secondary">{t('模型路由策略', 'Model Routing Policy')}</label>
                                    <Select
                                        value={taskTrustSettings.global.modelRoutingPolicy}
                                        onChange={(value) => setTaskTrustSettings({
                                            ...taskTrustSettings,
                                            global: { ...taskTrustSettings.global, modelRoutingPolicy: value as typeof taskTrustSettings.global.modelRoutingPolicy }
                                        })}
                                        options={modelRoutingOptions}
                                        className="w-full bg-background/50 rounded-lg border-border text-xs"
                                    />
                                    <p className="text-[11px] leading-5 text-text-muted">
                                        {t('手动 / 平衡路由 / 预算感知：在成本压力升高时自动切换到更保守的模型。', 'Manual / Balanced / Budget Aware: degrade to safer-cost models when budget pressure rises.')}
                                    </p>
                                </div>
                            </div>
                            <Switch
                                label={t('默认启用安全护栏', 'Enable safety guards by default')}
                                checked={taskTrustSettings.global.enableSafetyGuards}
                                onChange={(e) => setTaskTrustSettings({
                                    ...taskTrustSettings,
                                    global: { ...taskTrustSettings.global, enableSafetyGuards: e.target.checked }
                                })}
                            />
                            <Switch
                                label={t('允许任务级临时覆盖', 'Allow per-task overrides')}
                                checked={taskTrustSettings.allowTaskOverride}
                                onChange={(e) => setTaskTrustSettings({
                                    ...taskTrustSettings,
                                    allowTaskOverride: e.target.checked,
                                })}
                            />
                        </div>
                    </section>

                    {/* 任务治理默认值 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('任务治理默认值', 'Task Governance Defaults')}</h5>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('时间预算（分钟）', 'Time Budget (Minutes)')}</label>
                                <Input type="number" min={1} value={Math.round(taskTrustSettings.governanceDefaults.budget.limits.timeMs / 60000)} onChange={(e) => updateBudgetLimit('timeMs', Math.max(60000, (parseInt(e.target.value) || 0) * 60000))} className="bg-background/50 rounded-lg border-border text-xs" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">Estimated Tokens</label>
                                <Input type="number" min={1000} value={taskTrustSettings.governanceDefaults.budget.limits.estimatedTokens} onChange={(e) => updateBudgetLimit('estimatedTokens', Math.max(1000, parseInt(e.target.value) || 0))} className="bg-background/50 rounded-lg border-border text-xs" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">LLM Calls</label>
                                <Input type="number" min={1} value={taskTrustSettings.governanceDefaults.budget.limits.llmCalls} onChange={(e) => updateBudgetLimit('llmCalls', Math.max(1, parseInt(e.target.value) || 0))} className="bg-background/50 rounded-lg border-border text-xs" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">Commands</label>
                                <Input type="number" min={1} value={taskTrustSettings.governanceDefaults.budget.limits.commands} onChange={(e) => updateBudgetLimit('commands', Math.max(1, parseInt(e.target.value) || 0))} className="bg-background/50 rounded-lg border-border text-xs" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">Verifications</label>
                                <Input type="number" min={1} value={taskTrustSettings.governanceDefaults.budget.limits.verifications} onChange={(e) => updateBudgetLimit('verifications', Math.max(1, parseInt(e.target.value) || 0))} className="bg-background/50 rounded-lg border-border text-xs" />
                            </div>
                        </div>
                        <div className="space-y-3">
                            <Switch label={t('超限即熔断', 'Hard stop on budget trip')} checked={taskTrustSettings.governanceDefaults.budget.hardStop} onChange={(e) => setTaskTrustSettings({ ...taskTrustSettings, governanceDefaults: { ...taskTrustSettings.governanceDefaults, budget: { ...taskTrustSettings.governanceDefaults.budget, hardStop: e.target.checked } } })} />
                            <Switch label={t('隔离副本失败时自动销毁', 'Auto-dispose isolated workspaces on failure')} checked={taskTrustSettings.governanceDefaults.rollback.autoRollbackIsolated} onChange={(e) => updateRollbackSetting('autoRollbackIsolated', e.target.checked)} />
                            <Switch label={t('主工作区回滚需要确认', 'Require confirmation for main-workspace rollback')} checked={taskTrustSettings.governanceDefaults.rollback.requireConfirmationForMainWorkspace} onChange={(e) => updateRollbackSetting('requireConfirmationForMainWorkspace', e.target.checked)} />
                            <Switch label={t('记录外部副作用告警', 'Warn on external side effects')} checked={taskTrustSettings.governanceDefaults.rollback.warnOnExternalSideEffects} onChange={(e) => updateRollbackSetting('warnOnExternalSideEffects', e.target.checked)} />
                        </div>
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
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
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
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
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
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('上下文 Token 限制', 'Context Token Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextTokens ?? 128000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextTokens: parseInt(e.target.value) || 128000 })}
                                    step={10000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('单文件内容限制', 'File Content Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxFileContentChars ?? 15000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxFileContentChars: parseInt(e.target.value) || 15000 })}
                                    step={5000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
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
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
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
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('终端输出限制', 'Terminal Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxTerminalChars ?? 3000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxTerminalChars: parseInt(e.target.value) || 3000 })}
                                    step={1000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
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
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('重试延迟 (ms)', 'Retry Delay')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.retryDelayMs ?? 1000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, retryDelayMs: parseInt(e.target.value) || 1000 })}
                                            step={500}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('工具超时 (ms)', 'Tool Timeout')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.toolTimeoutMs ?? 60000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, toolTimeoutMs: parseInt(e.target.value) || 60000 })}
                                            step={5000}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                    </div>
                                </div>

                                {/* 上下文压缩 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('上下文压缩', 'Context Compression')}</label>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('保留最近轮次', 'Keep Recent Turns')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.keepRecentTurns ?? 5}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, keepRecentTurns: parseInt(e.target.value) || 5 })}
                                                min={2}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('深度压缩轮次', 'Deep Compression')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.deepCompressionTurns ?? 2}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, deepCompressionTurns: parseInt(e.target.value) || 2 })}
                                                min={1}
                                                max={5}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('重要旧轮次', 'Important Old')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.maxImportantOldTurns ?? 3}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, maxImportantOldTurns: parseInt(e.target.value) || 3 })}
                                                min={0}
                                                max={10}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3 pt-2 border-t border-border/30">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <Switch
                                                label={t('启用 LLM 摘要', 'Enable LLM Summary')}
                                                checked={agentConfig.enableLLMSummary ?? true}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, enableLLMSummary: e.target.checked })}
                                                className="text-[11px]"
                                            />
                                            <Switch
                                                label={t('自动会话交接', 'Auto Handoff')}
                                                checked={agentConfig.autoHandoff ?? true}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, autoHandoff: e.target.checked })}
                                                className="text-[11px]"
                                            />
                                            <Switch
                                                label={t('智能上下文 (隐式检索)', 'Auto-Context (RAG)')}
                                                checked={agentConfig.enableAutoContext ?? true}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, enableAutoContext: e.target.checked })}
                                                className="text-[11px]"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 循环检测 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                            <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('循环检测', 'Loop Detection')}</label>
                                        </div>
                                        <span className="text-[9px] text-text-muted bg-surface/50 px-2 py-0.5 rounded-full border border-border/30">{t('仅警告，不中断', 'Warning only')}</span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('历史记录', 'History')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxHistory ?? 50}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxHistory: parseInt(e.target.value) || 50
                                                    }
                                                })}
                                                min={10}
                                                max={100}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('重复阈值', 'Exact Repeats')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxExactRepeats ?? 5}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxExactRepeats: parseInt(e.target.value) || 5
                                                    }
                                                })}
                                                min={3}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('编辑阈值', 'File Edits')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxSameTargetRepeats ?? 8}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxSameTargetRepeats: parseInt(e.target.value) || 8
                                                    }
                                                })}
                                                min={3}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 忽略目录 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                            <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('忽略目录', 'Ignored Dirs')}</label>
                                        </div>
                                        <button
                                            onClick={resetIgnoredDirs}
                                            className="text-[10px] font-bold text-accent hover:text-accent-hover transition-colors flex items-center gap-1 bg-accent/5 px-2 py-0.5 rounded border border-accent/20"
                                        >
                                            <RefreshCw className="w-2.5 h-2.5" />
                                            {t('重置', 'Reset')}
                                        </button>
                                    </div>
                                    <textarea
                                        value={ignoredDirsInput}
                                        onChange={(e) => handleIgnoredDirsChange(e.target.value)}
                                        className="w-full h-24 p-3 bg-background/40 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all rounded-lg border border-border/60 outline-none text-xs font-mono resize-none text-text-secondary custom-scrollbar"
                                        placeholder="node_modules, .git, ..."
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>


                    {/* 专家配置 */}
                <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4 lg:col-span-2">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-1">
                                <Bot className="w-4 h-4 text-accent" />
                                <h5 className="text-sm font-medium text-text-primary">{t('专家 Agent 配置', 'Specialist Agent Profiles')}</h5>
                            </div>
                            <p className="text-xs leading-5 text-text-muted">
                                {t(
                                    '为不同专家设置默认模型、权限和预算上限，避免执行时看不清配置职责。',
                                    'Set default models, permissions, and budget caps for each specialist so responsibilities stay readable at a glance.'
                                )}
                            </p>
                        </div>
                        {collapsedSpecialistRoutes ? (
                            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-300">
                                {t(
                                    '当前所有专家最终都会使用同一模型。这样仍然有多角色分工，但更接近“多角色单模型”；如需真正的多模型协作，请至少为一个专家单独指定 provider 或 model。',
                                    'All specialists currently resolve to the same runtime model. You still get role separation, but this is closer to a multi-role single-model setup; assign an explicit provider or model to at least one specialist for true multi-model collaboration.'
                                )}
                            </div>
                        ) : null}
                        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                            {specialistRoles.map((role) => {
                                const profile = taskTrustSettings.specialistProfiles[role]
                                const roleMeta = specialistRoleMeta[role]
                                const resolvedRoute = resolvedSpecialistRoutes.find((item) => item.role === role)
                                const summaryBadges = [
                                    `${t('工具：', 'Tools: ')}${getOptionLabel(toolPermissionOptions, profile.toolPermission)}`,
                                    `${t('网络：', 'Network: ')}${getOptionLabel(networkPermissionOptions, profile.networkPermission)}`,
                                    `${t('Git：', 'Git: ')}${getOptionLabel(gitPermissionOptions, profile.gitPermission)}`,
                                    `${t('验证：', 'Verification: ')}${getOptionLabel(verificationModeOptions, profile.verificationMode)}`,
                                    resolvedRoute
                                        ? `${t('最终执行：', 'Runtime: ')}${providerNameMap[resolvedRoute.providerId] || resolvedRoute.providerId} / ${resolvedRoute.model}`
                                        : `${t('最终执行：', 'Runtime: ')}-`,
                                ]

                                return (
                                    <div key={role} className="min-w-0 overflow-hidden rounded-xl border border-border bg-background/30 p-4 md:p-5 space-y-4">
                                        <div className="space-y-3 min-w-0">
                                            <div className="space-y-1 min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <div className="text-base font-semibold text-text-primary">{roleMeta.title}</div>
                                                    <span className="px-2 py-1 rounded-full bg-accent/10 text-accent text-[11px] leading-4 break-words">
                                                        {getOptionLabel(validationRoleOptions, profile.validationRole)}
                                                    </span>
                                                </div>
                                                <p className="text-xs leading-5 text-text-muted break-words">{roleMeta.description}</p>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {summaryBadges.map((badge) => (
                                                    <span key={badge} className="max-w-full break-words rounded-full border border-border bg-background/70 px-2.5 py-1 text-[11px] leading-4 text-text-secondary">
                                                        {badge}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="space-y-3">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                                    {t('基础设置', 'Basics')}
                                                </div>
                                                <div className="space-y-1.5 min-w-0">
                                                    <label className="text-xs font-medium text-text-secondary">{t('提供商', 'Provider')}</label>
                                                    <Select
                                                        value={profile.provider || ''}
                                                        onChange={(value) => updateSpecialistProfile(role, { provider: value || null, model: profile.provider && value !== profile.provider ? null : profile.model })}
                                                        options={(() => {
                                                            const providerOptions: Array<{ value: string; label: string }> = [
                                                                ...availableProviders.map((provider) => ({ value: provider.id, label: provider.name })),
                                                            ]
                                                            if (profile.provider && !providerOptions.some((provider) => provider.value === profile.provider)) {
                                                                providerOptions.push({ value: profile.provider, label: profile.provider })
                                                            }
                                                            return [
                                                                { value: '', label: t('沿用当前默认提供商', 'Use current default provider') },
                                                                ...providerOptions,
                                                            ]
                                                        })()}
                                                        className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                    />
                                                </div>
                                                <div className="space-y-1.5 min-w-0">
                                                    <label className="text-xs font-medium text-text-secondary">{t('模型', 'Model')}</label>
                                                    <Select
                                                        value={profile.model || ''}
                                                        onChange={(value) => updateSpecialistProfile(role, { model: value || null })}
                                                        options={(() => {
                                                            const selectedProviderId = profile.provider || currentLLMConfig.provider
                                                            const providerContext = resolveProviderContext(selectedProviderId)
                                                            const modelOptions = Array.from(new Set([
                                                                profile.model || '',
                                                                ...providerContext.availableModels,
                                                            ].filter(Boolean)))
                                                            return [
                                                                { value: '', label: t('沿用当前路由/默认模型', 'Use routed/default model') },
                                                                ...modelOptions.map((model) => ({ value: model, label: model })),
                                                            ]
                                                        })()}
                                                        className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                    />
                                                    <p className="text-[11px] leading-5 text-text-muted">
                                                        {t(
                                                            '空值会继承当前全局 provider/model，并继续参与模型路由策略解析。',
                                                            'Leave blank to inherit the current global provider/model and still participate in routing.'
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="space-y-1.5 min-w-0">
                                                    <label className="text-xs font-medium text-text-secondary">{t('验证模式', 'Verification Mode')}</label>
                                                    <Select
                                                        value={profile.verificationMode}
                                                        onChange={(value) => updateSpecialistProfile(role, { verificationMode: value as typeof profile.verificationMode })}
                                                        options={verificationModeOptions}
                                                        className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-3 border-t border-border/60 pt-4">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                                    {t('权限设置', 'Permissions')}
                                                </div>
                                                <div className="grid grid-cols-1 gap-3">
                                                    <div className="space-y-1.5 min-w-0">
                                                        <label className="text-xs font-medium text-text-secondary">{t('工具权限', 'Tool Permission')}</label>
                                                        <Select
                                                            value={profile.toolPermission}
                                                            onChange={(value) => updateSpecialistProfile(role, { toolPermission: value as typeof profile.toolPermission })}
                                                            options={toolPermissionOptions}
                                                            className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5 min-w-0">
                                                        <label className="text-xs font-medium text-text-secondary">{t('验证职责', 'Validation Role')}</label>
                                                        <Select
                                                            value={profile.validationRole}
                                                            onChange={(value) => updateSpecialistProfile(role, { validationRole: value as typeof profile.validationRole })}
                                                            options={validationRoleOptions}
                                                            className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5 min-w-0">
                                                        <label className="text-xs font-medium text-text-secondary">{t('网络权限', 'Network Permission')}</label>
                                                        <Select
                                                            value={profile.networkPermission}
                                                            onChange={(value) => updateSpecialistProfile(role, { networkPermission: value as typeof profile.networkPermission })}
                                                            options={networkPermissionOptions}
                                                            className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5 min-w-0">
                                                        <label className="text-xs font-medium text-text-secondary">Git</label>
                                                        <Select
                                                            value={profile.gitPermission}
                                                            onChange={(value) => updateSpecialistProfile(role, { gitPermission: value as typeof profile.gitPermission })}
                                                            options={gitPermissionOptions}
                                                            className="w-full min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3 border-t border-border/60 pt-4">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                                    {t('预算上限', 'Budget Caps')}
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="space-y-1.5 min-w-0">
                                                        <label className="text-xs font-medium text-text-secondary">LLM Cap</label>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            value={profile.budgetCap.llmCalls || 0}
                                                            onChange={(e) => updateSpecialistProfile(role, { budgetCap: { ...profile.budgetCap, llmCalls: Math.max(0, parseInt(e.target.value) || 0) } })}
                                                            className="min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5 min-w-0">
                                                        <label className="text-xs font-medium text-text-secondary">Cmd Cap</label>
                                                        <Input
                                                            type="number"
                                                            min={0}
                                                            value={profile.budgetCap.commands || 0}
                                                            onChange={(e) => updateSpecialistProfile(role, { budgetCap: { ...profile.budgetCap, commands: Math.max(0, parseInt(e.target.value) || 0) } })}
                                                            className="min-w-0 bg-background/50 rounded-lg border-border text-sm"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-3 border-t border-border/60 pt-4">
                                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                                                    {t('风格提示', 'Style Hints')}
                                                </div>
                                                <div className="space-y-1.5 min-w-0">
                                                    <label className="text-xs font-medium text-text-secondary">{t('给该专家的额外偏好', 'Extra guidance for this specialist')}</label>
                                                    <textarea
                                                        value={profile.styleHints}
                                                        onChange={(e) => updateSpecialistProfile(role, { styleHints: e.target.value })}
                                                        rows={3}
                                                        className="w-full min-w-0 min-h-[88px] resize-y rounded-lg border border-border bg-background/50 p-3 text-sm leading-5 text-text-primary outline-none transition-all placeholder-text-muted/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </section>


                <div className="space-y-6 lg:col-span-2">
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
                                    className="w-full bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>

                            <div className="bg-surface/50 p-3 rounded-lg border border-border space-y-2">
                                <div className="flex items-start gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-text-primary">
                                        {templates.find(t => t.id === promptTemplateId)?.name}
                                    </span>
                                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg rounded border border-border">
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
                            className="w-full h-32 p-3 bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg rounded-lg border border-border focus:border-accent/50 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none text-xs font-mono custom-scrollbar text-text-primary placeholder-text-muted/50"
                        />
                    </section>

                    {/* 网络搜索配置 */}
                    <section className="p-5 bg-surface/30 rounded-xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Search className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('网络搜索', 'Web Search')}</h5>
                        </div>
                        <p className="text-xs text-text-muted">
                            {t(
                                '配置 Google Programmable Search Engine 以获得更好的搜索结果。未配置时将使用 DuckDuckGo 作为备选。',
                                'Configure Google Programmable Search Engine for better search results. Falls back to DuckDuckGo when not configured.'
                            )}
                        </p>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">Google API Key</label>
                                <div className="relative">
                                    <Input
                                        type={showGoogleApiKey ? 'text' : 'password'}
                                        value={webSearchConfig.googleApiKey || ''}
                                        onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleApiKey: e.target.value })}
                                        placeholder={t('输入 Google API Key', 'Enter Google API Key')}
                                        className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                    >
                                        {showGoogleApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('搜索引擎 ID (CX)', 'Search Engine ID (CX)')}</label>
                                <Input
                                    type="text"
                                    value={webSearchConfig.googleCx || ''}
                                    onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleCx: e.target.value })}
                                    placeholder={t('输入搜索引擎 ID', 'Enter Search Engine ID')}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>
                        </div>
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
                            <Search className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>
                                {t(
                                    '免费额度：每天 100 次搜索。获取密钥：console.cloud.google.com',
                                    'Free tier: 100 searches/day. Get keys at: console.cloud.google.com'
                                )}
                            </p>
                        </div>
                    </section>
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