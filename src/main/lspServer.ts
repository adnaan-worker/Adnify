/**
 * TypeScript Language Server 管理
 * 在主进程中启动和管理 TypeScript Language Server
 * 支持完整的 LSP 功能：悬停、补全、定义、引用、重命名、符号等
 */

import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { BrowserWindow, ipcMain } from 'electron'

let tsServer: ChildProcess | null = null
let requestId = 0
const pendingRequests = new Map<number, { resolve: Function; reject: Function }>()
let contentBuffer = ''
let contentLength = -1
let currentWorkspacePath: string | null = null

/**
 * 启动 TypeScript Language Server
 */
export function startLanguageServer(workspacePath: string): void {
  if (tsServer) {
    // 如果工作区相同，不需要重启
    if (currentWorkspacePath === workspacePath) {
      console.log('[LSP] Server already running for this workspace')
      return
    }
    // 工作区不同，先停止旧服务器
    stopLanguageServer()
  }

  currentWorkspacePath = workspacePath

  // 查找 typescript-language-server
  let tsServerPath: string
  try {
    tsServerPath = require.resolve('typescript-language-server/lib/cli.mjs')
  } catch {
    // 尝试其他路径
    try {
      tsServerPath = require.resolve('typescript-language-server/lib/cli.js')
    } catch {
      console.error('[LSP] typescript-language-server not found')
      return
    }
  }
  
  console.log('[LSP] Starting TypeScript Language Server...')
  console.log('[LSP] Server path:', tsServerPath)
  console.log('[LSP] Workspace:', workspacePath)

  tsServer = spawn('node', [tsServerPath, '--stdio'], {
    cwd: workspacePath,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  if (!tsServer.stdout || !tsServer.stdin) {
    console.error('[LSP] Failed to create server pipes')
    return
  }

  // 处理服务器输出
  tsServer.stdout.on('data', (data: Buffer) => {
    handleServerOutput(data.toString())
  })

  tsServer.stderr?.on('data', (data: Buffer) => {
    console.error('[LSP] Server error:', data.toString())
  })

  tsServer.on('close', (code) => {
    console.log('[LSP] Server closed with code:', code)
    tsServer = null
  })

  tsServer.on('error', (err) => {
    console.error('[LSP] Server error:', err)
    tsServer = null
  })

  // 初始化 LSP
  initializeServer(workspacePath)
}

/**
 * 处理服务器输出（LSP 协议）
 */
function handleServerOutput(data: string): void {
  contentBuffer += data

  while (true) {
    if (contentLength === -1) {
      // 解析 header
      const headerEnd = contentBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      const header = contentBuffer.substring(0, headerEnd)
      const match = header.match(/Content-Length: (\d+)/)
      if (match) {
        contentLength = parseInt(match[1], 10)
      }
      contentBuffer = contentBuffer.substring(headerEnd + 4)
    }

    if (contentLength === -1) return
    if (contentBuffer.length < contentLength) return

    // 解析消息
    const message = contentBuffer.substring(0, contentLength)
    contentBuffer = contentBuffer.substring(contentLength)
    contentLength = -1

    try {
      const json = JSON.parse(message)
      handleServerMessage(json)
    } catch (e) {
      console.error('[LSP] Failed to parse message:', e)
    }
  }
}

/**
 * 处理服务器消息
 */
function handleServerMessage(message: any): void {
  if (message.id !== undefined && pendingRequests.has(message.id)) {
    // 响应
    const { resolve, reject } = pendingRequests.get(message.id)!
    pendingRequests.delete(message.id)

    if (message.error) {
      reject(message.error)
    } else {
      resolve(message.result)
    }
  } else if (message.method) {
    // 通知或请求
    handleServerNotification(message)
  }
}

/**
 * 处理服务器通知
 */
function handleServerNotification(message: any): void {
  // 将诊断信息发送到渲染进程
  if (message.method === 'textDocument/publishDiagnostics') {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('lsp:diagnostics', message.params)
    })
  }
}

/**
 * 发送请求到服务器
 */
function sendRequest(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!tsServer?.stdin) {
      reject(new Error('Server not running'))
      return
    }

    const id = ++requestId
    pendingRequests.set(id, { resolve, reject })

    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    const content = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`

    tsServer.stdin.write(content)
  })
}

/**
 * 发送通知到服务器
 */
function sendNotification(method: string, params: any): void {
  if (!tsServer?.stdin) return

  const message = JSON.stringify({ jsonrpc: '2.0', method, params })
  const content = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`

  tsServer.stdin.write(content)
}

/**
 * 初始化服务器
 */
async function initializeServer(workspacePath: string): Promise<void> {
  try {
    // Windows 路径需要转换为正确的 file URI 格式
    // 例如: G:\path -> file:///G:/path
    const normalizedPath = workspacePath.replace(/\\/g, '/')
    const rootUri = normalizedPath.startsWith('/') 
      ? `file://${normalizedPath}` 
      : `file:///${normalizedPath}`
    
    await sendRequest('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            openClose: true,
            change: 2, // Incremental
            willSave: true,
            willSaveWaitUntil: true,
            save: { includeText: true },
          },
          completion: {
            dynamicRegistration: true,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true,
              insertReplaceSupport: true,
              labelDetailsSupport: true,
              resolveSupport: {
                properties: ['documentation', 'detail', 'additionalTextEdits'],
              },
            },
            contextSupport: true,
          },
          hover: {
            dynamicRegistration: true,
            contentFormat: ['markdown', 'plaintext'],
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true },
            },
            contextSupport: true,
          },
          definition: { dynamicRegistration: true, linkSupport: true },
          typeDefinition: { dynamicRegistration: true, linkSupport: true },
          implementation: { dynamicRegistration: true, linkSupport: true },
          references: { dynamicRegistration: true },
          documentHighlight: { dynamicRegistration: true },
          documentSymbol: {
            dynamicRegistration: true,
            symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) },
            hierarchicalDocumentSymbolSupport: true,
          },
          codeAction: {
            dynamicRegistration: true,
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  'quickfix', 'refactor', 'refactor.extract', 'refactor.inline',
                  'refactor.rewrite', 'source', 'source.organizeImports',
                ],
              },
            },
            isPreferredSupport: true,
            resolveSupport: { properties: ['edit'] },
          },
          codeLens: { dynamicRegistration: true },
          formatting: { dynamicRegistration: true },
          rangeFormatting: { dynamicRegistration: true },
          onTypeFormatting: { dynamicRegistration: true },
          rename: {
            dynamicRegistration: true,
            prepareSupport: true,
            prepareSupportDefaultBehavior: 1,
          },
          foldingRange: {
            dynamicRegistration: true,
            rangeLimit: 5000,
            lineFoldingOnly: true,
          },
          selectionRange: { dynamicRegistration: true },
          callHierarchy: { dynamicRegistration: true },
          semanticTokens: {
            dynamicRegistration: true,
            tokenTypes: [
              'namespace', 'type', 'class', 'enum', 'interface', 'struct',
              'typeParameter', 'parameter', 'variable', 'property', 'enumMember',
              'event', 'function', 'method', 'macro', 'keyword', 'modifier',
              'comment', 'string', 'number', 'regexp', 'operator',
            ],
            tokenModifiers: [
              'declaration', 'definition', 'readonly', 'static', 'deprecated',
              'abstract', 'async', 'modification', 'documentation', 'defaultLibrary',
            ],
            formats: ['relative'],
            requests: { range: true, full: { delta: true } },
            multilineTokenSupport: false,
            overlappingTokenSupport: false,
          },
          inlayHint: { dynamicRegistration: true },
        },
        workspace: {
          workspaceFolders: true,
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ['create', 'rename', 'delete'],
          },
          didChangeConfiguration: { dynamicRegistration: true },
          didChangeWatchedFiles: { dynamicRegistration: true },
          symbol: {
            dynamicRegistration: true,
            symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) },
          },
          executeCommand: { dynamicRegistration: true },
          configuration: true,
          semanticTokens: { refreshSupport: true },
          codeLens: { refreshSupport: true },
          inlayHint: { refreshSupport: true },
        },
        window: {
          workDoneProgress: true,
          showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
          showDocument: { support: true },
        },
        general: {
          staleRequestSupport: {
            cancel: true,
            retryOnContentModified: ['textDocument/semanticTokens/full', 'textDocument/semanticTokens/range'],
          },
        },
      },
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(workspacePath),
        },
      ],
    })

    console.log('[LSP] Server initialized with capabilities')

    // 发送 initialized 通知
    sendNotification('initialized', {})
  } catch (error) {
    console.error('[LSP] Failed to initialize server:', error)
  }
}

/**
 * 停止语言服务器
 */
export function stopLanguageServer(): void {
  if (tsServer) {
    sendRequest('shutdown', null)
      .then(() => {
        sendNotification('exit', null)
        tsServer?.kill()
        tsServer = null
      })
      .catch(() => {
        tsServer?.kill()
        tsServer = null
      })
  }
}

/**
 * 注册 IPC 处理器
 */
export function registerLspHandlers(): void {
  // 启动服务器
  ipcMain.handle('lsp:start', (_, workspacePath: string) => {
    startLanguageServer(workspacePath)
    return { success: true }
  })

  // 停止服务器
  ipcMain.handle('lsp:stop', () => {
    stopLanguageServer()
    return { success: true }
  })

  // 打开文档
  ipcMain.handle('lsp:didOpen', (_, params: { uri: string; languageId: string; version: number; text: string }) => {
    sendNotification('textDocument/didOpen', {
      textDocument: params,
    })
  })

  // 文档变更
  ipcMain.handle('lsp:didChange', (_, params: { uri: string; version: number; text: string }) => {
    sendNotification('textDocument/didChange', {
      textDocument: { uri: params.uri, version: params.version },
      contentChanges: [{ text: params.text }],
    })
  })

  // 关闭文档
  ipcMain.handle('lsp:didClose', (_, params: { uri: string }) => {
    sendNotification('textDocument/didClose', {
      textDocument: { uri: params.uri },
    })
  })

  // 跳转到定义
  ipcMain.handle('lsp:definition', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/definition', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Definition error:', error)
      return null
    }
  })

  // 查找引用
  ipcMain.handle('lsp:references', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/references', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        context: { includeDeclaration: true },
      })
      return result
    } catch (error) {
      console.error('[LSP] References error:', error)
      return null
    }
  })

  // 悬停信息
  ipcMain.handle('lsp:hover', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/hover', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Hover error:', error)
      return null
    }
  })

  // 代码补全
  ipcMain.handle('lsp:completion', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/completion', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Completion error:', error)
      return null
    }
  })

  // 重命名
  ipcMain.handle('lsp:rename', async (_, params: { uri: string; line: number; character: number; newName: string }) => {
    try {
      const result = await sendRequest('textDocument/rename', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
        newName: params.newName,
      })
      return result
    } catch (error) {
      console.error('[LSP] Rename error:', error)
      return null
    }
  })

  // 准备重命名（获取当前符号名称和范围）
  ipcMain.handle('lsp:prepareRename', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/prepareRename', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Prepare rename error:', error)
      return null
    }
  })

  // 文档符号（大纲）
  ipcMain.handle('lsp:documentSymbol', async (_, params: { uri: string }) => {
    try {
      const result = await sendRequest('textDocument/documentSymbol', {
        textDocument: { uri: params.uri },
      })
      return result
    } catch (error) {
      console.error('[LSP] Document symbol error:', error)
      return null
    }
  })

  // 工作区符号搜索
  ipcMain.handle('lsp:workspaceSymbol', async (_, params: { query: string }) => {
    try {
      const result = await sendRequest('workspace/symbol', {
        query: params.query,
      })
      return result
    } catch (error) {
      console.error('[LSP] Workspace symbol error:', error)
      return null
    }
  })

  // 签名帮助
  ipcMain.handle('lsp:signatureHelp', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/signatureHelp', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Signature help error:', error)
      return null
    }
  })

  // 代码操作（快速修复、重构等）
  ipcMain.handle('lsp:codeAction', async (_, params: { uri: string; range: any; diagnostics?: any[] }) => {
    try {
      const result = await sendRequest('textDocument/codeAction', {
        textDocument: { uri: params.uri },
        range: params.range,
        context: {
          diagnostics: params.diagnostics || [],
          only: ['quickfix', 'refactor', 'source'],
        },
      })
      return result
    } catch (error) {
      console.error('[LSP] Code action error:', error)
      return null
    }
  })

  // 格式化文档
  ipcMain.handle('lsp:formatting', async (_, params: { uri: string; options?: any }) => {
    try {
      const result = await sendRequest('textDocument/formatting', {
        textDocument: { uri: params.uri },
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
      return result
    } catch (error) {
      console.error('[LSP] Formatting error:', error)
      return null
    }
  })

  // 格式化选区
  ipcMain.handle('lsp:rangeFormatting', async (_, params: { uri: string; range: any; options?: any }) => {
    try {
      const result = await sendRequest('textDocument/rangeFormatting', {
        textDocument: { uri: params.uri },
        range: params.range,
        options: params.options || { tabSize: 2, insertSpaces: true },
      })
      return result
    } catch (error) {
      console.error('[LSP] Range formatting error:', error)
      return null
    }
  })

  // 跳转到类型定义
  ipcMain.handle('lsp:typeDefinition', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/typeDefinition', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Type definition error:', error)
      return null
    }
  })

  // 跳转到实现
  ipcMain.handle('lsp:implementation', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/implementation', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Implementation error:', error)
      return null
    }
  })

  // 文档高亮（相同符号高亮）
  ipcMain.handle('lsp:documentHighlight', async (_, params: { uri: string; line: number; character: number }) => {
    try {
      const result = await sendRequest('textDocument/documentHighlight', {
        textDocument: { uri: params.uri },
        position: { line: params.line, character: params.character },
      })
      return result
    } catch (error) {
      console.error('[LSP] Document highlight error:', error)
      return null
    }
  })

  // 折叠范围
  ipcMain.handle('lsp:foldingRange', async (_, params: { uri: string }) => {
    try {
      const result = await sendRequest('textDocument/foldingRange', {
        textDocument: { uri: params.uri },
      })
      return result
    } catch (error) {
      console.error('[LSP] Folding range error:', error)
      return null
    }
  })

  // 补全项解析（获取详细信息）
  ipcMain.handle('lsp:completionResolve', async (_, item: any) => {
    try {
      const result = await sendRequest('completionItem/resolve', item)
      return result
    } catch (error) {
      console.error('[LSP] Completion resolve error:', error)
      return item
    }
  })

  // 内联提示
  ipcMain.handle('lsp:inlayHint', async (_, params: { uri: string; range: any }) => {
    try {
      const result = await sendRequest('textDocument/inlayHint', {
        textDocument: { uri: params.uri },
        range: params.range,
      })
      return result
    } catch (error) {
      console.error('[LSP] Inlay hint error:', error)
      return null
    }
  })
}
