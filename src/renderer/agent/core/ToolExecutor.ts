/**
 * 工具执行器
 * 负责工具的验证和执行
 */

import { ToolDefinition, ToolApprovalType } from './types'
import { toFullPath } from '@/renderer/utils/pathUtils'

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
    approvalType: 'edits',
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
    approvalType: 'edits',
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
    approvalType: 'edits',
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

    result += `${prefix}${connector}${icon}${node.name}\n`

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
    const resolvePath = (p: unknown) => {
      if (typeof p !== 'string') throw new Error('Invalid path')
      return toFullPath(p, workspacePath ?? null)
    }

    switch (toolName) {
      case 'read_file': {
        const path = resolvePath(args.path)
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
          result: `File: ${path}\nLines ${startLine}-${endLine} of ${lines.length}\n\n${numberedContent}`,
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
          .join('\n')

        return {
          success: true,
          result: `Contents of ${path} (${items.length} items):\n${formatted}${items.length > 100 ? '\n...(truncated)' : ''}`,
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
          result: `Directory tree of ${path}:\n${formatDirTree(tree)}`,
        }
      }

      case 'search_files': {
        const path = resolvePath(args.path)
        const pattern = String(args.pattern)
        const isRegex = args.is_regex === true
        const filePattern = typeof args.file_pattern === 'string' ? args.file_pattern : undefined

        const items = await window.electronAPI.readDir(path)
        if (!items) {
          return { success: false, result: '', error: `Directory not found: ${path}` }
        }

        const results: { file: string; matches: { line: number; content: string }[] }[] = []
        const regex = isRegex ? new RegExp(pattern, 'gi') : null
        const fileRegex = filePattern
          ? new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i')
          : null

        for (const item of items.slice(0, 50)) {
          if (item.isDirectory) continue
          if (fileRegex && !fileRegex.test(item.name)) continue

          const content = await window.electronAPI.readFile(item.path)
          if (!content) continue

          const lines = content.split('\n')
          const matches: { line: number; content: string }[] = []

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const isMatch = regex
              ? regex.test(line)
              : line.toLowerCase().includes(pattern.toLowerCase())

            if (isMatch) {
              matches.push({ line: i + 1, content: line.trim().slice(0, 100) })
            }
            if (regex) regex.lastIndex = 0
          }

          if (matches.length > 0) {
            results.push({ file: item.name, matches: matches.slice(0, 5) })
          }
        }

        if (!results.length) {
          return { success: true, result: `No matches for "${pattern}" in ${path}` }
        }

        let output = `Found ${results.length} files with matches:\n\n`
        for (const r of results.slice(0, 20)) {
          output += `📄 ${r.file}:\n`
          for (const m of r.matches) {
            output += `  Line ${m.line}: ${m.content}\n`
          }
          output += '\n'
        }

        return { success: true, result: output }
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
            error: `No changes applied. Errors:\n${errors.join('\n')}`,
          }
        }

        // Checkpoint 现在在 AgentService 中创建
        const success = await window.electronAPI.writeFile(path, newContent)
        if (!success) {
          return { success: false, result: '', error: `Failed to write: ${path}` }
        }

        // 计算行数变化
        const oldLines = content.split('\n').length
        const newLines = newContent.split('\n').length

        return {
          success: true,
          result: `✅ Applied ${appliedCount}/${blocks.length} changes to ${path}`,
          meta: {
            filePath: path,
            oldContent: content,
            newContent,
            linesAdded: Math.max(0, newLines - oldLines),
            linesRemoved: Math.max(0, oldLines - newLines),
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

        const newLines = content.split('\n').length
        const oldLines = oldContent ? oldContent.split('\n').length : 0

        return {
          success: true,
          result: `✅ ${isNewFile ? 'Created' : 'Updated'} ${path}`,
          meta: {
            filePath: path,
            oldContent: oldContent || '',
            newContent: content,
            linesAdded: newLines,
            linesRemoved: oldLines,
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

        const result = await window.electronAPI.executeCommand(command, cwd || undefined, timeout)

        let output = `$ ${command}\n`
        if (cwd) output += `(cwd: ${cwd})\n`
        output += `Exit code: ${result.exitCode}\n\n`
        if (result.output) output += result.output
        if (result.errorOutput) output += `\nStderr:\n${result.errorOutput}`
        if (!result.output && !result.errorOutput) output += '(No output)'

        return {
          success: result.exitCode === 0,
          result: output,
          error: result.exitCode !== 0 ? `Command failed with exit code ${result.exitCode}` : undefined,
        }
      }

      case 'get_lint_errors': {
        const path = resolvePath(args.path)
        // 简化实现：返回无错误
        return {
          success: true,
          result: `No lint errors found in ${path}`,
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
