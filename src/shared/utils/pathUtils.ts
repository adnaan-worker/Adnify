/**
 * 共享路径工具函数
 * 用于 main 和 renderer 进程
 */

import {
  isSensitivePath as sharedIsSensitivePath,
  hasPathTraversal as sharedHasPathTraversal,
} from '@shared/constants'

// ============ 安全验证函数 ============

export const hasPathTraversal = sharedHasPathTraversal
export const isSensitivePath = sharedIsSensitivePath

export function isPathInWorkspace(path: string, workspacePath: string): boolean {
  if (!workspacePath) return false

  // 清理路径中的 "./" 前缀
  let cleanPath = path
  if (cleanPath.startsWith('./') || cleanPath.startsWith('.\\')) {
    cleanPath = cleanPath.slice(2)
  }

  const normalizedPath = normalizePath(cleanPath)
  const normalizedWorkspace = normalizePath(workspacePath)

  // 如果路径已经是绝对路径且在 workspace 内
  if (normalizedPath.startsWith(normalizedWorkspace)) {
    return true
  }

  // 如果是相对路径，转换为绝对路径后检查
  const resolvedPath = normalizePath(toFullPath(cleanPath, workspacePath))
  return resolvedPath.startsWith(normalizedWorkspace)
}

export interface PathValidationResult {
  valid: boolean
  error?: string
  sanitizedPath?: string
}

export function validatePath(
  path: string,
  workspacePath: string | null,
  options?: { allowSensitive?: boolean; allowOutsideWorkspace?: boolean }
): PathValidationResult {
  const { allowSensitive = false, allowOutsideWorkspace = false } = options || {}
  if (!path || typeof path !== 'string') {
    return { valid: false, error: 'Invalid path: empty or not a string' }
  }
  if (hasPathTraversal(path)) {
    return { valid: false, error: 'Path traversal detected' }
  }
  if (!allowSensitive && isSensitivePath(path)) {
    return { valid: false, error: 'Access to sensitive path denied' }
  }
  if (!allowOutsideWorkspace && workspacePath && !isPathInWorkspace(path, workspacePath)) {
    return { valid: false, error: 'Path is outside workspace' }
  }
  return { valid: true, sanitizedPath: toFullPath(path, workspacePath) }
}

// ============ 基础路径函数 ============

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** 路径比较（忽略大小写和分隔符差异） */
export function pathEquals(path1: string, path2: string): boolean {
  return normalizePath(path1).toLowerCase() === normalizePath(path2).toLowerCase()
}

/** 路径前缀比较（忽略大小写和分隔符差异） */
export function pathStartsWith(path: string, prefix: string): boolean {
  const normalizedPath = normalizePath(path).toLowerCase()
  const normalizedPrefix = normalizePath(prefix).toLowerCase()
  // 确保前缀以 / 结尾或完全匹配
  if (normalizedPath === normalizedPrefix) return true
  const prefixWithSlash = normalizedPrefix.endsWith('/') ? normalizedPrefix : normalizedPrefix + '/'
  return normalizedPath.startsWith(prefixWithSlash)
}

export function getPathSeparator(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}

export function getFileName(path: string | undefined | null): string {
  if (!path) return ''
  return path.split(/[/\\]/).pop() || ''
}

export const getBasename = getFileName

export function getDirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
}

export const getDirPath = getDirname

export function getExtension(path: string): string {
  const fileName = getFileName(path)
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex > 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

export function joinPaths(...parts: string[]): string {
  return parts.map(p => p.replace(/\\/g, '/')).join('/').replace(/\/+/g, '/')
}

export function joinPath(...parts: string[]): string {
  if (parts.length === 0) return ''
  const sep = getPathSeparator(parts[0])
  return parts.filter(Boolean).join(sep).replace(/[/\\]+/g, sep)
}

export function toFullPath(relativePath: string, workspacePath: string | null): string {
  if (!workspacePath) return relativePath

  // 已经是绝对路径
  if (relativePath.startsWith('/') || /^[a-zA-Z]:/.test(relativePath)) return relativePath

  // 处理 "./" 和 "." 开头的路径
  let cleanPath = relativePath
  if (cleanPath === '.') {
    return workspacePath
  }
  if (cleanPath.startsWith('./')) {
    cleanPath = cleanPath.slice(2)
  }
  if (cleanPath.startsWith('.\\')) {
    cleanPath = cleanPath.slice(2)
  }

  // 如果清理后是空字符串，返回 workspace 路径
  if (!cleanPath) return workspacePath

  const sep = getPathSeparator(workspacePath)
  return `${workspacePath}${sep}${cleanPath}`
}

export function toRelativePath(fullPath: string, workspacePath: string | null): string {
  if (!workspacePath) return fullPath
  const normalizedFull = normalizePath(fullPath)
  const normalizedWorkspace = normalizePath(workspacePath)
  if (normalizedFull.startsWith(normalizedWorkspace)) {
    let relative = fullPath.slice(workspacePath.length)
    if (relative.startsWith('/') || relative.startsWith('\\')) relative = relative.slice(1)
    return relative
  }
  return fullPath
}

export function pathMatches(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedPattern = normalizePath(pattern)
  if (normalizedPattern.includes('*')) {
    const regex = new RegExp('^' + normalizedPattern.replace(/\*/g, '.*') + '$')
    return regex.test(normalizedPath)
  }
  return normalizedPath === normalizedPattern || normalizedPath.endsWith('/' + normalizedPattern)
}

export function resolveImportPath(importPath: string, currentFilePath: string, workspacePath: string): string {
  const sep = getPathSeparator(currentFilePath)
  const currentDir = getDirname(currentFilePath)
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const parts = [...currentDir.split(/[/\\]/), ...importPath.split(/[/\\]/)]
    const resolved: string[] = []
    for (const part of parts) {
      if (part === '..') resolved.pop()
      else if (part !== '.' && part !== '') resolved.push(part)
    }
    return resolved.join(sep)
  }
  if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
    return joinPath(workspacePath, importPath.slice(2))
  }
  if (!importPath.startsWith('/')) {
    return joinPath(workspacePath, 'src', importPath)
  }
  return importPath
}

// ============ 跨平台工具函数 ============

/**
 * 平台检测
 */
export const platform = {
  isWindows: typeof process !== 'undefined' && process.platform === 'win32',
  isMac: typeof process !== 'undefined' && process.platform === 'darwin',
  isLinux: typeof process !== 'undefined' && process.platform === 'linux',
}

/**
 * 获取可执行文件名（Windows 自动添加 .exe 扩展名）
 * @example getExecutableName('gopls') => 'gopls.exe' (Windows) / 'gopls' (Unix)
 */
export function getExecutableName(name: string): string {
  return platform.isWindows ? `${name}.exe` : name
}

/**
 * 获取 npm 命令（Windows 使用 npm.cmd）
 */
export function getNpmCommand(): string {
  return platform.isWindows ? 'npm.cmd' : 'npm'
}

/**
 * 获取 npx 命令（Windows 使用 npx.cmd）
 */
export function getNpxCommand(): string {
  return platform.isWindows ? 'npx.cmd' : 'npx'
}

/**
 * 路径转为 file:// URI 格式
 * @example pathToUri('C:/foo/bar.ts') => 'file:///C:/foo/bar.ts'
 */
export function pathToUri(filePath: string): string {
  const normalized = normalizePath(filePath)
  // Windows 绝对路径：C:/...
  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${normalized}`
  }
  // Unix 绝对路径：/home/...
  return `file://${normalized}`
}

/**
 * file:// URI 转为路径格式
 * @example uriToPath('file:///C:/foo/bar.ts') => 'C:/foo/bar.ts'
 */
export function uriToPath(uri: string): string {
  if (uri.startsWith('file:///')) {
    const path = uri.slice(8)
    // Windows 路径: file:///C:/...
    if (/^[a-zA-Z]:/.test(path)) {
      return path
    }
    // Unix 路径: file:///home/... (需要保留前导 /)
    return '/' + path
  }
  if (uri.startsWith('file://')) {
    return uri.slice(7)
  }
  return uri
}

