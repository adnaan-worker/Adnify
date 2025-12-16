import { useRef, useCallback, useEffect, useState } from 'react'
import MonacoEditor, { DiffEditor, OnMount, loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { X, Circle, AlertTriangle, AlertCircle, RefreshCw, FileCode, ChevronRight, Home } from 'lucide-react'
import { useStore } from '../store'
import { t } from '../i18n'
import DiffViewer from './DiffViewer'
import InlineEdit from './InlineEdit'
import { lintService } from '../agent/lintService'
import { streamingEditService } from '../agent/streamingEditService'
import { LintError, StreamingEditState } from '../agent/toolTypes'
import { completionService } from '../services/completionService'
import { createGhostTextManager, GhostTextManager } from './GhostTextWidget'

// Configure Monaco to load from CDN
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs'
  }
})

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
  const fileName = path.split(/[/\\]/).pop()?.toLowerCase() || ''

  // 特殊文件名
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'makefile'
  if (fileName.startsWith('.env')) return 'ini'

  const ext = fileName.split('.').pop() || ''
  return LANGUAGE_MAP[ext] || 'plaintext'
}

export default function Editor() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, updateFileContent, markFileSaved, language } = useStore()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const ghostTextRef = useRef<GhostTextManager | null>(null)

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

  // AI 代码补全状态
  const [completionEnabled] = useState(true)

  const activeFile = openFiles.find(f => f.path === activeFilePath)
  const activeLanguage = activeFile ? getLanguage(activeFile.path) : 'plaintext'

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // 配置 TypeScript/JavaScript 编译选项
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.React,
      allowJs: true,
      checkJs: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      allowSyntheticDefaultImports: true,
    })

    // 添加快捷键... (保留原有逻辑)
    // Ctrl+D: 选择下一个匹配
    editor.addAction({
      id: 'select-next-occurrence',
      label: 'Select Next Occurrence',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD],
      run: (ed) => {
        ed.getAction('editor.action.addSelectionToNextFindMatch')?.run()
      }
    })

    // Ctrl+/: 切换注释
    editor.addAction({
      id: 'toggle-comment',
      label: 'Toggle Comment',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      run: (ed) => {
        ed.getAction('editor.action.commentLine')?.run()
      }
    })

    // Ctrl+Shift+K: 删除行
    editor.addAction({
      id: 'delete-line',
      label: 'Delete Line',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyK],
      run: (ed) => {
        ed.getAction('editor.action.deleteLines')?.run()
      }
    })
    
     // Shift+Alt+F: 格式化文档
    editor.addAction({
      id: 'format-document',
      label: 'Format Document',
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: (ed) => {
        ed.getAction('editor.action.formatDocument')?.run()
      }
    })

    // F2: 重命名符号
    editor.addAction({
      id: 'rename-symbol',
      label: 'Rename Symbol',
      keybindings: [monaco.KeyCode.F2],
      run: (ed) => {
        ed.getAction('editor.action.rename')?.run()
      }
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
    
    // Initialize ghost text manager
    ghostTextRef.current = createGhostTextManager(editor)

    // Ctrl+Space: 手动触发补全
    editor.addAction({
      id: 'trigger-ai-completion',
      label: 'Trigger AI Completion',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
      run: () => {
        if (!completionEnabled) return
        triggerCompletion(editor)
      }
    })

    // Tab: 接受补全建议
    editor.addCommand(monaco.KeyCode.Tab, () => {
      if (ghostTextRef.current?.isShowing()) {
        ghostTextRef.current.accept()
      } else {
        // 默认 Tab 行为
        editor.trigger('keyboard', 'tab', {})
      }
    })

    // Escape: 取消补全建议
    editor.addCommand(monaco.KeyCode.Escape, () => {
      if (ghostTextRef.current?.isShowing()) {
        ghostTextRef.current.hide()
        completionService.cancel()
      } else {
        // 默认 Escape 行为
        editor.trigger('keyboard', 'escape', {})
      }
    })

    // 监听内容变化，自动触发补全
    editor.onDidChangeModelContent((e) => {
      if (!completionEnabled) return
      
      // 检查是否应该触发补全
      const changes = e.changes
      if (changes.length > 0) {
        const lastChange = changes[changes.length - 1]
        const insertedText = lastChange.text
        
        // 如果是单字符输入且是触发字符
        if (insertedText.length === 1 && completionService.shouldTrigger(insertedText)) {
          triggerCompletion(editor)
        } else if (insertedText.length > 0 && !insertedText.includes('\n')) {
          // 普通输入也触发（带 debounce）
          triggerCompletion(editor)
        } else {
          // 换行或删除时隐藏补全
          ghostTextRef.current?.hide()
          completionService.cancel()
        }
      }
    })

    // 光标移动时隐藏补全
    editor.onDidChangeCursorPosition(() => {
      // 只在有补全显示时隐藏
      if (ghostTextRef.current?.isShowing()) {
        ghostTextRef.current.hide()
        completionService.cancel()
      }
    })

    // 设置补全回调
    completionService.onCompletion((result) => {
      if (!result || result.suggestions.length === 0) return
      
      const suggestion = result.suggestions[0]
      const position = editor.getPosition()
      if (position && ghostTextRef.current) {
        ghostTextRef.current.show(suggestion.text, position)
      }
    })

    completionService.onError((error) => {
      console.error('Completion error:', error)
    })
  }

  // 触发补全的辅助函数
  const triggerCompletion = useCallback((ed: editor.IStandaloneCodeEditor) => {
    const model = ed.getModel()
    const position = ed.getPosition()
    if (!model || !position || !activeFilePath) return

    const context = completionService.buildContext(
      activeFilePath,
      model.getValue(),
      { line: position.lineNumber - 1, column: position.column - 1 }
    )

    completionService.requestCompletion(context)
  }, [activeFilePath])

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
            startLineNumber: err.startLine,
            startColumn: 1,
            endLineNumber: err.endLine,
            endColumn: 1000,
          }))
          monaco.editor.setModelMarkers(model, 'lint', markers)
        }
      }
    } catch (e) {
      console.error('Lint check failed:', e)
    } finally {
      setIsLinting(false)
    }
  }, [activeFilePath])

  // 文件变化时清除 lint 错误和补全
  useEffect(() => {
    setLintErrors([])
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel()
      if (model) {
        monacoRef.current.editor.setModelMarkers(model, 'lint', [])
      }
    }
    // 清除补全状态
    ghostTextRef.current?.hide()
    completionService.cancel()
  }, [activeFilePath])

  // 清理 ghost text manager
  useEffect(() => {
    return () => {
      ghostTextRef.current?.dispose()
      completionService.cancel()
    }
  }, [])

  const handleSave = useCallback(async () => {
    if (activeFile) {
      const success = await window.electronAPI.writeFile(activeFile.path, activeFile.content)
      if (success) {
        markFileSaved(activeFile.path)
      }
    }
  }, [activeFile, markFileSaved])

  // Keyboard shortcut for save
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  // Breadcrumb path generation
  const getBreadcrumbs = (path: string) => {
      // Very simple: just split path. 
      // In a real app, you'd make this relative to workspace root.
      const parts = path.split(/[/\\]/)
      // Show last 3 parts max to avoid clutter
      return parts.slice(-4)
  }

  if (openFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
        {/* Background Decoration */}
        <div className="absolute inset-0 bg-gradient-to-br from-purple-900/10 via-background to-background pointer-events-none" />
        
        <div className="flex-1 flex items-center justify-center relative z-10">
          <div className="text-center">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 border border-white/5 flex items-center justify-center backdrop-blur-sm shadow-glow">
               <FileCode className="w-10 h-10 text-accent opacity-80" />
            </div>
            <h2 className="text-xl font-medium text-text-primary mb-2 tracking-tight">{t('welcome', language)}</h2>
            <p className="text-text-muted text-sm">{t('welcomeDesc', language)}</p>
            
            <div className="mt-8 flex flex-col gap-2 text-xs text-text-muted opacity-60">
                 <p><kbd className="font-mono bg-surface px-1.5 py-0.5 rounded border border-border-subtle">Ctrl+P</kbd> {t('searchFile', language)}</p>
                 <p><kbd className="font-mono bg-surface px-1.5 py-0.5 rounded border border-border-subtle">Ctrl+Shift+P</kbd> {t('commandPalette', language)}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-background" onKeyDown={handleKeyDown}>
      {/* Tabs */}
      <div className="h-10 flex items-center bg-background-secondary border-b border-border-subtle overflow-hidden select-none">
        <div className="flex items-center flex-1 overflow-x-auto no-scrollbar h-full">
          {openFiles.map((file) => {
            const fileName = file.path.split(/[/\\]/).pop()
            const isActive = file.path === activeFilePath
            return (
              <div
                key={file.path}
                onClick={() => setActiveFile(file.path)}
                className={`
                  flex items-center gap-2 px-4 h-full cursor-pointer
                  transition-all group min-w-[120px] max-w-[200px] border-r border-border-subtle/30
                  ${isActive 
                    ? 'bg-background text-text-primary border-t-2 border-t-accent' 
                    : 'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text-primary border-t-2 border-t-transparent'}
                `}
              >
                <FileCode className={`w-3.5 h-3.5 opacity-70 ${isActive ? 'text-accent' : ''}`} />
                <span className="truncate text-xs flex-1">{fileName}</span>
                {file.isDirty && (
                   <Circle className="w-2 h-2 fill-accent text-transparent mr-1" />
                )}
                <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeFile(file.path)
                    }}
                    className={`p-0.5 rounded hover:bg-surface-active opacity-0 group-hover:opacity-100 transition-opacity ${isActive ? 'opacity-100' : ''}`}
                  >
                    <X className="w-3 h-3 text-text-muted" />
                </button>
              </div>
            )
          })}
        </div>

        {/* Lint 状态和按钮 */}
        {activeFile && (
          <div className="flex items-center gap-2 px-3 flex-shrink-0 bg-background-secondary h-full border-l border-border-subtle">
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
          <div className="h-6 flex items-center px-4 bg-background border-b border-border-subtle/50 text-[11px] text-text-muted select-none">
              <div className="flex items-center gap-1 opacity-70">
                  <Home className="w-3 h-3" />
                  <span className="mx-1 opacity-30">/</span>
                  {getBreadcrumbs(activeFile.path).map((part, i, arr) => (
                      <div key={i} className="flex items-center">
                          <span className={i === arr.length - 1 ? 'text-text-primary font-medium' : ''}>{part}</span>
                          {i < arr.length - 1 && <ChevronRight className="w-3 h-3 mx-1 opacity-30" />}
                      </div>
                  ))}
              </div>
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
          activeFile.originalContent ? (
            <DiffEditor
                height="100%"
                language={activeLanguage}
                original={activeFile.originalContent}
                modified={activeFile.content}
                theme="vs-dark"
                onMount={(editor, monaco) => {
                    // Hook up the modified editor to our existing refs so commands work
                    const modifiedEditor = editor.getModifiedEditor()
                    editorRef.current = modifiedEditor
                    monacoRef.current = monaco
                    
                    // Listen for changes
                    modifiedEditor.onDidChangeModelContent(() => {
                        const value = modifiedEditor.getValue()
                        updateFileContent(activeFile.path, value)
                    })
                }}
                options={{
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
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
            language={activeLanguage}
            value={activeFile.content}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={(value) => {
              if (value !== undefined) {
                updateFileContent(activeFile.path, value)
              }
            }}
            loading={
              <div className="flex items-center justify-center h-full">
                <div className="text-text-muted text-sm">{t('loading', language)}</div>
              </div>
            }
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
              fontLigatures: true,
              minimap: { enabled: true, scale: 1, renderCharacters: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              padding: { top: 16 },
              lineNumbers: 'on',
              renderLineHighlight: 'all',
              bracketPairColorization: { enabled: true },
              automaticLayout: true,
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
            }}
          />
          )
        )}
      </div>
    </div>
  )
}
