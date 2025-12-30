import { logger } from '@utils/Logger'
import { useRef, useCallback, useEffect, useState } from 'react'
import MonacoEditor, { DiffEditor, OnMount, BeforeMount, loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { FileCode, X, ChevronRight, AlertCircle, AlertTriangle, RefreshCw, Home, Eye, Edit, Columns } from 'lucide-react'
import { useStore } from '@store'
import { useAgent } from '@hooks/useAgent'
import { t } from '@renderer/i18n'
import { getFileName, getPathSeparator } from '@utils/pathUtils'
import { toast } from '../common/ToastProvider'
import DiffViewer from './DiffViewer'
import InlineEdit from './InlineEdit'
import EditorContextMenu from './EditorContextMenu'
import { lintService } from '@renderer/agent/services/lintService'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import { LintError, StreamingEditState } from '@/renderer/agent/types'
import { completionService } from '@services/completionService'
import { getFileType, MarkdownPreview, ImagePreview, UnsupportedFile, isPlanFile } from './FilePreview'
import { PlanPreview } from '../agent/PlanPreview'

import { initMonacoTypeService } from '@services/monacoTypeService'
import {
  startLspServer,
  didOpenDocument,
  didChangeDocument,
  goToDefinition,
  lspUriToPath,
  onDiagnostics,
} from '@services/lspService'
import { registerLspProviders } from '@services/lspProviders'
import { getFileInfo, getLargeFileEditorOptions, getLargeFileWarning } from '@services/largeFileService'
import { pathLinkService } from '@services/pathLinkService'
import { getEditorConfig } from '@renderer/config/editorConfig'
import { keybindingService } from '@services/keybindingService'
// 导入 Monaco worker 配置
import { monaco } from '@renderer/monacoWorker'
// 导入编辑器配置
import type { ThemeName } from '@store/slices/themeSlice'
import { themes } from './ThemeManager'

// 配置 Monaco 使用本地安装的版本（支持国际化）
// monaco-editor-nls 插件会在构建时注入语言包
loader.config({ monaco })

// 语言映射
const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript / TypeScript
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  // Web
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', css: 'css', scss: 'scss', less: 'scss',
  // Python
  py: 'python', pyw: 'python', pyi: 'python',
  // Java
  java: 'java', jar: 'java', class: 'java',
  // C / C++
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  // C#
  cs: 'csharp', csx: 'csharp',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  // Ruby
  rb: 'ruby', erb: 'ruby',
  // PHP
  php: 'php',
  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  // PowerShell
  ps1: 'powershell', psm1: 'powershell',
  // Data / Config
  json: 'json', jsonc: 'json',
  xml: 'xml', svg: 'xml', xaml: 'xml',
  yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', env: 'ini', conf: 'ini', properties: 'ini',
  md: 'markdown', mdx: 'markdown',
  sql: 'sql',
  // Mobile
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  dart: 'dart',
  // Others
  lua: 'lua',
  r: 'r',
  pl: 'perl', pm: 'perl',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure',
  scala: 'scala', sc: 'scala',
  groovy: 'groovy', gradle: 'groovy',
  m: 'objective-c', mm: 'objective-c',
  hs: 'haskell',
  ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hr: 'erlang',
  fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp',
  v: 'verilog', vh: 'verilog',
  coffee: 'coffeescript',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  bat: 'bat', cmd: 'bat',
  diff: 'diff', patch: 'diff',
}

const getLanguage = (path: string): string => {
  const fileName = getFileName(path).toLowerCase()

  // 特殊文件名
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'makefile'
  if (fileName.startsWith('.env')) return 'ini'

  const ext = fileName.split('.').pop() || ''
  return LANGUAGE_MAP[ext] || 'plaintext'
}

// RGB 字符串转 Hex
const rgbToHex = (rgbStr: string) => {
  const [r, g, b] = rgbStr.split(' ').map(Number)
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

// 定义 Monaco 主题（在 beforeMount 中调用，避免白屏）
const defineMonacoTheme = (monacoInstance: typeof import('monaco-editor'), themeName: ThemeName) => {
  const themeVars = themes[themeName] || themes['adnify-dark']
  if (!themeVars) return

  const bg = rgbToHex(themeVars['--background'])
  const surface = rgbToHex(themeVars['--surface'])
  const text = rgbToHex(themeVars['--text-primary'])
  const textMuted = rgbToHex(themeVars['--text-muted'])
  const border = rgbToHex(themeVars['--border'])
  const accent = rgbToHex(themeVars['--accent'])
  const selection = accent + '40'

  monacoInstance.editor.defineTheme('adnify-dynamic', {
    base: themeName === 'dawn' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: textMuted.slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: accent.slice(1) },
      { token: 'string', foreground: 'a5d6ff' },
      { token: 'number', foreground: 'ffc600' },
      { token: 'type', foreground: '4ec9b0' },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': text,
      'editor.lineHighlightBackground': surface,
      'editorCursor.foreground': accent,
      'editorWhitespace.foreground': border,
      'editorIndentGuide.background': border,
      'editor.selectionBackground': selection,
      'editorLineNumber.foreground': textMuted,
      'editorLineNumber.activeForeground': text,
      'editorWidget.background': surface,
      'editorWidget.border': border,
      'editorSuggestWidget.background': surface,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.selectedBackground': accent + '20',
      'editorHoverWidget.background': surface,
      'editorHoverWidget.border': border,
    }
  })
}

/**
 * 安全的 DiffEditor 包装组件
 * 解决 Monaco DiffEditor 在卸载时 TextModel 被提前销毁的问题
 */
interface SafeDiffEditorProps {
  original: string | undefined
  modified: string | undefined
  language: string
  options?: editor.IDiffEditorConstructionOptions
  onMount?: (editor: editor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => void
}

function SafeDiffEditor({ original, modified, language, options, onMount }: SafeDiffEditorProps) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)

  // 在组件卸载时安全清理
  useEffect(() => {
    return () => {
      if (diffEditorRef.current) {
        try {
          // 先获取 models
          const originalModel = diffEditorRef.current.getOriginalEditor()?.getModel()
          const modifiedModel = diffEditorRef.current.getModifiedEditor()?.getModel()
          
          // 设置空 model 避免 dispose 时的错误
          diffEditorRef.current.setModel(null)
          
          // 然后 dispose models
          originalModel?.dispose()
          modifiedModel?.dispose()
        } catch (e) {
          // 忽略清理时的错误
        }
        diffEditorRef.current = null
      }
    }
  }, [])

  const handleMount = useCallback((editor: editor.IStandaloneDiffEditor, monacoInstance: typeof import('monaco-editor')) => {
    diffEditorRef.current = editor
    onMount?.(editor, monacoInstance)
  }, [onMount])

  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={modified}
      theme="adnify-dynamic"
      options={options}
      onMount={handleMount}
    />
  )
}

export default function Editor() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, updateFileContent, markFileSaved, language, activeDiff, setActiveDiff, setCursorPosition, setIsLspReady } = useStore()
  const { pendingChanges, acceptChange, undoChange } = useAgent()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)

  // beforeMount 回调：在编辑器挂载前定义主题，避免白屏
  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    const { currentTheme } = useStore.getState() as { currentTheme: ThemeName }
    defineMonacoTheme(monacoInstance, currentTheme)
    initMonacoTypeService(monacoInstance)
  }

  // Lint 错误状态
  const [lintErrors, setLintErrors] = useState<LintError[]>([])
  const [isLinting, setIsLinting] = useState(false)

  // 流式编辑预览状态
  const [streamingEdit, setStreamingEdit] = useState<StreamingEditState | null>(null)
  const [showDiffPreview, setShowDiffPreview] = useState(false)

  // 内联编辑状态 (Cmd+K)
  const [inlineEditState, setInlineEditState] = useState<{
    show: boolean
    position: { x: number; y: number }
    selectedCode: string
    lineRange: [number, number]
  } | null>(null)

  // AI 代码补全状态 - 从配置读取


  // 自定义右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Tab 右键菜单状态
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)

  const activeFile = openFiles.find((f: { path: string }) => f.path === activeFilePath)
  const activeLanguage = activeFile ? getLanguage(activeFile.path) : 'plaintext'

  // 文件类型检测
  const activeFileType = activeFile ? getFileType(activeFile.path) : 'text'

  // Markdown 预览模式状态
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'preview' | 'split'>('edit')

  // 检测大文件
  const activeFileInfo = activeFile ? getFileInfo(activeFile.path, activeFile.content) : null

  // 监听主题变化并更新 Monaco 主题
  const currentTheme = useStore((state) => state.currentTheme) as ThemeName
  const workspacePath = useStore((state) => state.workspacePath)
  const isLspReady = useStore((state) => state.isLspReady)

  // 监听 workspacePath 变化，启动 LSP 服务器
  useEffect(() => {
    if (workspacePath && !isLspReady) {
      logger.ui.info('[Editor] workspacePath changed, starting LSP server:', workspacePath)
      startLspServer(workspacePath).then((success) => {
        if (success) {
          logger.ui.info('[Editor] LSP server started (from workspacePath change)')
          setIsLspReady(true)
        } else {
          logger.ui.warn('[Editor] LSP server failed to start')
        }
      })
    }
  }, [workspacePath, isLspReady, setIsLspReady])

  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      defineMonacoTheme(monacoRef.current, currentTheme)
      monacoRef.current.editor.setTheme('adnify-dynamic')
    }
  }, [currentTheme])



  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // Track cursor position
    editor.onDidChangeCursorPosition((e) => {
      if (cursorDebounceRef.current) clearTimeout(cursorDebounceRef.current)
      cursorDebounceRef.current = setTimeout(() => {
        setCursorPosition({ line: e.position.lineNumber, column: e.position.column })
      }, 100)
    })

    // Track selection changes - for slash commands and other features
    editor.onDidChangeCursorSelection((e) => {
      const model = editor.getModel()
      if (model && e.selection && !e.selection.isEmpty()) {
        const selectedText = model.getValueInRange(e.selection)
        useStore.getState().setSelectedCode(selectedText)
      } else {
        useStore.getState().setSelectedCode('')
      }
    })



    // 注册所有 LSP 提供者（hover、completion、signature help 等）
    registerLspProviders(monaco)

    // 主题已在 beforeMount 中定义，这里只需设置
    monaco.editor.setTheme('adnify-dynamic')

    // 启动 LSP 服务器（异步）
    const { workspacePath } = useStore.getState()
    if (workspacePath) {
      startLspServer(workspacePath).then((success) => {
        if (success) {
          logger.ui.info('[Editor] LSP server started')
          setIsLspReady(true)
          // 通知 LSP 当前文件已打开
          const currentFile = useStore.getState().openFiles.find(
            (f: { path: string }) => f.path === useStore.getState().activeFilePath
          )
          if (currentFile) {
            didOpenDocument(currentFile.path, currentFile.content)
          }
        }
      })
    }

    // 监听 LSP 诊断信息
    const unsubscribeDiagnostics = onDiagnostics((uri, diagnostics) => {
      const model = monaco.editor.getModels().find(m => m.uri.toString() === uri)
      if (model) {
        const markers = diagnostics.map(d => ({
          severity: d.severity === 1 ? monaco.MarkerSeverity.Error
            : d.severity === 2 ? monaco.MarkerSeverity.Warning
              : d.severity === 3 ? monaco.MarkerSeverity.Info
                : monaco.MarkerSeverity.Hint,
          message: d.message,
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
          source: d.source,
          code: d.code?.toString(),
        }))
        monaco.editor.setModelMarkers(model, 'lsp', markers)
      }
    })

    // 清理函数
    editor.onDidDispose(() => {
      unsubscribeDiagnostics()
    })

    // 注册定义提供者 - 使用 LSP 实现跳转到定义
    monaco.languages.registerDefinitionProvider(
      ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
      {
        provideDefinition: async (model, position) => {
          try {
            const filePath = model.uri.fsPath || lspUriToPath(model.uri.toString())
            const result = await goToDefinition(
              filePath,
              position.lineNumber - 1, // LSP 使用 0-based 行号
              position.column - 1
            )

            if (!result) return null

            // LSP 可能返回单个对象或数组，统一处理
            const locations = Array.isArray(result) ? result : [result]
            if (locations.length === 0) return null

            return locations
              .filter((loc: any) => loc && (loc.uri || loc.targetUri)) // 过滤无效结果
              .map((loc: any) => {
                // 处理 Location 和 LocationLink 两种格式
                const uri = loc.uri || loc.targetUri
                const range = loc.range || loc.targetSelectionRange || loc.targetRange

                if (!uri || !range || !range.start) return null

                return {
                  uri: monaco.Uri.parse(uri),
                  range: {
                    startLineNumber: range.start.line + 1,
                    startColumn: range.start.character + 1,
                    endLineNumber: range.end.line + 1,
                    endColumn: range.end.character + 1,
                  },
                }
              })
              .filter(Boolean) as import('monaco-editor').languages.Location[]
          } catch (error) {
            logger.ui.error('[Editor] Definition provider error:', error)
            return null
          }
        },
      }
    )

    // 注册统一的路径链接提供者（支持 JS/TS import、HTML href/src、CSS url() 等）
    const supportedLanguages = [
      'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
      'html', 'htm', 'vue', 'svelte',
      'css', 'scss', 'less',
      'markdown'
    ]
    monaco.languages.registerLinkProvider(supportedLanguages, pathLinkService.createLinkProvider())

    // 监听 Ctrl+Click 事件来处理链接跳转
    editor.onMouseDown((e) => {
      if (!e.event.ctrlKey && !e.event.metaKey) return

      const model = editor.getModel()
      if (!model) return

      const position = e.target.position
      if (!position) return

      const language = model.getLanguageId()
      const content = model.getValue()

      // 使用 pathLinkService 检查点击位置是否在链接上
      const linkPath = pathLinkService.getLinkAtPosition(content, language, position.lineNumber, position.column)
      if (linkPath) {
        const { activeFilePath } = useStore.getState()
        if (activeFilePath) {
          e.event.preventDefault()
          e.event.stopPropagation()
          pathLinkService.handlePathClick(linkPath, activeFilePath)
        }
      }
    })

    // 自定义右键菜单
    editor.onContextMenu((e) => {
      e.event.preventDefault()
      e.event.stopPropagation()
      setContextMenu({ x: e.event.posx, y: e.event.posy })
    })

    // 快捷键绑定（右键菜单使用自定义组件 EditorContextMenu）
    // Ctrl+D: 选择下一个匹配
    editor.addAction({
      id: 'select-next-occurrence',
      label: 'Select Next Occurrence',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      run: (ed) => ed.getAction('editor.action.addSelectionToNextFindMatch')?.run()
    })

    // Ctrl+/: 切换注释
    editor.addAction({
      id: 'toggle-comment',
      label: 'Toggle Line Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: (ed) => ed.getAction('editor.action.commentLine')?.run()
    })

    // Ctrl+Shift+K: 删除行
    editor.addAction({
      id: 'delete-line',
      label: 'Delete Line',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
      run: (ed) => ed.getAction('editor.action.deleteLines')?.run()
    })

    // Cmd+K / Ctrl+K: 内联编辑
    editor.addAction({
      id: 'inline-edit',
      label: 'Inline Edit with AI',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: (ed) => {
        const selection = ed.getSelection()
        if (!selection || selection.isEmpty()) {
          // 如果没有选中，选择当前行
          const position = ed.getPosition()
          if (position) {
            ed.setSelection({
              startLineNumber: position.lineNumber,
              startColumn: 1,
              endLineNumber: position.lineNumber,
              endColumn: ed.getModel()?.getLineMaxColumn(position.lineNumber) || 1
            })
          }
        }

        const newSelection = ed.getSelection()
        if (newSelection && !newSelection.isEmpty()) {
          const model = ed.getModel()
          if (model) {
            const selectedText = model.getValueInRange(newSelection)
            const editorDomNode = ed.getDomNode()
            const coords = ed.getScrolledVisiblePosition(newSelection.getStartPosition())

            if (editorDomNode && coords) {
              const rect = editorDomNode.getBoundingClientRect()
              setInlineEditState({
                show: true,
                position: {
                  x: rect.left + coords.left,
                  y: rect.top + coords.top + 20
                },
                selectedCode: selectedText,
                lineRange: [newSelection.startLineNumber, newSelection.endLineNumber]
              })
            }
          }
        }
      }
    })

    // ============ AI Code Completion Integration ============

    // 注册 Inline Completions Provider (Monaco 原生支持)
    const providerDispose = monaco.languages.registerInlineCompletionsProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'html', 'css', 'json', 'python', 'java', 'go', 'rust'],
      {
        provideInlineCompletions: async (model, position, _context, token) => {
          if (!getEditorConfig().ai?.completionEnabled) return { items: [] }

          // Debounce: wait 300ms
          await new Promise(resolve => setTimeout(resolve, 300))
          if (token.isCancellationRequested) return { items: [] }

          const completionContext = completionService.buildContext(
            activeFilePath || model.uri.fsPath,
            model.getValue(),
            { line: position.lineNumber - 1, column: position.column - 1 }
          )

          // Create AbortController linked to token
          const abortController = new AbortController()
          token.onCancellationRequested(() => abortController.abort())

          try {
            const result = await completionService.getCompletions(completionContext, abortController.signal)
            if (!result || result.suggestions.length === 0) return { items: [] }

            return {
              items: result.suggestions.map(s => ({
                insertText: s.text,
                range: new monaco.Range(
                  position.lineNumber, position.column,
                  position.lineNumber, position.column
                )
              }))
            }
          } catch (e) {
            return { items: [] }
          }
        },
        freeInlineCompletions(_completions) { }
      }
    )

    // Dispose provider on unmount
    editor.onDidDispose(() => {
      providerDispose.dispose()
    })
  }

  // 监听流式编辑
  useEffect(() => {
    if (!activeFilePath) return

    const activeEdit = streamingEditService.getActiveEditForFile(activeFilePath)
    if (activeEdit) {
      setStreamingEdit(activeEdit.state)
      setShowDiffPreview(true)

      const unsubscribe = streamingEditService.subscribe(activeEdit.editId, (state) => {
        setStreamingEdit(state)
        if (state.isComplete) {
          // 编辑完成后延迟关闭预览
          setTimeout(() => setShowDiffPreview(false), 500)
        }
      })

      return unsubscribe
    } else {
      setStreamingEdit(null)
      setShowDiffPreview(false)
    }
  }, [activeFilePath])

  // 运行 Lint 检查
  const runLintCheck = useCallback(async () => {
    if (!activeFilePath) return

    setIsLinting(true)
    try {
      const errors = await lintService.getLintErrors(activeFilePath, true)
      setLintErrors(errors)

      // 在编辑器中显示错误标记
      if (editorRef.current && monacoRef.current) {
        const monaco = monacoRef.current
        const model = editorRef.current.getModel()
        if (model) {
          const markers = errors.map(err => ({
            severity: err.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
            message: `[${err.code}] ${err.message}`,
            startLineNumber: err.startLine ?? 1,
            startColumn: 1,
            endLineNumber: err.endLine ?? 1,
            endColumn: 1000,
          }))
          monaco.editor.setModelMarkers(model, 'lint', markers)
        }
      }
    } catch (e) {
      logger.ui.error('Lint check failed:', e)
    } finally {
      setIsLinting(false)
    }
  }, [activeFilePath])

  // 文件变化时清除状态
  // 文件切换时的处理
  useEffect(() => {
    setLintErrors([])

    // 清除补全状态
    completionService.cancel()

    // 通知 LSP 服务器当前文件已打开
    if (activeFile) {
      didOpenDocument(activeFile.path, activeFile.content)
    }
  }, [activeFilePath, activeFile])

  // 清理 ghost text manager
  useEffect(() => {
    return () => {
      completionService.cancel()
    }
  }, [])

  // 监听跳转到行事件（从 Problems 面板或 Outline 视图触发）
  useEffect(() => {
    const handleGotoLine = (e: CustomEvent<{ line: number; column: number }>) => {
      if (editorRef.current) {
        const { line, column } = e.detail
        editorRef.current.revealLineInCenter(line)
        editorRef.current.setPosition({ lineNumber: line, column })
        editorRef.current.focus()
      }
    }

    window.addEventListener('editor:goto-line', handleGotoLine as EventListener)
    return () => {
      window.removeEventListener('editor:goto-line', handleGotoLine as EventListener)
    }
  }, [])

  // 监听选区替换事件
  useEffect(() => {
    const handleReplaceSelection = (e: CustomEvent<{
      query: string
      replaceQuery: string
      isRegex: boolean
      isCaseSensitive: boolean
      isWholeWord: boolean
    }>) => {
      if (!editorRef.current) return
      const editor = editorRef.current
      const model = editor.getModel()
      const selection = editor.getSelection()

      if (!model || !selection || selection.isEmpty()) return

      const { query, replaceQuery, isRegex, isCaseSensitive, isWholeWord } = e.detail
      const selectedText = model.getValueInRange(selection)
      let newText = selectedText

      try {
        if (isRegex) {
          const flags = isCaseSensitive ? 'g' : 'gi'
          const regex = new RegExp(query, flags)
          newText = selectedText.replace(regex, replaceQuery)
        } else {
          const flags = isCaseSensitive ? 'g' : 'gi'
          const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const regex = isWholeWord
            ? new RegExp(`\\b${escapedQuery}\\b`, flags)
            : new RegExp(escapedQuery, flags)
          newText = selectedText.replace(regex, replaceQuery)
        }

        if (newText !== selectedText) {
          editor.pushUndoStop()
          editor.executeEdits('replace-selection', [{
            range: selection,
            text: newText,
            forceMoveMarkers: true
          }])
          editor.pushUndoStop()
        }
      } catch (error) {
        logger.ui.error('Replace in selection failed:', error)
      }
    }

    window.addEventListener('editor:replace-selection', handleReplaceSelection as EventListener)
    return () => {
      window.removeEventListener('editor:replace-selection', handleReplaceSelection as EventListener)
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (activeFile && editorRef.current) {
      try {
        const config = getEditorConfig()
        
        // 保存时格式化
        if (config.formatOnSave) {
          const formatAction = editorRef.current.getAction('editor.action.formatDocument')
          if (formatAction) {
            await formatAction.run()
          }
        }
        
        // 获取最新内容（格式化后）
        const content = editorRef.current.getValue()
        
        const success = await window.electronAPI.writeFile(activeFile.path, content)
        if (success) {
          // 更新 store 中的内容（如果格式化了）
          if (config.formatOnSave && content !== activeFile.content) {
            updateFileContent(activeFile.path, content)
          }
          markFileSaved(activeFile.path)
          toast.success(
            language === 'zh' ? '文件已保存' : 'File Saved',
            getFileName(activeFile.path)
          )
        } else {
          toast.error(
            language === 'zh' ? '保存失败' : 'Save Failed',
            language === 'zh' ? '无法写入文件' : 'Could not write to file'
          )
        }
      } catch (error) {
        toast.error(
          language === 'zh' ? '保存失败' : 'Save Failed',
          String(error)
        )
      }
    }
  }, [activeFile, markFileSaved, language, updateFileContent])

  // 自动保存处理
  const triggerAutoSave = useCallback((filePath: string) => {
    const config = getEditorConfig()
    if (config.autoSave === 'off') return
    
    // 清除之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    
    if (config.autoSave === 'afterDelay') {
      autoSaveTimerRef.current = setTimeout(async () => {
        const file = openFiles.find((f: { path: string; isDirty?: boolean }) => f.path === filePath)
        if (file?.isDirty) {
          const success = await window.electronAPI.writeFile(file.path, file.content)
          if (success) {
            markFileSaved(file.path)
          }
        }
      }, config.autoSaveDelay)
    }
  }, [openFiles, markFileSaved])

  // 失去焦点时自动保存
  useEffect(() => {
    const config = getEditorConfig()
    if (config.autoSave !== 'onFocusChange') return
    
    const handleBlur = async () => {
      // 保存所有脏文件
      for (const file of openFiles) {
        if ((file as any).isDirty) {
          const success = await window.electronAPI.writeFile(file.path, file.content)
          if (success) {
            markFileSaved(file.path)
          }
        }
      }
    }
    
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [openFiles, markFileSaved])

  // 清理自动保存定时器
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [])

  // 保存指定文件
  const saveFile = useCallback(async (filePath: string) => {
    const file = openFiles.find((f: { path: string }) => f.path === filePath)
    if (file) {
      try {
        const success = await window.electronAPI.writeFile(file.path, file.content)
        if (success) {
          markFileSaved(file.path)
          toast.success(
            language === 'zh' ? '文件已保存' : 'File Saved',
            getFileName(file.path)
          )
        } else {
          toast.error(
            language === 'zh' ? '保存失败' : 'Save Failed',
            language === 'zh' ? '无法写入文件' : 'Could not write to file'
          )
        }
        return success
      } catch (error) {
        toast.error(
          language === 'zh' ? '保存失败' : 'Save Failed',
          String(error)
        )
        return false
      }
    }
    return false
  }, [openFiles, markFileSaved, language])

  // 关闭文件（带保存提示）
  const handleCloseFile = useCallback(async (filePath: string) => {
    const file = openFiles.find((f: { path: string; isDirty?: boolean }) => f.path === filePath)
    if (file?.isDirty) {
      const fileName = getFileName(filePath)
      const { globalConfirm } = await import('../common/ConfirmDialog')
      const result = await globalConfirm({
        title: language === 'zh' ? '未保存的更改' : 'Unsaved Changes',
        message: t('confirmUnsavedChanges', language, { name: fileName }),
        confirmText: language === 'zh' ? '保存' : 'Save',
        cancelText: language === 'zh' ? '不保存' : "Don't Save",
        variant: 'warning',
      })
      if (result) {
        await saveFile(filePath)
      }
    }
    closeFile(filePath)
  }, [openFiles, closeFile, saveFile, language])

  // 关闭其他文件
  const closeOtherFiles = useCallback(async (keepPath: string) => {
    for (const file of openFiles) {
      if (file.path !== keepPath) {
        await handleCloseFile(file.path)
      }
    }
  }, [openFiles, handleCloseFile])

  // 关闭所有文件
  const closeAllFiles = useCallback(async () => {
    for (const file of [...openFiles]) {
      await handleCloseFile(file.path)
    }
  }, [openFiles, handleCloseFile])

  // 关闭右侧文件
  const closeFilesToRight = useCallback(async (filePath: string) => {
    const index = openFiles.findIndex((f: { path: string }) => f.path === filePath)
    if (index >= 0) {
      for (let i = openFiles.length - 1; i > index; i--) {
        await handleCloseFile(openFiles[i].path)
      }
    }
  }, [openFiles, handleCloseFile])

  // Keyboard shortcut for save
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e.nativeEvent, 'editor.save')) {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  // Breadcrumb path generation
  const getBreadcrumbs = (path: string) => {
    // 使用 pathUtils 分割路径
    const sep = getPathSeparator(path)
    const parts = path.split(sep === '\\' ? /\\/ : /\//)
    // Show last 3 parts max to avoid clutter
    return parts.slice(-4)
  }

  if (openFiles.length === 0) {
    return (
      <div className="h-full flex flex-col bg-transparent relative overflow-hidden">
        {/* Background Decoration */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent/5 rounded-full blur-[120px] opacity-50" />
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-purple-500/5 rounded-full blur-[100px] opacity-30" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[100px] opacity-30" />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center relative z-10 animate-fade-in p-8">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="relative inline-block mb-6 group">
              <div className="absolute inset-0 bg-accent/20 blur-2xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-surface to-surface-active border border-border-subtle flex items-center justify-center shadow-2xl relative z-10 transform group-hover:scale-105 transition-transform duration-500">
                <FileCode className="w-12 h-12 text-accent" />
              </div>
            </div>

            <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-text-primary to-text-primary/60 mb-3 tracking-tight">
              ADNIFY
            </h1>
            <p className="text-text-muted text-lg font-light tracking-wide opacity-80">
              Advanced AI-Powered Editor
            </p>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
            <button
              onClick={() => useStore.getState().setShowQuickOpen(true)}
              className="group flex items-center justify-between p-4 rounded-xl bg-surface/30 hover:bg-surface/60 border border-border-subtle hover:border-accent/20 transition-all duration-300 backdrop-blur-sm"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                  <FileCode className="w-5 h-5 text-accent" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-text-primary group-hover:text-white transition-colors">
                    {t('searchFile', language)}
                  </div>
                  <div className="text-xs text-text-muted">Search and open files</div>
                </div>
              </div>
              <div className="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                <kbd className="h-6 px-2 rounded bg-surface/50 border border-border-subtle text-[10px] font-mono flex items-center text-text-muted">Ctrl</kbd>
                <kbd className="h-6 px-2 rounded bg-surface/50 border border-border-subtle text-[10px] font-mono flex items-center text-text-muted">P</kbd>
              </div>
            </button>

            <button
              onClick={() => useStore.getState().setShowCommandPalette(true)}
              className="group flex items-center justify-between p-4 rounded-xl bg-surface/30 hover:bg-surface/60 border border-border-subtle hover:border-accent/20 transition-all duration-300 backdrop-blur-sm"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
                  <div className="w-5 h-5 text-purple-400 font-mono font-bold text-center leading-5">{'>'}</div>
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-text-primary group-hover:text-white transition-colors">
                    {t('commandPalette', language)}
                  </div>
                  <div className="text-xs text-text-muted">Run commands</div>
                </div>
              </div>
              <div className="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                <kbd className="h-6 px-2 rounded bg-surface/50 border border-border-subtle text-[10px] font-mono flex items-center text-text-muted">Ctrl</kbd>
                <kbd className="h-6 px-2 rounded bg-surface/50 border border-border-subtle text-[10px] font-mono flex items-center text-text-muted">Shift</kbd>
                <kbd className="h-6 px-2 rounded bg-surface/50 border border-border-subtle text-[10px] font-mono flex items-center text-text-muted">P</kbd>
              </div>
            </button>
          </div>

          {/* Footer Hints */}
          <div className="mt-12 flex items-center gap-8 text-xs text-text-muted/60">
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-surface/50 border border-border-subtle font-mono">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-1.5 py-0.5 rounded bg-surface/50 border border-border-subtle font-mono">,</kbd>
              <span>Settings</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-text-muted/20" />
            <div className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-surface/50 border border-border-subtle font-mono">F12</kbd>
              <span>DevTools</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-transparent" onKeyDown={handleKeyDown}>
      {/* Tabs */}
      <div className="h-9 flex items-center bg-background-secondary/50 border-b border-border-subtle overflow-x-auto custom-scrollbar select-none backdrop-blur-sm">
        {openFiles.map((file: { path: string; isDirty?: boolean }) => {
          const isActive = file.path === activeFilePath
          const fileName = getFileName(file.path)

          return (
            <div
              key={file.path}
              className={`
                group relative flex items-center gap-2 px-3 h-full min-w-[120px] max-w-[200px] cursor-pointer transition-all duration-200 border-r border-white/5
                ${isActive
                  ? 'bg-surface text-text-primary'
                  : 'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary'}
              `}
              onClick={() => setActiveFile(file.path)}
              onContextMenu={(e) => {
                e.preventDefault()
                setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path })
              }}
            >
              {isActive && <div className="absolute top-0 left-0 right-0 h-[2px] bg-accent shadow-[0_0_8px_rgba(var(--accent)/0.5)]" />}

              <span className="text-xs truncate flex-1">{fileName}</span>

              <div className="flex items-center justify-center w-5 h-5 rounded-md hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCloseFile(file.path)
                }}
              >
                {file.isDirty ? (
                  <div className="w-2 h-2 rounded-full bg-accent group-hover:hidden" />
                ) : null}
                <X className={`w-3 h-3 ${file.isDirty ? 'hidden group-hover:block' : 'opacity-0 group-hover:opacity-100'} transition-opacity`} />
              </div>
            </div>
          )
        })}

        {/* Lint 状态和按钮 */}
        {activeFile && (
          <div className="ml-auto flex items-center gap-2 px-3 flex-shrink-0 h-full border-l border-border-subtle bg-background-secondary/50">
            {lintErrors.length > 0 && (
              <div className="flex items-center gap-2 text-xs mr-2">
                {lintErrors.filter(e => e.severity === 'error').length > 0 && (
                  <span className="flex items-center gap-1 text-status-error" title="Errors">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {lintErrors.filter(e => e.severity === 'error').length}
                  </span>
                )}
                {lintErrors.filter(e => e.severity === 'warning').length > 0 && (
                  <span className="flex items-center gap-1 text-status-warning" title="Warnings">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {lintErrors.filter(e => e.severity === 'warning').length}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={runLintCheck}
              disabled={isLinting}
              className="p-1.5 rounded hover:bg-surface-active transition-colors disabled:opacity-50"
              title="Run lint check"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-text-muted ${isLinting ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {/* Breadcrumbs */}
      {activeFile && (
        <div className="h-7 flex items-center px-4 border-b border-border-subtle bg-background/40 backdrop-blur-sm text-[11px] text-text-muted select-none">
          <div className="flex items-center gap-1 hover:text-text-primary transition-colors cursor-pointer">
            <Home className="w-3 h-3" />
          </div>
          <span className="mx-1 opacity-30">/</span>
          {getBreadcrumbs(activeFile.path).map((part, index, arr) => (
            <div key={index} className="flex items-center gap-1">
              <span className={`hover:text-text-primary transition-colors cursor-pointer ${index === arr.length - 1 ? 'text-text-primary font-medium' : ''}`}>
                {part}
              </span>
              {index < arr.length - 1 && <ChevronRight className="w-3 h-3 opacity-30" />}
            </div>
          ))}

          {/* 大文件警告 */}
          {activeFileInfo?.isLarge && (
            <div className="ml-auto flex items-center gap-1 text-status-warning">
              <AlertTriangle className="w-3 h-3" />
              <span>{getLargeFileWarning(activeFileInfo, language)}</span>
            </div>
          )}
        </div>
      )}

      {/* 流式编辑预览 */}
      {showDiffPreview && streamingEdit && activeFile && (
        <div className="border-b border-border-subtle h-1/2">
          <DiffViewer
            originalContent={streamingEdit.originalContent}
            modifiedContent={streamingEdit.currentContent}
            filePath={streamingEdit.filePath}
            isStreaming={!streamingEdit.isComplete}
            onAccept={() => {
              updateFileContent(activeFile.path, streamingEdit.currentContent)
              setShowDiffPreview(false)
            }}
            onReject={() => {
              setShowDiffPreview(false)
            }}
            onClose={() => setShowDiffPreview(false)}
          />
        </div>
      )}

      {/* Chat 工具调用 Diff 预览 - 使用 Monaco DiffEditor */}
      {activeDiff && (() => {
        // 检查是否在 pendingChanges 中（决定是否显示操作按钮）
        const isPendingChange = pendingChanges.some(c => c.filePath === activeDiff.filePath)

        // 安全关闭 Diff 预览（延迟执行避免模型销毁问题）
        const closeDiff = () => {
          setTimeout(() => setActiveDiff(null), 0)
        }

        return (
          <div className="absolute inset-0 z-50 flex flex-col bg-background">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface/50">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-accent" />
                <span className="text-sm font-medium text-text-primary">
                  {activeDiff.filePath.split(/[\\/]/).pop()}
                </span>
                <span className="text-xs text-text-muted">
                  {activeDiff.original ? 'Modified' : 'New File'}
                </span>
                {isPendingChange && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/20 text-amber-400 rounded">
                    Pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeDiff}
                  className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-active rounded-md transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Monaco Diff Editor */}
            <div className="flex-1">
              <SafeDiffEditor
                key={`diff-${activeDiff.filePath}-${activeDiff.original?.length || 0}-${activeDiff.modified?.length || 0}`}
                language={getLanguage(activeDiff.filePath)}
                original={activeDiff.original}
                modified={activeDiff.modified}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  lineNumbers: 'on',
                  glyphMargin: false,
                  folding: true,
                  lineDecorationsWidth: 0,
                  lineNumbersMinChars: 3,
                }}
              />
            </div>

            {/* Footer Actions - 只有待确认的更改才显示接受/拒绝按钮 */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle bg-surface/50">
              {isPendingChange ? (
                <>
                  <button
                    onClick={async () => {
                      await undoChange(activeDiff.filePath)
                      closeDiff()
                    }}
                    className="px-4 py-2 text-sm font-medium text-text-muted hover:text-status-error hover:bg-status-error/10 rounded-md transition-colors"
                  >
                    {t('rejectChanges', language)}
                  </button>
                  <button
                    onClick={() => {
                      acceptChange(activeDiff.filePath)
                      updateFileContent(activeDiff.filePath, activeDiff.modified)
                      closeDiff()
                    }}
                    className="px-4 py-2 text-sm font-medium bg-status-success text-white hover:bg-status-success/90 rounded-md transition-colors"
                  >
                    {t('acceptChanges', language)}
                  </button>
                </>
              ) : (
                <button
                  onClick={closeDiff}
                  className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-active rounded-md transition-colors"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* 内联编辑弹窗 (Cmd+K) */}
      {inlineEditState?.show && activeFile && (
        <InlineEdit
          position={inlineEditState.position}
          selectedCode={inlineEditState.selectedCode}
          filePath={activeFile.path}
          lineRange={inlineEditState.lineRange}
          onClose={() => setInlineEditState(null)}
          onApply={(newCode) => {
            // 替换选中的代码
            if (editorRef.current) {
              const selection = editorRef.current.getSelection()
              if (selection) {
                editorRef.current.executeEdits('inline-edit', [{
                  range: selection,
                  text: newCode,
                  forceMoveMarkers: true
                }])
              }
            }
            setInlineEditState(null)
          }}
        />
      )}

      {/* Editor */}
      <div className="flex-1 relative">
        {activeFile && (
          <>
            {/* Markdown 工具栏 */}
            {activeFileType === 'markdown' && (
              <div className="absolute top-0 right-0 z-10 flex items-center gap-1 px-2 py-1 bg-surface/80 backdrop-blur-sm rounded-bl-lg border-l border-b border-white/10">
                {!isPlanFile(activeFile.path) && (
                  <>
                    <button
                      onClick={() => setMarkdownMode('edit')}
                      className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'edit' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`}
                      title="编辑模式"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setMarkdownMode('split')}
                      className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'split' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`}
                      title="分屏模式"
                    >
                      <Columns className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setMarkdownMode('preview')}
                  className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'preview' || isPlanFile(activeFile.path) ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`}
                  title="预览模式"
                  disabled={isPlanFile(activeFile.path)}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* 图片文件预览 */}
            {activeFileType === 'image' ? (
              <ImagePreview path={activeFile.path} />
            ) : activeFileType === 'binary' ? (
              /* 二进制文件提示 */
              <UnsupportedFile path={activeFile.path} fileType="binary" />
            ) : activeFileType === 'markdown' && (markdownMode === 'preview' || isPlanFile(activeFile.path)) ? (
              /* Markdown 纯预览模式 或 Plan 文件强制预览 */
              isPlanFile(activeFile.path) ? (
                <PlanPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} filePath={activeFile.path} />
              ) : (
                <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} />
              )
            ) : activeFileType === 'markdown' && markdownMode === 'split' ? (
              /* Markdown 分屏模式 */
              <div className="flex h-full">
                <div className="flex-1 border-r border-white/10">
                  <MonacoEditor
                    height="100%"
                    key={activeFile.path}
                    path={monaco.Uri.file(activeFile.path).toString()}
                    language={activeLanguage}
                    value={activeFile.content}
                    theme="adnify-dynamic"
                    beforeMount={handleBeforeMount}
                    onMount={handleEditorMount}
                    onChange={(value) => {
                      if (value !== undefined) {
                        updateFileContent(activeFile.path, value)
                        didChangeDocument(activeFile.path, value)
                      }
                    }}
                    options={{
                      fontSize: getEditorConfig().fontSize,
                      fontFamily: getEditorConfig().fontFamily,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      padding: { top: 16 },
                      contextmenu: false,
                    }}
                  />
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} />
                </div>
              </div>
            ) : activeFile.originalContent ? (
              <SafeDiffEditor
                language={activeLanguage}
                original={activeFile.originalContent}
                modified={activeFile.content}
                onMount={(editor, monaco) => {
                  const modifiedEditor = editor.getModifiedEditor()
                  editorRef.current = modifiedEditor
                  monacoRef.current = monaco
                  modifiedEditor.onDidChangeModelContent(() => {
                    const value = modifiedEditor.getValue()
                    updateFileContent(activeFile.path, value)
                  })
                }}
                options={{
                  fontSize: getEditorConfig().fontSize,
                  fontFamily: getEditorConfig().fontFamily,
                  fontLigatures: true,
                  renderSideBySide: true,
                  readOnly: false,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                }}
              />
            ) : (
              <MonacoEditor
                height="100%"
                key={activeFile.path}
                path={monaco.Uri.file(activeFile.path).toString()}
                language={activeLanguage}
                value={activeFile.content}
                theme="adnify-dynamic"
                beforeMount={handleBeforeMount}
                onMount={handleEditorMount}
                onChange={(value) => {
                  if (value !== undefined) {
                    updateFileContent(activeFile.path, value)
                    didChangeDocument(activeFile.path, value)
                    triggerAutoSave(activeFile.path)
                  }
                }}
                loading={
                  <div className="flex items-center justify-center h-full">
                    <div className="text-text-muted text-sm">{t('loading', language)}</div>
                  </div>
                }
                options={{
                  fontSize: getEditorConfig().fontSize,
                  fontFamily: getEditorConfig().fontFamily,
                  fontLigatures: true,
                  tabSize: getEditorConfig().tabSize,
                  wordWrap: getEditorConfig().wordWrap,
                  minimap: { enabled: getEditorConfig().minimap, scale: getEditorConfig().minimapScale, renderCharacters: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  padding: { top: 16 },
                  lineNumbers: getEditorConfig().lineNumbers,
                  renderLineHighlight: 'all',
                  bracketPairColorization: { enabled: getEditorConfig().bracketPairColorization },
                  automaticLayout: true,
                  inlineSuggest: { enabled: true },
                  suggest: {
                    showKeywords: true,
                    showSnippets: true,
                    showClasses: true,
                    showFunctions: true,
                    showVariables: true,
                    showModules: true,
                  },
                  quickSuggestions: {
                    other: true,
                    comments: false,
                    strings: true,
                  },
                  parameterHints: { enabled: true },
                  folding: true,
                  foldingStrategy: 'indentation',
                  showFoldingControls: 'mouseover',
                  matchBrackets: 'always',
                  renderWhitespace: 'selection',
                  guides: {
                    bracketPairs: true,
                    indentation: true,
                  },
                  stickyScroll: { enabled: true },
                  inlayHints: { enabled: 'on' },
                  links: true,
                  gotoLocation: {
                    multiple: 'goto',
                    multipleDefinitions: 'goto',
                    multipleTypeDefinitions: 'goto',
                    multipleDeclarations: 'goto',
                    multipleImplementations: 'goto',
                    multipleReferences: 'goto',
                  },
                  contextmenu: false,
                  ...(activeFileInfo ? getLargeFileEditorOptions(activeFileInfo) : {}),
                }}
              />
            )}
          </>
        )}

        {/* 自定义右键菜单 */}
        {contextMenu && editorRef.current && (
          <EditorContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            editor={editorRef.current}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>

      {/* Tab 右键菜单 */}
      {tabContextMenu && (
        <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          filePath={tabContextMenu.filePath}
          onClose={() => setTabContextMenu(null)}
          onCloseFile={handleCloseFile}
          onCloseOthers={closeOtherFiles}
          onCloseAll={closeAllFiles}
          onCloseToRight={closeFilesToRight}
          onSave={saveFile}
          isDirty={openFiles.find((f: { path: string; isDirty?: boolean }) => f.path === tabContextMenu.filePath)?.isDirty || false}
          language={language}
        />
      )}
    </div>
  )
}

// Tab 右键菜单组件
interface TabContextMenuProps {
  x: number
  y: number
  filePath: string
  onClose: () => void
  onCloseFile: (path: string) => void
  onCloseOthers: (path: string) => void
  onCloseAll: () => void
  onCloseToRight: (path: string) => void
  onSave: (path: string) => void
  isDirty: boolean
  language: string
}

function TabContextMenu({
  x, y, filePath, onClose, onCloseFile, onCloseOthers, onCloseAll, onCloseToRight, onSave, isDirty, language
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (keybindingService.matches(e, 'editor.cancel')) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const menuItems = [
    { label: isZh ? '关闭' : 'Close', action: () => onCloseFile(filePath), shortcut: 'Ctrl+W' },
    { label: isZh ? '关闭其他' : 'Close Others', action: () => onCloseOthers(filePath) },
    { label: isZh ? '关闭右侧' : 'Close to the Right', action: () => onCloseToRight(filePath) },
    { label: isZh ? '关闭所有' : 'Close All', action: () => onCloseAll() },
    { type: 'separator' as const },
    { label: isZh ? '保存' : 'Save', action: () => onSave(filePath), shortcut: 'Ctrl+S', disabled: !isDirty },
    { type: 'separator' as const },
    {
      label: isZh ? '复制路径' : 'Copy Path', action: () => {
        navigator.clipboard.writeText(filePath)
        toast.success(isZh ? '已复制路径' : 'Path Copied')
      }
    },
    { label: isZh ? '在资源管理器中显示' : 'Reveal in Explorer', action: () => window.electronAPI.showItemInFolder(filePath) },
  ]

  return (
    <div
      ref={menuRef}
      className="fixed bg-background-secondary border border-border-subtle rounded-lg shadow-xl py-1 z-[9999] min-w-[180px]"
      style={{ left: x, top: y }}
    >
      {menuItems.map((item, index) =>
        item.type === 'separator' ? (
          <div key={index} className="h-px bg-border-subtle my-1" />
        ) : (
          <button
            key={index}
            onClick={() => { item.action?.(); onClose() }}
            disabled={item.disabled}
            className="w-full px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="text-xs text-text-muted ml-4">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  )
}
