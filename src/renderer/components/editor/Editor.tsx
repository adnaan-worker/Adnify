/**
 * 编辑器主组件
 */
import { useRef, useCallback, useEffect, useState } from 'react'
import MonacoEditor, { OnMount, BeforeMount, loader } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { Eye, Edit, Columns } from 'lucide-react'
import { useStore } from '@store'
import { useAgent } from '@hooks/useAgent'
import { useLspIntegration, useFileSave, useLintCheck } from '@renderer/hooks'
import { toast } from '../common/ToastProvider'
import { getFileName } from '@shared/utils/pathUtils'
import { api } from '@renderer/services/electronAPI'
import { didChangeDocument } from '@services/lspService'
import { getFileInfo } from '@services/largeFileService'
import { getMonacoEditorOptions } from '@renderer/config/monacoConfig'
import { getEditorConfig } from '@renderer/settings'
import { keybindingService } from '@services/keybindingService'
import { monaco } from '@renderer/monacoWorker'
import { initMonacoTypeService } from '@services/monacoTypeService'
import { streamingEditService } from '@renderer/agent/services/streamingEditService'
import type { StreamingEditState } from '@renderer/agent/types'
import type { ThemeName } from '@store/slices/themeSlice'
import { useEditorBreakpoints } from '@hooks/useEditorBreakpoints'

// 子组件
import { EditorTabs } from './EditorTabs'
import { EditorBreadcrumbs } from './EditorBreadcrumbs'
import { DiffPreview } from './DiffPreview'
import DiffViewer from './DiffViewer'
import InlineEdit from './InlineEdit'
import EditorContextMenu from './EditorContextMenu'
import { TabContextMenu } from './TabContextMenu'
import { EditorWelcome } from './EditorWelcome'
import { SafeDiffEditor } from './SafeDiffEditor'
import { getFileType, MarkdownPreview, ImagePreview, UnsupportedFile, isPlanBoard } from './FilePreview'
import { PlanBoardTab } from '../plan'
import { CodeSkeleton } from '../ui/Loading'

// Hooks
import { useEditorActions, useAICompletion, useEditorEvents } from './hooks'
import { getLanguage } from './utils/languageMap'
import { defineMonacoTheme } from './utils/monacoTheme'

loader.config({ monaco })

export default function Editor() {
  const {
    openFiles, activeFilePath, setActiveFile, updateFileContent, updateFileDirtyState, markFileSaved,
    language, activeDiff, setActiveDiff
  } = useStore()
  const { pendingChanges, acceptChange, undoChange } = useAgent()

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api') | null>(null)
  const cursorDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Hooks
  const { registerProviders, setupDiagnostics, setupLinkNavigation, notifyFileOpened } = useLspIntegration()
  const { saveFile, closeFileWithConfirm, closeOtherFiles, closeAllFiles, closeFilesToRight, triggerAutoSave } = useFileSave()
  const { isLinting, runLintCheck, clearLintErrors, errorCount, warningCount } = useLintCheck()
  const { setupCursorTracking } = useEditorEvents(editorRef)

  // 状态
  const [streamingEdit, setStreamingEdit] = useState<StreamingEditState | null>(null)
  const [showDiffPreview, setShowDiffPreview] = useState(false)
  const [inlineEditState, setInlineEditState] = useState<{
    show: boolean; position: { x: number; y: number }; selectedCode: string; lineRange: [number, number]
  } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)
  const [markdownMode, setMarkdownMode] = useState<'edit' | 'preview' | 'split'>('edit')

  const { registerActions } = useEditorActions(setInlineEditState)
  const { registerProvider: registerAIProvider } = useAICompletion(activeFilePath)

  const activeFile = openFiles.find(f => f.path === activeFilePath)
  const activeLanguage = activeFile ? getLanguage(activeFile.path) : 'plaintext'
  const activeFileType = activeFile ? getFileType(activeFile.path) : 'text'
  const activeFileInfo = activeFile ? getFileInfo(activeFile.path, activeFile.content) : null
  const currentTheme = useStore((state) => state.currentTheme) as ThemeName

  // 断点管理
  useEditorBreakpoints(editorRef.current, activeFilePath)

  // 主题变化
  useEffect(() => {
    if (monacoRef.current && currentTheme) {
      defineMonacoTheme(monacoRef.current, currentTheme)
      monacoRef.current.editor.setTheme('adnify-dynamic')
    }
  }, [currentTheme])

  // 文件切换时清除 lint 错误并通知 LSP
  useEffect(() => {
    clearLintErrors()
    if (activeFile) {
      notifyFileOpened(activeFile.path, activeFile.content)
    }
  }, [activeFilePath, activeFile, clearLintErrors, notifyFileOpened])

  // 流式编辑监听
  useEffect(() => {
    if (!activeFilePath) return

    const activeEdit = streamingEditService.getActiveEditForFile(activeFilePath)
    if (activeEdit) {
      setStreamingEdit(activeEdit.state)
      setShowDiffPreview(true)

      const unsubscribe = streamingEditService.subscribe(activeEdit.editId, (state) => {
        setStreamingEdit(state)
        if (state.isComplete) {
          setTimeout(() => setShowDiffPreview(false), 500)
        }
      })
      return unsubscribe
    } else {
      setStreamingEdit(null)
      setShowDiffPreview(false)
    }
  }, [activeFilePath])

  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    const { currentTheme } = useStore.getState() as { currentTheme: ThemeName }
    defineMonacoTheme(monacoInstance, currentTheme)
    initMonacoTypeService(monacoInstance)
  }

  const handleEditorMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    monacoRef.current = monacoInstance

    setupCursorTracking(editor, cursorDebounceRef)
    registerProviders(monacoInstance)
    const unsubscribeDiagnostics = setupDiagnostics(monacoInstance)
    setupLinkNavigation(editor)
    registerActions(editor, monacoInstance)
    registerAIProvider(monacoInstance)

    monacoInstance.editor.setTheme('adnify-dynamic')

    // 监听内容变化，基于版本号更新 dirty 状态
    const model = editor.getModel()
    if (model && activeFilePath) {
      // 初始化时记录版本号
      const { openFiles } = useStore.getState()
      const file = openFiles.find(f => f.path === activeFilePath)
      if (file && !file.savedVersionId) {
        // 首次打开，记录初始版本号
        const { markFileSaved } = useStore.getState()
        markFileSaved(activeFilePath, model.getAlternativeVersionId())
      }

      editor.onDidChangeModelContent(() => {
        const currentVersionId = model.getAlternativeVersionId()
        const editorContent = editor.getValue()
        const { openFiles: currentFiles } = useStore.getState()
        const currentFile = currentFiles.find(f => f.path === activeFilePath)

        if (currentFile && editorContent === currentFile.content) {
          // 内容相同，说明是外部同步（如 AI 写入后 reloadFileFromDisk）
          // 更新 savedVersionId，保持 isDirty: false
          markFileSaved(activeFilePath, currentVersionId)
        } else {
          // 内容不同，说明是用户编辑
          updateFileDirtyState(activeFilePath, currentVersionId)
        }
      })
    }

    editor.onContextMenu((e) => {
      e.event.preventDefault()
      e.event.stopPropagation()
      setContextMenu({ x: e.event.posx, y: e.event.posy })
    })

    editor.onDidDispose(() => {
      unsubscribeDiagnostics()
    })
  }

  const handleSave = useCallback(async () => {
    if (activeFile && editorRef.current) {
      const config = getEditorConfig()
      if (config.formatOnSave) {
        const formatAction = editorRef.current.getAction('editor.action.formatDocument')
        if (formatAction) await formatAction.run()
      }
      const content = editorRef.current.getValue()
      const success = await api.file.write(activeFile.path, content)
      if (success) {
        if (config.formatOnSave && content !== activeFile.content) {
          updateFileContent(activeFile.path, content)
        }
        // 保存时记录当前版本号
        const model = editorRef.current.getModel()
        const versionId = model?.getAlternativeVersionId()
        markFileSaved(activeFile.path, versionId)
        toast.success(language === 'zh' ? '文件已保存' : 'File Saved', getFileName(activeFile.path))
      } else {
        toast.error(language === 'zh' ? '保存失败' : 'Save Failed', language === 'zh' ? '无法写入文件' : 'Could not write to file')
      }
    }
  }, [activeFile, markFileSaved, language, updateFileContent])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (keybindingService.matches(e.nativeEvent, 'editor.save')) {
      e.preventDefault()
      handleSave()
    }
  }, [handleSave])

  const handleRunLint = useCallback(() => {
    if (activeFilePath) {
      runLintCheck(activeFilePath, editorRef.current, monacoRef.current)
    }
  }, [activeFilePath, runLintCheck])

  if (openFiles.length === 0) {
    return <EditorWelcome />
  }

  return (
    <div className="h-full flex flex-col bg-transparent" onKeyDown={handleKeyDown}>
      <EditorTabs
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        onSelectFile={setActiveFile}
        onCloseFile={closeFileWithConfirm}
        onContextMenu={(e, path) => setTabContextMenu({ x: e.clientX, y: e.clientY, filePath: path })}
        lintErrorCount={errorCount}
        lintWarningCount={warningCount}
        isLinting={isLinting}
        onRunLint={handleRunLint}
      />

      {activeFile && (
        <EditorBreadcrumbs
          filePath={activeFile.path}
          largeFileInfo={activeFileInfo}
          language={language}
        />
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
            onReject={() => setShowDiffPreview(false)}
            onClose={() => setShowDiffPreview(false)}
          />
        </div>
      )}

      {/* Diff 预览 */}
      {activeDiff && (
        <DiffPreview
          diff={activeDiff}
          isPending={pendingChanges.some(c => c.filePath === activeDiff.filePath)}
          language={language}
          onClose={() => setActiveDiff(null)}
          onAccept={() => {
            acceptChange(activeDiff.filePath)
            updateFileContent(activeDiff.filePath, activeDiff.modified)
            setActiveDiff(null)
          }}
          onReject={async () => {
            await undoChange(activeDiff.filePath)
            setActiveDiff(null)
          }}
        />
      )}

      {/* 内联编辑 */}
      {inlineEditState?.show && activeFile && (
        <InlineEdit
          position={inlineEditState.position}
          selectedCode={inlineEditState.selectedCode}
          filePath={activeFile.path}
          lineRange={inlineEditState.lineRange}
          onClose={() => setInlineEditState(null)}
          onApply={(newCode) => {
            if (editorRef.current) {
              const selection = editorRef.current.getSelection()
              if (selection) {
                editorRef.current.executeEdits('inline-edit', [{
                  range: selection, text: newCode, forceMoveMarkers: true
                }])
              }
            }
            setInlineEditState(null)
          }}
        />
      )}

      {/* 编辑器主体 */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        {activeFile && (
          <>
            {/* Markdown 工具栏 */}
            {activeFileType === 'markdown' && (
              <div className="absolute top-0 right-0 z-10 flex items-center gap-1 px-2 py-1 bg-surface/80 backdrop-blur-sm rounded-bl-lg border-l border-b border-border">
                <button onClick={() => setMarkdownMode('edit')} className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'edit' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`} title="编辑模式">
                  <Edit className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setMarkdownMode('split')} className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'split' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`} title="分屏模式">
                  <Columns className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setMarkdownMode('preview')} className={`p-1.5 rounded-md text-xs transition-colors ${markdownMode === 'preview' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary hover:bg-white/10'}`} title="预览模式">
                  <Eye className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {activeFileType === 'image' ? (
              <ImagePreview path={activeFile.path} />
            ) : activeFileType === 'binary' ? (
              <UnsupportedFile path={activeFile.path} fileType="binary" />
            ) : isPlanBoard(activeFile.path) ? (
              <PlanBoardTab />
            ) : activeFileType === 'markdown' && markdownMode === 'preview' ? (
              <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} />
            ) : activeFileType === 'markdown' && markdownMode === 'split' ? (
              <div className="flex h-full">
                <div className="flex-1 border-r border-border">
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
                    loading={<CodeSkeleton lines={12} />}
                    options={{ fontSize: getEditorConfig().fontSize, fontFamily: getEditorConfig().fontFamily, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16 }, contextmenu: false }}
                  />
                </div>
                <div className="flex-1 relative overflow-hidden">
                  <MarkdownPreview content={activeFile.content} fontSize={getEditorConfig().fontSize} />
                </div>
              </div>
            ) : activeFile.originalContent !== undefined ? (
              <SafeDiffEditor
                language={activeLanguage}
                original={activeFile.originalContent}
                modified={activeFile.content}
                onMount={(editor, monacoInstance) => {
                  const modifiedEditor = editor.getModifiedEditor()
                  editorRef.current = modifiedEditor
                  monacoRef.current = monacoInstance
                  modifiedEditor.onDidChangeModelContent(() => {
                    updateFileContent(activeFile.path, modifiedEditor.getValue())
                  })
                }}
                options={{ fontSize: getEditorConfig().fontSize, fontFamily: getEditorConfig().fontFamily, fontLigatures: true, renderSideBySide: true, readOnly: false, minimap: { enabled: false }, scrollBeyondLastLine: false }}
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
                loading={<CodeSkeleton lines={12} />}
                options={getMonacoEditorOptions(activeFileInfo)}
              />
            )}
          </>
        )}

        {contextMenu && editorRef.current && (
          <EditorContextMenu x={contextMenu.x} y={contextMenu.y} editor={editorRef.current} onClose={() => setContextMenu(null)} />
        )}
      </div>

      {tabContextMenu && (
        <TabContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          filePath={tabContextMenu.filePath}
          onClose={() => setTabContextMenu(null)}
          onCloseFile={closeFileWithConfirm}
          onCloseOthers={closeOtherFiles}
          onCloseAll={closeAllFiles}
          onCloseToRight={closeFilesToRight}
          onSave={saveFile}
          isDirty={openFiles.find(f => f.path === tabContextMenu.filePath)?.isDirty || false}
          language={language}
        />
      )}
    </div>
  )
}
