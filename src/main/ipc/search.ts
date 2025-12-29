/**
 * 搜索 IPC handlers
 * 使用 ripgrep 进行高性能搜索
 */

import { logger } from '@shared/utils/Logger'
import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { rgPath } from '@vscode/ripgrep'

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

/**
 * 在单个目录中搜索文件
 */
async function searchInDirectory(
  query: string,
  rootPath: string,
  options: SearchFilesOptions
): Promise<SearchFileResult[]> {
  if (!query || !rootPath) return []

  return new Promise((resolve) => {
    const args = [
      '--json',
      '--max-count', '2000',
      '--max-filesize', '1M',
    ]

    if (options?.isCaseSensitive) {
      args.push('--case-sensitive')
    } else {
      args.push('--smart-case')
    }

    if (options?.isWholeWord) args.push('--word-regexp')
    if (!options?.isRegex) args.push('--fixed-strings')

    // 默认忽略
    const defaultIgnores = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
    defaultIgnores.forEach(glob => args.push('--glob', `!${glob}`))

    if (options?.exclude) {
      options.exclude.split(',').forEach(ex => args.push('--glob', `!${ex.trim()}`))
    }
    if (options?.include) {
      options.include.split(',').forEach(inc => args.push('--glob', inc.trim()))
    }

    args.push('--', query, rootPath)

    const rg = spawn(rgPath, args)
    let output = ''

    rg.stdout.on('data', (data) => {
      output += data.toString()
    })

    rg.stderr.on('data', (data) => {
      logger.ipc.error('[ripgrep]', data.toString())
    })

    rg.on('close', () => {
      const results: SearchFileResult[] = []
      const lines = output.split('\n')

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line)
          if (json.type === 'match') {
            // 转换为相对路径
            let filePath = json.data.path.text
            if (filePath.startsWith(rootPath)) {
              filePath = filePath.slice(rootPath.length).replace(/^[/\\]+/, '')
            }
            results.push({
              path: filePath,
              line: json.data.line_number,
              text: json.data.lines.text.trim().slice(0, 500),
            })
          }
        } catch { }
      }
      resolve(results)
    })

    rg.on('error', (err) => {
      logger.ipc.error('[ripgrep] spawn error:', err)
      resolve([])
    })
  })
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
      const allResults = await Promise.all(roots.map(root =>
        searchInDirectory(query, root, options)
      ))

      // 合并结果并去重（如果需要）
      return allResults.flat()
    } catch (error) {
      logger.ipc.error('[Search] Multi-root search failed:', error)
      return []
    }
  })
}
