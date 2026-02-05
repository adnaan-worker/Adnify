/**
 * Composer Panel - 多文件编辑模式
 * 类似 Cursor 的 Composer，支持同时编辑多个文件
 * 
 * 集成 composerService 实现：
 * - 批量文件修改跟踪
 * - Accept/Reject All 功能
 * - 按目录分组显示
 * - 统一 Diff 生成
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Sparkles, X, FileText, Plus,
  ChevronDown, ChevronRight, Check, AlertCircle,
  Loader2, FolderOpen, CheckCheck, XCircle
} from 'lucide-react'
import { useStore } from '@store'
import { getFileName } from '@shared/utils/pathUtils'
import DiffViewer from '../editor/DiffViewer'
import { t } from '@renderer/i18n'
import { composerService, FileChange } from '@renderer/agent/services/composerService'
import { getEditorConfig } from '@renderer/settings'
import { Modal } from '@components/ui'

interface FileEdit {
  path: string
  originalContent: string
  newContent: string
  status: 'pending' | 'applied' | 'rejected'
}

interface ComposerPanelProps {
  onClose: () => void
  // 可选：从 Agent 传入的已有变更
  initialChanges?: FileChange[]
}

export default function ComposerPanel({ onClose, initialChanges }: ComposerPanelProps) {
  const { openFiles, activeFilePath, llmConfig, updateFileContent, language } = useStore()

  const [instruction, setInstruction] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [fileEdits, setFileEdits] = useState<FileEdit[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showFileSelector, setShowFileSelector] = useState(false)
  const [expandedEdits, setExpandedEdits] = useState<Set<string>>(new Set())
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [fontSize, setFontSize] = useState(14)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const config = getEditorConfig()
    setFontSize(config.fontSize)
  }, [])

  // 订阅 composerService 状态
  const [composerState, setComposerState] = useState(composerService.getState())

  useEffect(() => {
    const unsubscribe = composerService.subscribe(setComposerState)
    return unsubscribe
  }, [])

  // 如果有初始变更，启动 session
  useEffect(() => {
    if (initialChanges && initialChanges.length > 0) {
      composerService.startSession('Agent Changes', 'Changes from AI Agent')
      initialChanges.forEach(change => {
        composerService.addChange(change)
      })
    }
  }, [initialChanges])

  // 按目录分组的变更
  const groupedChanges = useMemo(() => {
    if (!composerState.currentSession) return new Map<string, FileChange[]>()
    return composerService.getChangesGroupedByDirectory()
  }, [composerState])

  // 统计信息
  const summary = useMemo(() => composerService.getSummary(), [composerState])

  // 自动添加当前活动文件
  useEffect(() => {
    if (activeFilePath && selectedFiles.length === 0) {
      setSelectedFiles([activeFilePath])
    }
  }, [activeFilePath])

  // 聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const addFile = useCallback((path: string) => {
    if (!selectedFiles.includes(path)) {
      setSelectedFiles(prev => [...prev, path])
    }
    setShowFileSelector(false)
  }, [selectedFiles])

  const removeFile = useCallback((path: string) => {
    setSelectedFiles(prev => prev.filter(p => p !== path))
  }, [])

  const toggleEditExpanded = useCallback((path: string) => {
    setExpandedEdits(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!instruction.trim() || selectedFiles.length === 0) return

    setIsGenerating(true)
    setError(null)
    setFileEdits([])

    try {
      // 收集选中文件的内容
      const fileContents: { path: string; content: string }[] = []
      for (const filePath of selectedFiles) {
        const openFile = openFiles.find((f: { path: string; content: string }) => f.path === filePath)
        if (openFile) {
          fileContents.push({ path: filePath, content: openFile.content })
        } else {
          const content = await api.file.read(filePath)
          if (content) {
            fileContents.push({ path: filePath, content })
          }
        }
      }

      // 构建 Composer 专用提示
      const prompt = buildComposerPrompt(instruction, fileContents)

      // 调用 LLM 生成编辑
      const result = await generateComposerEdits(llmConfig, prompt, fileContents)

      if (result.success && result.edits) {
        setFileEdits(result.edits.map(edit => ({
          ...edit,
          status: 'pending' as const
        })))
        // 展开所有编辑
        setExpandedEdits(new Set(result.edits.map(e => e.path)))
      } else {
        setError(result.error || 'Failed to generate edits')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setIsGenerating(false)
    }
  }, [instruction, selectedFiles, openFiles, llmConfig])

  const applyEdit = useCallback(async (edit: FileEdit) => {
    try {
      // 写入文件
      const success = await api.file.write(edit.path, edit.newContent)
      if (success) {
        // 更新 store 中的文件内容
        updateFileContent(edit.path, edit.newContent)
        setFileEdits(prev => prev.map(e =>
          e.path === edit.path ? { ...e, status: 'applied' as const } : e
        ))
      }
    } catch (err) {
      logger.ui.error('Failed to apply edit:', err)
    }
  }, [updateFileContent])

  const rejectEdit = useCallback((path: string) => {
    setFileEdits(prev => prev.map(e =>
      e.path === path ? { ...e, status: 'rejected' as const } : e
    ))
  }, [])

  const applyAllEdits = useCallback(async () => {
    for (const edit of fileEdits) {
      if (edit.status === 'pending') {
        await applyEdit(edit)
      }
    }
  }, [fileEdits, applyEdit])

  // Composer Service 方法
  const handleAcceptComposerChange = useCallback(async (filePath: string) => {
    const success = await composerService.acceptChange(filePath)
    if (success) {
      // 更新 store 中的文件内容
      const change = composerState.currentSession?.changes.find(c => c.filePath === filePath)
      if (change?.newContent) {
        updateFileContent(filePath, change.newContent)
      }
    }
  }, [composerState, updateFileContent])

  const handleRejectComposerChange = useCallback(async (filePath: string) => {
    await composerService.rejectChange(filePath)
  }, [])

  const handleAcceptAllComposer = useCallback(async () => {
    const result = await composerService.acceptAll()
    logger.ui.info(`[Composer] Accepted ${result.accepted} changes, ${result.failed} failed`)
  }, [])

  const handleRejectAllComposer = useCallback(async () => {
    const result = await composerService.rejectAll()
    logger.ui.info(`[Composer] Rejected ${result.rejected} changes`)
  }, [])

  // 键盘快捷键: Ctrl+Shift+A 接受全部, Ctrl+Shift+X 拒绝全部
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'A' || e.key === 'a') {
          e.preventDefault()
          if (summary.pending > 0) {
            handleAcceptAllComposer()
          }
        } else if (e.key === 'X' || e.key === 'x') {
          e.preventDefault()
          if (summary.pending > 0) {
            handleRejectAllComposer()
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleAcceptAllComposer, handleRejectAllComposer, summary.pending])

  const toggleDirExpanded = useCallback((dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) {
        next.delete(dir)
      } else {
        next.add(dir)
      }
      return next
    })
  }, [])

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title=""
      size="5xl"
      noPadding
      showCloseButton={false}
    >
      <div className="flex flex-col h-auto max-h-[80vh]">
        {/* Header */}
        <div className="relative flex items-center justify-between px-8 py-6 border-b border-border-subtle bg-surface/10">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-accent/20 blur-2xl rounded-full group-hover:bg-accent/30 transition-all duration-700" />
              <div className="relative w-12 h-12 bg-surface/40 backdrop-blur-xl rounded-2xl border border-border-subtle flex items-center justify-center shadow-xl">
                <Sparkles className="w-6 h-6 text-accent" />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-black text-text-primary tracking-tight flex items-center gap-2">
                {t('composer', language)}
                <span className="px-2 py-0.5 rounded-full bg-accent/10 text-[10px] text-accent font-bold uppercase tracking-widest border border-accent/20">
                  BETA
                </span>
              </h2>
              <p className="text-xs text-text-muted font-medium opacity-60 uppercase tracking-widest">
                {t('multiFileEdit', language)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl hover:bg-surface/20 text-text-muted hover:text-text-primary transition-all duration-300 group"
          >
            <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Main Content Area: Two Columns if changes exist, else single */}
          <div className={`flex-1 flex overflow-hidden ${(fileEdits.length > 0 || (composerState.currentSession && composerState.currentSession.changes.length > 0)) ? 'divide-x divide-border-subtle' : ''}`}>

            {/* Left/Main Column: Input & File Selection */}
            <div className={`flex flex-col ${(fileEdits.length > 0 || (composerState.currentSession && composerState.currentSession.changes.length > 0)) ? 'w-[45%]' : 'w-full'} transition-all duration-500`}>

              {/* File Selection Area */}
              <div className="px-8 py-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-text-primary uppercase tracking-[0.2em] opacity-40 flex items-center gap-2">
                    <FolderOpen className="w-3 h-3" />
                    {t('filesToEdit', language)}
                  </h3>
                  <div className="relative">
                    <button
                      onClick={() => setShowFileSelector(!showFileSelector)}
                      className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold bg-accent/10 text-accent border border-accent/20 rounded-xl hover:bg-accent/20 transition-all duration-300 uppercase tracking-tighter"
                    >
                      <Plus className="w-3 h-3" />
                      {t('addFile', language)}
                    </button>

                    {/* File Selector Dropdown */}
                    {showFileSelector && (
                      <div className="absolute right-0 mt-2 w-72 max-h-64 overflow-y-auto bg-surface/95 backdrop-blur-2xl border border-border-subtle rounded-2xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200 custom-scrollbar">
                        <div className="p-2 space-y-1">
                          {openFiles.map((file: { path: string; content: string }) => (
                            <button
                              key={file.path}
                              onClick={() => addFile(file.path)}
                              disabled={selectedFiles.includes(file.path)}
                              className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-xl hover:bg-surface/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors group"
                            >
                              <FileText className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold text-text-primary truncate">{getFileName(file.path)}</span>
                                <span className="text-[9px] text-text-muted truncate opacity-50">{file.path}</span>
                              </div>
                            </button>
                          ))}
                          {openFiles.length === 0 && (
                            <div className="px-4 py-8 text-center space-y-2">
                              <FileText className="w-8 h-8 text-text-muted mx-auto opacity-20" />
                              <p className="text-xs text-text-muted font-medium italic">
                                {t('noOpenFiles', language)}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Selected Files Chips */}
                <div className="flex flex-wrap gap-2 min-h-[40px] p-3 rounded-2xl bg-surface/10 border border-border-subtle">
                  {selectedFiles.map(path => (
                    <div
                      key={path}
                      className="flex items-center gap-2 px-3 py-1.5 bg-surface/20 text-text-primary text-[11px] font-bold rounded-xl border border-border-subtle hover:border-accent/30 hover:bg-accent/5 transition-all duration-300 group"
                    >
                      <FileText className="w-3.5 h-3.5 text-text-muted group-hover:text-accent transition-colors" />
                      <span className="truncate max-w-[180px]">{getFileName(path)}</span>
                      <button
                        onClick={() => removeFile(path)}
                        className="p-1 hover:bg-red-500/10 rounded-lg text-text-muted hover:text-red-400 transition-all duration-300"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  {selectedFiles.length === 0 && (
                    <div className="flex items-center gap-2 text-[11px] text-text-muted italic opacity-50 px-2">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {t('noFilesSelected', language)}
                    </div>
                  )}
                </div>
              </div>

              {/* Instruction Input Area */}
              <div className="px-8 pb-8">
                <div className="relative flex flex-col rounded-2xl border border-border-subtle bg-surface/5 focus-within:border-accent/40 transition-all duration-300 overflow-hidden">
                  <textarea
                    ref={inputRef}
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    placeholder={t('describeChanges', language)}
                    className="w-full h-32 bg-transparent border-none px-5 py-4 text-sm text-text-primary placeholder-text-muted/40 focus:ring-0 focus:outline-none resize-none leading-relaxed"
                    style={{ fontSize: `${fontSize}px` }}
                    disabled={isGenerating}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        handleGenerate()
                      }
                    }}
                  />

                  {/* Input Toolbar */}
                  <div className="px-5 py-3 border-t border-border-subtle flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/20 border border-border-subtle">
                        <div className={`w-1.5 h-1.5 rounded-full ${selectedFiles.length > 0 ? 'bg-accent animate-pulse' : 'bg-text-muted opacity-30'}`} />
                        <span className="text-[10px] font-black text-text-muted uppercase tracking-widest">
                          {t('filesSelected', language, { count: String(selectedFiles.length) })}
                        </span>
                      </div>
                      {instruction.length > 0 && (
                        <span className="text-[10px] font-bold text-text-muted opacity-40 uppercase tracking-tighter">
                          {instruction.length} chars
                        </span>
                      )}
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={!instruction.trim() || selectedFiles.length === 0 || isGenerating}
                      className="relative group/btn overflow-hidden flex items-center gap-2 px-6 py-2.5 bg-accent text-accent-foreground text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-accent-hover disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed transition-all duration-500 shadow-xl shadow-accent/20"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-1000" />
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t('generating', language)}
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          {t('generateEdits', language)}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-xs text-red-400 font-bold animate-in slide-in-from-top-2 duration-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Changes & Diff Preview */}
            {(fileEdits.length > 0 || (composerState.currentSession && composerState.currentSession.changes.length > 0)) && (
              <div className="flex-1 flex flex-col bg-surface/5 overflow-hidden animate-in slide-in-from-right-4 duration-500">

                {/* Changes Header */}
                <div className="px-8 py-6 border-b border-border-subtle flex items-center justify-between bg-surface/10">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[10px] font-black text-text-primary uppercase tracking-[0.2em] opacity-40 flex items-center gap-2">
                      <CheckCheck className="w-3 h-3" />
                      {language === 'zh' ? '变更预览' : 'Changes Preview'}
                    </h3>
                    <div className="flex items-center gap-3 px-3 py-1 rounded-full bg-surface/20 border border-border-subtle">
                      <span className="text-[10px] font-bold text-green-400">+{composerState.currentSession?.totalLinesAdded || 0}</span>
                      <span className="text-[10px] font-bold text-red-400">-{composerState.currentSession?.totalLinesRemoved || 0}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={fileEdits.length > 0 ? () => setFileEdits([]) : handleRejectAllComposer}
                      disabled={summary.pending === 0 && fileEdits.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-surface/20 border border-border-subtle text-text-muted text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 disabled:opacity-30 transition-all duration-300"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {language === 'zh' ? '全部拒绝' : 'Reject All'}
                    </button>
                    <button
                      onClick={fileEdits.length > 0 ? applyAllEdits : handleAcceptAllComposer}
                      disabled={summary.pending === 0 && fileEdits.length === 0}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-accent-foreground text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-green-500 shadow-lg shadow-green-900/20 disabled:opacity-30 transition-all duration-300"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      {language === 'zh' ? '全部接受' : 'Accept All'}
                    </button>
                  </div>
                </div>

                {/* Changes List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                  {/* Generated Edits (Temporary) */}
                  {fileEdits.map(edit => (
                    <div key={edit.path} className="rounded-2xl border border-border-subtle bg-surface/10 overflow-hidden group/edit">
                      <div
                        className="flex items-center justify-between px-5 py-3 hover:bg-surface/20 cursor-pointer transition-colors"
                        onClick={() => toggleEditExpanded(edit.path)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-1.5 rounded-lg bg-surface/20 text-text-muted group-hover/edit:text-accent transition-colors`}>
                            {expandedEdits.has(edit.path) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-text-primary">{getFileName(edit.path)}</span>
                            <span className="text-[9px] text-text-muted opacity-40 truncate max-w-[200px]">{edit.path}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {edit.status === 'pending' ? (
                            <>
                              <button
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); applyEdit(edit) }}
                                className="p-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600 hover:text-accent-foreground transition-all duration-300"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e: React.MouseEvent) => { e.stopPropagation(); rejectEdit(edit.path) }}
                                className="p-1.5 rounded-lg bg-surface/20 text-text-muted hover:bg-red-500/20 hover:text-red-400 transition-all duration-300"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${edit.status === 'applied' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                              {edit.status}
                            </span>
                          )}
                        </div>
                      </div>
                      {expandedEdits.has(edit.path) && (
                        <div className="border-t border-border-subtle bg-black/20 animate-in fade-in slide-in-from-top-1 duration-300">
                          <DiffViewer
                            originalContent={edit.originalContent}
                            modifiedContent={edit.newContent}
                            filePath={edit.path}
                            minimal={true}
                            onAccept={() => applyEdit(edit)}
                            onReject={() => rejectEdit(edit.path)}
                          />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Composer Service Changes (Persistent) */}
                  {Array.from(groupedChanges.entries()).map(([dir, changes]) => (
                    <div key={dir} className="space-y-2">
                      <div
                        className="flex items-center gap-2 px-2 py-1 opacity-40 hover:opacity-100 cursor-pointer transition-opacity group/dir"
                        onClick={() => toggleDirExpanded(dir)}
                      >
                        {expandedDirs.has(dir) ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <FolderOpen className="w-3.5 h-3.5 text-yellow-500/70" />
                        <span className="text-[10px] font-black uppercase tracking-widest">{dir || 'root'}</span>
                        <span className="text-[9px] font-bold text-text-muted">({changes.length})</span>
                      </div>

                      {expandedDirs.has(dir) && changes.map(change => (
                        <div key={change.filePath} className="rounded-2xl border border-border-subtle bg-surface/10 overflow-hidden group/change ml-4">
                          <div
                            className="flex items-center justify-between px-5 py-3 hover:bg-surface/20 cursor-pointer transition-colors"
                            onClick={() => toggleEditExpanded(change.filePath)}
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-1.5 rounded-lg bg-surface/20 text-text-muted group-hover/change:text-accent transition-colors">
                                {expandedEdits.has(change.filePath) ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-text-primary">{getFileName(change.filePath)}</span>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] font-black uppercase tracking-tighter ${change.changeType === 'create' ? 'text-green-400' :
                                    change.changeType === 'delete' ? 'text-red-400' : 'text-blue-400'
                                    }`}>
                                    {change.changeType}
                                  </span>
                                  {change.status !== 'pending' && (
                                    <span className={`text-[9px] font-black uppercase tracking-tighter ${change.status === 'accepted' ? 'text-green-400' : 'text-red-400'
                                      }`}>
                                      • {change.status}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            {change.status === 'pending' && (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleAcceptComposerChange(change.filePath) }}
                                  className="p-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600 hover:text-accent-foreground transition-all duration-300"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleRejectComposerChange(change.filePath) }}
                                  className="p-1.5 rounded-lg bg-surface/20 text-text-muted hover:bg-red-500/20 hover:text-red-400 transition-all duration-300"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                          {expandedEdits.has(change.filePath) && change.oldContent !== null && change.newContent !== null && (
                            <div className="border-t border-border-subtle bg-black/20 animate-in fade-in slide-in-from-top-1 duration-300">
                              <DiffViewer
                                originalContent={change.oldContent || ''}
                                modifiedContent={change.newContent || ''}
                                filePath={change.filePath}
                                minimal={true}
                                onAccept={() => handleAcceptComposerChange(change.filePath)}
                                onReject={() => handleRejectComposerChange(change.filePath)}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}


/**
 * 构建 Composer 提示词
 */
function buildComposerPrompt(
  instruction: string,
  files: { path: string; content: string }[]
): string {
  const fileContents = files.map(f => {
    const lang = f.path.split('.').pop() || 'code'
    return `### ${f.path}\n\`\`\`${lang}\n${f.content}\n\`\`\``
  }).join('\n\n')

  return `You are a code editor assistant. The user wants to make changes across multiple files.

                      ## Files:
                      ${fileContents}

                      ## User Instruction:
                      ${instruction}

                      ## Response Format:
                      For each file that needs changes, respond with:
                      ---FILE: <filepath>---
                        <complete new file content>
                          ---END FILE---

                          Only include files that need changes. Output the complete file content, not just the changes.
                          Do not include any explanations outside the file blocks.`
}

interface LLMConfigForComposer {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
}

/**
 * 调用 LLM 生成多文件编辑
 */
async function generateComposerEdits(
  config: LLMConfigForComposer,
  prompt: string,
  originalFiles: { path: string; content: string }[]
): Promise<{ success: boolean; edits?: Omit<FileEdit, 'status'>[]; error?: string }> {
  return new Promise((resolve) => {
    let result = ''
    let resolved = false
    const unsubscribers: (() => void)[] = []

    // 生成请求 ID，用于 IPC 频道隔离
    const requestId = crypto.randomUUID()

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        unsubscribers.forEach(unsub => unsub())
      }
    }

    unsubscribers.push(
      api.llm.onStream(requestId, (chunk: { type: string; content?: string }) => {
        if (chunk.type === 'text' && chunk.content) {
          result += chunk.content
        }
      })
    )

    unsubscribers.push(
      api.llm.onDone(requestId, () => {
        cleanup()

        // 解析响应
        const edits: Omit<FileEdit, 'status'>[] = []
        const fileRegex = /---FILE:\s*(.+?)---\n([\s\S]*?)---END FILE---/g
        let match

        while ((match = fileRegex.exec(result)) !== null) {
          const path = match[1].trim()
          let newContent = match[2].trim()

          // 移除可能的 markdown 代码块
          if (newContent.startsWith('```')) {
            newContent = newContent.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
          }

          const original = originalFiles.find(f => f.path === path || f.path.endsWith(path))
          if (original) {
            edits.push({
              path: original.path,
              originalContent: original.content,
              newContent,
            })
          }
        }

        if (edits.length > 0) {
          resolve({ success: true, edits })
        } else {
          resolve({ success: false, error: 'No valid file edits found in response' })
        }
      })
    )

    unsubscribers.push(
      api.llm.onError(requestId, (error: { message: string }) => {
        cleanup()
        resolve({ success: false, error: error.message })
      })
    )

    setTimeout(() => {
      if (!resolved) {
        cleanup()
        resolve({ success: false, error: 'Request timeout' })
      }
    }, 120000)

    api.llm.send({
      config,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'You are a helpful code editor assistant. Follow the response format exactly.',
      requestId,
    }).catch((err) => {
      if (!resolved) {
        cleanup()
        resolve({ success: false, error: err.message })
      }
    })
  })
}
