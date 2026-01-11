/**
 * API 示例导入向导
 * 引导用户逐步填写 Provider 配置，并测试连接
 */

import { useState } from 'react'
import { X, ArrowRight, ArrowLeft, Check, Loader2, Zap, AlertCircle } from 'lucide-react'
import { Button, Input, Select } from '@components/ui'
import type { ApiProtocol, AdvancedConfig, LLMAdapterConfig, AuthType } from '@shared/config/providers'
import { BUILTIN_ADAPTERS } from '@shared/config/providers'
import { api } from '@renderer/services/electronAPI'
import type { LLMConfig, ToolDefinition } from '@shared/types/llm'
import { TOOL_DEFINITIONS } from '@shared/config/tools'

interface ApiImportWizardProps {
  language: 'en' | 'zh'
  onComplete: (config: ImportedConfig) => void
  onCancel: () => void
}

export interface ImportedConfig {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  protocol: ApiProtocol
  auth: { type: 'bearer' | 'api-key' | 'header'; headerName: string }
  advanced: AdvancedConfig
  features: { streaming: boolean; tools: boolean; reasoning: boolean }
}

type Step = 'basic' | 'response' | 'tools' | 'test'

const AUTH_OPTIONS = [
  { value: 'bearer', label: 'Bearer Token (Authorization: Bearer xxx)' },
  { value: 'api-key', label: 'API Key Header (api-key: xxx)' },
  { value: 'header', label: '自定义 Header' },
]

export function ApiImportWizard({ language, onComplete, onCancel }: ApiImportWizardProps) {
  const [step, setStep] = useState<Step>('basic')
  
  // 基础信息
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [authType, setAuthType] = useState<'bearer' | 'api-key' | 'header'>('bearer')
  const [authHeaderName, setAuthHeaderName] = useState('Authorization')

  // 响应配置
  const [contentField, setContentField] = useState('delta.content')
  const [doneMarker, setDoneMarker] = useState('[DONE]')
  const [hasReasoning, setHasReasoning] = useState(false)
  const [reasoningField, setReasoningField] = useState('delta.reasoning_content')

  // 工具配置
  const [hasTools, setHasTools] = useState(true)
  const [toolCallField, setToolCallField] = useState('delta.tool_calls')
  const [toolNamePath, setToolNamePath] = useState('function.name')
  const [toolArgsPath, setToolArgsPath] = useState('function.arguments')

  // 测试状态
  const [testResults, setTestResults] = useState<Record<string, boolean | null>>({})
  const [testing, setTesting] = useState(false)

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const buildConfig = (): ImportedConfig => ({
    name,
    baseUrl,
    apiKey,
    model,
    protocol: 'custom',
    auth: { type: authType, headerName: authHeaderName },
    advanced: {
      response: {
        contentField,
        doneMarker,
        reasoningField: hasReasoning ? reasoningField : undefined,
        toolCallField: hasTools ? toolCallField : undefined,
        toolNamePath: hasTools ? toolNamePath : undefined,
        toolArgsPath: hasTools ? toolArgsPath : undefined,
      },
    },
    features: { streaming: true, tools: hasTools, reasoning: hasReasoning },
  })

  // 构建用于测试的 LLMConfig
  const buildTestLLMConfig = (): LLMConfig => {
    const baseAdapter = BUILTIN_ADAPTERS.openai
    const adapterConfig: LLMAdapterConfig = {
      ...baseAdapter,
      id: 'test-adapter',
      name: name || 'Test',
      protocol: 'custom',
      response: {
        ...baseAdapter.response,
        contentField,
        doneMarker,
        reasoningField: hasReasoning ? reasoningField : undefined,
        toolCallField: hasTools ? toolCallField : undefined,
        toolNamePath: hasTools ? toolNamePath : undefined,
        toolArgsPath: hasTools ? toolArgsPath : undefined,
      },
    }

    return {
      provider: 'test-wizard',
      model,
      apiKey,
      baseUrl,
      maxTokens: 100,
      temperature: 0.7,
      topP: 1,
      timeout: 30000,
      adapterConfig,
      advanced: {
        auth: {
          type: authType as AuthType,
          headerName: authType !== 'bearer' ? authHeaderName : undefined,
        },
      },
    }
  }

  // 测试基础对话
  const testBasicChat = async (): Promise<boolean> => {
    try {
      const config = buildTestLLMConfig()
      const result = await api.llm.compactContext({
        config,
        messages: [{ role: 'user', content: 'say hi' }],
      })
      return !result.error && result.content.length > 0
    } catch {
      return false
    }
  }

  // 测试多轮对话
  const testMultiTurn = async (): Promise<boolean> => {
    try {
      const config = buildTestLLMConfig()
      const result = await api.llm.compactContext({
        config,
        messages: [
          { role: 'user', content: '我叫小明' },
          { role: 'assistant', content: '你好小明' },
          { role: 'user', content: '我叫什么名字?' },
        ],
      })
      return !result.error && result.content.includes('小明')
    } catch {
      return false
    }
  }

  // 测试工具调用 (使用真实系统工具)
  const testToolCall = async (): Promise<boolean> => {
    return new Promise((resolve) => {
      const config = buildTestLLMConfig()
      let hasToolCall = false
      let isDone = false
      const timeout = setTimeout(() => {
        if (!isDone) {
          cleanup()
          resolve(false)
        }
      }, 30000)

      const cleanup = () => {
        clearTimeout(timeout)
        unsubStream()
        unsubToolCall()
        unsubDone()
        unsubError()
      }

      const unsubStream = api.llm.onStream(() => {
        // 忽略流内容
      })

      const unsubToolCall = api.llm.onToolCall((toolCall) => {
        // 检查是否调用了真实的系统工具
        if (toolCall.name && toolCall.arguments) {
          hasToolCall = true
        }
      })

      const unsubDone = api.llm.onDone(() => {
        isDone = true
        cleanup()
        resolve(hasToolCall)
      })

      const unsubError = api.llm.onError(() => {
        isDone = true
        cleanup()
        resolve(false)
      })

      // 使用真实的系统工具定义
      const realTools: ToolDefinition[] = [
        TOOL_DEFINITIONS.read_file,
        TOOL_DEFINITIONS.list_directory,
        TOOL_DEFINITIONS.search_files,
      ]

      // 发送带真实工具的请求
      api.llm.send({
        config,
        messages: [
          {
            role: 'user',
            content: '请列出当前目录下的文件',
          },
        ],
        tools: realTools,
      })
    })
  }

  const runAllTests = async () => {
    setTesting(true)
    setTestResults({})

    // 测试基础对话
    const r1 = await testBasicChat()
    setTestResults((prev) => ({ ...prev, streaming: r1 }))

    // 测试多轮对话
    const r2 = await testMultiTurn()
    setTestResults((prev) => ({ ...prev, multiTurn: r2 }))

    // 测试工具调用
    if (hasTools) {
      const r3 = await testToolCall()
      setTestResults((prev) => ({ ...prev, tools: r3 }))
    }

    setTesting(false)
  }

  const canProceed = () => {
    switch (step) {
      case 'basic':
        return name && baseUrl && apiKey && model
      case 'response':
        return contentField && doneMarker
      case 'tools':
        return true
      case 'test':
        return testResults.streaming === true
      default:
        return false
    }
  }

  const nextStep = () => {
    const steps: Step[] = ['basic', 'response', 'tools', 'test']
    const idx = steps.indexOf(step)
    if (idx < steps.length - 1) setStep(steps[idx + 1])
  }

  const prevStep = () => {
    const steps: Step[] = ['basic', 'response', 'tools', 'test']
    const idx = steps.indexOf(step)
    if (idx > 0) setStep(steps[idx - 1])
  }

  const handleComplete = () => {
    onComplete(buildConfig())
  }

  const renderStepIndicator = () => {
    const steps: { key: Step; label: string }[] = [
      { key: 'basic', label: t('基础信息', 'Basic') },
      { key: 'response', label: t('响应格式', 'Response') },
      { key: 'tools', label: t('工具调用', 'Tools') },
      { key: 'test', label: t('测试', 'Test') },
    ]

    return (
      <div className="flex items-center justify-center gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                step === s.key
                  ? 'bg-accent text-white'
                  : steps.indexOf(steps.find((x) => x.key === step)!) > i
                    ? 'bg-green-500 text-white'
                    : 'bg-surface border border-border text-text-muted'
              }`}
            >
              {steps.indexOf(steps.find((x) => x.key === step)!) > i ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            {i < steps.length - 1 && <div className="w-8 h-0.5 bg-border mx-1" />}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-bold">{t('配置向导', 'Setup Wizard')}</h2>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-surface rounded-lg transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Step Indicator */}
      {renderStepIndicator()}

      {/* Content */}
      <div className="space-y-4 min-h-[280px]">
          {step === 'basic' && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">{t('提供商名称', 'Provider Name')} *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. MiMo" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">API Base URL *</label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">{t('默认模型', 'Default Model')} *</label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gpt-4" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">{t('认证方式', 'Auth Type')}</label>
                <Select value={authType} onChange={(v) => { setAuthType(v as typeof authType); if (v === 'api-key') setAuthHeaderName('api-key') }} options={AUTH_OPTIONS} />
              </div>
              {authType !== 'bearer' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-muted">Header {t('名称', 'Name')}</label>
                  <Input value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="api-key" />
                </div>
              )}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">API Key *</label>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
              </div>
            </>
          )}

          {step === 'response' && (
            <>
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-sm text-blue-400">
                <AlertCircle className="w-4 h-4 inline mr-2" />
                {t('大多数国产厂商兼容 OpenAI 格式，可直接使用默认值', 'Most providers are OpenAI-compatible, defaults should work')}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">{t('内容字段路径', 'Content Field Path')}</label>
                <Input value={contentField} onChange={(e) => setContentField(e.target.value)} placeholder="delta.content" className="font-mono text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-muted">{t('流结束标记', 'Done Marker')}</label>
                <Input value={doneMarker} onChange={(e) => setDoneMarker(e.target.value)} placeholder="[DONE]" className="font-mono text-sm" />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="hasReasoning" checked={hasReasoning} onChange={(e) => setHasReasoning(e.target.checked)} className="w-4 h-4" />
                <label htmlFor="hasReasoning" className="text-sm">{t('支持推理字段 (如 DeepSeek)', 'Has reasoning field')}</label>
              </div>
              {hasReasoning && (
                <div className="space-y-2 ml-7">
                  <label className="text-xs font-medium text-text-muted">{t('推理字段路径', 'Reasoning Field')}</label>
                  <Input value={reasoningField} onChange={(e) => setReasoningField(e.target.value)} placeholder="delta.reasoning_content" className="font-mono text-sm" />
                </div>
              )}
            </>
          )}

          {step === 'tools' && (
            <>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="hasTools" checked={hasTools} onChange={(e) => setHasTools(e.target.checked)} className="w-4 h-4" />
                <label htmlFor="hasTools" className="text-sm font-medium">{t('支持工具调用 (Function Calling)', 'Supports Tool Calling')}</label>
              </div>
              {hasTools && (
                <div className="space-y-4 mt-4 p-4 bg-surface/30 rounded-xl border border-border">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-muted">{t('工具调用字段', 'Tool Call Field')}</label>
                    <Input value={toolCallField} onChange={(e) => setToolCallField(e.target.value)} placeholder="delta.tool_calls" className="font-mono text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-muted">{t('函数名路径', 'Function Name Path')}</label>
                    <Input value={toolNamePath} onChange={(e) => setToolNamePath(e.target.value)} placeholder="function.name" className="font-mono text-sm" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-muted">{t('参数路径', 'Arguments Path')}</label>
                    <Input value={toolArgsPath} onChange={(e) => setToolArgsPath(e.target.value)} placeholder="function.arguments" className="font-mono text-sm" />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'test' && (
            <>
              <div className="text-center mb-4">
                <p className="text-sm text-text-muted">{t('点击下方按钮测试配置是否正确', 'Click to test your configuration')}</p>
              </div>

              <Button onClick={runAllTests} disabled={testing} className="w-full h-12 text-base font-bold">
                {testing ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />}
                {testing ? t('测试中...', 'Testing...') : t('开始测试', 'Run Tests')}
              </Button>

              {Object.keys(testResults).length > 0 && (
                <div className="mt-6 space-y-3">
                  <TestResultItem label={t('基础对话', 'Basic Chat')} result={testResults.streaming} />
                  <TestResultItem label={t('多轮对话', 'Multi-turn')} result={testResults.multiTurn} />
                  {hasTools && <TestResultItem label={t('工具调用', 'Tool Calling')} result={testResults.tools} />}
                </div>
              )}

              {testResults.streaming === false && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                  <AlertCircle className="w-4 h-4 inline mr-2" />
                  {t('基础对话测试失败，请检查 Base URL、API Key 和模型名称', 'Basic chat test failed. Check Base URL, API Key and Model.')}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-border/50">
          <Button variant="ghost" onClick={step === 'basic' ? onCancel : prevStep} className="gap-2">
            {step === 'basic' ? t('取消', 'Cancel') : <><ArrowLeft className="w-4 h-4" /> {t('上一步', 'Back')}</>}
          </Button>
          {step === 'test' ? (
            <Button onClick={handleComplete} disabled={!canProceed()} className="gap-2">
              <Check className="w-4 h-4" /> {t('完成', 'Complete')}
            </Button>
          ) : (
            <Button onClick={nextStep} disabled={!canProceed()} className="gap-2">
              {t('下一步', 'Next')} <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
  )
}

function TestResultItem({ label, result }: { label: string; result: boolean | null | undefined }) {
  return (
    <div className="flex items-center justify-between p-3 bg-surface/30 rounded-lg border border-border">
      <span className="text-sm font-medium">{label}</span>
      {result === null || result === undefined ? (
        <span className="text-text-muted text-sm">-</span>
      ) : result ? (
        <span className="text-green-500 font-bold">✓ {result === true ? 'Pass' : ''}</span>
      ) : (
        <span className="text-red-500 font-bold">✗ Fail</span>
      )}
    </div>
  )
}
