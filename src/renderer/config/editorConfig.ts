/**
 * 编辑器配置
 * 集中管理所有可配置的参数
 * 双重存储：localStorage（快速读取）+ 文件（持久化备份）
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'

export interface EditorConfig {
  // 编辑器外观
  fontSize: number
  fontFamily: string
  tabSize: number
  wordWrap: 'on' | 'off' | 'wordWrapColumn'
  lineHeight: number
  minimap: boolean
  minimapScale: number
  lineNumbers: 'on' | 'off' | 'relative'
  bracketPairColorization: boolean

  // 编辑器行为
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay: number // 自动保存延迟（毫秒）

  // 终端
  terminal: {
    fontSize: number
    fontFamily: string
    lineHeight: number
    cursorBlink: boolean
    scrollback: number
  }

  // Git 相关
  git: {
    autoRefresh: boolean // 是否自动刷新 Git 状态
  }

  // 性能相关
  performance: {
    // 文件扫描
    maxProjectFiles: number // LSP 扫描的最大文件数
    maxFileTreeDepth: number // 文件树最大深度

    // 防抖延迟
    fileChangeDebounceMs: number // 文件变化防抖
    completionDebounceMs: number // 代码补全防抖
    searchDebounceMs: number // 搜索防抖

    // 刷新间隔
    indexStatusIntervalMs: number // 索引状态刷新间隔

    // 超时
    requestTimeoutMs: number // API 请求超时
    commandTimeoutMs: number // 命令执行超时

    // 缓冲区大小
    terminalBufferSize: number // 终端输出缓冲区大小
    maxResultLength: number // 结果显示最大长度

    // 文件大小警告阈值（MB）
    largeFileWarningThresholdMB: number
  }

  // AI 代码补全相关
  ai: {
    completionEnabled: boolean   // 是否启用 AI 代码补全
    completionMaxTokens: number  // 补全最大 token 数
    completionTemperature: number // 补全温度
    completionTriggerChars: string[] // 补全触发字符
  }
}

// 默认配置
export const defaultEditorConfig: EditorConfig = {
  // 编辑器外观
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  tabSize: 2,
  wordWrap: 'on',
  lineHeight: 1.5,
  minimap: true,
  minimapScale: 1,
  lineNumbers: 'on',
  bracketPairColorization: true,

  // 编辑器行为
  formatOnSave: false,
  autoSave: 'off',
  autoSaveDelay: 1000,

  // 终端
  terminal: {
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 1000,
  },

  // Git 相关
  git: {
    autoRefresh: true,
  },

  // 性能相关
  performance: {
    maxProjectFiles: 500,
    maxFileTreeDepth: 5,
    fileChangeDebounceMs: 300,
    completionDebounceMs: 300,
    searchDebounceMs: 200,
    indexStatusIntervalMs: 10000,
    requestTimeoutMs: 120000, // 2 分钟
    commandTimeoutMs: 30000, // 30 秒
    terminalBufferSize: 500,
    maxResultLength: 2000,
    largeFileWarningThresholdMB: 5,
  },

  // AI 代码补全相关
  ai: {
    completionEnabled: true,
    completionMaxTokens: 256,
    completionTemperature: 0.1,
    completionTriggerChars: ['.', '(', '{', '[', '"', "'", '/', ' '],
  },
}

// 存储 key
const LOCAL_STORAGE_KEY = 'adnify-editor-config'
const FILE_STORAGE_KEY = 'editorConfig'

/**
 * 深度合并对象
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        ; (result as Record<string, unknown>)[key] = deepMerge(
          target[key] as object,
          source[key] as object
        )
      } else {
        ; (result as Record<string, unknown>)[key] = source[key]
      }
    }
  }

  return result
}

/**
 * 从 localStorage 读取配置
 */
function readFromLocalStorage(): EditorConfig | null {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    logger.settings.error('[EditorConfig] Failed to read from localStorage:', e)
  }
  return null
}

/**
 * 写入 localStorage
 */
function writeToLocalStorage(config: EditorConfig): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config))
  } catch (e) {
    logger.settings.error('[EditorConfig] Failed to write to localStorage:', e)
  }
}

/**
 * 初始化配置
 * 优先从 localStorage 读取，如果没有则从文件读取
 * 应在应用启动时调用
 */
export async function initEditorConfig(): Promise<EditorConfig> {
  // 1. 先尝试从 localStorage 读取（快速）
  const localConfig = readFromLocalStorage()
  if (localConfig) {
    const merged = deepMerge(defaultEditorConfig, localConfig)
    const cleaned = cleanConfig(merged)
    // 异步同步到文件（不阻塞）
    api.settings.set(FILE_STORAGE_KEY, cleaned).catch(console.error)
    return cleaned
  }

  // 2. localStorage 没有，从文件读取
  try {
    const fileConfig = await api.settings.get(FILE_STORAGE_KEY)
    if (fileConfig) {
      const merged = deepMerge(defaultEditorConfig, fileConfig as Partial<EditorConfig>)
      const cleaned = cleanConfig(merged)
      // 同步到 localStorage
      writeToLocalStorage(cleaned)
      return cleaned
    }
  } catch (e) {
    logger.settings.error('[EditorConfig] Failed to read from file:', e)
  }

  // 3. 都没有，使用默认配置并保存
  writeToLocalStorage(defaultEditorConfig)
  api.settings.set(FILE_STORAGE_KEY, defaultEditorConfig).catch(console.error)
  return defaultEditorConfig
}

/**
 * 获取配置（同步，从 localStorage 读取）
 * 如果 localStorage 没有，返回默认配置
 */
export function getEditorConfig(): EditorConfig {
  const localConfig = readFromLocalStorage()
  if (localConfig) {
    const merged = deepMerge(defaultEditorConfig, localConfig)
    return cleanConfig(merged)
  }
  return defaultEditorConfig
}

/**
 * 清理配置，只保留 EditorConfig 接口定义的字段
 */
function cleanConfig(config: EditorConfig): EditorConfig {
  // 只保留接口定义的字段，过滤掉旧配置中可能存在的废弃字段
  const {
    maxProjectFiles, maxFileTreeDepth, fileChangeDebounceMs, completionDebounceMs,
    searchDebounceMs, indexStatusIntervalMs, requestTimeoutMs, commandTimeoutMs,
    terminalBufferSize, maxResultLength, largeFileWarningThresholdMB
  } = config.performance

  return {
    fontSize: config.fontSize,
    fontFamily: config.fontFamily,
    tabSize: config.tabSize,
    wordWrap: config.wordWrap,
    lineHeight: config.lineHeight,
    minimap: config.minimap,
    minimapScale: config.minimapScale,
    lineNumbers: config.lineNumbers,
    bracketPairColorization: config.bracketPairColorization,
    formatOnSave: config.formatOnSave,
    autoSave: config.autoSave,
    autoSaveDelay: config.autoSaveDelay,
    terminal: config.terminal,
    git: config.git,
    performance: {
      maxProjectFiles, maxFileTreeDepth, fileChangeDebounceMs, completionDebounceMs,
      searchDebounceMs, indexStatusIntervalMs, requestTimeoutMs, commandTimeoutMs,
      terminalBufferSize, maxResultLength, largeFileWarningThresholdMB
    },
    ai: config.ai,
  }
}

/**
 * 保存配置（同时保存到 localStorage 和文件）
 */
export function saveEditorConfig(config: Partial<EditorConfig>): void {
  const current = getEditorConfig()
  const merged = deepMerge(current, config)
  // 清理掉不属于 EditorConfig 的字段
  const cleaned = cleanConfig(merged)

  // 同步写入 localStorage（快速）
  writeToLocalStorage(cleaned)

  // 异步写入文件（持久化备份，不阻塞）
  api.settings.set(FILE_STORAGE_KEY, cleaned).catch((e) => {
    logger.settings.error('[EditorConfig] Failed to save to file:', e)
  })
}

/**
 * 重置配置
 */
export function resetEditorConfig(): void {
  writeToLocalStorage(defaultEditorConfig)
  api.settings.set(FILE_STORAGE_KEY, defaultEditorConfig).catch(console.error)
}

/**
 * 从文件恢复配置（用于备份恢复场景）
 */
export async function restoreFromFile(): Promise<EditorConfig> {
  try {
    const fileConfig = await api.settings.get(FILE_STORAGE_KEY)
    if (fileConfig) {
      const merged = deepMerge(defaultEditorConfig, fileConfig as Partial<EditorConfig>)
      const cleaned = cleanConfig(merged)
      writeToLocalStorage(cleaned)
      return cleaned
    }
  } catch (e) {
    logger.settings.error('[EditorConfig] Failed to restore from file:', e)
  }
  return defaultEditorConfig
}
