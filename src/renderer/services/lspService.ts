/**
 * LSP 服务 - 渲染进程端
 * 支持多根目录工作区
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { EXTENSION_TO_LANGUAGE, LSP_SUPPORTED_LANGUAGES } from '@shared/languages'
import { toAppError } from '@shared/utils/errorHandler'

// 文档版本追踪
const documentVersions = new Map<string, number>()
const openedDocuments = new Set<string>()

// ===== 内部辅助函数 =====

/**
 * LSP 请求参数类型
 */
interface LspRequestParams {
  uri: string
  workspacePath: string | null
}

interface LspPositionParams extends LspRequestParams {
  line: number
  character: number
}

interface LspDocumentParams extends LspRequestParams {
  text: string
}

/**
 * 执行 LSP 请求的通用包装器
 * 处理 URI 转换、工作区路径获取、错误处理
 */
async function executeLspRequest<T>(
  filePath: string,
  request: (params: LspRequestParams) => Promise<T>,
  defaultValue: T
): Promise<T> {
  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  try {
    return await request({ uri, workspacePath })
  } catch {
    return defaultValue
  }
}

/**
 * 执行带位置参数的 LSP 请求
 */
async function executeLspPositionRequest<T>(
  filePath: string,
  line: number,
  character: number,
  request: (params: LspPositionParams) => Promise<T>,
  defaultValue: T
): Promise<T> {
  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  try {
    return await request({ uri, line, character, workspacePath })
  } catch {
    return defaultValue
  }
}

/**
 * 获取文件所属的工作区根目录
 */
export function getFileWorkspaceRoot(filePath: string): string | null {
  const { workspace } = useStore.getState()
  if (!workspace || workspace.roots.length === 0) return null

  // 找到最长匹配的根目录（处理嵌套情况）
  const normalizedPath = filePath.replace(/\\/g, '/')
  let bestMatch: string | null = null

  for (const root of workspace.roots) {
    const normalizedRoot = root.replace(/\\/g, '/')
    if (normalizedPath.startsWith(normalizedRoot)) {
      if (!bestMatch || normalizedRoot.length > bestMatch.length) {
        bestMatch = root
      }
    }
  }

  return bestMatch || workspace.roots[0]
}

/**
 * 获取文件的语言 ID
 */
export function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return EXTENSION_TO_LANGUAGE[ext] || 'plaintext'
}

/**
 * 检查语言是否支持 LSP
 */
export function isLanguageSupported(languageId: string): boolean {
  return (LSP_SUPPORTED_LANGUAGES as readonly string[]).includes(languageId)
}

/**
 * 将文件路径转换为 LSP URI
 */
export function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    return `file:///${normalizedPath}`
  }
  return `file://${normalizedPath}`
}

/**
 * 将 LSP URI 转换为文件路径
 */
export function lspUriToPath(uri: string): string {
  let path = uri
  if (path.startsWith('file:///')) path = path.slice(8)
  else if (path.startsWith('file://')) path = path.slice(7)
  try { path = decodeURIComponent(path) } catch { }
  if (/^[a-zA-Z]:/.test(path)) path = path.replace(/\//g, '\\')
  return path
}

/**
 * 启动 LSP 服务器
 */
export async function startLspServer(workspacePath: string): Promise<boolean> {
  try {
    const result = await api.lsp.start(workspacePath)
    return result.success
  } catch (err) {
    const error = toAppError(err)
    logger.lsp.error(`[LSP] Failed to start: ${error.code}`, error)
    return false
  }
}

/**
 * 停止 LSP 服务器
 */
export async function stopLspServer(): Promise<void> {
  try {
    await api.lsp.stop()
    documentVersions.clear()
    openedDocuments.clear()
  } catch (err) {
    const error = toAppError(err)
    logger.lsp.error(`[LSP] Failed to stop: ${error.code}`, error)
  }
}

/**
 * 重置 LSP 服务状态（工作区切换时调用）
 * 只清理客户端状态，不停止服务器
 */
export function resetLspState(): void {
  documentVersions.clear()
  openedDocuments.clear()
  logger.lsp.info('[LSP] State reset')
}

/**
 * 通知服务器文档已打开
 * 使用智能根目录检测来启动正确的 LSP 服务器
 */
export async function didOpenDocument(filePath: string, content: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  if (openedDocuments.has(uri)) {
    await didChangeDocument(filePath, content)
    return
  }

  const version = 1
  documentVersions.set(uri, version)
  openedDocuments.add(uri)

  const workspacePath = getFileWorkspaceRoot(filePath)
  
  // 使用智能根目录检测启动服务器
  // 这会根据语言类型找到最佳的项目根目录
  const params: LspDocumentParams & { languageId: string; version: number } = {
    uri,
    languageId,
    version,
    text: content,
    workspacePath,
  }
  await api.lsp.didOpen(params)
}

/**
 * 通知服务器文档已变更
 */
export async function didChangeDocument(filePath: string, content: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  const newVersion = (documentVersions.get(uri) || 0) + 1
  documentVersions.set(uri, newVersion)

  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspDocumentParams & { version: number } = {
    uri,
    version: newVersion,
    text: content,
    workspacePath,
  }
  await api.lsp.didChange(params)
}

/**
 * 通知服务器文档已关闭
 */
export async function didCloseDocument(filePath: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  documentVersions.delete(uri)
  openedDocuments.delete(uri)

  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspRequestParams = {
    uri,
    workspacePath,
  }
  await api.lsp.didClose(params)
}

/**
 * 通知服务器文档已保存
 */
export async function didSaveDocument(filePath: string, content?: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  const workspacePath = getFileWorkspaceRoot(filePath)
  const params: LspRequestParams & { text?: string } = {
    uri,
    text: content, // 可选：一些 LSP 需要保存时的文本内容
    workspacePath,
  }
  await api.lsp.didSave?.(params)
}

/**
 * 跳转到定义
 */
export async function goToDefinition(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    async (params) => {
      const result = await api.lsp.definition(params)
      if (!result) return null
      return Array.isArray(result) ? result : [result]
    },
    null
  )
}

/**
 * 查找引用
 */
export async function findReferences(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.references(params),
    null
  )
}

/**
 * 获取悬停信息
 */
export async function getHoverInfo(
  filePath: string,
  line: number,
  character: number
): Promise<{ contents: any; range?: any } | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.hover(params),
    null
  )
}

/**
 * 获取代码补全
 */
export async function getCompletions(
  filePath: string,
  line: number,
  character: number
): Promise<any> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.completion(params),
    null
  )
}

/**
 * 重命名符号
 */
export async function renameSymbol(
  filePath: string,
  line: number,
  character: number,
  newName: string
): Promise<any> {
  const uri = pathToLspUri(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  try {
    const params: LspPositionParams & { newName: string } = {
      uri,
      line,
      character,
      newName,
      workspacePath,
    }
    return await api.lsp.rename(params)
  } catch {
    return null
  }
}

/**
 * 监听诊断信息
 */
export function onDiagnostics(
  callback: (uri: string, diagnostics: any[]) => void
): () => void {
  return api.lsp.onDiagnostics((params: { uri: string; diagnostics: any[] }) => {
    callback(params.uri, params.diagnostics)
  })
}

/**
 * 跳转到类型定义
 */
export async function goToTypeDefinition(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    async (params) => {
      const result = await api.lsp.typeDefinition(params)
      if (!result) return null
      return Array.isArray(result) ? result : [result]
    },
    null
  )
}

/**
 * 跳转到实现
 */
export async function goToImplementation(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    async (params) => {
      const result = await api.lsp.implementation(params)
      if (!result) return null
      return Array.isArray(result) ? result : [result]
    },
    null
  )
}

/**
 * 获取签名帮助
 */
export async function getSignatureHelp(
  filePath: string,
  line: number,
  character: number
): Promise<any> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.signatureHelp(params),
    null
  )
}

/**
 * 准备重命名
 */
export async function prepareRename(
  filePath: string,
  line: number,
  character: number
): Promise<{ range: any; placeholder: string } | null> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.prepareRename(params),
    null
  )
}

/**
 * 获取文档符号（大纲）
 */
export async function getDocumentSymbols(filePath: string): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.documentSymbol(params),
    []
  ) as Promise<any[]>
}

/**
 * 搜索工作区符号
 */
export async function searchWorkspaceSymbols(query: string): Promise<any[]> {
  try {
    return await api.lsp.workspaceSymbol({ query }) || []
  } catch {
    return []
  }
}

/**
 * 获取代码操作
 */
export async function getCodeActions(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  diagnostics?: any[]
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.codeAction({ ...params, range, diagnostics }),
    []
  ) as Promise<any[]>
}

/**
 * 格式化文档
 */
export async function formatDocument(
  filePath: string,
  options?: { tabSize?: number; insertSpaces?: boolean }
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.formatting({ ...params, options }),
    []
  ) as Promise<any[]>
}

/**
 * 格式化选区
 */
export async function formatRange(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  options?: { tabSize?: number; insertSpaces?: boolean }
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.rangeFormatting({ ...params, range, options }),
    []
  ) as Promise<any[]>
}

/**
 * 获取文档高亮
 */
export async function getDocumentHighlights(
  filePath: string,
  line: number,
  character: number
): Promise<any[]> {
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => api.lsp.documentHighlight(params),
    []
  ) as Promise<any[]>
}

/**
 * 获取折叠范围
 */
export async function getFoldingRanges(filePath: string): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.foldingRange(params),
    []
  ) as Promise<any[]>
}

/**
 * 解析补全项
 */
export async function resolveCompletionItem(item: any): Promise<any> {
  try {
    return await api.lsp.completionResolve(item)
  } catch {
    return item
  }
}

/**
 * 获取内联提示
 */
export async function getInlayHints(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => api.lsp.inlayHint({ ...params, range }),
    []
  ) as Promise<any[]>
}

// ============ Call Hierarchy 支持 ============

/**
 * 准备调用层次结构
 * 返回指定位置的调用层次项
 */
export async function prepareCallHierarchy(
  filePath: string,
  line: number,
  character: number
): Promise<any[] | null> {
  // 使用类型扩展来访问可能存在的 Call Hierarchy API
  type LspApiWithCallHierarchy = typeof api.lsp & {
    prepareCallHierarchy?: (params: LspPositionParams) => Promise<any[] | null>
  }
  
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => (api.lsp as LspApiWithCallHierarchy).prepareCallHierarchy?.(params) ?? Promise.resolve(null),
    null
  )
}

/**
 * 获取调用当前函数的所有位置（谁调用了我）
 */
export async function getIncomingCalls(
  filePath: string,
  line: number,
  character: number
): Promise<any[] | null> {
  type LspApiWithCallHierarchy = typeof api.lsp & {
    incomingCalls?: (params: LspPositionParams) => Promise<any[] | null>
  }
  
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => (api.lsp as LspApiWithCallHierarchy).incomingCalls?.(params) ?? Promise.resolve(null),
    null
  )
}

/**
 * 获取当前函数调用的所有位置（我调用了谁）
 */
export async function getOutgoingCalls(
  filePath: string,
  line: number,
  character: number
): Promise<any[] | null> {
  type LspApiWithCallHierarchy = typeof api.lsp & {
    outgoingCalls?: (params: LspPositionParams) => Promise<any[] | null>
  }
  
  return executeLspPositionRequest(
    filePath, line, character,
    (params) => (api.lsp as LspApiWithCallHierarchy).outgoingCalls?.(params) ?? Promise.resolve(null),
    null
  )
}

// ============ waitForDiagnostics 支持 ============

/**
 * 等待指定文件的诊断信息
 * 用于在文件修改后等待 LSP 返回最新的诊断结果
 */
export async function waitForDiagnostics(filePath: string): Promise<boolean> {
  const uri = pathToLspUri(filePath)
  try {
    const result = await api.lsp.waitForDiagnostics({ uri })
    return result?.success || false
  } catch {
    return false
  }
}

// ============ 智能根目录检测 ============

/**
 * 获取文件的最佳工作区根目录
 * 根据语言类型智能检测项目根目录
 */
export async function findBestRoot(filePath: string): Promise<string | null> {
  const languageId = getLanguageId(filePath)
  const workspacePath = getFileWorkspaceRoot(filePath)
  if (!workspacePath) return null

  try {
    return await api.lsp.findBestRoot({ filePath, languageId, workspacePath })
  } catch {
    return workspacePath
  }
}

/**
 * 为指定文件启动 LSP 服务器（使用智能根目录检测）
 */
export async function ensureServerForFile(filePath: string): Promise<boolean> {
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return false

  const workspacePath = getFileWorkspaceRoot(filePath)
  if (!workspacePath) return false

  try {
    const result = await api.lsp.ensureServerForFile({ filePath, languageId, workspacePath })
    return result?.success || false
  } catch {
    return false
  }
}

// ============ 文件监视通知 ============

/**
 * 通知 LSP 服务器文件变化
 * type: 1 = Created, 2 = Changed, 3 = Deleted
 * 
 * 注意：此函数主要用于渲染进程手动触发通知
 * 文件监视器会自动调用主进程的 lspManager.notifyDidChangeWatchedFiles
 */
export async function notifyFileChanges(
  changes: Array<{ filePath: string; type: 1 | 2 | 3 }>
): Promise<void> {
  const lspChanges = changes.map(c => ({
    uri: pathToLspUri(c.filePath),
    type: c.type,
  }))

  try {
    await api.lsp.didChangeWatchedFiles({ changes: lspChanges })
  } catch {
    // 忽略错误
  }
}
