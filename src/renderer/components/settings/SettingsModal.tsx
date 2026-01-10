/**
 * 设置模态框主组件
 * 管理设置标签页切换和状态同步
 */

import { useState, useEffect } from 'react'
import { Cpu, Settings2, Code, Keyboard, Database, Shield, Monitor, Globe, Plug, Braces, Brain, FileCode } from 'lucide-react'
import { useStore } from '@store'
import { PROVIDERS } from '@/shared/config/providers'
import { getEditorConfig, saveEditorConfig, settingsService } from '@renderer/settings'
import KeybindingPanel from '@components/panels/KeybindingPanel'
import { Button, Modal, Select } from '@components/ui'
import { SettingsTab, EditorSettingsState, LANGUAGES } from './types'
import {
    ProviderSettings,
    EditorSettings,
    AgentSettings,
    RulesMemorySettings,
    SecuritySettings,
    IndexSettings,
    SystemSettings,
    McpSettings,
    LspSettings,
    SnippetSettings
} from './tabs'

export default function SettingsModal() {
    const {
        llmConfig, setLLMConfig, setShowSettings, language, setLanguage,
        autoApprove, setAutoApprove, providerConfigs, setProviderConfig,
        promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig,
        aiInstructions, setAiInstructions
    } = useStore()

    const [activeTab, setActiveTab] = useState<SettingsTab>('provider')
    const [showApiKey, setShowApiKey] = useState(false)
    const [localConfig, setLocalConfig] = useState(llmConfig)
    const [localLanguage, setLocalLanguage] = useState(language)
    const [localAutoApprove, setLocalAutoApprove] = useState(autoApprove)
    const [localPromptTemplateId, setLocalPromptTemplateId] = useState(promptTemplateId)
    const [localAgentConfig, setLocalAgentConfig] = useState(agentConfig)
    const [localProviderConfigs, setLocalProviderConfigs] = useState(providerConfigs)
    const [localAiInstructions, setLocalAiInstructions] = useState(aiInstructions)
    const [saved, setSaved] = useState(false)

    const editorConfig = getEditorConfig()
    const [editorSettings, setEditorSettings] = useState<EditorSettingsState>({
        // 编辑器外观
        fontSize: editorConfig.fontSize,
        tabSize: editorConfig.tabSize,
        wordWrap: editorConfig.wordWrap,
        lineNumbers: editorConfig.lineNumbers,
        minimap: editorConfig.minimap,
        bracketPairColorization: editorConfig.bracketPairColorization,
        formatOnSave: editorConfig.formatOnSave,
        autoSave: editorConfig.autoSave,
        autoSaveDelay: editorConfig.autoSaveDelay,
        theme: 'adnify-dark',
        // AI 补全
        completionEnabled: editorConfig.ai.completionEnabled,
        completionDebounceMs: editorConfig.performance.completionDebounceMs,
        completionMaxTokens: editorConfig.ai.completionMaxTokens,
        completionTriggerChars: editorConfig.ai.completionTriggerChars,
        // 终端
        terminalScrollback: editorConfig.terminal.scrollback,
        terminalMaxOutputLines: editorConfig.terminal.maxOutputLines,
        // LSP
        lspTimeoutMs: editorConfig.lsp.timeoutMs,
        lspCompletionTimeoutMs: editorConfig.lsp.completionTimeoutMs,
        // 性能
        largeFileWarningThresholdMB: editorConfig.performance.largeFileWarningThresholdMB,
        largeFileLineCount: editorConfig.performance.largeFileLineCount,
        commandTimeoutMs: editorConfig.performance.commandTimeoutMs,
        workerTimeoutMs: editorConfig.performance.workerTimeoutMs,
        healthCheckTimeoutMs: editorConfig.performance.healthCheckTimeoutMs,
        maxProjectFiles: editorConfig.performance.maxProjectFiles,
        maxFileTreeDepth: editorConfig.performance.maxFileTreeDepth,
        maxSearchResults: editorConfig.performance.maxSearchResults,
        saveDebounceMs: editorConfig.performance.saveDebounceMs,
        flushIntervalMs: editorConfig.performance.flushIntervalMs,
    })

    // Sync store state to local state
    useEffect(() => { setLocalConfig(llmConfig) }, [llmConfig])
    useEffect(() => { setLocalProviderConfigs(providerConfigs) }, [providerConfigs])
    useEffect(() => { setLocalLanguage(language) }, [language])
    useEffect(() => { setLocalAutoApprove(autoApprove) }, [autoApprove])
    useEffect(() => { setLocalAgentConfig(agentConfig) }, [agentConfig])
    useEffect(() => { setLocalAiInstructions(aiInstructions) }, [aiInstructions])

    const handleSave = async () => {
        // 更新 Store 状态
        setLLMConfig(localConfig)
        setLanguage(localLanguage)
        setAutoApprove(localAutoApprove)
        setPromptTemplateId(localPromptTemplateId)
        setAgentConfig(localAgentConfig)
        setAiInstructions(localAiInstructions)

        // 合并当前 provider 的配置到 localProviderConfigs
        const currentProviderLocalConfig = localProviderConfigs[localConfig.provider] || {}
        const finalProviderConfigs = {
            ...localProviderConfigs,
            [localConfig.provider]: {
                ...currentProviderLocalConfig,
                apiKey: localConfig.apiKey,
                baseUrl: localConfig.baseUrl,
                timeout: localConfig.timeout,
                model: localConfig.model,
                adapterConfig: currentProviderLocalConfig.adapterConfig || localConfig.adapterConfig,
                advanced: currentProviderLocalConfig.advanced,
            }
        }

        // 批量更新所有 provider configs 到 store
        for (const [providerId, config] of Object.entries(finalProviderConfigs)) {
            setProviderConfig(providerId, config)
        }

        // 使用 settingsService 统一保存
        const currentEditorConfig = getEditorConfig()
        const currentSecuritySettings = settingsService.getCached()?.securitySettings || {
            enablePermissionConfirm: true,
            enableAuditLog: true,
            strictWorkspaceMode: true,
            allowedShellCommands: [],
            showSecurityWarnings: true,
        }
        
        await settingsService.saveAll({
            llmConfig: localConfig as any,
            language: localLanguage,
            autoApprove: localAutoApprove,
            promptTemplateId: localPromptTemplateId,
            agentConfig: localAgentConfig,
            providerConfigs: finalProviderConfigs as any,
            aiInstructions: localAiInstructions,
            onboardingCompleted: true,
            editorConfig: currentEditorConfig,
            securitySettings: currentSecuritySettings,
        })

        // 编辑器配置独立保存到 editorConfig（localStorage + 文件）
        const newEditorConfig = {
            ...getEditorConfig(),
            fontSize: editorSettings.fontSize,
            tabSize: editorSettings.tabSize,
            wordWrap: editorSettings.wordWrap,
            lineNumbers: editorSettings.lineNumbers,
            minimap: editorSettings.minimap,
            bracketPairColorization: editorSettings.bracketPairColorization,
            formatOnSave: editorSettings.formatOnSave,
            autoSave: editorSettings.autoSave,
            autoSaveDelay: editorSettings.autoSaveDelay,
            ai: {
                ...getEditorConfig().ai,
                completionEnabled: editorSettings.completionEnabled,
                completionMaxTokens: editorSettings.completionMaxTokens,
                completionTriggerChars: editorSettings.completionTriggerChars,
            },
            terminal: {
                ...getEditorConfig().terminal,
                scrollback: editorSettings.terminalScrollback,
                maxOutputLines: editorSettings.terminalMaxOutputLines,
            },
            lsp: {
                ...getEditorConfig().lsp,
                timeoutMs: editorSettings.lspTimeoutMs,
                completionTimeoutMs: editorSettings.lspCompletionTimeoutMs,
            },
            performance: {
                ...getEditorConfig().performance,
                completionDebounceMs: editorSettings.completionDebounceMs,
                largeFileWarningThresholdMB: editorSettings.largeFileWarningThresholdMB,
                largeFileLineCount: editorSettings.largeFileLineCount,
                commandTimeoutMs: editorSettings.commandTimeoutMs,
                workerTimeoutMs: editorSettings.workerTimeoutMs,
                healthCheckTimeoutMs: editorSettings.healthCheckTimeoutMs,
                maxProjectFiles: editorSettings.maxProjectFiles,
                maxFileTreeDepth: editorSettings.maxFileTreeDepth,
                maxSearchResults: editorSettings.maxSearchResults,
                saveDebounceMs: editorSettings.saveDebounceMs,
                flushIntervalMs: editorSettings.flushIntervalMs,
            }
        }
        saveEditorConfig(newEditorConfig)

        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    const providers = Object.entries(PROVIDERS).map(([id, p]) => ({
        id,
        name: p.name,
        models: [...(p.models || []), ...(providerConfigs[id]?.customModels || [])]
    }))
    const selectedProvider = providers.find(p => p.id === localConfig.provider)

    const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
        { id: 'provider', label: language === 'zh' ? '模型提供商' : 'Providers', icon: <Cpu className="w-4 h-4" /> },
        { id: 'editor', label: language === 'zh' ? '编辑器' : 'Editor', icon: <Code className="w-4 h-4" /> },
        { id: 'snippets', label: language === 'zh' ? '代码片段' : 'Snippets', icon: <FileCode className="w-4 h-4" /> },
        { id: 'agent', label: language === 'zh' ? '智能体' : 'Agent', icon: <Settings2 className="w-4 h-4" /> },
        { id: 'rules', label: language === 'zh' ? '规则与记忆' : 'Rules & Memory', icon: <Brain className="w-4 h-4" /> },
        { id: 'mcp', label: 'MCP', icon: <Plug className="w-4 h-4" /> },
        { id: 'lsp', label: language === 'zh' ? '语言服务' : 'LSP', icon: <Braces className="w-4 h-4" /> },
        { id: 'keybindings', label: language === 'zh' ? '快捷键' : 'Keybindings', icon: <Keyboard className="w-4 h-4" /> },
        { id: 'indexing', label: language === 'zh' ? '代码索引' : 'Indexing', icon: <Database className="w-4 h-4" /> },
        { id: 'security', label: language === 'zh' ? '安全设置' : 'Security', icon: <Shield className="w-4 h-4" /> },
        { id: 'system', label: language === 'zh' ? '系统' : 'System', icon: <Monitor className="w-4 h-4" /> },
    ]

    return (
        <Modal isOpen={true} onClose={() => setShowSettings(false)} title="" size="5xl" noPadding className="overflow-hidden bg-background">
            <div className="flex h-[75vh] max-h-[800px]">
                {/* Modern Sidebar */}
                <div className="w-64 bg-white/5 backdrop-blur-md border-r border-border flex flex-col pt-6 pb-4">
                    <div className="px-6 mb-6">
                        <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                            {language === 'zh' ? '设置' : 'Settings'}
                        </h2>
                    </div>
                    
                    <nav className="flex-1 px-3 space-y-1.5 overflow-y-auto no-scrollbar">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-xs font-bold transition-all duration-300 relative group ${
                                    activeTab === tab.id
                                    ? 'bg-accent/10 text-accent shadow-sm'
                                    : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
                                    }`}
                            >
                                {/* Active Vertical Indicator */}
                                {activeTab === tab.id && (
                                    <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-accent rounded-r-full shadow-[0_0_10px_rgba(var(--accent),0.8)]" />
                                )}

                                <span className={`transition-colors duration-300 ${activeTab === tab.id ? 'text-accent scale-110' : 'text-text-muted group-hover:text-text-primary'}`}>
                                    {tab.icon}
                                </span>
                                <span className="uppercase tracking-widest">{tab.label}</span>
                                
                                {activeTab === tab.id && (
                                    <div className="ml-auto w-1 h-1 rounded-full bg-accent animate-pulse" />
                                )}
                            </button>
                        ))}
                    </nav>

                    {/* Language & Footer */}
                    <div className="mt-auto px-4 pt-4 border-t border-border space-y-4">
                        <div className="flex items-center gap-2 px-2 text-text-muted">
                            <Globe className="w-4 h-4" />
                            <span className="text-xs font-medium uppercase tracking-wider">{language === 'zh' ? '语言' : 'Language'}</span>
                        </div>
                        <Select
                            value={localLanguage}
                            onChange={(value) => setLocalLanguage(value as any)}
                            options={LANGUAGES.map(l => ({ value: l.id, label: l.name }))}
                            className="w-full text-sm bg-surface/50 border-border"
                        />
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col min-w-0 bg-background/50">
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar scroll-smooth">
                        {/* Tab Title */}
                        <div className="mb-6">
                            <h3 className="text-2xl font-bold text-text-primary">
                                {tabs.find(t => t.id === activeTab)?.label}
                            </h3>
                            <p className="text-sm text-text-muted mt-1">
                                {language === 'zh' ? '管理您的应用程序偏好设置' : 'Manage your application preferences and configurations'}
                            </p>
                        </div>

                        {activeTab === 'provider' && (
                            <ProviderSettings
                                localConfig={localConfig}
                                setLocalConfig={setLocalConfig}
                                localProviderConfigs={localProviderConfigs}
                                setLocalProviderConfigs={setLocalProviderConfigs}
                                showApiKey={showApiKey}
                                setShowApiKey={setShowApiKey}
                                selectedProvider={selectedProvider}
                                providers={providers}
                                language={language}
                            />
                        )}
                        {activeTab === 'editor' && (
                            <EditorSettings settings={editorSettings} setSettings={setEditorSettings} language={language} />
                        )}
                        {activeTab === 'snippets' && <SnippetSettings language={language} />}
                        {activeTab === 'agent' && (
                            <AgentSettings
                                autoApprove={localAutoApprove}
                                setAutoApprove={setLocalAutoApprove}
                                aiInstructions={localAiInstructions}
                                setAiInstructions={setLocalAiInstructions}
                                promptTemplateId={localPromptTemplateId}
                                setPromptTemplateId={setLocalPromptTemplateId}
                                agentConfig={localAgentConfig}
                                setAgentConfig={setLocalAgentConfig}
                                language={language}
                            />
                        )}
                        {activeTab === 'rules' && <RulesMemorySettings language={language} />}
                        {activeTab === 'keybindings' && <KeybindingPanel />}
                        {activeTab === 'mcp' && <McpSettings language={language} />}
                        {activeTab === 'lsp' && <LspSettings language={language} />}
                        {activeTab === 'indexing' && <IndexSettings language={language} />}
                        {activeTab === 'security' && <SecuritySettings language={language} />}
                        {activeTab === 'system' && <SystemSettings language={language} />}
                    </div>

                    {/* Floating Footer */}
                    <div className="px-8 py-5 border-t border-border bg-background/80 backdrop-blur-xl flex items-center justify-end gap-3 z-10">
                        <Button variant="ghost" onClick={() => setShowSettings(false)} className="hover:bg-white/5">
                            {language === 'zh' ? '取消' : 'Cancel'}
                        </Button>
                        <Button 
                            variant={saved ? 'success' : 'primary'} 
                            onClick={handleSave}
                            className={`min-w-[100px] shadow-lg ${saved ? 'bg-green-500 hover:bg-green-600' : 'bg-accent hover:bg-accent-hover shadow-accent/20'}`}
                        >
                            {saved ? (
                                <span className="flex items-center gap-2">
                                    {language === 'zh' ? '已保存' : 'Saved'}
                                </span>
                            ) : (language === 'zh' ? '保存更改' : 'Save Changes')}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    )
}
