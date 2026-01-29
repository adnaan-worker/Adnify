/**
 * MCP 工具提供者
 * 将 MCP 服务器的工具集成到统一的工具系统
 */

import { useStore } from '@store'
import { toAppError } from '@shared/utils/errorHandler'
import { mcpService } from '@services/mcpService'
import { logger } from '@utils/Logger'
import { getFileName } from '@shared/utils/pathUtils'
import type { ToolProvider } from './types'
import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolExecutionContext,
  ToolApprovalType,
  ToolRichContent,
} from '@/shared/types'
import type { McpTool, McpServerState, McpContent } from '@shared/types/mcp'

/** MCP 工具名称前缀 */
const MCP_TOOL_PREFIX = 'mcp_'

/** MCP 工具名称分隔符 */
const MCP_TOOL_SEPARATOR = '__'

export class McpToolProvider implements ToolProvider {
  readonly id = 'mcp'
  readonly name = 'MCP Tools'

  /** 生成 MCP 工具的完整名称 */
  static getFullToolName(serverId: string, toolName: string): string {
    return `${MCP_TOOL_PREFIX}${serverId}${MCP_TOOL_SEPARATOR}${toolName}`
  }

  /** 解析 MCP 工具名称 */
  static parseToolName(fullName: string): { serverId: string; toolName: string } | null {
    if (!fullName.startsWith(MCP_TOOL_PREFIX)) {
      return null
    }
    const rest = fullName.slice(MCP_TOOL_PREFIX.length)
    const separatorIndex = rest.indexOf(MCP_TOOL_SEPARATOR)
    if (separatorIndex === -1) {
      return null
    }
    return {
      serverId: rest.slice(0, separatorIndex),
      toolName: rest.slice(separatorIndex + MCP_TOOL_SEPARATOR.length),
    }
  }

  /** 检查是否为 MCP 工具 */
  static isMcpTool(toolName: string): boolean {
    return toolName.startsWith(MCP_TOOL_PREFIX)
  }

  hasTool(toolName: string): boolean {
    if (!McpToolProvider.isMcpTool(toolName)) {
      return false
    }
    
    const parsed = McpToolProvider.parseToolName(toolName)
    if (!parsed) {
      return false
    }

    const server = this.getServer(parsed.serverId)
    if (!server || server.status !== 'connected') {
      return false
    }

    return server.tools.some(t => t.name === parsed.toolName)
  }

  getToolDefinitions(): ToolDefinition[] {
    const servers = this.getConnectedServers()
    const definitions: ToolDefinition[] = []

    for (const server of servers) {
      for (const tool of server.tools) {
        definitions.push(this.convertToDefinition(server, tool))
      }
    }

    return definitions
  }

  getApprovalType(toolName: string): ToolApprovalType {
    const parsed = McpToolProvider.parseToolName(toolName)
    if (!parsed) {
      return 'dangerous' // 未知工具需要审批
    }

    const server = this.getServer(parsed.serverId)
    if (!server) {
      return 'dangerous'
    }

    // 检查是否在自动批准列表中
    const autoApprove = server.config.autoApprove || []
    if (autoApprove.includes(parsed.toolName)) {
      return 'none'
    }

    // MCP 工具默认需要审批
    return 'dangerous'
  }

  validateArgs(toolName: string, args: unknown): { valid: boolean; error?: string } {
    const parsed = McpToolProvider.parseToolName(toolName)
    if (!parsed) {
      return { valid: false, error: 'Invalid MCP tool name' }
    }

    const server = this.getServer(parsed.serverId)
    if (!server) {
      return { valid: false, error: `MCP server ${parsed.serverId} not found` }
    }

    const tool = server.tools.find(t => t.name === parsed.toolName)
    if (!tool) {
      return { valid: false, error: `Tool ${parsed.toolName} not found on server ${parsed.serverId}` }
    }

    // 基本类型检查
    if (args !== null && typeof args !== 'object') {
      return { valid: false, error: 'Arguments must be an object' }
    }

    // 检查必填参数
    const required = tool.inputSchema.required || []
    const argObj = (args || {}) as Record<string, unknown>
    
    for (const key of required) {
      if (!(key in argObj)) {
        return { valid: false, error: `Missing required parameter: ${key}` }
      }
    }

    return { valid: true }
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const parsed = McpToolProvider.parseToolName(toolName)
    if (!parsed) {
      return {
        success: false,
        result: '',
        error: `Invalid MCP tool name: ${toolName}`,
      }
    }

    const { serverId, toolName: actualToolName } = parsed

    logger.agent.info(`[McpToolProvider] Executing ${actualToolName} on server ${serverId}`)

    try {
      const result = await mcpService.callTool({
        serverId,
        toolName: actualToolName,
        arguments: args,
      })

      if (!result.success) {
        return {
          success: false,
          result: '',
          error: result.error || 'MCP tool execution failed',
        }
      }

      // 转换 MCP 内容为富内容格式
      const { textResult, richContent } = this.convertMcpContent(result.content || [])

      return {
        success: !result.isError,
        result: textResult || 'Tool executed successfully',
        richContent: richContent.length > 0 ? richContent : undefined,
        error: result.isError ? 'Tool returned an error' : undefined,
      }
    } catch (err) {
      logger.agent.error(`[McpToolProvider] Execution failed:`, err)
      return {
        success: false,
        result: '',
        error: toAppError(err).message,
      }
    }
  }

  // =================== 私有方法 ===================

  private getConnectedServers(): McpServerState[] {
    const servers = useStore.getState().mcpServers
    return servers.filter(s => s.status === 'connected')
  }

  private getServer(serverId: string): McpServerState | undefined {
    return useStore.getState().mcpServers.find(s => s.id === serverId)
  }

  private convertToDefinition(server: McpServerState, tool: McpTool): ToolDefinition {
    const fullName = McpToolProvider.getFullToolName(server.id, tool.name)

    // 转换 inputSchema 到 parameters 格式
    const properties: Record<string, any> = {}
    if (tool.inputSchema.properties) {
      for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
        properties[key] = {
          type: prop.type,
          description: prop.description || '',
          ...(prop.enum && { enum: prop.enum }),
        }
      }
    }

    return {
      name: fullName,
      description: `[MCP: ${server.config.name}] ${tool.description || tool.name}`,
      parameters: {
        type: 'object',
        properties,
        required: tool.inputSchema.required,
      },
    }
  }

  /**
   * 将 MCP 内容转换为富内容格式
   */
  private convertMcpContent(content: McpContent[]): { textResult: string; richContent: ToolRichContent[] } {
    const textParts: string[] = []
    const richContent: ToolRichContent[] = []

    for (const item of content) {
      const converted = this.convertSingleContent(item)
      if (converted.text) {
        textParts.push(converted.text)
      }
      if (converted.rich) {
        richContent.push(converted.rich)
      }
    }

    return {
      textResult: textParts.join('\n').trim(),
      richContent,
    }
  }

  /**
   * 转换单个 MCP 内容项
   */
  private convertSingleContent(item: McpContent): { text?: string; rich?: ToolRichContent } {
    switch (item.type) {
      case 'text':
        return this.convertTextContent(item)
      case 'image':
        return this.convertImageContent(item)
      case 'resource':
        return this.convertResourceContent(item)
      default:
        // 处理未知类型
        return { text: `[Unknown content type: ${item.type}]` }
    }
  }

  /**
   * 转换文本内容
   */
  private convertTextContent(item: McpContent): { text?: string; rich?: ToolRichContent } {
    if (!item.text) {
      return {}
    }

    // 尝试检测内容类型
    const contentType = this.detectContentType(item.text, item.mimeType)

    const richContent: ToolRichContent = {
      type: contentType,
      text: item.text,
      mimeType: item.mimeType,
    }

    // 根据内容类型添加额外属性
    if (contentType === 'code') {
      richContent.language = this.detectLanguage(item.text, item.mimeType)
    } else if (contentType === 'json') {
      // 尝试格式化 JSON
      try {
        const parsed = JSON.parse(item.text)
        richContent.text = JSON.stringify(parsed, null, 2)
      } catch {
        // 保持原样
      }
    }

    return {
      text: item.text,
      rich: richContent,
    }
  }

  /**
   * 转换图片内容
   */
  private convertImageContent(item: McpContent): { text?: string; rich?: ToolRichContent } {
    const mimeType = item.mimeType || 'image/png'
    
    if (item.data) {
      return {
        text: `[Image: ${mimeType}]`,
        rich: {
          type: 'image',
          data: item.data,
          mimeType,
          title: 'Screenshot',
        },
      }
    }

    return {
      text: `[Image: ${mimeType} - no data]`,
    }
  }

  /**
   * 转换资源内容
   */
  private convertResourceContent(item: McpContent): { text?: string; rich?: ToolRichContent } {
    const uri = item.uri || 'unknown'
    
    // 检查是否是文件链接
    if (uri.startsWith('file://') || uri.match(/^[a-zA-Z]:\\/)) {
      return {
        text: `[File: ${uri}]`,
        rich: {
          type: 'file',
          uri,
          title: getFileName(uri),
        },
      }
    }

    // 检查是否是 URL
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return {
        text: `[Link: ${uri}]`,
        rich: {
          type: 'link',
          url: uri,
          title: uri,
        },
      }
    }

    return {
      text: `[Resource: ${uri}]`,
      rich: {
        type: 'text',
        text: uri,
        uri,
      },
    }
  }

  /**
   * 检测内容类型
   */
  private detectContentType(text: string, mimeType?: string): ToolRichContent['type'] {
    // 根据 MIME 类型判断
    if (mimeType) {
      if (mimeType.startsWith('text/html')) return 'html'
      if (mimeType.startsWith('text/markdown') || mimeType === 'text/x-markdown') return 'markdown'
      if (mimeType === 'application/json') return 'json'
      if (mimeType.startsWith('text/') && mimeType !== 'text/plain') return 'code'
    }

    // 尝试解析为 JSON
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        JSON.parse(text)
        return 'json'
      } catch {
        // 不是有效的 JSON
      }
    }

    // 检测 Markdown 特征
    if (this.looksLikeMarkdown(text)) {
      return 'markdown'
    }

    // 检测 HTML 特征
    if (text.trim().startsWith('<') && text.includes('</')) {
      return 'html'
    }

    // 检测代码特征
    if (this.looksLikeCode(text)) {
      return 'code'
    }

    return 'text'
  }

  /**
   * 检测是否像 Markdown
   */
  private looksLikeMarkdown(text: string): boolean {
    const markdownPatterns = [
      /^#{1,6}\s/m,           // 标题
      /^\s*[-*+]\s/m,         // 无序列表
      /^\s*\d+\.\s/m,         // 有序列表
      /\[.+\]\(.+\)/,         // 链接
      /!\[.+\]\(.+\)/,        // 图片
      /```[\s\S]*```/,        // 代码块
      /`[^`]+`/,              // 行内代码
      /\*\*[^*]+\*\*/,        // 粗体
      /\*[^*]+\*/,            // 斜体
    ]
    return markdownPatterns.some(pattern => pattern.test(text))
  }

  /**
   * 检测是否像代码
   */
  private looksLikeCode(text: string): boolean {
    const codePatterns = [
      /^(import|export|const|let|var|function|class|interface|type)\s/m,
      /^(def|class|import|from|if|for|while)\s/m,
      /^(package|import|public|private|class)\s/m,
      /[{}\[\]();]/,
      /=>/,
      /^\s{2,}/m,  // 缩进
    ]
    const matchCount = codePatterns.filter(pattern => pattern.test(text)).length
    return matchCount >= 2
  }

  /**
   * 检测代码语言
   */
  private detectLanguage(text: string, mimeType?: string): string {
    // 根据 MIME 类型
    if (mimeType) {
      const mimeToLang: Record<string, string> = {
        'text/javascript': 'javascript',
        'application/javascript': 'javascript',
        'text/typescript': 'typescript',
        'application/typescript': 'typescript',
        'text/x-python': 'python',
        'text/x-java': 'java',
        'text/x-c': 'c',
        'text/x-cpp': 'cpp',
        'text/x-csharp': 'csharp',
        'text/x-go': 'go',
        'text/x-rust': 'rust',
        'text/html': 'html',
        'text/css': 'css',
        'application/json': 'json',
        'text/yaml': 'yaml',
        'text/x-yaml': 'yaml',
        'text/xml': 'xml',
        'application/xml': 'xml',
        'text/x-sh': 'bash',
        'text/x-shellscript': 'bash',
      }
      if (mimeToLang[mimeType]) {
        return mimeToLang[mimeType]
      }
    }

    // 根据内容特征检测
    if (/^(import|export|const|let|var|function|class)\s/m.test(text)) {
      if (/:\s*(string|number|boolean|any|void)\b/.test(text)) {
        return 'typescript'
      }
      return 'javascript'
    }
    if (/^(def|class|import|from|if __name__)\s/m.test(text)) {
      return 'python'
    }
    if (/^(package|import|public|private|class)\s/m.test(text)) {
      return 'java'
    }
    if (/^#include\s*[<"]/.test(text)) {
      return 'cpp'
    }

    return 'plaintext'
  }
}

/** MCP 工具提供者单例 */
export const mcpToolProvider = new McpToolProvider()
