/**
 * 首次使用引导向导
 * 引导用户完成初始配置
 */

import React, { useState, useEffect } from 'react'
import {
  ChevronRight, ChevronLeft, Check, Sparkles, Palette,
  Globe, Cpu, FolderOpen, Rocket, HardDrive, Eye, EyeOff,
  Shield, Zap, Lock, Info
} from 'lucide-react'
import { useStore, LLMConfig, AutoApproveSettings, SecuritySettings } from '@store'
import { Language } from '@renderer/i18n'
import { themeManager, Theme } from '@renderer/config/themeConfig'
import { PROVIDERS } from '@/shared/config/providers'
import { LLM_DEFAULTS } from '@/shared/constants'
import { Logo } from '../common/Logo'
import { workspaceManager } from '@services/WorkspaceManager'
import { Button, Input, Select, Switch } from '../ui'

interface OnboardingWizardProps {
  onComplete: () => void
}

type Step = 'welcome' | 'language' | 'theme' | 'provider' | 'automation' | 'security' | 'dataPath' | 'workspace' | 'complete'

const STEPS: Step[] = ['welcome', 'language', 'theme', 'provider', 'automation', 'security', 'dataPath', 'workspace', 'complete']

const LANGUAGES: { id: Language; name: string; native: string }[] = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'zh', name: 'Chinese', native: '中文' },
]

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const {
    setLLMConfig, setLanguage, language,
    setAutoApprove, setSecuritySettings,
    autoApprove, securitySettings,
    workspacePath
  } = useStore()

  const [currentStep, setCurrentStep] = useState<Step>('welcome')
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [selectedTheme, setSelectedTheme] = useState(themeManager.getCurrentTheme().id)
  const [providerConfig, setProviderConfig] = useState<LLMConfig>({
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
    parameters: {
      temperature: LLM_DEFAULTS.TEMPERATURE,
      topP: LLM_DEFAULTS.TOP_P,
      maxTokens: LLM_DEFAULTS.MAX_TOKENS,
    },
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [dataPath, setDataPath] = useState<string>('')
  const [localAutoApprove, setLocalAutoApprove] = useState<AutoApproveSettings>(autoApprove)
  const [localSecurity, setLocalSecurity] = useState<SecuritySettings>(securitySettings)

  const allThemes = themeManager.getAllThemes()

  // 加载当前数据路径
  useEffect(() => {
    // @ts-ignore
    window.electronAPI.getConfigPath?.().then(setDataPath)
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
    // 使用统一的 settingsService 保存
    const { settingsService, defaultAgentConfig } = await import('@services/settingsService')

    // 更新 Store 状态
    setLanguage(selectedLanguage)
    setLLMConfig(providerConfig)
    setAutoApprove(localAutoApprove)
    setSecuritySettings(localSecurity)

    // 如果填写了 API Key，则标记为已有配置
    if (providerConfig.apiKey) {
      useStore.getState().setHasExistingConfig(true)
    }

    // 使用 settingsService 统一保存（自动清理冗余数据）
    // 注意：不再保存 editorSettings，编辑器配置由 editorConfig.ts 独立管理
    await settingsService.saveAll({
      llmConfig: providerConfig as any,
      language: selectedLanguage,
      autoApprove: localAutoApprove,
      agentConfig: defaultAgentConfig,
      providerConfigs: {},
      aiInstructions: '',
      onboardingCompleted: true,
    })

    onComplete()
  }

  const handleOpenFolder = async () => {
    const result = await window.electronAPI.openFolder()
    if (result && typeof result === 'string') {
      await workspaceManager.openFolder(result)
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
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${index < currentStepIndex
                    ? 'bg-accent'
                    : index === currentStepIndex
                      ? 'bg-accent scale-125 shadow-[0_0_10px_rgb(var(--accent))]'
                      : 'bg-surface-active'
                    }`}
                />
                {index < STEPS.length - 2 && (
                  <div
                    className={`w-6 h-px transition-all duration-300 ${index < currentStepIndex ? 'bg-accent' : 'bg-border-subtle'
                      }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 内容卡片 */}
        <div
          className={`bg-background-secondary/80 backdrop-blur-xl border border-border-subtle rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 ${isTransitioning ? 'opacity-0 translate-y-4 scale-95' : 'opacity-100 translate-y-0 scale-100'
            }`}
        >
          <div className="min-h-[420px] flex flex-col">
            {/* Steps Rendering */}
            <div className="flex-1 overflow-y-auto">
              {currentStep === 'welcome' && <WelcomeStep isZh={isZh} />}
              {currentStep === 'language' && (
                <LanguageStep
                  isZh={isZh}
                  selectedLanguage={selectedLanguage}
                  onSelect={setSelectedLanguage}
                />
              )}
              {currentStep === 'theme' && (
                <ThemeStep
                  isZh={isZh}
                  themes={allThemes}
                  selectedTheme={selectedTheme}
                  onSelect={setSelectedTheme}
                />
              )}
              {currentStep === 'provider' && (
                <ProviderStep
                  isZh={isZh}
                  config={providerConfig}
                  setConfig={setProviderConfig}
                  showApiKey={showApiKey}
                  setShowApiKey={setShowApiKey}
                />
              )}
              {currentStep === 'automation' && (
                <AutomationStep
                  isZh={isZh}
                  autoApprove={localAutoApprove}
                  setAutoApprove={setLocalAutoApprove}
                />
              )}
              {currentStep === 'security' && (
                <SecurityStep
                  isZh={isZh}
                  security={localSecurity}
                  setSecurity={setLocalSecurity}
                />
              )}
              {currentStep === 'dataPath' && (
                <DataPathStep
                  isZh={isZh}
                  dataPath={dataPath}
                  setDataPath={setDataPath}
                />
              )}
              {currentStep === 'workspace' && (
                <WorkspaceStep
                  isZh={isZh}
                  workspacePath={workspacePath}
                  onOpenFolder={handleOpenFolder}
                />
              )}
              {currentStep === 'complete' && <CompleteStep isZh={isZh} />}
            </div>

            {/* 底部导航 */}
            <div className="flex items-center justify-between px-8 py-5 border-t border-border-subtle bg-background/30">
              <button
                onClick={goPrev}
                disabled={currentStepIndex === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${currentStepIndex === 0
                  ? 'opacity-0 pointer-events-none'
                  : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                  }`}
              >
                <ChevronLeft className="w-4 h-4" />
                {isZh ? '上一步' : 'Back'}
              </button>

              {currentStep === 'complete' ? (
                <Button
                  onClick={handleComplete}
                  className="flex items-center gap-2 px-8 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-semibold transition-all shadow-glow"
                >
                  <Rocket className="w-4 h-4" />
                  {isZh ? '开启智能编程之旅' : 'Start Your Journey'}
                </Button>
              ) : (
                <Button
                  onClick={goNext}
                  disabled={!canProceed()}
                  className="flex items-center gap-2 px-8 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-all shadow-glow"
                >
                  {isZh ? '下一步' : 'Next'}
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 跳过按钮 */}
        {currentStep !== 'complete' && (
          <button
            onClick={handleComplete}
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-sm text-text-muted hover:text-text-primary transition-colors flex items-center gap-1.5"
          >
            <span>{isZh ? '跳过引导' : 'Skip setup'}</span>
            <ChevronRight className="w-3 h-3" />
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

      <h1 className="text-3xl font-bold text-text-primary mb-3 tracking-tight">
        {isZh ? '欢迎使用 Adnify' : 'Welcome to Adnify'}
      </h1>
      <p className="text-text-muted max-w-md mx-auto leading-relaxed text-lg">
        {isZh
          ? 'AI 驱动的下一代智能代码编辑器。'
          : 'Next-gen AI-powered intelligent code editor.'}
      </p>
      <p className="text-text-muted/60 max-w-sm mx-auto mt-2 text-sm">
        {isZh
          ? '让我们通过几个简单的步骤，为你打造最舒适的开发环境。'
          : 'Let\'s set up your perfect development environment in a few simple steps.'}
      </p>

      <div className="mt-12 flex justify-center gap-8 text-sm text-text-muted">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-accent" />
          </div>
          <span>{isZh ? 'AI 辅助' : 'AI-Assisted'}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-purple-400" />
          </div>
          <span>{isZh ? '多模型' : 'Multi-Model'}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Zap className="w-5 h-5 text-blue-400" />
          </div>
          <span>{isZh ? '极速响应' : 'High Speed'}</span>
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
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Globe className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '语言偏好' : 'Language Preference'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '选择你最熟悉的界面语言' : 'Choose your preferred interface language'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-8">
        {LANGUAGES.map(lang => (
          <button
            key={lang.id}
            onClick={() => onSelect(lang.id)}
            className={`relative p-6 rounded-2xl border-2 text-left transition-all duration-300 group ${selectedLanguage === lang.id
              ? 'border-accent bg-accent/5 shadow-glow-sm'
              : 'border-border-subtle hover:border-accent/30 bg-surface/30'
              }`}
          >
            <div className="text-3xl mb-3 group-hover:scale-110 transition-transform duration-300">
              {lang.id === 'zh' ? '🇨🇳' : '🇺🇸'}
            </div>
            <div className="font-bold text-text-primary text-lg">{lang.native}</div>
            <div className="text-sm text-text-muted">{lang.name}</div>
            {selectedLanguage === lang.id && (
              <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-accent flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
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
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Palette className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '个性化主题' : 'Personalized Theme'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '选择一个符合你审美的外观' : 'Pick a look that matches your style'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-8">
        {themes.map(theme => (
          <button
            key={theme.id}
            onClick={() => onSelect(theme.id)}
            className={`relative p-4 rounded-2xl border-2 text-left transition-all duration-300 ${selectedTheme === theme.id
              ? 'border-accent bg-accent/5 shadow-glow-sm'
              : 'border-border-subtle hover:border-accent/30 bg-surface/30'
              }`}
          >
            {/* 主题预览 */}
            <div
              className="h-20 rounded-xl mb-4 border border-white/5 overflow-hidden shadow-inner flex flex-col"
              style={{ backgroundColor: `rgb(${theme.colors.background})` }}
            >
              <div
                className="h-4 w-full border-b border-white/5"
                style={{ backgroundColor: `rgb(${theme.colors.backgroundSecondary})` }}
              />
              <div className="flex-1 p-2 flex flex-col gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${theme.colors.accent})` }} />
                  <div className="flex-1 h-2 rounded-full bg-white/5" />
                </div>
                <div className="w-2/3 h-2 rounded-full bg-white/5" />
                <div className="w-full h-2 rounded-full bg-white/5" />
              </div>
            </div>

            <div className="font-bold text-sm text-text-primary mb-0.5">{theme.name}</div>
            <div className="text-xs text-text-muted capitalize">{theme.type} Mode</div>

            {selectedTheme === theme.id && (
              <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
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
  const providers = Object.values(PROVIDERS).filter(p => p.id !== 'custom')
  const selectedProvider = PROVIDERS[config.provider]

  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Cpu className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '配置 AI 引擎' : 'Configure AI Engine'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '连接你最喜欢的 AI 模型' : 'Connect your favorite AI models'}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {/* Provider 选择 */}
        <div>
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 block">
            {isZh ? '服务提供商' : 'Provider'}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {providers.map(p => (
              <button
                key={p.id}
                onClick={() => setConfig({
                  ...config,
                  provider: p.id as any,
                  model: p.models[0],
                  baseUrl: undefined
                })}
                className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${config.provider === p.id
                  ? 'border-accent bg-accent/10 text-accent shadow-glow-sm'
                  : 'border-border-subtle hover:border-text-muted text-text-muted bg-surface/30'
                  }`}
              >
                {p.displayName}
              </button>
            ))}
            <button
              onClick={() => setConfig({ ...config, provider: 'custom' as any, model: '' })}
              className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${config.provider === 'custom'
                ? 'border-accent bg-accent/10 text-accent shadow-glow-sm'
                : 'border-border-subtle hover:border-text-muted text-text-muted bg-surface/30'
                }`}
            >
              Custom
            </button>
          </div>
        </div>

        {/* 模型选择 */}
        {selectedProvider && (
          <div>
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 block">
              {isZh ? '默认模型' : 'Default Model'}
            </label>
            <Select
              value={config.model}
              onChange={(value) => setConfig({ ...config, model: value })}
              options={selectedProvider.models.map(m => ({ value: m, label: m }))}
              className="w-full"
            />
          </div>
        )}

        {/* API Key */}
        <div>
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 block flex items-center justify-between">
            <span>API Key</span>
            <span className="text-[10px] font-normal normal-case opacity-60">
              {isZh ? '(可选，可稍后配置)' : '(Optional, can be set later)'}
            </span>
          </label>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={selectedProvider?.auth.placeholder || 'sk-...'}
              className="w-full pr-10"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {selectedProvider?.auth.helpUrl && (
            <a
              href={selectedProvider.auth.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline mt-2.5 inline-flex items-center gap-1"
            >
              <span>{isZh ? '获取 API Key' : 'Get API Key'}</span>
              <ChevronRight className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function AutomationStep({
  isZh,
  autoApprove,
  setAutoApprove
}: {
  isZh: boolean
  autoApprove: AutoApproveSettings
  setAutoApprove: (settings: AutoApproveSettings) => void
}) {
  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Zap className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '自动化权限' : 'Automation Permissions'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '平衡效率与安全性' : 'Balance efficiency and security'}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="p-5 rounded-2xl border border-border-subtle bg-surface/30 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <div className="font-bold text-text-primary mb-1">
                {isZh ? '自动执行终端命令' : 'Auto-approve Terminal Commands'}
              </div>
              <div className="text-xs text-text-muted leading-relaxed">
                {isZh
                  ? '允许 AI 直接运行 read_file, list_dir 等只读命令。写操作仍需确认。'
                  : 'Allow AI to run read-only commands like read_file, list_dir. Write operations still need confirmation.'}
              </div>
            </div>
            <Switch
              checked={autoApprove.terminal}
              onChange={(e) => setAutoApprove({ ...autoApprove, terminal: e.target.checked })}
            />
          </div>

          <div className="h-px bg-border-subtle/50" />

          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <div className="font-bold text-text-primary mb-1">
                {isZh ? '自动执行危险操作' : 'Auto-approve Dangerous Operations'}
              </div>
              <div className="text-xs text-text-muted leading-relaxed">
                {isZh
                  ? '允许 AI 自动删除文件或文件夹。建议保持关闭以确保安全。'
                  : 'Allow AI to delete files or folders automatically. Recommended to keep OFF for safety.'}
              </div>
            </div>
            <Switch
              checked={autoApprove.dangerous}
              onChange={(e) => setAutoApprove({ ...autoApprove, dangerous: e.target.checked })}
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 flex gap-3">
          <Info className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted leading-relaxed">
            {isZh
              ? '提示：你随时可以在设置中更改这些权限。对于初学者，我们建议保持默认设置。'
              : 'Tip: You can change these permissions anytime in settings. For beginners, we recommend keeping default settings.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function SecurityStep({
  isZh,
  security,
  setSecurity
}: {
  isZh: boolean
  security: SecuritySettings
  setSecurity: (settings: SecuritySettings) => void
}) {
  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '安全与隐私' : 'Security & Privacy'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '保护你的代码和数据安全' : 'Protect your code and data'}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <div className="p-5 rounded-2xl border border-border-subtle bg-surface/30 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <div className="font-bold text-text-primary mb-1">
                {isZh ? '严格工作区模式' : 'Strict Workspace Mode'}
              </div>
              <div className="text-xs text-text-muted leading-relaxed">
                {isZh
                  ? '限制 AI 只能访问当前打开的项目目录。'
                  : 'Restrict AI to only access the currently opened project directory.'}
              </div>
            </div>
            <Switch
              checked={security.strictWorkspaceMode}
              onChange={(e) => setSecurity({ ...security, strictWorkspaceMode: e.target.checked })}
            />
          </div>

          <div className="h-px bg-border-subtle/50" />

          <div className="flex items-center justify-between">
            <div className="flex-1 pr-4">
              <div className="font-bold text-text-primary mb-1">
                {isZh ? '启用操作审计日志' : 'Enable Audit Log'}
              </div>
              <div className="text-xs text-text-muted leading-relaxed">
                {isZh
                  ? '记录 AI 执行的所有操作，方便回溯和审计。'
                  : 'Record all operations performed by AI for tracking and auditing.'}
              </div>
            </div>
            <Switch
              checked={security.enableAuditLog}
              onChange={(e) => setSecurity({ ...security, enableAuditLog: e.target.checked })}
            />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-status-success/5 border border-status-success/10 flex gap-3">
          <Lock className="w-5 h-5 text-status-success flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-muted leading-relaxed">
            {isZh
              ? 'Adnify 优先考虑本地处理。你的代码索引和敏感数据都存储在本地，不会上传到我们的服务器。'
              : 'Adnify prioritizes local processing. Your code index and sensitive data are stored locally and never uploaded to our servers.'}
          </p>
        </div>
      </div>
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
      // @ts-ignore
      const success = await window.electronAPI.setConfigPath?.(newPath)
      setLoading(false)
      if (success) {
        setDataPath(newPath)
      }
    }
  }

  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <HardDrive className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '配置存储' : 'Config Storage'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '仅更改配置文件的存储位置' : 'Only changes where config files are stored'}
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        <div className="p-6 rounded-2xl border border-border-subtle bg-surface/30">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3 block">
            {isZh ? '当前存储路径' : 'Current Storage Path'}
          </label>
          <div className="flex gap-3">
            <div className="flex-1 bg-background/50 border border-border-subtle rounded-xl px-4 py-3 text-xs text-text-secondary font-mono truncate shadow-inner">
              {dataPath || (isZh ? '正在获取路径...' : 'Fetching path...')}
            </div>
            <Button
              onClick={handleChangePath}
              disabled={loading}
              variant="secondary"
              className="whitespace-nowrap px-6"
            >
              {loading
                ? (isZh ? '处理中...' : 'Processing...')
                : (isZh ? '更改' : 'Change')}
            </Button>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-accent/5 border border-accent/10">
          <p className="text-xs text-text-muted leading-relaxed">
            💡 {isZh
              ? '提示：此目录存储你的设置、会话历史和缓存。如果你使用云同步服务（如 OneDrive），可以选择同步目录来跨设备同步配置。'
              : 'Tip: This directory stores settings, history, and cache. Use a cloud-synced folder (like OneDrive) to sync across devices.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function WorkspaceStep({
  isZh,
  workspacePath,
  onOpenFolder
}: {
  isZh: boolean
  workspacePath: string | null
  onOpenFolder: () => void
}) {
  return (
    <div className="px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <FolderOpen className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-text-primary">
            {isZh ? '开启首个项目' : 'Open Your First Project'}
          </h2>
          <p className="text-sm text-text-muted">
            {isZh ? '选择一个文件夹开始编程' : 'Select a folder to start coding'}
          </p>
        </div>
      </div>

      <div className="mt-12 flex flex-col items-center">
        {workspacePath ? (
          <div className="text-center animate-in fade-in zoom-in duration-500">
            <div className="w-20 h-20 rounded-3xl bg-status-success/10 flex items-center justify-center mb-6 mx-auto shadow-glow-sm shadow-status-success/20">
              <Check className="w-10 h-10 text-status-success" />
            </div>
            <p className="text-text-primary font-bold text-lg mb-2">{isZh ? '项目已就绪' : 'Project Ready'}</p>
            <div className="text-xs text-text-muted font-mono bg-surface/50 px-4 py-2 rounded-xl border border-border-subtle max-w-md truncate">
              {workspacePath}
            </div>
            <button
              onClick={onOpenFolder}
              className="mt-6 text-sm text-accent hover:text-accent-hover font-medium transition-colors flex items-center gap-1 mx-auto"
            >
              <span>{isZh ? '更换项目文件夹' : 'Change project folder'}</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="text-center">
            <button
              onClick={onOpenFolder}
              className="w-40 h-40 rounded-3xl border-2 border-dashed border-border-subtle hover:border-accent hover:bg-accent/5 transition-all duration-300 flex flex-col items-center justify-center gap-4 group shadow-sm hover:shadow-glow-sm"
            >
              <div className="w-16 h-16 rounded-2xl bg-surface/50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <FolderOpen className="w-8 h-8 text-text-muted group-hover:text-accent transition-colors" />
              </div>
              <span className="text-sm font-bold text-text-muted group-hover:text-text-primary transition-colors">
                {isZh ? '选择文件夹' : 'Select Folder'}
              </span>
            </button>
            <p className="text-xs text-text-muted mt-6 max-w-xs mx-auto leading-relaxed">
              {isZh ? '你也可以跳过此步骤，稍后通过菜单打开项目。' : 'You can also skip this and open a project later via menu.'}
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
          <div className="w-24 h-24 rounded-full bg-status-success/10 flex items-center justify-center">
            <Check className="w-12 h-12 text-status-success" />
          </div>
          <div className="absolute -inset-6 bg-status-success/10 rounded-full blur-2xl -z-10 animate-pulse" />
        </div>
      </div>

      <h2 className="text-3xl font-bold text-text-primary mb-3 tracking-tight">
        {isZh ? '一切就绪！' : 'All Set!'}
      </h2>
      <p className="text-text-muted max-w-md mx-auto leading-relaxed text-lg mb-10">
        {isZh
          ? '你已完成所有基础设置。现在，开启你的 AI 编程之旅吧！'
          : 'You\'ve completed the basic setup. Now, start your AI coding journey!'}
      </p>

      <div className="bg-surface/30 backdrop-blur-sm rounded-2xl p-6 max-w-md mx-auto text-left border border-border-subtle">
        <p className="text-xs font-bold text-text-muted uppercase tracking-wider mb-4">
          {isZh ? '常用快捷键' : 'Quick Shortcuts'}
        </p>
        <div className="grid grid-cols-1 gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{isZh ? '命令面板' : 'Command Palette'}</span>
            <kbd className="px-2 py-1 bg-background rounded border border-border-subtle text-[10px] font-mono text-text-muted">Ctrl+Shift+P</kbd>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{isZh ? '打开设置' : 'Open Settings'}</span>
            <kbd className="px-2 py-1 bg-background rounded border border-border-subtle text-[10px] font-mono text-text-muted">Ctrl+,</kbd>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{isZh ? '快速打开文件' : 'Quick Open File'}</span>
            <kbd className="px-2 py-1 bg-background rounded border border-border-subtle text-[10px] font-mono text-text-muted">Ctrl+P</kbd>
          </div>
        </div>
      </div>
    </div>
  )
}
