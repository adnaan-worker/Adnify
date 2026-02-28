/**
 * 配置清理器
 * 
 * 在保存配置时自动移除不存在的字段，保持配置文件干净
 */

// ============================================
// EditorConfig 清理
// ============================================

export interface EditorConfigSchema {
  fontSize?: number
  fontFamily?: string
  tabSize?: number
  wordWrap?: 'on' | 'off' | 'wordWrapColumn'
  lineHeight?: number
  minimap?: boolean
  minimapScale?: number
  lineNumbers?: 'on' | 'off' | 'relative'
  bracketPairColorization?: boolean
  formatOnSave?: boolean
  autoSave?: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay?: number
  terminal?: {
    fontSize?: number
    fontFamily?: string
    lineHeight?: number
    cursorBlink?: boolean
    scrollback?: number
    maxOutputLines?: number
  }
  git?: {
    autoRefresh?: boolean
  }
  lsp?: {
    timeoutMs?: number
    completionTimeoutMs?: number
    crashCooldownMs?: number
  }
  performance?: {
    maxProjectFiles?: number
    maxFileTreeDepth?: number
    fileChangeDebounceMs?: number
    completionDebounceMs?: number
    searchDebounceMs?: number
    saveDebounceMs?: number
    indexStatusIntervalMs?: number
    fileWatchIntervalMs?: number
    flushIntervalMs?: number
    requestTimeoutMs?: number
    commandTimeoutMs?: number
    workerTimeoutMs?: number
    healthCheckTimeoutMs?: number
    terminalBufferSize?: number
    maxResultLength?: number
    largeFileWarningThresholdMB?: number
    largeFileLineCount?: number
    veryLargeFileLineCount?: number
    maxSearchResults?: number
  }
  ai?: {
    completionEnabled?: boolean
    completionMaxTokens?: number
    completionTemperature?: number
    completionTriggerChars?: string[]
  }
}

export function cleanEditorConfig(config: Record<string, unknown>): EditorConfigSchema {
  const cleaned: EditorConfigSchema = {}

  // 基础字段
  if (typeof config.fontSize === 'number') cleaned.fontSize = config.fontSize
  if (typeof config.fontFamily === 'string') cleaned.fontFamily = config.fontFamily
  if (typeof config.tabSize === 'number') cleaned.tabSize = config.tabSize
  if (config.wordWrap === 'on' || config.wordWrap === 'off' || config.wordWrap === 'wordWrapColumn') {
    cleaned.wordWrap = config.wordWrap
  }
  if (typeof config.lineHeight === 'number') cleaned.lineHeight = config.lineHeight
  if (typeof config.minimap === 'boolean') cleaned.minimap = config.minimap
  if (typeof config.minimapScale === 'number') cleaned.minimapScale = config.minimapScale
  if (config.lineNumbers === 'on' || config.lineNumbers === 'off' || config.lineNumbers === 'relative') {
    cleaned.lineNumbers = config.lineNumbers
  }
  if (typeof config.bracketPairColorization === 'boolean') cleaned.bracketPairColorization = config.bracketPairColorization
  if (typeof config.formatOnSave === 'boolean') cleaned.formatOnSave = config.formatOnSave
  if (config.autoSave === 'off' || config.autoSave === 'afterDelay' || config.autoSave === 'onFocusChange') {
    cleaned.autoSave = config.autoSave
  }
  if (typeof config.autoSaveDelay === 'number') cleaned.autoSaveDelay = config.autoSaveDelay

  // terminal 子对象
  if (config.terminal && typeof config.terminal === 'object') {
    const t = config.terminal as Record<string, unknown>
    cleaned.terminal = {}
    if (typeof t.fontSize === 'number') cleaned.terminal.fontSize = t.fontSize
    if (typeof t.fontFamily === 'string') cleaned.terminal.fontFamily = t.fontFamily
    if (typeof t.lineHeight === 'number') cleaned.terminal.lineHeight = t.lineHeight
    if (typeof t.cursorBlink === 'boolean') cleaned.terminal.cursorBlink = t.cursorBlink
    if (typeof t.scrollback === 'number') cleaned.terminal.scrollback = t.scrollback
    if (typeof t.maxOutputLines === 'number') cleaned.terminal.maxOutputLines = t.maxOutputLines
  }

  // git 子对象
  if (config.git && typeof config.git === 'object') {
    const g = config.git as Record<string, unknown>
    cleaned.git = {}
    if (typeof g.autoRefresh === 'boolean') cleaned.git.autoRefresh = g.autoRefresh
  }

  // lsp 子对象
  if (config.lsp && typeof config.lsp === 'object') {
    const l = config.lsp as Record<string, unknown>
    cleaned.lsp = {}
    if (typeof l.timeoutMs === 'number') cleaned.lsp.timeoutMs = l.timeoutMs
    if (typeof l.completionTimeoutMs === 'number') cleaned.lsp.completionTimeoutMs = l.completionTimeoutMs
    if (typeof l.crashCooldownMs === 'number') cleaned.lsp.crashCooldownMs = l.crashCooldownMs
  }

  // performance 子对象
  if (config.performance && typeof config.performance === 'object') {
    const p = config.performance as Record<string, unknown>
    cleaned.performance = {}
    const numFields = [
      'maxProjectFiles', 'maxFileTreeDepth', 'fileChangeDebounceMs', 'completionDebounceMs',
      'searchDebounceMs', 'saveDebounceMs', 'indexStatusIntervalMs', 'fileWatchIntervalMs',
      'flushIntervalMs', 'requestTimeoutMs', 'commandTimeoutMs', 'workerTimeoutMs',
      'healthCheckTimeoutMs', 'terminalBufferSize', 'maxResultLength',
      'largeFileWarningThresholdMB', 'largeFileLineCount', 'veryLargeFileLineCount', 'maxSearchResults'
    ] as const
    for (const field of numFields) {
      if (typeof p[field] === 'number') {
        (cleaned.performance as Record<string, number>)[field] = p[field] as number
      }
    }
  }

  // ai 子对象
  if (config.ai && typeof config.ai === 'object') {
    const a = config.ai as Record<string, unknown>
    cleaned.ai = {}
    if (typeof a.completionEnabled === 'boolean') cleaned.ai.completionEnabled = a.completionEnabled
    if (typeof a.completionMaxTokens === 'number') cleaned.ai.completionMaxTokens = a.completionMaxTokens
    if (typeof a.completionTemperature === 'number') cleaned.ai.completionTemperature = a.completionTemperature
    if (Array.isArray(a.completionTriggerChars)) {
      cleaned.ai.completionTriggerChars = a.completionTriggerChars.filter(c => typeof c === 'string')
    }
  }

  return cleaned
}

// ============================================
// AgentConfig 清理
// ============================================

export interface AgentConfigSchema {
  maxToolLoops?: number
  maxHistoryMessages?: number
  enableAutoFix?: boolean
  maxToolResultChars?: number
  maxFileContentChars?: number
  maxTotalContextChars?: number
  maxContextTokens?: number
  maxSingleFileChars?: number
  maxContextFiles?: number
  maxSemanticResults?: number
  maxTerminalChars?: number
  maxRetries?: number
  retryDelayMs?: number
  toolTimeoutMs?: number
  keepRecentTurns?: number
  deepCompressionTurns?: number
  maxImportantOldTurns?: number
  enableLLMSummary?: boolean
  autoHandoff?: boolean
  loopDetection?: {
    maxHistory?: number
    maxExactRepeats?: number
    maxSameTargetRepeats?: number
  }
  ignoredDirectories?: string[]
}

export function cleanAgentConfig(config: Record<string, unknown>): AgentConfigSchema {
  const cleaned: AgentConfigSchema = {}

  const numFields = [
    'maxToolLoops', 'maxHistoryMessages', 'maxToolResultChars', 'maxFileContentChars',
    'maxTotalContextChars', 'maxContextTokens', 'maxSingleFileChars', 'maxContextFiles',
    'maxSemanticResults', 'maxTerminalChars', 'maxRetries', 'retryDelayMs', 'toolTimeoutMs',
    'keepRecentTurns', 'deepCompressionTurns', 'maxImportantOldTurns'
  ] as const

  for (const field of numFields) {
    if (typeof config[field] === 'number') {
      (cleaned as Record<string, number>)[field] = config[field] as number
    }
  }

  const boolFields = ['enableAutoFix', 'enableLLMSummary', 'autoHandoff', 'enableAutoContext'] as const
  for (const field of boolFields) {
    if (typeof config[field] === 'boolean') {
      (cleaned as Record<string, boolean>)[field] = config[field] as boolean
    }
  }

  // loopDetection 子对象
  if (config.loopDetection && typeof config.loopDetection === 'object') {
    const ld = config.loopDetection as Record<string, unknown>
    cleaned.loopDetection = {}
    if (typeof ld.maxHistory === 'number') cleaned.loopDetection.maxHistory = ld.maxHistory
    if (typeof ld.maxExactRepeats === 'number') cleaned.loopDetection.maxExactRepeats = ld.maxExactRepeats
    if (typeof ld.maxSameTargetRepeats === 'number') cleaned.loopDetection.maxSameTargetRepeats = ld.maxSameTargetRepeats
  }

  // ignoredDirectories 数组
  if (Array.isArray(config.ignoredDirectories)) {
    cleaned.ignoredDirectories = config.ignoredDirectories.filter(d => typeof d === 'string')
  }

  return cleaned
}

// ============================================
// AppSettings 清理
// ============================================

export interface AppSettingsSchema {
  llmConfig?: {
    provider?: string
    model?: string
    enableThinking?: boolean
    thinkingBudget?: number
    reasoningEffort?: 'low' | 'medium' | 'high'
    // 核心参数
    temperature?: number
    maxTokens?: number
    topP?: number
    topK?: number
    frequencyPenalty?: number
    presencePenalty?: number
    stopSequences?: string[]
    seed?: number
    logitBias?: Record<string, number>
    // AI SDK 高级参数
    maxRetries?: number
    toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
    parallelToolCalls?: boolean
    headers?: Record<string, string>
  }
  language?: string
  autoApprove?: {
    terminal?: boolean
    dangerous?: boolean
  }
  promptTemplateId?: string
  agentConfig?: AgentConfigSchema
  providerConfigs?: Record<string, unknown>
  aiInstructions?: string
  onboardingCompleted?: boolean
  enableFileLogging?: boolean
  webSearchConfig?: {
    googleApiKey?: string
    googleCx?: string
  }
  mcpConfig?: {
    autoConnect?: boolean
  }
}

export function cleanAppSettings(config: Record<string, unknown>): AppSettingsSchema {
  const cleaned: AppSettingsSchema = {}

  // llmConfig
  if (config.llmConfig && typeof config.llmConfig === 'object') {
    const llm = config.llmConfig as Record<string, unknown>
    cleaned.llmConfig = {}

    // 基础字段
    if (typeof llm.provider === 'string') cleaned.llmConfig.provider = llm.provider
    if (typeof llm.model === 'string') cleaned.llmConfig.model = llm.model
    if (typeof llm.enableThinking === 'boolean') cleaned.llmConfig.enableThinking = llm.enableThinking
    if (typeof llm.thinkingBudget === 'number') cleaned.llmConfig.thinkingBudget = llm.thinkingBudget
    if (llm.reasoningEffort === 'low' || llm.reasoningEffort === 'medium' || llm.reasoningEffort === 'high') {
      cleaned.llmConfig.reasoningEffort = llm.reasoningEffort
    }

    // 核心参数
    if (typeof llm.temperature === 'number') cleaned.llmConfig.temperature = llm.temperature
    if (typeof llm.maxTokens === 'number') cleaned.llmConfig.maxTokens = llm.maxTokens
    if (typeof llm.topP === 'number') cleaned.llmConfig.topP = llm.topP
    if (typeof llm.topK === 'number') cleaned.llmConfig.topK = llm.topK
    if (typeof llm.frequencyPenalty === 'number') cleaned.llmConfig.frequencyPenalty = llm.frequencyPenalty
    if (typeof llm.presencePenalty === 'number') cleaned.llmConfig.presencePenalty = llm.presencePenalty
    if (typeof llm.seed === 'number') cleaned.llmConfig.seed = llm.seed

    if (Array.isArray(llm.stopSequences)) {
      cleaned.llmConfig.stopSequences = llm.stopSequences.filter(s => typeof s === 'string')
    }

    if (llm.logitBias && typeof llm.logitBias === 'object') {
      const bias = llm.logitBias as Record<string, unknown>
      const cleanedBias: Record<string, number> = {}
      for (const [key, value] of Object.entries(bias)) {
        if (typeof value === 'number') cleanedBias[key] = value
      }
      if (Object.keys(cleanedBias).length > 0) {
        cleaned.llmConfig.logitBias = cleanedBias
      }
    }

    // AI SDK 高级参数
    if (typeof llm.maxRetries === 'number') cleaned.llmConfig.maxRetries = llm.maxRetries
    if (typeof llm.parallelToolCalls === 'boolean') cleaned.llmConfig.parallelToolCalls = llm.parallelToolCalls

    // toolChoice 验证
    if (llm.toolChoice) {
      if (llm.toolChoice === 'auto' || llm.toolChoice === 'none' || llm.toolChoice === 'required') {
        cleaned.llmConfig.toolChoice = llm.toolChoice
      } else if (typeof llm.toolChoice === 'object') {
        const tc = llm.toolChoice as Record<string, unknown>
        if (tc.type === 'tool' && typeof tc.toolName === 'string') {
          cleaned.llmConfig.toolChoice = { type: 'tool', toolName: tc.toolName }
        }
      }
    }

    // headers 验证
    if (llm.headers && typeof llm.headers === 'object') {
      const headers = llm.headers as Record<string, unknown>
      const cleanedHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') cleanedHeaders[key] = value
      }
      if (Object.keys(cleanedHeaders).length > 0) {
        cleaned.llmConfig.headers = cleanedHeaders
      }
    }
  }

  if (typeof config.language === 'string') cleaned.language = config.language

  // autoApprove
  if (config.autoApprove && typeof config.autoApprove === 'object') {
    const aa = config.autoApprove as Record<string, unknown>
    cleaned.autoApprove = {}
    if (typeof aa.terminal === 'boolean') cleaned.autoApprove.terminal = aa.terminal
    if (typeof aa.dangerous === 'boolean') cleaned.autoApprove.dangerous = aa.dangerous
  }

  if (typeof config.promptTemplateId === 'string') cleaned.promptTemplateId = config.promptTemplateId

  // agentConfig
  if (config.agentConfig && typeof config.agentConfig === 'object') {
    cleaned.agentConfig = cleanAgentConfig(config.agentConfig as Record<string, unknown>)
  }

  // providerConfigs - 保持原样（结构复杂，由 settingsService 处理）
  if (config.providerConfigs && typeof config.providerConfigs === 'object') {
    cleaned.providerConfigs = config.providerConfigs as Record<string, unknown>
  }

  if (typeof config.aiInstructions === 'string') cleaned.aiInstructions = config.aiInstructions
  if (typeof config.onboardingCompleted === 'boolean') cleaned.onboardingCompleted = config.onboardingCompleted
  if (typeof config.enableFileLogging === 'boolean') cleaned.enableFileLogging = config.enableFileLogging

  // webSearchConfig
  if (config.webSearchConfig && typeof config.webSearchConfig === 'object') {
    const ws = config.webSearchConfig as Record<string, unknown>
    cleaned.webSearchConfig = {}
    if (typeof ws.googleApiKey === 'string') cleaned.webSearchConfig.googleApiKey = ws.googleApiKey
    if (typeof ws.googleCx === 'string') cleaned.webSearchConfig.googleCx = ws.googleCx
  }

  // mcpConfig
  if (config.mcpConfig && typeof config.mcpConfig === 'object') {
    const mcp = config.mcpConfig as Record<string, unknown>
    cleaned.mcpConfig = {}
    if (typeof mcp.autoConnect === 'boolean') cleaned.mcpConfig.autoConnect = mcp.autoConnect
  }

  return cleaned
}

// ============================================
// 统一清理入口
// ============================================

/**
 * 根据 key 清理配置值
 */
export function cleanConfigValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value

  switch (key) {
    case 'editorConfig':
      return typeof value === 'object' ? cleanEditorConfig(value as Record<string, unknown>) : value

    case 'app-settings':
      return typeof value === 'object' ? cleanAppSettings(value as Record<string, unknown>) : value

    default:
      return value
  }
}
