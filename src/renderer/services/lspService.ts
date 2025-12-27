/**
 * LSP 服务 - 渲染进程端
 * 支持多根目录工作区
 */

import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { EXTENSION_TO_LANGUAGE, LSP_SUPPORTED_LANGUAGES } from '@shared/languages'

// 文档版本追踪
const documentVersions = new Map<string, number>()
const openedDocuments = new Set<string>()

// ===== 内部辅助函数 =====

/**
 * 执行 LSP 请求的通用包装器
 * 处理 URI 转换、工作区路径获取、错误处理
 */
async function executeLspRequest<T>(
  filePath: string,
  request: (params: { uri: string; workspacePath: string | null }) => Promise<T>,
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
  request: (params: { uri: string; line: number; character: number; workspacePath: string | null }) => Promise<T>,
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
    const result = await window.electronAPI.lspStart(workspacePath)
    return result.success
  } catch (error) {
    logger.lsp.error('[LSP] Failed to start:', error)
    return false
  }
}

/**
 * 停止 LSP 服务器
 */
export async function stopLspServer(): Promise<void> {
  try {
    await window.electronAPI.lspStop()
    documentVersions.clear()
    openedDocuments.clear()
  } catch (error) {
    logger.lsp.error('[LSP] Failed to stop:', error)
  }
}

/**
 * 通知服务器文档已打开
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
  await window.electronAPI.lspDidOpen({
    uri,
    languageId,
    version,
    text: content,
    workspacePath,
  } as any)
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
  await window.electronAPI.lspDidChange({
    uri,
    version: newVersion,
    text: content,
    workspacePath,
  } as any)
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
  await window.electronAPI.lspDidClose({
    uri,
    workspacePath,
  } as any)
}

/**
 * 通知服务器文档已保存
 */
export async function didSaveDocument(filePath: string, content?: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  if (!isLanguageSupported(languageId)) return

  const workspacePath = getFileWorkspaceRoot(filePath)
  await window.electronAPI.lspDidSave?.({
    uri,
    text: content, // 可选：一些 LSP 需要保存时的文本内容
    workspacePath,
  } as any)
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
      const result = await window.electronAPI.lspDefinition(params as any)
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
    (params) => window.electronAPI.lspReferences(params as any),
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
    (params) => window.electronAPI.lspHover(params as any),
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
    (params) => window.electronAPI.lspCompletion(params as any),
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
    return await window.electronAPI.lspRename({ uri, line, character, newName, workspacePath } as any)
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
  return window.electronAPI.onLspDiagnostics((params) => {
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
      const result = await window.electronAPI.lspTypeDefinition(params as any)
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
      const result = await window.electronAPI.lspImplementation(params as any)
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
    (params) => window.electronAPI.lspSignatureHelp(params as any),
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
    (params) => window.electronAPI.lspPrepareRename(params as any),
    null
  )
}

/**
 * 获取文档符号（大纲）
 */
export async function getDocumentSymbols(filePath: string): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => window.electronAPI.lspDocumentSymbol(params as any),
    []
  ) as Promise<any[]>
}

/**
 * 搜索工作区符号
 */
export async function searchWorkspaceSymbols(query: string): Promise<any[]> {
  try {
    return await window.electronAPI.lspWorkspaceSymbol({ query }) || []
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
    (params) => window.electronAPI.lspCodeAction({ ...params, range, diagnostics } as any),
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
    (params) => window.electronAPI.lspFormatting({ ...params, options } as any),
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
    (params) => window.electronAPI.lspRangeFormatting({ ...params, range, options } as any),
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
    (params) => window.electronAPI.lspDocumentHighlight(params as any),
    []
  ) as Promise<any[]>
}

/**
 * 获取折叠范围
 */
export async function getFoldingRanges(filePath: string): Promise<any[]> {
  return executeLspRequest(
    filePath,
    (params) => window.electronAPI.lspFoldingRange(params as any),
    []
  ) as Promise<any[]>
}

/**
 * 解析补全项
 */
export async function resolveCompletionItem(item: any): Promise<any> {
  try {
    return await window.electronAPI.lspCompletionResolve(item)
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
    (params) => window.electronAPI.lspInlayHint({ ...params, range } as any),
    []
  ) as Promise<any[]>
}
