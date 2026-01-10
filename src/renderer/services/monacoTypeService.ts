/**
 * Monaco TypeScript 语言服务管理
 * 配置 TypeScript 编译选项以支持跨文件跳转和智能感知
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import type * as Monaco from 'monaco-editor'
import { getEditorConfig } from '@renderer/settings'
import { getAgentConfig } from '@renderer/agent/utils/AgentConfig'

// Monaco 实例引用
let monacoInstance: typeof Monaco | null = null
let isInitialized = false

// 已添加的 extraLib 缓存（带 LRU 淘汰）
const extraLibCache = new Map<string, { disposable: Monaco.IDisposable; lastAccessed: number }>()
const EXTRA_LIB_MAX_SIZE = 300 // 最大缓存数量

/**
 * 淘汰最旧的 extraLib
 */
function evictOldestExtraLib(): void {
  if (extraLibCache.size < EXTRA_LIB_MAX_SIZE) return
  
  let oldestKey: string | null = null
  let oldestTime = Infinity
  
  for (const [key, entry] of extraLibCache) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed
      oldestKey = key
    }
  }
  
  if (oldestKey) {
    const entry = extraLibCache.get(oldestKey)
    entry?.disposable.dispose()
    extraLibCache.delete(oldestKey)
  }
}

/**
 * 初始化 Monaco TypeScript 服务
 */
export function initMonacoTypeService(monaco: typeof Monaco) {
  if (isInitialized) return

  monacoInstance = monaco
  isInitialized = true

  // 配置 TypeScript 编译选项
  const compilerOptions: Monaco.languages.typescript.CompilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.React,
    jsxImportSource: 'react',
    allowJs: true,
    checkJs: false,
    strict: false,
    esModuleInterop: true,
    skipLibCheck: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    // 路径映射
    baseUrl: '.',
    paths: {
      '@/*': ['src/*'],
      '~/*': ['src/*'],
    },
  }

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)

  // 设置诊断选项
  // 禁用语义验证以避免跨文件解析时的 URI 不匹配错误
  // 跳转功能通过 Editor.tsx 中的 LinkProvider 实现
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
  })

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: true,
  })

  // 启用 eager model sync - 关键！这让 TypeScript 服务能看到所有模型
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true)
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true)

  logger.system.info('[MonacoTypeService] Initialized with eager model sync')
}

/**
 * 添加文件到 TypeScript 语言服务（作为 extraLib）
 * 用于添加项目中未打开的文件，以支持跳转
 */
export function addFileToTypeService(filePath: string, content: string) {
  if (!monacoInstance) return

  // 使用 Uri.file() 确保格式一致
  const uri = monacoInstance.Uri.file(filePath)
  const uriString = uri.toString()

  // 检查是否已经有这个文件的模型（已打开的文件）
  if (monacoInstance.editor.getModel(uri)) {
    // 已打开的文件不需要添加 extraLib，模型已经存在
    return
  }

  // 移除旧的 extraLib
  const oldEntry = extraLibCache.get(uriString)
  if (oldEntry) {
    oldEntry.disposable.dispose()
    extraLibCache.delete(uriString)
  }

  // 检查是否需要淘汰
  evictOldestExtraLib()

  // 获取语言
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const isTypeScript = ['ts', 'tsx'].includes(ext)
  const isJavaScript = ['js', 'jsx', 'mjs', 'cjs'].includes(ext)

  let disposable: Monaco.IDisposable | undefined

  if (isTypeScript) {
    disposable = monacoInstance.languages.typescript.typescriptDefaults.addExtraLib(
      content,
      uriString
    )
  } else if (isJavaScript) {
    disposable = monacoInstance.languages.typescript.javascriptDefaults.addExtraLib(
      content,
      uriString
    )
  }

  if (disposable) {
    extraLibCache.set(uriString, { disposable, lastAccessed: Date.now() })
  }
}

/**
 * 递归获取目录中的所有 TS/JS 文件
 */
async function getProjectFiles(
  dirPath: string,
  maxDepth?: number,
  currentDepth = 0
): Promise<string[]> {
  const editorConfig = getEditorConfig()
  const agentConfig = getAgentConfig()
  const actualMaxDepth = maxDepth ?? editorConfig.performance.maxFileTreeDepth
  
  if (currentDepth >= actualMaxDepth) return []

  const files: string[] = []
  // 使用 agentConfig 中的忽略目录（与 Agent 设置统一）
  const ignoredDirs = agentConfig.ignoredDirectories

  try {
    const entries = await api.file.readDir(dirPath)

    for (const entry of entries) {
      // 跳过不需要的目录
      if (entry.isDirectory) {
        const dirName = entry.name.toLowerCase()
        if (ignoredDirs.includes(dirName)) {
          continue
        }
        // 递归处理子目录
        const subFiles = await getProjectFiles(entry.path, actualMaxDepth, currentDepth + 1)
        files.push(...subFiles)
      } else {
        // 检查是否是 TS/JS 文件
        const ext = entry.name.split('.').pop()?.toLowerCase() || ''
        if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
          files.push(entry.path)
        }
      }
    }
  } catch {
    // 忽略读取错误
  }

  return files
}

/**
 * 批量添加项目文件到语言服务
 */
export async function addProjectFilesToTypeService(workspacePath: string) {
  if (!monacoInstance || !workspacePath) return

  try {
    logger.system.info('[MonacoTypeService] Scanning project files...')

    // 获取项目中的 TS/JS 文件
    const files = await getProjectFiles(workspacePath)

    // 限制文件数量避免性能问题
    const maxFiles = getEditorConfig().performance.maxProjectFiles
    const filesToAdd = files.slice(0, maxFiles)

    let addedCount = 0
    for (const filePath of filesToAdd) {
      try {
        const content = await api.file.read(filePath)
        if (content) {
          addFileToTypeService(filePath, content)
          addedCount++
        }
      } catch {
        // 忽略读取失败的文件
      }
    }

    logger.system.info(`[MonacoTypeService] Added ${addedCount} files to language service`)
  } catch (error) {
    logger.system.error('[MonacoTypeService] Failed to add project files:', error)
  }
}

/**
 * 清理所有 extraLib
 */
export function clearExtraLibs() {
  for (const entry of extraLibCache.values()) {
    entry.disposable.dispose()
  }
  extraLibCache.clear()
  logger.system.info(`[MonacoTypeService] Cleared all extraLibs`)
}

/**
 * 移除单个文件的 extraLib（文件删除时调用）
 */
export function removeFileFromTypeService(filePath: string) {
  if (!monacoInstance) return

  const uri = monacoInstance.Uri.file(filePath)
  const uriString = uri.toString()

  const entry = extraLibCache.get(uriString)
  if (entry) {
    entry.disposable.dispose()
    extraLibCache.delete(uriString)
  }
}

/**
 * 获取 Monaco 实例
 */
export function getMonacoInstance() {
  return monacoInstance
}
