/**
 * 路径链接服务
 * 统一处理所有文件类型的路径跳转（import、href、src、url() 等）
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type { languages, editor, IRange } from 'monaco-editor'
import { getPathSeparator, getDirPath, joinPath } from '@shared/utils/pathUtils'
import { useStore } from '@store'

// ============ 类型定义 ============

export interface PathLink {
  path: string
  range: IRange
  tooltip?: string
}

interface PathPattern {
  // 支持的语言
  languages: string[]
  // 正则表达式（必须有一个捕获组用于提取路径）
  pattern: RegExp
  // 是否需要过滤外部链接
  filterExternal?: boolean
  // 尝试的扩展名列表
  extensions?: string[]
}

// ============ 路径模式配置 ============

const PATH_PATTERNS: PathPattern[] = [
  // JS/TS import/require
  {
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    pattern: /(?:import|export)\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    extensions: ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'],
  },
  // HTML href/src 等属性
  {
    languages: ['html', 'htm', 'vue', 'svelte'],
    pattern: /(?:href|src|data-src|action|poster)\s*=\s*["']([^"']+)["']/gi,
    filterExternal: true,
    extensions: [''],
  },
  // HTML srcset (多个路径)
  {
    languages: ['html', 'htm', 'vue', 'svelte'],
    pattern: /srcset\s*=\s*["']([^"']+)["']/gi,
    filterExternal: true,
    extensions: [''],
  },
  // CSS url()
  {
    languages: ['css', 'scss', 'less'],
    pattern: /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    filterExternal: true,
    extensions: [''],
  },
  // Markdown 链接和图片
  {
    languages: ['markdown'],
    pattern: /!?\[.*?\]\(([^)]+)\)/g,
    filterExternal: true,
    extensions: [''],
  },
]

// 外部链接前缀
const EXTERNAL_PREFIXES = [
  'http://', 'https://', '//', 'data:', 'javascript:', 
  'mailto:', 'tel:', '#', 'blob:', 'about:'
]

// ============ 工具函数 ============

function isExternalPath(path: string): boolean {
  const lowerPath = path.toLowerCase()
  return EXTERNAL_PREFIXES.some(prefix => lowerPath.startsWith(prefix))
}

function normalizePath(targetPath: string, sep: string): string {
  const parts = targetPath.split(sep === '\\' ? /[\\/]/ : /\//)
  const normalized: string[] = []
  
  for (const part of parts) {
    if (part === '..') {
      normalized.pop()
    } else if (part !== '.' && part !== '') {
      normalized.push(part)
    }
  }
  
  return normalized.join(sep)
}

// ============ PathLinkService ============

class PathLinkService {
  /**
   * 从文本中提取所有可跳转的路径链接
   */
  extractLinks(content: string, language: string): PathLink[] {
    const links: PathLink[] = []
    const lines = content.split('\n')
    
    // 找到适用于当前语言的所有模式
    const applicablePatterns = PATH_PATTERNS.filter(p => 
      p.languages.includes(language)
    )
    
    if (applicablePatterns.length === 0) return links

    for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
      const lineContent = lines[lineNumber]
      
      for (const patternConfig of applicablePatterns) {
        // 重置正则的 lastIndex
        const regex = new RegExp(patternConfig.pattern.source, patternConfig.pattern.flags)
        let match
        
        while ((match = regex.exec(lineContent)) !== null) {
          // 获取捕获的路径（可能在不同的捕获组中）
          const capturedPath = match[1] || match[2]
          if (!capturedPath) continue
          
          // 过滤外部链接
          if (patternConfig.filterExternal && isExternalPath(capturedPath)) {
            continue
          }
          
          // 处理 srcset（可能包含多个路径）
          if (patternConfig.pattern.source.includes('srcset')) {
            const srcsetPaths = capturedPath.split(',').map(s => s.trim().split(/\s+/)[0])
            for (const srcPath of srcsetPaths) {
              if (!isExternalPath(srcPath)) {
                const pathStart = lineContent.indexOf(srcPath, match.index)
                if (pathStart >= 0) {
                  links.push({
                    path: srcPath,
                    range: {
                      startLineNumber: lineNumber + 1,
                      startColumn: pathStart + 1,
                      endLineNumber: lineNumber + 1,
                      endColumn: pathStart + srcPath.length + 1,
                    },
                    tooltip: `Ctrl+Click to open ${srcPath}`,
                  })
                }
              }
            }
            continue
          }
          
          // 计算路径在行中的精确位置
          const fullMatch = match[0]
          const pathStartInMatch = fullMatch.indexOf(capturedPath)
          const pathStart = match.index + pathStartInMatch
          
          links.push({
            path: capturedPath,
            range: {
              startLineNumber: lineNumber + 1,
              startColumn: pathStart + 1,
              endLineNumber: lineNumber + 1,
              endColumn: pathStart + capturedPath.length + 1,
            },
            tooltip: `Ctrl+Click to open ${capturedPath}`,
          })
        }
      }
    }
    
    return links
  }

  /**
   * 解析路径为完整的文件系统路径
   */
  resolvePath(linkPath: string, currentFilePath: string, workspacePath: string): string {
    const sep = getPathSeparator(currentFilePath)
    const currentDir = getDirPath(currentFilePath)
    
    let targetPath: string
    
    if (linkPath.startsWith('./') || linkPath.startsWith('../')) {
      // 相对路径
      targetPath = joinPath(currentDir, linkPath)
    } else if (linkPath.startsWith('/')) {
      // 绝对路径（从项目根目录）
      targetPath = joinPath(workspacePath, linkPath)
    } else if (linkPath.startsWith('@/') || linkPath.startsWith('~/')) {
      // 别名路径
      targetPath = joinPath(workspacePath, 'src', linkPath.slice(2))
    } else if (!linkPath.includes('/') && !linkPath.includes('\\')) {
      // 同级目录文件（如 script.js）
      targetPath = joinPath(currentDir, linkPath)
    } else {
      // 其他情况（可能是 node_modules 或别名）
      // 先尝试从当前目录解析
      targetPath = joinPath(currentDir, linkPath)
    }
    
    return normalizePath(targetPath, sep)
  }

  /**
   * 尝试打开文件（带扩展名推断）
   */
  async tryOpenFile(
    basePath: string, 
    extensions: string[] = ['']
  ): Promise<{ success: boolean; path?: string }> {
    const { openFile, setActiveFile } = useStore.getState()
    
    for (const ext of extensions) {
      const fullPath = basePath + ext
      try {
        const content = await api.file.read(fullPath)
        if (content !== null) {
          openFile(fullPath, content)
          setActiveFile(fullPath)
          return { success: true, path: fullPath }
        }
      } catch {
        // 继续尝试下一个扩展名
      }
    }
    
    return { success: false }
  }

  /**
   * 处理路径点击
   */
  async handlePathClick(linkPath: string, currentFilePath: string): Promise<boolean> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return false
    
    const resolvedPath = this.resolvePath(linkPath, currentFilePath, workspacePath)
    
    // 根据当前文件类型确定要尝试的扩展名
    const ext = currentFilePath.split('.').pop()?.toLowerCase() || ''
    const pattern = PATH_PATTERNS.find(p => 
      p.languages.some(lang => {
        if (lang === 'typescript' || lang === 'typescriptreact') return ext === 'ts' || ext === 'tsx'
        if (lang === 'javascript' || lang === 'javascriptreact') return ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs'
        return lang === ext
      })
    )
    
    const extensions = pattern?.extensions || ['']
    const result = await this.tryOpenFile(resolvedPath, extensions)
    
    if (!result.success) {
      logger.system.warn('Could not resolve path:', linkPath, '-> tried:', resolvedPath)
    }
    
    return result.success
  }

  /**
   * 创建 Monaco LinkProvider
   */
  createLinkProvider(): languages.LinkProvider {
    return {
      provideLinks: (model: editor.ITextModel) => {
        const language = model.getLanguageId()
        const content = model.getValue()
        const pathLinks = this.extractLinks(content, language)
        
        const links = pathLinks.map(link => ({
          range: link.range,
          url: `adnify-path://${encodeURIComponent(link.path)}`,
          tooltip: link.tooltip,
        }))
        
        return { links }
      },
      
      resolveLink: async (link) => {
        if (!link.url) return link
        
        const urlStr = typeof link.url === 'string' ? link.url : link.url.toString()
        if (urlStr.startsWith('adnify-path://')) {
          const linkPath = decodeURIComponent(urlStr.replace('adnify-path://', ''))
          const { activeFilePath } = useStore.getState()
          if (activeFilePath) {
            await this.handlePathClick(linkPath, activeFilePath)
          }
          return undefined
        }
        
        return link
      }
    }
  }

  /**
   * 检查位置是否在某个链接上，返回链接路径
   */
  getLinkAtPosition(
    content: string, 
    language: string, 
    lineNumber: number, 
    column: number
  ): string | null {
    const links = this.extractLinks(content, language)
    
    for (const link of links) {
      if (link.range.startLineNumber === lineNumber &&
          column >= link.range.startColumn &&
          column <= link.range.endColumn) {
        return link.path
      }
    }
    
    return null
  }
}

export const pathLinkService = new PathLinkService()
