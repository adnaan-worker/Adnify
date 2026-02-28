/**
 * 设置模态框主组件
 * 管理设置标签页切换和状态同步
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Cpu, Settings2, Code, Keyboard, Database, Shield, Monitor, Globe, Plug, Braces, Brain, FileCode, Zap, Check } from 'lucide-react'
import { useStore } from '@store'
import { PROVIDERS } from '@/shared/config/providers'
import { getEditorConfig } from '@renderer/settings'
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
    SnippetSettings,
    SkillSettings
} from './tabs'

export default function SettingsModal() {
    const {
        llmConfig, language, autoApprove, providerConfigs, promptTemplateId,
        agentConfig, aiInstructions, webSearchConfig, mcpConfig, enableFileLogging,
        set, setProvider, setShowSettings, save
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
    const [localWebSearchConfig, setLocalWebSearchConfig] = useState(webSearchConfig)
    const [localMcpConfig, setLocalMcpConfig] = useState(mcpConfig)
    const [localEnableFileLogging, setLocalEnableFileLogging] = useState(enableFileLogging)
    const [saved, setSaved] = useState(false)

    const editorConfig = getEditorConfig()
    const [editorSettings, setEditorSettings] = useState<EditorSettingsState>({
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
        completionEnabled: editorConfig.ai.completionEnabled,
        completionDebounceMs: editorConfig.performance.completionDebounceMs,
        completionMaxTokens: editorConfig.ai.completionMaxTokens,
        completionTriggerChars: editorConfig.ai.completionTriggerChars,
        terminalScrollback: editorConfig.terminal.scrollback,
        terminalMaxOutputLines: editorConfig.terminal.maxOutputLines,
        lspTimeoutMs: editorConfig.lsp.timeoutMs,
        lspCompletionTimeoutMs: editorConfig.lsp.completionTimeoutMs,
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
    // 高级编辑器配置（包含所有字段）
    const [advancedEditorConfig, setAdvancedEditorConfig] = useState(editorConfig)

    // 合并多个 useEffect 为单个，减少重复渲染
    useEffect(() => {
        setLocalConfig(llmConfig)
        setLocalProviderConfigs(providerConfigs)
        setLocalLanguage(language)
        setLocalAutoApprove(autoApprove)
        setLocalAgentConfig(agentConfig)
        setLocalAiInstructions(aiInstructions)
        setLocalWebSearchConfig(webSearchConfig)
        setLocalMcpConfig(mcpConfig)
        setLocalEnableFileLogging(enableFileLogging)
    }, [llmConfig, providerConfigs, language, autoApprove, agentConfig, aiInstructions, webSearchConfig, mcpConfig, enableFileLogging])

    const handleSave = useCallback(async () => {
        // 合并当前 provider 的配置（仅当 provider 仍存在时，避免重建已删除的 provider）
        const currentProvider = localConfig.provider
        const providerExists = localProviderConfigs[currentProvider] !== undefined ||
            !!PROVIDERS[currentProvider]

        const finalProviderConfigs = providerExists
            ? {
                ...localProviderConfigs,
                [currentProvider]: {
                    ...localProviderConfigs[currentProvider],
                    apiKey: localConfig.apiKey,
                    baseUrl: localConfig.baseUrl,
                    timeout: localConfig.timeout,
                    model: localConfig.model,
                    headers: localConfig.headers,
                    protocol: localConfig.protocol,
                }
            }
            : { ...localProviderConfigs }

        // 更新 Store 状态（包括 headers）
        set('llmConfig', localConfig)
        set('language', localLanguage)
        set('autoApprove', localAutoApprove)
        set('promptTemplateId', localPromptTemplateId)
        set('agentConfig', localAgentConfig)
        set('aiInstructions', localAiInstructions)
        set('webSearchConfig', localWebSearchConfig)
        set('mcpConfig', localMcpConfig)
        set('enableFileLogging', localEnableFileLogging)

        // 同步 providerConfigs：先删除不存在于 localProviderConfigs 的，再更新/添加
        // 使用 set 直接替换整个 providerConfigs，确保删除的配置也被移除
        set('providerConfigs', finalProviderConfigs)

        // 编辑器配置统一保存 - 合并 editorSettings 和 advancedEditorConfig
        const finalEditorConfig = {
            ...advancedEditorConfig,
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
                ...advancedEditorConfig.ai,
                completionEnabled: editorSettings.completionEnabled,
                completionMaxTokens: editorSettings.completionMaxTokens,
                completionTriggerChars: editorSettings.completionTriggerChars,
            },
            terminal: {
                ...advancedEditorConfig.terminal,
                scrollback: editorSettings.terminalScrollback,
                maxOutputLines: editorSettings.terminalMaxOutputLines,
            },
            lsp: {
                ...advancedEditorConfig.lsp,
                timeoutMs: editorSettings.lspTimeoutMs,
                completionTimeoutMs: editorSettings.lspCompletionTimeoutMs,
            },
            performance: {
                ...advancedEditorConfig.performance,
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

        // 更新 store 的 editorConfig
        set('editorConfig', finalEditorConfig)

        // 保存到文件
        await save()

        // 应用网络搜索配置到主进程
        if (localWebSearchConfig.googleApiKey && localWebSearchConfig.googleCx) {
            window.electronAPI?.httpSetGoogleSearch?.(localWebSearchConfig.googleApiKey, localWebSearchConfig.googleCx)
        }

        // 同步 MCP 自动连接设置到主进程
        window.electronAPI?.mcpSetAutoConnect?.(localMcpConfig.autoConnect ?? true)

        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }, [localConfig, localLanguage, localAutoApprove, localPromptTemplateId, localAgentConfig, localAiInstructions, localWebSearchConfig, localMcpConfig, localEnableFileLogging, localProviderConfigs, editorSettings, advancedEditorConfig, set, setProvider, save])

    // 使用 useMemo 缓存计算结果
    const providers = useMemo(() =>
        Object.entries(PROVIDERS).map(([id, p]) => ({
            id,
            name: p.displayName,
            models: [...(p.models || []), ...(providerConfigs[id]?.customModels || [])]
        })),
        [providerConfigs]
    )

    const selectedProvider = useMemo(() =>
        providers.find(p => p.id === localConfig.provider),
        [providers, localConfig.provider]
    )

    // 使用 useMemo 缓存 tabs 配置
    const tabs = useMemo(() => [
        { id: 'provider', label: language === 'zh' ? '模型提供商' : 'Providers', icon: <Cpu className="w-4 h-4" /> },
        { id: 'editor', label: language === 'zh' ? '编辑器' : 'Editor', icon: <Code className="w-4 h-4" /> },
        { id: 'snippets', label: language === 'zh' ? '代码片段' : 'Snippets', icon: <FileCode className="w-4 h-4" /> },
        { id: 'agent', label: language === 'zh' ? '智能体' : 'Agent', icon: <Settings2 className="w-4 h-4" /> },
        { id: 'rules', label: language === 'zh' ? '规则与记忆' : 'Rules & Memory', icon: <Brain className="w-4 h-4" /> },
        { id: 'skills', label: 'Skills', icon: <Zap className="w-4 h-4" /> },
        { id: 'mcp', label: 'MCP', icon: <Plug className="w-4 h-4" /> },
        { id: 'lsp', label: language === 'zh' ? '语言服务' : 'LSP', icon: <Braces className="w-4 h-4" /> },
        { id: 'keybindings', label: language === 'zh' ? '快捷键' : 'Keybindings', icon: <Keyboard className="w-4 h-4" /> },
        { id: 'indexing', label: language === 'zh' ? '代码索引' : 'Indexing', icon: <Database className="w-4 h-4" /> },
        { id: 'security', label: language === 'zh' ? '安全设置' : 'Security', icon: <Shield className="w-4 h-4" /> },
        { id: 'system', label: language === 'zh' ? '系统' : 'System', icon: <Monitor className="w-4 h-4" /> },
    ] as const, [language])

    return (
        <Modal isOpen={true} onClose={() => setShowSettings(false)} title="" size="5xl" noPadding className="overflow-hidden bg-background/80 backdrop-blur-2xl border border-border/50 shadow-2xl shadow-black/20 rounded-3xl">
            <div className="flex h-[75vh] max-h-[800px]">
                {/* Sidebar - macOS Style */}
                <div className="w-64 bg-surface/30 backdrop-blur-xl border-r border-border/50 flex flex-col pt-8 pb-6">
                    <div className="px-6 mb-6">
                        <h2 className="text-xl font-bold text-text-primary tracking-tight flex items-center gap-2.5">
                            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20">
                                <Settings2 className="w-5 h-5 text-accent" />
                            </div>
                            {language === 'zh' ? '设置' : 'Settings'}
                        </h2>
                    </div>

                    <nav className="flex-1 px-4 space-y-1 overflow-y-auto no-scrollbar">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group ${activeTab === tab.id
                                    ? 'bg-accent text-white shadow-md shadow-accent/20'
                                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                                    }`}
                            >
                                <span className={`transition-colors duration-200 ${activeTab === tab.id ? 'text-white' : 'text-text-muted group-hover:text-text-primary'}`}>
                                    {tab.icon}
                                </span>
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </nav>

                    <div className="mt-auto px-6 pt-6 border-t border-border/50 space-y-3">
                        <div className="flex items-center gap-2 px-1 text-text-muted opacity-80">
                            <Globe className="w-3.5 h-3.5" />
                            <span className="text-xs font-bold uppercase tracking-widest">{language === 'zh' ? '语言' : 'Language'}</span>
                        </div>
                        <Select
                            value={localLanguage}
                            onChange={(value) => setLocalLanguage(value as 'en' | 'zh')}
                            options={LANGUAGES.map(l => ({ value: l.id, label: l.name }))}
                            className="w-full text-xs bg-surface/50 border-border/50 hover:border-accent/50 transition-colors"
                        />
                    </div>
                </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col min-w-0 bg-transparent relative">
                    <div className="flex-1 overflow-y-auto px-10 py-10 custom-scrollbar scroll-smooth pb-28">
                        <div className="mb-8 pb-6 border-b border-border/40">
                            <h3 className="text-3xl font-bold text-text-primary tracking-tight">
                                {tabs.find(t => t.id === activeTab)?.label}
                            </h3>
                            <p className="text-sm text-text-muted mt-2 opacity-80 font-medium">
                                {language === 'zh' ? '管理您的应用程序偏好设置' : 'Manage your application preferences and configurations'}
                            </p>
                        </div>

                        <div className="animate-fade-in space-y-8">
                            {/* Render active tab content */}
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
                                    setProvider={setProvider}
                                />
                            )}
                            {activeTab === 'editor' && (
                                <EditorSettings
                                    settings={editorSettings}
                                    setSettings={setEditorSettings}
                                    advancedConfig={advancedEditorConfig}
                                    setAdvancedConfig={setAdvancedEditorConfig}
                                    language={language}
                                />
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
                                    webSearchConfig={localWebSearchConfig}
                                    setWebSearchConfig={setLocalWebSearchConfig}
                                    language={language}
                                />
                            )}
                            {activeTab === 'rules' && <RulesMemorySettings language={language} />}
                            {activeTab === 'skills' && <SkillSettings language={language} />}
                            {activeTab === 'keybindings' && <KeybindingPanel />}
                            {activeTab === 'mcp' && <McpSettings language={language} mcpConfig={localMcpConfig} setMcpConfig={setLocalMcpConfig} />}
                            {activeTab === 'lsp' && <LspSettings language={language} />}
                            {activeTab === 'indexing' && <IndexSettings language={language} />}
                            {activeTab === 'security' && <SecuritySettings language={language} />}
                            {activeTab === 'system' && <SystemSettings language={language} enableFileLogging={localEnableFileLogging} setEnableFileLogging={setLocalEnableFileLogging} />}
                        </div>
                    </div>

                    {/* Floating Action Bar */}
                    <div className="absolute bottom-6 right-8 left-8 p-4 rounded-2xl bg-surface/80 backdrop-blur-xl border border-border/50 shadow-2xl flex items-center justify-between z-10 transition-all duration-300">
                        <span className="text-xs text-text-muted ml-2 font-medium">
                            {saved ? (language === 'zh' ? '所有更改已保存' : 'All changes saved') : (language === 'zh' ? '有未保存的更改' : 'Unsaved changes')}
                        </span>
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" onClick={() => setShowSettings(false)} className="hover:bg-text-inverted/[0.05] hover:bg-text-primary/[0.05] text-text-secondary rounded-lg">
                                {language === 'zh' ? '取消' : 'Cancel'}
                            </Button>
                            <Button
                                variant={saved ? 'success' : 'primary'}
                                onClick={handleSave}
                                className={`min-w-[140px] shadow-lg transition-all duration-300 rounded-xl ${saved
                                    ? 'bg-status-success hover:bg-status-success/90 text-white'
                                    : 'bg-accent hover:bg-accent-hover text-white shadow-accent/20'
                                    }`}
                            >
                                {saved ? (
                                    <span className="flex items-center gap-2 justify-center font-bold">
                                        <Check className="w-4 h-4" />
                                        {language === 'zh' ? '已保存' : 'Saved'}
                                    </span>
                                ) : (
                                    <span className="font-bold">{language === 'zh' ? '保存更改' : 'Save Changes'}</span>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    )
}
