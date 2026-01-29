/**
 * LSP IPC 处理器
 */

import { logger } from '@shared/utils/Logger'
import { toAppError } from '@shared/utils/errorHandler'
import { ipcMain } from 'electron'
import { lspManager, LanguageId } from '../lspManager'
import { EXTENSION_TO_LANGUAGE } from '@shared/languages'
import { 
  getLspServerStatus, 
  installServer,
  installBasicServers,
  getLspBinDir,
  getDefaultLspBinDir,
  setCustomLspBinDir,
} from '../lsp/installer'

function getLanguageId(filePath: string): LanguageId | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const lang = EXTENSION_TO_LANGUAGE[ext]
  // 只返回 LSP 支持的语言
  return lang as LanguageId | null
}

function getLanguageIdFromUri(uri: string): string {
  let filePath = uri
  if (uri.startsWith('file:///')) filePath = uri.slice(8)
  else if (uri.startsWith('file://')) filePath = uri.slice(7)
  try { filePath = decodeURIComponent(filePath) } catch { }
  return getLanguageId(filePath) || 'plaintext'
}

async function getServerForUri(uri: string, workspacePath: string): Promise<string | null> {
  let filePath = uri
  if (uri.startsWith('file:///')) filePath = uri.slice(8)
  else if (uri.startsWith('file://')) filePath = uri.slice(7)

  try { filePath = decodeURIComponent(filePath) } catch { }

  const languageId = getLanguageId(filePath)
  if (!languageId) return null

  // 使用智能根目录检测启动服务器
  return lspManager.ensureServerForFile(filePath, languageId, workspacePath)
}

// mainStore 引用，用于保存 LSP 配置
let _mainStore: any = null

export function registerLspHandlers(mainStore?: any): void {
  _mainStore = mainStore

  // 启动服务器
  ipcMain.handle('lsp:start', async (_, workspacePath: string) => {
    const success = await lspManager.startServer('typescript', workspacePath)
    return { success }
  })

  // 启动指定语言的服务器
  ipcMain.handle('lsp:startForLanguage', async (_, params: { languageId: LanguageId; workspacePath: string }) => {
    const serverName = await lspManager.ensureServerForLanguage(params.languageId, params.workspacePath)
    return { success: !!serverName, serverName }
  })

  // 停止服务器
  ipcMain.handle('lsp:stop', async () => {
    await lspManager.stopAllServers()
    return { success: true }
  })

  // 获取运行中的服务器
  ipcMain.handle('lsp:getRunningServers', () => lspManager.getRunningServers())

  // ============ 文档同步 ============

  ipcMain.handle('lsp:didOpen', async (_, params: { uri: string; languageId: string; version: number; text: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    // 跟踪文档打开状态
    lspManager.trackDocumentOpen(serverName, params.uri, params.languageId, params.version, params.text)

    lspManager.sendNotification(serverName, 'textDocument/didOpen', {
      textDocument: { uri: params.uri, languageId: params.languageId, version: params.version, text: params.text },
    })
  })

  ipcMain.handle('lsp:didChange', async (_, params: { uri: string; version: number; text: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    // 如果文档未在服务器上打开（可能服务器重启过），先打开它
    if (!lspManager.isDocumentOpen(serverName, params.uri)) {
      const languageId = getLanguageIdFromUri(params.uri)
      lspManager.trackDocumentOpen(serverName, params.uri, languageId, params.version, params.text)
      lspManager.sendNotification(serverName, 'textDocument/didOpen', {
        textDocument: { uri: params.uri, languageId, version: params.version, text: params.text },
      })
      return
    }

    // 更新跟踪状态
    lspManager.trackDocumentChange(serverName, params.uri, params.version, params.text)

    lspManager.sendNotification(serverName, 'textDocument/didChange', {
      textDocument: { uri: params.uri, version: params.version },
      contentChanges: [{ text: params.text }],
    })
  })

  ipcMain.handle('lsp:didClose', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    // 移除跟踪
    lspManager.trackDocumentClose(serverName, params.uri)

    lspManager.sendNotification(serverName, 'textDocument/didClose', {
      textDocument: { uri: params.uri },
    })
  })

  // 文档保存通知
  ipcMain.handle('lsp:didSave', async (_, params: { uri: string; text?: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return

    lspManager.sendNotification(serverName, 'textDocument/didSave', {
      textDocument: { uri: params.uri },
      text: params.text, // 可选，取决于 capability
    })
  })

  // ============ LSP 请求 ============

  const createPositionHandler = (method: string) => {
    return async (_: any, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
      const serverName = await getServerForUri(params.uri, params.workspacePath || '')
      if (!serverName) return null

      try {
        return await lspManager.sendRequest(serverName, method, {
          textDocument: { uri: params.uri },
          position: { line: params.line, character: params.character },
        })
      } catch {
        return null
      }
    }
  }

  ipcMain.handle('lsp:definition', createPositionHandler('textDocument/definition'))
  ipcMain.handle('lsp:typeDefinition', createPositionHandler('textDocument/typeDefinition'))
  ipcMain.handle('lsp:implementation', createPositionHandler('textDocument/implementation'))
  ipcMain.handle('lsp:hover', createPositionHandler('textDocument/hover'))
  ipcMain.handle('lsp:completion', createPositionHandler('textDocument/completion'))
  ipcMain.handle('lsp:signatureHelp', createPositionHandler('textDocument/signatureHelp'))
  ipcMain.handle('lsp:documentHighlight', createPositionHandler('textDocument/documentHighlight'))
  ipcMain.handle('lsp:prepareRename', createPositionHandler('textDocument/prepareRename'))

  ipcMain.handle('lsp:references', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/references', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        context: { includeDeclaration: true },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:completionResolve', async (_, item: any) => {
    const running = lspManager.getRunningServers()
    if (running.length === 0) return item

    try {
      return await lspManager.sendRequest(running[0], 'completionItem/resolve', item)
    } catch {
      return item
    }
  })

  ipcMain.handle('lsp:documentSymbol', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/documentSymbol', {
        textDocument: { uri: params.uri },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:workspaceSymbol', async (_, params: { query: string }) => {
    const running = lspManager.getRunningServers()
    if (running.length === 0) return []

    const results = await Promise.all(
      running.map(async (serverName) => {
        try {
          return await lspManager.sendRequest(serverName, 'workspace/symbol', { query: params.query })
        } catch {
          return []
        }
      })
    )
    return results.flat()
  })

  ipcMain.handle('lsp:rename', async (_, params: { uri: string; line: number; character: number; newName: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/rename', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        newName: params.newName,
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:codeAction', async (_, params: { uri: string; range: any; diagnostics?: any[]; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/codeAction', {
        textDocument: { uri: params.uri },
        range: params.range,
        context: { diagnostics: params.diagnostics || [], only: ['quickfix', 'refactor', 'source'] },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:formatting', async (_, params: { uri: string; options?: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/formatting', {
        textDocument: { uri: params.uri },
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:rangeFormatting', async (_, params: { uri: string; range: any; options?: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/rangeFormatting', {
        textDocument: { uri: params.uri },
        range: params.range,
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:foldingRange', async (_, params: { uri: string; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/foldingRange', {
        textDocument: { uri: params.uri },
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:inlayHint', async (_, params: { uri: string; range: any; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.sendRequest(serverName, 'textDocument/inlayHint', {
        textDocument: { uri: params.uri },
        range: params.range,
      })
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:getDiagnostics', (_, filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/')
    const uri = /^[a-zA-Z]:/.test(normalizedPath)
      ? `file:///${normalizedPath}`
      : `file://${normalizedPath}`
    return lspManager.getDiagnostics(uri)
  })

  // ============ Call Hierarchy 支持 ============

  ipcMain.handle('lsp:prepareCallHierarchy', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      return await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:incomingCalls', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      // 先获取 call hierarchy item
      const items = await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
      if (!items || items.length === 0) return []
      
      // 获取 incoming calls
      return await lspManager.getIncomingCalls(serverName, items[0])
    } catch {
      return null
    }
  })

  ipcMain.handle('lsp:outgoingCalls', async (_, params: { uri: string; line: number; character: number; workspacePath?: string }) => {
    const serverName = await getServerForUri(params.uri, params.workspacePath || '')
    if (!serverName) return null

    try {
      // 先获取 call hierarchy item
      const items = await lspManager.prepareCallHierarchy(serverName, params.uri, params.line, params.character)
      if (!items || items.length === 0) return []
      
      // 获取 outgoing calls
      return await lspManager.getOutgoingCalls(serverName, items[0])
    } catch {
      return null
    }
  })

  // ============ waitForDiagnostics 支持 ============

  ipcMain.handle('lsp:waitForDiagnostics', async (_, params: { uri: string }) => {
    try {
      await lspManager.waitForDiagnostics(params.uri)
      return { success: true }
    } catch {
      return { success: false }
    }
  })

  // ============ 智能根目录检测 ============

  ipcMain.handle('lsp:findBestRoot', async (_, params: { filePath: string; languageId: LanguageId; workspacePath: string }) => {
    try {
      return await lspManager.findBestRoot(params.filePath, params.languageId, params.workspacePath)
    } catch {
      return params.workspacePath
    }
  })

  ipcMain.handle('lsp:ensureServerForFile', async (_, params: { filePath: string; languageId: LanguageId; workspacePath: string }) => {
    const serverName = await lspManager.ensureServerForFile(params.filePath, params.languageId, params.workspacePath)
    return { success: !!serverName, serverName }
  })

  // ============ 文件监视通知 ============

  ipcMain.handle('lsp:didChangeWatchedFiles', async (_, params: { changes: Array<{ uri: string; type: number }>; workspacePath?: string }) => {
    const running = lspManager.getRunningServers()
    for (const serverKey of running) {
      lspManager.notifyDidChangeWatchedFiles(serverKey, params.changes)
    }
  })

  // ============ 获取支持的语言 ============

  ipcMain.handle('lsp:getSupportedLanguages', () => {
    return lspManager.getSupportedLanguages()
  })

  // ============ LSP 服务器安装管理 ============

  ipcMain.handle('lsp:getServerStatus', () => {
    return getLspServerStatus()
  })

  ipcMain.handle('lsp:getBinDir', () => {
    return getLspBinDir()
  })

  ipcMain.handle('lsp:getDefaultBinDir', () => {
    return getDefaultLspBinDir()
  })

  ipcMain.handle('lsp:setCustomBinDir', (_, customPath: string | null) => {
    setCustomLspBinDir(customPath)
    // 保存到配置文件
    if (_mainStore) {
      if (customPath) {
        _mainStore.set('lspSettings.customBinDir', customPath)
      } else {
        _mainStore.delete('lspSettings.customBinDir')
      }
    }
    return { success: true }
  })

  ipcMain.handle('lsp:installServer', async (_, serverType: string) => {
    try {
      return await installServer(serverType)
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  ipcMain.handle('lsp:installBasicServers', async () => {
    try {
      await installBasicServers()
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  })

  logger.lsp.info('[LSP IPC] Handlers registered')
}
