/**
 * 安全的 DiffEditor 包装组件
 * 解决 Monaco DiffEditor 在卸载时 TextModel 被提前销毁的问题
 */

import { useRef, useCallback, useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

interface SafeDiffEditorProps {
  original: string | undefined
  modified: string | undefined
  language: string
  options?: editor.IDiffEditorConstructionOptions
  onMount?: (editor: editor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => void
}

export function SafeDiffEditor({ original, modified, language, options, onMount }: SafeDiffEditorProps) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const isMountedRef = useRef(true)
  const [, setIsReady] = useState(false)

  // 跟踪组件挂载状态
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 在组件卸载时安全清理
  useEffect(() => {
    return () => {
      if (diffEditorRef.current) {
        try {
          // 延迟清理，让 Monaco 内部操作完成
          const editorToClean = diffEditorRef.current
          diffEditorRef.current = null
          
          // 使用 setTimeout 延迟清理，避免与 Monaco 内部操作冲突
          setTimeout(() => {
            try {
              const originalModel = editorToClean.getOriginalEditor()?.getModel()
              const modifiedModel = editorToClean.getModifiedEditor()?.getModel()
              
              // 设置空 model 避免 dispose 时的错误
              editorToClean.setModel(null)
              
              // 然后 dispose models
              originalModel?.dispose()
              modifiedModel?.dispose()
            } catch {
              // 忽略清理时的错误
            }
          }, 0)
        } catch {
          // 忽略清理时的错误
        }
      }
    }
  }, [])

  const handleMount = useCallback((editor: editor.IStandaloneDiffEditor, monacoInstance: typeof import('monaco-editor')) => {
    if (!isMountedRef.current) return
    
    diffEditorRef.current = editor
    setIsReady(true)
    onMount?.(editor, monacoInstance)
  }, [onMount])

  // 确保 original 和 modified 都有值
  const safeOriginal = original ?? ''
  const safeModified = modified ?? ''

  return (
    <DiffEditor
      height="100%"
      language={language}
      original={safeOriginal}
      modified={safeModified}
      theme="adnify-dynamic"
      options={options}
      onMount={handleMount}
      loading={<div className="flex items-center justify-center h-full text-text-muted">Loading diff...</div>}
    />
  )
}
