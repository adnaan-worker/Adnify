/**
 * LSP 集成 Hook
 */
import { useEffect, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { logger } from '@utils/Logger'
import {
  startLspServer,
  didOpenDocument,
  onDiagnostics,
} from '@services/lspService'
import { registerLspProviders } from '@services/lspProviders'
import { pathLinkService } from '@services/pathLinkService'
import { useDiagnosticsStore } from '@services/diagnosticsStore'
import type { editor } from 'monaco-editor'
import { LSP_SUPPORTED_LANGUAGES } from '@shared/languages'

// 路径链接支持的语言（包括 LSP 支持的语言 + markdown）
const PATH_LINK_LANGUAGES = [...LSP_SUPPORTED_LANGUAGES, 'markdown'] as string[]

export function useLspIntegration() {
  const workspacePath = useStore((state) => state.workspacePath)
  const isLspReady = useStore((state) => state.isLspReady)
  const setIsLspReady = useStore((state) => state.setIsLspReady)

  // 启动 LSP 服务器
  useEffect(() => {
    if (workspacePath && !isLspReady) {
      logger.ui.info('[LSP] Starting server for workspace:', workspacePath)
      startLspServer(workspacePath).then((success) => {
        if (success) {
          logger.ui.info('[LSP] Server started successfully')
          setIsLspReady(true)
        } else {
          logger.ui.warn('[LSP] Server failed to start')
        }
      })
    }
  }, [workspacePath, isLspReady, setIsLspReady])

  // 存储 provider disposables 用于清理
  const disposablesRef = useRef<import('monaco-editor').IDisposable[]>([])

  // 注册 LSP 提供者到 Monaco
  const registerProviders = useCallback((
    monaco: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api')
  ) => {
    // 清理旧的 providers
    disposablesRef.current.forEach(d => d.dispose())
    disposablesRef.current = []

    const lspDisposables = registerLspProviders(monaco as typeof import('monaco-editor'))
    if (Array.isArray(lspDisposables)) {
      disposablesRef.current.push(...lspDisposables)
    }

    // 注册路径链接提供者
    const linkDisposable = monaco.languages.registerLinkProvider(PATH_LINK_LANGUAGES, pathLinkService.createLinkProvider())
    disposablesRef.current.push(linkDisposable)
  }, [])

  // 组件卸载时清理 provider disposables
  useEffect(() => {
    return () => {
      disposablesRef.current.forEach(d => d.dispose())
      disposablesRef.current = []
    }
  }, [])

  // 设置诊断监听
  const setupDiagnostics = useCallback((
    monaco: typeof import('monaco-editor') | typeof import('monaco-editor/esm/vs/editor/editor.api')
  ) => {
    // 监听 LSP 诊断
    const unsubscribeLsp = onDiagnostics((uri, diagnostics) => {
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

    // 监听 Monaco 自己的诊断（TypeScript/JavaScript 等）
    // 同步 Monaco markers 到 diagnosticsStore
    const syncMonacoMarkers = () => {
      const models = monaco.editor.getModels()
      models.forEach(model => {
        const uri = model.uri.toString()
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })
        
        // 转换 Monaco markers 为 LSP 诊断格式
        const diagnostics = markers.map(marker => ({
          range: {
            start: {
              line: marker.startLineNumber - 1,
              character: marker.startColumn - 1
            },
            end: {
              line: marker.endLineNumber - 1,
              character: marker.endColumn - 1
            }
          },
          severity: marker.severity === monaco.MarkerSeverity.Error ? 1
            : marker.severity === monaco.MarkerSeverity.Warning ? 2
              : marker.severity === monaco.MarkerSeverity.Info ? 3
                : 4,
          message: marker.message,
          source: marker.source || 'monaco',
          code: typeof marker.code === 'object' && marker.code !== null 
            ? marker.code.value 
            : marker.code
        }))

        useDiagnosticsStore.getState().setDiagnostics(uri, diagnostics)
      })
    }

    // 初始同步
    syncMonacoMarkers()

    // 使用防抖的同步函数
    let syncTimeout: NodeJS.Timeout | null = null
    const debouncedSync = () => {
      if (syncTimeout) clearTimeout(syncTimeout)
      syncTimeout = setTimeout(syncMonacoMarkers, 500) // 500ms 防抖
    }

    // 监听 marker 变化事件（更高效）
    const markerDisposable = monaco.editor.onDidChangeMarkers(() => {
      debouncedSync()
    })

    return () => {
      unsubscribeLsp()
      markerDisposable.dispose()
      if (syncTimeout) clearTimeout(syncTimeout)
    }
  }, [])

  // 设置 Ctrl+Click 链接跳转
  const setupLinkNavigation = useCallback((editor: editor.IStandaloneCodeEditor) => {
    editor.onMouseDown((e) => {
      if (!e.event.ctrlKey && !e.event.metaKey) return

      const model = editor.getModel()
      if (!model) return

      const position = e.target.position
      if (!position) return

      const language = model.getLanguageId()
      const content = model.getValue()

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
  }, [])

  // 通知 LSP 文件已打开
  const notifyFileOpened = useCallback((filePath: string, content: string) => {
    if (isLspReady) {
      didOpenDocument(filePath, content)
    }
  }, [isLspReady])

  return {
    isLspReady,
    registerProviders,
    setupDiagnostics,
    setupLinkNavigation,
    notifyFileOpened,
  }
}
