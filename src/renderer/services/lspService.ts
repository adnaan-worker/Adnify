/**
 * LSP 服务 - 渲染进程端
 * 与主进程中的 TypeScript Language Server 通信
 */

// 文档版本追踪
const documentVersions = new Map<string, number>()

/**
 * 获取文件的语言 ID
 */
function getLanguageId(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    md: 'markdown',
    py: 'python',
  }
  return languageMap[ext] || 'plaintext'
}

/**
 * 将文件路径转换为 LSP URI
 * Windows: G:\path\file.ts -> file:///G:/path/file.ts
 */
export function pathToLspUri(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  // Windows 路径需要三个斜杠
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    return `file:///${normalizedPath}`
  }
  // Unix 路径
  return `file://${normalizedPath}`
}

/**
 * 将 LSP URI 转换为文件路径
 * file:///G:/path/file.ts -> G:\path\file.ts (Windows)
 */
export function lspUriToPath(uri: string): string {
  // 处理 Monaco URI 格式 (可能是 file:///g%3A/path 或 file:///G:/path)
  let path = uri
  
  // 移除 file:// 或 file:/// 前缀
  if (path.startsWith('file:///')) {
    path = path.slice(8)
  } else if (path.startsWith('file://')) {
    path = path.slice(7)
  }
  
  // URL 解码 (处理 %3A 等编码)
  try {
    path = decodeURIComponent(path)
  } catch {
    // 忽略解码错误
  }
  
  // Windows 路径转换 (检测盘符来判断是否是 Windows 路径)
  if (/^[a-zA-Z]:/.test(path)) {
    path = path.replace(/\//g, '\\')
  }
  
  return path
}

/**
 * 启动 LSP 服务器
 */
export async function startLspServer(workspacePath: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.lspStart(workspacePath)
    console.log('[LSP Client] Server started:', result)
    return result.success
  } catch (error) {
    console.error('[LSP Client] Failed to start server:', error)
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
    console.log('[LSP Client] Server stopped')
  } catch (error) {
    console.error('[LSP Client] Failed to stop server:', error)
  }
}

/**
 * 通知服务器文档已打开
 */
export async function didOpenDocument(filePath: string, content: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const languageId = getLanguageId(filePath)
  const version = 1
  
  documentVersions.set(uri, version)
  
  await window.electronAPI.lspDidOpen({
    uri,
    languageId,
    version,
    text: content,
  })
}

/**
 * 通知服务器文档已变更
 */
export async function didChangeDocument(filePath: string, content: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  const currentVersion = documentVersions.get(uri) || 0
  const newVersion = currentVersion + 1
  
  documentVersions.set(uri, newVersion)
  
  await window.electronAPI.lspDidChange({
    uri,
    version: newVersion,
    text: content,
  })
}

/**
 * 通知服务器文档已关闭
 */
export async function didCloseDocument(filePath: string): Promise<void> {
  const uri = pathToLspUri(filePath)
  documentVersions.delete(uri)
  
  await window.electronAPI.lspDidClose({ uri })
}

/**
 * 跳转到定义
 */
export async function goToDefinition(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[] | null> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspDefinition({
      uri,
      line,
      character,
    })
    
    if (!result) return null
    
    // 结果可能是单个位置或位置数组
    if (Array.isArray(result)) {
      return result
    }
    return [result]
  } catch (error) {
    console.error('[LSP Client] Definition error:', error)
    return null
  }
}

/**
 * 查找引用
 */
export async function findReferences(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspReferences({
      uri,
      line,
      character,
    })
    return result
  } catch (error) {
    console.error('[LSP Client] References error:', error)
    return null
  }
}

/**
 * 获取悬停信息
 */
export async function getHoverInfo(
  filePath: string,
  line: number,
  character: number
): Promise<{ contents: any; range?: any } | null> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspHover({
      uri,
      line,
      character,
    })
    return result
  } catch (error) {
    console.error('[LSP Client] Hover error:', error)
    return null
  }
}

/**
 * 获取代码补全
 */
export async function getCompletions(
  filePath: string,
  line: number,
  character: number
): Promise<any> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspCompletion({
      uri,
      line,
      character,
    })
    return result
  } catch (error) {
    console.error('[LSP Client] Completion error:', error)
    return null
  }
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
  
  try {
    const result = await window.electronAPI.lspRename({
      uri,
      line,
      character,
      newName,
    })
    return result
  } catch (error) {
    console.error('[LSP Client] Rename error:', error)
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
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspTypeDefinition({ uri, line, character })
    if (!result) return null
    return Array.isArray(result) ? result : [result]
  } catch (error) {
    console.error('[LSP Client] Type definition error:', error)
    return null
  }
}

/**
 * 跳转到实现
 */
export async function goToImplementation(
  filePath: string,
  line: number,
  character: number
): Promise<{ uri: string; range: any }[] | null> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspImplementation({ uri, line, character })
    if (!result) return null
    return Array.isArray(result) ? result : [result]
  } catch (error) {
    console.error('[LSP Client] Implementation error:', error)
    return null
  }
}

/**
 * 获取签名帮助
 */
export async function getSignatureHelp(
  filePath: string,
  line: number,
  character: number
): Promise<any> {
  const uri = pathToLspUri(filePath)
  
  try {
    return await window.electronAPI.lspSignatureHelp({ uri, line, character })
  } catch (error) {
    console.error('[LSP Client] Signature help error:', error)
    return null
  }
}

/**
 * 准备重命名（获取当前符号信息）
 */
export async function prepareRename(
  filePath: string,
  line: number,
  character: number
): Promise<{ range: any; placeholder: string } | null> {
  const uri = pathToLspUri(filePath)
  
  try {
    return await window.electronAPI.lspPrepareRename({ uri, line, character })
  } catch (error) {
    console.error('[LSP Client] Prepare rename error:', error)
    return null
  }
}

/**
 * 获取文档符号（大纲）
 */
export async function getDocumentSymbols(filePath: string): Promise<any[]> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspDocumentSymbol({ uri })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Document symbol error:', error)
    return []
  }
}

/**
 * 搜索工作区符号
 */
export async function searchWorkspaceSymbols(query: string): Promise<any[]> {
  try {
    const result = await window.electronAPI.lspWorkspaceSymbol({ query })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Workspace symbol error:', error)
    return []
  }
}

/**
 * 获取代码操作（快速修复、重构等）
 */
export async function getCodeActions(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  diagnostics?: any[]
): Promise<any[]> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspCodeAction({ uri, range, diagnostics })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Code action error:', error)
    return []
  }
}

/**
 * 格式化文档
 */
export async function formatDocument(
  filePath: string,
  options?: { tabSize?: number; insertSpaces?: boolean }
): Promise<any[]> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspFormatting({ uri, options })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Formatting error:', error)
    return []
  }
}

/**
 * 格式化选区
 */
export async function formatRange(
  filePath: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  options?: { tabSize?: number; insertSpaces?: boolean }
): Promise<any[]> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspRangeFormatting({ uri, range, options })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Range formatting error:', error)
    return []
  }
}

/**
 * 获取文档高亮（相同符号高亮）
 */
export async function getDocumentHighlights(
  filePath: string,
  line: number,
  character: number
): Promise<any[]> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspDocumentHighlight({ uri, line, character })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Document highlight error:', error)
    return []
  }
}

/**
 * 获取折叠范围
 */
export async function getFoldingRanges(filePath: string): Promise<any[]> {
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspFoldingRange({ uri })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Folding range error:', error)
    return []
  }
}

/**
 * 解析补全项（获取详细信息）
 */
export async function resolveCompletionItem(item: any): Promise<any> {
  try {
    return await window.electronAPI.lspCompletionResolve(item)
  } catch (error) {
    console.error('[LSP Client] Completion resolve error:', error)
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
  const uri = pathToLspUri(filePath)
  
  try {
    const result = await window.electronAPI.lspInlayHint({ uri, range })
    return result || []
  } catch (error) {
    console.error('[LSP Client] Inlay hint error:', error)
    return []
  }
}
