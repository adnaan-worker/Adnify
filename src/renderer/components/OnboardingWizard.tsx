/**
 * 首次使用引导向导
 * 引导用户完成初始配置
 */

import React, { useState, useEffect } from 'react'
import {
  ChevronRight, ChevronLeft, Check, Sparkles, Palette, 
  Globe, Cpu, FolderOpen, Rocket, HardDrive
} from 'lucide-react'
import { useStore, LLMConfig } from '../store'
import { Language } from '../i18n'
import { themeManager, Theme } from '../config/themeConfig'
import { BUILTIN_PROVIDERS, BuiltinProviderName } from '../types/provider'
import { Logo } from './Logo'

interface OnboardingWizardProps {
  onComplete: () => void
}

type Step = 'welcome' | 'language' | 'theme' | 'provider' | 'dataPath' | 'workspace' | 'complete'

const STEPS: Step[] = ['welcome', 'language', 'theme', 'provider', 'dataPath', 'workspace', 'complete']

const LANGUAGES: { id: Language; name: string; native: string }[] = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'zh', name: 'Chinese', native: '中文' },
]

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { 
    setLLMConfig, setLanguage, language,
    setWorkspacePath, setFiles
  } = useStore()
  
  const [currentStep, setCurrentStep] = useState<Step>('welcome')
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [selectedTheme, setSelectedTheme] = useState(themeManager.getCurrentTheme().id)
  const [providerConfig, setProviderConfig] = useState<LLMConfig>({
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [dataPath, setDataPath] = useState<string>('')

  const allThemes = themeManager.getAllThemes()

  // 加载当前数据路径
  useEffect(() => {
    window.electronAPI.getDataPath().then(setDataPath)
  }, [])
  const currentStepIndex = STEPS.indexOf(currentStep)
  const isZh = selectedLanguage === 'zh'

  // 应用语言和主题预览
  useEffect(() => {
    themeManager.setTheme(selectedTheme)
  }, [selectedTheme])

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setIsTransitioning(true)
      setTimeout(() => {
        setCurrentStep(STEPS[currentStepIndex + 1])
        setIsTransitioning(false)
      }, 200)
    }
  }

  const goPrev = () => {
    if (currentStepIndex > 0) {
      setIsTransitioning(true)
      setTimeout(() => {
        setCurrentStep(STEPS[currentStepIndex - 1])
        setIsTransitioning(false)
      }, 200)
    }
  }

  const handleComplete = async () => {
    // 保存所有设置
    setLanguage(selectedLanguage)
    setLLMConfig(providerConfig)
    
    await window.electronAPI.setSetting('language', selectedLanguage)
    await window.electronAPI.setSetting('llmConfig', providerConfig)
    await window.electronAPI.setSetting('onboardingCompleted', true)
    
    onComplete()
  }

  const handleOpenFolder = async () => {
    const result = await window.electronAPI.openFolder()
    if (result) {
      setWorkspacePath(result)
      const items = await window.electronAPI.readDir(result)
      setFiles(items)
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 'provider':
        // API Key 可选，用户可以稍后配置
        return true
      default:
        return true
    }
  }

  return (
    <div className="fixed inset-0 bg-background flex items-center justify-center z-[9999]">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-2xl mx-4">
        {/* 进度指示器 */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            {STEPS.slice(0, -1).map((step, index) => (
              <React.Fragment key={step}>
                <div
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                    index < currentStepIndex
                      ? 'bg-accent'
                      : index === currentStepIndex
                      ? 'bg-accent scale-125'
                      : 'bg-surface-active'
                  }`}
                />
                {index < STEPS.length - 2 && (
                  <div
                    className={`w-8 h-0.5 transition-all duration-300 ${
                      index < currentStepIndex ? 'bg-accent' : 'bg-surface-active'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 内容卡片 */}
        <div 
          className={`bg-background-secondary border border-border-subtle rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ${
            isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
          }`}
        >
          {/* Welcome Step */}
          {currentStep === 'welcome' && (
            <WelcomeStep isZh={isZh} />
          )}

          {/* Language Step */}
          {currentStep === 'language' && (
            <LanguageStep
              isZh={isZh}
              selectedLanguage={selectedLanguage}
              onSelect={setSelectedLanguage}
            />
          )}

          {/* Theme Step */}
          {currentStep === 'theme' && (
            <ThemeStep
              isZh={isZh}
              themes={allThemes}
              selectedTheme={selectedTheme}
              onSelect={setSelectedTheme}
            />
          )}

          {/* Provider Step */}
          {currentStep === 'provider' && (
            <ProviderStep
              isZh={isZh}
              config={providerConfig}
              setConfig={setProviderConfig}
              showApiKey={showApiKey}
              setShowApiKey={setShowApiKey}
            />
          )}

          {/* Data Path Step */}
          {currentStep === 'dataPath' && (
            <DataPathStep
              isZh={isZh}
              dataPath={dataPath}
              setDataPath={setDataPath}
            />
          )}

          {/* Workspace Step */}
          {currentStep === 'workspace' && (
            <WorkspaceStep
              isZh={isZh}
              onOpenFolder={handleOpenFolder}
            />
          )}

          {/* Complete Step */}
          {currentStep === 'complete' && (
            <CompleteStep isZh={isZh} />
          )}

          {/* 底部导航 */}
          <div className="flex items-center justify-between px-8 py-5 border-t border-border-subtle bg-background/50">
            <button
              onClick={goPrev}
              disabled={currentStepIndex === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all ${
                currentStepIndex === 0
                  ? 'opacity-0 pointer-events-none'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              {isZh ? '上一步' : 'Back'}
            </button>

            {currentStep === 'complete' ? (
              <button
                onClick={handleComplete}
                className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-all shadow-glow"
              >
                <Rocket className="w-4 h-4" />
                {isZh ? '开始使用' : 'Get Started'}
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={!canProceed()}
                className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-all shadow-glow"
              >
                {isZh ? '下一步' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 跳过按钮 */}
        {currentStep !== 'complete' && (
          <button
            onClick={handleComplete}
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-sm text-text-muted hover:text-text-primary transition-colors"
          >
            {isZh ? '跳过引导' : 'Skip setup'}
          </button>
        )}
      </div>
    </div>
  )
}


// ============ Step Components ============

function WelcomeStep({ isZh }: { isZh: boolean }) {
  return (
    <div className="px-8 py-12 text-center">
      <div className="mb-8 flex justify-center">
        <div className="relative">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-surface to-surface-active border border-border-subtle flex items-center justify-center shadow-2xl">
            <Logo className="w-14 h-14" glow />
          </div>
          <div className="absolute -inset-4 bg-accent/10 rounded-3xl blur-xl -z-10" />
        </div>
      </div>
      
      <h1 className="text-3xl font-bold text-text-primary mb-3">
        {isZh ? '欢迎使用 Adnify' : 'Welcome to Adnify'}
      </h1>
      <p className="text-text-muted max-w-md mx-auto leading-relaxed">
        {isZh 
          ? 'AI 驱动的智能代码编辑器，让编程更高效、更智能。接下来让我们完成一些基本设置。'
          : 'An AI-powered intelligent code editor that makes programming more efficient and smarter. Let\'s complete some basic setup.'}
      </p>
      
      <div className="mt-10 flex justify-center gap-6 text-sm text-text-muted">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          <span>{isZh ? 'AI 辅助编程' : 'AI-Assisted Coding'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-purple-400" />
          <span>{isZh ? '多模型支持' : 'Multi-Model Support'}</span>
        </div>
      </div>
    </div>
  )
}

function LanguageStep({ 
  isZh, 
  selectedLanguage, 
  onSelect 
}: { 
  isZh: boolean
  selectedLanguage: Language
  onSelect: (lang: Language) => void 
}) {
  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <Globe className="w-6 h-6 text-accent" />
        <h2 className="text-xl font-semibold text-text-primary">
          {isZh ? '选择语言' : 'Choose Language'}
        </h2>
      </div>
      <p className="text-sm text-text-muted mb-8">
        {isZh ? '选择界面显示语言' : 'Select your preferred interface language'}
      </p>

      <div className="grid grid-cols-2 gap-4">
        {LANGUAGES.map(lang => (
          <button
            key={lang.id}
            onClick={() => onSelect(lang.id)}
            className={`relative p-5 rounded-xl border-2 text-left transition-all ${
              selectedLanguage === lang.id
                ? 'border-accent bg-accent/5'
                : 'border-border-subtle hover:border-text-muted bg-surface/50'
            }`}
          >
            <div className="text-2xl mb-2">{lang.id === 'zh' ? '🇨🇳' : '🇺🇸'}</div>
            <div className="font-medium text-text-primary">{lang.native}</div>
            <div className="text-sm text-text-muted">{lang.name}</div>
            {selectedLanguage === lang.id && (
              <div className="absolute top-3 right-3">
                <Check className="w-5 h-5 text-accent" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function ThemeStep({
  isZh,
  themes,
  selectedTheme,
  onSelect
}: {
  isZh: boolean
  themes: Theme[]
  selectedTheme: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <Palette className="w-6 h-6 text-accent" />
        <h2 className="text-xl font-semibold text-text-primary">
          {isZh ? '选择主题' : 'Choose Theme'}
        </h2>
      </div>
      <p className="text-sm text-text-muted mb-8">
        {isZh ? '选择你喜欢的界面主题，稍后可在设置中更改' : 'Pick your preferred theme, you can change it later in settings'}
      </p>

      <div className="grid grid-cols-3 gap-3">
        {themes.map(theme => (
          <button
            key={theme.id}
            onClick={() => onSelect(theme.id)}
            className={`relative p-4 rounded-xl border-2 text-left transition-all ${
              selectedTheme === theme.id
                ? 'border-accent bg-accent/5'
                : 'border-border-subtle hover:border-text-muted bg-surface/50'
            }`}
          >
            {/* 主题预览 */}
            <div 
              className="h-16 rounded-lg mb-3 border border-white/5 overflow-hidden"
              style={{ backgroundColor: `rgb(${theme.colors.background})` }}
            >
              <div 
                className="h-3 w-full"
                style={{ backgroundColor: `rgb(${theme.colors.surface})` }}
              />
              <div className="p-2 flex gap-1">
                <div 
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: `rgb(${theme.colors.accent})` }}
                />
                <div 
                  className="flex-1 h-2 rounded"
                  style={{ backgroundColor: `rgb(${theme.colors.surface})` }}
                />
              </div>
            </div>
            
            <div className="font-medium text-sm text-text-primary">{theme.name}</div>
            <div className="text-xs text-text-muted capitalize">{theme.type}</div>
            
            {selectedTheme === theme.id && (
              <div className="absolute top-2 right-2">
                <Check className="w-4 h-4 text-accent" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}


function ProviderStep({
  isZh,
  config,
  setConfig,
  showApiKey,
  setShowApiKey
}: {
  isZh: boolean
  config: LLMConfig
  setConfig: (config: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (show: boolean) => void
}) {
  const providers = Object.values(BUILTIN_PROVIDERS)
  const selectedProvider = BUILTIN_PROVIDERS[config.provider as BuiltinProviderName]

  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <Cpu className="w-6 h-6 text-accent" />
        <h2 className="text-xl font-semibold text-text-primary">
          {isZh ? '配置 AI 模型' : 'Configure AI Model'}
        </h2>
      </div>
      <p className="text-sm text-text-muted mb-6">
        {isZh ? '选择 AI 服务提供商并配置 API Key（可稍后在设置中配置）' : 'Choose your AI provider and configure API Key (can be done later in settings)'}
      </p>

      {/* Provider 选择 */}
      <div className="mb-6">
        <label className="text-sm font-medium text-text-primary mb-2 block">
          {isZh ? '服务提供商' : 'Provider'}
        </label>
        <div className="grid grid-cols-4 gap-2">
          {providers.map(p => (
            <button
              key={p.name}
              onClick={() => setConfig({ 
                ...config, 
                provider: p.name as any, 
                model: p.defaultModels[0],
                baseUrl: undefined
              })}
              className={`px-3 py-2.5 rounded-lg border text-sm transition-all ${
                config.provider === p.name
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-subtle hover:border-text-muted text-text-muted bg-surface/50'
              }`}
            >
              {p.displayName}
            </button>
          ))}
          <button
            onClick={() => setConfig({ ...config, provider: 'custom' as any, model: '' })}
            className={`px-3 py-2.5 rounded-lg border text-sm transition-all ${
              config.provider === 'custom'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle hover:border-text-muted text-text-muted bg-surface/50'
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {/* 模型选择 */}
      {selectedProvider && (
        <div className="mb-6">
          <label className="text-sm font-medium text-text-primary mb-2 block">
            {isZh ? '模型' : 'Model'}
          </label>
          <select
            value={config.model}
            onChange={(e) => setConfig({ ...config, model: e.target.value })}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          >
            {selectedProvider.defaultModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}

      {/* API Key */}
      <div className="mb-4">
        <label className="text-sm font-medium text-text-primary mb-2 block">
          API Key
          <span className="text-text-muted font-normal ml-2">
            ({isZh ? '可选，稍后配置' : 'optional, configure later'})
          </span>
        </label>
        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder={selectedProvider?.apiKeyPlaceholder || 'sk-...'}
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent pr-10"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-2.5 text-text-muted hover:text-text-primary"
          >
            {showApiKey ? '🙈' : '👁️'}
          </button>
        </div>
        {selectedProvider?.apiKeyUrl && (
          <a
            href={selectedProvider.apiKeyUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline mt-2 inline-block"
          >
            {isZh ? '获取 API Key →' : 'Get API Key →'}
          </a>
        )}
      </div>

      {/* 自定义端点 */}
      {(config.provider === 'custom' || selectedProvider?.supportsCustomEndpoint) && (
        <div>
          <label className="text-sm font-medium text-text-primary mb-2 block">
            {isZh ? '自定义端点' : 'Custom Endpoint'}
            <span className="text-text-muted font-normal ml-2">({isZh ? '可选' : 'optional'})</span>
          </label>
          <input
            type="text"
            value={config.baseUrl || ''}
            onChange={(e) => setConfig({ ...config, baseUrl: e.target.value || undefined })}
            placeholder="https://api.example.com/v1"
            className="w-full bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      )}
    </div>
  )
}

function DataPathStep({
  isZh,
  dataPath,
  setDataPath
}: {
  isZh: boolean
  dataPath: string
  setDataPath: (path: string) => void
}) {
  const [loading, setLoading] = useState(false)

  const handleChangePath = async () => {
    const newPath = await window.electronAPI.openFolder()
    if (newPath && newPath !== dataPath) {
      setLoading(true)
      const success = await window.electronAPI.setDataPath(newPath)
      setLoading(false)
      if (success) {
        setDataPath(newPath)
      }
    }
  }

  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <HardDrive className="w-6 h-6 text-accent" />
        <h2 className="text-xl font-semibold text-text-primary">
          {isZh ? '数据存储位置' : 'Data Storage Location'}
        </h2>
      </div>
      <p className="text-sm text-text-muted mb-8">
        {isZh 
          ? '选择保存应用配置和数据的目录。默认位置通常是最佳选择。' 
          : 'Choose where to save app configuration and data. The default location is usually the best choice.'}
      </p>

      <div className="space-y-4">
        <div className="p-4 bg-surface/50 rounded-xl border border-border-subtle">
          <label className="text-sm font-medium text-text-primary mb-2 block">
            {isZh ? '当前存储路径' : 'Current Storage Path'}
          </label>
          <div className="flex gap-3">
            <div className="flex-1 bg-surface border border-border-subtle rounded-lg px-4 py-2.5 text-sm text-text-secondary font-mono truncate">
              {dataPath || (isZh ? '加载中...' : 'Loading...')}
            </div>
            <button
              onClick={handleChangePath}
              disabled={loading}
              className="px-4 py-2 bg-surface hover:bg-surface-hover border border-border-subtle rounded-lg text-sm text-text-primary transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {loading 
                ? (isZh ? '处理中...' : 'Processing...') 
                : (isZh ? '更改目录' : 'Change')}
            </button>
          </div>
        </div>

        <div className="p-4 bg-accent/5 rounded-xl border border-accent/20">
          <p className="text-xs text-text-muted">
            💡 {isZh 
              ? '提示：此目录将存储你的设置、会话历史和缓存数据。如果你使用云同步服务（如 OneDrive），可以选择同步目录来跨设备同步配置。' 
              : 'Tip: This directory stores your settings, session history, and cache. If you use cloud sync (like OneDrive), you can choose a synced folder to sync settings across devices.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function WorkspaceStep({
  isZh,
  onOpenFolder
}: {
  isZh: boolean
  onOpenFolder: () => void
}) {
  const { workspacePath } = useStore()

  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <FolderOpen className="w-6 h-6 text-accent" />
        <h2 className="text-xl font-semibold text-text-primary">
          {isZh ? '打开项目' : 'Open Project'}
        </h2>
      </div>
      <p className="text-sm text-text-muted mb-8">
        {isZh ? '选择一个项目文件夹开始工作（可稍后打开）' : 'Select a project folder to start working (can be done later)'}
      </p>

      <div className="flex flex-col items-center py-8">
        {workspacePath ? (
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-status-success/10 flex items-center justify-center mb-4 mx-auto">
              <Check className="w-8 h-8 text-status-success" />
            </div>
            <p className="text-text-primary font-medium mb-2">{isZh ? '已选择项目' : 'Project Selected'}</p>
            <p className="text-sm text-text-muted font-mono bg-surface px-3 py-1.5 rounded-lg">
              {workspacePath}
            </p>
            <button
              onClick={onOpenFolder}
              className="mt-4 text-sm text-accent hover:underline"
            >
              {isZh ? '选择其他文件夹' : 'Choose another folder'}
            </button>
          </div>
        ) : (
          <div className="text-center">
            <button
              onClick={onOpenFolder}
              className="w-32 h-32 rounded-2xl border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all flex flex-col items-center justify-center gap-3 group"
            >
              <FolderOpen className="w-10 h-10 text-text-muted group-hover:text-accent transition-colors" />
              <span className="text-sm text-text-muted group-hover:text-text-primary transition-colors">
                {isZh ? '选择文件夹' : 'Select Folder'}
              </span>
            </button>
            <p className="text-xs text-text-muted mt-4">
              {isZh ? '或者稍后通过菜单打开项目' : 'Or open a project later via menu'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function CompleteStep({ isZh }: { isZh: boolean }) {
  return (
    <div className="px-8 py-12 text-center">
      <div className="mb-8 flex justify-center">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-status-success/10 flex items-center justify-center">
            <Check className="w-10 h-10 text-status-success" />
          </div>
          <div className="absolute -inset-4 bg-status-success/10 rounded-full blur-xl -z-10 animate-pulse" />
        </div>
      </div>
      
      <h2 className="text-2xl font-bold text-text-primary mb-3">
        {isZh ? '设置完成！' : 'All Set!'}
      </h2>
      <p className="text-text-muted max-w-md mx-auto leading-relaxed mb-8">
        {isZh 
          ? '你已经完成了基本设置。现在可以开始使用 Adnify 进行编程了！'
          : 'You\'ve completed the basic setup. Now you can start coding with Adnify!'}
      </p>

      <div className="bg-surface/50 rounded-xl p-5 max-w-sm mx-auto text-left">
        <p className="text-sm font-medium text-text-primary mb-3">
          {isZh ? '快捷提示' : 'Quick Tips'}
        </p>
        <ul className="space-y-2 text-sm text-text-muted">
          <li className="flex items-start gap-2">
            <span className="text-accent">•</span>
            <span>{isZh ? '按 Ctrl+Shift+P 打开命令面板' : 'Press Ctrl+Shift+P to open command palette'}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent">•</span>
            <span>{isZh ? '按 Ctrl+, 打开设置' : 'Press Ctrl+, to open settings'}</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent">•</span>
            <span>{isZh ? '在聊天面板中与 AI 助手交流' : 'Chat with AI assistant in the chat panel'}</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
