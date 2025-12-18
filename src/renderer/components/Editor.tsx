import { useRef, useCallback, useEffect, useState } from 'react'
import MonacoEditor, { DiffEditor, OnMount, loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { X, Circle, AlertTriangle, AlertCircle, RefreshCw, FileCode, ChevronRight, Home } from 'lucide-react'
import { useStore } from '../store'
import { useAgent } from '../hooks/useAgent'
import { t } from '../i18n'
import { getFileName, getPathSeparator } from '../utils/pathUtils'
import { toast } from './Toast'
import DiffViewer from './DiffViewer'
import InlineEdit from './InlineEdit'
import EditorContextMenu from './EditorContextMenu'
import { lintService } from '../agent/lintService'
import { streamingEditService } from '../agent/streamingEditService'
import { LintError, StreamingEditState } from '@/renderer/agent/toolTypes'
import { completionService } from '../services/completionService'
import { createGhostTextManager, GhostTextManager } from './GhostTextWidget'
import { initMonacoTypeService } from '../services/monacoTypeService'
import {
  startLspServer,
  didOpenDocument,
  didChangeDocument,
  goToDefinition,
  lspUriToPath,
  onDiagnostics,
} from '../services/lspService'
import { registerLspProviders } from '../services/lspProviders'
import { getFileInfo, getLargeFileEditorOptions, getLargeFileWarning } from '../services/largeFileService'
import { pathLinkService } from '../services/pathLinkService'
// 导入 Monaco worker 配置
import { monaco } from '../monacoWorker'
// 导入编辑器配置
import { getEditorConfig } from '../config/editorConfig'
import type { ThemeName } from '../store/slices/themeSlice'

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

export default function Editor() {
  const { openFiles, activeFilePath, setActiveFile, closeFile, updateFileContent, markFileSaved, language, activeDiff, setActiveDiff } = useStore()
  const { pendingChanges, acceptChange, undoChange } = useAgent()
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

  // 自定义右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Tab 右键菜单状态
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)

  const activeFile = openFiles.find((f: { path: string }) => f.path === activeFilePath)
  const activeLanguage = activeFile ? getLanguage(activeFile.path) : 'plaintext'

  // 检测大文件
  const activeFileInfo = activeFile ? getFileInfo(activeFile.path, activeFile.content) : null

  // 监听主题变化并更新 Monaco 主题
  const currentTheme = useStore((state) => state.currentTheme) as ThemeName

  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      const monaco = monacoRef.current
      // 动态导入主题定义（避免循环依赖，或者直接在这里处理）
      import('./ThemeManager').then(({ themes }) => {
        const themeVars = themes[currentTheme]
        if (!themeVars) return

        // 辅助函数：RGB "r g b" 转 Hex
        const rgbToHex = (rgbStr: string) => {
          const [r, g, b] = rgbStr.split(' ').map(Number)
          return '#' + [r, g, b].map(x => {
            const hex = x.toString(16)
            return hex.length === 1 ? '0' + hex : hex
          }).join('')
        }

        const bg = rgbToHex(themeVars['--color-background'])
        const surface = rgbToHex(themeVars['--color-surface'])
        const text = rgbToHex(themeVars['--color-text-primary'])
        const border = rgbToHex(themeVars['--color-border'])
        const selection = rgbToHex(themeVars['--color-accent']) + '40' // 25% opacity

        monaco.editor.defineTheme('adnify-dynamic', {
          base: currentTheme === 'dawn' ? 'vs' : 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': bg,
            'editor.foreground': text,
            'editor.lineHighlightBackground': surface,
            'editorCursor.foreground': text,
            'editorWhitespace.foreground': border,
            'editorIndentGuide.background': border,
            'editor.selectionBackground': selection,
            'editorLineNumber.foreground': rgbToHex(themeVars['--color-text-muted']),
            // 更多颜色适配...
          }
        })
        monaco.editor.setTheme('adnify-dynamic')
      })
    }
  }, [currentTheme])

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // 注册所有 LSP 提供者（hover、completion、signature help 等）
    registerLspProviders(monaco)

    // 初始设置主题 - 直接在挂载时应用
    const { currentTheme: initialTheme } = useStore.getState() as { currentTheme: ThemeName }
    import('./ThemeManager').then(({ themes }) => {
      const themeVars = themes[initialTheme]
      if (!themeVars) return

      const rgbToHex = (rgbStr: string) => {
        const [r, g, b] = rgbStr.split(' ').map(Number)
        return '#' + [r, g, b].map(x => {
          const hex = x.toString(16)
          return hex.length === 1 ? '0' + hex : hex
        }).join('')
      }

      const bg = rgbToHex(themeVars['--color-background'])
      const surface = rgbToHex(themeVars['--color-surface'])
      const text = rgbToHex(themeVars['--color-text-primary'])
      const border = rgbToHex(themeVars['--color-border'])
      const selection = rgbToHex(themeVars['--color-accent']) + '40'

      monaco.editor.defineTheme('adnify-dynamic', {
        base: initialTheme === 'dawn' ? 'vs' : 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': bg,
          'editor.foreground': text,
          'editor.lineHighlightBackground': surface,
          'editorCursor.foreground': text,
          'editorWhitespace.foreground': border,
          'editorIndentGuide.background': border,
          'editor.selectionBackground': selection,
          'editorLineNumber.foreground': rgbToHex(themeVars['--color-text-muted']),
        }
      })
      monaco.editor.setTheme('adnify-dynamic')
    })

    // 启动 LSP 服务器（异步）
    const { workspacePath } = useStore.getState()
    if (workspacePath) {
      // 设置工作区路径供 LSP 服务使用
      import('../services/lspService').then(({ setWorkspacePath }) => {
        setWorkspacePath(workspacePath)
      })
      
      startLspServer(workspacePath).then((success) => {
        if (success) {
          console.log('[Editor] LSP server started')
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
            console.error('[Editor] Definition provider error:', error)
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
            startLineNumber: err.startLine ?? 1,
            startColumn: 1,
            endLineNumber: err.endLine ?? 1,
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

  // 文件变化时清除状态
  // 文件切换时的处理
  useEffect(() => {
    setLintErrors([])

    // 清除补全状态
    ghostTextRef.current?.hide()
    completionService.cancel()

    // 通知 LSP 服务器当前文件已打开
    if (activeFile) {
      didOpenDocument(activeFile.path, activeFile.content)
    }
  }, [activeFilePath, activeFile])

  // 清理 ghost text manager
  useEffect(() => {
    return () => {
      ghostTextRef.current?.dispose()
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

  const handleSave = useCallback(async () => {
    if (activeFile) {
      try {
        const success = await window.electronAPI.writeFile(activeFile.path, activeFile.content)
        if (success) {
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
  }, [activeFile, markFileSaved, language])

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
      const { globalConfirm } = await import('./ConfirmDialog')
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
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
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
      <div className="h-full flex flex-col bg-background relative overflow-hidden">
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
    <div className="h-full flex flex-col bg-background" onKeyDown={handleKeyDown}>
      {/* Tabs */}
      <div className="h-10 flex items-center bg-background-secondary border-b border-border-subtle overflow-hidden select-none">
        <div className="flex items-center flex-1 overflow-x-auto no-scrollbar h-full">
          {openFiles.map((file: { path: string; isDirty?: boolean }) => {
            const fileName = getFileName(file.path)
            const isActive = file.path === activeFilePath
            return (
              <div
                key={file.path}
                onClick={() => setActiveFile(file.path)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path })
                }}
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
                    handleCloseFile(file.path)
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
          <div className="flex items-center gap-1 opacity-70 flex-1">
            <Home className="w-3 h-3" />
            <span className="mx-1 opacity-30">/</span>
            {getBreadcrumbs(activeFile.path).map((part, i, arr) => (
              <div key={i} className="flex items-center">
                <span className={i === arr.length - 1 ? 'text-text-primary font-medium' : ''}>{part}</span>
                {i < arr.length - 1 && <ChevronRight className="w-3 h-3 mx-1 opacity-30" />}
              </div>
            ))}
          </div>
          {/* 大文件警告 */}
          {activeFileInfo?.isLarge && (
            <div className="flex items-center gap-1 text-status-warning">
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
          <div className="absolute inset-0 z-50 flex flex-col bg-editor-bg">
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
              <DiffEditor
                height="100%"
                language={getLanguage(activeDiff.filePath)}
                original={activeDiff.original}
                modified={activeDiff.modified}
                theme="vs-dark"
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
                    className="px-4 py-2 text-sm font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                  >
                    {t('rejectChanges', language)}
                  </button>
                  <button
                    onClick={() => {
                      acceptChange(activeDiff.filePath)
                      updateFileContent(activeDiff.filePath, activeDiff.modified)
                      closeDiff()
                    }}
                    className="px-4 py-2 text-sm font-medium bg-green-500 text-white hover:bg-green-600 rounded-md transition-colors"
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
              // 使用 key 强制在文件切换时重新创建编辑器实例
              key={activeFile.path}
              // 使用 monaco.Uri.file() 生成的 URI 字符串
              // 这确保与 TypeScript 语言服务内部使用的格式一致
              path={monaco.Uri.file(activeFile.path).toString()}
              language={activeLanguage}
              value={activeFile.content}
              theme="vs-dark"
              beforeMount={(monacoInstance) => {
                // 初始化 TypeScript 语言服务
                initMonacoTypeService(monacoInstance)
              }}
              onMount={handleEditorMount}
              onChange={(value) => {
                if (value !== undefined) {
                  updateFileContent(activeFile.path, value)
                  // 通知 LSP 文档变更
                  didChangeDocument(activeFile.path, value)
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
                minimap: { enabled: getEditorConfig().minimap, scale: getEditorConfig().minimapScale, renderCharacters: false },
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
                // 链接点击支持
                links: true,
                // 跳转到定义
                gotoLocation: {
                  multiple: 'goto',
                  multipleDefinitions: 'goto',
                  multipleTypeDefinitions: 'goto',
                  multipleDeclarations: 'goto',
                  multipleImplementations: 'goto',
                  multipleReferences: 'goto',
                },
                // 禁用 Monaco 内置右键菜单，使用自定义国际化菜单
                contextmenu: false,
                // 大文件优化
                ...(activeFileInfo ? getLargeFileEditorOptions(activeFileInfo) : {}),
              }}
            />
          )
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
      if (e.key === 'Escape') onClose()
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
