/**
 * AI 代码补全 Hook
 */
import { useCallback, useEffect, useRef } from 'react'
import { completionService } from '@services/completionService'
import { getEditorConfig } from '@renderer/settings'

const SUPPORTED_LANGUAGES = [
  'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
  'html', 'css', 'json', 'python', 'java', 'go', 'rust'
]

export function useAICompletion(activeFilePath: string | null) {
  const providerRef = useRef<import('monaco-editor').IDisposable | null>(null)

  const registerProvider = useCallback((monaco: typeof import('monaco-editor')) => {
    // 清理旧的 provider
    providerRef.current?.dispose()

    providerRef.current = monaco.languages.registerInlineCompletionsProvider(
      SUPPORTED_LANGUAGES,
      {
        provideInlineCompletions: async (model, position, _context, token) => {
          if (!getEditorConfig().ai?.completionEnabled) return { items: [] }

          // Debounce
          await new Promise(resolve => setTimeout(resolve, 300))
          if (token.isCancellationRequested) return { items: [] }

          const completionContext = completionService.buildContext(
            activeFilePath || model.uri.fsPath,
            model.getValue(),
            { line: position.lineNumber - 1, column: position.column - 1 }
          )

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
          } catch {
            return { items: [] }
          }
        },
        // Monaco 0.55+ 需要这个方法
        handleItemDidShow() {},
        disposeInlineCompletions() {}
      }
    )

    return () => providerRef.current?.dispose()
  }, [activeFilePath])

  // 文件切换时取消补全
  useEffect(() => {
    completionService.cancel()
  }, [activeFilePath])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      completionService.cancel()
      providerRef.current?.dispose()
    }
  }, [])

  return { registerProvider }
}
