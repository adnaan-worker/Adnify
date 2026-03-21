/**
 * MCP 添加服务器模态框
 * 支持从预设添加或自定义配置
 */

import React, { useState, useMemo, useEffect } from 'react'
import {
  Search,
  Plus,
  ChevronRight,
  ExternalLink,
  Check,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  // 图标映射
  Search as SearchIcon,
  Database,
  FolderOpen,
  Github,
  GitBranch,
  Brain,
  ListOrdered,
  Cloud,
  Globe,
  Monitor,
  Clock,
  Boxes,
  Sparkles,
  Server,
  Trash2,
} from 'lucide-react'
import { Button, Input, Modal } from '@components/ui'
import { api } from '@renderer/services/electronAPI'
import {
  MCP_PRESETS,
  MCP_CATEGORY_NAMES,
  searchPresets,
} from '@shared/config/mcpPresets'
import {
  type McpPreset,
  type McpPresetCategory,
  type McpEnvConfig,
} from '@shared/types/mcp'

interface McpAddServerModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (config: McpServerFormData) => Promise<boolean>
  language: 'en' | 'zh'
  existingServerIds: string[]
}

export interface McpServerFormData {
  type: 'local' | 'remote'
  id: string
  name: string
  // 本地服务器字段
  command?: string
  args?: string[]
  env?: Record<string, string>
  // 远程服务器字段
  url?: string
  headers?: Record<string, string>
  oauth?: { clientId?: string; clientSecret?: string; scope?: string } | false
  // 通用字段
  autoApprove?: string[]
  disabled?: boolean
  /** 来源预设 ID */
  presetId?: string
  /** 保存层级 */
  saveLevel?: 'user' | 'workspace'
}

type ViewMode = 'browse' | 'registry' | 'custom' | 'configure'
type ServerType = 'local' | 'remote'

// 图标映射
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Search: SearchIcon,
  Database,
  FolderOpen,
  Github,
  GitBranch,
  Brain,
  ListOrdered,
  Cloud,
  Globe,
  Monitor,
  Clock,
  Boxes,
  Sparkles,
  Server,
}

export default function McpAddServerModal({
  isOpen,
  onClose,
  onAdd,
  language,
  existingServerIds,
}: McpAddServerModalProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('browse')
  const [serverType, setServerType] = useState<ServerType>('local')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<McpPresetCategory | 'all'>('all')
  const [selectedPreset, setSelectedPreset] = useState<McpPreset | null>(null)
  const [formData, setFormData] = useState<McpServerFormData>({
    type: 'local',
    id: '',
    name: '',
    command: '',
    args: [],
    env: {},
    autoApprove: [],
    disabled: false,
  })
  const [envValues, setEnvValues] = useState<Record<string, string>>({})
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})
  const [argsInput, setArgsInput] = useState('')
  const [autoApproveInput, setAutoApproveInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 远程服务器字段
  const [remoteUrl, setRemoteUrl] = useState('')
  const [oauthClientId, setOauthClientId] = useState('')
  const [oauthClientSecret, setOauthClientSecret] = useState('')
  const [oauthScope, setOauthScope] = useState('')
  const [enableOAuth, setEnableOAuth] = useState(true)

  // 自定义环境变量（本地）
  const [customEnvPairs, setCustomEnvPairs] = useState<Array<{ key: string; value: string; id: number }>>([])
  const [nextEnvId, setNextEnvId] = useState(0)

  // 自定义请求头（远程）
  const [customHeaderPairs, setCustomHeaderPairs] = useState<Array<{ key: string; value: string; id: number }>>([])
  const [nextHeaderId, setNextHeaderId] = useState(0)

  const [registryServers, setRegistryServers] = useState<McpPreset[]>([])
  const [isLoadingRegistry, setIsLoadingRegistry] = useState(false)

  // 保存层级
  const [saveLevel, setSaveLevel] = useState<'user' | 'workspace'>('user')

  // 切换到 Registry 视图时，如果列表为空则触发搜索
  useEffect(() => {
    if (viewMode === 'registry' && registryServers.length === 0) {
      handleRegistrySearch()
    }
  }, [viewMode])

  // 过滤预设
  const filteredPresets = useMemo(() => {
    let presets = searchQuery ? searchPresets(searchQuery) : MCP_PRESETS
    if (selectedCategory !== 'all') {
      presets = presets.filter(p => p.category === selectedCategory)
    }
    return presets.filter(p => !existingServerIds.includes(p.id))
  }, [searchQuery, selectedCategory, existingServerIds])

  // 分类列表
  const categories: Array<{ id: McpPresetCategory | 'all'; name: string }> = [
    { id: 'all', name: language === 'zh' ? '全部' : 'All' },
    ...Object.entries(MCP_CATEGORY_NAMES).map(([id, names]) => ({
      id: id as McpPresetCategory,
      name: language === 'zh' ? names.zh : names.en,
    })),
  ]

  // 选择预设
  const handleSelectPreset = (preset: McpPreset) => {
    setSelectedPreset(preset)
    setEnvValues({})
    setShowSecrets({})
    setViewMode('configure')
  }

  // 切换到自定义模式
  const handleCustomMode = () => {
    setSelectedPreset(null)
    setServerType('local')
    setFormData({ type: 'local', id: '', name: '', command: '', args: [], env: {}, autoApprove: [], disabled: false })
    setArgsInput('')
    setAutoApproveInput('')
    setRemoteUrl('')
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthScope('')
    setEnableOAuth(true)
    setCustomEnvPairs([])
    setCustomHeaderPairs([])
    setViewMode('custom')
  }

  // 搜索 Registry
  const handleRegistrySearch = async () => {
    setIsLoadingRegistry(true)
    setError(null)
    try {
      const result = await api.mcp.registrySearch(searchQuery)
      if (result.success) {
        setRegistryServers(result.servers || [])
      } else {
        setError(result.error || (language === 'zh' ? '搜索失败' : 'Search failed'))
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoadingRegistry(false)
    }
  }

  // 从 Registry 选择
  const handleSelectRegistryServer = async (serverName: string) => {
    setIsLoadingRegistry(true)
    setError(null)
    try {
      const result = await api.mcp.registryGetDetails(serverName)
      if (result.success) {
        const preset = result.localConfig as McpPreset
        setSelectedPreset(preset)
        setEnvValues({})
        setShowSecrets({})
        setViewMode('configure')
      } else {
        setError(result.error || (language === 'zh' ? '获取详情失败' : 'Failed to get details'))
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoadingRegistry(false)
    }
  }

  // 返回
  const handleBack = () => {
    setSelectedPreset(null)
    setError(null)
    setViewMode('browse')
  }

  // env pair 操作
  const addEnvPair = () => {
    setCustomEnvPairs(prev => [...prev, { key: '', value: '', id: nextEnvId }])
    setNextEnvId(n => n + 1)
  }
  const updateEnvPair = (id: number, field: 'key' | 'value', val: string) =>
    setCustomEnvPairs(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p))
  const removeEnvPair = (id: number) =>
    setCustomEnvPairs(prev => prev.filter(p => p.id !== id))

  // header pair 操作
  const addHeaderPair = () => {
    setCustomHeaderPairs(prev => [...prev, { key: '', value: '', id: nextHeaderId }])
    setNextHeaderId(n => n + 1)
  }
  const updateHeaderPair = (id: number, field: 'key' | 'value', val: string) =>
    setCustomHeaderPairs(prev => prev.map(p => p.id === id ? { ...p, [field]: val } : p))
  const removeHeaderPair = (id: number) =>
    setCustomHeaderPairs(prev => prev.filter(p => p.id !== id))

  // 提交表单
  const handleSubmit = async () => {
    setError(null)
    setIsSubmitting(true)

    try {
      let config: McpServerFormData

      if (selectedPreset) {
        const env: Record<string, string> = {}
        const presetType = selectedPreset.type || 'local'

        for (const envConfig of (selectedPreset.envConfig || [])) {
          const value = envValues[envConfig.key]
          if (envConfig.required && !value) {
            throw new Error(
              language === 'zh'
                ? `请填写 ${envConfig.labelZh}`
                : `Please fill in ${envConfig.label}`
            )
          }
          if (value) {
            env[envConfig.key] = value
          } else if (envConfig.defaultValue) {
            env[envConfig.key] = envConfig.defaultValue
          }
        }

        if (presetType === 'remote') {
          const remotePreset = selectedPreset as any

          // 处理 headers 模板：替换 ${ENV_VAR} 为用户填入的值
          const headers: Record<string, string> | undefined = remotePreset.headers
            ? Object.fromEntries(
                Object.entries(remotePreset.headers as Record<string, string>).map(([k, v]) => [
                  k,
                  v.replace(/\$\{(\w+)\}/g, (_: string, varName: string) => envValues[varName] || env[varName] || ''),
                ])
              )
            : undefined

          config = {
            type: 'remote',
            id: selectedPreset.id,
            name: selectedPreset.name,
            url: remotePreset.url || '',
            ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
            ...(remotePreset.oauth === false ? { oauth: false as const } : {}),
            autoApprove: selectedPreset.defaultAutoApprove || [],
            disabled: false,
            presetId: selectedPreset.id,
          }
        } else {
          const localPreset = selectedPreset as any
          const args = (localPreset.args || []).map((arg: string) =>
            arg.replace(/\$\{(\w+)\}/g, (_: string, varName: string) => envValues[varName] || env[varName] || '')
          ).filter((arg: string) => arg !== '')

          config = {
            type: 'local',
            id: selectedPreset.id,
            name: selectedPreset.name,
            command: localPreset.command || '',
            args,
            env,
            autoApprove: selectedPreset.defaultAutoApprove || [],
            disabled: false,
            presetId: selectedPreset.id,
          }
        }
      } else if (serverType === 'remote') {
        if (!formData.id.trim()) throw new Error(language === 'zh' ? '请填写服务器 ID' : 'Please fill in server ID')
        if (!formData.name.trim()) throw new Error(language === 'zh' ? '请填写服务器名称' : 'Please fill in server name')
        if (!remoteUrl.trim()) throw new Error(language === 'zh' ? '请填写服务器 URL' : 'Please fill in server URL')
        if (existingServerIds.includes(formData.id)) throw new Error(language === 'zh' ? '服务器 ID 已存在' : 'Server ID already exists')

        const headers: Record<string, string> = {}
        for (const { key, value } of customHeaderPairs) {
          if (key.trim()) headers[key.trim()] = value
        }

        config = {
          type: 'remote',
          id: formData.id,
          name: formData.name,
          url: remoteUrl,
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          oauth: enableOAuth
            ? { clientId: oauthClientId || undefined, clientSecret: oauthClientSecret || undefined, scope: oauthScope || undefined }
            : false,
          autoApprove: autoApproveInput.split(/[,\s]+/).filter(Boolean),
          disabled: false,
        }
      } else {
        if (!formData.id.trim()) throw new Error(language === 'zh' ? '请填写服务器 ID' : 'Please fill in server ID')
        if (!formData.name.trim()) throw new Error(language === 'zh' ? '请填写服务器名称' : 'Please fill in server name')
        if (!formData.command?.trim()) throw new Error(language === 'zh' ? '请填写启动命令' : 'Please fill in command')
        if (existingServerIds.includes(formData.id)) throw new Error(language === 'zh' ? '服务器 ID 已存在' : 'Server ID already exists')

        const env: Record<string, string> = {}
        for (const { key, value } of customEnvPairs) {
          if (key.trim()) env[key.trim()] = value
        }

        config = {
          type: 'local',
          id: formData.id,
          name: formData.name,
          command: formData.command,
          args: argsInput.split(/\s+/).filter(Boolean),
          env: Object.keys(env).length > 0 ? env : undefined,
          autoApprove: autoApproveInput.split(/[,\s]+/).filter(Boolean),
          disabled: false,
        }
      }

      config.saveLevel = saveLevel
      const success = await onAdd(config)
      if (success) {
        onClose()
        resetForm()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetForm = () => {
    setViewMode('browse')
    setServerType('local')
    setSearchQuery('')
    setSelectedCategory('all')
    setSelectedPreset(null)
    setFormData({ type: 'local', id: '', name: '', command: '', args: [], env: {}, autoApprove: [], disabled: false })
    setEnvValues({})
    setShowSecrets({})
    setArgsInput('')
    setAutoApproveInput('')
    setRemoteUrl('')
    setOauthClientId('')
    setOauthClientSecret('')
    setOauthScope('')
    setEnableOAuth(true)
    setCustomEnvPairs([])
    setCustomHeaderPairs([])
    setError(null)
  }

  const renderIcon = (iconName: string, className?: string) => {
    const IconComponent = ICON_MAP[iconName] || Server
    return <IconComponent className={className} />
  }

  const renderPresetCard = (preset: McpPreset) => {
    const isAdded = existingServerIds.includes(preset.id)
    return (
      <div
        key={preset.id}
        className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer group ${isAdded
          ? 'bg-surface/10 border-border opacity-50 cursor-not-allowed grayscale'
          : 'bg-surface/20 backdrop-blur-md border-border hover:border-accent/30 hover:bg-surface/40'
          }`}
        onClick={() => !isAdded && handleSelectPreset(preset)}
      >
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-accent/10 text-accent group-hover:bg-accent group-hover:text-white transition-colors duration-300">
            {renderIcon(preset.icon, 'w-6 h-6')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-text-primary group-hover:text-accent transition-colors">{preset.name}</h4>
              {preset.official && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-accent/20 text-accent rounded border border-accent/20 uppercase tracking-tight">Official</span>
              )}
              {isAdded && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-green-500/20 text-green-400 rounded flex items-center gap-1">
                  <Check className="w-3 h-3" />{language === 'zh' ? '已添加' : 'Added'}
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-1 line-clamp-2 leading-relaxed opacity-80">
              {language === 'zh' ? preset.descriptionZh : preset.description}
            </p>
            {preset.tags && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {preset.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="px-2 py-0.5 text-[10px] bg-white/5 text-text-secondary rounded-md border border-white/5">{tag}</span>
                ))}
              </div>
            )}
          </div>
          {!isAdded && <ChevronRight className="w-4 h-4 text-text-muted/50 group-hover:text-accent transition-colors" />}
        </div>
      </div>
    )
  }

  const renderEnvConfig = (envConfig: McpEnvConfig) => {
    const isSecret = envConfig.secret
    const showSecret = showSecrets[envConfig.key]
    return (
      <div key={envConfig.key} className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm font-medium text-text-secondary">
          {language === 'zh' ? envConfig.labelZh : envConfig.label}
          {envConfig.required && <span className="text-red-400">*</span>}
        </label>
        {envConfig.description && (
          <p className="text-xs text-text-muted">{language === 'zh' ? envConfig.descriptionZh : envConfig.description}</p>
        )}
        <div className="relative">
          <Input
            type={isSecret && !showSecret ? 'password' : 'text'}
            value={envValues[envConfig.key] || ''}
            onChange={(e) => setEnvValues(prev => ({ ...prev, [envConfig.key]: e.target.value }))}
            placeholder={envConfig.placeholder || envConfig.defaultValue}
            className="pr-10"
          />
          {isSecret && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
              onClick={() => setShowSecrets(prev => ({ ...prev, [envConfig.key]: !prev[envConfig.key] }))}
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
    )
  }

  // 判断是否是"浏览"阶段（显示 tab 导航）
  const isBrowsing = viewMode === 'browse' || viewMode === 'registry'

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { onClose(); resetForm() }}
      title={
        viewMode === 'custom'
          ? (language === 'zh' ? '手动添加服务器' : 'Add Custom Server')
          : viewMode === 'configure' && selectedPreset
            ? (language === 'zh' ? `配置 ${selectedPreset.name}` : `Configure ${selectedPreset.name}`)
            : (language === 'zh' ? '添加 MCP 服务器' : 'Add MCP Server')
      }
      size="2xl"
    >
      <div className="space-y-4">
        {/* Tab 导航 — 始终在浏览阶段可见 */}
        {isBrowsing && (
          <div className="flex p-1 bg-surface/30 rounded-xl">
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'browse' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
              onClick={() => setViewMode('browse')}
            >
              <Boxes className="w-3.5 h-3.5" />
              {language === 'zh' ? '内置预设' : 'Built-in Presets'}
            </button>
            <button
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${viewMode === 'registry' ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary'}`}
              onClick={() => setViewMode('registry')}
            >
              <Globe className="w-3.5 h-3.5" />
              {language === 'zh' ? '探索在线' : 'Explore Registry'}
            </button>
            <button
              className="flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all text-text-muted hover:text-text-primary"
              onClick={handleCustomMode}
            >
              <Plus className="w-3.5 h-3.5" />
              {language === 'zh' ? '手动自定义' : 'Manual Custom'}
            </button>
          </div>
        )}

        {/* ===== 内置预设视图 ===== */}
        {viewMode === 'browse' && (
          <>
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={language === 'zh' ? '搜索内置预设...' : 'Search built-in presets...'}
                className="pl-10 h-10 rounded-xl bg-surface/20 border-border focus:bg-surface/40"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  className={`px-4 py-1.5 text-[11px] font-bold rounded-xl transition-all duration-300 border uppercase tracking-tight ${selectedCategory === cat.id
                    ? 'bg-accent text-white border-accent scale-105'
                    : 'bg-surface/20 text-text-secondary border-transparent hover:border-border hover:bg-surface/40'
                    }`}
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
              {filteredPresets.length === 0 ? (
                <div className="text-center py-8 text-text-muted">
                  <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>{language === 'zh' ? '没有找到匹配的服务器' : 'No matching servers found'}</p>
                </div>
              ) : filteredPresets.map(renderPresetCard)}
            </div>
          </>
        )}

        {/* ===== Registry 视图 ===== */}
        {viewMode === 'registry' && (
          <>
            <div className="flex gap-3">
              <div className="relative flex-1 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegistrySearch()}
                  placeholder={language === 'zh' ? '搜索官方 MCP Registry...' : 'Search Official MCP Registry...'}
                  className="pl-10 h-10 rounded-xl bg-surface/20 border-border focus:bg-surface/40"
                />
              </div>
              <Button variant="primary" onClick={handleRegistrySearch} disabled={isLoadingRegistry} className="h-10 rounded-xl px-6">
                {isLoadingRegistry ? <Loader2 className="w-4 h-4 animate-spin" /> : (language === 'zh' ? '搜索' : 'Search')}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 max-h-[350px] overflow-y-auto custom-scrollbar pr-2">
              {registryServers.length === 0 ? (
                <div className="text-center py-12 text-text-muted bg-surface/10 rounded-xl border border-dashed border-border">
                  <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">{language === 'zh' ? '输入关键词搜索全球 MCP 服务器' : 'Search the world for MCP servers'}</p>
                </div>
              ) : registryServers.map(server => (
                <div
                  key={server.id}
                  className="p-4 rounded-xl border border-border bg-surface/20 hover:bg-surface/40 transition-all cursor-pointer group"
                  onClick={() => handleSelectRegistryServer(server.name)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent/10 text-accent"><Server className="w-5 h-5" /></div>
                      <div>
                        <h4 className="font-bold text-text-primary">{server.name}</h4>
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{server.description}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-text-muted/50 group-hover:text-accent transition-colors" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ===== 配置预设视图 ===== */}
        {viewMode === 'configure' && selectedPreset && (
          <>
            <div className="flex items-start gap-4 p-4 bg-surface/30 rounded-lg">
              <div className="p-3 rounded-lg bg-accent/10 text-accent">{renderIcon(selectedPreset.icon, 'w-6 h-6')}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-text-primary">{selectedPreset.name}</h3>
                  {selectedPreset.official && (
                    <span className="px-1.5 py-0.5 text-[10px] bg-accent/20 text-accent rounded">Official</span>
                  )}
                </div>
                <p className="text-sm text-text-muted mt-1">
                  {language === 'zh' ? selectedPreset.descriptionZh : selectedPreset.description}
                </p>
                {selectedPreset.docsUrl && (
                  <a href={selectedPreset.docsUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-2">
                    {language === 'zh' ? '查看文档' : 'View Documentation'}<ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {selectedPreset.setupCommand && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-yellow-400 text-sm font-medium">
                  <AlertCircle className="w-4 h-4" />
                  {language === 'zh' ? '首次使用需要安装' : 'Setup Required'}
                </div>
                <p className="text-sm text-text-muted">{language === 'zh' ? selectedPreset.setupNoteZh : selectedPreset.setupNote}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-black/30 rounded font-mono text-xs text-text-primary">{selectedPreset.setupCommand}</code>
                  <Button variant="secondary" size="sm" onClick={() => navigator.clipboard.writeText(selectedPreset.setupCommand!)}>
                    {language === 'zh' ? '复制' : 'Copy'}
                  </Button>
                </div>
              </div>
            )}

            {selectedPreset.envConfig && selectedPreset.envConfig.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-text-secondary">{language === 'zh' ? '配置' : 'Configuration'}</h4>
                {selectedPreset.envConfig.map(renderEnvConfig)}
              </div>
            )}

            {selectedPreset.defaultAutoApprove && selectedPreset.defaultAutoApprove.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-text-secondary">{language === 'zh' ? '自动批准的工具' : 'Auto-approved Tools'}</h4>
                <div className="flex flex-wrap gap-1">
                  {selectedPreset.defaultAutoApprove.map(tool => (
                    <span key={tool} className="px-2 py-1 text-xs bg-accent/10 text-accent rounded">{tool}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="text-sm font-medium text-text-secondary">{language === 'zh' ? '启动命令' : 'Command'}</h4>
              <div className="p-3 bg-black/30 rounded font-mono text-xs text-text-muted">
                {selectedPreset.type === 'local'
                  ? `${(selectedPreset as any).command} ${((selectedPreset as any).args || []).join(' ')}`
                  : `URL: ${(selectedPreset as any).url}`}
              </div>
            </div>
          </>
        )}

        {/* ===== 自定义配置视图 ===== */}
        {viewMode === 'custom' && (
          <div className="space-y-4">
            {/* 服务器类型 */}
            <div className="flex gap-2 p-1 bg-surface/30 rounded-lg">
              {(['local', 'remote'] as ServerType[]).map(t => (
                <button
                  key={t}
                  className={`flex-1 px-4 py-2 text-sm rounded-md transition-colors ${serverType === t ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
                  onClick={() => setServerType(t)}
                >
                  {t === 'local' ? (language === 'zh' ? '本地服务器 (stdio)' : 'Local Server (stdio)') : (language === 'zh' ? '远程服务器 (HTTP/SSE)' : 'Remote Server (HTTP/SSE)')}
                </button>
              ))}
            </div>

            {/* 通用字段 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '服务器 ID' : 'Server ID'} <span className="text-red-400">*</span></label>
                <Input value={formData.id} onChange={(e) => setFormData(prev => ({ ...prev, id: e.target.value }))} placeholder="my-server" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '显示名称' : 'Display Name'} <span className="text-red-400">*</span></label>
                <Input value={formData.name} onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))} placeholder="My Server" />
              </div>
            </div>

            {/* 本地服务器字段 */}
            {serverType === 'local' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '启动命令' : 'Command'} <span className="text-red-400">*</span></label>
                  <Input value={formData.command || ''} onChange={(e) => setFormData(prev => ({ ...prev, command: e.target.value }))} placeholder="npx / uvx / node / python..." />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '命令参数' : 'Arguments'}</label>
                  <Input value={argsInput} onChange={(e) => setArgsInput(e.target.value)} placeholder="-y @modelcontextprotocol/server-xxx" />
                  <p className="text-xs text-text-muted">{language === 'zh' ? '用空格分隔多个参数' : 'Separate multiple arguments with spaces'}</p>
                </div>

                {/* 环境变量 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '环境变量' : 'Environment Variables'}</label>
                    <Button variant="ghost" size="sm" onClick={addEnvPair} className="text-xs">
                      <Plus className="w-3 h-3 mr-1" />{language === 'zh' ? '添加' : 'Add'}
                    </Button>
                  </div>
                  {customEnvPairs.length === 0 ? (
                    <p className="text-xs text-text-muted py-2">{language === 'zh' ? '点击"添加"设置环境变量（如 API 密钥）' : 'Click "Add" to set environment variables (e.g. API keys)'}</p>
                  ) : (
                    <div className="space-y-2">
                      {customEnvPairs.map(pair => (
                        <div key={pair.id} className="flex gap-2 items-center">
                          <Input value={pair.key} onChange={(e) => updateEnvPair(pair.id, 'key', e.target.value)} placeholder="KEY" className="flex-1 font-mono text-xs" />
                          <span className="text-text-muted text-xs">=</span>
                          <Input value={pair.value} onChange={(e) => updateEnvPair(pair.id, 'value', e.target.value)} placeholder="value" className="flex-[2] text-xs" />
                          <button onClick={() => removeEnvPair(pair.id)} className="p-1.5 text-text-muted hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 远程服务器字段 */}
            {serverType === 'remote' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '服务器 URL' : 'Server URL'} <span className="text-red-400">*</span></label>
                  <Input value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} placeholder="https://mcp.example.com/api" />
                </div>

                {/* 自定义请求头 */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '请求头' : 'Request Headers'}</label>
                    <Button variant="ghost" size="sm" onClick={addHeaderPair} className="text-xs">
                      <Plus className="w-3 h-3 mr-1" />{language === 'zh' ? '添加' : 'Add'}
                    </Button>
                  </div>
                  {customHeaderPairs.length === 0 ? (
                    <p className="text-xs text-text-muted py-1">{language === 'zh' ? '例如：Authorization: Bearer YOUR_TOKEN' : 'e.g. Authorization: Bearer YOUR_TOKEN'}</p>
                  ) : (
                    <div className="space-y-2">
                      {customHeaderPairs.map(pair => (
                        <div key={pair.id} className="flex gap-2 items-center">
                          <Input value={pair.key} onChange={(e) => updateHeaderPair(pair.id, 'key', e.target.value)} placeholder="Authorization" className="flex-1 font-mono text-xs" />
                          <span className="text-text-muted text-xs">:</span>
                          <Input value={pair.value} onChange={(e) => updateHeaderPair(pair.id, 'value', e.target.value)} placeholder="Bearer ..." className="flex-[2] text-xs" />
                          <button onClick={() => removeHeaderPair(pair.id)} className="p-1.5 text-text-muted hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* OAuth */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? 'OAuth 认证' : 'OAuth Authentication'}</label>
                    <button
                      className={`relative w-10 h-5 rounded-full transition-colors ${enableOAuth ? 'bg-accent' : 'bg-white/10'}`}
                      onClick={() => setEnableOAuth(!enableOAuth)}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${enableOAuth ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {enableOAuth && (
                    <div className="space-y-3 p-3 bg-surface/30 rounded-lg">
                      <div className="space-y-1.5">
                        <label className="text-sm text-text-muted">{language === 'zh' ? '客户端 ID（可选）' : 'Client ID (optional)'}</label>
                        <Input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)}
                          placeholder={language === 'zh' ? '留空则尝试动态注册' : 'Leave empty for dynamic registration'} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm text-text-muted">{language === 'zh' ? '客户端密钥' : 'Client Secret'}</label>
                        <Input type="password" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm text-text-muted">{language === 'zh' ? '作用域' : 'Scope'}</label>
                        <Input value={oauthScope} onChange={(e) => setOauthScope(e.target.value)} placeholder="read write" />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-text-secondary">{language === 'zh' ? '自动批准的工具' : 'Auto-approve Tools'}</label>
              <Input value={autoApproveInput} onChange={(e) => setAutoApproveInput(e.target.value)} placeholder="tool1, tool2, tool3" />
              <p className="text-xs text-text-muted">{language === 'zh' ? '用逗号分隔，这些工具调用时不需要用户确认' : 'Comma-separated. These tools will not require user approval'}</p>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 rounded-lg text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 保存层级选择 + 底部按钮 */}
        <div className="pt-4 border-t border-border space-y-3">
          {!isBrowsing && (
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-text-muted">{language === 'zh' ? '保存到：' : 'Save to:'}</span>
              <div className="flex items-center rounded-md border border-border overflow-hidden">
                {([['user', language === 'zh' ? '全局配置' : 'Global'], ['workspace', language === 'zh' ? '项目配置' : 'Project']] as ['user' | 'workspace', string][]).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setSaveLevel(val)}
                    className={`text-[11px] px-3 py-1 transition-colors ${
                      saveLevel === val
                        ? 'bg-accent/20 text-accent font-medium'
                        : 'bg-black/20 text-text-muted hover:bg-black/30 hover:text-text-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-between">
            {!isBrowsing ? (
              <Button variant="ghost" onClick={handleBack}>{language === 'zh' ? '返回' : 'Back'}</Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { onClose(); resetForm() }}>{language === 'zh' ? '取消' : 'Cancel'}</Button>
              {!isBrowsing && (
                <Button variant="primary" onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {language === 'zh' ? '添加服务器' : 'Add Server'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
