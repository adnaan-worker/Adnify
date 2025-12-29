/**
 * LSP IPC 处理器
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain } from 'electron'
import { lspManager, LanguageId } from '../lspManager'

// 文件扩展名到语言 ID 的映射
const EXT_TO_LANGUAGE: Record<string, LanguageId> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mjs: 'javascript',
  cjs: 'javascript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  jsonc: 'jsonc',
  py: 'python',  // Python 支持
  pyw: 'python',
}

function getLanguageId(filePath: string): LanguageId | null {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return EXT_TO_LANGUAGE[ext] || null
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

  return lspManager.ensureServerForLanguage(languageId, workspacePath)
}

export function registerLspHandlers(): void {
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

  logger.lsp.info('[LSP IPC] Handlers registered')
}
