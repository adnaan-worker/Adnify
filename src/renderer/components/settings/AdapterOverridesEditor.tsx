/**
 * 适配器配置编辑器
 * 
 * 支持完全自定义模式下配置所有参数：
 * - 认证配置
 * - 请求配置（端点、请求头、请求体模板）
 * - 响应解析配置（SSE、内容字段、工具调用字段）
 * - 消息格式配置（系统消息、工具结果格式）
 * - 工具格式配置（包装模式、参数字段）
 */

import { useState, useEffect } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FileJson,
  RotateCcw,
  AlertTriangle,
  Key,
  Send,
  MessageSquare,
  Wrench,
  Eye,
} from 'lucide-react'
import { Button, Input, Select } from '@components/ui'
import type { AdvancedConfig, LLMAdapterConfig, ResponseConfig, MessageFormatConfig, ToolFormatConfig, VisionConfig } from '@/shared/config/providers'

interface AdapterOverridesEditorProps {
  overrides?: AdvancedConfig
  onChange: (overrides: AdvancedConfig | undefined) => void
  language: 'en' | 'zh'
  defaultEndpoint?: string
  defaultConfig?: LLMAdapterConfig
  /** 是否为完全自定义模式（显示所有配置项） */
  fullCustomMode?: boolean
  /** Provider 是否默认支持视觉 */
  defaultSupportsVision?: boolean
  /** 是否使用全宽布局 */
  fullWidth?: boolean
}

// ============ 选项配置 ============

const AUTH_TYPE_OPTIONS = [
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'api-key', label: 'API Key Header (x-api-key)' },
  { value: 'header', label: 'Custom Header' },
  { value: 'none', label: 'None' },
]

const SYSTEM_MESSAGE_MODE_OPTIONS = [
  { value: 'message', label: '作为 system 消息' },
  { value: 'parameter', label: '作为独立参数 (如 Anthropic)' },
  { value: 'first-user', label: '合并到第一条用户消息' },
]

const TOOL_RESULT_ROLE_OPTIONS = [
  { value: 'tool', label: 'tool (OpenAI 格式)' },
  { value: 'user', label: 'user (Anthropic 格式)' },
]

const TOOL_WRAP_MODE_OPTIONS = [
  { value: 'function', label: 'function 包装 (OpenAI)' },
  { value: 'none', label: '无包装 (Anthropic)' },
  { value: 'tool', label: 'tool 包装' },
]

const PARAMETER_FIELD_OPTIONS = [
  { value: 'parameters', label: 'parameters (OpenAI)' },
  { value: 'input_schema', label: 'input_schema (Anthropic)' },
  { value: 'schema', label: 'schema' },
]

export function AdapterOverridesEditor({
  overrides,
  onChange,
  language,
  defaultEndpoint = '/chat/completions',
  defaultConfig,
  fullCustomMode = false,
  defaultSupportsVision = true,
  fullWidth = false,
}: AdapterOverridesEditorProps) {
  // 展开状态
  const [showAuth, setShowAuth] = useState(fullCustomMode)
  const [showRequest, setShowRequest] = useState(fullCustomMode)
  const [showResponse, setShowResponse] = useState(fullCustomMode)
  const [showMessageFormat, setShowMessageFormat] = useState(false)
  const [showToolFormat, setShowToolFormat] = useState(false)
  const [showVision, setShowVision] = useState(false)
  const [showHeaders, setShowHeaders] = useState(false)

  // JSON 编辑状态
  const [bodyJsonText, setBodyJsonText] = useState('')
  const [headersJsonText, setHeadersJsonText] = useState('')
  const [imageFormatJsonText, setImageFormatJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [headersError, setHeadersError] = useState<string | null>(null)
  const [imageFormatError, setImageFormatError] = useState<string | null>(null)

  // 默认值
  const defaults = {
    endpoint: defaultConfig?.request?.endpoint || defaultEndpoint,
    headers: defaultConfig?.request?.headers || {},
    bodyTemplate: defaultConfig?.request?.bodyTemplate || { stream: true },
    // Response
    dataPrefix: defaultConfig?.response?.dataPrefix || 'data:',
    doneMarker: defaultConfig?.response?.doneMarker || '[DONE]',
    contentField: defaultConfig?.response?.contentField || 'delta.content',
    reasoningField: defaultConfig?.response?.reasoningField || '',
    finishReasonField: defaultConfig?.response?.finishReasonField || 'finish_reason',
    toolCallField: defaultConfig?.response?.toolCallField || 'delta.tool_calls',
    toolNamePath: defaultConfig?.response?.toolNamePath || 'function.name',
    toolArgsPath: defaultConfig?.response?.toolArgsPath || 'function.arguments',
    toolIdPath: defaultConfig?.response?.toolIdPath || 'id',
    argsIsObject: defaultConfig?.response?.argsIsObject || false,
    // Message Format
    systemMessageMode: defaultConfig?.messageFormat?.systemMessageMode || 'message',
    systemParameterName: defaultConfig?.messageFormat?.systemParameterName || 'system',
    toolResultRole: defaultConfig?.messageFormat?.toolResultRole || 'tool',
    toolResultIdField: defaultConfig?.messageFormat?.toolResultIdField || 'tool_call_id',
    toolResultWrapper: defaultConfig?.messageFormat?.toolResultWrapper || '',
    assistantToolCallField: defaultConfig?.messageFormat?.assistantToolCallField || 'tool_calls',
    assistantToolCallFormat: defaultConfig?.messageFormat?.assistantToolCallFormat || 'openai',
    // Tool Format
    wrapMode: defaultConfig?.toolFormat?.wrapMode || 'function',
    wrapField: defaultConfig?.toolFormat?.wrapField || 'function',
    parameterField: defaultConfig?.toolFormat?.parameterField || 'parameters',
    includeType: defaultConfig?.toolFormat?.includeType ?? true,
  }

  // Provider 切换时重新初始化
  const [lastProviderId, setLastProviderId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const currentProviderId = defaultConfig?.id
    if (lastProviderId === undefined || currentProviderId !== lastProviderId) {
      setLastProviderId(currentProviderId)
      // 初始化 body JSON
      const bodyTemplate = overrides?.request?.bodyTemplate || defaultConfig?.request?.bodyTemplate || { stream: true }
      setBodyJsonText(JSON.stringify(bodyTemplate, null, 2))
      // 初始化 headers JSON
      const headers = overrides?.request?.headers || defaultConfig?.request?.headers || {}
      setHeadersJsonText(JSON.stringify(headers, null, 2))
      // 初始化图片格式 JSON（只有用户配置了才显示，否则留空）
      const imageTemplate = overrides?.vision?.imageFormat?.template
      setImageFormatJsonText(imageTemplate ? JSON.stringify(imageTemplate, null, 2) : '')
      setJsonError(null)
      setHeadersError(null)
      setImageFormatError(null)
    }
  }, [defaultConfig?.id, lastProviderId])

  // ============ 更新函数 ============

  const updateAuth = (updates: Partial<NonNullable<AdvancedConfig['auth']>>) => {
    onChange({ ...overrides, auth: { ...overrides?.auth, ...updates } as any })
  }

  const updateRequest = (updates: Partial<NonNullable<AdvancedConfig['request']>>) => {
    const newRequest = { ...overrides?.request, ...updates }
    // 清理空值
    Object.keys(newRequest).forEach((k) => {
      if (newRequest[k as keyof typeof newRequest] === undefined) delete newRequest[k as keyof typeof newRequest]
    })
    onChange({ ...overrides, request: Object.keys(newRequest).length > 0 ? newRequest : undefined })
  }

  const updateResponse = (updates: Partial<ResponseConfig>) => {
    const newResponse = { ...overrides?.response, ...updates }
    Object.keys(newResponse).forEach((k) => {
      if (newResponse[k as keyof typeof newResponse] === undefined) delete newResponse[k as keyof typeof newResponse]
    })
    onChange({ ...overrides, response: Object.keys(newResponse).length > 0 ? newResponse : undefined })
  }

  const updateMessageFormat = (updates: Partial<MessageFormatConfig>) => {
    const current = overrides?.messageFormat || {}
    const newFormat = { ...current, ...updates }
    onChange({ ...overrides, messageFormat: newFormat as MessageFormatConfig })
  }

  const updateToolFormat = (updates: Partial<ToolFormatConfig>) => {
    const current = overrides?.toolFormat || {}
    const newFormat = { ...current, ...updates }
    onChange({ ...overrides, toolFormat: newFormat as ToolFormatConfig })
  }

  const updateVision = (updates: Partial<VisionConfig>) => {
    const current = overrides?.vision || {}
    const newVision = { ...current, ...updates }
    // 清理空值
    if (newVision.enabled === undefined) delete newVision.enabled
    if (!newVision.imageFormat) delete newVision.imageFormat
    onChange({ ...overrides, vision: Object.keys(newVision).length > 0 ? newVision : undefined })
  }

  const updateImageFormat = (template: Record<string, unknown>) => {
    updateVision({ imageFormat: { template } })
  }

  // ============ JSON 处理 ============

  const handleBodyJsonChange = (text: string) => {
    setBodyJsonText(text)
    if (!text.trim()) {
      setJsonError(null)
      updateRequest({ bodyTemplate: undefined })
      return
    }
    try {
      const parsed = JSON.parse(text)
      setJsonError(null)
      updateRequest({ bodyTemplate: parsed })
    } catch (e: any) {
      setJsonError(e.message)
    }
  }

  const handleHeadersJsonChange = (text: string) => {
    setHeadersJsonText(text)
    if (!text.trim()) {
      setHeadersError(null)
      updateRequest({ headers: undefined })
      return
    }
    try {
      const parsed = JSON.parse(text)
      setHeadersError(null)
      updateRequest({ headers: parsed })
    } catch (e: any) {
      setHeadersError(e.message)
    }
  }

  const handleImageFormatJsonChange = (text: string) => {
    setImageFormatJsonText(text)
    if (!text.trim()) {
      setImageFormatError(null)
      updateVision({ imageFormat: undefined })
      return
    }
    try {
      const parsed = JSON.parse(text)
      setImageFormatError(null)
      updateImageFormat(parsed)
    } catch (e: any) {
      setImageFormatError(e.message)
    }
  }

  // JSON 失焦时自动格式化
  const formatJsonOnBlur = (
    text: string,
    setText: (t: string) => void,
    setError: (e: string | null) => void
  ) => {
    if (!text.trim()) return
    try {
      const parsed = JSON.parse(text)
      setText(JSON.stringify(parsed, null, 2))
      setError(null)
    } catch {
      // 保持原样，错误已在 onChange 中处理
    }
  }

  const handleReset = () => {
    onChange(undefined)
    setBodyJsonText(JSON.stringify(defaults.bodyTemplate, null, 2))
    setHeadersJsonText(JSON.stringify(defaults.headers, null, 2))
    setImageFormatJsonText('')
    setJsonError(null)
    setHeadersError(null)
    setImageFormatError(null)
  }

  const hasOverrides = !!overrides

  // ============ 渲染辅助 ============

  const SectionHeader = ({
    icon: Icon,
    title,
    expanded,
    onToggle,
    hasChanges,
  }: {
    icon: any
    title: string
    expanded: boolean
    onToggle: () => void
    hasChanges?: boolean
  }) => (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 text-xs font-medium text-text-primary py-2 hover:text-accent transition-colors"
    >
      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      <Icon className="w-3.5 h-3.5" />
      <span>{title}</span>
      {hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-accent ml-1" />}
    </button>
  )

  const FieldRow = ({
    label,
    hint,
    children,
    className = '',
  }: {
    label: string
    hint?: string
    children: React.ReactNode
    className?: string
  }) => (
    <div className={`space-y-1 ${className}`}>
      <label className="text-[10px] text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[9px] text-text-muted">{hint}</p>}
    </div>
  )

  // fullWidth 模式下不需要外层边框
  const containerClass = fullWidth 
    ? 'space-y-4' 
    : 'space-y-1 border border-border-subtle rounded-lg bg-surface/20'

  return (
    <div className={containerClass}>
      {/* Header - fullWidth 模式下隐藏 */}
      {!fullWidth && (
        <div className="flex items-center justify-between px-4 py-2 bg-surface/30 border-b border-border-subtle">
          <span className="text-xs font-medium text-text-secondary">
            {fullCustomMode
              ? language === 'zh' ? '完整适配器配置' : 'Full Adapter Configuration'
              : language === 'zh' ? '高级配置' : 'Advanced Config'}
          </span>
          {hasOverrides && (
            <Button variant="ghost" size="sm" onClick={handleReset} className="h-6 px-2 text-[10px]">
              <RotateCcw className="w-3 h-3 mr-1" />
              {language === 'zh' ? '重置' : 'Reset'}
            </Button>
          )}
        </div>
      )}

      {/* fullWidth 模式下显示重置按钮 */}
      {fullWidth && hasOverrides && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={handleReset} className="h-6 px-2 text-[10px]">
            <RotateCcw className="w-3 h-3 mr-1" />
            {language === 'zh' ? '重置全部' : 'Reset All'}
          </Button>
        </div>
      )}

      <div className={fullWidth ? 'space-y-4' : 'px-4 pb-3 space-y-1'}>
        {/* ============ 认证配置 ============ */}
        <SectionHeader
          icon={Key}
          title={language === 'zh' ? '认证配置' : 'Authentication'}
          expanded={showAuth}
          onToggle={() => setShowAuth(!showAuth)}
          hasChanges={!!overrides?.auth}
        />
        {showAuth && (
          <div className={fullWidth ? 'pb-4 grid grid-cols-2 md:grid-cols-4 gap-4' : 'pl-6 pb-3 space-y-3 border-l-2 border-border-subtle ml-1.5'}>
            <FieldRow label={language === 'zh' ? '认证方式' : 'Auth Type'}>
              <Select
                value={overrides?.auth?.type || 'bearer'}
                onChange={(v) => updateAuth({ type: v as any })}
                options={AUTH_TYPE_OPTIONS}
                className="h-8 text-xs"
              />
            </FieldRow>
            {(overrides?.auth?.type === 'header' || overrides?.auth?.type === 'api-key') && (
              <FieldRow label={language === 'zh' ? 'Header 名称' : 'Header Name'}>
                <Input
                  value={overrides?.auth?.headerName || (overrides?.auth?.type === 'api-key' ? 'x-api-key' : '')}
                  onChange={(e) => updateAuth({ headerName: e.target.value })}
                  placeholder="x-api-key"
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>
            )}
          </div>
        )}

        {/* ============ 请求配置 ============ */}
        <SectionHeader
          icon={Send}
          title={language === 'zh' ? '请求配置' : 'Request Configuration'}
          expanded={showRequest}
          onToggle={() => setShowRequest(!showRequest)}
          hasChanges={!!overrides?.request}
        />
        {showRequest && (
          <div className={fullWidth ? 'pb-4 space-y-4' : 'pl-6 pb-3 space-y-3 border-l-2 border-border-subtle ml-1.5'}>
            {/* fullWidth 模式：端点和请求头并排 */}
            {fullWidth ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldRow label={language === 'zh' ? 'API 端点' : 'API Endpoint'} hint={language === 'zh' ? '相对于 baseUrl 的路径' : 'Path relative to baseUrl'}>
                  <Input
                    value={overrides?.request?.endpoint ?? defaults.endpoint}
                    onChange={(e) => updateRequest({ endpoint: e.target.value || undefined })}
                    placeholder={defaults.endpoint}
                    className="h-8 text-xs font-mono"
                  />
                </FieldRow>
                
                {/* 自定义请求头 */}
                <FieldRow label={language === 'zh' ? '自定义请求头 (JSON)' : 'Custom Headers (JSON)'}>
                  <div className="relative">
                    <textarea
                      value={headersJsonText}
                      onChange={(e) => handleHeadersJsonChange(e.target.value)}
                      onBlur={() => formatJsonOnBlur(headersJsonText, setHeadersJsonText, setHeadersError)}
                      className={`w-full px-3 py-2 text-xs font-mono bg-surface/50 border rounded-md focus:outline-none resize-y min-h-[80px] ${
                        headersError ? 'border-red-500/50' : 'border-border-subtle focus:border-accent'
                      }`}
                      placeholder='{ "X-Custom-Header": "value" }'
                    />
                    {headersError && (
                      <div className="absolute bottom-2 left-2 right-2 px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span className="truncate">{headersError}</span>
                      </div>
                    )}
                  </div>
                </FieldRow>
              </div>
            ) : (
              <>
                <FieldRow label={language === 'zh' ? 'API 端点' : 'API Endpoint'} hint={language === 'zh' ? '相对于 baseUrl 的路径' : 'Path relative to baseUrl'}>
                  <Input
                    value={overrides?.request?.endpoint ?? defaults.endpoint}
                    onChange={(e) => updateRequest({ endpoint: e.target.value || undefined })}
                    placeholder={defaults.endpoint}
                    className="h-8 text-xs font-mono"
                  />
                </FieldRow>

                {/* 自定义请求头 */}
                <div className="space-y-1">
                  <button
                    onClick={() => setShowHeaders(!showHeaders)}
                    className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary"
                  >
                    {showHeaders ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {language === 'zh' ? '自定义请求头 (JSON)' : 'Custom Headers (JSON)'}
                  </button>
                  {showHeaders && (
                    <div className="relative">
                      <textarea
                        value={headersJsonText}
                        onChange={(e) => handleHeadersJsonChange(e.target.value)}
                        onBlur={() => formatJsonOnBlur(headersJsonText, setHeadersJsonText, setHeadersError)}
                        className={`w-full px-3 py-2 text-xs font-mono bg-surface/50 border rounded-md focus:outline-none resize-y min-h-[80px] ${
                          headersError ? 'border-red-500/50' : 'border-border-subtle focus:border-accent'
                        }`}
                        placeholder='{ "X-Custom-Header": "value" }'
                      />
                      {headersError && (
                        <div className="mt-1 px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span className="truncate">{headersError}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 请求体模板 */}
            <FieldRow label={language === 'zh' ? '请求体模板 (JSON)' : 'Body Template (JSON)'}>
              <div className="relative">
                <textarea
                  value={bodyJsonText}
                  onChange={(e) => handleBodyJsonChange(e.target.value)}
                  onBlur={() => formatJsonOnBlur(bodyJsonText, setBodyJsonText, setJsonError)}
                  className={`w-full px-3 py-2 text-xs font-mono bg-surface/50 border rounded-md focus:outline-none resize-y min-h-[120px] ${
                    jsonError ? 'border-red-500/50' : 'border-border-subtle focus:border-accent'
                  }`}
                  placeholder='{ "stream": true }'
                />
                {jsonError && (
                  <div className="absolute bottom-2 left-2 right-2 px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="truncate">{jsonError}</span>
                  </div>
                )}
              </div>
              <p className="text-[9px] text-text-muted">
                {language === 'zh'
                  ? 'model, messages, tools, max_tokens, temperature, top_p 由系统自动填充'
                  : 'model, messages, tools, max_tokens, temperature, top_p are auto-filled'}
              </p>
            </FieldRow>
          </div>
        )}

        {/* ============ 响应解析配置 ============ */}
        <SectionHeader
          icon={FileJson}
          title={language === 'zh' ? '响应解析' : 'Response Parsing'}
          expanded={showResponse}
          onToggle={() => setShowResponse(!showResponse)}
          hasChanges={!!overrides?.response}
        />
        {showResponse && (
          <div className={fullWidth ? 'pb-4' : 'pl-6 pb-3 border-l-2 border-border-subtle ml-1.5'}>
            <div className={`grid gap-4 ${fullWidth ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 gap-3'}`}>
              {/* SSE 配置 */}
              <FieldRow label="Data Prefix" hint="SSE data 前缀">
                <Input
                  value={overrides?.response?.dataPrefix ?? defaults.dataPrefix}
                  onChange={(e) => updateResponse({ dataPrefix: e.target.value || undefined })}
                  placeholder={defaults.dataPrefix}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>
              <FieldRow label="Done Marker" hint="流结束标记">
                <Input
                  value={overrides?.response?.doneMarker ?? defaults.doneMarker}
                  onChange={(e) => updateResponse({ doneMarker: e.target.value || undefined })}
                  placeholder={defaults.doneMarker}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>

              {/* 内容字段 */}
              <FieldRow label="Content Field" hint="文本内容路径 (相对于 choices[0])">
                <Input
                  value={overrides?.response?.contentField ?? defaults.contentField}
                  onChange={(e) => updateResponse({ contentField: e.target.value || undefined })}
                  placeholder={defaults.contentField}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>
              <FieldRow label="Reasoning Field" hint="推理/思考内容路径">
                <Input
                  value={overrides?.response?.reasoningField ?? defaults.reasoningField}
                  onChange={(e) => updateResponse({ reasoningField: e.target.value || undefined })}
                  placeholder="delta.reasoning_content"
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>

              {/* 工具调用字段 */}
              <FieldRow label="Tool Calls Field" hint="工具调用数组路径">
                <Input
                  value={overrides?.response?.toolCallField ?? defaults.toolCallField}
                  onChange={(e) => updateResponse({ toolCallField: e.target.value || undefined })}
                  placeholder={defaults.toolCallField}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>
              <FieldRow label="Tool ID Path" hint="工具调用 ID 路径">
                <Input
                  value={overrides?.response?.toolIdPath ?? defaults.toolIdPath}
                  onChange={(e) => updateResponse({ toolIdPath: e.target.value || undefined })}
                  placeholder={defaults.toolIdPath}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>
              <FieldRow label="Tool Name Path" hint="工具名称路径">
                <Input
                  value={overrides?.response?.toolNamePath ?? defaults.toolNamePath}
                  onChange={(e) => updateResponse({ toolNamePath: e.target.value || undefined })}
                  placeholder={defaults.toolNamePath}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>
              <FieldRow label="Tool Args Path" hint="工具参数路径">
                <Input
                  value={overrides?.response?.toolArgsPath ?? defaults.toolArgsPath}
                  onChange={(e) => updateResponse({ toolArgsPath: e.target.value || undefined })}
                  placeholder={defaults.toolArgsPath}
                  className="h-8 text-xs font-mono"
                />
              </FieldRow>

              {/* 其他选项 */}
              <div className={`${fullWidth ? 'col-span-4' : 'col-span-2'} flex items-center gap-4`}>
                <label className="flex items-center gap-2 text-[10px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={overrides?.response?.argsIsObject ?? defaults.argsIsObject}
                    onChange={(e) => updateResponse({ argsIsObject: e.target.checked })}
                    className="w-3 h-3"
                  />
                  Args Is Object
                  <span className="text-text-muted">({language === 'zh' ? '参数已是对象' : 'Args is object'})</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ============ 消息格式配置（仅完全自定义模式） ============ */}
        {fullCustomMode && (
          <>
            <SectionHeader
              icon={MessageSquare}
              title={language === 'zh' ? '消息格式' : 'Message Format'}
              expanded={showMessageFormat}
              onToggle={() => setShowMessageFormat(!showMessageFormat)}
              hasChanges={!!overrides?.messageFormat}
            />
            {showMessageFormat && (
              <div className={fullWidth ? 'pb-4' : 'pl-6 pb-3 border-l-2 border-border-subtle ml-1.5'}>
                <div className={`grid gap-4 ${fullWidth ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2 gap-3'}`}>
                  <FieldRow label={language === 'zh' ? '系统消息处理' : 'System Message Mode'}>
                    <Select
                      value={(overrides?.messageFormat?.systemMessageMode as string) ?? defaults.systemMessageMode}
                      onChange={(v) => updateMessageFormat({ systemMessageMode: v as any })}
                      options={SYSTEM_MESSAGE_MODE_OPTIONS}
                      className="h-8 text-xs"
                    />
                  </FieldRow>
                  <FieldRow label={language === 'zh' ? '系统参数名' : 'System Parameter Name'} hint="当模式为 parameter 时使用">
                    <Input
                      value={(overrides?.messageFormat?.systemParameterName as string) ?? defaults.systemParameterName}
                      onChange={(e) => updateMessageFormat({ systemParameterName: e.target.value })}
                      placeholder="system"
                      className="h-8 text-xs font-mono"
                    />
                  </FieldRow>
                  <FieldRow label={language === 'zh' ? '工具结果角色' : 'Tool Result Role'}>
                    <Select
                      value={(overrides?.messageFormat?.toolResultRole as string) ?? defaults.toolResultRole}
                      onChange={(v) => updateMessageFormat({ toolResultRole: v as any })}
                      options={TOOL_RESULT_ROLE_OPTIONS}
                      className="h-8 text-xs"
                    />
                  </FieldRow>
                  <FieldRow label="Tool Result ID Field" hint="工具调用 ID 字段名">
                    <Input
                      value={(overrides?.messageFormat?.toolResultIdField as string) ?? defaults.toolResultIdField}
                      onChange={(e) => updateMessageFormat({ toolResultIdField: e.target.value })}
                      placeholder="tool_call_id"
                      className="h-8 text-xs font-mono"
                    />
                  </FieldRow>
                  <FieldRow label="Tool Result Wrapper" hint="包装类型 (如 tool_result)">
                    <Input
                      value={(overrides?.messageFormat?.toolResultWrapper as string) ?? defaults.toolResultWrapper}
                      onChange={(e) => updateMessageFormat({ toolResultWrapper: e.target.value })}
                      placeholder="tool_result"
                      className="h-8 text-xs font-mono"
                    />
                  </FieldRow>
                  <FieldRow label="Assistant Tool Call Field" hint="助手消息中的工具调用字段">
                    <Input
                      value={(overrides?.messageFormat?.assistantToolCallField as string) ?? defaults.assistantToolCallField}
                      onChange={(e) => updateMessageFormat({ assistantToolCallField: e.target.value })}
                      placeholder="tool_calls"
                      className="h-8 text-xs font-mono"
                    />
                  </FieldRow>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============ 工具格式配置（仅完全自定义模式） ============ */}
        {fullCustomMode && (
          <>
            <SectionHeader
              icon={Wrench}
              title={language === 'zh' ? '工具格式' : 'Tool Format'}
              expanded={showToolFormat}
              onToggle={() => setShowToolFormat(!showToolFormat)}
              hasChanges={!!overrides?.toolFormat}
            />
            {showToolFormat && (
              <div className={fullWidth ? 'pb-4' : 'pl-6 pb-3 border-l-2 border-border-subtle ml-1.5'}>
                <div className={`grid gap-4 ${fullWidth ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 gap-3'}`}>
                  <FieldRow label={language === 'zh' ? '包装模式' : 'Wrap Mode'}>
                    <Select
                      value={(overrides?.toolFormat?.wrapMode as string) ?? defaults.wrapMode}
                      onChange={(v) => updateToolFormat({ wrapMode: v as any })}
                      options={TOOL_WRAP_MODE_OPTIONS}
                      className="h-8 text-xs"
                    />
                  </FieldRow>
                  <FieldRow label={language === 'zh' ? '包装字段名' : 'Wrap Field'} hint="如 function">
                    <Input
                      value={(overrides?.toolFormat?.wrapField as string) ?? defaults.wrapField}
                      onChange={(e) => updateToolFormat({ wrapField: e.target.value })}
                      placeholder="function"
                      className="h-8 text-xs font-mono"
                    />
                  </FieldRow>
                  <FieldRow label={language === 'zh' ? '参数字段名' : 'Parameter Field'}>
                    <Select
                      value={(overrides?.toolFormat?.parameterField as string) ?? defaults.parameterField}
                      onChange={(v) => updateToolFormat({ parameterField: v as any })}
                      options={PARAMETER_FIELD_OPTIONS}
                      className="h-8 text-xs"
                    />
                  </FieldRow>
                  <div className="flex items-center">
                    <label className="flex items-center gap-2 text-[10px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={overrides?.toolFormat?.includeType ?? defaults.includeType}
                        onChange={(e) => updateToolFormat({ includeType: e.target.checked })}
                        className="w-3 h-3"
                      />
                      Include Type
                      <span className="text-text-muted">({language === 'zh' ? '包含 type 字段' : 'Include type field'})</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============ 视觉配置（所有模式都可用） ============ */}
        <SectionHeader
          icon={Eye}
          title={language === 'zh' ? '视觉配置' : 'Vision Configuration'}
          expanded={showVision}
          onToggle={() => setShowVision(!showVision)}
          hasChanges={!!overrides?.vision}
        />
        {showVision && (
          <div className={fullWidth ? 'pb-4 space-y-4' : 'pl-6 pb-3 border-l-2 border-border-subtle ml-1.5 space-y-3'}>
            {/* 启用/禁用视觉 */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={overrides?.vision?.enabled ?? defaultSupportsVision}
                  onChange={(e) => updateVision({ enabled: e.target.checked })}
                  className="w-3.5 h-3.5"
                />
                {language === 'zh' ? '启用图片发送' : 'Enable Image Input'}
                <span className="text-text-muted">
                  ({language === 'zh' ? `默认: ${defaultSupportsVision ? '启用' : '禁用'}` : `Default: ${defaultSupportsVision ? 'enabled' : 'disabled'}`})
                </span>
              </label>
            </div>

            {/* 图片格式配置（仅当启用视觉时显示） */}
            {(overrides?.vision?.enabled ?? defaultSupportsVision) && (
              <div className={fullWidth ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : ''}>
                <FieldRow label={language === 'zh' ? '图片格式模板 (JSON)' : 'Image Format Template (JSON)'}>
                  <div className="relative">
                    <textarea
                      value={imageFormatJsonText}
                      onChange={(e) => handleImageFormatJsonChange(e.target.value)}
                      onBlur={() => formatJsonOnBlur(imageFormatJsonText, setImageFormatJsonText, setImageFormatError)}
                      className={`w-full px-3 py-2 text-xs font-mono bg-surface/50 border rounded-md focus:outline-none resize-y min-h-[120px] ${
                        imageFormatError ? 'border-red-500/50' : 'border-border-subtle focus:border-accent'
                      }`}
                      placeholder='{ "type": "image_url", "image_url": { "url": "{{url}}" } }'
                    />
                    {imageFormatError && (
                      <div className="absolute bottom-2 left-2 right-2 px-2 py-1 text-[10px] text-red-400 bg-red-500/10 rounded flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        <span className="truncate">{imageFormatError}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] text-text-muted">
                    {language === 'zh'
                      ? '留空使用默认格式，可用变量: {{url}}, {{base64}}, {{mediaType}}'
                      : 'Leave empty for default. Variables: {{url}}, {{base64}}, {{mediaType}}'}
                  </p>
                </FieldRow>
                {fullWidth && (
                  <div className="space-y-2">
                    <label className="text-[10px] text-text-secondary">{language === 'zh' ? '常用格式示例' : 'Common Format Examples'}</label>
                    <div className="space-y-2 text-[10px] font-mono text-text-muted bg-black/20 rounded-md p-3">
                      <div>
                        <span className="text-accent">OpenAI / 智谱:</span>
                        <pre className="mt-1 text-text-secondary whitespace-pre-wrap">{`{ "type": "image_url", "image_url": { "url": "{{url}}" } }`}</pre>
                      </div>
                      <div className="pt-2 border-t border-border-subtle">
                        <span className="text-accent">Anthropic:</span>
                        <pre className="mt-1 text-text-secondary whitespace-pre-wrap">{`{ "type": "image", "source": { "type": "base64", "media_type": "{{mediaType}}", "data": "{{base64}}" } }`}</pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
