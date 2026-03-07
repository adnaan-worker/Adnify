/**
 * 上下文构建器
 * 负责构建发送给 LLM 的上下文内容
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore } from '../store/AgentStore'
import { toolRegistry } from '../tools'
import { getAgentConfig } from '../utils/AgentConfig'
import { ContextItem, MessageContent, TextContent, ProblemsContext, ChatMessage, getMessageText } from '../types'
import { CacheService } from '@shared/utils/CacheService'
import { useDiagnosticsStore } from '@/renderer/services/diagnosticsStore'
import { normalizePath } from '@shared/utils/pathUtils'
import { retrievalService } from '../services/RetrievalService'

// 创建文件内容缓存（使用 CacheService）
const fileContentCache = new CacheService<string>('ContextFileCache', {
  maxSize: 200,
  maxMemory: 30 * 1024 * 1024, // 30MB
  defaultTTL: 5 * 60 * 1000, // 5分钟
  evictionPolicy: 'lru',
  slidingExpiration: true, // 访问时重置过期时间
})

// 创建搜索结果缓存
const searchResultCache = new CacheService<unknown[]>('ContextSearchCache', {
  maxSize: 50,
  maxMemory: 10 * 1024 * 1024, // 10MB
  defaultTTL: 2 * 60 * 1000, // 2分钟
  evictionPolicy: 'lfu', // 搜索结果用 LFU 更合适
})

/**
 * 构建上下文内容
 * 从上下文项（文件、代码库搜索、Web 搜索等）构建文本内容
 */
export async function buildContextContent(
  contextItems: ContextItem[],
  userQuery?: string,
  assistantId?: string,
  threadId?: string
): Promise<string> {
  // if (!contextItems || contextItems.length === 0) return ''
  const validContextItems = contextItems || []

  const parts: string[] = []
  let totalChars = 0
  let fileCount = 0
  const config = getAgentConfig()
  const workspacePath = useStore.getState().workspacePath

  for (const item of validContextItems) {
    if (totalChars >= config.maxTotalContextChars) {
      parts.push('\n[Additional context truncated]')
      break
    }

    // 限制文件数量
    if (item.type === 'File') {
      if (fileCount >= config.maxContextFiles) {
        parts.push('\n[Additional files truncated]')
        continue
      }
      fileCount++
    }

    const result = await processContextItem(item, userQuery, workspacePath, config)
    if (result) {
      parts.push(result)
      totalChars += result.length
    }
  }

  // 更新上下文统计信息
  updateContextStats(validContextItems, totalChars, config)

  // 尝试获取隐式上下文 (Auto-Context)
  // 只有在上下文未满且配置开启时尝试
  if (totalChars < config.maxTotalContextChars) {
    const implicitContext = await processImplicitContext(userQuery, workspacePath, validContextItems, assistantId, threadId)
    if (implicitContext) {
      parts.push(implicitContext)
    }
  }

  return parts.join('')
}

/**
 * 处理单个上下文项
 */
async function processContextItem(
  item: ContextItem,
  userQuery: string | undefined,
  workspacePath: string | null,
  config: ReturnType<typeof getAgentConfig>
): Promise<string | null> {
  switch (item.type) {
    case 'File':
      return processFileContext(item as { uri: string }, config)

    case 'Codebase':
      return processCodebaseContext(userQuery, workspacePath)

    case 'Web':
      return processWebContext(userQuery, workspacePath)

    case 'Git':
      return processGitContext(workspacePath)

    case 'Terminal':
      return processTerminalContext(workspacePath)

    case 'Symbols':
      return processSymbolsContext(workspacePath)

    case 'Problems':
      return processProblemsContext(item as ProblemsContext, workspacePath)

    default:
      return null
  }
}

/**
 * 处理文件上下文（使用 CacheService）
 */
async function processFileContext(
  item: { uri: string },
  config: ReturnType<typeof getAgentConfig>
): Promise<string | null> {
  const filePath = item.uri
  try {
    // 使用 CacheService 的 getOrSet 方法
    const content = await fileContentCache.getOrSet(
      filePath,
      async () => {
        const fileContent = await api.file.read(filePath)
        if (!fileContent) throw new Error('File not found')
        return fileContent
      },
      {
        // 文件内容使用滑动过期，访问时重置 TTL
        slidingExpiration: true,
      }
    )

    if (!content) return null

    const truncated = content.length > config.maxFileContentChars
      ? content.slice(0, config.maxFileContentChars) + '\n...(file truncated)'
      : content
    return `\n### File: ${filePath}\n\`\`\`\n${truncated}\n\`\`\`\n`
  } catch (e) {
    logger.agent.error('[ContextBuilder] Failed to read file:', filePath, e)
  }
  return null
}

/**
 * 处理代码库搜索上下文（使用 CacheService）
 */
async function processCodebaseContext(
  userQuery: string | undefined,
  workspacePath: string | null
): Promise<string | null> {
  if (!workspacePath || !userQuery) return '\n[Codebase search requires workspace and query]\n'

  try {
    const cleanQuery = userQuery.replace(/@codebase\s*/i, '').trim() || userQuery
    const cacheKey = `${workspacePath}:${cleanQuery}`
    const config = getAgentConfig()

    // 使用 CacheService 的 getOrSet
    const results = await searchResultCache.getOrSet(
      cacheKey,
      async () => {
        const searchResults = await api.index.hybridSearch(workspacePath, cleanQuery, 20)
        return searchResults || []
      }
    ) as Array<{ relativePath: string; score: number; language: string; content: string }>

    if (results && results.length > 0) {
      // 使用 maxSemanticResults 限制结果数量
      const limitedResults = results.slice(0, config.maxSemanticResults)
      return `\n### Codebase Search Results for "${cleanQuery}":\n` +
        limitedResults.map(r => {
          let content = r.content
          const MAX_CHUNK_CHARS = 1500
          if (content.length > MAX_CHUNK_CHARS) {
            content = content.slice(0, MAX_CHUNK_CHARS) + `\n... (content truncated, use read_file tool to read full file if needed)`
          }
          return `#### ${r.relativePath} (Score: ${r.score.toFixed(2)})\n\`\`\`${r.language}\n${content}\n\`\`\``
        }).join('\n\n') + '\n'
    }
    return '\n[No relevant codebase results found]\n'
  } catch (e) {
    logger.agent.error('[ContextBuilder] Codebase search failed:', e)
    return '\n[Codebase search failed]\n'
  }
}

/**
 * 处理隐式上下文（自动上下文）
 * 
 * 当用户没有显式指定 @codebase 时，自动搜索相关代码
 */
async function processImplicitContext(
  userQuery: string | undefined,
  workspacePath: string | null,
  existingContextItems: ContextItem[],
  assistantId?: string,
  threadId?: string
): Promise<string | null> {
  const config = getAgentConfig()
  if (!config.enableAutoContext) return null

  if (!workspacePath || !userQuery || userQuery.length < 5) return null

  const hasExplicitCodebase = existingContextItems.some(item => item.type === 'Codebase')
  if (hasExplicitCodebase) return null

  try {
    // 获取最近的对话历史作为参考，实现上下文感知
    const messages = threadId ? useAgentStore.getState().forThread(threadId).getMessages() : []
    const history = messages
      .filter(m => m.role !== 'checkpoint' && m.role !== 'interrupted_tool')
      .slice(-6)
      .map((m: ChatMessage) => {
        let text = ''
        if (m.role === 'user') {
          text = getMessageText(m.content)
        } else if (m.role === 'assistant' || m.role === 'tool') {
          text = m.content || ''
        }
        return `${m.role}: ${text.slice(0, 200)}`
      })
      .join('\n')

    const results = await retrievalService.retrieve({
      query: userQuery,
      history,
      workspacePath,
      assistantId,
      threadId,
      threshold: 0.3,
      limit: 3
    })

    if (!results || results.length === 0) return null

    // 格式化搜索结果
    const contextContent = results.map(r => {
      let content = r.content
      // 如果搜索到的 chunk 过大（例如 AST 匹配到了整个 React 组件），则截断内容
      const MAX_CHUNK_CHARS = 1500
      if (content.length > MAX_CHUNK_CHARS) {
        content = content.slice(0, MAX_CHUNK_CHARS) + `\n... (content truncated, use read_file tool to read full file if needed)`
      }
      return `\n--- File: ${r.relativePath} (Lines ${r.startLine}-${r.endLine}) ---\n${content}\n`
    }).join('\n')

    return contextContent
  } catch (err) {
    logger.agent.error('[ContextBuilder] Implicit context failed:', err)
    return null
  }
}

/**
 * 处理 Web 搜索上下文
 */
async function processWebContext(
  userQuery: string | undefined,
  workspacePath: string | null
): Promise<string | null> {
  if (!userQuery) return '\n[Web search requires query]\n'

  try {
    const cleanQuery = userQuery.replace(/@web\s*/i, '').trim() || userQuery
    const searchResult = await toolRegistry.execute('web_search', { query: cleanQuery }, { workspacePath })

    if (searchResult.success) {
      return `\n### Web Search Results for "${cleanQuery}":\n${searchResult.result}\n`
    }
    return `\n[Web search failed: ${searchResult.error}]\n`
  } catch (e) {
    logger.agent.error('[ContextBuilder] Web search failed:', e)
    return '\n[Web search failed]\n'
  }
}

/**
 * 处理 Git 上下文
 */
async function processGitContext(workspacePath: string | null): Promise<string | null> {
  if (!workspacePath) return '\n[Git info requires workspace]\n'

  try {
    const gitStatus = await toolRegistry.execute('run_command', {
      command: 'git status --short && git log --oneline -5',
      cwd: workspacePath,
      timeout: 10
    }, { workspacePath })

    if (gitStatus.success) {
      return `\n### Git Status:\n\`\`\`\n${gitStatus.result}\n\`\`\`\n`
    }
    return '\n[Git info not available]\n'
  } catch (e) {
    logger.agent.error('[ContextBuilder] Git context failed:', e)
    return '\n[Git info failed]\n'
  }
}

/**
 * 处理终端输出上下文
 */
async function processTerminalContext(workspacePath: string | null): Promise<string | null> {
  try {
    const config = getAgentConfig()
    const terminalOutput = await toolRegistry.execute('get_terminal_output', {
      terminal_id: 'default',
      lines: 50
    }, { workspacePath })

    if (terminalOutput.success && terminalOutput.result) {
      // 使用 maxTerminalChars 限制终端输出长度
      let output = terminalOutput.result
      if (output.length > config.maxTerminalChars) {
        output = output.slice(-config.maxTerminalChars) + '\n...(terminal output truncated)'
      }
      return `\n### Recent Terminal Output:\n\`\`\`\n${output}\n\`\`\`\n`
    }
    return '\n[No terminal output available]\n'
  } catch (e) {
    logger.agent.error('[ContextBuilder] Terminal context failed:', e)
    return '\n[Terminal output failed]\n'
  }
}

/**
 * 处理符号上下文
 */
async function processSymbolsContext(workspacePath: string | null): Promise<string | null> {
  if (!workspacePath) return '\n[Symbols require workspace]\n'

  try {
    const currentFile = useStore.getState().activeFilePath

    if (currentFile) {
      const symbols = await toolRegistry.execute('get_document_symbols', {
        path: currentFile
      }, { workspacePath })

      if (symbols.success && symbols.result) {
        return `\n### Symbols in ${currentFile}:\n\`\`\`\n${symbols.result}\n\`\`\`\n`
      }
      return '\n[No symbols found]\n'
    }
    return '\n[No active file for symbols]\n'
  } catch (e) {
    logger.agent.error('[ContextBuilder] Symbols context failed:', e)
    return '\n[Symbols retrieval failed]\n'
  }
}

/**
 * 处理问题/诊断上下文
 */
async function processProblemsContext(
  item: ProblemsContext,
  _workspacePath: string | null
): Promise<string | null> {
  const diagnosticsState = useDiagnosticsStore.getState()
  const diagnostics = diagnosticsState.diagnostics

  // 如果指定了文件，只获取该文件的诊断
  const targetFile = item.uri || useStore.getState().activeFilePath

  if (targetFile) {
    const normalizedTarget = normalizePath(targetFile)
    const parts: string[] = []

    for (const [uri, diags] of diagnostics) {
      let uriPath = uri
      if (uri.startsWith('file:///')) {
        uriPath = decodeURIComponent(uri.slice(8))
      } else if (uri.startsWith('file://')) {
        uriPath = decodeURIComponent(uri.slice(7))
      }

      const normalizedUri = normalizePath(uriPath)
      if (normalizedUri === normalizedTarget || normalizedUri.endsWith(normalizedTarget)) {
        if (diags.length > 0) {
          parts.push(`### Problems in ${targetFile}:`)
          diags.forEach((d, i) => {
            const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : 'Info'
            parts.push(`${i + 1}. [${severity}] Line ${d.range.start.line + 1}: ${d.message}`)
          })
        }
        break
      }
    }

    if (parts.length > 0) {
      return '\n' + parts.join('\n') + '\n'
    }
    return '\n[No problems found in current file]\n'
  }

  // 没有指定文件，返回所有诊断
  if (diagnostics.size === 0) {
    return '\n[No problems detected in workspace]\n'
  }

  const parts: string[] = ['### All Problems:']
  let count = 0
  const maxProblems = 50

  for (const [uri, diags] of diagnostics) {
    if (count >= maxProblems) {
      parts.push(`\n... and more (${diagnosticsState.errorCount} errors, ${diagnosticsState.warningCount} warnings total)`)
      break
    }

    let filePath = uri
    if (uri.startsWith('file:///')) {
      filePath = decodeURIComponent(uri.slice(8))
    } else if (uri.startsWith('file://')) {
      filePath = decodeURIComponent(uri.slice(7))
    }

    parts.push(`\n#### ${filePath}:`)
    for (const d of diags) {
      if (count >= maxProblems) break
      const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : 'Info'
      parts.push(`- [${severity}] Line ${d.range.start.line + 1}: ${d.message}`)
      count++
    }
  }

  return '\n' + parts.join('\n') + '\n'
}

/**
 * 更新上下文统计信息
 */
function updateContextStats(
  contextItems: ContextItem[],
  totalChars: number,
  config: ReturnType<typeof getAgentConfig>
): void {
  const agentStore = useAgentStore.getState()
  const agentMessages = agentStore.getMessages()
  const fileCount = contextItems.filter(item => item.type === 'File').length
  const semanticResultCount = contextItems.filter(item => item.type === 'Codebase').length

  agentStore.setContextStats({
    totalChars,
    maxChars: config.maxTotalContextChars,
    fileCount,
    maxFiles: 10,
    messageCount: agentMessages.length,
    maxMessages: config.maxHistoryMessages,
    semanticResultCount,
    terminalChars: 0
  })
}

/**
 * 构建用户消息内容（包含上下文）
 */
export function buildUserContent(
  message: MessageContent,
  contextContent: string
): MessageContent {
  if (!contextContent) return message

  const contextPart: TextContent = {
    type: 'text',
    text: `## Referenced Context\n${contextContent}\n\n## User Request\n`
  }

  if (typeof message === 'string') {
    return [contextPart, { type: 'text', text: message }]
  }
  return [contextPart, ...message]
}
