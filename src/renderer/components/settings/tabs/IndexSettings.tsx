/**
 * 索引设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, AlertTriangle, Database, Settings2, Zap, Brain } from 'lucide-react'
import { useStore } from '@store'
import { toast } from '@components/common/ToastProvider'
import { Button, Input, Select } from '@components/ui'
import { Language } from '@renderer/i18n'
import type { EmbeddingConfigInput, IndexStatus } from '@renderer/types/electron'

interface IndexSettingsProps {
  language: Language
}

type IndexMode = 'structural' | 'semantic'

interface EmbeddingConfigState {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfigState = {
  provider: 'jina',
  apiKey: '',
  model: '',
  baseUrl: '',
}

export function IndexSettings({ language }: IndexSettingsProps) {
  const { workspacePath } = useStore()
  const [indexMode, setIndexMode] = useState<IndexMode>('structural')
  const [embeddingConfig, setEmbeddingConfig] = useState<EmbeddingConfigState>(DEFAULT_EMBEDDING_CONFIG)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const EMBEDDING_PROVIDERS = [
    { id: 'jina', name: 'Jina AI', description: language === 'zh' ? '免费 100万 tokens/月' : 'Free 100M tokens/month' },
    { id: 'voyage', name: 'Voyage AI', description: language === 'zh' ? '免费 5000万 tokens' : 'Free 50M tokens' },
    { id: 'cohere', name: 'Cohere', description: language === 'zh' ? '免费 100次/分钟' : 'Free 100 calls/min' },
    { id: 'ollama', name: 'Ollama', description: language === 'zh' ? '本地运行' : 'Local' },
    { id: 'transformers', name: 'Transformers.js', description: language === 'zh' ? '本地原生 (无需 Ollama)' : 'Local Native (No Ollama)' },
    { id: 'openai', name: 'OpenAI', description: language === 'zh' ? '付费' : 'Paid' },
    { id: 'custom', name: language === 'zh' ? '自定义' : 'Custom', description: 'OpenAI API compatible' },
  ]

  // 加载配置
  useEffect(() => {
    api.settings.get('indexConfig').then(config => {
      if (config) {
        const cfg = config as { mode?: IndexMode; embedding?: Partial<EmbeddingConfigState> }
        if (cfg.mode) setIndexMode(cfg.mode)
        if (cfg.embedding) setEmbeddingConfig(prev => ({ ...prev, ...cfg.embedding }))
      }
    })
  }, [])

  // 监听索引状态
  useEffect(() => {
    if (!workspacePath) return

    const loadStatus = async () => {
      try {
        const status = await api.index.status(workspacePath)
        setIndexStatus(status)
        if (status.mode) setIndexMode(status.mode)
      } catch { }
    }

    loadStatus()
    const unsubscribe = api.index.onProgress((status) => {
      setIndexStatus(status)
      setIsIndexing(status.isIndexing)
    })

    return unsubscribe
  }, [workspacePath])

  // 切换索引模式
  const handleModeChange = useCallback(async (mode: IndexMode) => {
    setIndexMode(mode)
    // 保存到配置文件
    const currentConfig = await api.settings.get('indexConfig') as { mode?: string; embedding?: object } || {}
    await api.settings.set('indexConfig', { ...currentConfig, mode })
    // 同步到索引服务
    if (workspacePath) {
      await api.index.setMode(workspacePath, mode)
    }
    toast.success(language === 'zh'
      ? `已切换到${mode === 'structural' ? '结构化' : '语义'}索引模式`
      : `Switched to ${mode} index mode`)
  }, [workspacePath, language])

  // 保存 Embedding 配置
  const handleSaveEmbeddingConfig = async () => {
    if (embeddingConfig.provider === 'custom' && !embeddingConfig.baseUrl) {
      toast.error(language === 'zh' ? '自定义服务必须填写 API 地址' : 'Custom service requires API URL')
      return
    }

    const configToSave: EmbeddingConfigInput = {
      provider: embeddingConfig.provider as EmbeddingConfigInput['provider'],
    }
    if (embeddingConfig.apiKey) configToSave.apiKey = embeddingConfig.apiKey
    if (embeddingConfig.model) configToSave.model = embeddingConfig.model
    if (embeddingConfig.baseUrl) configToSave.baseUrl = embeddingConfig.baseUrl

    try {
      // 保存到配置文件（统一使用 indexConfig）
      const currentConfig = await api.settings.get('indexConfig') as { mode?: string; embedding?: object } || {}
      await api.settings.set('indexConfig', { ...currentConfig, embedding: configToSave })
      // 同步到索引服务
      if (workspacePath) {
        await api.index.updateEmbeddingConfig(workspacePath, configToSave)
      }
      toast.success(language === 'zh' ? '配置已保存' : 'Configuration saved')
    } catch (error) {
      logger.settings.error('[IndexSettings] Save failed:', error)
      toast.error(language === 'zh' ? '保存失败' : 'Save failed')
    }
  }

  // 开始索引
  const handleStartIndexing = async () => {
    if (!workspacePath) {
      toast.error(language === 'zh' ? '请先打开工作区' : 'Please open a workspace first')
      return
    }

    setIsIndexing(true)
    try {
      if (indexMode === 'semantic') {
        await handleSaveEmbeddingConfig()
      }
      await api.index.start(workspacePath)
      toast.success(language === 'zh' ? '索引已开始' : 'Indexing started')
    } catch (error) {
      logger.settings.error('[IndexSettings] Start indexing failed:', error)
      toast.error(language === 'zh' ? '启动索引失败' : 'Failed to start indexing')
      setIsIndexing(false)
    }
  }

  // 清除索引
  const handleClearIndex = async () => {
    if (!workspacePath) return
    try {
      await api.index.clear(workspacePath)
      toast.success(language === 'zh' ? '索引已清除' : 'Index cleared')
      setIndexStatus(null)
    } catch {
      toast.error(language === 'zh' ? '清除失败' : 'Failed to clear')
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 索引模式选择 */}
      <section>
        <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
          {language === 'zh' ? '索引模式' : 'Index Mode'}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleModeChange('structural')}
            className={`p-4 rounded-xl border transition-all text-left ${indexMode === 'structural'
              ? 'border-accent bg-accent/10'
              : 'border-border-subtle bg-surface/30 hover:border-border'
              }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap className={`w-4 h-4 ${indexMode === 'structural' ? 'text-accent' : 'text-text-muted'}`} />
              <span className="font-medium text-sm">{language === 'zh' ? '结构化索引' : 'Structural'}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                {language === 'zh' ? '推荐' : 'Recommended'}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {language === 'zh'
                ? '零配置，本地运行，基于代码结构分析'
                : 'Zero config, local, based on code structure'}
            </p>
          </button>

          <button
            onClick={() => handleModeChange('semantic')}
            className={`p-4 rounded-xl border transition-all text-left ${indexMode === 'semantic'
              ? 'border-accent bg-accent/10'
              : 'border-border-subtle bg-surface/30 hover:border-border'
              }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Brain className={`w-4 h-4 ${indexMode === 'semantic' ? 'text-accent' : 'text-text-muted'}`} />
              <span className="font-medium text-sm">{language === 'zh' ? '语义索引' : 'Semantic'}</span>
            </div>
            <p className="text-xs text-text-muted">
              {language === 'zh'
                ? '需要 Embedding API，更好的语义理解'
                : 'Requires Embedding API, better semantic understanding'}
            </p>
          </button>
        </div>
      </section>

      {/* 语义模式配置 */}
      {indexMode === 'semantic' && (
        <section className="animate-slide-down">
          <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
            {language === 'zh' ? 'Embedding 配置' : 'Embedding Configuration'}
          </h4>
          <div className="p-4 bg-surface/30 rounded-xl border border-border-subtle space-y-4">
            <div>
              <label className="text-sm font-medium text-text-primary block mb-2">
                {language === 'zh' ? '提供商' : 'Provider'}
              </label>
              <Select
                value={embeddingConfig.provider}
                onChange={(v) => setEmbeddingConfig(prev => ({ ...prev, provider: v, model: '', baseUrl: v === 'custom' ? prev.baseUrl : '' }))}
                options={EMBEDDING_PROVIDERS.map(p => ({ value: p.id, label: `${p.name} - ${p.description}` }))}
              />
            </div>

            {embeddingConfig.provider === 'custom' && (
              <div>
                <label className="text-sm font-medium text-text-primary block mb-2">
                  API URL <span className="text-error">*</span>
                </label>
                <Input
                  type="text"
                  value={embeddingConfig.baseUrl}
                  onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://your-service.com/v1/embeddings"
                />
              </div>
            )}

            {embeddingConfig.provider !== 'ollama' && embeddingConfig.provider !== 'transformers' && (
              <div>
                <label className="text-sm font-medium text-text-primary block mb-2">API Key</label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={embeddingConfig.apiKey}
                    onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={language === 'zh' ? '输入 API Key' : 'Enter API Key'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs text-text-muted hover:text-accent transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
              {language === 'zh' ? '高级配置' : 'Advanced'}
            </button>

            {showAdvanced && (
              <div className="space-y-3 animate-slide-down">
                <div>
                  <label className="text-xs text-text-muted block mb-1">
                    {language === 'zh' ? '模型名称（留空使用默认）' : 'Model (leave empty for default)'}
                  </label>
                  <Input
                    type="text"
                    value={embeddingConfig.model}
                    onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, model: e.target.value }))}
                    placeholder="e.g. text-embedding-3-small"
                  />
                </div>
              </div>
            )}

            <Button variant="secondary" size="sm" onClick={handleSaveEmbeddingConfig}>
              {language === 'zh' ? '保存配置' : 'Save Configuration'}
            </Button>
          </div>
        </section>
      )}

      {/* 索引状态和操作 */}
      <section>
        <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-3">
          {language === 'zh' ? '索引状态' : 'Index Status'}
        </h4>

        {indexStatus && (
          <div className="p-4 bg-surface/30 rounded-xl border border-border-subtle mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-text-primary">
                {indexStatus.message || (indexStatus.isIndexing
                  ? (language === 'zh' ? '索引中...' : 'Indexing...')
                  : (language === 'zh' ? '就绪' : 'Ready'))}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border-subtle">
                {indexStatus.mode === 'structural'
                  ? (language === 'zh' ? '结构化' : 'Structural')
                  : (language === 'zh' ? '语义' : 'Semantic')}
              </span>
            </div>
            <div className="text-xs text-text-muted space-y-1">
              <div>{language === 'zh' ? '文件' : 'Files'}: {indexStatus.indexedFiles} / {indexStatus.totalFiles}</div>
              <div>{language === 'zh' ? '代码块' : 'Chunks'}: {indexStatus.totalChunks}</div>
              {indexStatus.lastIndexedAt && (
                <div>{language === 'zh' ? '上次索引' : 'Last indexed'}: {new Date(indexStatus.lastIndexedAt).toLocaleString()}</div>
              )}
            </div>
            {indexStatus.isIndexing && (
              <div className="mt-2 h-1 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${indexStatus.totalFiles ? (indexStatus.indexedFiles / indexStatus.totalFiles) * 100 : 0}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={handleStartIndexing}
            disabled={isIndexing || !workspacePath}
            leftIcon={<Database className="w-4 h-4" />}
          >
            {isIndexing
              ? (language === 'zh' ? '索引中...' : 'Indexing...')
              : (language === 'zh' ? '开始索引' : 'Start Indexing')}
          </Button>
          <Button variant="secondary" onClick={handleClearIndex} disabled={!workspacePath}>
            {language === 'zh' ? '清除索引' : 'Clear Index'}
          </Button>
        </div>

        {!workspacePath && (
          <div className="flex items-center gap-2 text-xs text-warning mt-3">
            <AlertTriangle className="w-4 h-4" />
            {language === 'zh' ? '请先打开工作区' : 'Please open a workspace first'}
          </div>
        )}
      </section>
    </div>
  )
}
