/**
 * Composer Panel - 多文件编辑模式
 * 类似 Cursor 的 Composer，支持同时编辑多个文件
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Sparkles, X, FileText, Plus,
  ChevronDown, ChevronRight, Check, AlertCircle,
  Loader2
} from 'lucide-react'
import { useStore } from '../store'
import DiffViewer from './DiffViewer'
import { t } from '../i18n'

interface FileEdit {
  path: string
  originalContent: string
  newContent: string
  status: 'pending' | 'applied' | 'rejected'
}

interface ComposerPanelProps {
  onClose: () => void
}

export default function ComposerPanel({ onClose }: ComposerPanelProps) {
  const { openFiles, activeFilePath, llmConfig, updateFileContent, language } = useStore()
  
  const [instruction, setInstruction] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [fileEdits, setFileEdits] = useState<FileEdit[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showFileSelector, setShowFileSelector] = useState(false)
  const [expandedEdits, setExpandedEdits] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
        const openFile = openFiles.find(f => f.path === filePath)
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
        <div className="px-4 py-3 border-b border-border-subtle bg-background/50">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-text-muted">{t('filesToEdit', language)}:</span>
            <button
              onClick={() => setShowFileSelector(!showFileSelector)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-surface border border-border-subtle rounded-lg hover:bg-surface-hover transition-colors"
            >
              <Plus className="w-3 h-3" />
              {t('addFile', language)}
            </button>
          </div>
          
          {/* File Selector Dropdown */}
          {showFileSelector && (
            <div className="absolute mt-1 w-64 max-h-48 overflow-y-auto bg-surface border border-border-subtle rounded-lg shadow-xl z-10">
              {openFiles.map(file => (
                <button
                  key={file.path}
                  onClick={() => addFile(file.path)}
                  disabled={selectedFiles.includes(file.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4 text-text-muted" />
                  <span className="truncate">{file.path.split(/[\\/]/).pop()}</span>
                </button>
              ))}
              {openFiles.length === 0 && (
                <div className="px-3 py-4 text-center text-text-muted text-sm">
                  {t('noOpenFiles', language)}
                </div>
              )}
            </div>
          )}
          
          {/* Selected Files List */}
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map(path => (
              <div
                key={path}
                className="flex items-center gap-1.5 px-2 py-1 bg-accent/10 text-accent text-xs rounded-lg border border-accent/20"
              >
                <FileText className="w-3 h-3" />
                <span className="truncate max-w-[150px]">{path.split(/[\\/]/).pop()}</span>
                <button
                  onClick={() => removeFile(path)}
                  className="p-0.5 hover:bg-accent/20 rounded"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {selectedFiles.length === 0 && (
              <span className="text-xs text-text-muted italic">{t('noFilesSelected', language)}</span>
            )}
          </div>
        </div>

        {/* Instruction Input */}
        <div className="px-4 py-3 border-b border-border-subtle">
          <textarea
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t('describeChanges', language)}
            className="w-full bg-surface border border-border-subtle rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none"
            rows={3}
            disabled={isGenerating}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handleGenerate()
              }
            }}
          />
          
          {error && (
            <div className="mt-2 flex items-center gap-2 text-xs text-status-error">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-text-muted">
              {t('filesSelected', language, { count: String(selectedFiles.length) })} • {t('ctrlEnterGenerate', language)}
            </span>
            <button
              onClick={handleGenerate}
              disabled={!instruction.trim() || selectedFiles.length === 0 || isGenerating}
              className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
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

        {/* File Edits Preview */}
        {fileEdits.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2 flex items-center justify-between bg-surface-hover border-b border-border-subtle sticky top-0">
              <span className="text-xs text-text-muted">
                {t('filesModified', language, { count: String(fileEdits.length) })}
              </span>
              <button
                onClick={applyAllEdits}
                disabled={fileEdits.every(e => e.status !== 'pending')}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="w-3 h-3" />
                {t('applyAll', language)}
              </button>
            </div>
            
            {fileEdits.map(edit => (
              <div key={edit.path} className="border-b border-border-subtle">
                {/* File Header */}
                <div
                  className="flex items-center justify-between px-4 py-2 bg-background hover:bg-surface-hover cursor-pointer"
                  onClick={() => toggleEditExpanded(edit.path)}
                >
                  <div className="flex items-center gap-2">
                    {expandedEdits.has(edit.path) ? (
                      <ChevronDown className="w-4 h-4 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-text-muted" />
                    )}
                    <FileText className="w-4 h-4 text-text-muted" />
                    <span className="text-sm">{edit.path.split(/[\\/]/).pop()}</span>
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
                        className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
                      >
                        {t('apply', language)}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); rejectEdit(edit.path) }}
                        className="px-2 py-1 bg-surface border border-border-subtle text-text-secondary text-xs rounded hover:bg-surface-hover transition-colors"
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
