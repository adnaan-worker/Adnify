/**
 * Code Completion Service
 * Provides AI-powered code completion with debounce and cancellation support
 * Enhanced with FIM (Fill-in-the-Middle) support, caching, and multi-candidate support
 * 
 * Cursor-style features:
 * - LRU cache for fast repeated completions
 * - Multi-candidate suggestions with Tab cycling
 * - Predictive pre-fetching
 * - Context-aware completion ranking
 */

import { useStore } from '../store'
import { getEditorConfig } from '../config/editorConfig'

// ============ Interfaces ============

export interface Position {
  line: number
  column: number
}

export interface CompletionContext {
  filePath: string
  fileContent: string
  cursorPosition: Position
  prefix: string  // Text before cursor
  suffix: string  // Text after cursor
  language: string
  openFiles: Array<{ path: string; content: string }>
  recentFiles?: Array<{ path: string; content: string }>
  // Enhanced context
  currentFunction?: string  // Current function/method name
  imports?: string[]  // Import statements
  symbols?: string[]  // Local symbols (variables, functions)
}

export interface CompletionSuggestion {
  text: string
  displayText: string
  range: { start: number; end: number }
  confidence: number
  // Multi-candidate support
  index?: number
  total?: number
}

export interface CompletionResult {
  suggestions: CompletionSuggestion[]
  cached: boolean
  // Multi-candidate support
  currentIndex?: number
}

export interface CompletionOptions {
  enabled: boolean
  debounceMs: number
  maxTokens: number
  temperature: number
  triggerCharacters: string[]
  // Enhanced options
  fimEnabled: boolean  // Use FIM format for supported models
  contextLines: number  // Lines of context to include
  multilineSuggestions: boolean  // Allow multi-line completions
  // Cursor-style options
  cacheEnabled: boolean  // Enable completion caching
  cacheMaxSize: number  // Max cache entries
  cacheTTL: number  // Cache TTL in ms
  maxCandidates: number  // Max candidates to generate
}

// FIM-capable models
const FIM_MODELS = [
  'deepseek-coder',
  'codellama',
  'starcoder',
  'code-llama',
  'deepseek',
  'qwen-coder',
  'yi-coder',
]


// 从配置获取默认选项
function getDefaultOptions(): CompletionOptions {
  const config = getEditorConfig()
  return {
    enabled: config.ai?.completionEnabled ?? true,
    debounceMs: config.performance.completionDebounceMs,
    maxTokens: config.ai.completionMaxTokens,
    temperature: config.ai.completionTemperature,
    triggerCharacters: ['.', '(', '{', '[', '"', "'", '/', ' ', '\n'],
    fimEnabled: true,
    contextLines: 50,
    multilineSuggestions: true,
    // Cursor-style defaults
    cacheEnabled: true,
    cacheMaxSize: 100,
    cacheTTL: 60000, // 1 minute
    maxCandidates: 3,
  }
}

// Stop sequences for completion
const STOP_SEQUENCES = ['\n\n', '```', '// ', '/* ', '"""', "'''"]

// ============ LRU Cache ============

interface CacheEntry {
  result: CompletionResult
  timestamp: number
}

class CompletionCache {
  private cache = new Map<string, CacheEntry>()
  private maxSize: number
  private ttl: number

  constructor(maxSize = 100, ttl = 60000) {
    this.maxSize = maxSize
    this.ttl = ttl
  }

  private generateKey(context: CompletionContext): string {
    // Generate a cache key based on prefix (last 100 chars) and file
    const prefixKey = context.prefix.slice(-100)
    const suffixKey = context.suffix.slice(0, 50)
    return `${context.filePath}:${context.cursorPosition.line}:${prefixKey}:${suffixKey}`
  }

  get(context: CompletionContext): CompletionResult | null {
    const key = this.generateKey(context)
    const entry = this.cache.get(key)

    if (!entry) return null

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    // Move to end (LRU)
    this.cache.delete(key)
    this.cache.set(key, entry)

    return { ...entry.result, cached: true }
  }

  set(context: CompletionContext, result: CompletionResult): void {
    const key = this.generateKey(context)

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
    })
  }

  clear(): void {
    this.cache.clear()
  }

  // Prefix-based lookup for predictive matching
  getByPrefix(context: CompletionContext, minPrefixLength = 50): CompletionResult | null {
    const currentPrefix = context.prefix.slice(-100)

    for (const [key, entry] of this.cache) {
      if (Date.now() - entry.timestamp > this.ttl) continue

      // Check if cached prefix is a prefix of current prefix
      const cachedPrefix = key.split(':')[2] || ''
      if (currentPrefix.startsWith(cachedPrefix) && cachedPrefix.length >= minPrefixLength) {
        return { ...entry.result, cached: true }
      }
    }

    return null
  }
}

// ============ Debounce Utility ============

type DebouncedFunction<T extends (...args: Parameters<T>) => ReturnType<T>> = {
  (...args: Parameters<T>): void
  cancel: () => void
}

function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debouncedFn = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    console.log(`[Debounce] Scheduling execution in ${delay}ms`)
    timeoutId = setTimeout(() => {
      console.log('[Debounce] Timer fired, executing callback')
      fn(...args)
      timeoutId = null
    }, delay)
  }

  debouncedFn.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debouncedFn
}


// ============ Language Detection ============

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rs: 'rust', go: 'go', java: 'java',
  cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  json: 'json', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  return LANGUAGE_MAP[ext] || 'plaintext'
}

// ============ Import Analysis ============

const IMPORT_PATTERNS = [
  /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,  // ES6 import
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,      // Dynamic import
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,     // CommonJS require
]

function analyzeImports(content: string): string[] {
  const imports: Set<string> = new Set()

  for (const pattern of IMPORT_PATTERNS) {
    let match
    const regex = new RegExp(pattern.source, pattern.flags)
    while ((match = regex.exec(content)) !== null) {
      const importPath = match[1]
      // Only include relative imports (local files)
      if (importPath.startsWith('.') || importPath.startsWith('/')) {
        imports.add(importPath)
      }
    }
  }

  return Array.from(imports)
}


// ============ Completion Service Class ============

type CompletionCallback = (result: CompletionResult | null) => void
type ErrorCallback = (error: Error) => void

class CompletionService {
  private options: CompletionOptions
  private currentAbortController: AbortController | null = null
  private debouncedRequest: DebouncedFunction<(ctx: CompletionContext) => void> | null = null
  private onCompletionCallback: CompletionCallback | null = null
  private onErrorCallback: ErrorCallback | null = null
  private recentEditedFiles: Array<{ path: string; timestamp: number }> = []
  private maxRecentFiles = 5

  // Cursor-style enhancements
  private cache: CompletionCache
  private currentCandidates: CompletionSuggestion[] = []
  private currentCandidateIndex = 0
  private lastContext: CompletionContext | null = null

  constructor() {
    this.options = getDefaultOptions()
    this.cache = new CompletionCache(this.options.cacheMaxSize, this.options.cacheTTL)
    this.setupDebouncedRequest()
  }

  private setupDebouncedRequest(): void {
    this.debouncedRequest = debounce(
      (context: CompletionContext) => this.executeRequest(context),
      this.options.debounceMs
    )
  }

  /**
   * Configure completion options
   */
  configure(options: Partial<CompletionOptions>): void {
    this.options = { ...this.options, ...options }
    // Recreate debounced function with new delay
    this.setupDebouncedRequest()
    // Update cache settings
    if (options.cacheMaxSize || options.cacheTTL) {
      this.cache = new CompletionCache(
        this.options.cacheMaxSize,
        this.options.cacheTTL
      )
    }
  }

  /**
   * Get current options
   */
  getOptions(): CompletionOptions {
    return { ...this.options }
  }

  /**
   * Set completion callback
   */
  onCompletion(callback: CompletionCallback): void {
    this.onCompletionCallback = callback
  }

  /**
   * Set error callback
   */
  onError(callback: ErrorCallback): void {
    this.onErrorCallback = callback
  }

  /**
   * Cycle to next candidate (Tab cycling like Cursor)
   */
  nextCandidate(): CompletionSuggestion | null {
    if (this.currentCandidates.length === 0) return null

    this.currentCandidateIndex = (this.currentCandidateIndex + 1) % this.currentCandidates.length
    const candidate = this.currentCandidates[this.currentCandidateIndex]

    // Update index info
    return {
      ...candidate,
      index: this.currentCandidateIndex,
      total: this.currentCandidates.length,
    }
  }

  /**
   * Cycle to previous candidate
   */
  prevCandidate(): CompletionSuggestion | null {
    if (this.currentCandidates.length === 0) return null

    this.currentCandidateIndex = (this.currentCandidateIndex - 1 + this.currentCandidates.length) % this.currentCandidates.length
    const candidate = this.currentCandidates[this.currentCandidateIndex]

    return {
      ...candidate,
      index: this.currentCandidateIndex,
      total: this.currentCandidates.length,
    }
  }

  /**
   * Get current candidate
   */
  getCurrentCandidate(): CompletionSuggestion | null {
    if (this.currentCandidates.length === 0) return null
    return {
      ...this.currentCandidates[this.currentCandidateIndex],
      index: this.currentCandidateIndex,
      total: this.currentCandidates.length,
    }
  }

  /**
   * Clear current candidates
   */
  clearCandidates(): void {
    this.currentCandidates = []
    this.currentCandidateIndex = 0
  }

  /**
   * Track recently edited files
   */
  trackFileEdit(filePath: string): void {
    const now = Date.now()
    // Remove if already exists
    this.recentEditedFiles = this.recentEditedFiles.filter(f => f.path !== filePath)
    // Add to front
    this.recentEditedFiles.unshift({ path: filePath, timestamp: now })
    // Keep only maxRecentFiles
    if (this.recentEditedFiles.length > this.maxRecentFiles) {
      this.recentEditedFiles = this.recentEditedFiles.slice(0, this.maxRecentFiles)
    }
    // Clear cache for this file (content changed)
    if (this.options.cacheEnabled) {
      // Cache will naturally expire, but we could add file-specific invalidation
    }
  }

  /**
   * Get recently edited files
   */
  getRecentFiles(): string[] {
    return this.recentEditedFiles.map(f => f.path)
  }

  /**
   * Clear completion cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Request completion with debounce
   */
  requestCompletion(context: CompletionContext): void {
    if (!this.options.enabled) {
      console.log('[Completion] Skipped: disabled')
      return
    }
    console.log('[Completion] Request queued', context.cursorPosition)
    this.debouncedRequest?.(context)
  }

  /**
   * Cancel current request
   */
  cancel(): void {
    console.log('[Completion] Cancel called')
    this.debouncedRequest?.cancel()
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  /**
   * Check if a character should trigger completion
   */
  shouldTrigger(char: string): boolean {
    const should = this.options.enabled && this.options.triggerCharacters.includes(char)
    if (should) console.log('[Completion] Triggered by char:', char)
    return should
  }

  /**
   * Build completion context from editor state
   */
  buildContext(
    filePath: string,
    fileContent: string,
    cursorPosition: Position,
    prefixLines?: number,
    suffixLines?: number
  ): CompletionContext {
    const actualPrefixLines = prefixLines ?? this.options.contextLines
    const actualSuffixLines = suffixLines ?? Math.floor(this.options.contextLines / 2)

    const lines = fileContent.split('\n')
    const { line, column } = cursorPosition

    // Calculate prefix (text before cursor)
    const startLine = Math.max(0, line - actualPrefixLines)
    const prefixLineArray = lines.slice(startLine, line)
    const currentLinePrefix = lines[line]?.substring(0, column) || ''
    const prefix = [...prefixLineArray, currentLinePrefix].join('\n')

    // Calculate suffix (text after cursor)
    const currentLineSuffix = lines[line]?.substring(column) || ''
    const endLine = Math.min(lines.length, line + actualSuffixLines)
    const suffixLineArray = lines.slice(line + 1, endLine)
    const suffix = [currentLineSuffix, ...suffixLineArray].join('\n')

    // Get open files from store
    const state = useStore.getState()
    const openFiles = state.openFiles
      .filter((f: { path: string; content: string }) => f.path !== filePath)
      .slice(0, 3)  // Reduced for faster completions
      .map((f: { path: string; content: string }) => ({ path: f.path, content: f.content }))

    // Extract enhanced context
    const currentFunction = this.extractCurrentFunction(fileContent, line)
    const imports = this.extractImports(fileContent)

    return {
      filePath,
      fileContent,
      cursorPosition,
      prefix,
      suffix,
      language: getLanguageFromPath(filePath),
      openFiles,
      recentFiles: this.getRecentFilesContent(),
      currentFunction,
      imports,
    }
  }

  private getRecentFilesContent(): Array<{ path: string; content: string }> {
    const state = useStore.getState()
    return this.recentEditedFiles
      .map((f: { path: string; timestamp: number }) => {
        const openFile = state.openFiles.find((of: { path: string; content: string }) => of.path === f.path)
        return openFile ? { path: f.path, content: openFile.content } : null
      })
      .filter((f): f is { path: string; content: string } => f !== null)
  }

  /**
   * Execute the actual completion request
   * Enhanced with caching and multi-candidate support
   */
  private async executeRequest(context: CompletionContext): Promise<void> {
    console.log('[Completion] Executing request...')
    // Check cache first (Cursor-style optimization)
    if (this.options.cacheEnabled) {
      const cached = this.cache.get(context)
      if (cached) {
        console.log('[Completion] Cache hit')
        this.currentCandidates = cached.suggestions
        this.currentCandidateIndex = 0
        this.lastContext = context
        this.onCompletionCallback?.(cached)
        return
      }

      // Try prefix-based cache lookup
      const prefixCached = this.cache.getByPrefix(context)
      if (prefixCached) {
        console.log('[Completion] Prefix cache hit')
        this.currentCandidates = prefixCached.suggestions
        this.currentCandidateIndex = 0
        this.lastContext = context
        this.onCompletionCallback?.(prefixCached)
        return
      }
    }

    // Cancel any existing request
    if (this.currentAbortController) {
      this.currentAbortController.abort()
    }
    this.currentAbortController = new AbortController()

    try {
      const result = await this.fetchCompletion(context, this.currentAbortController.signal)

      // Store candidates for Tab cycling
      this.currentCandidates = result.suggestions
      this.currentCandidateIndex = 0
      this.lastContext = context

      // Cache the result
      if (this.options.cacheEnabled && result.suggestions.length > 0) {
        this.cache.set(context, result)
      }

      this.onCompletionCallback?.(result)
    } catch (error: any) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
        // Request was cancelled, ignore
        return
      }
      this.onErrorCallback?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.currentAbortController = null
    }
  }

  /**
   * Get completions directly (Promise-based)
   */
  public async getCompletions(
    context: CompletionContext,
    signal?: AbortSignal
  ): Promise<CompletionResult> {
    return this.fetchCompletion(context, signal ?? new AbortController().signal)
  }

  /**
   * Fetch completion from LLM using existing sendMessage API
   */
  private fetchCompletion(
    context: CompletionContext,
    signal: AbortSignal
  ): Promise<CompletionResult> {
    return new Promise((resolve, reject) => {
      const state = useStore.getState()
      const { llmConfig } = state

      if (!llmConfig.apiKey) {
        reject(new Error('API key not configured'))
        return
      }

      // Build the prompt for FIM (Fill-in-the-Middle)
      const prompt = this.buildFIMPrompt(context)
      let completionText = ''
      let isAborted = false

      // Handle abort signal
      const abortHandler = () => {
        isAborted = true
        window.electronAPI.abortMessage()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', abortHandler)

      // Set up listeners
      const unsubStream = window.electronAPI.onLLMStream((chunk) => {
        if (isAborted) return
        if (chunk.type === 'text' && chunk.content) {
          completionText += chunk.content
        }
      })

      const unsubError = window.electronAPI.onLLMError((error) => {
        cleanup()
        if (!isAborted) {
          reject(new Error(error.message))
        }
      })

      const unsubDone = window.electronAPI.onLLMDone(() => {
        cleanup()
        if (isAborted) return

        console.log('[Completion] LLM Done. Text:', completionText)

        if (!completionText) {
          resolve({ suggestions: [], cached: false })
          return
        }

        const suggestion: CompletionSuggestion = {
          text: completionText.trim(),
          displayText: this.formatDisplayText(completionText.trim()),
          range: { start: 0, end: 0 },
          confidence: 0.8
        }
        resolve({ suggestions: [suggestion], cached: false })
      })

      const cleanup = () => {
        signal.removeEventListener('abort', abortHandler)
        unsubStream()
        unsubError()
        unsubDone()
      }

      // Send the completion request
      window.electronAPI.sendMessage({
        config: llmConfig,
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: 'You are a code completion assistant. Output ONLY the code completion, no explanations or markdown.'
      }).catch((err) => {
        cleanup()
        if (!isAborted) {
          reject(err)
        }
      })
    })
  }


  /**
   * Check if current model supports FIM format
   */
  private isFIMModel(model: string): boolean {
    const modelLower = model.toLowerCase()
    return FIM_MODELS.some(fim => modelLower.includes(fim))
  }

  /**
   * Build FIM (Fill-in-the-Middle) prompt
   * Uses proper FIM format for supported models
   */
  private buildFIMPrompt(context: CompletionContext): string {
    const { prefix, suffix, language, openFiles, currentFunction, imports } = context
    const state = useStore.getState()
    const model = state.llmConfig.model || ''

    // Check if model supports native FIM format
    if (this.options.fimEnabled && this.isFIMModel(model)) {
      // DeepSeek Coder FIM format
      if (model.toLowerCase().includes('deepseek')) {
        return `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`
      }
      // CodeLlama/StarCoder FIM format
      return `<PRE>${prefix}<SUF>${suffix}<MID>`
    }

    // Build enhanced context for non-FIM models
    let contextStr = ''

    // Add imports context
    if (imports && imports.length > 0) {
      contextStr += `// Imports in this file:\n${imports.slice(0, 10).join('\n')}\n\n`
    }

    // Add current function context
    if (currentFunction) {
      contextStr += `// Currently editing function: ${currentFunction}\n\n`
    }

    // Add related files context (minimal)
    if (openFiles.length > 0) {
      const relatedSnippets = openFiles
        .slice(0, 2)
        .map(f => {
          const fileName = f.path.split(/[\\/]/).pop()
          // Only include relevant parts (first 500 chars)
          return `// ${fileName}:\n${f.content.slice(0, 500)}...`
        })
        .join('\n\n')
      contextStr += `// Related files:\n${relatedSnippets}\n\n`
    }

    // Build the prompt
    return `${contextStr}// Language: ${language}
// Complete the code at <CURSOR>. Output ONLY the completion code, nothing else.

${prefix}<CURSOR>${suffix}`
  }

  /**
   * Extract current function name from code
   */
  private extractCurrentFunction(content: string, line: number): string | undefined {
    const lines = content.split('\n')

    // Search backwards for function definition
    for (let i = line; i >= 0 && i > line - 50; i--) {
      const lineContent = lines[i]

      // Match various function patterns
      const patterns = [
        /function\s+(\w+)/,
        /const\s+(\w+)\s*=\s*(?:async\s*)?\(/,
        /(\w+)\s*\([^)]*\)\s*{/,
        /(\w+)\s*=\s*\([^)]*\)\s*=>/,
        /def\s+(\w+)/,  // Python
        /fn\s+(\w+)/,   // Rust
      ]

      for (const pattern of patterns) {
        const match = lineContent.match(pattern)
        if (match) {
          return match[1]
        }
      }
    }

    return undefined
  }

  /**
   * Extract imports from code
   */
  private extractImports(content: string): string[] {
    const imports: string[] = []
    const lines = content.split('\n')

    for (const line of lines.slice(0, 50)) {  // Only check first 50 lines
      if (line.match(/^import\s+/) || line.match(/^from\s+/) || line.match(/^const\s+.*=\s*require/)) {
        imports.push(line.trim())
      }
    }

    return imports
  }

  /**
   * Format display text (truncate if too long)
   */
  private formatDisplayText(text: string, maxLength: number = 100): string {
    const firstLine = text.split('\n')[0]
    if (firstLine.length <= maxLength) {
      return firstLine
    }
    return firstLine.substring(0, maxLength - 3) + '...'
  }

  /**
   * Validate context has required fields
   */
  validateContext(context: CompletionContext): boolean {
    return !!(
      context.filePath &&
      context.fileContent !== undefined &&
      context.cursorPosition &&
      typeof context.cursorPosition.line === 'number' &&
      typeof context.cursorPosition.column === 'number' &&
      Array.isArray(context.openFiles)
    )
  }
}

// Export singleton instance
export const completionService = new CompletionService()

// Export utilities for testing
export { debounce, analyzeImports, getLanguageFromPath }
