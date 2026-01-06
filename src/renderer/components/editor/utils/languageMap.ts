/**
 * 编辑器语言映射
 * 
 * 注意：这里的映射是给 Monaco 编辑器用的，
 * 某些语言 ID 与 LSP 的不同（如 tsx -> typescript）
 */

import { getFileName } from '@utils/pathUtils'
import { EXTENSION_TO_LANGUAGE } from '@shared/languages'

// Monaco 特定的语言映射覆盖
// 某些语言在 Monaco 中使用不同的 ID
const MONACO_LANGUAGE_OVERRIDES: Record<string, string> = {
  // TSX/JSX 在 Monaco 中使用 typescript/javascript
  tsx: 'typescript',
  jsx: 'javascript',
  typescriptreact: 'typescript',
  javascriptreact: 'javascript',
  // Vue/Svelte 在 Monaco 中使用 html
  vue: 'html',
  svelte: 'html',
  // JSONC 在 Monaco 中使用 json
  jsonc: 'json',
  // TOML/INI 在 Monaco 中使用 ini
  toml: 'ini',
  // Less 在 Monaco 中使用 scss
  less: 'scss',
}

/**
 * 根据文件路径获取 Monaco 语言 ID
 */
export function getLanguage(path: string): string {
  const fileName = getFileName(path).toLowerCase()

  // 特殊文件名
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'makefile'
  if (fileName.startsWith('.env')) return 'ini'

  const ext = fileName.split('.').pop() || ''
  
  // 先从共享语言配置获取
  const langId = EXTENSION_TO_LANGUAGE[ext]
  if (langId) {
    // 检查是否需要 Monaco 特定的覆盖
    return MONACO_LANGUAGE_OVERRIDES[langId] || MONACO_LANGUAGE_OVERRIDES[ext] || langId
  }
  
  return 'plaintext'
}

// 保留旧的导出以兼容现有代码
export const LANGUAGE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_TO_LANGUAGE).map(([ext, lang]) => [
    ext,
    MONACO_LANGUAGE_OVERRIDES[lang] || MONACO_LANGUAGE_OVERRIDES[ext] || lang
  ])
)
