/**
 * 首次使用引导向导
 * 简化版 - 只包含基础设置
 */

import { api } from '@/renderer/services/electronAPI'
import React, { useState, useEffect } from 'react'
import {
  ChevronRight, ChevronLeft, Check, Sparkles, Palette,
  Globe, Cpu, FolderOpen, Rocket, Eye, EyeOff, Settings
} from 'lucide-react'
import { useStore, LLMConfig } from '@store'
import { Language } from '@renderer/i18n'
import { themeManager, Theme } from '@renderer/config/themeConfig'
import { PROVIDERS } from '@/shared/config/providers'
import { LLM_DEFAULTS } from '@/shared/constants'
import { Logo } from '../common/Logo'
import { workspaceManager } from '@services/WorkspaceManager'
import { Button, Input, Select } from '../ui'
import { motion, AnimatePresence, Variants } from 'framer-motion'

interface OnboardingWizardProps {
  onComplete: () => void
}

type Step = 'welcome' | 'language' | 'theme' | 'provider' | 'workspace' | 'complete'

const STEPS: Step[] = ['welcome', 'language', 'theme', 'provider', 'workspace', 'complete']

const LANGUAGES: { id: Language; name: string; native: string }[] = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'zh', name: 'Chinese', native: '中文' },
]

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { setLLMConfig, setLanguage, language, workspacePath } = useStore()

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
  const [direction, setDirection] = useState(0)
  const [isExiting, setIsExiting] = useState(false)

  const allThemes = themeManager.getAllThemes()
  const currentStepIndex = STEPS.indexOf(currentStep)
  const isZh = selectedLanguage === 'zh'

  useEffect(() => {
    themeManager.setTheme(selectedTheme)
  }, [selectedTheme])

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setDirection(1)
      setCurrentStep(STEPS[currentStepIndex + 1])
    }
  }

  const goPrev = () => {
    if (currentStepIndex > 0) {
      setDirection(-1)
      setCurrentStep(STEPS[currentStepIndex - 1])
    }
  }

  const handleComplete = async () => {
    const { settingsService, defaultAgentConfig, defaultAutoApprove } = await import('@services/settingsService')

    setLanguage(selectedLanguage)
    setLLMConfig(providerConfig)

    if (providerConfig.apiKey) {
      useStore.getState().setHasExistingConfig(true)
    }

    await settingsService.saveAll({
      llmConfig: providerConfig as any,
      language: selectedLanguage,
      autoApprove: defaultAutoApprove,
      agentConfig: defaultAgentConfig,
      providerConfigs: {},
      aiInstructions: '',
      onboardingCompleted: true,
    })

    setIsExiting(true)
    setTimeout(onComplete, 500)
  }

  const handleOpenFolder = async () => {
    const result = await api.file.openFolder()
    if (result && typeof result === 'string') {
      await workspaceManager.openFolder(result)
    }
  }

  const variants: Variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 20 : -20,
      opacity: 0,
      scale: 0.98
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 350,
        damping: 30
      }
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 20 : -20,
      opacity: 0,
      scale: 0.98,
      transition: {
        duration: 0.2
      }
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[9999]"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-accent/5 rounded-full blur-[100px]"
        />
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, -45, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[100px]"
        />
      </div>

      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{
          scale: isExiting ? 0.95 : 1,
          opacity: isExiting ? 0 : 1,
          y: 0
        }}
        transition={{ type: "spring", duration: 0.5 }}
        className="relative w-full max-w-2xl mx-4"
      >
        {/* 进度指示器 */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 bg-background-secondary/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/5 shadow-sm">
            {STEPS.slice(0, -1).map((step, index) => (
              <React.Fragment key={step}>
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor: index <= currentStepIndex ? 'rgb(var(--accent))' : 'rgba(var(--text-muted), 0.2)',
                    scale: index === currentStepIndex ? 1.2 : 1,
                  }}
                  className={`w-2.5 h-2.5 rounded-full`}
                />
                {index < STEPS.length - 2 && (
                  <motion.div
                    initial={false}
                    animate={{
                      backgroundColor: index < currentStepIndex ? 'rgba(var(--accent), 0.5)' : 'rgba(var(--text-muted), 0.1)',
                    }}
                    className="w-4 h-0.5"
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 内容卡片 */}
        <div className="bg-background-secondary/90 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden relative ring-1 ring-white/5">
          <div className="min-h-[460px] flex flex-col">
            <div className="flex-1 relative p-1 overflow-hidden">
              <AnimatePresence initial={false} custom={direction} mode="wait">
                <motion.div
                  key={currentStep}
                  custom={direction}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full h-full"
                >
                  {currentStep === 'welcome' && <WelcomeStep isZh={isZh} />}
                  {currentStep === 'language' && (
                    <LanguageStep isZh={isZh} selectedLanguage={selectedLanguage} onSelect={setSelectedLanguage} />
                  )}
                  {currentStep === 'theme' && (
                    <ThemeStep isZh={isZh} themes={allThemes} selectedTheme={selectedTheme} onSelect={setSelectedTheme} />
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
                  {currentStep === 'workspace' && (
                    <WorkspaceStep isZh={isZh} workspacePath={workspacePath} onOpenFolder={handleOpenFolder} />
                  )}
                  {currentStep === 'complete' && <CompleteStep isZh={isZh} />}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* 底部导航 */}
            <div className="flex items-center justify-between px-8 py-6 border-t border-white/5 bg-background/20 backdrop-blur-sm">
              <button
                onClick={goPrev}
                disabled={currentStepIndex === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                  currentStepIndex === 0
                    ? 'opacity-0 pointer-events-none'
                    : 'text-text-muted hover:text-text-primary hover:bg-white/5 active:scale-95'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                {isZh ? '上一步' : 'Back'}
              </button>

              {currentStep === 'complete' ? (
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    onClick={handleComplete}
                    className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-bold shadow-lg shadow-accent/20 transition-all"
                  >
                    <Rocket className="w-4 h-4" />
                    {isZh ? '开始使用' : 'Get Started'}
                  </Button>
                </motion.div>
              ) : (
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    onClick={goNext}
                    className="flex items-center gap-2 px-8 py-3 bg-white/10 hover:bg-white/15 text-text-primary border border-white/5 hover:border-white/10 rounded-xl text-sm font-medium backdrop-blur-sm transition-all shadow-lg"
                  >
                    {isZh ? '下一步' : 'Next'}
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* 跳过按钮 */}
        {currentStep !== 'complete' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={handleComplete}
            className="absolute -bottom-14 left-1/2 -translate-x-1/2 text-sm text-text-muted/60 hover:text-text-muted transition-colors flex items-center gap-1.5 py-2 px-4 rounded-full hover:bg-white/5"
          >
            <span>{isZh ? '跳过引导' : 'Skip setup'}</span>
            <ChevronRight className="w-3 h-3" />
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  )
}


// ============ Step Components ============

function WelcomeStep({ isZh }: { isZh: boolean }) {
  return (
    <div className="px-8 py-12 text-center h-full flex flex-col justify-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="mb-8 flex justify-center"
      >
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-accent to-purple-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
          <div className="relative w-28 h-28 rounded-2xl bg-gradient-to-br from-surface to-surface-active border border-white/10 flex items-center justify-center shadow-2xl">
            <Logo className="w-16 h-16" glow />
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-text-primary to-text-muted mb-4 tracking-tight">
          {isZh ? '欢迎使用 Adnify' : 'Welcome to Adnify'}
        </h1>
        <p className="text-text-muted max-w-lg mx-auto leading-relaxed text-lg mb-2">
          {isZh ? 'AI 驱动的下一代智能代码编辑器' : 'Next-gen AI-powered intelligent code editor'}
        </p>
        <p className="text-text-muted/50 max-w-sm mx-auto text-sm">
          {isZh
            ? '让我们快速完成几个基础设置，即可开始编程。'
            : 'Let\'s quickly set up the basics and start coding.'}
        </p>
      </motion.div>

      <div className="mt-12 flex justify-center gap-12">
        <FeatureItem
          icon={<Sparkles className="w-5 h-5 text-accent" />}
          label={isZh ? 'AI 辅助' : 'AI-Assisted'}
          delay={0.2}
        />
        <FeatureItem
          icon={<Cpu className="w-5 h-5 text-purple-400" />}
          label={isZh ? '多模型' : 'Multi-Model'}
          delay={0.3}
        />
        <FeatureItem
          icon={<Settings className="w-5 h-5 text-blue-400" />}
          label={isZh ? '可定制' : 'Customizable'}
          delay={0.4}
        />
      </div>
    </div>
  )
}

function FeatureItem({ icon, label, delay }: { icon: React.ReactNode, label: string, delay: number }) {
  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay }}
      className="flex flex-col items-center gap-3"
    >
      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center shadow-lg">
        {icon}
      </div>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
    </motion.div>
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
    <div className="px-12 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Globe className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '语言偏好' : 'Language Preference'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择界面语言' : 'Choose your interface language'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-4 flex-1">
        {LANGUAGES.map((lang, index) => (
          <motion.button
            key={lang.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(lang.id)}
            className={`relative p-8 rounded-3xl border-2 text-left transition-all duration-300 group flex flex-col justify-center gap-2 ${
              selectedLanguage === lang.id
                ? 'border-accent bg-accent/5 shadow-xl shadow-accent/5'
                : 'border-white/5 hover:border-accent/30 bg-white/5 hover:bg-white/10'
            }`}
          >
            <div className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-500 ease-out origin-left">
              {lang.id === 'zh' ? '🇨🇳' : '🇺🇸'}
            </div>
            <div className="font-bold text-text-primary text-xl">{lang.native}</div>
            <div className="text-text-muted font-medium">{lang.name}</div>
            {selectedLanguage === lang.id && (
              <motion.div
                layoutId="lang-check"
                className="absolute top-6 right-6 w-8 h-8 rounded-full bg-accent flex items-center justify-center shadow-lg shadow-accent/30"
              >
                <Check className="w-5 h-5 text-white" />
              </motion.div>
            )}
          </motion.button>
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
    <div className="px-10 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Palette className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '选择主题' : 'Choose Theme'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择一个符合你审美的外观' : 'Pick a look that matches your style'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4 overflow-y-auto pb-2 pr-2">
        {themes.map((theme, index) => (
          <motion.button
            key={theme.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            whileHover={{ y: -5 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(theme.id)}
            className={`relative p-3 rounded-2xl border-2 text-left transition-all duration-300 ${
              selectedTheme === theme.id
                ? 'border-accent bg-accent/5 shadow-lg shadow-accent/10'
                : 'border-white/5 hover:border-accent/30 bg-white/5'
            }`}
          >
            <div
              className="h-24 rounded-xl mb-3 border border-white/5 overflow-hidden shadow-sm flex flex-col"
              style={{ backgroundColor: `rgb(${theme.colors.background})` }}
            >
              <div
                className="h-5 w-full border-b border-white/5 flex items-center px-2 gap-1"
                style={{ backgroundColor: `rgb(${theme.colors.backgroundSecondary})` }}
              >
                 <div className="w-1.5 h-1.5 rounded-full bg-red-400/50" />
                 <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/50" />
                 <div className="w-1.5 h-1.5 rounded-full bg-green-400/50" />
              </div>
              <div className="flex-1 p-2 flex gap-2">
                 <div className="w-1/4 h-full rounded bg-white/5 border border-white/5" />
                 <div className="flex-1 flex flex-col gap-1.5">
                    <div className="w-1/2 h-1.5 rounded bg-white/10" />
                    <div className="w-3/4 h-1.5 rounded bg-white/10" />
                    <div className="w-full h-1.5 rounded bg-white/5" />
                    <div className="flex gap-1 mt-auto">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${theme.colors.accent})` }} />
                        <span className="text-[6px] opacity-50 font-mono">print("Hello")</span>
                    </div>
                 </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                 <div className="font-bold text-sm text-text-primary">{theme.name}</div>
                 <div className="text-[10px] text-text-muted capitalize opacity-70">{theme.type}</div>
              </div>
            </div>
            {selectedTheme === theme.id && (
              <motion.div
                layoutId="theme-check"
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center shadow-lg ring-4 ring-background"
              >
                <Check className="w-3.5 h-3.5 text-white" />
              </motion.div>
            )}
          </motion.button>
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
    <div className="px-10 py-10 h-full overflow-y-auto">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Cpu className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '配置 AI 模型' : 'Configure AI Model'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '连接你的 AI 服务' : 'Connect your AI service'}
          </p>
        </div>
      </div>

      <div className="space-y-8">
        <div className="space-y-3">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
            {isZh ? '服务提供商' : 'Provider'}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {providers.map(p => (
              <motion.button
                key={p.id}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setConfig({
                  ...config,
                  provider: p.id as any,
                  model: p.models[0],
                  baseUrl: undefined
                })}
                className={`px-3 py-4 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-2 ${
                  config.provider === p.id
                    ? 'border-accent bg-accent/10 text-accent shadow-lg shadow-accent/5 ring-1 ring-accent/50'
                    : 'border-white/10 hover:border-white/20 text-text-muted bg-white/5'
                }`}
              >
                 {/* 这里的 Icon 可以在 providers 配置中增加，暂时用文字首字母代替图形 */}
                 <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold ${config.provider === p.id ? 'bg-accent text-white' : 'bg-white/10'}`}>
                    {p.displayName[0]}
                 </div>
                <span>{p.displayName}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {selectedProvider && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="space-y-3"
          >
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
              {isZh ? '默认模型' : 'Default Model'}
            </label>
            <Select
              value={config.model}
              onChange={(value) => setConfig({ ...config, model: value })}
              options={selectedProvider.models.map(m => ({ value: m, label: m }))}
              className="w-full bg-white/5 border-white/10 hover:border-accent/50 transition-colors py-2"
            />
          </motion.div>
        )}

        <div className="space-y-3">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1 flex items-center justify-between">
            <span>API Key</span>
            <span className="text-[10px] font-normal normal-case opacity-50 bg-white/5 px-2 py-0.5 rounded-full">
              {isZh ? '可稍后配置' : 'Optional for now'}
            </span>
          </label>
          <div className="relative group">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={selectedProvider?.auth.placeholder || 'sk-...'}
              className="w-full pr-10 bg-white/5 border-white/10 focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all py-2.5"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors p-1"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {selectedProvider?.auth.helpUrl && (
            <div className="flex justify-end">
                <a
                  href={selectedProvider.auth.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-accent hover:text-accent-hover hover:underline inline-flex items-center gap-1 transition-colors"
                >
                  <span>{isZh ? '获取 API Key' : 'Get API Key'}</span>
                  <ChevronRight className="w-3 h-3" />
                </a>
            </div>
          )}
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
    <div className="px-10 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <FolderOpen className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '打开项目' : 'Open Project'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择一个文件夹开始编程' : 'Select a folder to start coding'}
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        {workspacePath ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center w-full max-w-md"
          >
            <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-status-success/20 to-status-success/5 flex items-center justify-center mb-6 mx-auto shadow-xl shadow-status-success/10 border border-status-success/20 relative">
               <div className="absolute inset-0 rounded-[2rem] blur-xl bg-status-success/20 -z-10" />
               <Check className="w-12 h-12 text-status-success" />
            </div>
            <h3 className="text-text-primary font-bold text-xl mb-3">{isZh ? '项目已就绪' : 'Project Ready'}</h3>
            <div className="text-sm text-text-muted font-mono bg-white/5 px-6 py-4 rounded-2xl border border-white/5 break-all shadow-inner">
              {workspacePath}
            </div>
            <button
              onClick={onOpenFolder}
              className="mt-8 text-sm text-accent hover:text-accent-hover font-medium transition-colors flex items-center gap-1 mx-auto hover:underline"
            >
              <span>{isZh ? '更换项目' : 'Change project'}</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </motion.div>
        ) : (
          <div className="text-center w-full max-w-sm">
            <motion.button
              whileHover={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.08)' }}
              whileTap={{ scale: 0.98 }}
              onClick={onOpenFolder}
              className="w-full aspect-[4/3] rounded-3xl border-2 border-dashed border-white/10 bg-white/5 hover:border-accent/50 transition-all duration-300 flex flex-col items-center justify-center gap-5 group"
            >
              <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-accent/10 group-hover:text-accent">
                <FolderOpen className="w-10 h-10 text-text-muted group-hover:text-accent transition-colors" />
              </div>
              <span className="text-lg font-bold text-text-muted group-hover:text-text-primary transition-colors">
                {isZh ? '点击选择文件夹' : 'Click to Select Folder'}
              </span>
            </motion.button>
            <p className="text-xs text-text-muted mt-6 opacity-60">
              {isZh ? '或者跳过，稍后在菜单中打开' : 'Or skip and open later via menu'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}


function CompleteStep({ isZh }: { isZh: boolean }) {
  return (
    <div className="px-10 py-12 text-center h-full flex flex-col items-center justify-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="mb-8 relative"
      >
        <div className="w-28 h-28 rounded-full bg-gradient-to-br from-status-success to-emerald-600 flex items-center justify-center shadow-2xl shadow-status-success/30">
          <Check className="w-14 h-14 text-white" />
        </div>
        <motion.div
          animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="absolute inset-0 bg-status-success rounded-full -z-10"
        />
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="text-3xl font-bold text-text-primary mb-3">
          {isZh ? '设置完成！' : 'Setup Complete!'}
        </h2>
        <p className="text-text-muted max-w-md mx-auto text-base mb-10">
          {isZh
            ? '基础设置已完成，Adnify 已准备就绪。'
            : 'Basic setup is done. Adnify is ready for you.'}
        </p>
      </motion.div>

      {/* 高级配置提示 */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="bg-white/5 backdrop-blur-md rounded-2xl p-6 max-w-md w-full text-left border border-white/5 hover:border-white/10 transition-colors"
      >
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-accent" />
          <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
            {isZh ? '提示：高级功能' : 'Tip: Advanced Features'}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-xs mb-4">
           {[
             isZh ? 'Agent 自动化' : 'Agent Automation',
             isZh ? '工作区安全' : 'Workspace Security',
             isZh ? '向量索引' : 'Vector Indexing',
             isZh ? '性能调优' : 'Performance Tuning'
           ].map((item, i) => (
             <div key={i} className="flex items-center gap-2 text-text-secondary">
               <div className="w-1.5 h-1.5 rounded-full bg-accent/50" />
               <span>{item}</span>
             </div>
           ))}
        </div>

        <div className="pt-4 border-t border-white/5 flex items-center justify-between text-xs">
          <span className="text-text-muted">{isZh ? '稍后在设置中探索' : 'Explore in Settings later'}</span>
          <div className="flex items-center gap-1">
             <kbd className="px-2 py-1 bg-black/20 rounded-md border border-white/5 font-mono text-text-muted">Ctrl</kbd>
             <span className="text-text-muted/50">+</span>
             <kbd className="px-2 py-1 bg-black/20 rounded-md border border-white/5 font-mono text-text-muted">,</kbd>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
