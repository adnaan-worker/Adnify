/**
 * Lint 检查 Hook
 */
import { useState, useCallback } from 'react'
import { logger } from '@utils/Logger'
import { lintService } from '@renderer/agent/services/lintService'
import type { LintError } from '@renderer/agent/types'
import type { editor } from 'monaco-editor'

export function useLintCheck() {
  const [lintErrors, setLintErrors] = useState<LintError[]>([])
  const [isLinting, setIsLinting] = useState(false)

  const runLintCheck = useCallback(async (
    filePath: string,
    editorRef: editor.IStandaloneCodeEditor | null,
    monacoRef: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api') | null
  ) => {
    if (!filePath) return

    setIsLinting(true)
    try {
      const { errors } = await lintService.getLintErrors(filePath, true)
      setLintErrors(errors)

      // 在编辑器中显示错误标记
      if (editorRef && monacoRef) {
        const model = editorRef.getModel()
        if (model) {
          const markers = errors.map(err => ({
            severity: err.severity === 'error'
              ? monacoRef.MarkerSeverity.Error
              : monacoRef.MarkerSeverity.Warning,
            message: `[${err.code}] ${err.message}`,
            startLineNumber: err.startLine ?? 1,
            startColumn: 1,
            endLineNumber: err.endLine ?? 1,
            endColumn: 1000,
          }))
          monacoRef.editor.setModelMarkers(model, 'lint', markers)
        }
      }
    } catch (e) {
      logger.ui.error('Lint check failed:', e)
    } finally {
      setIsLinting(false)
    }
  }, [])

  const clearLintErrors = useCallback(() => {
    setLintErrors([])
  }, [])

  const errorCount = lintErrors.filter(e => e.severity === 'error').length
  const warningCount = lintErrors.filter(e => e.severity === 'warning').length

  return {
    lintErrors,
    isLinting,
    runLintCheck,
    clearLintErrors,
    errorCount,
    warningCount,
  }
}
