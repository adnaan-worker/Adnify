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

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  Sparkles, X, FileText, Plus,
  ChevronDown, ChevronRight, Check, AlertCircle,
  Loader2, FolderOpen, CheckCheck, XCircle
} from 'lucide-react'
import { useStore } from '../store'
import DiffViewer from './DiffViewer'
import { t } from '../i18n'
import { composerService, FileChange } from '../agent/composerService'
import { getEditorConfig } from '../config/editorConfig'

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
  const viewMode = 'grouped' as const  // 固定使用分组视图
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
          const content = await window.electronAPI.readFile(filePath)
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
      const success = await window.electronAPI.writeFile(edit.path, edit.newContent)
      if (success) {
        // 更新 store 中的文件内容
        updateFileContent(edit.path, edit.newContent)
        setFileEdits(prev => prev.map(e =>
          e.path === edit.path ? { ...e, status: 'applied' as const } : e
        ))
      }
    } catch (err) {
      console.error('Failed to apply edit:', err)
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
    console.log(`[Composer] Accepted ${result.accepted} changes, ${result.failed} failed`)
  }, [])

  const handleRejectAllComposer = useCallback(async () => {
    const result = await composerService.rejectAll()
    console.log(`[Composer] Rejected ${result.rejected} changes`)
  }, [])

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in">
      <div className="w-[90vw] max-w-4xl max-h-[85vh] bg-surface border border-border-subtle rounded-xl shadow-2xl flex flex-col overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-hover">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <span className="font-medium text-text-primary">{t('composer', language)}</span>
            <span className="text-xs text-text-muted">{t('multiFileEdit', language)}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-active text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selected Files */}
        <div className="px-3 py-2 border-b border-border-subtle bg-background/50">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-text-muted">{t('filesToEdit', language)}:</span>
            <button
              onClick={() => setShowFileSelector(!showFileSelector)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-surface border border-border-subtle rounded hover:bg-surface-hover transition-colors"
            >
              <Plus className="w-2.5 h-2.5" />
              {t('addFile', language)}
            </button>
          </div>

          {/* File Selector Dropdown */}
          {showFileSelector && (
            <div className="absolute mt-1 w-64 max-h-48 overflow-y-auto bg-surface border border-border-subtle rounded-lg shadow-xl z-10">
              {openFiles.map((file: { path: string; content: string }) => (
                <button
                  key={file.path}
                  onClick={() => addFile(file.path)}
                  disabled={selectedFiles.includes(file.path)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-3.5 h-3.5 text-text-muted" />
                  <span className="truncate">{file.path.split(/[\\/]/).pop()}</span>
                </button>
              ))}
              {openFiles.length === 0 && (
                <div className="px-3 py-4 text-center text-text-muted text-xs">
                  {t('noOpenFiles', language)}
                </div>
              )}
            </div>
          )}

          {/* Selected Files List */}
          <div className="flex flex-wrap gap-1.5">
            {selectedFiles.map(path => (
              <div
                key={path}
                className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 text-text-secondary text-[10px] rounded border border-white/5 hover:bg-white/10 transition-colors group"
              >
                <FileText className="w-2.5 h-2.5 text-text-muted group-hover:text-accent transition-colors" />
                <span className="truncate max-w-[150px] opacity-80 group-hover:opacity-100">{path.split(/[\\/]/).pop()}</span>
                <button
                  onClick={() => removeFile(path)}
                  className="p-0.5 hover:bg-white/10 rounded text-text-muted hover:text-red-400 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            {selectedFiles.length === 0 && (
              <span className="text-[10px] text-text-muted italic">{t('noFilesSelected', language)}</span>
            )}
          </div>
        </div>

        {/* Instruction Input */}
        <div className="px-3 py-2 border-b border-border-subtle bg-surface/30 backdrop-blur-sm">
          <div className="relative rounded-lg border border-white/10 overflow-hidden focus-within:border-accent/50 transition-all duration-200 shadow-sm">
            <textarea
              ref={inputRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={t('describeChanges', language)}
              className="w-full bg-transparent border-none px-3 py-2 text-sm text-text-primary placeholder-text-muted/70 focus:ring-0 resize-none leading-relaxed"
              style={{ fontSize: `${fontSize}px` }}
              rows={3}
              disabled={isGenerating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  handleGenerate()
                }
              }}
            />

            {/* Toolbar / Actions inside input */}
            <div className="flex items-center justify-between px-2 py-1 border-t border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-muted px-1">
                  {t('filesSelected', language, { count: String(selectedFiles.length) })}
                </span>
              </div>

              <button
                onClick={handleGenerate}
                disabled={!instruction.trim() || selectedFiles.length === 0 || isGenerating}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-accent text-white text-xs font-medium rounded hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm shadow-accent/20"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t('generating', language)}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    {t('generateEdits', language)}
                  </>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-2 flex items-center gap-2 text-xs text-status-error animate-fade-in">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </div>
          )}
        </div>

        {/* File Edits Preview - Generated Edits */}
        {fileEdits.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-1.5 flex items-center justify-between bg-surface-hover border-b border-border-subtle sticky top-0">
              <span className="text-[10px] text-text-muted">
                {t('filesModified', language, { count: String(fileEdits.length) })}
              </span>
              <button
                onClick={applyAllEdits}
                disabled={fileEdits.every(e => e.status !== 'pending')}
                className="flex items-center gap-1 px-2 py-1 bg-green-600 text-white text-[10px] rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="w-3 h-3" />
                {t('applyAll', language)}
              </button>
            </div>

            {fileEdits.map(edit => (
              <div key={edit.path} className="border-b border-border-subtle">
                {/* File Header */}
                <div
                  className="flex items-center justify-between px-3 py-1.5 bg-background hover:bg-surface-hover cursor-pointer"
                  onClick={() => toggleEditExpanded(edit.path)}
                >
                  <div className="flex items-center gap-2">
                    {expandedEdits.has(edit.path) ? (
                      <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                    )}
                    <FileText className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs">{edit.path.split(/[\\/]/).pop()}</span>
                    {edit.status === 'applied' && (
                      <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded">{t('applied', language)}</span>
                    )}
                    {edit.status === 'rejected' && (
                      <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded">{t('rejected', language)}</span>
                    )}
                  </div>

                  {edit.status === 'pending' && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); applyEdit(edit) }}
                        className="px-2 py-0.5 bg-green-600 text-white text-[10px] rounded hover:bg-green-700 transition-colors"
                      >
                        {t('apply', language)}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); rejectEdit(edit.path) }}
                        className="px-2 py-0.5 bg-surface border border-border-subtle text-text-secondary text-[10px] rounded hover:bg-surface-hover transition-colors"
                      >
                        {t('reject', language)}
                      </button>
                    </div>
                  )}
                </div>

                {/* Diff Preview */}
                {expandedEdits.has(edit.path) && (
                  <div className="max-h-[300px] overflow-auto">
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
          </div>
        )}

        {/* Composer Service Changes - Agent Changes */}
        {composerState.currentSession && composerState.currentSession.changes.length > 0 && fileEdits.length === 0 && (
          <div className="flex-1 overflow-y-auto">
            {/* Header with stats */}
            <div className="px-4 py-2 flex items-center justify-between bg-surface-hover border-b border-border-subtle sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-muted">
                  {summary.total} {language === 'zh' ? '个文件' : 'files'}
                </span>
                <span className="text-xs text-green-400">+{composerState.currentSession.totalLinesAdded}</span>
                <span className="text-xs text-red-400">-{composerState.currentSession.totalLinesRemoved}</span>
                {summary.pending > 0 && (
                  <span className="px-1.5 py-0.5 bg-yellow-500/10 text-yellow-400 text-[10px] rounded">
                    {summary.pending} pending
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRejectAllComposer}
                  disabled={summary.pending === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-border-subtle text-text-muted text-xs rounded-lg hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  {language === 'zh' ? '全部拒绝' : 'Reject All'}
                </button>
                <button
                  onClick={handleAcceptAllComposer}
                  disabled={summary.pending === 0}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <CheckCheck className="w-3 h-3" />
                  {language === 'zh' ? '全部接受' : 'Accept All'}
                </button>
              </div>
            </div>

            {/* Grouped by directory */}
            {viewMode === 'grouped' ? (
              Array.from(groupedChanges.entries()).map(([dir, changes]) => (
                <div key={dir} className="border-b border-border-subtle">
                  {/* Directory Header */}
                  <div
                    className="flex items-center gap-2 px-4 py-2 bg-background/50 hover:bg-surface-hover cursor-pointer"
                    onClick={() => toggleDirExpanded(dir)}
                  >
                    {expandedDirs.has(dir) ? (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-text-muted" />
                    )}
                    <FolderOpen className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm text-text-secondary">{dir}</span>
                    <span className="text-xs text-text-muted">({changes.length})</span>
                  </div>

                  {/* Files in directory */}
                  {expandedDirs.has(dir) && changes.map(change => (
                    <div key={change.filePath} className="border-t border-border-subtle/50">
                      <div
                        className="flex items-center justify-between px-4 py-2 pl-10 bg-background hover:bg-surface-hover cursor-pointer"
                        onClick={() => toggleEditExpanded(change.filePath)}
                      >
                        <div className="flex items-center gap-2">
                          {expandedEdits.has(change.filePath) ? (
                            <ChevronDown className="w-3 h-3 text-text-muted" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-text-muted" />
                          )}
                          <FileText className="w-4 h-4 text-text-muted" />
                          <span className="text-sm">{change.filePath.split(/[\\/]/).pop()}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${change.changeType === 'create' ? 'bg-green-500/10 text-green-400' :
                            change.changeType === 'delete' ? 'bg-red-500/10 text-red-400' :
                              'bg-blue-500/10 text-blue-400'
                            }`}>
                            {change.changeType}
                          </span>
                          {change.status === 'accepted' && (
                            <span className="px-1.5 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded">✓</span>
                          )}
                          {change.status === 'rejected' && (
                            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[10px] rounded">✗</span>
                          )}
                        </div>

                        {change.status === 'pending' && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAcceptComposerChange(change.filePath) }}
                              className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRejectComposerChange(change.filePath) }}
                              className="px-2 py-1 bg-surface border border-border-subtle text-text-secondary text-xs rounded hover:bg-surface-hover transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Diff Preview */}
                      {expandedEdits.has(change.filePath) && change.oldContent !== null && change.newContent !== null && (
                        <div className="max-h-[250px] overflow-auto border-t border-border-subtle/30">
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
              ))
            ) : (
              // Flat view
              composerState.currentSession.changes.map(change => (
                <div key={change.filePath} className="border-b border-border-subtle">
                  <div
                    className="flex items-center justify-between px-4 py-2 bg-background hover:bg-surface-hover cursor-pointer"
                    onClick={() => toggleEditExpanded(change.filePath)}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-text-muted" />
                      <span className="text-sm">{change.relativePath}</span>
                    </div>
                    {change.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAcceptComposerChange(change.filePath) }}
                          className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                        >
                          Accept
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRejectComposerChange(change.filePath) }}
                          className="px-2 py-1 bg-surface border border-border-subtle text-xs rounded hover:bg-surface-hover"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
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

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        unsubscribers.forEach(unsub => unsub())
      }
    }

    unsubscribers.push(
      window.electronAPI.onLLMStream((chunk) => {
        if (chunk.type === 'text' && chunk.content) {
          result += chunk.content
        }
      })
    )

    unsubscribers.push(
      window.electronAPI.onLLMDone(() => {
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
      window.electronAPI.onLLMError((error) => {
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

    window.electronAPI.sendMessage({
      config,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: 'You are a helpful code editor assistant. Follow the response format exactly.',
    }).catch((err) => {
      if (!resolved) {
        cleanup()
        resolve({ success: false, error: err.message })
      }
    })
  })
}
