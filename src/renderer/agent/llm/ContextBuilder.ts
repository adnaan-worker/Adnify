/**
 * 上下文构建器
 * 负责构建发送给 LLM 的上下文内容
 */

import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { useAgentStore } from '../store/AgentStore'
import { toolRegistry } from '../tools'
import { getAgentConfig } from '../utils/AgentConfig'
import { ContextItem, MessageContent, TextContent } from '../types'
import { fileContentCache, searchResultCache } from '@shared/utils/CacheService'

/**
 * 构建上下文内容
 * 从上下文项（文件、代码库搜索、Web 搜索等）构建文本内容
 */
export async function buildContextContent(
  contextItems: ContextItem[],
  userQuery?: string
): Promise<string> {
  if (!contextItems || contextItems.length === 0) return ''

  const parts: string[] = []
  let totalChars = 0
  const config = getAgentConfig()
  const workspacePath = useStore.getState().workspacePath

  for (const item of contextItems) {
    if (totalChars >= config.maxTotalContextChars) {
      parts.push('\n[Additional context truncated]')
      break
    }

    const result = await processContextItem(item, userQuery, workspacePath, config)
    if (result) {
      parts.push(result)
      totalChars += result.length
    }
  }

  // 更新上下文统计信息
  updateContextStats(contextItems, totalChars, config)

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

    default:
      return null
  }
}

/**
 * 处理文件上下文（带缓存）
 */
async function processFileContext(
  item: { uri: string },
  config: ReturnType<typeof getAgentConfig>
): Promise<string | null> {
  const filePath = item.uri
  try {
    // 使用缓存服务
    const content = await fileContentCache.getOrSet(
      filePath,
      async () => {
        const fileContent = await window.electronAPI.readFile(filePath)
        return fileContent || ''
      },
      2 * 60 * 1000 // 2 分钟 TTL
    )
    
    if (content) {
      const truncated = content.length > config.maxFileContentChars
        ? content.slice(0, config.maxFileContentChars) + '\n...(file truncated)'
        : content
      return `\n### File: ${filePath}\n\`\`\`\n${truncated}\n\`\`\`\n`
    }
  } catch (e) {
    logger.agent.error('[ContextBuilder] Failed to read file:', filePath, e)
  }
  return null
}

/**
 * 处理代码库搜索上下文（带缓存）
 */
async function processCodebaseContext(
  userQuery: string | undefined,
  workspacePath: string | null
): Promise<string | null> {
  if (!workspacePath || !userQuery) return '\n[Codebase search requires workspace and query]\n'

  try {
    const cleanQuery = userQuery.replace(/@codebase\s*/i, '').trim() || userQuery
    const cacheKey = `${workspacePath}:${cleanQuery}`
    
    // 使用缓存服务
    const results = await searchResultCache.getOrSet(
      cacheKey,
      async () => {
        const searchResults = await window.electronAPI.indexHybridSearch(workspacePath, cleanQuery, 20)
        return searchResults || []
      },
      60 * 1000 // 1 分钟 TTL（搜索结果变化较快）
    ) as Array<{ relativePath: string; score: number; language: string; content: string }>

    if (results && results.length > 0) {
      return `\n### Codebase Search Results for "${cleanQuery}":\n` +
        results.map(r =>
          `#### ${r.relativePath} (Score: ${r.score.toFixed(2)})\n\`\`\`${r.language}\n${r.content}\n\`\`\``
        ).join('\n\n') + '\n'
    }
    return '\n[No relevant codebase results found]\n'
  } catch (e) {
    logger.agent.error('[ContextBuilder] Codebase search failed:', e)
    return '\n[Codebase search failed]\n'
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
    const terminalOutput = await toolRegistry.execute('get_terminal_output', {
      terminal_id: 'default',
      lines: 50
    }, { workspacePath })

    if (terminalOutput.success && terminalOutput.result) {
      return `\n### Recent Terminal Output:\n\`\`\`\n${terminalOutput.result}\n\`\`\`\n`
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

/**
 * 计算并更新当前上下文统计信息
 * 优化：使用缓存的文件大小，避免频繁读取文件
 */
// 文件大小缓存
const fileSizeCache = new Map<string, number>()

export async function calculateContextStats(
  contextItems: ContextItem[],
  currentInput: string
): Promise<void> {
  const agentStore = useAgentStore.getState()
  const messages = agentStore.getMessages()
  const filteredMessages = messages.filter(m => m.role !== 'checkpoint')
  const config = getAgentConfig()

  let totalChars = 0
  let fileCount = 0
  let semanticResultCount = 0

  // 1. 计算消息历史长度
  for (const msg of filteredMessages) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      const content = (msg as any).content
      if (typeof content === 'string') {
        totalChars += content.length
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text') totalChars += part.text.length
        }
      }
    } else if (msg.role === 'tool') {
      totalChars += (msg as any).content.length
    }
  }

  // 2. 计算当前输入长度
  totalChars += currentInput.length

  // 3. 计算上下文项长度（使用缓存）
  for (const item of contextItems) {
    if (item.type === 'File') {
      fileCount++
      const filePath = (item as any).uri
      if (filePath) {
        // 使用缓存的文件大小
        let fileSize = fileSizeCache.get(filePath)
        if (fileSize === undefined) {
          try {
            const content = await window.electronAPI.readFile(filePath)
            fileSize = content?.length ?? 0
            fileSizeCache.set(filePath, fileSize)
            // 限制缓存大小
            if (fileSizeCache.size > 100) {
              const firstKey = fileSizeCache.keys().next().value
              if (firstKey) fileSizeCache.delete(firstKey)
            }
          } catch {
            fileSize = 0
          }
        }
        totalChars += Math.min(fileSize, config.maxFileContentChars)
      }
    } else if (item.type === 'Codebase') {
      semanticResultCount++
      totalChars += 2000 // 预估搜索结果长度
    }
  }

  // 只统计 user + assistant 消息
  const userAssistantMessages = filteredMessages.filter(m => m.role === 'user' || m.role === 'assistant')

  agentStore.setContextStats({
    totalChars,
    maxChars: config.maxTotalContextChars,
    fileCount,
    maxFiles: 10,
    messageCount: userAssistantMessages.length,
    maxMessages: config.maxHistoryMessages,
    semanticResultCount,
    terminalChars: 0
  })
}
