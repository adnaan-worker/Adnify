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

export function SafeDiffEditor({
  original,
  modified,
  language,
  options,
  onMount
}: SafeDiffEditorProps) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const isMountedRef = useRef(true)
  const [editorKey] = useState(() => Date.now())
  const [shouldRender, setShouldRender] = useState(true)

  useEffect(() => {
    isMountedRef.current = true
    setShouldRender(true)
    return () => {
      isMountedRef.current = false
      // 在 React 卸载前，先清理 DiffEditor 的 model
      if (diffEditorRef.current) {
        try {
          // 先将 model 设为 null，避免 dispose 时的错误
          diffEditorRef.current.setModel(null)
        } catch {
          // 忽略错误
        }
        diffEditorRef.current = null
      }
      setShouldRender(false)
    }
  }, [])

  const handleMount = useCallback(
    (ed: editor.IStandaloneDiffEditor, monacoInstance: typeof import('monaco-editor')) => {
      if (!isMountedRef.current) return
      diffEditorRef.current = ed
      onMount?.(ed, monacoInstance)
    },
    [onMount]
  )

  const safeOriginal = original ?? ''
  const safeModified = modified ?? ''

  if (!shouldRender) {
    return null
  }

  return (
    <DiffEditor
      key={editorKey}
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
