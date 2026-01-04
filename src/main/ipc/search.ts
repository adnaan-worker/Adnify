/**
 * 搜索 IPC handlers
 * 使用 ripgrep 进行高性能搜索
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain, app } from 'electron'
import { spawn } from 'child_process'
import { rgPath } from '@vscode/ripgrep'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 获取 ripgrep 可执行文件路径
 * 打包后需要从 app.asar.unpacked 中获取
 */
function getRgPath(): string {
  if (!app.isPackaged) {
    return rgPath
  }
  
  // 打包环境：ripgrep 在 asar.unpacked 中
  const unpackedPath = rgPath.replace('app.asar', 'app.asar.unpacked')
  return fs.existsSync(unpackedPath) ? unpackedPath : rgPath
}

interface SearchFilesOptions {
  isRegex: boolean
  isCaseSensitive: boolean
  isWholeWord?: boolean
  include?: string
  exclude?: string
}

interface SearchFileResult {
  path: string
  line: number
  text: string
}

/** 默认忽略的目录 */
const DEFAULT_IGNORES = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']

/** 搜索超时时间 (ms) */
const SEARCH_TIMEOUT = 30000

/**
 * 在单个目录中搜索文件
 */
async function searchInDirectory(
  query: string,
  rootPath: string,
  options: SearchFilesOptions
): Promise<SearchFileResult[]> {
  if (!query || !rootPath) return []

  // 规范化路径，确保 Windows 路径正确
  const normalizedPath = path.normalize(rootPath)

  return new Promise((resolve) => {
    const args = buildRipgrepArgs(query, normalizedPath, options)
    const actualRgPath = getRgPath()
    const rg = spawn(actualRgPath, args)
    
    let output = ''
    let hasError = false

    rg.stdout.on('data', (data) => {
      output += data.toString()
    })

    rg.stderr.on('data', (data) => {
      hasError = true
      logger.ipc.error('[ripgrep]', data.toString().trim())
    })

    rg.on('close', (code) => {
      // code 0 = 有匹配, 1 = 无匹配, 2+ = 错误
      if (code && code > 1 && hasError) {
        logger.ipc.warn('[ripgrep] exited with code:', code)
      }
      resolve(parseRipgrepOutput(output, normalizedPath))
    })

    rg.on('error', (err) => {
      logger.ipc.error('[ripgrep] spawn error:', err.message)
      resolve([])
    })

    // 超时保护
    setTimeout(() => {
      if (!rg.killed) {
        logger.ipc.warn('[ripgrep] timeout, killing process')
        rg.kill()
      }
    }, SEARCH_TIMEOUT)
  })
}

/**
 * 构建 ripgrep 命令参数
 */
function buildRipgrepArgs(query: string, rootPath: string, options: SearchFilesOptions): string[] {
  const args = [
    '--json',
    '--max-count', '2000',
    '--max-filesize', '1M',
  ]

  // 大小写敏感
  args.push(options?.isCaseSensitive ? '--case-sensitive' : '--smart-case')

  // 搜索模式
  if (options?.isWholeWord) args.push('--word-regexp')
  if (!options?.isRegex) args.push('--fixed-strings')

  // 忽略目录
  DEFAULT_IGNORES.forEach(glob => args.push('--glob', `!${glob}`))

  // 自定义过滤
  if (options?.exclude) {
    options.exclude.split(',').forEach(ex => args.push('--glob', `!${ex.trim()}`))
  }
  if (options?.include) {
    options.include.split(',').forEach(inc => args.push('--glob', inc.trim()))
  }

  args.push('--', query, rootPath)
  return args
}

/**
 * 解析 ripgrep JSON 输出
 */
function parseRipgrepOutput(output: string, rootPath: string): SearchFileResult[] {
  const results: SearchFileResult[] = []

  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    try {
      const json = JSON.parse(line)
      if (json.type === 'match') {
        let filePath = json.data.path.text
        // 转换为相对路径
        if (filePath.startsWith(rootPath)) {
          filePath = filePath.slice(rootPath.length).replace(/^[/\\]+/, '')
        }
        results.push({
          path: filePath,
          line: json.data.line_number,
          text: json.data.lines.text.trim().slice(0, 500),
        })
      }
    } catch {
      // 忽略解析错误
    }
  }

  return results
}

export function registerSearchHandlers() {
  ipcMain.handle('file:search', async (
    _event,
    query: string,
    rootPath: string | string[],
    options: SearchFilesOptions
  ) => {
    const roots = Array.isArray(rootPath) ? rootPath : [rootPath]

    try {
      const allResults = await Promise.all(
        roots.map(root => searchInDirectory(query, root, options))
      )
      return allResults.flat()
    } catch (error) {
      logger.ipc.error('[Search] failed:', error)
      return []
    }
  })
}
