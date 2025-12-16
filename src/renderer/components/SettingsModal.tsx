/**
 * 增强版设置模态框
 * 支持多 Provider、自定义模型、编辑器设置等
 */

import React, { useState, useEffect } from 'react'
import {
  X, Cpu, Check, Eye, EyeOff, Terminal,
  FileEdit, AlertTriangle, Settings2, Code, Keyboard, Plus, Trash, HardDrive
} from 'lucide-react'
import { useStore, LLMConfig } from '../store'
import { t, Language } from '../i18n'
import { BUILTIN_PROVIDERS, BuiltinProviderName, ProviderModelConfig } from '../types/provider'
import { getEditorConfig, saveEditorConfig, EditorConfig } from '../config/editorConfig'
import { themeManager } from '../config/themeConfig'

type SettingsTab = 'provider' | 'editor' | 'agent' | 'keybindings' | 'system'

const LANGUAGES: { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'zh', name: '中文' },
]

export default function SettingsModal() {
  const { 
    llmConfig, setLLMConfig, setShowSettings, language, setLanguage, 
    autoApprove, setAutoApprove, providerConfigs, setProviderConfig 
  } = useStore()
  const [activeTab, setActiveTab] = useState<SettingsTab>('provider')
  const [showApiKey, setShowApiKey] = useState(false)
  const [localConfig, setLocalConfig] = useState(llmConfig)
  const [localLanguage, setLocalLanguage] = useState(language)
  const [localAutoApprove, setLocalAutoApprove] = useState(autoApprove)
  const [saved, setSaved] = useState(false)


  // 编辑器设置 - 使用集中配置
  const [editorConfig] = useState<EditorConfig>(getEditorConfig())
  
  // 兼容旧的 editorSettings 格式
  const [editorSettings, setEditorSettings] = useState({
    fontSize: editorConfig.fontSize,
    tabSize: editorConfig.tabSize,
    wordWrap: editorConfig.wordWrap,
    lineNumbers: 'on' as 'on' | 'off' | 'relative',
    minimap: editorConfig.minimap,
    bracketPairColorization: true,
    formatOnSave: true,
    autoSave: 'off' as 'off' | 'afterDelay' | 'onFocusChange',
    theme: 'vs-dark',
    // AI 代码补全设置
    completionEnabled: true,
    completionDebounceMs: editorConfig.performance.completionDebounceMs,
    completionMaxTokens: editorConfig.ai.completionMaxTokens,
  })

  // AI 指令
  const [aiInstructions, setAiInstructions] = useState('')

  useEffect(() => {
    setLocalConfig(llmConfig)
    setLocalLanguage(language)
    setLocalAutoApprove(autoApprove)
    // 加载设置
    window.electronAPI.getSetting('editorSettings').then(s => {
      if (s) setEditorSettings(s as typeof editorSettings)
    })
    window.electronAPI.getSetting('aiInstructions').then(s => {
      if (s) setAiInstructions(s as string)
    })
    window.electronAPI.getSetting('providerConfigs').then(s => {
        if (s) {
            Object.entries(s as Record<string, ProviderModelConfig>).forEach(([id, config]) => {
                setProviderConfig(id, config)
            })
        }
    })
  }, [llmConfig, language, autoApprove]) // 注意：这里不依赖 setProviderConfig 以避免循环，虽然它通常是稳定的

  const handleSave = async () => {
    setLLMConfig(localConfig)
    setLanguage(localLanguage)
    setAutoApprove(localAutoApprove)
    await window.electronAPI.setSetting('llmConfig', localConfig)
    await window.electronAPI.setSetting('language', localLanguage)
    await window.electronAPI.setSetting('autoApprove', localAutoApprove)
    await window.electronAPI.setSetting('editorSettings', editorSettings)
    await window.electronAPI.setSetting('aiInstructions', aiInstructions)
    // 保存 providerConfigs (它在 Store 中已经是新的了，因为我们直接修改了 store)
    // 但实际上我们在 ProviderSettings 组件中修改了 store 吗？
    // 是的，我们将把 addModel/removeModel 传递给子组件，它们会直接修改 Store。
    // 所以这里我们需要把 Store 中的 providerConfigs 保存到后端。
    await window.electronAPI.setSetting('providerConfigs', providerConfigs)
    
    // 保存编辑器配置（localStorage + 文件双重存储）
    saveEditorConfig({
      fontSize: editorSettings.fontSize,
      tabSize: editorSettings.tabSize,
      wordWrap: editorSettings.wordWrap,
      minimap: editorSettings.minimap,
      performance: {
        ...editorConfig.performance,
        completionDebounceMs: editorSettings.completionDebounceMs,
      },
      ai: {
        ...editorConfig.ai,
        completionMaxTokens: editorSettings.completionMaxTokens,
      },
    })
    
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // 计算当前的 PROVIDERS 列表
  const currentProviders = [
      ...Object.values(BUILTIN_PROVIDERS).map(p => ({
          id: p.name,
          name: p.displayName,
          models: [...p.defaultModels, ...(providerConfigs[p.name]?.customModels || [])]
      })),
      { 
          id: 'custom', 
          name: 'Custom', 
          models: providerConfigs['custom']?.customModels || [] 
      }
  ]

  const selectedProvider = currentProviders.find(p => p.id === localConfig.provider)

  const tabs = [
    { id: 'provider' as const, label: localLanguage === 'zh' ? 'AI 模型' : 'AI Models', icon: Cpu },
    { id: 'editor' as const, label: localLanguage === 'zh' ? '编辑器' : 'Editor', icon: Code },
    { id: 'agent' as const, label: localLanguage === 'zh' ? 'Agent' : 'Agent', icon: Settings2 },
    { id: 'keybindings' as const, label: localLanguage === 'zh' ? '快捷键' : 'Keybindings', icon: Keyboard },
    { id: 'system' as const, label: localLanguage === 'zh' ? '系统' : 'System', icon: HardDrive },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-background-secondary border border-border-subtle rounded-xl w-[850px] h-[650px] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle flex-shrink-0 bg-background/50">
          <h2 className="text-lg font-semibold text-text-primary">{t('settings', localLanguage)}</h2>
          <div className="flex items-center gap-4">
            {/* Language Selector */}
            <div className="relative group">
              <select
                value={localLanguage}
                onChange={(e) => setLocalLanguage(e.target.value as Language)}
                className="bg-surface border border-border-subtle rounded-lg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.id} value={lang.id}>{lang.name}</option>
                ))}
              </select>
              {/* 语言切换提示 */}
              {localLanguage !== language && (
                <div className="absolute top-full right-0 mt-1 px-2 py-1 bg-warning/10 border border-warning/20 rounded text-[10px] text-warning whitespace-nowrap z-50">
                  {localLanguage === 'zh' ? '保存后需重新加载以应用编辑器菜单语言' : 'Reload required for editor menu language'}
                </div>
              )}
            </div>
            <button onClick={() => setShowSettings(false)} className="p-2 rounded-lg hover:bg-surface-hover transition-colors">
              <X className="w-5 h-5 text-text-muted hover:text-text-primary" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-border-subtle p-2 flex-shrink-0 bg-background/30">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent font-medium shadow-sm'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-background custom-scrollbar">
            {activeTab === 'provider' && (
              <ProviderSettings
                localConfig={localConfig}
                setLocalConfig={setLocalConfig}
                showApiKey={showApiKey}
                setShowApiKey={setShowApiKey}
                selectedProvider={selectedProvider}
                providers={currentProviders}
                language={localLanguage}
              />
            )}

            {activeTab === 'editor' && (
              <EditorSettings
                settings={editorSettings}
                setSettings={setEditorSettings}
                language={localLanguage}
              />
            )}

            {activeTab === 'agent' && (
              <AgentSettings
                autoApprove={localAutoApprove}
                setAutoApprove={setLocalAutoApprove}
                aiInstructions={aiInstructions}
                setAiInstructions={setAiInstructions}
                language={localLanguage}
              />
            )}

            {activeTab === 'keybindings' && (
              <KeybindingsSettings language={localLanguage} />
            )}

            {activeTab === 'system' && (
              <SystemSettings language={localLanguage} />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-subtle flex-shrink-0 bg-background/50">
          <button onClick={() => setShowSettings(false)} className="px-4 py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors text-sm">
            {t('cancel', localLanguage)}
          </button>
          <button
            onClick={handleSave}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-medium transition-all shadow-glow ${
              saved ? 'bg-status-success text-white' : 'bg-accent hover:bg-accent-hover text-white'
            }`}
          >
            {saved ? <><Check className="w-4 h-4" />{t('saved', localLanguage)}</> : t('saveSettings', localLanguage)}
          </button>
        </div>
      </div>
    </div>
  )
}


// Provider 设置组件
interface ProviderSettingsProps {
  localConfig: LLMConfig
  setLocalConfig: React.Dispatch<React.SetStateAction<LLMConfig>>
  showApiKey: boolean
  setShowApiKey: (show: boolean) => void
  selectedProvider: { id: string; name: string; models: string[] } | undefined
  providers: { id: string; name: string; models: string[] }[]
  language: Language
}

function ProviderSettings({
  localConfig, setLocalConfig, showApiKey, setShowApiKey, selectedProvider, providers, language
}: ProviderSettingsProps) {
  const { addCustomModel, removeCustomModel, providerConfigs } = useStore()
  const [newModelName, setNewModelName] = useState('')

  const handleAddModel = () => {
      if (newModelName.trim()) {
          addCustomModel(localConfig.provider, newModelName.trim())
          setNewModelName('')
      }
  }

  return (
    <div className="space-y-6 text-text-primary">
      {/* Provider Selector */}
      <div>
        <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '服务提供商' : 'Provider'}</label>
        <div className="grid grid-cols-4 gap-2">
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => setLocalConfig({ ...localConfig, provider: p.id as any, model: p.models[0] || '' })}
              className={`px-3 py-2.5 rounded-lg border text-sm transition-all ${
                localConfig.provider === p.id
                  ? 'border-accent bg-accent/10 text-accent shadow-sm'
                  : 'border-border-subtle hover:border-text-muted text-text-muted hover:text-text-primary bg-surface'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Model Selector & Management */}
      <div>
        <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '模型' : 'Model'}</label>
        <div className="space-y-3">
            <select
            value={localConfig.model}
            onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            >
            {selectedProvider?.models.map(m => (
                <option key={m} value={m}>{m}</option>
            ))}
            </select>
            
            {/* Add Model UI */}
            <div className="flex gap-2">
                <input
                    type="text"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder={language === 'zh' ? '输入新模型名称' : 'Enter new model name'}
                    className="flex-1 bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                />
                <button
                    onClick={handleAddModel}
                    disabled={!newModelName.trim()}
                    className="px-3 py-2 bg-surface hover:bg-surface-hover border border-border-subtle rounded-lg disabled:opacity-50"
                >
                    <Plus className="w-4 h-4 text-accent" />
                </button>
            </div>

            {/* Custom Model List */}
            {providerConfigs[localConfig.provider]?.customModels?.length > 0 && (
                <div className="space-y-2 mt-2">
                    <p className="text-xs text-text-muted">{language === 'zh' ? '自定义模型列表:' : 'Custom Models:'}</p>
                    <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
                        {providerConfigs[localConfig.provider]?.customModels.map(model => (
                            <div key={model} className="flex items-center justify-between px-3 py-2 bg-surface/50 rounded-lg border border-border-subtle/50 text-xs">
                                <span className="font-mono text-text-secondary">{model}</span>
                                <button
                                    onClick={() => removeCustomModel(localConfig.provider, model)}
                                    className="p-1 hover:text-red-400 text-text-muted transition-colors"
                                >
                                    <Trash className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* API Key */}
      <div>
        <label className="text-sm font-medium mb-2 block">API Key</label>
        <div className="relative">
          <input
            type={showApiKey ? "text" : "password"}
            value={localConfig.apiKey}
            onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
            placeholder={BUILTIN_PROVIDERS[localConfig.provider as BuiltinProviderName]?.apiKeyPlaceholder || 'Enter API Key'}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent pr-10"
          />
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-2.5 text-text-muted hover:text-text-primary"
          >
            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-text-muted mt-2">
          {localConfig.provider !== 'custom' && localConfig.provider !== 'ollama' && (
             <a
               href={BUILTIN_PROVIDERS[localConfig.provider as BuiltinProviderName]?.apiKeyUrl}
               target="_blank"
               rel="noreferrer"
               className="hover:text-accent underline decoration-dotted"
             >
               {language === 'zh' ? '获取 API Key' : 'Get API Key'}
             </a>
          )}
        </p>
      </div>

      {/* Custom Endpoint */}
      {(localConfig.provider === 'custom' || BUILTIN_PROVIDERS[localConfig.provider as BuiltinProviderName]?.supportsCustomEndpoint) && (
        <div>
          <h3 className="text-sm font-medium mb-3">{language === 'zh' ? '自定义端点 (可选)' : 'Custom Endpoint (Optional)'}</h3>
          <input
            type="text"
            value={localConfig.baseUrl || ''}
            onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value || undefined })}
            placeholder={localConfig.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-text-muted mt-2">
            {language === 'zh' ? '用于 OpenAI 兼容的 API 或本地模型' : 'For OpenAI-compatible APIs or local models'}
          </p>
        </div>
      )}

      {/* Request Timeout */}
      <div>
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? '请求超时' : 'Request Timeout'}</h3>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={(localConfig.timeout || 120000) / 1000}
            onChange={(e) => setLocalConfig({ ...localConfig, timeout: (parseInt(e.target.value) || 120) * 1000 })}
            min={30}
            max={600}
            step={30}
            className="w-32 bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
          <span className="text-sm text-text-muted">{language === 'zh' ? '秒' : 'seconds'}</span>
        </div>
        <p className="text-xs text-text-muted mt-2">
          {language === 'zh' ? 'API 请求的最大等待时间（30-600秒）' : 'Maximum wait time for API requests (30-600 seconds)'}
        </p>
      </div>
    </div>
  )
}


// 编辑器设置组件
interface EditorSettingsState {
  fontSize: number
  tabSize: number
  wordWrap: 'on' | 'off' | 'wordWrapColumn'
  lineNumbers: 'on' | 'off' | 'relative'
  minimap: boolean
  bracketPairColorization: boolean
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  theme: string
  // AI 代码补全设置
  completionEnabled: boolean
  completionDebounceMs: number
  completionMaxTokens: number
}

interface EditorSettingsProps {
  settings: EditorSettingsState
  setSettings: (settings: EditorSettingsState) => void
  language: Language
}

function EditorSettings({ settings, setSettings, language }: EditorSettingsProps) {
  // 获取完整配置用于显示高级选项
  const [advancedConfig, setAdvancedConfig] = useState(getEditorConfig())
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [currentTheme, setCurrentTheme] = useState(themeManager.getCurrentTheme())
  const allThemes = themeManager.getAllThemes()

  const handleThemeChange = (themeId: string) => {
    themeManager.setTheme(themeId)
    setCurrentTheme(themeManager.getCurrentTheme())
  }

  const handleAdvancedChange = (key: string, value: number) => {
    const newConfig = { ...advancedConfig }
    if (key.startsWith('performance.')) {
      const perfKey = key.replace('performance.', '') as keyof typeof newConfig.performance
      newConfig.performance = { ...newConfig.performance, [perfKey]: value }
    } else if (key.startsWith('ai.')) {
      const aiKey = key.replace('ai.', '') as keyof typeof newConfig.ai
      newConfig.ai = { ...newConfig.ai, [aiKey]: value }
    }
    setAdvancedConfig(newConfig)
    saveEditorConfig(newConfig)
  }

  return (
    <div className="space-y-6 text-text-primary">
      {/* 主题选择器 */}
      <div>
        <label className="text-sm font-medium mb-3 block">{language === 'zh' ? '主题' : 'Theme'}</label>
        <div className="grid grid-cols-3 gap-2">
          {allThemes.map(theme => (
            <button
              key={theme.id}
              onClick={() => handleThemeChange(theme.id)}
              className={`relative p-3 rounded-lg border text-left transition-all ${
                currentTheme.id === theme.id
                  ? 'border-accent bg-accent/10 shadow-sm'
                  : 'border-border-subtle hover:border-text-muted bg-surface'
              }`}
            >
              {/* 主题预览色块 */}
              <div className="flex gap-1 mb-2">
                <div 
                  className="w-4 h-4 rounded" 
                  style={{ backgroundColor: `rgb(${theme.colors.background})` }}
                />
                <div 
                  className="w-4 h-4 rounded" 
                  style={{ backgroundColor: `rgb(${theme.colors.accent})` }}
                />
                <div 
                  className="w-4 h-4 rounded" 
                  style={{ backgroundColor: `rgb(${theme.colors.textPrimary})` }}
                />
              </div>
              <span className="text-xs font-medium">{theme.name}</span>
              <span className="text-[10px] text-text-muted ml-1">({theme.type})</span>
              {currentTheme.id === theme.id && (
                <div className="absolute top-1 right-1">
                  <Check className="w-3 h-3 text-accent" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '字体大小' : 'Font Size'}</label>
          <input
            type="number"
            value={settings.fontSize}
            onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) || 14 })}
            min={10} max={24}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-2 block">{language === 'zh' ? 'Tab 大小' : 'Tab Size'}</label>
          <select
            value={settings.tabSize}
            onChange={(e) => setSettings({ ...settings, tabSize: parseInt(e.target.value) })}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value={2}>2</option>
            <option value={4}>4</option>
            <option value={8}>8</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '自动换行' : 'Word Wrap'}</label>
          <select
            value={settings.wordWrap}
            onChange={(e) => setSettings({ ...settings, wordWrap: e.target.value as 'on' | 'off' | 'wordWrapColumn' })}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="on">{language === 'zh' ? '开启' : 'On'}</option>
            <option value="off">{language === 'zh' ? '关闭' : 'Off'}</option>
            <option value="wordWrapColumn">{language === 'zh' ? '按列' : 'By Column'}</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '行号' : 'Line Numbers'}</label>
          <select
            value={settings.lineNumbers}
            onChange={(e) => setSettings({ ...settings, lineNumbers: e.target.value as 'on' | 'off' | 'relative' })}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="on">{language === 'zh' ? '显示' : 'On'}</option>
            <option value="off">{language === 'zh' ? '隐藏' : 'Off'}</option>
            <option value="relative">{language === 'zh' ? '相对' : 'Relative'}</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
          <input
            type="checkbox"
            checked={settings.minimap}
            onChange={(e) => setSettings({ ...settings, minimap: e.target.checked })}
            className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent"
          />
          <span className="text-sm">{language === 'zh' ? '显示小地图' : 'Show Minimap'}</span>
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
          <input
            type="checkbox"
            checked={settings.bracketPairColorization}
            onChange={(e) => setSettings({ ...settings, bracketPairColorization: e.target.checked })}
            className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent"
          />
          <span className="text-sm">{language === 'zh' ? '括号配对着色' : 'Bracket Pair Colorization'}</span>
        </label>

        <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
          <input
            type="checkbox"
            checked={settings.formatOnSave}
            onChange={(e) => setSettings({ ...settings, formatOnSave: e.target.checked })}
            className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent"
          />
          <span className="text-sm">{language === 'zh' ? '保存时格式化' : 'Format on Save'}</span>
        </label>
      </div>

      <div>
        <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '自动保存' : 'Auto Save'}</label>
        <select
          value={settings.autoSave}
          onChange={(e) => setSettings({ ...settings, autoSave: e.target.value as 'off' | 'afterDelay' | 'onFocusChange' })}
          className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="off">{language === 'zh' ? '关闭' : 'Off'}</option>
          <option value="afterDelay">{language === 'zh' ? '延迟后' : 'After Delay'}</option>
          <option value="onFocusChange">{language === 'zh' ? '失去焦点时' : 'On Focus Change'}</option>
        </select>
      </div>

      {/* AI 代码补全设置 */}
      <div className="pt-4 border-t border-border-subtle">
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? 'AI 代码补全' : 'AI Code Completion'}</h3>
        
        <div className="space-y-3">
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
            <input
              type="checkbox"
              checked={settings.completionEnabled}
              onChange={(e) => setSettings({ ...settings, completionEnabled: e.target.checked })}
              className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent"
            />
            <div className="flex-1">
              <span className="text-sm">{language === 'zh' ? '启用 AI 补全' : 'Enable AI Completion'}</span>
              <p className="text-xs text-text-muted">{language === 'zh' ? '输入时显示 AI 代码建议' : 'Show AI code suggestions while typing'}</p>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '触发延迟 (ms)' : 'Trigger Delay (ms)'}</label>
            <input
              type="number"
              value={settings.completionDebounceMs}
              onChange={(e) => setSettings({ ...settings, completionDebounceMs: parseInt(e.target.value) || 150 })}
              min={50} max={1000} step={50}
              className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-text-muted mt-1">{language === 'zh' ? '停止输入后等待时间' : 'Wait time after typing stops'}</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '最大 Token 数' : 'Max Tokens'}</label>
            <input
              type="number"
              value={settings.completionMaxTokens}
              onChange={(e) => setSettings({ ...settings, completionMaxTokens: parseInt(e.target.value) || 256 })}
              min={64} max={1024} step={64}
              className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-text-muted mt-1">{language === 'zh' ? '补全建议的最大长度' : 'Maximum length of suggestions'}</p>
          </div>
        </div>
      </div>

      {/* 高级性能设置 */}
      <div className="pt-4 border-t border-border-subtle">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors"
        >
          <span>{showAdvanced ? '▼' : '▶'}</span>
          {language === 'zh' ? '高级性能设置' : 'Advanced Performance Settings'}
        </button>
        
        {showAdvanced && (
          <div className="mt-4 space-y-4 animate-slide-in">
            <p className="text-xs text-text-muted">
              {language === 'zh' ? '这些设置会影响编辑器性能，请谨慎修改' : 'These settings affect editor performance, modify with caution'}
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '最大项目文件数' : 'Max Project Files'}</label>
                <input
                  type="number"
                  value={advancedConfig.performance.maxProjectFiles}
                  onChange={(e) => handleAdvancedChange('performance.maxProjectFiles', parseInt(e.target.value) || 500)}
                  min={100} max={2000} step={100}
                  className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
                <p className="text-xs text-text-muted mt-1">{language === 'zh' ? 'LSP 扫描的最大文件数' : 'Max files for LSP scanning'}</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '文件树最大深度' : 'Max File Tree Depth'}</label>
                <input
                  type="number"
                  value={advancedConfig.performance.maxFileTreeDepth}
                  onChange={(e) => handleAdvancedChange('performance.maxFileTreeDepth', parseInt(e.target.value) || 5)}
                  min={2} max={10}
                  className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">{language === 'zh' ? 'Git 刷新间隔 (ms)' : 'Git Refresh Interval (ms)'}</label>
                <input
                  type="number"
                  value={advancedConfig.performance.gitStatusIntervalMs}
                  onChange={(e) => handleAdvancedChange('performance.gitStatusIntervalMs', parseInt(e.target.value) || 5000)}
                  min={1000} max={30000} step={1000}
                  className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '请求超时 (ms)' : 'Request Timeout (ms)'}</label>
                <input
                  type="number"
                  value={advancedConfig.performance.requestTimeoutMs}
                  onChange={(e) => handleAdvancedChange('performance.requestTimeoutMs', parseInt(e.target.value) || 120000)}
                  min={30000} max={300000} step={10000}
                  className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">{language === 'zh' ? 'Agent 最大循环次数' : 'Max Agent Tool Loops'}</label>
                <input
                  type="number"
                  value={advancedConfig.ai.maxToolLoops}
                  onChange={(e) => handleAdvancedChange('ai.maxToolLoops', parseInt(e.target.value) || 15)}
                  min={5} max={50}
                  className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
                <p className="text-xs text-text-muted mt-1">{language === 'zh' ? '单次对话最大工具调用次数' : 'Max tool calls per conversation'}</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">{language === 'zh' ? '终端缓冲区大小' : 'Terminal Buffer Size'}</label>
                <input
                  type="number"
                  value={advancedConfig.performance.terminalBufferSize}
                  onChange={(e) => handleAdvancedChange('performance.terminalBufferSize', parseInt(e.target.value) || 500)}
                  min={100} max={2000} step={100}
                  className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


// Agent 设置组件
interface AgentSettingsProps {
  autoApprove: { edits: boolean; terminal: boolean; dangerous: boolean }
  setAutoApprove: (settings: { edits: boolean; terminal: boolean; dangerous: boolean }) => void
  aiInstructions: string
  setAiInstructions: (instructions: string) => void
  language: Language
}

function AgentSettings({ autoApprove, setAutoApprove, aiInstructions, setAiInstructions, language }: AgentSettingsProps) {
  return (
    <div className="space-y-6 text-text-primary">
      <div>
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? '自动审批' : 'Auto Approve'}</h3>
        <p className="text-xs text-text-muted mb-3">
          {language === 'zh' ? '启用后，工具调用将自动执行' : 'When enabled, tool calls execute automatically'}
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
            <input type="checkbox" checked={autoApprove.edits} onChange={(e) => setAutoApprove({ ...autoApprove, edits: e.target.checked })} className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent" />
            <FileEdit className="w-4 h-4 text-blue-400" />
            <div className="flex-1">
              <span className="text-sm">{language === 'zh' ? '文件编辑' : 'File Edits'}</span>
              <p className="text-xs text-text-muted">{language === 'zh' ? '创建、修改文件' : 'Create, modify files'}</p>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
            <input type="checkbox" checked={autoApprove.terminal} onChange={(e) => setAutoApprove({ ...autoApprove, terminal: e.target.checked })} className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent" />
            <Terminal className="w-4 h-4 text-green-400" />
            <div className="flex-1">
              <span className="text-sm">{language === 'zh' ? '终端命令' : 'Terminal Commands'}</span>
              <p className="text-xs text-text-muted">{language === 'zh' ? '执行 shell 命令' : 'Execute shell commands'}</p>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 rounded-lg border border-border-subtle hover:border-text-muted cursor-pointer bg-surface/50 transition-colors">
            <input type="checkbox" checked={autoApprove.dangerous} onChange={(e) => setAutoApprove({ ...autoApprove, dangerous: e.target.checked })} className="w-4 h-4 rounded border-border-subtle text-accent focus:ring-accent" />
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <div className="flex-1">
              <span className="text-sm">{language === 'zh' ? '危险操作' : 'Dangerous Operations'}</span>
              <p className="text-xs text-text-muted">{language === 'zh' ? '删除文件等' : 'Delete files, etc.'}</p>
            </div>
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? 'AI 自定义指令' : 'AI Custom Instructions'}</h3>
        <p className="text-xs text-text-muted mb-3">
          {language === 'zh' ? '这些指令会添加到每次对话的系统提示词中' : 'These instructions are added to every conversation'}
        </p>
        <textarea
          value={aiInstructions}
          onChange={(e) => setAiInstructions(e.target.value)}
          placeholder={language === 'zh' ? '例如：使用中文回复，代码注释用英文...' : 'e.g., Always use TypeScript, prefer functional components...'}
          className="w-full h-32 bg-surface border border-border-subtle rounded-lg px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent resize-none"
        />
      </div>
    </div>
  )
}

// 快捷键设置组件
function KeybindingsSettings({ language }: { language: Language }) {
  const shortcuts = [
    { keys: 'Ctrl+S', action: language === 'zh' ? '保存文件' : 'Save File' },
    { keys: 'Ctrl+P', action: language === 'zh' ? '快速打开' : 'Quick Open' },
    { keys: 'Ctrl+Shift+P', action: language === 'zh' ? '命令面板' : 'Command Palette' },
    { keys: 'Ctrl+`', action: language === 'zh' ? '切换终端' : 'Toggle Terminal' },
    { keys: 'Ctrl+,', action: language === 'zh' ? '打开设置' : 'Open Settings' },
    { keys: 'Ctrl+B', action: language === 'zh' ? '切换侧边栏' : 'Toggle Sidebar' },
    { keys: 'Ctrl+/', action: language === 'zh' ? '切换注释' : 'Toggle Comment' },
    { keys: 'Ctrl+D', action: language === 'zh' ? '选择下一个匹配' : 'Select Next Match' },
    { keys: 'Ctrl+F', action: language === 'zh' ? '查找' : 'Find' },
    { keys: 'Ctrl+H', action: language === 'zh' ? '替换' : 'Replace' },
    { keys: 'Ctrl+G', action: language === 'zh' ? '跳转到行' : 'Go to Line' },
    { keys: 'F12', action: language === 'zh' ? '跳转到定义' : 'Go to Definition' },
    { keys: 'Shift+F12', action: language === 'zh' ? '查找引用' : 'Find References' },
    { keys: 'Ctrl+Enter', action: language === 'zh' ? '发送消息' : 'Send Message' },
    { keys: 'Escape', action: language === 'zh' ? '停止生成' : 'Stop Generation' },
  ]

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        {language === 'zh' ? '快捷键暂不支持自定义，以下是默认快捷键列表' : 'Keybindings are not customizable yet. Here are the defaults:'}
      </p>
      <div className="space-y-1">
        {shortcuts.map((s, i) => (
          <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-hover text-text-primary">
            <span className="text-sm text-text-muted">{s.action}</span>
            <kbd className="px-2 py-1 text-xs font-mono bg-surface border border-border-subtle rounded">{s.keys}</kbd>
          </div>
        ))}
      </div>
    </div>
  )
}

// 系统设置组件
function SystemSettings({ language }: { language: Language }) {
  const { workspacePath } = useStore()
  const [dataPath, setDataPath] = useState<string>('')
  const [loading, setLoading] = useState(false)
  
  // Embedding 配置状态
  const [embeddingProviders, setEmbeddingProviders] = useState<{id: string; name: string; description: string; free: boolean}[]>([])
  const [embeddingConfig, setEmbeddingConfig] = useState<{
    provider: 'jina' | 'voyage' | 'openai' | 'cohere' | 'huggingface' | 'ollama'
    apiKey: string
    model: string
    baseUrl: string
  }>({
    provider: 'jina',
    apiKey: '',
    model: '',
    baseUrl: ''
  })
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<{success: boolean; latency?: number; error?: string} | null>(null)
  const [indexStatus, setIndexStatus] = useState<{isIndexing: boolean; totalFiles: number; indexedFiles: number; totalChunks: number} | null>(null)

  useEffect(() => {
    window.electronAPI.getDataPath().then(setDataPath)
    // 加载 Embedding 提供商列表
    window.electronAPI.indexGetProviders().then(setEmbeddingProviders)
    // 加载保存的 Embedding 配置
    window.electronAPI.getSetting('embeddingConfig').then(config => {
      if (config) setEmbeddingConfig(config as typeof embeddingConfig)
    })
  }, [])

  // 监听索引进度
  useEffect(() => {
    if (!workspacePath) return
    
    // 获取初始状态
    window.electronAPI.indexStatus(workspacePath).then(setIndexStatus)
    
    // 监听进度更新
    const unsubscribe = window.electronAPI.onIndexProgress(setIndexStatus)
    return unsubscribe
  }, [workspacePath])

  const handleChangePath = async () => {
    const newPath = await window.electronAPI.openFolder()
    if (newPath && newPath !== dataPath) {
        if (confirm(language === 'zh' 
            ? '更改配置目录将把当前配置移动到新位置，并可能需要重启应用。确定继续吗？' 
            : 'Changing the data directory will move your current configuration to the new location and may require a restart. Continue?')) {
            setLoading(true)
            const success = await window.electronAPI.setDataPath(newPath)
            setLoading(false)
            if (success) {
                setDataPath(newPath)
                alert(language === 'zh' ? '配置目录已更改' : 'Data directory changed successfully')
            } else {
                alert(language === 'zh' ? '更改失败' : 'Failed to change data directory')
            }
        }
    }
  }

  const handleTestConnection = async () => {
    if (!workspacePath) return
    setTestingConnection(true)
    setConnectionStatus(null)
    
    // 先更新配置
    await window.electronAPI.indexUpdateEmbeddingConfig(workspacePath, embeddingConfig)
    // 测试连接
    const result = await window.electronAPI.indexTestConnection(workspacePath)
    setConnectionStatus(result)
    setTestingConnection(false)
  }

  const handleSaveEmbeddingConfig = async () => {
    await window.electronAPI.setSetting('embeddingConfig', embeddingConfig)
    if (workspacePath) {
      await window.electronAPI.indexUpdateEmbeddingConfig(workspacePath, embeddingConfig)
    }
  }

  const handleStartIndexing = async () => {
    if (!workspacePath) {
      alert(language === 'zh' ? '请先打开一个工作区' : 'Please open a workspace first')
      return
    }
    
    // 保存配置
    await handleSaveEmbeddingConfig()
    // 开始索引
    await window.electronAPI.indexStart(workspacePath)
  }

  const handleClearIndex = async () => {
    if (!workspacePath) return
    if (confirm(language === 'zh' ? '确定要清空索引吗？' : 'Are you sure you want to clear the index?')) {
      await window.electronAPI.indexClear(workspacePath)
      setIndexStatus({ isIndexing: false, totalFiles: 0, indexedFiles: 0, totalChunks: 0 })
    }
  }

  const selectedProviderInfo = embeddingProviders.find(p => p.id === embeddingConfig.provider)

  return (
    <div className="space-y-6 text-text-primary">
      {/* 数据存储 */}
      <div>
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? '数据存储' : 'Data Storage'}</h3>
        <p className="text-xs text-text-muted mb-3">
          {language === 'zh' 
            ? '选择保存应用程序配置和数据的目录。' 
            : 'Choose the directory where application configuration and data are saved.'}
        </p>
        
        <div className="flex gap-3">
            <div className="flex-1 bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-secondary font-mono truncate">
                {dataPath || (language === 'zh' ? '加载中...' : 'Loading...')}
            </div>
            <button 
                onClick={handleChangePath}
                disabled={loading}
                className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border-subtle rounded-lg text-sm text-text-primary transition-colors disabled:opacity-50"
            >
                {loading 
                    ? (language === 'zh' ? '移动中...' : 'Moving...') 
                    : (language === 'zh' ? '更改目录' : 'Change Directory')}
            </button>
        </div>
      </div>

      {/* 代码库索引 */}
      <div className="pt-4 border-t border-border-subtle">
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? '代码库索引 (Codebase Index)' : 'Codebase Index'}</h3>
        <p className="text-xs text-text-muted mb-4">
          {language === 'zh' 
            ? '索引你的代码库以启用 @codebase 语义搜索功能。' 
            : 'Index your codebase to enable @codebase semantic search.'}
        </p>

        {/* Embedding 提供商选择 */}
        <div className="mb-4">
          <label className="text-sm font-medium mb-2 block">{language === 'zh' ? 'Embedding 提供商' : 'Embedding Provider'}</label>
          <div className="grid grid-cols-3 gap-2">
            {embeddingProviders.map(p => (
              <button
                key={p.id}
                onClick={() => setEmbeddingConfig({ ...embeddingConfig, provider: p.id as typeof embeddingConfig.provider })}
                className={`px-3 py-2 rounded-lg border text-xs transition-all text-left ${
                  embeddingConfig.provider === p.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-subtle hover:border-text-muted text-text-muted hover:text-text-primary bg-surface'
                }`}
              >
                <div className="font-medium">{p.name}</div>
                {p.free && <span className="text-green-400 text-[10px]">FREE</span>}
              </button>
            ))}
          </div>
          {selectedProviderInfo && (
            <p className="text-xs text-text-muted mt-2">{selectedProviderInfo.description}</p>
          )}
        </div>

        {/* API Key */}
        {embeddingConfig.provider !== 'ollama' && (
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">API Key</label>
            <input
              type="password"
              value={embeddingConfig.apiKey}
              onChange={(e) => setEmbeddingConfig({ ...embeddingConfig, apiKey: e.target.value })}
              placeholder={`Enter ${selectedProviderInfo?.name || ''} API Key`}
              className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-text-muted mt-1">
              {embeddingConfig.provider === 'jina' && <a href="https://jina.ai/embeddings/" target="_blank" rel="noreferrer" className="text-accent hover:underline">获取免费 Jina API Key</a>}
              {embeddingConfig.provider === 'voyage' && <a href="https://www.voyageai.com/" target="_blank" rel="noreferrer" className="text-accent hover:underline">获取免费 Voyage API Key</a>}
              {embeddingConfig.provider === 'cohere' && <a href="https://cohere.com/" target="_blank" rel="noreferrer" className="text-accent hover:underline">获取免费 Cohere API Key</a>}
            </p>
          </div>
        )}

        {/* 自定义端点 (Ollama) */}
        {embeddingConfig.provider === 'ollama' && (
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">{language === 'zh' ? 'Ollama 地址' : 'Ollama URL'}</label>
            <input
              type="text"
              value={embeddingConfig.baseUrl}
              onChange={(e) => setEmbeddingConfig({ ...embeddingConfig, baseUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-text-muted mt-1">
              {language === 'zh' ? '确保 Ollama 正在运行并已安装 nomic-embed-text 模型' : 'Make sure Ollama is running with nomic-embed-text model'}
            </p>
          </div>
        )}

        {/* 测试连接 */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={handleTestConnection}
            disabled={testingConnection || !workspacePath}
            className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border-subtle rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {testingConnection ? (language === 'zh' ? '测试中...' : 'Testing...') : (language === 'zh' ? '测试连接' : 'Test Connection')}
          </button>
          {connectionStatus && (
            <span className={`text-xs ${connectionStatus.success ? 'text-green-400' : 'text-red-400'}`}>
              {connectionStatus.success 
                ? `✓ ${language === 'zh' ? '连接成功' : 'Connected'} (${connectionStatus.latency}ms)` 
                : `✗ ${connectionStatus.error}`}
            </span>
          )}
        </div>

        {/* 索引状态和操作 */}
        <div className="p-4 bg-surface/50 rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">{language === 'zh' ? '索引状态' : 'Index Status'}</span>
            {indexStatus?.isIndexing && (
              <span className="text-xs text-accent animate-pulse">{language === 'zh' ? '索引中...' : 'Indexing...'}</span>
            )}
          </div>
          
          {indexStatus?.isIndexing ? (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-text-muted">
                <span>{language === 'zh' ? '进度' : 'Progress'}</span>
                <span>{indexStatus.indexedFiles} / {indexStatus.totalFiles} {language === 'zh' ? '文件' : 'files'}</span>
              </div>
              <div className="w-full h-2 bg-surface rounded-full overflow-hidden">
                <div 
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${indexStatus.totalFiles > 0 ? (indexStatus.indexedFiles / indexStatus.totalFiles) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-text-muted">
              {indexStatus?.totalChunks ? (
                <span>{language === 'zh' ? `已索引 ${indexStatus.totalChunks} 个代码块` : `${indexStatus.totalChunks} chunks indexed`}</span>
              ) : (
                <span>{language === 'zh' ? '尚未索引' : 'Not indexed yet'}</span>
              )}
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleStartIndexing}
              disabled={indexStatus?.isIndexing || !workspacePath}
              className="flex-1 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {indexStatus?.totalChunks 
                ? (language === 'zh' ? '重新索引' : 'Re-index') 
                : (language === 'zh' ? '开始索引' : 'Start Indexing')}
            </button>
            {indexStatus?.totalChunks ? (
              <button
                onClick={handleClearIndex}
                disabled={indexStatus?.isIndexing}
                className="px-4 py-2 bg-surface hover:bg-red-500/10 border border-border-subtle hover:border-red-500/50 text-text-muted hover:text-red-400 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {language === 'zh' ? '清空' : 'Clear'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 引导向导 */}
      <div className="pt-4 border-t border-border-subtle">
        <h3 className="text-sm font-medium mb-3">{language === 'zh' ? '引导向导' : 'Setup Wizard'}</h3>
        <p className="text-xs text-text-muted mb-3">
          {language === 'zh' 
            ? '重新运行首次使用引导，帮助你配置基本设置。' 
            : 'Re-run the first-time setup wizard to configure basic settings.'}
        </p>
        <button
          onClick={async () => {
            await window.electronAPI.setSetting('onboardingCompleted', false)
            window.location.reload()
          }}
          className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border-subtle rounded-lg text-sm text-text-primary transition-colors"
        >
          {language === 'zh' ? '重新运行引导' : 'Run Setup Wizard'}
        </button>
      </div>
    </div>
  )
}
