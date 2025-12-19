/**
 * 工具执行器
 * 负责工具的验证和执行
 */

import { ToolDefinition, ToolApprovalType } from './types'
import { validatePath, isSensitivePath } from '@/renderer/utils/pathUtils'
import { pathToLspUri, lspUriToPath } from '@/renderer/services/lspService'

/**
 * 计算两个文本之间的行数变化
 * 使用简单的 LCS 算法计算实际增加和删除的行数
 */
function calculateLineChanges(oldContent: string, newContent: string): { added: number; removed: number } {
  if (!oldContent && !newContent) return { added: 0, removed: 0 }
  if (!oldContent) return { added: newContent.split('\n').length, removed: 0 }
  if (!newContent) return { added: 0, removed: oldContent.split('\n').length }

  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // 使用简单的 LCS 长度计算
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const lcsLength = dp[m][n]
  return {
    added: n - lcsLength,    // 新增的行 = 新文件行数 - 公共行数
    removed: m - lcsLength,  // 删除的行 = 旧文件行数 - 公共行数
  }
}

// ===== 工具定义 =====

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // 读取类
  {
    name: 'read_file',
    description: 'Read file contents with optional line range.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        start_line: { type: 'number', description: 'Starting line (1-indexed)' },
        end_line: { type: 'number', description: 'Ending line' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_dir_tree',
    description: 'Get recursive directory tree structure.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Root directory path' },
        max_depth: { type: 'number', description: 'Maximum depth (default: 3)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for text pattern in files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search' },
        pattern: { type: 'string', description: 'Search pattern' },
        is_regex: { type: 'boolean', description: 'Use regex' },
        file_pattern: { type: 'string', description: 'File filter (e.g., "*.ts")' },
      },
      required: ['path', 'pattern'],
    },
  },
  // 编辑类
  {
    name: 'edit_file',
    description: 'Edit file using SEARCH/REPLACE blocks. Format: <<<<<<< SEARCH\\nold\\n=======\\nnew\\n>>>>>>> REPLACE',
    // 文件编辑不需要审批（可通过Checkpoint撤销）
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        search_replace_blocks: { type: 'string', description: 'SEARCH/REPLACE blocks' },
      },
      required: ['path', 'search_replace_blocks'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite entire file content.',
    // 文件写入不需要审批（可通过Checkpoint撤销）
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'create_file_or_folder',
    description: 'Create a new file or folder. Path ending with / creates folder.',
    // 文件操作不需要审批（可通过Checkpoint撤销）
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path (end with / for folder)' },
        content: { type: 'string', description: 'Initial content for files' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_file_or_folder',
    description: 'Delete a file or folder.',
    approvalType: 'dangerous',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
        recursive: { type: 'boolean', description: 'Delete recursively' },
      },
      required: ['path'],
    },
  },
  // 终端类
  {
    name: 'run_command',
    description: 'Execute a shell command.',
    approvalType: 'terminal',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_lint_errors',
    description: 'Get lint/compile errors for a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
  // 语义搜索类
  {
    name: 'codebase_search',
    description: 'Semantic search across the codebase using AI embeddings. Best for finding code by meaning/intent.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        top_k: { type: 'number', description: 'Number of results (default: 10)' },
      },
      required: ['query'],
    },
  },
  // LSP 工具类
  {
    name: 'find_references',
    description: 'Find all references to a symbol at a specific location.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['path', 'line', 'column'],
    },
  },
  {
    name: 'go_to_definition',
    description: 'Get the definition location of a symbol.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['path', 'line', 'column'],
    },
  },
  {
    name: 'get_hover_info',
    description: 'Get type information and documentation for a symbol.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        line: { type: 'number', description: 'Line number (1-indexed)' },
        column: { type: 'number', description: 'Column number (1-indexed)' },
      },
      required: ['path', 'line', 'column'],
    },
  },
  {
    name: 'get_document_symbols',
    description: 'Get all symbols (functions, classes, variables) in a file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
  },
  // 批量操作
  {
    name: 'read_multiple_files',
    description: 'Read multiple files at once. More efficient than multiple read_file calls.',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', description: 'Array of file paths to read' },
      },
      required: ['paths'],
    },
  },
  // 网络工具 (Phase 2)
  {
    name: 'web_search',
    description: 'Search the web for information. Returns top results with titles, URLs, and snippets.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_url',
    description: 'Fetch and read content from a URL. Returns the page title and text content.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch content from' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a question and wait for their response. Use when you need clarification or user input.',
    approvalType: 'dangerous',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
      },
      required: ['question'],
    },
  },
]

// ===== 工具审批类型映射 =====
// Cursor 风格：文件编辑直接执行，只有危险操作和终端命令需要审批

const APPROVAL_TYPE_MAP: Record<string, ToolApprovalType> = {
  // 文件编辑不需要审批 - Cursor 风格
  // edit_file: 不需要审批
  // write_file: 不需要审批
  // create_file_or_folder: 不需要审批

  // 危险操作需要审批
  delete_file_or_folder: 'dangerous',

  // 终端命令需要审批
  run_command: 'terminal',
}

export function getToolApprovalType(toolName: string): ToolApprovalType | undefined {
  return APPROVAL_TYPE_MAP[toolName]
}

export function getToolDefinitions(): ToolDefinition[] {
  return TOOL_DEFINITIONS
}

// ===== 工具显示名称 =====

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  read_file: 'Read',
  list_directory: 'List',
  get_dir_tree: 'Tree',
  search_files: 'Search',
  edit_file: 'Edit',
  write_file: 'Write',
  create_file_or_folder: 'Create',
  delete_file_or_folder: 'Delete',
  run_command: 'Run',
  get_lint_errors: 'Lint',
  web_search: 'Web Search',
  read_url: 'Read URL',
  ask_user: 'Ask User',
}

// 写入类工具（需要显示代码预览）
export const WRITE_TOOLS = ['edit_file', 'write_file', 'create_file_or_folder']

// ===== Search/Replace 解析 =====

interface SearchReplaceBlock {
  search: string
  replace: string
}

function parseSearchReplaceBlocks(blocksStr: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = []
  const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g
  let match

  while ((match = regex.exec(blocksStr)) !== null) {
    blocks.push({ search: match[1], replace: match[2] })
  }

  return blocks
}

function applySearchReplaceBlocks(
  content: string,
  blocks: SearchReplaceBlock[]
): { newContent: string; appliedCount: number; errors: string[] } {
  let newContent = content
  let appliedCount = 0
  const errors: string[] = []

  for (const block of blocks) {
    if (newContent.includes(block.search)) {
      newContent = newContent.replace(block.search, block.replace)
      appliedCount++
    } else {
      // 尝试模糊匹配（忽略行尾空白）
      const normalizedSearch = block.search.split('\n').map(l => l.trimEnd()).join('\n')
      const lines = newContent.split('\n')
      const searchLines = block.search.split('\n')
      let found = false

      for (let i = 0; i <= lines.length - searchLines.length; i++) {
        const slice = lines.slice(i, i + searchLines.length)
        const sliceNormalized = slice.map(l => l.trimEnd()).join('\n')

        if (sliceNormalized === normalizedSearch) {
          lines.splice(i, searchLines.length, ...block.replace.split('\n'))
          newContent = lines.join('\n')
          appliedCount++
          found = true
          break
        }
      }

      if (!found) {
        errors.push(`Search block not found: "${block.search.slice(0, 50)}..."`)
      }
    }
  }

  return { newContent, appliedCount, errors }
}

// ===== 目录树构建 =====

interface DirTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: DirTreeNode[]
}

async function buildDirTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<DirTreeNode[]> {
  if (currentDepth >= maxDepth) return []

  const items = await window.electronAPI.readDir(dirPath)
  if (!items) return []

  const nodes: DirTreeNode[] = []
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv']

  for (const item of items) {
    if (item.name.startsWith('.') && item.name !== '.env') continue
    if (ignoreDirs.includes(item.name)) continue

    const node: DirTreeNode = {
      name: item.name,
      path: item.path,
      isDirectory: item.isDirectory,
    }

    if (item.isDirectory && currentDepth < maxDepth - 1) {
      node.children = await buildDirTree(item.path, maxDepth, currentDepth + 1)
    }

    nodes.push(node)
  }

  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function formatDirTree(nodes: DirTreeNode[], prefix = ''): string {
  let result = ''

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const isLast = i === nodes.length - 1
    const connector = isLast ? '└── ' : '├── '
    const icon = node.isDirectory ? '📁 ' : '📄 '

    result += `${prefix}${connector}${icon}${node.name}\\n`

    if (node.children?.length) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ')
      result += formatDirTree(node.children, childPrefix)
    }
  }

  return result
}

// ===== 工具执行结果 =====

export interface ToolExecutionResult {
  success: boolean
  result: string
  error?: string
  // 用于 UI 显示的元数据
  meta?: {
    filePath?: string
    oldContent?: string
    newContent?: string
    linesAdded?: number
    linesRemoved?: number
    isNewFile?: boolean
  }
}

// ===== 工具执行 =====

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  workspacePath?: string
): Promise<ToolExecutionResult> {
  try {
    /**
     * 安全路径解析
     * 1. 验证路径格式
     * 2. 检查目录遍历攻击
     * 3. 检查敏感文件访问
     * 4. 确保路径在工作区内
     */
    const resolvePath = (p: unknown, allowRead = false) => {
      if (typeof p !== 'string') throw new Error('Invalid path: not a string')

      // 使用安全验证
      const validation = validatePath(p, workspacePath ?? null, {
        allowSensitive: false,
        allowOutsideWorkspace: false,
      })

      if (!validation.valid) {
        throw new Error(`Security: ${validation.error}`)
      }

      // 额外检查敏感文件（即使在工作区内）
      if (!allowRead && isSensitivePath(validation.sanitizedPath!)) {
        throw new Error('Security: Cannot modify sensitive files')
      }

      return validation.sanitizedPath!
    }

    switch (toolName) {
      case 'read_file': {
        const path = resolvePath(args.path, true) // 读取允许访问更多文件
        const content = await window.electronAPI.readFile(path)
        if (content === null) {
          return { success: false, result: '', error: `File not found: ${path}` }
        }

        const lines = content.split('\n')
        const startLine = typeof args.start_line === 'number' ? Math.max(1, args.start_line) : 1
        const endLine = typeof args.end_line === 'number' ? Math.min(lines.length, args.end_line) : lines.length

        const selectedLines = lines.slice(startLine - 1, endLine)
        const numberedContent = selectedLines
          .map((line, i) => `${startLine + i}: ${line}`)
          .join('\n')

        return {
          success: true,
          result: `File: ${path}\\nLines ${startLine}-${endLine} of ${lines.length}\\n\\n${numberedContent}`,
        }
      }

      case 'list_directory': {
        const path = resolvePath(args.path)
        const items = await window.electronAPI.readDir(path)
        if (!items?.length) {
          return { success: true, result: `Directory empty or not found: ${path}` }
        }

        const formatted = items
          .slice(0, 100)
          .map(item => `${item.isDirectory ? '📁' : '📄'} ${item.name}`)
          .join('\\n')

        return {
          success: true,
          result: `Contents of ${path} (${items.length} items):\\n${formatted}${items.length > 100 ? '\\n...(truncated)' : ''}`,
        }
      }

      case 'get_dir_tree': {
        const path = resolvePath(args.path)
        const maxDepth = Math.min(typeof args.max_depth === 'number' ? args.max_depth : 3, 5)
        const tree = await buildDirTree(path, maxDepth)

        if (!tree.length) {
          return { success: true, result: `Directory empty or not found: ${path}` }
        }

        return {
          success: true,
          result: `Directory tree of ${path}:\\n${formatDirTree(tree)}`,
        }
      }

      case 'search_files': {
        const searchPath = resolvePath(args.path)
        const pattern = String(args.pattern)
        const isRegex = args.is_regex === true
        const filePattern = typeof args.file_pattern === 'string' ? args.file_pattern : undefined

        try {
          // 使用 ripgrep 进行高性能递归搜索
          const searchResults = await window.electronAPI.searchFiles(pattern, searchPath, {
            isRegex,
            isCaseSensitive: false,
            include: filePattern,
          })

          if (!searchResults || searchResults.length === 0) {
            return { success: true, result: `No matches for "${pattern}" in ${searchPath}` }
          }

          // 按文件分组结果
          const fileGroups = new Map<string, { line: number; text: string }[]>()
          for (const result of searchResults) {
            const relativePath = result.path.replace(searchPath, '').replace(/^[\\/]/, '')
            if (!fileGroups.has(relativePath)) {
              fileGroups.set(relativePath, [])
            }
            const matches = fileGroups.get(relativePath)!
            if (matches.length < 5) { // 每个文件最多显示 5 个匹配
              matches.push({ line: result.line, text: result.text })
            }
          }

          // 格式化输出
          let output = `Found matches in ${fileGroups.size} files (${searchResults.length} total matches):\\n\\n`
          let fileCount = 0

          for (const [file, matches] of fileGroups) {
            if (fileCount >= 30) { // 最多显示 30 个文件
              output += `\\n... and ${fileGroups.size - 30} more files`
              break
            }

            output += `📄 ${file}:\\n`
            for (const m of matches) {
              output += `  Line ${m.line}: ${m.text}\\n`
            }
            output += '\\n'
            fileCount++
          }

          return { success: true, result: output }
        } catch (error) {
          // 如果 ripgrep 失败，回退到简单搜索
          console.warn('[search_files] ripgrep failed, falling back to simple search:', error)
          return { success: false, result: '', error: `Search failed: ${error}` }
        }
      }

      case 'edit_file': {
        const path = resolvePath(args.path)
        const blocksStr = String(args.search_replace_blocks)

        const content = await window.electronAPI.readFile(path)
        if (content === null) {
          return { success: false, result: '', error: `File not found: ${path}` }
        }

        const blocks = parseSearchReplaceBlocks(blocksStr)
        if (!blocks.length) {
          return {
            success: false,
            result: '',
            error: 'No valid SEARCH/REPLACE blocks found.',
          }
        }

        const { newContent, appliedCount, errors } = applySearchReplaceBlocks(content, blocks)

        if (appliedCount === 0) {
          return {
            success: false,
            result: '',
            error: `No changes applied. Errors:\\n${errors.join('\\n')}`,
          }
        }

        // Checkpoint 现在在 AgentService 中创建
        const success = await window.electronAPI.writeFile(path, newContent)
        if (!success) {
          return { success: false, result: '', error: `Failed to write: ${path}` }
        }

        // 计算行数变化
        const lineChanges = calculateLineChanges(content, newContent)

        return {
          success: true,
          result: `✅ Applied ${appliedCount}/${blocks.length} changes to ${path}`,
          meta: {
            filePath: path,
            oldContent: content,
            newContent,
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
          },
        }
      }

      case 'write_file': {
        const path = resolvePath(args.path)
        const content = String(args.content)

        // 确保父目录存在
        const parentDir = path.replace(/[/\\][^/\\]+$/, '')
        if (parentDir && parentDir !== path) {
          await window.electronAPI.mkdir(parentDir)
        }

        const oldContent = await window.electronAPI.readFile(path)
        const isNewFile = oldContent === null

        // Checkpoint 现在在 AgentService 中创建
        const success = await window.electronAPI.writeFile(path, content)

        if (!success) {
          return { success: false, result: '', error: `Failed to write: ${path}` }
        }

        // 计算实际的行数变化
        const lineChanges = calculateLineChanges(oldContent || '', content)

        return {
          success: true,
          result: `✅ ${isNewFile ? 'Created' : 'Updated'} ${path}`,
          meta: {
            filePath: path,
            oldContent: oldContent || '',
            newContent: content,
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
            isNewFile,
          },
        }
      }

      case 'create_file_or_folder': {
        const pathStr = String(args.path)
        const isFolder = pathStr.endsWith('/') || pathStr.endsWith('\\')
        const path = resolvePath(pathStr.replace(/[/\\]$/, ''))
        const content = typeof args.content === 'string' ? args.content : ''

        // Checkpoint 现在在 AgentService 中创建
        if (isFolder) {
          const success = await window.electronAPI.mkdir(path)
          if (!success) {
            return { success: false, result: '', error: `Failed to create folder: ${path}` }
          }
          return { success: true, result: `✅ Created folder: ${path}` }
        } else {
          const parentDir = path.replace(/[/\\][^/\\]+$/, '')
          if (parentDir && parentDir !== path) {
            await window.electronAPI.mkdir(parentDir)
          }
          const success = await window.electronAPI.writeFile(path, content)
          if (!success) {
            return { success: false, result: '', error: `Failed to create file: ${path}` }
          }
          return {
            success: true,
            result: `✅ Created file: ${path}`,
            meta: {
              filePath: path,
              oldContent: '',
              newContent: content,
              linesAdded: content.split('\n').length,
              linesRemoved: 0,
              isNewFile: true,
            },
          }
        }
      }

      case 'delete_file_or_folder': {
        const path = resolvePath(args.path)

        // Checkpoint 现在在 AgentService 中创建
        const success = await window.electronAPI.deleteFile(path)
        if (!success) {
          return { success: false, result: '', error: `Failed to delete: ${path}` }
        }
        return { success: true, result: `✅ Deleted: ${path}` }
      }

      case 'run_command': {
        const command = String(args.command)
        const cwd = typeof args.cwd === 'string' ? resolvePath(args.cwd) : workspacePath
        const timeout = (typeof args.timeout === 'number' ? args.timeout : 30) * 1000

        // 解析命令和参数
        const parts = command.trim().split(/\s+/)
        const baseCommand = parts[0]
        const commandArgs = parts.slice(1)

        const result = await window.electronAPI.executeSecureCommand({
          command: baseCommand,
          args: commandArgs,
          cwd: cwd || undefined,
          timeout: timeout,
          requireConfirm: true
        })

        let output = `$ ${command}\\n`
        if (cwd) output += `(cwd: ${cwd})\\n`
        output += `Exit code: ${result.exitCode || 0}\\n\\n`
        if (result.output) output += result.output
        if (result.errorOutput) output += `\\nStderr:\\n${result.errorOutput}`
        if (result.error) output += `\\nError: ${result.error}`
        if (!result.output && !result.errorOutput && !result.error) output += '(No output)'

        // 智能错误处理：让 Agent 能够继续对话并了解失败原因
        const commandSuccess = result.success && (result.exitCode === 0)

        // 如果命令失败，在输出中添加解释性信息，帮助 AI 理解问题
        if (!commandSuccess) {
          if (result.error && result.error.includes('不在白名单中')) {
            output += `\n\n⚠️ **Security Restriction**: ${result.error}`
            output += `\n💡 **Solution**: Add "${baseCommand}" to the whitelist in Settings > Security > Shell Command Whitelist.`
          } else if (result.error && result.error.includes('未设置工作区')) {
            output += `\n\n⚠️ **Workspace Required**: ${result.error}`
            output += `\n💡 **Solution**: Open a workspace folder first (File > Open Folder).`
          } else if (result.exitCode !== 0) {
            output += `\n\n⚠️ **Command Failed**: Exit code ${result.exitCode}`
            output += `\n💡 **Analysis**: The command executed but returned an error. Check the output above for details.`
          }
        }

        return {
          success: true, // 始终返回成功，让 Agent 继续对话
          result: output,
          error: commandSuccess ? undefined : `Command completed with errors (exit code: ${result.exitCode}). See output above for details.`,
        }
      }

      case 'get_lint_errors': {
        const lintPath = resolvePath(args.path)

        try {
          // 动态导入 lintService 避免循环依赖
          const { lintService } = await import('../lintService')

          // 首先尝试从 LSP 获取诊断信息
          const lspDiagnostics = await window.electronAPI.getLspDiagnostics?.(lintPath)

          if (lspDiagnostics && lspDiagnostics.length > 0) {
            // 格式化 LSP 诊断结果
            const errors = lspDiagnostics.map((d: any) => ({
              code: d.code?.toString() || d.source || 'lsp',
              message: d.message,
              severity: (d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info') as 'error' | 'warning' | 'info',
              startLine: (d.range?.start?.line || 0) + 1,
              endLine: (d.range?.end?.line || 0) + 1,
              file: lintPath,
            }))

            return {
              success: true,
              result: lintService.formatErrors(errors),
            }
          }

          // 如果 LSP 没有结果，尝试运行 lint 命令
          const errors = await lintService.getLintErrors(lintPath, true)

          if (errors.length === 0) {
            // 最后尝试快速语法检查
            const content = await window.electronAPI.readFile(lintPath)
            if (content) {
              const ext = lintPath.split('.').pop()?.toLowerCase() || ''
              const lang = ['ts', 'tsx', 'js', 'jsx'].includes(ext) ? 'typescript' : ext
              const syntaxErrors = lintService.quickSyntaxCheck(content, lang)

              if (syntaxErrors.length > 0) {
                return {
                  success: true,
                  result: lintService.formatErrors(syntaxErrors),
                }
              }
            }
          }

          return {
            success: true,
            result: lintService.formatErrors(errors),
          }
        } catch (error) {
          return {
            success: true,
            result: `✅ No lint errors found in ${lintPath}`,
          }
        }
      }

      case 'codebase_search': {
        const query = String(args.query)
        const topK = typeof args.top_k === 'number' ? args.top_k : 10

        try {
          if (!workspacePath) {
            return { success: false, result: '', error: 'No workspace path available' }
          }

          const results = await window.electronAPI.indexSearch(workspacePath, query, topK)

          if (!results || results.length === 0) {
            return { success: true, result: `No semantic matches found for: "${query}"` }
          }

          let output = `Found ${results.length} semantic matches for "${query}":\\n\\n`

          for (const result of results) {
            const score = (result.score * 100).toFixed(1)
            output += `📄 ${result.relativePath} (${score}% match)\\n`
            output += `   Lines ${result.startLine}-${result.endLine} | ${result.type}\\n`
            // 显示代码片段（限制长度）
            const snippet = result.content.slice(0, 200).replace(/\\n/g, '\\n   ')
            output += `   ${snippet}${result.content.length > 200 ? '...' : ''}\\n\\n`
          }

          return { success: true, result: output }
        } catch (error) {
          return { success: false, result: '', error: `Codebase search failed: ${error}` }
        }
      }

      case 'find_references': {
        const refPath = resolvePath(args.path)
        const line = typeof args.line === 'number' ? args.line - 1 : 0 // LSP uses 0-indexed
        const column = typeof args.column === 'number' ? args.column - 1 : 0

        try {
          const results = await window.electronAPI.lspReferences({
            uri: pathToLspUri(refPath),
            line,
            character: column,
          })

          if (!results || results.length === 0) {
            return { success: true, result: 'No references found' }
          }

          let output = `Found ${results.length} references:\\n\\n`

          for (const ref of results.slice(0, 30)) {
            const filePath = lspUriToPath(ref.uri)
            const relativePath = workspacePath
              ? filePath.replace(workspacePath, '').replace(/^[\\/]/, '')
              : filePath
            const startLine = (ref.range?.start?.line || 0) + 1
            output += `📍 ${relativePath}:${startLine}\\n`
          }

          if (results.length > 30) {
            output += `\\n... and ${results.length - 30} more references`
          }

          return { success: true, result: output }
        } catch (error) {
          return { success: false, result: '', error: `Find references failed: ${error}` }
        }
      }

      case 'go_to_definition': {
        const defPath = resolvePath(args.path)
        const line = typeof args.line === 'number' ? args.line - 1 : 0
        const column = typeof args.column === 'number' ? args.column - 1 : 0

        try {
          const results = await window.electronAPI.lspDefinition({
            uri: pathToLspUri(defPath),
            line,
            character: column,
          })

          if (!results || (Array.isArray(results) && results.length === 0)) {
            return { success: true, result: 'No definition found' }
          }

          const definitions = Array.isArray(results) ? results : [results]
          let output = `Found ${definitions.length} definition(s):\\n\\n`

          for (const def of definitions) {
            // LSP 可能返回 Location 或 LocationLink 格式
            const defAny = def as any
            const uri = defAny.uri || defAny.targetUri
            const range = defAny.range || defAny.targetSelectionRange || defAny.targetRange
            if (!uri) continue

            const filePath = lspUriToPath(uri)
            const relativePath = workspacePath
              ? filePath.replace(workspacePath, '').replace(/^[\\/]/, '')
              : filePath
            const startLine = (range?.start?.line || 0) + 1

            output += `📍 ${relativePath}:${startLine}\\n`

            // 尝试读取定义处的代码
            try {
              const content = await window.electronAPI.readFile(filePath)
              if (content) {
                const lines = content.split('\n')
                const contextStart = Math.max(0, startLine - 2)
                const contextEnd = Math.min(lines.length, startLine + 5)
                const snippet = lines.slice(contextStart, contextEnd)
                  .map((l, i) => `${contextStart + i + 1}: ${l}`)
                  .join('\n')
                output += `\`\`\`\\n${snippet}\\n\`\`\`\\n\\n`
              }
            } catch {
              // 忽略读取错误
            }
          }

          return { success: true, result: output }
        } catch (error) {
          return { success: false, result: '', error: `Go to definition failed: ${error}` }
        }
      }

      case 'get_hover_info': {
        const hoverPath = resolvePath(args.path)
        const line = typeof args.line === 'number' ? args.line - 1 : 0
        const column = typeof args.column === 'number' ? args.column - 1 : 0

        try {
          const result = await window.electronAPI.lspHover({
            uri: pathToLspUri(hoverPath),
            line,
            character: column,
          })

          if (!result || !result.contents) {
            return { success: true, result: 'No hover information available' }
          }

          let output = '📝 Type Information:\\n\\n'

          // 处理不同格式的 contents
          const contents = result.contents as any
          if (typeof contents === 'string') {
            output += contents
          } else if (Array.isArray(contents)) {
            for (const item of contents) {
              if (typeof item === 'string') {
                output += item + '\\n'
              } else if (item.value) {
                const lang = item.language || item.kind || ''
                output += `\`\`\`${lang}\\n${item.value}\\n\`\`\`\\n`
              }
            }
          } else if (contents.value) {
            const lang = contents.language || contents.kind || ''
            output += `\`\`\`${lang}\\n${contents.value}\\n\`\`\`\\n`
          }

          return { success: true, result: output }
        } catch (error) {
          return { success: false, result: '', error: `Get hover info failed: ${error}` }
        }
      }

      case 'get_document_symbols': {
        const symbolPath = resolvePath(args.path)

        try {
          const results = await window.electronAPI.lspDocumentSymbol({
            uri: pathToLspUri(symbolPath),
          })

          if (!results || results.length === 0) {
            return { success: true, result: 'No symbols found in this file' }
          }

          const symbolKindNames: Record<number, string> = {
            1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package',
            5: 'Class', 6: 'Method', 7: 'Property', 8: 'Field',
            9: 'Constructor', 10: 'Enum', 11: 'Interface', 12: 'Function',
            13: 'Variable', 14: 'Constant', 15: 'String', 16: 'Number',
            17: 'Boolean', 18: 'Array', 19: 'Object', 20: 'Key',
            21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
            25: 'Operator', 26: 'TypeParameter',
          }

          let output = `Symbols in ${args.path}:\\n\\n`

          const formatSymbol = (symbol: any, indent = 0): string => {
            const prefix = '  '.repeat(indent)
            const kind = symbolKindNames[symbol.kind] || 'Unknown'
            const line = (symbol.range?.start?.line || symbol.location?.range?.start?.line || 0) + 1
            let result = `${prefix}${kind}: ${symbol.name} (line ${line})\\n`

            if (symbol.children) {
              for (const child of symbol.children) {
                result += formatSymbol(child, indent + 1)
              }
            }
            return result
          }

          for (const symbol of results) {
            output += formatSymbol(symbol)
          }

          return { success: true, result: output }
        } catch (error) {
          return { success: false, result: '', error: `Get document symbols failed: ${error}` }
        }
      }

      case 'read_multiple_files': {
        const paths = args.paths as string[]
        if (!Array.isArray(paths) || paths.length === 0) {
          return { success: false, result: '', error: 'paths must be a non-empty array' }
        }

        const results: string[] = []
        const errors: string[] = []

        for (const p of paths.slice(0, 10)) { // 限制最多 10 个文件
          const fullPath = resolvePath(p)
          try {
            const content = await window.electronAPI.readFile(fullPath)
            if (content !== null) {
              const lines = content.split('\n')
              const numberedContent = lines
                .map((line, i) => `${i + 1}: ${line}`)
                .join('\n')
              results.push(`\\n### File: ${p}\\nLines: ${lines.length}\\n\`\`\`\\n${numberedContent}\\n\`\`\`\\n`)
            } else {
              errors.push(`File not found: ${p}`)
            }
          } catch (e) {
            errors.push(`Error reading ${p}: ${e}`)
          }
        }

        let output = `Read ${results.length} file(s):\\n`
        output += results.join('\\n')

        if (errors.length > 0) {
          output += `\\n\\n⚠️ Errors:\\n${errors.join('\\n')}`
        }

        if (paths.length > 10) {
          output += `\\n\\n⚠️ Only first 10 files were read (${paths.length} requested)`
        }

        return { success: true, result: output }
      }

      // ===== Phase 2: 网络工具 =====

      case 'web_search': {
        const query = String(args.query)
        const maxResults = typeof args.max_results === 'number' ? args.max_results : 5

        const result = await window.electronAPI.httpWebSearch(query, maxResults)

        if (!result.success || !result.results) {
          return {
            success: false,
            result: '',
            error: result.error || 'Web search failed',
          }
        }

        if (result.results.length === 0) {
          return {
            success: true,
            result: `No results found for: "${query}"`,
          }
        }

        let output = `Search results for "${query}":\\n\\n`
        for (const r of result.results) {
          output += `**${r.title}**\\n`
          output += `URL: ${r.url}\\n`
          output += `${r.snippet}\\n\\n`
        }

        return { success: true, result: output }
      }

      case 'read_url': {
        const url = String(args.url)
        const timeout = typeof args.timeout === 'number' ? args.timeout * 1000 : 30000

        // 简单的 URL 验证
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return {
            success: false,
            result: '',
            error: 'Invalid URL: must start with http:// or https://',
          }
        }

        const result = await window.electronAPI.httpReadUrl(url, timeout)

        if (!result.success || !result.content) {
          return {
            success: false,
            result: '',
            error: result.error || 'Failed to fetch URL',
          }
        }

        let output = `Fetched: ${url}\\n`
        if (result.title) {
          output += `Title: ${result.title}\\n`
        }
        output += `Status: ${result.statusCode}\\n`
        output += `Content-Type: ${result.contentType}\\n\\n`

        // 截断过长的内容
        const content = result.content.length > 50000
          ? result.content.slice(0, 50000) + '\\n\\n...(content truncated, showing first 50000 characters)'
          : result.content

        output += content

        return { success: true, result: output }
      }

      case 'ask_user': {
        const question = String(args.question)

        // ask_user 返回一个特殊标记，告诉 AgentService 需要更多用户输入
        // 实际的用户交互由 AgentService 处理
        return {
          success: true,
          result: `💬 **Question for user**: ${question}\\n\\n_Waiting for user response..._`,
          meta: {
            requiresUserInput: true,
            question,
          } as any,
        }
      }

      default:
        return { success: false, result: '', error: `Unknown tool: ${toolName}` }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, result: '', error: message }
  }
}
